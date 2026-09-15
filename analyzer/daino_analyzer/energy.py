"""Energía: cuánto "empuja" la canción a lo largo del tiempo.

- Curva a 10 Hz de sonoridad RELATIVA a la propia canción ([0,1] entre sus
  percentiles 5 y 99): la usa el charter para subir y bajar la intensidad por
  tramos, y es comparable entre canciones masterizadas a distinto volumen.
- Rasgos ABSOLUTOS (dBFS) de la canción entera: sonoridad media, rango dinámico
  y proporción de silencio. Sirven para calcular qué dificultades admite.
- Proporción percusiva por separación armónico/percusiva (HPSS) sobre el mel de
  23 ms: medido, sobre el STFT completo tardaba 42 s en una canción de 3:36; en
  bandas mel, una fracción de segundo con el mismo resultado a efectos de
  "¿cuánta batería tiene esto?".
- Curvas por BANDA (graves < 150 Hz, medios, agudos > 3 kHz) a 10 Hz, cada una
  relativa a sí misma igual que la global: dicen cuándo entra el bajo (un drop),
  cuándo se abre el brillo. `band_level_db` es el nivel de cada banda en la
  canción entera respecto a la mezcla: una banda casi vacía (a capela sin graves)
  tiene curva, pero su nivel avisa de que no pesa. En dB y no en cuota porque la
  potencia se concentra en los graves: en los 8 oficiales los agudos son el
  0.1-2 % de la energía (−30 a −17 dB) aunque charles y platillos se oyen.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from daino_analyzer.onsets import BAND_NAMES, band_slices
from daino_analyzer.spectral import SR, Spectral

HOP_SEC = 0.1
SILENCE_DBFS = -50.0


@dataclass(frozen=True)
class EnergyResult:
    hop_sec: float
    relative: np.ndarray          # [0,1] por fotograma de HOP_SEC
    loudness_dbfs: float          # media RMS de los tramos no silenciosos
    dynamic_range_db: float       # p95 - p10 de los tramos no silenciosos
    silence_ratio: float
    percussive_ratio: float       # [0,1]
    bands: dict[str, np.ndarray] | None = None     # "low"/"mid"/"high" → [0,1] por fotograma de HOP_SEC
    band_level_db: tuple[float, float, float] = (0.0, 0.0, 0.0)   # potencia de la banda / total, dB


def rms_dbfs(y: np.ndarray, sr: int = SR, hop_sec: float = HOP_SEC) -> np.ndarray:
    hop = int(round(hop_sec * sr))
    n = len(y) // hop
    if n == 0:
        return np.array([SILENCE_DBFS - 30.0])
    frames = y[: n * hop].reshape(n, hop).astype(np.float64)
    rms = np.sqrt(np.mean(frames ** 2, axis=1))
    return 20.0 * np.log10(np.maximum(rms, 1e-7))


def analyze(spec: Spectral) -> EnergyResult:
    db = rms_dbfs(spec.y)
    audible_mask = db > SILENCE_DBFS
    audible = db[audible_mask]
    if len(audible) == 0:
        rel = np.zeros_like(db)
        loud, dr = float(np.mean(db)), 0.0
    else:
        rel = _relative(db, audible_mask)
        loud = float(np.mean(audible))
        dr = float(np.percentile(audible, 95) - np.percentile(audible, 10))
    bands, levels = _bands(spec, len(db), audible_mask)
    return EnergyResult(
        hop_sec=HOP_SEC,
        relative=rel.astype(np.float32),
        loudness_dbfs=loud,
        dynamic_range_db=dr,
        silence_ratio=float(np.mean(db <= SILENCE_DBFS)),
        percussive_ratio=_percussive_ratio(spec),
        bands=bands,
        band_level_db=levels,
    )


def _relative(db: np.ndarray, audible_mask: np.ndarray) -> np.ndarray:
    """[0,1] entre los percentiles 5 y 99 de los fotogramas audibles."""
    if not audible_mask.any():
        return np.zeros_like(db, dtype=np.float32)
    lo, hi = np.percentile(db[audible_mask], 5), np.percentile(db[audible_mask], 99)
    return np.clip((db - lo) / max(hi - lo, 1e-6), 0.0, 1.0).astype(np.float32)


def _bands(spec: Spectral, n: int, audible_mask: np.ndarray) -> tuple[dict[str, np.ndarray], tuple[float, float, float]]:
    """Potencia mel de cada banda agregada a fotogramas de HOP_SEC (los mismos que
    la curva global), en dB y relativa a sí misma."""
    frame = np.floor(spec.frame_times() / HOP_SEC).astype(int)
    keep = frame < n
    frame = frame[keep]
    counts = np.maximum(np.bincount(frame, minlength=n), 1)
    slices = band_slices(spec)
    power, curves = [], {}
    for name in BAND_NAMES:
        p = np.bincount(frame, weights=spec.mel[slices[name]].sum(axis=0)[keep], minlength=n) / counts
        power.append(float(p.sum()))
        curves[name] = _relative(10.0 * np.log10(np.maximum(p, 1e-12)), audible_mask)
    total = sum(power)
    levels = tuple(10.0 * np.log10(max(v, total * 1e-12) / total) for v in power) if total > 0 else (0.0, 0.0, 0.0)
    return curves, levels  # type: ignore[return-value]


def _percussive_ratio(spec: Spectral) -> float:
    import librosa

    M = spec.slow_mel()
    if M.shape[1] < 20:
        return 0.0
    H, P = librosa.decompose.hpss(M, kernel_size=(17, 9), power=2.0)
    total = float(H.sum() + P.sum())
    return float(P.sum() / total) if total > 0 else 0.0
