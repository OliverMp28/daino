"""Tonalidad y acordes: qué notas suenan y cómo se mueve la armonía.

Sin modelos ni dependencias nuevas: todo sale de un espectrograma de constante Q
(CQT, un bin cada tercio de semitono) de la canción entera.

1. PARTE ARMÓNICA. Separación armónico/percusiva por medianas (HPSS) sobre el
   CQT: lo que dura en el tiempo es armonía; lo que ocupa muchas frecuencias a la
   vez, batería. Medido (acordes sintéticos con batería): 90.8 % de acierto sin
   separar, 97.7 % separando.
2. AFINACIÓN. Muchas grabaciones no están afinadas a La 440 (432 Hz son −32
   cents; una versión acelerada, cualquier cosa). Se prueba cada desplazamiento
   de −50 a +50 cents y se queda el que mejor explica la armonía con acordes.
   Medido en canciones reales: los estimadores clásicos (picos del espectro)
   discrepaban hasta 30 cents entre sí en temas con voces procesadas; este
   criterio es el que importa para acertar los acordes.
3. CROMA de 12 notas en dos registros: agudo (desde C3) para el acorde y grave
   (hasta B2) para su fundamental.
4. ACORDES por beat: plantillas de las 24 tríadas mayores y menores más "sin
   acorde", con la fundamental reforzada por el bajo, y Viterbi para que un beat
   ambiguo no haga parpadear el acorde. Un acorde cambia en un beat, como en la
   música real.
5. TONALIDAD en el tiempo: croma de una ventana de ±6 s correlado con los
   perfiles de Temperley (2007) de las 24 tonalidades y Viterbi muy estable. La
   global es la que más dura; una modulación es un cambio de armadura sostenido.
   El error típico es confundir una tonalidad con su relativa (Do mayor / La
   menor): comparten notas y solo las distingue qué nota hace de centro.

Coste medido: 0.5-2.2 s por canción y unos pocos MB. Límites honestos: solo
tríadas (una séptima sale como su tríada; un acorde de quinta, sin tercera, sale
mayor o menor al azar), y en música sin armonía estable (rap sobre 808, voces
muy procesadas) la confianza baja y no debe usarse para decisiones de juego.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from daino_analyzer.beats import BeatResult
from daino_analyzer.music import CHORD_LABELS, MODES, NO_CHORD, NOTE_NAMES
from daino_analyzer.spectral import SR, Spectral

HOP = 2048                          # 93 ms: los acordes cambian como mucho por beat
BINS_PER_OCTAVE = 36
N_BINS = 7 * BINS_PER_OCTAVE        # C1 … B7
FMIN_MIDI = 24                      # C1
BASS_SPLIT_MIDI = 48                # C3: por debajo, fundamentales del bajo
LOG_GAIN = 100.0
HPSS_KERNEL = (9, 31)               # ~0.8 s en el tiempo, ~10 semitonos en frecuencia

TUNING_BLOCK_S = 0.5
TUNING_COARSE_CENTS = 10.0
TUNING_FINE_CENTS = 2.5
VOICED_RATIO = 0.08                 # afinación: bloques con croma (log) por encima de esta fracción del p95

# Acordes. Medidos con acordes sintéticos (tests/test_tonal.py): se probaron
# κ 4-25, permanencia 0.7-0.97 y peso del bajo 0-0.6; estos valores quedaron en
# el máximo o en su meseta.
CHORD_KAPPA = 10.0                  # nitidez de la preferencia por la plantilla que mejor encaja
CHORD_STAY = 0.9                    # probabilidad de mantener el acorde de un beat al siguiente
BASS_WEIGHT = 0.3                   # cuánto refuerza el bajo la fundamental
NO_CHORD_MARGIN = 0.3               # "sin acorde": encaje este margen por debajo del típico de la canción…
NO_CHORD_MIN = 0.5                  # …acotado a [MIN, MAX] (ver `_chords`)
NO_CHORD_MAX = 0.7
SILENT_DB = -25.0                   # energía armónica respecto al percentil 95: por debajo, silencio
MAX_SEGMENT_S = 1.0                 # tramos sin beats (silencios, intros libres) se trocean

# Tonalidad en el tiempo (ver `_key_track`) y modulaciones.
KEY_WINDOW_S = 4.0
KEY_KAPPA = 20.0
KEY_STAY = 0.995
KEY_MIN_REGION_S = 8.0
MODULATION_MIN_S = 12.0             # una modulación dura al menos una sección
MODULATION_MIN_GAIN = 0.1           # correlación que gana la tonalidad de un bloque frente a la vecina…
MODULATION_CONFUSABLE_GAIN = 0.25   # …y bastante más si es de las que se confunden (ver `_needed`)


# Temperley (2007), perfiles de Kostka-Payne. En la prueba con acordes sintéticos
# acertó las 8 tonalidades, igual que Albrecht-Shanahan; Krumhansl-Kessler y
# "edma" fallaron 1-2.
_PROFILE_MAJOR = np.array([0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400])
_PROFILE_MINOR = np.array([0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330])


@dataclass(frozen=True)
class Key:
    tonic: int                  # 0 = C … 11 = B
    mode: str                   # "major" | "minor"
    confidence: float           # [0,1] correlación del croma con el perfil de la tonalidad

    @property
    def label(self) -> str:
        return f"{NOTE_NAMES[self.tonic]} {self.mode}"


@dataclass(frozen=True)
class Modulation:
    t: float                    # desde cuándo suena en la tonalidad nueva
    key: Key
    semitones: int              # cuánto se mueve la tónica respecto a la anterior, en (-6, 6]


@dataclass(frozen=True)
class TonalResult:
    tuning_cents: float
    key: Key
    chords: list[tuple[float, str]]         # (inicio, etiqueta), contiguos desde 0
    chord_confidence: float                 # [0,1] cuánto explican los acordes la armonía
    harmonic_rhythm: float                  # cambios de acorde por compás, donde hay acordes
    section_keys: list[Key]
    modulations: list[Modulation]


# --------------------------- Espectro armónico y afinación ---------------------------

@dataclass(frozen=True)
class ConstantQ:
    """El CQT de la canción, calculado una vez: lo usan la armonía y la melodía."""
    magnitude: np.ndarray       # (N_BINS, fotogramas), float32
    harmonic: np.ndarray        # parte armónica (HPSS con HPSS_KERNEL): lo que dura en el tiempo


def constant_q(y: np.ndarray) -> ConstantQ:
    import librosa

    C = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=librosa.midi_to_hz(FMIN_MIDI), n_bins=N_BINS,
                           bins_per_octave=BINS_PER_OCTAVE)).astype(np.float32)
    H, _ = librosa.decompose.hpss(C, kernel_size=HPSS_KERNEL)
    return ConstantQ(magnitude=C, harmonic=H)


def _fold() -> tuple[np.ndarray, np.ndarray]:
    """Matriz CQT → croma y máscara del registro grave."""
    import librosa

    fold = librosa.filters.cq_to_chroma(N_BINS, bins_per_octave=BINS_PER_OCTAVE, n_chroma=12,
                                        fmin=librosa.midi_to_hz(FMIN_MIDI)).astype(np.float32)
    midi = FMIN_MIDI + np.arange(N_BINS) / (BINS_PER_OCTAVE / 12)
    return fold, (midi < BASS_SPLIT_MIDI)


def shift_cents(H: np.ndarray, cents: float) -> np.ndarray:
    """Desplaza el eje de frecuencia `cents` hacia abajo (compensa una grabación `cents` alta)."""
    bins = cents * BINS_PER_OCTAVE / 1200.0
    if abs(bins) < 1e-6:
        return H
    idx = np.arange(H.shape[0], dtype=np.float64) + bins
    lo = np.clip(np.floor(idx).astype(int), 0, H.shape[0] - 1)
    hi = np.clip(lo + 1, 0, H.shape[0] - 1)
    w = (idx - np.floor(idx)).astype(np.float32)[:, None]
    return H[lo] * (1 - w) + H[hi] * w


def _log(H: np.ndarray) -> np.ndarray:
    return np.log1p(LOG_GAIN * H / max(float(H.max()), 1e-12))


def _blocks(X: np.ndarray, frames: int) -> np.ndarray:
    n = X.shape[1] // frames
    if n == 0:
        return X.mean(axis=1, keepdims=True)
    return X[:, : n * frames].reshape(X.shape[0], n, frames).mean(axis=2)


def _chord_fit(treble: np.ndarray, templates: np.ndarray) -> float:
    energy = treble.sum(axis=0)
    voiced = energy > VOICED_RATIO * max(float(np.percentile(energy, 95)), 1e-12)
    if not voiced.any():
        return 0.0
    X = treble[:, voiced]
    X = X / np.maximum(np.linalg.norm(X, axis=0, keepdims=True), 1e-12)
    return float(np.mean((templates @ X).max(axis=0)))


def _estimate_tuning(H: np.ndarray, fold: np.ndarray, treble_mask: np.ndarray, templates: np.ndarray) -> float:
    frames = max(1, int(round(TUNING_BLOCK_S * SR / HOP)))

    def fit(cents: float) -> float:
        chroma = fold @ (_log(shift_cents(H, cents)) * treble_mask[:, None])
        return _chord_fit(_blocks(chroma, frames), templates)

    # Sin dar la vuelta en ±50: −52 cents y +48 son la misma afinación pero
    # nombran las notas un semitono distinto, y el nombre debe cuadrar con el
    # desplazamiento que se aplica después.
    coarse = np.arange(-50.0, 50.0 + 1e-9, TUNING_COARSE_CENTS)
    best = float(coarse[int(np.argmax([fit(c) for c in coarse]))])
    fine = np.clip(best + np.arange(-TUNING_COARSE_CENTS / 2, TUNING_COARSE_CENTS / 2 + 1e-9, TUNING_FINE_CENTS), -50.0, 50.0)
    return float(fine[int(np.argmax([fit(c) for c in fine]))])


# --------------------------- Tonalidad ---------------------------

def _profiles() -> np.ndarray:
    """(24, 12) perfiles centrados y normalizados, en el orden de KEY_LABELS."""
    rows = []
    for profile in (_PROFILE_MAJOR, _PROFILE_MINOR):
        for tonic in range(12):
            p = np.roll(profile, tonic)
            p = p - p.mean()
            rows.append(p / np.linalg.norm(p))
    return np.array(rows)


def _key_corr(chroma: np.ndarray, profiles: np.ndarray) -> np.ndarray:
    """Correlación de Pearson de cada columna de croma (12, n) con las 24 tonalidades → (24, n)."""
    c = chroma - chroma.mean(axis=0, keepdims=True)
    c = c / np.maximum(np.linalg.norm(c, axis=0, keepdims=True), 1e-12)
    return profiles @ c


def _key(index: int, corr: float) -> Key:
    return Key(tonic=int(index) % 12, mode=MODES[int(index) // 12], confidence=float(np.clip(corr, 0.0, 1.0)))


def _major_tonic(index: int) -> int:
    """Tónica de la tonalidad mayor con la misma armadura (La menor → Do)."""
    return index % 12 if index < 12 else (index % 12 + 3) % 12


def _key_track(K: np.ndarray, bounds: np.ndarray, profiles: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Tonalidad a lo largo de la canción: croma de una ventana de ±KEY_WINDOW_S
    alrededor de cada tramo y un Viterbi muy estable (una tonalidad no cambia por
    un compás que se apoya en la dominante)."""
    centers = (bounds[:-1] + bounds[1:]) / 2
    cum = np.concatenate([np.zeros((12, 1)), np.cumsum(K * np.diff(bounds), axis=1)], axis=1)
    lo = np.searchsorted(centers, centers - KEY_WINDOW_S)
    hi = np.searchsorted(centers, centers + KEY_WINDOW_S, side="right")
    corr = _key_corr(cum[:, hi] - cum[:, lo], profiles)
    return _viterbi(KEY_KAPPA * corr, KEY_STAY), corr


