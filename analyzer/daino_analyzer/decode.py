"""Decodificación de audio con ffmpeg.

El reloj del juego corre sobre el audio que decodifica EL NAVEGADOR. Un chart
generado aquí solo va sincronizado si este decodificador produce las mismas
muestras en la misma posición. Medido (Sep 2026): el ffmpeg 7.1 de Debian 13 da
un PCM idéntico byte a byte al de ffmpeg 8.1, y este coincide muestra a muestra
con `decodeAudioData` de Chrome (misma longitud, desfase 0), en los 8 niveles
oficiales y en MP3 subidos por usuarios. Ambos recortan el encoder delay y el
padding del MP3.

Por eso NO se usa `librosa.load` para decodificar: según la versión delega en
soundfile o audioread y el recorte del encoder delay no está garantizado.
"""

from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44100
CHANNELS = 2


class DecodeError(Exception):
    """El archivo no es audio decodificable. Error permanente: reintentar no sirve."""


@dataclass(frozen=True)
class DecodedAudio:
    samples: np.ndarray  # float32, forma (canales, n)
    sample_rate: int

    @property
    def mono(self) -> np.ndarray:
        # Misma mezcla que el analizador JS (media de canales).
        return self.samples.mean(axis=0, dtype=np.float32)

    @property
    def duration_sec(self) -> float:
        return self.samples.shape[1] / self.sample_rate


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def decode_file(path: str | Path, *, max_duration_sec: float = 1200.0, timeout_sec: float = 180.0,
                ffmpeg: str = "ffmpeg") -> DecodedAudio:
    """Decodifica a PCM float32 estéreo a 44.1 kHz (el rate del AudioContext del juego).

    `-t` corta canciones absurdamente largas antes de reservar memoria por ellas
    (20 min estéreo = 420 MB en float32).
    """
    path = Path(path)
    if not path.is_file():
        raise DecodeError(f"No existe el archivo {path}")

    cmd = [
        ffmpeg, "-nostdin", "-v", "error", "-i", str(path),
        "-t", str(max_duration_sec + 1),
        "-f", "f32le", "-ac", str(CHANNELS), "-ar", str(SAMPLE_RATE), "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout_sec, check=False)
    except FileNotFoundError as exc:  # pragma: no cover - depende del entorno
        raise RuntimeError(f"No se encontró ffmpeg ({ffmpeg})") from exc
    except subprocess.TimeoutExpired as exc:
        raise DecodeError(f"ffmpeg tardó más de {timeout_sec:.0f} s en decodificar") from exc

    raw = proc.stdout
    if proc.returncode != 0 and len(raw) == 0:
        raise DecodeError(f"ffmpeg no pudo decodificar el archivo: {proc.stderr.decode(errors='replace').strip()[:300]}")

    usable = len(raw) - (len(raw) % (4 * CHANNELS))
    interleaved = np.frombuffer(raw[:usable], dtype="<f4")
    samples = interleaved.reshape(-1, CHANNELS).T.copy()
    if samples.shape[1] < SAMPLE_RATE:  # menos de 1 s
        raise DecodeError("El audio dura menos de un segundo o no contiene muestras")

    duration = samples.shape[1] / SAMPLE_RATE
    if duration > max_duration_sec:
        raise DecodeError(f"El audio dura más de {max_duration_sec / 60:.0f} minutos")
    return DecodedAudio(samples=samples, sample_rate=SAMPLE_RATE)
