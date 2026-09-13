"""Onsets: dónde empieza cada golpe o nota, con qué fuerza y con qué color.

- Flujo espectral "superflux" (Böck & Widmer, 2013) sobre el mel de 5.8 ms, en
  dB: la resta se hace contra el fotograma de hace `LAG` y con un filtro de
  máximo en frecuencia, lo que ignora vibratos y trémolos.
- Suelo ABSOLUTO de fuerza. Medido (unidades de flujo dB, percentil 99.5):
  golpes y notas reales 15-20; acorde sostenido con batidos 0.13; ruido de
  ambiente 0.74. Sin suelo, una canción sin golpes se normaliza contra su propio
  máximo y los batidos se vuelven cientos de onsets (el defecto D16 del
  analizador JS). Con suelo, un acorde sostenido de 10 s da 1 onset.
- Fecha sub-fotograma por interpolación parabólica y corrección de la latencia
  del detector, calibrada con audio de verdad conocida (tests/test_onsets.py).
- COLOR del ataque: qué fracción del flujo de ese golpe cae en graves, medios y
  agudos (suma 1). Es descriptivo, sin umbrales. Se intentó clasificar cada
  onset en "bombo / caja / charles" con umbrales y en mezclas reales las bandas
  se solapan demasiado: cada umbral arreglaba un caso y rompía otro. El reparto
  continuo es robusto y deja la decisión de juego al charter (Ola 5).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import maximum_filter1d

from daino_analyzer.spectral import Spectral

LAG = 2
MAX_SIZE = 3
FLOOR_DB = -80.0

# Suelo absoluto de la escala de la envolvente (flujo dB). Ver docstring.
ABS_FLOOR = 3.0

BANDS_HZ = {"low": (0.0, 150.0), "mid": (150.0, 3000.0), "high": (3000.0, 11025.0)}
BAND_NAMES = ("low", "mid", "high")

# Desfase entre el pico de la envolvente y el golpe real: el detector se ADELANTA.
# La ventana de 46 ms empieza a ver el golpe antes de centrarse en él, y en dB la
# subida es máxima en cuanto el borde de la ventana lo toca.
#
# Medido (sin corregir): golpes AISLADOS −11 a −13 ms según instrumento, igual
# tras silencio que sobre un colchón sostenido; en MEZCLAS (bombo, caja y
# charles coincidiendo o sonando sobre la cola del anterior) −8.4 a −7.5 ms en
# onsets y −9.3 ms en beats. La música real es mezcla, así que la constante se
# elige para ella: con −9 ms, beats a ~−0.3 ms y onsets a +0.6/+1.5 ms; un
# golpe aislado en silencio digital queda como mucho 5 ms adelantado.
# Las variantes con compresión log1p se adelantan menos pero su error varía 4 ms
# según el contexto: no hay constante que las corrija. Ver tests/test_onsets.py.
LATENCY_S = -0.009

PRE_MAX_S = 0.03
POST_MAX_S = 0.03
PRE_AVG_S = 0.10
POST_AVG_S = 0.07
WAIT_S = 0.03
DELTA = 0.06


@dataclass(frozen=True)
class Onset:
    t: float
    strength: float                       # [0, 1] en la escala de la canción (con suelo absoluto)
    color: tuple[float, float, float]     # reparto del flujo del ataque (grave, medio, agudo), suma 1


@dataclass(frozen=True)
class Envelopes:
    full: np.ndarray                      # normalizada
    band_flux: np.ndarray                 # (3, fotogramas) flujo dB medio dentro de cada banda
    scale: float                          # flujo dB que vale 1.0
    hop_sec: float


def log_mel_db(spec: Spectral) -> np.ndarray:
    ref = float(np.max(spec.mel)) if spec.mel.size else 1.0
    ref = ref if ref > 0 else 1.0
    return (10.0 * np.log10(np.maximum(spec.mel, ref * 10 ** (FLOOR_DB / 10)) / ref)).astype(np.float32)


def superflux(L: np.ndarray, lag: int = LAG, max_size: int = MAX_SIZE) -> np.ndarray:
    """Flujo por banda (bandas mel, fotogramas). El valor en k describe el cambio
    que TERMINA en el fotograma k (k-lag → k)."""
    ref = maximum_filter1d(L, size=max_size, axis=0) if max_size > 1 else L
    out = np.zeros_like(L)
    out[:, lag:] = np.maximum(0.0, L[:, lag:] - ref[:, :-lag])
    return out


def band_slices(spec: Spectral) -> dict[str, slice]:
    out = {}
    for name, (lo, hi) in BANDS_HZ.items():
        idx = np.flatnonzero((spec.mel_freqs >= lo) & (spec.mel_freqs < hi))
        out[name] = slice(int(idx[0]), int(idx[-1]) + 1)
    return out


def envelopes(spec: Spectral) -> Envelopes:
    F = superflux(log_mel_db(spec))
    full = F.mean(axis=0)
    scale = max(float(np.percentile(full, 99.5)) if full.size else 0.0, ABS_FLOOR)
    slices = band_slices(spec)
    band_flux = np.stack([F[slices[name]].mean(axis=0) for name in BAND_NAMES]).astype(np.float32)
    return Envelopes(full=np.clip(full / scale, 0.0, 1.5).astype(np.float32), band_flux=band_flux,
                     scale=scale, hop_sec=spec.hop_sec)


def detect(spec: Spectral, envs: Envelopes | None = None, *, delta: float = DELTA) -> list[Onset]:
    import librosa

    envs = envs or envelopes(spec)
    env = envs.full
    hop = envs.hop_sec
    fr = lambda s: max(1, int(round(s / hop)))  # noqa: E731
    peaks = librosa.util.peak_pick(
        env, pre_max=fr(PRE_MAX_S), post_max=fr(POST_MAX_S), pre_avg=fr(PRE_AVG_S),
        post_avg=fr(POST_AVG_S), delta=delta, wait=fr(WAIT_S),
    )
    out: list[Onset] = []
    for k in peaks:
        k = int(k)
        t = (k + _parabolic(env, k)) * hop - LATENCY_S
        if t < 0:
            continue
        lo, hi = max(0, k - 1), min(len(env), k + 2)
        flux = envs.band_flux[:, lo:hi].max(axis=1)
        total = float(flux.sum())
        color = tuple(float(v / total) for v in flux) if total > 1e-9 else (1 / 3, 1 / 3, 1 / 3)
        out.append(Onset(t=t, strength=float(min(1.0, env[k])), color=color))  # type: ignore[arg-type]
    return out


def _parabolic(env: np.ndarray, k: int) -> float:
    """Desplazamiento (-0.5..0.5 fotogramas) del vértice de la parábola por k-1, k, k+1."""
    if k <= 0 or k >= len(env) - 1:
        return 0.0
    a, b, c = float(env[k - 1]), float(env[k]), float(env[k + 1])
    denom = a - 2 * b + c
    if abs(denom) < 1e-12:
        return 0.0
    return float(np.clip(0.5 * (a - c) / denom, -0.5, 0.5))
