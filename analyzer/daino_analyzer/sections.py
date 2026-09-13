"""Estructura: en qué tramos se divide la canción y cuáles se repiten.

Segmentación espectral por Laplaciano (McFee & Ellis, "Analyzing song structure
with spectral clustering", ISMIR 2014), el método de referencia de librosa:

1. Rasgos sincronizados al BEAT: color armónico (croma) y timbre (MFCC).
2. Matriz de recurrencia: qué beats se parecen a cuáles, en cualquier punto de
   la canción (un estribillo se parece a los otros estribillos).
3. Continuidad local: cada beat se parece a sus vecinos inmediatos.
4. Grafo con ambas, autovectores del Laplaciano y agrupación: los beats del
   mismo tipo de tramo caen en el mismo grupo.

Después, reglas musicales: las fronteras se llevan al downbeat más cercano (una
sección empieza en un compás), los tramos de menos de 2 compases se funden con
su vecino, y cada tramo recibe su energía y su densidad de golpes.

Las ETIQUETAS de papel (intro, estribillo…) son heurísticas y así se documentan:
lo robusto es el grupo (`cluster`: A, B, C… — mismo grupo = mismo material) y
la energía. El charter de la Ola 5 debe apoyarse en eso.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from daino_analyzer.beats import BeatResult
from daino_analyzer.energy import EnergyResult
from daino_analyzer.onsets import Onset
from daino_analyzer.spectral import SR, Spectral

MIN_BEATS_FOR_STRUCTURE = 24
MAX_CLUSTERS = 10
MIN_SECTION_BARS = 2
# Longitud típica de una sección: 8-16 compases; se aceptan medianas de hasta 24
# y ninguna de más de 32 (un tramo de 3 minutos sin cambios no es una sección).
TYPICAL_MAX_BARS = 24
LONGEST_BARS = 32


@dataclass(frozen=True)
class SectionInfo:
    start: float
    end: float
    cluster: str
    role: str
    energy: float          # [0,1] energía relativa media del tramo
    density: float         # golpes (fuerza ≥ 0.2) por segundo


def analyze(spec: Spectral, beats: BeatResult, onsets: list[Onset], energy: EnergyResult, duration: float) -> list[SectionInfo]:
    b = beats.beats
    if len(b) < MIN_BEATS_FOR_STRUCTURE:
        return [_describe(0.0, duration, "A", "verse", onsets, energy)] if duration > 0 else []

    meter = beats.meter or 4
    candidates = _cluster_beats(spec, b)
    segments = None
    for labels in candidates:
        segs = _segments(labels, b, beats.downbeats, meter)
        lengths_bars = np.array([(e - s) / meter for s, e, _ in segs])
        segments = segs
        # Desde lo que sugiere la estructura, el menor número de grupos que da
        # secciones de longitud típica. Más grupos parten en trozos cada frase;
        # menos funden estrofa y estribillo en un bloque de minutos.
        if np.median(lengths_bars) <= TYPICAL_MAX_BARS and lengths_bars.max() <= LONGEST_BARS:
            break

    # Grupos renombrados por orden de aparición: A es el primer material.
    names: dict[int, str] = {}
    out = []
    for i, (s, e, lab) in enumerate(segments):
        names.setdefault(lab, chr(ord("A") + len(names)))
        start = 0.0 if i == 0 else float(b[s])
        end = duration if i == len(segments) - 1 else float(b[e])
        out.append(_describe(start, end, names[lab], "", onsets, energy))
    return _assign_roles(out)


def _beat_sync(features: np.ndarray, frame_hop: float, beats: np.ndarray) -> np.ndarray:
    """Columna i = media de los fotogramas del beat i al beat i+1 (el último, hasta el final)."""
    last = features.shape[1] - 1
    idx = np.clip(np.round(beats / frame_hop).astype(int), 0, last)
    bounds = np.concatenate([idx, [features.shape[1]]])
    out = np.empty((features.shape[0], len(beats)), dtype=np.float32)
    for j in range(len(beats)):
        a = min(bounds[j], last)
        c = max(a + 1, bounds[j + 1])
        out[:, j] = features[:, a:c].mean(axis=1)
    return out


def _cluster_beats(spec: Spectral, beats: np.ndarray) -> np.ndarray:
    import librosa
    import scipy.ndimage
    import scipy.sparse.csgraph
    from sklearn.cluster import KMeans

    slow = spec.slow_mel()
    hop = spec.slow_hop_sec
    logmel = librosa.power_to_db(slow, ref=np.max)
    mfcc = librosa.feature.mfcc(S=logmel, n_mfcc=13)
    chroma = librosa.feature.chroma_stft(y=spec.y, sr=SR, n_fft=4096, hop_length=2048)

    mf_sync = _beat_sync(mfcc, hop, beats)
    ch_sync = _beat_sync(chroma, 2048 / SR, beats)
    n = len(beats)

    feats = np.vstack([
        librosa.util.normalize(ch_sync, axis=0),
        _standardize(mf_sync[1:]),        # sin el coeficiente 0 (volumen): la estructura no es "más alto"
    ])
    R = librosa.segment.recurrence_matrix(feats, width=3, mode="affinity", sym=True)
    Rf = librosa.segment.path_enhance(R, 15) if n > 30 else R

    path_distance = np.sum(np.diff(mf_sync, axis=1) ** 2, axis=0)
    sigma = float(np.median(path_distance)) or 1.0
    path_sim = np.exp(-path_distance / sigma)
    R_path = np.diag(path_sim, k=1) + np.diag(path_sim, k=-1)

    deg_path = np.sum(R_path, axis=1)
    deg_rec = np.sum(Rf, axis=1)
    mu = float(deg_path.dot(deg_path + deg_rec) / max(np.sum((deg_path + deg_rec) ** 2), 1e-9))
    A = mu * Rf + (1 - mu) * R_path

    L = scipy.sparse.csgraph.laplacian(A, normed=True)
    evals, evecs = np.linalg.eigh(L)
    evecs = scipy.ndimage.median_filter(evecs, size=(9, 1))

    k_max = int(np.clip(n // 16, 2, MAX_CLUSTERS))
    # Punto de partida: el número de grupos que sugiere la propia estructura (el
    # mayor salto entre autovalores). Solo se sube si da secciones demasiado largas.
    gaps = np.diff(evals[: k_max + 1])
    k_start = int(np.argmax(gaps[1:]) + 2) if len(gaps) > 1 else 2
    cnorm = np.cumsum(evecs ** 2, axis=1) ** 0.5
    # Una agrupación por cada número de grupos candidato; `analyze` elige.
    return [KMeans(n_clusters=kk, n_init=10, random_state=0).fit_predict(evecs[:, :kk] / np.maximum(cnorm[:, kk - 1: kk], 1e-9))
            for kk in range(min(k_start, k_max), k_max + 1)]


def _segments(labels, beats, downbeats, meter):
    bounds = [0] + [i for i in range(1, len(labels)) if labels[i] != labels[i - 1]]
    segments = [(bounds[i], bounds[i + 1] if i + 1 < len(bounds) else len(labels)) for i in range(len(bounds))]
    return _snap_and_merge(segments, labels, beats, downbeats, meter)


def _standardize(x: np.ndarray) -> np.ndarray:
    mu = x.mean(axis=1, keepdims=True)
    sd = x.std(axis=1, keepdims=True)
    return (x - mu) / np.maximum(sd, 1e-6)


def _snap_and_merge(segments, labels, beats, downbeats, meter):
    """Fronteras al downbeat más cercano (±meter/2 beats) y fusión de tramos cortos."""
    min_beats = MIN_SECTION_BARS * meter
    down_idx = np.searchsorted(beats, downbeats) if len(downbeats) else np.array([], dtype=int)

    starts = []
    for s, _e in segments:
        if s == 0 or len(down_idx) == 0:
            starts.append(s)
            continue
        k = int(np.argmin(np.abs(down_idx - s)))
        starts.append(int(down_idx[k]) if abs(int(down_idx[k]) - s) <= max(1, meter // 2) else s)
    starts = sorted(set(starts))

    merged: list[list[int]] = []
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(labels)
        if e <= s:
            continue
        lab = int(np.bincount(labels[s:e]).argmax())
        if merged and (e - s < min_beats or merged[-1][2] == lab):
            merged[-1][1] = e                     # corto o mismo material: se funde con el anterior
        else:
            merged.append([s, e, lab])
    # El primero también puede haber quedado corto.
    if len(merged) > 1 and merged[0][1] - merged[0][0] < min_beats:
        merged[1][0] = merged[0][0]
        merged.pop(0)
    return [tuple(m) for m in merged]


def _describe(start, end, cluster, role, onsets, energy: EnergyResult) -> SectionInfo:
    a = int(start / energy.hop_sec)
    c = max(a + 1, int(end / energy.hop_sec))
    e = float(np.mean(energy.relative[a:c])) if c <= len(energy.relative) and a < len(energy.relative) else 0.0
    dur = max(end - start, 1e-6)
    hits = sum(1 for o in onsets if start <= o.t < end and o.strength >= 0.2)
    return SectionInfo(start=start, end=end, cluster=cluster, role=role, energy=e, density=hits / dur)


def _assign_roles(sections: list[SectionInfo]) -> list[SectionInfo]:
    """Heurística documentada, no verdad: ver docstring del módulo."""
    if not sections:
        return sections
    energies = np.array([s.energy for s in sections])
    counts = {}
    for s in sections:
        counts[s.cluster] = counts.get(s.cluster, 0) + 1
    # El grupo repetido más enérgico es el estribillo.
    repeated = {c for c, n in counts.items() if n >= 2}
    by_cluster_energy = {c: np.mean([s.energy for s in sections if s.cluster == c]) for c in counts}
    chorus = max(repeated, key=lambda c: by_cluster_energy[c]) if repeated else None
    median_e = float(np.median(energies))
    if chorus is not None and by_cluster_energy[chorus] < median_e:
        chorus = None       # lo que se repite es tranquilo: no es un estribillo
    first_chorus = next((i for i, s in enumerate(sections) if s.cluster == chorus), None)

    out = []
    last = len(sections) - 1
    for i, s in enumerate(sections):
        # Intro y outro por POSICIÓN y energía, aunque su material vuelva a
        # aparecer (es habitual que el final retome la intro).
        if i == 0 and last >= 2 and s.energy < median_e and s.cluster != chorus:
            role = "intro"
        elif i == last and last >= 2 and s.energy < median_e and s.cluster != chorus:
            role = "outro"
        elif s.cluster == chorus:
            role = "chorus"
        elif s.energy < 0.6 * median_e or s.density < 0.5:
            role = "break"
        elif counts[s.cluster] == 1 and first_chorus is not None and first_chorus < i < last:
            role = "bridge"   # material único que llega DESPUÉS del primer estribillo
        else:
            role = "verse"
        out.append(SectionInfo(s.start, s.end, s.cluster, role, s.energy, s.density))
    return out