def _regions(path: np.ndarray, bounds: np.ndarray, min_s: float) -> list[list]:
    """Tramos [inicio, fin, tonalidad] de la pista. Los de menos de `min_s` se
    funden con su vecino más largo."""
    regions: list[list] = []
    for j, k in enumerate(path):
        if regions and regions[-1][2] == int(k):
            regions[-1][1] = float(bounds[j + 1])
        else:
            regions.append([float(bounds[j]), float(bounds[j + 1]), int(k)])
    while len(regions) > 1:
        i = min(range(len(regions)), key=lambda r: regions[r][1] - regions[r][0])
        if regions[i][1] - regions[i][0] >= min_s:
            break
        left = regions[i - 1] if i > 0 else None
        right = regions[i + 1] if i + 1 < len(regions) else None
        if right is None or (left is not None and left[1] - left[0] >= right[1] - right[0]):
            left[1] = regions[i][1]
        else:
            right[0] = regions[i][0]
        regions.pop(i)
        merged = [regions[0]]
        for r in regions[1:]:
            if r[2] == merged[-1][2]:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        regions = merged
    return regions


def _chroma_over(K: np.ndarray, bounds: np.ndarray, a: float, b: float) -> np.ndarray:
    inside = (bounds[:-1] < b) & (bounds[1:] > a)
    return (K[:, inside] * np.diff(bounds)[inside]).sum(axis=1, keepdims=True)


