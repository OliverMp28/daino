"""Beats y downbeats contra verdad conocida (métricas estándar de mir_eval)."""

from __future__ import annotations

import mir_eval
import numpy as np
import pytest

from daino_analyzer import beats, onsets, spectral
from tests import synth
from tests.conftest import matched_errors


def _track(songs, spectra, name):
    y, truth = songs[name]
    spec = spectra[name]
    return beats.track(y, spec, onsets.envelopes(spec)), truth


@pytest.mark.parametrize("name", ["90", "128swing", "150", "174busy", "waltz", "pop"])
def test_beat_and_downbeat_f_measure(songs, spectra, name):
    res, truth = _track(songs, spectra, name)
    f = mir_eval.beat.f_measure(truth.beats, res.beats)
    fd = mir_eval.beat.f_measure(truth.downbeats, res.downbeats)
    assert f >= 0.95, f"{name}: beats F={f:.3f}"
    assert fd >= 0.9, f"{name}: downbeats F={fd:.3f}"


@pytest.mark.parametrize("name", ["90", "150", "174busy", "pop"])
def test_refined_beats_are_accurate_to_a_few_ms(songs, spectra, name):
    """beat_this va en saltos de 20 ms. Donde hay un golpe debajo del beat, el
    afinado debe dejarlo en pocos milisegundos. Donde no lo hay (el puente sin
    batería de `pop`) no hay contra qué afinar y se conserva la precisión del
    modelo, que debe seguir dentro de un fotograma y medio."""
    res, truth = _track(songs, spectra, name)
    hits = np.round(np.concatenate([truth.kicks, truth.snares, truth.hats]), 4)
    with_hit = np.array([b for b in truth.beats if np.min(np.abs(hits - b)) < 0.002])
    err = matched_errors(with_hit, res.beats, window=0.07) * 1000
    assert abs(np.median(err)) <= 3.0, f"{name}: sesgo {np.median(err):.2f} ms"
    assert np.percentile(np.abs(err), 90) <= 6.0, f"{name}: p90 {np.percentile(np.abs(err), 90):.2f} ms"
    all_err = matched_errors(truth.beats, res.beats, window=0.07) * 1000
    assert np.max(np.abs(all_err)) <= 25.0, f"{name}: peor beat {np.max(np.abs(all_err)):.1f} ms"


@pytest.mark.parametrize("name, meter", [("150", 4), ("waltz", 3), ("pop", 4)])
def test_meter(songs, spectra, name, meter):
    res, _ = _track(songs, spectra, name)
    assert res.meter == meter


@pytest.mark.parametrize("name", ["90", "150", "174busy"])
def test_tempo_and_stability(songs, spectra, name):
    res, truth = _track(songs, spectra, name)
    assert abs(res.bpm - truth.bpm) / truth.bpm <= 0.01, f"{res.bpm:.2f} vs {truth.bpm}"
    assert res.tempo_stability >= 0.9
    assert res.beat_support >= 0.8, "casi todos los beats tienen golpe debajo"


def test_no_beats_in_silence():
    """El modelo sigue 'marcando el paso' en la cola silenciosa: esos beats sobran."""
    y, truth = synth.make_song(bpm=120, sections=[synth.Section(bars=6)])
    y = np.concatenate([y, np.zeros(synth.SR * 5, dtype=np.float32)])
    spec = spectral.compute(y)
    res = beats.track(y, spec, onsets.envelopes(spec))
    last_hit = truth.beats[-1]
    assert np.all(res.beats <= last_hit + 1.0), f"beats en el silencio: {res.beats[res.beats > last_hit + 1.0]}"


def test_accelerando_is_followed(songs):
    y, truth = synth.make_song(bpm=100, tempo_end_bpm=130, sections=[synth.Section(bars=12)])
    spec = spectral.compute(y)
    res = beats.track(y, spec, onsets.envelopes(spec))
    assert mir_eval.beat.f_measure(truth.beats, res.beats) >= 0.9
    assert res.tempo_stability >= 0.85, "un tempo que cambia poco a poco sigue siendo estable"
