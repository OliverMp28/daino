"""Validación del `analysis.json` de formato 2 antes de guardarlo.

Espejo de `ChartValidator::validateAnalysis` (PHP): lo que aquí pasa, allí pasa.
Un análisis que no cumple no se persiste — mejor un trabajo fallido y visible
que un nivel que se rompe al jugarlo.
"""

from __future__ import annotations

import math

MAX_DURATION_SEC = 7200
MAX_ONSETS = 60_000
MAX_BEATS = 30_000
MAX_SECTIONS = 200
MAX_ENERGY_VALUES = MAX_DURATION_SEC * 10 + 10
ROLES = {"intro", "verse", "chorus", "bridge", "break", "outro"}


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
    if secs:
        _require(abs(secs[-1]["endSec"] - duration) < 0.002, "las secciones cubren la canción")

    en = a.get("energy")
    _require(isinstance(en, dict) and _finite(en.get("hopSec")) and en["hopSec"] > 0, "energy.hopSec")
    vals = en.get("values")
    _require(isinstance(vals, list) and len(vals) <= MAX_ENERGY_VALUES and all(_finite(v) and 0 <= v <= 1 for v in vals), "energy.values en [0,1]")

    f = a.get("features")
    _require(isinstance(f, dict), "features")
    for key, lo, hi in (("tempoStability", 0, 1), ("beatSupport", 0, 1), ("percussiveRatio", 0, 1),
                        ("eventsPerMin", 0, 10000), ("strongEventsPerMin", 0, 10000),
                        ("loudnessDbfs", -200, 10), ("dynamicRangeDb", 0, 200), ("silenceRatio", 0, 1)):
        _require(_finite(f.get(key)) and lo <= f[key] <= hi, f"features.{key} en [{lo}, {hi}]")
    _require(isinstance(f.get("pulseDoubled"), bool), "features.pulseDoubled booleano")


def _num(a: dict, key: str, lo: float, hi: float) -> float:
    v = a.get(key)
    _require(_finite(v) and lo <= v <= hi, f"{key} fuera de rango")
    return float(v)


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _require(cond: bool, message: str) -> None:
    if not cond:
        raise SchemaError(message)