def _needed(k1: int, k2: int) -> float:
    """Evidencia exigida para separar dos tonalidades. Las que los perfiles confunden
    a menudo (a una quinta, o paralelas: Re mayor / Re menor, típico con acordes
    de quinta sin tercera) necesitan bastante más."""
    fifth = (_major_tonic(k1) - _major_tonic(k2)) % 12 in (5, 7)
    parallel = k1 % 12 == k2 % 12
    return MODULATION_CONFUSABLE_GAIN if fifth or parallel else MODULATION_MIN_GAIN


def _key_blocks(regions: list[list], K: np.ndarray, bounds: np.ndarray, profiles: np.ndarray) -> list[list]:
    """Bloques [inicio, fin, tonalidad] con armadura propia.

    Tramos contiguos con la misma armadura forman un bloque (Do mayor y La menor
    son las mismas notas: pasar de una a otra no es modular). Un bloque solo se
    queda si su tonalidad explica SU croma claramente mejor que la de cada vecino;
    si no, se funde con el vecino que mejor lo explica y se vuelve a mirar. Así un
    tramo que se apoya en la dominante (una estrofa sobre Sol en Do mayor) no pasa
    por modulación, y la ventana de la pista no deja un Sol fabricado entre un Do
    y un Re. Cambiar a una quinta exige más evidencia: es el error típico."""
    blocks: list[list] = []
    for a, b, k in regions:
        if blocks and _major_tonic(blocks[-1][2]) == _major_tonic(k):
            blocks[-1][1] = b
            blocks[-1][3][k] = blocks[-1][3].get(k, 0.0) + (b - a)
        else:
            blocks.append([a, b, k, {k: b - a}])
    for blk in blocks:
        blk[2] = max(blk[3], key=blk[3].get)

    while len(blocks) > 1:
        worst, worst_margin, target = None, 0.0, None
        for i, blk in enumerate(blocks):
            corr = _key_corr(_chroma_over(K, bounds, blk[0], blk[1]), profiles)[:, 0]
            neighbors = [n for n in (i - 1, i + 1) if 0 <= n < len(blocks)]
            margin = min(corr[blk[2]] - corr[blocks[n][2]] - _needed(blk[2], blocks[n][2]) for n in neighbors)
            if blk[1] - blk[0] < MODULATION_MIN_S:
                margin = min(margin, -1.0)
            if margin < worst_margin:
                worst, worst_margin = i, margin
                target = max(neighbors, key=lambda n: corr[blocks[n][2]])
        if worst is None:
            break
        src, dst = blocks[worst], blocks[target]
        dst[0], dst[1] = min(dst[0], src[0]), max(dst[1], src[1])
        blocks.pop(worst)
        merged = [blocks[0]]
        for blk in blocks[1:]:
            if _major_tonic(blk[2]) == _major_tonic(merged[-1][2]):
                merged[-1][1] = blk[1]
                for k, d in blk[3].items():
                    merged[-1][3][k] = merged[-1][3].get(k, 0.0) + d
                merged[-1][2] = max(merged[-1][3], key=merged[-1][3].get)
            else:
                merged.append(blk)
        blocks = merged
    return [[a, b, k] for a, b, k, _ in blocks]


