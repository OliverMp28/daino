"""Validación del `analysis.json` de formato 2 antes de guardarlo.

Espejo de `ChartValidator::validateAnalysis` (PHP): lo que aquí pasa, allí pasa.
Un análisis que no cumple no se persiste — mejor un trabajo fallido y visible
que un nivel que se rompe al jugarlo.
"""

from __future__ import annotations

import math

from daino_analyzer.music import CHORD_LABELS, KEY_LABELS

MAX_DURATION_SEC = 7200
MAX_ONSETS = 60_000
MAX_BEATS = 30_000
MAX_SECTIONS = 200
MAX_ENERGY_VALUES = MAX_DURATION_SEC * 10 + 10
ROLES = {"intro", "verse", "chorus", "bridge", "break", "outro"}
MAX_CHORDS = 40_000
MAX_MODULATIONS = 200
BAND_NAMES = ("low", "mid", "high")
MELODY_HOP_RANGE = (0.01, 1.0)
MELODY_MIDI_RANGE = (24.0, 108.0)
KEYS = set(KEY_LABELS)
CHORDS = set(CHORD_LABELS)


class SchemaError(ValueError):
    pass


def validate(a: dict) -> None:
    _require(isinstance(a, dict), "el análisis no es un objeto")
    _require(a.get("formatVersion") == 2, "formatVersion debe ser 2")
    an = a.get("analyzer")
    _require(isinstance(an, dict) and isinstance(an.get("name"), str) and isinstance(an.get("version"), int), "analyzer inválido")

    duration = _num(a, "durationSec", 0.001, MAX_DURATION_SEC)
    _num(a, "sampleRate", 8000, 192000)
    _num(a, "bpm", 20, 400)
    _num(a, "bpmConfidence", 0, 1)
    _num(a, "beatPeriodS", 0.1, 3)

    onsets = a.get("onsets")
    _require(isinstance(onsets, list) and len(onsets) <= MAX_ONSETS, "onsets debe ser una lista acotada")
    prev = -1.0
    for o in onsets:
        _require(isinstance(o, list) and len(o) == 2, "cada onset es [t, fuerza]")
        t, s = o
        _require(_finite(t) and 0 <= t <= duration and t >= prev, "onsets ordenados y dentro de la canción")
        _require(_finite(s) and 0 <= s <= 1, "fuerza de onset en [0,1]")
        prev = t

    colors = a.get("onsetColor")
    _require(isinstance(colors, list) and len(colors) == len(onsets), "onsetColor paralelo a onsets")
    for c in colors:
        _require(isinstance(c, list) and len(c) == 3 and all(_finite(x) and 0 <= x <= 1 for x in c), "color [grave, medio, agudo] en [0,1]")

    perc = a.get("onsetPercussive")
    _require(isinstance(perc, list) and len(perc) == len(onsets), "onsetPercussive paralelo a onsets")
    _require(all(_finite(x) and 0 <= x <= 1 for x in perc), "percusividad de onset en [0,1]")

    for key in ("beats", "downbeats"):
        arr = a.get(key)
        _require(isinstance(arr, list) and len(arr) <= MAX_BEATS, f"{key} debe ser una lista acotada")
        _require(all(_finite(t) and 0 <= t <= duration for t in arr), f"{key} dentro de la canción")
        _require(all(arr[i] < arr[i + 1] for i in range(len(arr) - 1)), f"{key} estrictamente crecientes")
    _require(set(a["downbeats"]) <= set(a["beats"]), "todo downbeat es un beat")
    _require(a.get("meter") is None or (isinstance(a["meter"], int) and 2 <= a["meter"] <= 12), "meter nulo o entre 2 y 12")

    secs = a.get("sections")
    _require(isinstance(secs, list) and len(secs) <= MAX_SECTIONS, "sections debe ser una lista acotada")
    expected_start = 0.0
    for s in secs:
        _require(isinstance(s, dict), "sección no es un objeto")
        start, end = s.get("startSec"), s.get("endSec")
        _require(_finite(start) and _finite(end) and start < end <= duration + 0.001, "sección con límites válidos")
        _require(abs(start - expected_start) < 0.002, "secciones contiguas desde 0")
        expected_start = end
        _require(isinstance(s.get("cluster"), str) and len(s["cluster"]) <= 2, "cluster de sección")
        _require(s.get("role") in ROLES, "rol de sección conocido")
        _require(_finite(s.get("energy")) and 0 <= s["energy"] <= 1, "energía de sección en [0,1]")
        _require(_finite(s.get("density")) and s["density"] >= 0, "densidad de sección ≥ 0")
        _require(s.get("key") in KEYS, "tonalidad de sección conocida")
        _require(_finite(s.get("keyConfidence")) and 0 <= s["keyConfidence"] <= 1, "confianza de tonalidad de sección en [0,1]")
    if secs:
        _require(abs(secs[-1]["endSec"] - duration) < 0.002, "las secciones cubren la canción")

    en = a.get("energy")
    _require(isinstance(en, dict) and _finite(en.get("hopSec")) and en["hopSec"] > 0, "energy.hopSec")
    vals = en.get("values")
    _require(isinstance(vals, list) and len(vals) <= MAX_ENERGY_VALUES and all(_finite(v) and 0 <= v <= 1 for v in vals), "energy.values en [0,1]")
    bands = en.get("bands")
    _require(isinstance(bands, dict) and set(bands) == set(BAND_NAMES), "energy.bands con low, mid y high")
    for name in BAND_NAMES:
        curve = bands[name]
        _require(isinstance(curve, list) and len(curve) == len(vals) and all(_finite(v) and 0 <= v <= 1 for v in curve),
                 f"energy.bands.{name} paralela a energy.values y en [0,1]")
    levels = en.get("bandLevelDb")
    # La banda más fuerte tiene al menos un tercio de la potencia (−4.8 dB).
    _require(isinstance(levels, list) and len(levels) == 3 and all(_finite(v) and -120 <= v <= 0 for v in levels)
             and max(levels) >= -5.0, "energy.bandLevelDb: 3 niveles en dB respecto a la mezcla")

    _validate_tonal(a.get("tonal"), duration)
    # Analizador 3: opcional (los análisis de las versiones 1 y 2 no lo tienen).
    if "melody" in a:
        _validate_melody(a["melody"], duration)

    f = a.get("features")
    _require(isinstance(f, dict), "features")
    for key, lo, hi in (("tempoStability", 0, 1), ("beatSupport", 0, 1), ("percussiveRatio", 0, 1),
                        ("eventsPerMin", 0, 10000), ("strongEventsPerMin", 0, 10000),
                        ("loudnessDbfs", -200, 10), ("dynamicRangeDb", 0, 200), ("silenceRatio", 0, 1)):
        _require(_finite(f.get(key)) and lo <= f[key] <= hi, f"features.{key} en [{lo}, {hi}]")
    _require(isinstance(f.get("pulseDoubled"), bool), "features.pulseDoubled booleano")


