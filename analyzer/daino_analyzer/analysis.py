"""Orquestador: audio decodificado → `analysis.json` (formato 2).

Formato 2 = formato 1 + hechos ricos. Los campos del 1 (`bpm`, `bpmConfidence`,
`beatPeriodS`, `onsets` como pares [t, fuerza]) se mantienen con el mismo
significado, así que el charter JS actual y el validador PHP los leen igual. Lo
nuevo va en campos aparte; un lector que no los conoce los ignora.

Analizador 2 (sin cambiar el formato: solo añade campos): `onsetPercussive`,
`energy.bands` y `energy.bandLevelDb`, `key`/`keyConfidence` en cada sección y el
bloque `tonal` (afinación, tonalidad, acordes, modulaciones). Todo lo que ya
existía sale idéntico, así que ningún chart cambia al reanalizar.

Determinista: mismo audio ⇒ mismo JSON (KMeans con semilla fija, inferencia en
CPU). Los números se redondean a la precisión que importa (1 ms en tiempos) para
que el JSON sea estable y compacto.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from daino_analyzer import ANALYSIS_FORMAT_VERSION, ANALYZER_NAME, ANALYZER_VERSION
from daino_analyzer import beats as beats_mod
from daino_analyzer import energy as energy_mod
from daino_analyzer import onsets as onsets_mod
from daino_analyzer import sections as sections_mod
from daino_analyzer import spectral
from daino_analyzer import tonal as tonal_mod
from daino_analyzer.decode import DecodedAudio

Progress = Callable[[str, float], None]

STRONG_EVENT = 0.5
EVENT = 0.2


def analyze(audio: DecodedAudio, progress: Progress | None = None) -> dict:
    report = progress or (lambda _stage, _ratio: None)
    mono = audio.mono
    duration = audio.duration_sec

    report("spectral", 0.02)
    spec = spectral.compute(mono, audio.sample_rate)
    envs = onsets_mod.envelopes(spec)

    report("beats", 0.10)
    beat = beats_mod.track(mono, spec, envs, audio.sample_rate)

    report("onsets", 0.70)
    onset_list = onsets_mod.detect(spec, envs)

    report("energy", 0.78)
    en = energy_mod.analyze(spec)

    report("sections", 0.84)
    secs = sections_mod.analyze(spec, beat, onset_list, en, duration)

    report("tonal", 0.88)
    ton = tonal_mod.analyze(spec, beat, [(s.start, s.end) for s in secs], duration)

    report("features", 0.97)
    audible_min = max(duration * (1.0 - en.silence_ratio), 1e-6) / 60.0

    result = {
        "formatVersion": ANALYSIS_FORMAT_VERSION,
        "analyzer": {"name": ANALYZER_NAME, "version": ANALYZER_VERSION, "models": {"beats": beat.model}},
        "durationSec": r3(duration),
        "sampleRate": audio.sample_rate,
        # --- Núcleo compatible con el formato 1 ---
        "bpm": r3(beat.bpm),
        "bpmConfidence": r3(beat.tempo_stability),
        "beatPeriodS": round(beat.beat_period_s, 5),
        "onsets": [[r3(o.t), r3(o.strength)] for o in onset_list if o.t <= duration],
        # --- Formato 2 ---
        "onsetColor": [[round(c, 2) for c in o.color] for o in onset_list if o.t <= duration],
        "onsetPercussive": [round(o.percussive, 2) for o in onset_list if o.t <= duration],
        "beats": [r3(t) for t in beat.beats if t <= duration],
        "downbeats": [r3(t) for t in beat.downbeats if t <= duration],
        "meter": beat.meter,
        "sections": [
            {"startSec": r3(s.start), "endSec": r3(s.end), "cluster": s.cluster, "role": s.role,
             "energy": r3(s.energy), "density": r3(s.density),
             "key": k.label, "keyConfidence": r3(k.confidence)}
            for s, k in zip(secs, ton.section_keys)
        ],
        "energy": {
            "hopSec": en.hop_sec,
            "values": [r3(v) for v in en.relative],
            "bands": {name: [round(float(v), 2) for v in curve] for name, curve in en.bands.items()},
            "bandLevelDb": [round(float(v), 1) for v in en.band_level_db],
        },
        "tonal": {
            "tuningCents": round(ton.tuning_cents, 1),
            "key": ton.key.label,
            "keyConfidence": r3(ton.key.confidence),
            "chords": [[r3(t), label] for t, label in ton.chords],
            "chordConfidence": r3(ton.chord_confidence),
            "harmonicRhythm": r3(ton.harmonic_rhythm),
            "modulations": [{"t": r3(m.t), "key": m.key.label, "semitones": m.semitones} for m in ton.modulations],
        },
        "features": {
            "tempoStability": r3(beat.tempo_stability),
            "beatSupport": r3(beat.beat_support),
            "pulseDoubled": bool(beat.level_doubled),
            "percussiveRatio": r3(en.percussive_ratio),
            "eventsPerMin": r3(sum(1 for o in onset_list if o.strength >= EVENT) / audible_min),
            "strongEventsPerMin": r3(sum(1 for o in onset_list if o.strength >= STRONG_EVENT) / audible_min),
            "loudnessDbfs": round(en.loudness_dbfs, 2),
            "dynamicRangeDb": round(en.dynamic_range_db, 2),
            "silenceRatio": r3(en.silence_ratio),
        },
    }
    report("done", 1.0)
    return result


def r3(v: float) -> float:
    return float(round(float(v), 3))


def np_default(o):  # pragma: no cover - ayuda para json.dumps en depuración
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(type(o))
