"""Música sintética con verdad conocida, para medir la calidad del analizador.

Con canciones reales no hay forma de saber dónde están "de verdad" los beats.
Aquí cada golpe se coloca en una muestra concreta, así que beats, downbeats,
onsets por instrumento y fronteras de sección se conocen exactamente y se pueden
comparar con las métricas estándar de MIR (`mir_eval`).

No pretende sonar bien: pretende parecerse a lo que el analizador encuentra en
música real — bombo con barrido de tono, caja con ruido y cuerpo, charles de
ruido agudo, bajo y acordes sostenidos que NO aportan onsets fuertes — para que
los tests no pasen solo con clics perfectos.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SR = 44100


@dataclass
class Section:
    bars: int
    drums: bool = True
    hats: bool = True
    gain: float = 1.0
    chord_root: float = 110.0   # Hz; cambia el timbre armónico entre secciones
    busy: bool = False          # semicorcheas de charles y bombo extra (más denso)


@dataclass
class Truth:
    beats: np.ndarray
    downbeats: np.ndarray
    kicks: np.ndarray
    snares: np.ndarray
    hats: np.ndarray
    section_starts: np.ndarray      # incluye 0 y el final
    duration: float
    bpm: float
    meter: int
    extra: dict = field(default_factory=dict)

    @property
    def drum_onsets(self) -> np.ndarray:
        return np.unique(np.concatenate([self.kicks, self.snares, self.hats]))


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def _kick(rng: np.random.Generator) -> np.ndarray:
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    freq = 50 + 90 * np.exp(-t * 30)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    env = np.exp(-t * 9)
    click = rng.standard_normal(n) * np.exp(-t * 400) * 0.3
    return (np.sin(phase) * env + click).astype(np.float32)


def _snare(rng: np.random.Generator) -> np.ndarray:
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n) * np.exp(-t * 22)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30)
    return (0.55 * noise + 0.6 * body).astype(np.float32)


def _hat(rng: np.random.Generator) -> np.ndarray:
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0.0)          # paso alto barato
    return (0.25 * noise * np.exp(-t * 90)).astype(np.float32)


def _place(buf: np.ndarray, sample: np.ndarray, at_sec: float, gain: float) -> None:
    i = int(round(at_sec * SR))
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sample))
    buf[i:j] += gain * sample[: j - i]


def make_song(bpm: float = 120.0, sections: list[Section] | None = None, meter: int = 4,
              intro_silence: float = 0.0, swing: float = 0.0, seed: int = 7,
              tempo_end_bpm: float | None = None) -> tuple[np.ndarray, Truth]:
    """Genera una canción mono float32 a 44.1 kHz y su verdad.

    `swing` retrasa las corcheas débiles del charles (0.0-0.33 de corchea).
    `tempo_end_bpm` hace un accelerando/ritardando lineal hasta ese tempo.
    """
    sections = sections or [Section(bars=8)]
    rng = _rng(seed)
    kick, snare, hat = _kick(rng), _snare(rng), _hat(rng)

    total_beats = sum(s.bars for s in sections) * meter
    bpm_end = tempo_end_bpm if tempo_end_bpm is not None else bpm

    # Instantes de beat con tempo que varía linealmente por beat.
    beat_times = [intro_silence]
    for k in range(total_beats):
        frac = k / max(1, total_beats - 1)
        cur = bpm + (bpm_end - bpm) * frac
        beat_times.append(beat_times[-1] + 60.0 / cur)
    beat_times = np.array(beat_times)
    duration = beat_times[-1] + 1.5
    buf = np.zeros(int(duration * SR), dtype=np.float32)

    kicks, snares, hats, downbeats, starts = [], [], [], [], []
    beat_idx = 0
    t_pad = np.arange(len(buf)) / SR
    for sec in sections:
        starts.append(beat_times[beat_idx])
        sec_start, sec_end_idx = beat_idx, beat_idx + sec.bars * meter
        # Acorde sostenido: energía armónica sin onsets de percusión.
        a = int(beat_times[sec_start] * SR)
        b = int(beat_times[sec_end_idx] * SR)
        tt = t_pad[a:b]
        pad = sum(np.sin(2 * np.pi * sec.chord_root * r * tt) for r in (1.0, 1.26, 1.5, 2.0)) / 4
        bass = np.sign(np.sin(2 * np.pi * sec.chord_root / 2 * tt)) * 0.25
        buf[a:b] += (0.08 * pad + 0.05 * bass).astype(np.float32) * sec.gain

        for bar in range(sec.bars):
            for beat in range(meter):
                t0 = beat_times[beat_idx]
                t1 = beat_times[beat_idx + 1]
                if beat == 0:
                    downbeats.append(t0)
                if sec.drums:
                    if beat == 0 or (meter == 4 and beat == 2):
                        _place(buf, kick, t0, 0.9 * sec.gain * (1.15 if beat == 0 else 1.0))
                        kicks.append(t0)
                    if (meter == 4 and beat in (1, 3)) or (meter == 3 and beat in (1, 2)):
                        _place(buf, snare, t0, 0.7 * sec.gain)
                        snares.append(t0)
                    if sec.busy and beat == 3 and meter == 4:
                        th = t0 + (t1 - t0) * 0.5
                        _place(buf, kick, th, 0.7 * sec.gain)
                        kicks.append(th)
                if sec.hats:
                    subdiv = 4 if sec.busy else 2
                    for s in range(subdiv):
                        offset = s / subdiv
                        if s % 2 == 1:
                            offset += swing / subdiv
                        th = t0 + (t1 - t0) * offset
                        _place(buf, hat, th, 0.6 * sec.gain * (1.0 if s == 0 else 0.7))
                        hats.append(th)
                beat_idx += 1
    starts.append(beat_times[beat_idx])

    buf /= max(1e-6, float(np.max(np.abs(buf)))) / 0.9
    truth = Truth(
        beats=beat_times[:-1],
        downbeats=np.array(downbeats),
        kicks=np.array(kicks),
        snares=np.array(snares),
        hats=np.array(hats),
        section_starts=np.array(starts[:-1] + [duration]),
        duration=duration,
        bpm=bpm,
        meter=meter,
    )
    return buf.astype(np.float32), truth


def pop_song(bpm: float = 118.0, seed: int = 3) -> tuple[np.ndarray, Truth]:
    """Intro tranquila, estrofa, estribillo denso y fuerte, puente sin batería, estribillo."""
    return make_song(bpm=bpm, seed=seed, intro_silence=1.0, sections=[
        Section(bars=4, drums=False, hats=True, gain=0.45, chord_root=98.0),
        Section(bars=8, drums=True, gain=0.7, chord_root=110.0),
        Section(bars=8, drums=True, gain=1.0, chord_root=146.8, busy=True),
        Section(bars=4, drums=False, hats=False, gain=0.5, chord_root=82.4),
        Section(bars=8, drums=True, gain=1.0, chord_root=146.8, busy=True),
    ])


def to_stereo(mono: np.ndarray) -> np.ndarray:
    return np.stack([mono, mono])


# --------------------------- Armonía: tonalidad, acordes y melodía ---------------------------
#
# Notas con armónicos (no senos puros): el croma de una nota real reparte energía
# en su quinta (3er armónico) y su tercera mayor (5º), y un detector que solo
# funcione con senos no sirve para música. Etiquetas con la sintaxis de mir_eval
# ("A:min", "C major") para medir con sus métricas estándar.

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 11)          # menor armónica: la sensible del V mayor


def pitch_class(name: str) -> int:
    return NOTE_NAMES.index(_FLATS.get(name, name))


def parse_chord(label: str) -> tuple[int, str]:
    """"Am" → (9, "min"), "F#" → (6, "maj"), "Bb" → (10, "maj"), "D5" → (2, "5") (quinta, sin tercera)."""
    if label.endswith("5"):
        return pitch_class(label[:-1]), "5"
    minor = label.endswith("m")
    return pitch_class(label[:-1] if minor else label), "min" if minor else "maj"


def hz(midi: float, cents: float = 0.0) -> float:
    return 440.0 * 2 ** ((midi - 69 + cents / 100.0) / 12)


def _note(freq: float, dur: float, *, rolloff: float = 0.62, decay: float = 1.2, attack: float = 0.004,
          release: float = 0.04, harmonics: int = 8) -> np.ndarray:
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    wave = np.zeros(n)
    for h in range(1, harmonics + 1):
        if freq * h < 9000:
            wave += rolloff ** (h - 1) * np.sin(2 * np.pi * freq * h * t)
    env = np.minimum(t / attack, 1.0) * np.exp(-t * decay)
    tail = t > dur
    env[tail] *= np.exp(-(t[tail] - dur) / (release / 4))
    return (wave * env).astype(np.float32)


@dataclass
class TonalSection:
    chords: list[str]                # un acorde por hueco: ["C", "G", "Am", "F"]; vacío = sin armonía
    beats_per_chord: int = 4
    repeats: int = 2
    key: str = "C major"
    drums: bool = True
    melody: bool = True
    gain: float = 1.0
    melody_grid: float = 0.5         # 0.25 = semicorcheas: notas fuera de la rejilla del charles


@dataclass
class TonalTruth:
    beats: np.ndarray
    downbeats: np.ndarray
    chords: list[tuple[float, float, str]]      # (inicio, fin, "A:min" | "N")
    key: str                                    # tonalidad global
    section_bounds: np.ndarray                  # inicio de cada sección y el final
    section_keys: list[str]
    melody_onsets: np.ndarray
    drum_onsets: np.ndarray
    duration: float
    bpm: float

    def chord_arrays(self) -> tuple[np.ndarray, list[str]]:
        return np.array([[a, b] for a, b, _ in self.chords]), [c for _, _, c in self.chords]


def tonal_song(sections: list[TonalSection], bpm: float = 110.0, key: str | None = None, tuning_cents: float = 0.0,
               seed: int = 5, intro_silence: float = 0.5, bass: bool = True, drum_gain: float = 1.0) -> tuple[np.ndarray, TonalTruth]:
    """Canción con progresión de acordes, bajo en la fundamental, melodía sobre la
    escala y batería, en 4/4. `tuning_cents` desafina TODO (una grabación no
    afinada a La 440). La tonalidad global es la de la primera sección salvo que
    se indique."""
    rng = _rng(seed)
    kick, snare, hat = _kick(rng), _snare(rng), _hat(rng)
    period = 60.0 / bpm
    total_beats = sum(len(s.chords or [""]) * s.beats_per_chord * s.repeats for s in sections)
    duration = intro_silence + total_beats * period + 1.5
    buf = np.zeros(int(duration * SR), dtype=np.float32)

    beats, downbeats, chords, melody, drums, bounds = [], [], [], [], [], []
    t = intro_silence
    for sec in sections:
        bounds.append(t)
        tonic = pitch_class(sec.key.split()[0])
        scale = MINOR_SCALE if sec.key.endswith("minor") else MAJOR_SCALE
        slots = (sec.chords or [None]) * sec.repeats
        for label in slots:
            start = t
            span = sec.beats_per_chord * period
            if label is None:
                chords.append((start, start + span, "N"))
            else:
                root, quality = parse_chord(label)
                chords.append((start, start + span, f"{NOTE_NAMES[root]}:{quality}"))
                third = 3 if quality == "min" else 4
                voicing = ((0, 0.55), (7, 0.45), (12, 0.35)) if quality == "5" else ((0, 0.55), (third, 0.45), (7, 0.45))
                for iv, gain in voicing:
                    midi = 48 + (root + iv) % 12 + (12 if (root + iv) % 12 < 5 else 0)     # voicing en la octava 3-4
                    _place(buf, _note(hz(midi, tuning_cents), span, decay=0.6, attack=0.012), start, 0.16 * gain * sec.gain)
                if bass:
                    for b in range(sec.beats_per_chord):
                        if b % 2 == 0:
                            _place(buf, _note(hz(36 + root, tuning_cents), period * 2 * 0.9, rolloff=0.5, decay=2.0),
                                   start + b * period, 0.22 * sec.gain)
                if sec.melody:
                    chord_tones = [(root + iv) % 12 for iv in ((0, 7) if quality == "5" else (0, third, 7))]
                    pos = 0.0
                    while pos < sec.beats_per_chord - 1e-9:
                        step = sec.melody_grid * (1 + int(rng.integers(0, int(round(1 / sec.melody_grid)))))
                        if pos + step > sec.beats_per_chord:
                            step = sec.beats_per_chord - pos
                        on_chord = rng.random() < 0.7 or pos == 0
                        pcl = int(rng.choice(chord_tones)) if on_chord else (tonic + int(rng.choice(scale))) % 12
                        at = start + pos * period
                        _place(buf, _note(hz(72 + pcl, tuning_cents), step * period * 0.95, rolloff=0.45, decay=3.0),
                               at, 0.2 * sec.gain)
                        melody.append(at)
                        pos += step
            for b in range(sec.beats_per_chord):
                bt = start + b * period
                beats.append(bt)
                if (len(beats) - 1) % 4 == 0:
                    downbeats.append(bt)
                if sec.drums:
                    g = drum_gain * sec.gain
                    if b % 4 in (0, 2):
                        _place(buf, kick, bt, 0.8 * g)
                        drums.append(bt)
                    if b % 4 in (1, 3):
                        _place(buf, snare, bt, 0.55 * g)
                        drums.append(bt)
                    for s in (0.0, 0.5):
                        _place(buf, hat, bt + s * period, 0.45 * g)
                        drums.append(bt + s * period)
            t = start + span
    bounds.append(duration)
    buf /= max(1e-6, float(np.max(np.abs(buf)))) / 0.9
    truth = TonalTruth(
        beats=np.array(beats), downbeats=np.array(downbeats), chords=chords,
        key=key or sections[0].key, section_bounds=np.array(bounds), section_keys=[s.key for s in sections],
        melody_onsets=np.array(melody), drum_onsets=np.unique(np.round(drums, 6)), duration=duration, bpm=bpm,
    )
    return buf.astype(np.float32), truth
