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
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

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
    audible = db[db > SILENCE_DBFS]
    if len(audible) == 0:
        rel = np.zeros_like(db)
        loud, dr = float(np.mean(db)), 0.0
    else:
        lo, hi = np.percentile(audible, 5), np.percentile(audible, 99)
        rel = np.clip((db - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
        loud = float(np.mean(audible))
        dr = float(np.percentile(audible, 95) - np.percentile(audible, 10))
    return EnergyResult(
        hop_sec=HOP_SEC,
        relative=rel.astype(np.float32),
        loudness_dbfs=loud,
        dynamic_range_db=dr,
        silence_ratio=float(np.mean(db <= SILENCE_DBFS)),
        percussive_ratio=_percussive_ratio(spec),
    )


def _percussive_ratio(spec: Spectral) -> float:
    import librosa

    M = spec.slow_mel()
    if M.shape[1] < 20:
        return 0.0
    H, P = librosa.decompose.hpss(M, kernel_size=(17, 9), power=2.0)
    total = float(H.sum() + P.sum())
    return float(P.sum() / total) if total > 0 else 0.0
