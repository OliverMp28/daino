"""La canción con el análisis hecho audible, para comprobarlo de oído.

    docker compose run --rm -v ./storage/analysis-debug:/out analyzer \\
        sonify "/srv/daino/storage/official/HOPE.mp3" --out /out/hope.wav

- clic agudo y corto en cada beat;
- clic más grave y fuerte en cada downbeat (inicio de compás);
- tono largo al empezar cada sección.

Si los clics caen sobre los golpes y los tonos en los cambios de la canción, el
análisis es bueno. Es la verificación que las métricas no sustituyen.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from daino_analyzer import analysis, schema
from daino_analyzer.decode import decode_file


def _tone(freq: float, dur: float, sr: int, gain: float) -> np.ndarray:
    t = np.arange(int(dur * sr)) / sr
    return (gain * np.sin(2 * np.pi * freq * t) * np.exp(-t * (8 / dur))).astype(np.float32)


def sonify(file: Path, out: Path) -> int:
    audio = decode_file(file)
    a = analysis.analyze(audio)
    schema.validate(a)
    sr = audio.sample_rate
    mix = audio.samples.copy() * 0.6
    downs = set(a["downbeats"])
    beat, down, section = _tone(1800, 0.03, sr, 0.35), _tone(900, 0.06, sr, 0.6), _tone(330, 0.35, sr, 0.5)

    def add(sample: np.ndarray, t: float) -> None:
        i = int(round(t * sr))
        j = min(mix.shape[1], i + len(sample))
        if i < mix.shape[1]:
            mix[:, i:j] += sample[: j - i]

    for t in a["beats"]:
        add(down if t in downs else beat, t)
    for s in a["sections"][1:]:
        add(section, s["startSec"])

    pcm = (np.clip(mix, -1, 1).T * 32767).astype("<i2")
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    print(f"{out}: {a['bpm']:.1f} BPM, {len(a['beats'])} beats, {len(a['downbeats'])} downbeats, {len(a['sections'])} secciones")
    return 0