def _modulations(blocks: list[list], K: np.ndarray, bounds: np.ndarray, profiles: np.ndarray) -> list[Modulation]:
    out = []
    for prev, cur in zip(blocks[:-1], blocks[1:]):
        semis = (cur[2] - prev[2]) % 12
        corr = float(_key_corr(_chroma_over(K, bounds, cur[0], cur[1]), profiles)[cur[2], 0])
        out.append(Modulation(t=cur[0], key=_key(cur[2], corr), semitones=int(semis - 12 if semis > 6 else semis)))
    return out


# --------------------------- Acordes ---------------------------

def _templates() -> tuple[np.ndarray, np.ndarray]:
    T, roots = [], []
    for third in (4, 3):                                  # mayores, menores (orden de CHORD_LABELS)
        for root in range(12):
            v = np.zeros(12, dtype=np.float32)
            v[[root, (root + third) % 12, (root + 7) % 12]] = 1.0
            T.append(v / np.linalg.norm(v))
            roots.append(root)
    return np.array(T), np.array(roots)


def _segments(beats: np.ndarray, duration: float) -> np.ndarray:
    """Límites de tramo: cada beat, y trozos de ≤ MAX_SEGMENT_S donde no hay beats."""
    marks = [0.0] + [float(b) for b in beats if 0.0 < b < duration] + [duration]
    out = [marks[0]]
    for a, b in zip(marks[:-1], marks[1:]):
        pieces = max(1, int(np.ceil((b - a) / MAX_SEGMENT_S - 1e-9)))
        out.extend(a + (b - a) * k / pieces for k in range(1, pieces + 1))
    return np.array(out)


