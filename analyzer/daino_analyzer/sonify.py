"""La canción con el análisis hecho audible, para comprobarlo de oído.

    docker compose run --rm -v ./storage/analysis-debug:/out analyzer \\
        sonify "/srv/daino/storage/official/HOPE.mp3" --out /out/hope.wav

- clic agudo y corto en cada beat;
- clic más grave y fuerte en cada downbeat (inicio de compás);
- tono largo al empezar cada sección;
- con `--chords`, cada acorde detectado sonando debajo (fundamental grave y
  tríada suave). Si el acorde acompaña a la canción, está bien; si choca, no.
- con `--melody` (analizador 3), un seno que sigue la melodía detectada. Si canta
  con la voz (o en su octava), está bien; si va por su cuenta, no.

Si los clics caen sobre los golpes, los tonos en los cambios de la canción y los
acordes no desafinan, el análisis es bueno. Es la verificación que las métricas
no sustituyen. La afinación detectada se aplica a los acordes: una canción a
432 Hz no sonará "desafinada" contra ellos por error nuestro.
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


def _chord_pad(root: int, quality: str, dur: float, sr: int, cents: float) -> np.ndarray:
    n = int(dur * sr)
    t = np.arange(n) / sr
    env = np.minimum(1.0, t / 0.03) * np.minimum(1.0, (dur - t) / 0.08).clip(0, 1)
    third = 3 if quality == "min" else 4
    out = np.zeros(n, dtype=np.float32)
    for midi, gain in ((36 + root, 0.22), (60 + root, 0.08), (60 + root + third, 0.07), (60 + root + 7, 0.07)):
        f = 440.0 * 2 ** ((midi - 69 + cents / 100.0) / 12)
        out += (gain * np.sin(2 * np.pi * f * t)).astype(np.float32)
    return out * env.astype(np.float32)


def _melody_line(pitch: list[float], hop: float, n: int, sr: int, cents: float) -> np.ndarray:
    """Un seno que sigue la altura de la melodía, con fundido en cada entrada y salida."""
    t_frame = np.arange(len(pitch)) * hop
    times = np.arange(n) / sr
    midi = np.interp(times, t_frame, np.asarray(pitch, dtype=np.float64))
    voiced = np.interp(times, t_frame, (np.asarray(pitch) > 0).astype(np.float64))
    freq = 440.0 * 2 ** ((np.where(midi > 0, midi, 60) - 69 + cents / 100.0) / 12)
    phase = 2 * np.pi * np.cumsum(freq) / sr
    return (0.12 * voiced * np.sin(phase)).astype(np.float32)


def sonify(file: Path, out: Path, chords: bool = False, melody: bool = False) -> int:
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
    if chords:
        from daino_analyzer.music import NOTE_NAMES

        ton = a["tonal"]
        for i, (t0, label) in enumerate(ton["chords"]):
            if label == "N":
                continue
            end = ton["chords"][i + 1][0] if i + 1 < len(ton["chords"]) else a["durationSec"]
            name, quality = label.split(":")
            add(_chord_pad(NOTE_NAMES.index(name), quality, end - t0, sr, ton["tuningCents"]), t0)

    if melody and "melody" in a:
        line = _melody_line(a["melody"]["pitch"], a["melody"]["hopSec"], mix.shape[1], sr, a["tonal"]["tuningCents"])
        mix += line[None, :]

    pcm = (np.clip(mix, -1, 1).T * 32767).astype("<i2")
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    print(f"{out}: {a['bpm']:.1f} BPM, {len(a['beats'])} beats, {len(a['downbeats'])} downbeats, {len(a['sections'])} secciones, "
          f"{a['tonal']['key']}, {len(a['tonal']['chords'])} acordes")
    return 0
