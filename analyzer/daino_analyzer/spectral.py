"""Representaciones espectrales compartidas, calculadas UNA vez por canción.

Todo el análisis parte de dos cosas:

- `mel`: espectrograma mel de potencia a 22.05 kHz con salto de 128 muestras
  (5.8 ms). Resolución temporal suficiente para fechar onsets y afinar beats con
  error de pocos milisegundos (con interpolación parabólica, por debajo de 2 ms).
- Una versión agregada a salto de 512 (23 ms) para lo que mira la forma de la
  canción: percusivo/armónico, timbre, secciones.

Se calcula por bloques de 30 s: el STFT completo de una canción de 20 min a esta
resolución ocuparía cientos de MB en memoria; los bloques mantienen el pico en
unos pocos MB por bloque y el resultado es idéntico (se solapan lo necesario).
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np
import soxr

SR = 22050
N_FFT = 1024
HOP = 128
N_MELS = 96
SLOW_FACTOR = 4                      # 128 * 4 = 512 muestras por fotograma lento
BLOCK_SEC = 30.0


@dataclass(frozen=True)
class Spectral:
    y: np.ndarray            # mono float32 a SR
    mel: np.ndarray          # (N_MELS, frames) potencia, float32
    mel_freqs: np.ndarray    # Hz de cada banda mel
    hop_sec: float

    @property
    def frames(self) -> int:
        return self.mel.shape[1]

    def frame_times(self) -> np.ndarray:
        # center=True: el fotograma k está centrado en k*HOP muestras.
        return np.arange(self.frames, dtype=np.float64) * self.hop_sec

    def slow_mel(self) -> np.ndarray:
        """Mel agregado a 23 ms (media por grupos de SLOW_FACTOR fotogramas)."""
        n = self.frames // SLOW_FACTOR
        return self.mel[:, : n * SLOW_FACTOR].reshape(N_MELS, n, SLOW_FACTOR).mean(axis=2)

    @property
    def slow_hop_sec(self) -> float:
        return self.hop_sec * SLOW_FACTOR


def compute(mono44: np.ndarray, sr_in: int = 44100) -> Spectral:
    # soxr compensa el retardo de su filtro: el remuestreo no desplaza nada.
    y = soxr.resample(mono44.astype(np.float32), sr_in, SR, quality="HQ").astype(np.float32)
    total = len(y)

    # Relleno de medio FFT a cada lado, como `center=True`: así el fotograma k
    # queda centrado exactamente en la muestra k*HOP de la señal original, y el
    # bloque [f0, f1) es el tramo padded[f0*HOP : (f1-1)*HOP + N_FFT] — sin
    # solapes que cuadrar ni diferencias en los bordes de bloque.
    padded = np.pad(y, (N_FFT // 2, N_FFT // 2))
    n_frames = 1 + total // HOP
    frames_per_block = int(BLOCK_SEC * SR) // HOP
    mel_basis = librosa.filters.mel(sr=SR, n_fft=N_FFT, n_mels=N_MELS).astype(np.float32)

    parts = []
    for f0 in range(0, n_frames, frames_per_block):
        f1 = min(n_frames, f0 + frames_per_block)
        seg = padded[f0 * HOP: (f1 - 1) * HOP + N_FFT]
        if len(seg) < (f1 - 1 - f0) * HOP + N_FFT:
            seg = np.pad(seg, (0, (f1 - 1 - f0) * HOP + N_FFT - len(seg)))
        S = np.abs(librosa.stft(seg, n_fft=N_FFT, hop_length=HOP, window="hann", center=False)) ** 2
        parts.append((mel_basis @ S[:, : f1 - f0]).astype(np.float32))

    mel = np.concatenate(parts, axis=1) if parts else np.zeros((N_MELS, 0), dtype=np.float32)
    freqs = librosa.mel_frequencies(n_mels=N_MELS, fmin=0.0, fmax=SR / 2)
    return Spectral(y=y, mel=mel, mel_freqs=freqs, hop_sec=HOP / SR)