def _sync(X: np.ndarray, bounds: np.ndarray) -> np.ndarray:
    hop = HOP / SR
    idx = np.clip(np.round(bounds / hop).astype(int), 0, X.shape[1])
    out = np.zeros((X.shape[0], len(bounds) - 1), dtype=np.float32)
    for j in range(len(bounds) - 1):
        a = min(idx[j], X.shape[1] - 1)
        b = max(a + 1, idx[j + 1])
        out[:, j] = X[:, a:b].mean(axis=1)
    return out


def _viterbi(log_emission: np.ndarray, stay: float) -> np.ndarray:
    n_states, n = log_emission.shape
    log_t = np.full((n_states, n_states), np.log((1.0 - stay) / (n_states - 1)))
    np.fill_diagonal(log_t, np.log(stay))
    score = log_emission[:, 0].copy()
    back = np.zeros((n_states, n), dtype=np.int32)
    cols = np.arange(n_states)
    for j in range(1, n):
        m = score[:, None] + log_t
        back[:, j] = np.argmax(m, axis=0)
        score = m[back[:, j], cols] + log_emission[:, j]
    path = np.empty(n, dtype=np.int32)
    path[-1] = int(np.argmax(score))
    for j in range(n - 1, 0, -1):
        path[j - 1] = back[path[j], j]
    return path


def _chords(T: np.ndarray, B: np.ndarray, energy_db: np.ndarray, bounds: np.ndarray, templates: np.ndarray,
            roots: np.ndarray) -> tuple[list[tuple[float, str]], float]:
    X = T / np.maximum(np.linalg.norm(T, axis=0, keepdims=True), 1e-12)
    Z = B / np.maximum(B.sum(axis=0, keepdims=True), 1e-12)
    fit = templates @ X                                               # (24, n) coseno con cada tríada
    silent = energy_db < SILENT_DB
    # "Sin acorde" cuando el mejor encaje queda muy por debajo del que tienen los
    # acordes de ESTA canción: una pieza limpia encaja a 0.9, un tema con voces
    # procesadas a 0.7, y un break de batería (bombo y caja tienen tono) medido a
    # 0.56 frente a 0.94 de los acordes de su canción.
    best = fit.max(axis=0)
    typical = float(np.median(best[~silent])) if (~silent).any() else 0.0
    threshold = float(np.clip(typical - NO_CHORD_MARGIN, NO_CHORD_MIN, NO_CHORD_MAX))
    score = fit + BASS_WEIGHT * Z[roots, :]
    no_chord = np.where(silent, 1e3, threshold + BASS_WEIGHT * Z.max(axis=0))
    path = _viterbi(CHORD_KAPPA * np.vstack([score, no_chord]), CHORD_STAY)

    chords: list[tuple[float, str]] = []
    fits, weights = [], []
    for j, state in enumerate(path):
        label = CHORD_LABELS[int(state)]
        if label != NO_CHORD:
            fits.append(float(fit[int(state), j]))
            weights.append(float(bounds[j + 1] - bounds[j]))
        if not chords or chords[-1][1] != label:
            chords.append((float(bounds[j]), label))
    confidence = float(np.average(fits, weights=weights)) if fits else 0.0
    return chords, confidence


