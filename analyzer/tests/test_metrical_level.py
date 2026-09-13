"""Nivel métrico: un único pulso coherente para toda la canción.

Se prueba la lógica sobre envolventes construidas a mano (sin el modelo): así
cada regla se ejercita de forma aislada y determinista.
"""

from __future__ import annotations

import numpy as np

from daino_analyzer.beats import _normalize_level, _stability
from daino_analyzer.onsets import Envelopes

HOP = 128 / 22050


def _envs(hits: np.ndarray, duration: float, strength: np.ndarray | None = None) -> Envelopes:
    env = np.zeros(int(duration / HOP) + 10, dtype=np.float32)
    strength = np.ones(len(hits)) if strength is None else strength
    for t, s in zip(hits, strength):
        env[int(round(t / HOP))] = max(env[int(round(t / HOP))], s)
    return Envelopes(full=env, band_flux=np.zeros((3, len(env)), dtype=np.float32), scale=1.0, hop_sec=HOP)


def test_song_whose_real_pulse_is_double_gets_densified():
    """El modelo marca 75 BPM casi toda la canción y 150 en un tramo; entre sus
    beats suena lo mismo que en ellos (medido así en una canción real)."""
    period = 0.8                                     # 75 BPM
    grid = np.arange(0.5, 40, period / 2)            # la música acentúa cada 0.4 s
    beats = np.concatenate([np.arange(0.5, 28, period), np.arange(28.1, 40, period / 2)])
    out, doubled = _normalize_level(beats, _envs(grid, 41))
    assert doubled, "la mayoría del modelo iba lento: hace falta doblar"
    ibi = np.diff(out)
    assert np.isclose(np.median(ibi), period / 2, atol=0.02)
    assert _stability(ibi) >= 0.95


def test_when_most_of_the_song_is_already_fast_the_slow_stretch_is_filled():
    period = 0.4
    grid = np.arange(0.5, 40, period)
    beats = np.concatenate([np.arange(0.5, 12, 2 * period), np.arange(12.1, 40, period)])
    out, doubled = _normalize_level(beats, _envs(grid, 41))
    assert not doubled
    assert np.isclose(np.median(np.diff(out)), period, atol=0.02)
    assert _stability(np.diff(out)) >= 0.95


def test_slow_song_is_not_doubled_and_stray_double_beats_are_removed():
    """Canción lenta de verdad: nada acentuado entre beats. Un tramo al doble es
    un error del modelo y se reduce conservando la fase."""
    period = 0.92                                    # 65 BPM
    true_beats = np.arange(0.5, 60, period)
    beats = list(true_beats[:30]) + list(np.arange(true_beats[30], true_beats[40], period / 2)) + list(true_beats[40:])
    out, doubled = _normalize_level(np.array(sorted(set(np.round(beats, 4)))), _envs(true_beats, 61))
    assert not doubled
    assert len(out) == len(true_beats)
    assert np.max(np.abs(out - true_beats)) < 1e-6, "conserva los beats reales, en fase"


def test_skipped_beats_are_filled_but_silences_are_not():
    period = 0.5
    true_beats = np.arange(1.0, 40, period)
    beats = np.delete(true_beats, [10, 25, 26])              # el modelo se saltó 3 beats
    silence = (true_beats > 20) & (true_beats < 30)           # 10 s de silencio: sin beats a propósito
    beats = np.array([b for b in beats if not (20 < b < 30)])
    hits = true_beats[~silence]
    out, doubled = _normalize_level(beats, _envs(hits, 41))
    assert not doubled
    for idx in (10, 25, 26):
        if not silence[idx]:
            assert np.min(np.abs(out - true_beats[idx])) < 1e-6, f"beat {idx} rellenado"
    assert not np.any((out > 20.3) & (out < 29.7)), "el silencio sigue sin beats"


def test_stability_ignores_silence_gaps():
    ibi = np.array([0.5] * 40 + [9.0] + [0.5] * 40)
    assert _stability(ibi) == 1.0