def _validate_tonal(ton, duration: float) -> None:
    _require(isinstance(ton, dict), "tonal")
    _require(_finite(ton.get("tuningCents")) and -50 <= ton["tuningCents"] <= 50, "tonal.tuningCents en [-50, 50]")
    _require(ton.get("key") in KEYS, "tonal.key conocida")
    for key in ("keyConfidence", "chordConfidence"):
        _require(_finite(ton.get(key)) and 0 <= ton[key] <= 1, f"tonal.{key} en [0,1]")
    _require(_finite(ton.get("harmonicRhythm")) and 0 <= ton["harmonicRhythm"] <= 64, "tonal.harmonicRhythm en [0, 64]")

    chords = ton.get("chords")
    _require(isinstance(chords, list) and 1 <= len(chords) <= MAX_CHORDS, "tonal.chords: lista acotada y no vacía")
    prev_t, prev_label = -1.0, None
    for c in chords:
        _require(isinstance(c, list) and len(c) == 2, "cada acorde es [t, etiqueta]")
        t, label = c
        _require(_finite(t) and prev_t < t <= duration, "acordes estrictamente crecientes y dentro de la canción")
        _require(label in CHORDS and label != prev_label, "etiqueta de acorde conocida y distinta de la anterior")
        prev_t, prev_label = t, label
    _require(chords[0][0] == 0, "los acordes empiezan en 0")

    mods = ton.get("modulations")
    _require(isinstance(mods, list) and len(mods) <= MAX_MODULATIONS, "tonal.modulations: lista acotada")
    prev_t = 0.0
    for m in mods:
        _require(isinstance(m, dict), "modulación no es un objeto")
        _require(_finite(m.get("t")) and prev_t < m["t"] <= duration, "modulaciones crecientes y dentro de la canción")
        _require(m.get("key") in KEYS, "tonalidad de la modulación conocida")
        s = m.get("semitones")
        _require(isinstance(s, int) and not isinstance(s, bool) and -5 <= s <= 6, "semitones entero en [-5, 6]")
        prev_t = m["t"]


def _validate_melody(mel, duration: float) -> None:
    _require(isinstance(mel, dict), "melody")
    hop = mel.get("hopSec")
    _require(_finite(hop) and MELODY_HOP_RANGE[0] <= hop <= MELODY_HOP_RANGE[1], "melody.hopSec en rango")
    pitch = mel.get("pitch")
    _require(isinstance(pitch, list) and len(pitch) <= math.ceil(duration / hop) + 1, "melody.pitch: un valor por fotograma de la canción")
    _require(all(_finite(p) and (p == 0 or MELODY_MIDI_RANGE[0] <= p <= MELODY_MIDI_RANGE[1]) for p in pitch),
             f"melody.pitch: 0 o una altura MIDI en {MELODY_MIDI_RANGE}")
    _require(_finite(mel.get("voicedRatio")) and 0 <= mel["voicedRatio"] <= 1, "melody.voicedRatio en [0,1]")


def _num(a: dict, key: str, lo: float, hi: float) -> float:
    v = a.get(key)
    _require(_finite(v) and lo <= v <= hi, f"{key} fuera de rango")
    return float(v)


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise SchemaError(message)