def _harmonic_rhythm(chords: list[tuple[float, str]], duration: float, bar_s: float) -> float:
    voiced = 0.0
    changes = 0
    for i, (t, label) in enumerate(chords):
        end = chords[i + 1][0] if i + 1 < len(chords) else duration
        if label == NO_CHORD:
            continue
        voiced += end - t
        if i > 0 and chords[i - 1][1] != NO_CHORD:
            changes += 1
    bars = voiced / bar_s if bar_s > 0 else 0.0
    return float(changes / bars) if bars >= 1.0 else 0.0


# --------------------------- Punto de entrada ---------------------------

def analyze(spec: Spectral, beats: BeatResult, section_bounds: list[tuple[float, float]], duration: float,
            cq: ConstantQ | None = None) -> TonalResult:
    templates, roots = _templates()
    profiles = _profiles()
    fold, bass_mask = _fold()
    treble_mask = ~bass_mask

    H = (cq or constant_q(spec.y)).harmonic
    tuning = _estimate_tuning(H, fold, treble_mask.astype(np.float32), templates)
    Hs = shift_cents(H, tuning)
    L = _log(Hs)

    bounds = _segments(beats.beats, duration)
    T = _sync(fold @ (L * treble_mask[:, None]), bounds)
    B = _sync(fold @ (L * bass_mask[:, None]), bounds)
    linear = _sync(fold @ Hs, bounds).sum(axis=0)
    energy_db = 10.0 * np.log10(np.maximum(linear, 1e-20) / max(float(np.percentile(linear, 95)), 1e-20))
    chords, confidence = _chords(T, B, energy_db, bounds, templates, roots)
    rhythm = _harmonic_rhythm(chords, duration, (beats.meter or 4) * beats.beat_period_s)

    # Tonalidad: croma del tramo con el bajo a mitad de peso; los silencios no votan.
    K = (T + 0.5 * B) * (energy_db >= SILENT_DB)
    path, _ = _key_track(K, bounds, profiles)
    regions = _regions(path, bounds, KEY_MIN_REGION_S)
    blocks = _key_blocks(regions, K, bounds, profiles)

    def key_in(a: float, b: float) -> Key:
        """La tonalidad que más dura en [a, b), entre las de la armadura del bloque
        que más ocupa ese tramo (una estrofa en La menor dentro de un Do mayor
        conserva su modo; un tramo sobre la dominante fundido en su bloque, no)."""
        cover = np.zeros(12)
        for s0, s1, k in blocks:
            cover[_major_tonic(k)] += max(0.0, min(b, s1) - max(a, s0))
        signature = int(np.argmax(cover))
        durations = np.zeros(24)
        for s0, s1, k in regions:
            if _major_tonic(k) == signature:
                durations[k] += max(0.0, min(b, s1) - max(a, s0))
        k = int(np.argmax(durations)) if durations.sum() > 0 else next(bk for _, _, bk in blocks if _major_tonic(bk) == signature)
        chroma = _chroma_over(K, bounds, a, b)
        return _key(k, float(_key_corr(chroma, profiles)[k, 0]) if chroma.sum() > 0 else 0.0)

    # La global: la armadura que más dura y, dentro de ella, la tonalidad que más dura.
    by_signature = np.zeros(12)
    for s0, s1, k in blocks:
        by_signature[_major_tonic(k)] += s1 - s0
    main_blocks = [(s0, s1) for s0, s1, k in blocks if _major_tonic(k) == int(np.argmax(by_signature))]
    durations = np.zeros(24)
    for s0, s1, k in regions:
        for a, b in main_blocks:
            durations[k] += max(0.0, min(b, s1) - max(a, s0)) if _major_tonic(k) == int(np.argmax(by_signature)) else 0.0
    main = int(np.argmax(durations))
    key = _key(main, float(_key_corr((K * np.diff(bounds)).sum(axis=1, keepdims=True), profiles)[main, 0]))
    section_keys = [key_in(a, b) for a, b in section_bounds]

    return TonalResult(
        tuning_cents=tuning, key=key, chords=chords, chord_confidence=confidence, harmonic_rhythm=rhythm,
        section_keys=section_keys, modulations=_modulations(blocks, K, bounds, profiles),
    )
