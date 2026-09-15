"""Nombres musicales compartidos por el análisis y su validación (sin dependencias)."""

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MODES = ("major", "minor")

# Sintaxis de mir_eval / MIREX: "C# minor", "A:min", "N" (sin acorde).
KEY_LABELS = tuple(f"{n} {m}" for m in MODES for n in NOTE_NAMES)
CHORD_LABELS = tuple(f"{n}:{q}" for q in ("maj", "min") for n in NOTE_NAMES) + ("N",)
NO_CHORD = "N"
