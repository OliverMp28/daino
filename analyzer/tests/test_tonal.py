"""Tonalidad, acordes y modulaciones contra armonía sintética de verdad conocida.

Los beats son los de la verdad: aquí se mide la armonía, no el seguimiento del
pulso (eso lo mide test_beats.py; la integración con beats seguidos está en
test_analysis.py). Métricas estándar de mir_eval: acierto de acordes ponderado
por duración con el vocabulario mayor/menor, y puntuación de tonalidad.
"""

from __future__ import annotations

import mir_eval
import numpy as np
import pytest

from daino_analyzer import spectral, tonal
from daino_analyzer.beats import BeatResult
from daino_analyzer.music import CHORD_LABELS, KEY_LABELS
from tests import synth
from tests.synth import TonalSection as S


def _beats(truth: synth.TonalTruth) -> BeatResult:
    period = 60.0 / truth.bpm
    return BeatResult(beats=truth.beats, downbeats=truth.downbeats, meter=4, bpm=truth.bpm, beat_period_s=period,
                      tempo_stability=1.0, beat_support=1.0, model="verdad")


def run(song, sections: list[tuple[float, float]] | None = None, gain: float = 1.0) -> tuple[tonal.TonalResult, synth.TonalTruth]:
    y, truth = song
    spec = spectral.compute(y * gain)
    bounds = sections if sections is not None else [(0.0, truth.duration)]
    return tonal.analyze(spec, _beats(truth), bounds, truth.duration), truth


def chord_accuracy(truth: synth.TonalTruth, chords: list[tuple[float, str]], duration: float) -> float:
    ref_i, ref_l = truth.chord_arrays()
    est_i = np.array([[t, chords[i + 1][0] if i + 1 < len(chords) else duration] for i, (t, _) in enumerate(chords)])
    est_l = [label for _, label in chords]
    est_i, est_l = mir_eval.util.adjust_intervals(est_i, est_l, ref_i.min(), ref_i.max(), "N", "N")
    iv, rl, el = mir_eval.util.merge_labeled_intervals(ref_i, ref_l, est_i, est_l)
    return float(mir_eval.chord.weighted_accuracy(mir_eval.chord.majmin(rl, el), mir_eval.util.intervals_to_durations(iv)))


def no_chord_share(chords: list[tuple[float, str]], a: float, b: float, duration: float) -> float:
    covered = 0.0
    for i, (t, label) in enumerate(chords):
        end = chords[i + 1][0] if i + 1 < len(chords) else duration
        if label == "N":
            covered += max(0.0, min(b, end) - max(a, t))
    return covered / (b - a)


SONGS = {
    "C mayor I-V-vi-IV": dict(sections=[S(["C", "G", "Am", "F"], key="C major", repeats=3)], bpm=110),
    "F# mayor I-IV-V-I": dict(sections=[S(["F#", "B", "C#", "F#"], key="F# major", repeats=3)], bpm=96, seed=2),
    "La menor i-iv-V-i": dict(sections=[S(["Am", "Dm", "E", "Am"], key="A minor", repeats=3)], bpm=120, seed=3),
    "Re# menor i-VI-iv-V": dict(sections=[S(["D#m", "B", "G#m", "A#"], key="D# minor", repeats=3)], bpm=84, seed=4),
    "Sib mayor con batería fuerte": dict(sections=[S(["Bb", "Gm", "Eb", "F"], key="A# major", repeats=3)], bpm=140,
                                         drum_gain=3.0, seed=8),
}


@pytest.fixture(scope="module")
def results():
    return {name: run(synth.tonal_song(**kw)) for name, kw in SONGS.items()}


@pytest.mark.parametrize("name", list(SONGS))
def test_key_is_exact(results, name):
    res, truth = results[name]
    assert res.key.label == truth.key, f"{name}: {res.key.label} (verdad {truth.key})"
    assert res.key.confidence >= 0.8
    assert res.key.label in KEY_LABELS


@pytest.mark.parametrize("name", list(SONGS))
def test_chords_match_the_progression(results, name):
    res, truth = results[name]
    acc = chord_accuracy(truth, res.chords, truth.duration)
    assert acc >= 0.95, f"{name}: acierto {acc:.3f}"
    assert res.chord_confidence >= 0.85
    assert all(label in CHORD_LABELS for _, label in res.chords)
    assert res.modulations == []


