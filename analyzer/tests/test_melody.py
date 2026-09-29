"""Contorno melódico contra melodías sintéticas de verdad conocida (analizador 3).

La melodía sintética suena sobre acordes, bajo y batería (synth.tonal_song), así
que se mide lo que importa en una mezcla: que el camino siga a la melodía y no al
acompañamiento. Métricas en semitonos sobre los fotogramas donde suena una nota
(lejos de sus bordes: un fotograma dura 93 ms): acierto de altura (±0.5), acierto
sin la octava y cobertura. Para el juego importa sobre todo el registro relativo
(que una frase aguda salga más alta que una grave), que se mide aparte.
"""

from __future__ import annotations

import numpy as np

from daino_analyzer import melody, spectral, tonal
from tests import synth
from tests.synth import TonalSection as S


def run(song, gain: float = 1.0) -> tuple[melody.MelodyResult, synth.TonalTruth]:
    y, truth = song
    spec = spectral.compute(y * gain)
    cq = tonal.constant_q(spec.y)
    return melody.analyze(cq, 0.0, truth.duration), truth


def truth_frames(result: melody.MelodyResult, truth: synth.TonalTruth, guard: float = 0.1) -> np.ndarray:
    """MIDI de la nota que suena en el centro de cada fotograma (0 si ninguna o cerca de un borde)."""
    centers = np.arange(result.pitch.size) * result.hop_sec
    ref = np.zeros(result.pitch.size)
    for t0, t1, midi in truth.melody_notes:
        inside = (centers >= t0 + guard) & (centers <= t1 - guard)
        ref[inside] = midi
    return ref


def scores(result: melody.MelodyResult, truth: synth.TonalTruth) -> dict[str, float]:
    ref = truth_frames(result, truth)
    est = result.pitch
    frames = ref > 0
    voiced = frames & (est > 0)
    diff = np.abs(est[voiced] - ref[voiced])
    chroma = np.abs(((est[voiced] - ref[voiced]) + 6) % 12 - 6)
    return {
        "pitch": float((diff <= 0.5).sum() / max(1, frames.sum())),
        "chroma": float((chroma <= 0.5).sum() / max(1, frames.sum())),
        "recall": float(voiced.sum() / max(1, frames.sum())),
    }


SONGS = {
    "C mayor I-V-vi-IV": dict(sections=[S(["C", "G", "Am", "F"], key="C major", repeats=3)], bpm=110),
    "La menor, corcheas": dict(sections=[S(["Am", "Dm", "E", "Am"], key="A minor", repeats=3)], bpm=120, seed=3),
    "Sib mayor con batería fuerte": dict(sections=[S(["Bb", "Gm", "Eb", "F"], key="A# major", repeats=3)], bpm=140,
                                         drum_gain=3.0, seed=8),
    "Re mayor, melodía en la octava 4": dict(sections=[S(["D", "A", "Bm", "G"], key="D major", repeats=3, melody_base=60)],
                                             bpm=96, seed=11),
}


def test_melody_follows_the_notes_over_chords_bass_and_drums():
    # Medido con los parámetros del módulo: 98-100 % en tres de las cuatro y 89 % en
    # la melodía de la octava 4, que comparte registro con los acordes. Con 6
    # armónicos y sin preferir lo agudo, 0-6 %: seguía la fundamental de los acordes.
    for name, kw in SONGS.items():
        result, truth = run(synth.tonal_song(**kw))
        s = scores(result, truth)
        assert s["recall"] >= 0.9, f"{name}: {s}"
        assert s["chroma"] >= 0.85, f"{name}: {s}"
        assert s["pitch"] >= 0.8, f"{name}: {s}"


def test_detuned_recording_is_read_with_its_tuning():
    y, truth = synth.tonal_song([S(["G", "D", "Em", "C"], key="G major", repeats=3)], bpm=104, tuning_cents=-32, seed=6)
    spec = spectral.compute(y)
    cq = tonal.constant_q(spec.y)
    detected = tonal.analyze(spec, _beats(truth), [(0.0, truth.duration)], truth.duration, cq=cq).tuning_cents
    result = melody.analyze(cq, detected, truth.duration)
    s = scores(result, truth)
    assert s["pitch"] >= 0.65, s


def test_register_follows_the_phrases():
    # Una frase grave (octava 4), una aguda (octava 5) y otra grave: lo que el vuelo
    # necesita es que la aguda salga claramente más alta.
    sections = [
        S(["C", "G", "Am", "F"], key="C major", repeats=2, melody_base=60),
        S(["C", "G", "Am", "F"], key="C major", repeats=2, melody_base=72),
        S(["C", "G", "Am", "F"], key="C major", repeats=2, melody_base=60),
    ]
    result, truth = run(synth.tonal_song(sections, bpm=112, seed=4))
    b = truth.section_bounds
    centers = np.arange(result.pitch.size) * result.hop_sec

    def median_in(a: float, z: float) -> float:
        p = result.pitch[(centers >= a) & (centers < z) & (result.pitch > 0)]
        return float(np.median(p))

    low1, high, low2 = (median_in(b[i], b[i + 1]) for i in range(3))
    assert high - low1 >= 8 and high - low2 >= 8, (low1, high, low2)


def test_a_silent_break_has_no_melody():
    sections = [
        S(["C", "G", "Am", "F"], key="C major", repeats=2),
        S([], key="C major", repeats=2, drums=False, melody=False),
        S(["C", "G", "Am", "F"], key="C major", repeats=2),
    ]
    result, truth = run(synth.tonal_song(sections, bpm=110, seed=2))
    b = truth.section_bounds
    centers = np.arange(result.pitch.size) * result.hop_sec
    gap = (centers >= b[1] + 0.3) & (centers < b[2] - 0.3)
    assert not result.pitch[gap].any(), "en el silencio no hay melodía"
    assert (result.pitch[(centers >= b[0] + 0.5) & (centers < b[1])] > 0).mean() >= 0.8


def test_silence_has_no_melody_and_output_contract():
    duration = 6.0
    silent = np.zeros(int(duration * spectral.SR), dtype=np.float32)
    spec = spectral.compute(silent)
    result = melody.analyze(tonal.constant_q(spec.y), 0.0, duration)
    assert result.pitch.size == int(np.ceil(duration / melody.HOP_SEC))
    assert not result.pitch.any() and result.voiced_ratio == 0.0

    song = synth.tonal_song([S(["F", "C", "Dm", "Bb"], key="F major", repeats=2)], bpm=100, seed=9)
    a, truth = run(song)
    b, _ = run(song)
    assert np.array_equal(a.pitch, b.pitch), "determinista"
    voiced = a.pitch[a.pitch > 0]
    assert voiced.size > 0 and voiced.min() >= melody.MIN_MIDI - 0.5 and voiced.max() <= melody.MAX_MIDI + 0.5
    assert a.pitch.size == int(np.ceil(truth.duration / melody.HOP_SEC))


def _beats(truth: synth.TonalTruth):
    from daino_analyzer.beats import BeatResult

    period = 60.0 / truth.bpm
    return BeatResult(beats=truth.beats, downbeats=truth.downbeats, meter=4, bpm=truth.bpm, beat_period_s=period,
                      tempo_stability=1.0, beat_support=1.0, model="verdad")