def test_chord_changes_fall_on_beats(results):
    """Donde hay pulso, un acorde cambia en un beat. Fuera de él (antes del primero
    y tras el último, la cola que suena después) los tramos se trocean."""
    for res, truth in results.values():
        beat_set = set(np.round(truth.beats, 6))
        inside = [t for t, _ in res.chords[1:] if truth.beats[0] < t < truth.beats[-1]]
        assert len(inside) >= 8
        for t in inside:
            assert round(t, 6) in beat_set, f"acorde que empieza fuera de un beat: {t}"


def test_harmonic_rhythm_counts_changes_per_bar():
    one_bar, _ = run(synth.tonal_song([S(["C", "G", "Am", "F"], key="C major", repeats=3)], bpm=110, seed=31))
    two_beats, truth = run(synth.tonal_song([S(["D", "Bm", "Em", "A"], beats_per_chord=2, key="D major", repeats=4)],
                                            bpm=100, seed=6))
    assert 0.6 <= one_bar.harmonic_rhythm <= 1.1, one_bar.harmonic_rhythm
    assert 1.4 <= two_beats.harmonic_rhythm <= 2.1, two_beats.harmonic_rhythm
    assert chord_accuracy(truth, two_beats.chords, truth.duration) >= 0.85


@pytest.mark.parametrize("cents", [35.0, -30.0, -45.0])
def test_detuned_recording_keeps_key_and_chords(cents):
    """Una grabación desafinada (432 Hz son −32 cents) no debe salir un semitono
    corrida. El estimador busca el desplazamiento que mejor explica la armonía."""
    res, truth = run(synth.tonal_song([S(["G", "Em", "C", "D"], key="G major", repeats=3)], bpm=128,
                                      tuning_cents=cents, seed=7))
    assert abs(res.tuning_cents - cents) <= 12.0, f"afinación {res.tuning_cents:+.1f} (verdad {cents:+.0f})"
    assert res.key.label == "G major"
    assert chord_accuracy(truth, res.chords, truth.duration) >= 0.95


def test_drum_break_has_no_chord():
    """Bombo y caja tienen tono: sin cuidado, un break de batería sale con acordes."""
    res, truth = run(synth.tonal_song([S(["Em", "C", "G", "B"], key="E minor", repeats=2),
                                       S([], key="E minor", repeats=2, melody=False),
                                       S(["Em", "C", "G", "B"], key="E minor", repeats=2)], bpm=115, seed=9))
    a, b = truth.section_bounds[1], truth.section_bounds[2]
    assert no_chord_share(res.chords, a, b, truth.duration) >= 0.8
    assert chord_accuracy(truth, res.chords, truth.duration) >= 0.95
    assert res.key.label == "E minor"


def test_silence_has_no_chord():
    res, truth = run(synth.tonal_song([S(["A", "D", "E", "A"], key="A major", repeats=2)], bpm=100, intro_silence=4.0, seed=32))
    assert no_chord_share(res.chords, 0.0, 3.5, truth.duration) >= 0.95
    assert res.chords[0] == (0.0, "N")


def test_volume_does_not_change_anything():
    song = synth.tonal_song([S(["Am", "F", "C", "G"], key="A minor", repeats=2)], bpm=105, seed=33)
    loud, _ = run(song)
    quiet, _ = run(song, gain=0.05)
    assert loud.chords == quiet.chords
    assert loud.key.label == quiet.key.label
    assert loud.tuning_cents == quiet.tuning_cents


MODULATING = {
    "Do → Re (+2)": (dict(sections=[S(["C", "G", "Am", "F"], key="C major", repeats=3),
                                    S(["F", "C", "G", "G"], key="C major", repeats=2),
                                    S(["D", "A", "Bm", "G"], key="D major", repeats=3)], bpm=120, key="C major", seed=14),
                     "C major", [(2, 2, "D major")]),
    "La menor → Do menor (+3)": (dict(sections=[S(["Am", "F", "C", "E"], key="A minor", repeats=4),
                                                S(["Cm", "G#", "D#", "G"], key="C minor", repeats=3)], bpm=100,
                                      key="A minor", seed=15),
                                 "A minor", [(1, 3, "C minor")]),
    "Sol → Lab → Sol": (dict(sections=[S(["G", "Em", "C", "D"], key="G major", repeats=3),
                                       S(["G#", "Fm", "C#", "D#"], key="G# major", repeats=3),
                                       S(["G", "C", "D", "G"], key="G major", repeats=2)], bpm=126, key="G major", seed=16),
                        "G major", [(1, 1, "G# major"), (2, -1, "G major")]),
    "La menor → La mayor (paralela)": (dict(sections=[S(["Am", "F", "G", "Am"], key="A minor", repeats=3),
                                                      S(["A", "D", "E", "A"], key="A major", repeats=4)], bpm=112,
                                            key="A major", seed=19),
                                       "A major", [(1, 0, "A major")]),
}


@pytest.mark.parametrize("name", list(MODULATING))
def test_modulations_are_found_where_the_key_changes(name):
    kw, key, expected = MODULATING[name]
    res, truth = run(synth.tonal_song(**kw))
    assert res.key.label == key
    found = [(m.semitones, m.key.label) for m in res.modulations]
    assert found == [(s, k) for _, s, k in expected], f"{name}: {found}"
    for m, (section, _, _) in zip(res.modulations, expected):
        # La pista de tonalidad mira ±KEY_WINDOW_S: la frontera se puede adelantar o
        # retrasar como mucho eso.
        assert abs(m.t - truth.section_bounds[section]) <= tonal.KEY_WINDOW_S, f"{name}: en {m.t:.1f} s"


STABLE = {
    "estrofa sobre la dominante (sin Fa#)": [S(["C", "Am", "F", "G"], key="C major", repeats=2),
                                             S(["G", "F", "G", "Dm"], key="C major", repeats=3),
                                             S(["C", "F", "G", "C"], key="C major", repeats=2)],
    "acordes de quinta, sin tercera": [S(["D5", "A#5", "C5", "G5"], key="D minor", repeats=4, melody=False),
                                       S(["D5", "F5", "C5", "G5"], key="D minor", repeats=4, melody=False)],
    # "Am Em F C" son exactamente las notas de Do mayor, sin sensible: un perfil lo lee
    # como Do mayor y es la ambigüedad documentada. La estrofa lleva el Mi mayor.
    "estrofa en la relativa menor": [S(["Am", "Dm", "E", "Am"], key="A minor", repeats=3),
                                     S(["C", "G", "F", "C"], key="C major", repeats=3)],
}


@pytest.mark.parametrize("name", list(STABLE))
def test_no_modulation_without_a_change_of_key_signature(name):
    """Los errores típicos de los perfiles (quinta, paralela, relativa) no deben
    salir como modulaciones: un efecto de "cambio de tonalidad" falso es peor que
    uno que no aparece."""
    res, _ = run(synth.tonal_song(STABLE[name], bpm=132, seed=17))
    assert res.modulations == [], f"{name}: {[(m.t, m.key.label) for m in res.modulations]}"


def test_section_keys_follow_the_modulation():
    kw, _, _ = MODULATING["Do → Re (+2)"]
    y, truth = synth.tonal_song(**kw)
    bounds = list(zip(truth.section_bounds[:-1], truth.section_bounds[1:]))
    res, _ = run((y, truth), sections=bounds)
    assert [k.label for k in res.section_keys] == ["C major", "C major", "D major"]
    assert all(0 <= k.confidence <= 1 for k in res.section_keys)


def test_relative_verse_keeps_its_mode_in_the_section_key():
    """La relativa no es una modulación, pero la sección sí dice que es menor: el
    modo es un dato útil (color de una estrofa triste frente a un estribillo)."""
    sections = STABLE["estrofa en la relativa menor"]
    y, truth = synth.tonal_song(sections, bpm=132, seed=17)
    bounds = list(zip(truth.section_bounds[:-1], truth.section_bounds[1:]))
    res, _ = run((y, truth), sections=bounds)
    assert [k.label for k in res.section_keys] == ["A minor", "C major"]
