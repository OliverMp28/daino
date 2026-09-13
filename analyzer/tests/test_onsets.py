"""Onsets: detección, tiempos, suelo absoluto (D16) y color del ataque."""

from __future__ import annotations

import mir_eval
import numpy as np
import pytest

from daino_analyzer import onsets, spectral
from tests import synth
from tests.conftest import matched_errors


@pytest.mark.parametrize("name, min_f", [("90", 0.97), ("128swing", 0.97), ("150", 0.95), ("174busy", 0.9), ("pop", 0.93)])
def test_detects_the_drum_hits(songs, spectra, name, min_f):
    _, truth = songs[name]
    est = np.array([o.t for o in onsets.detect(spectra[name])])
    f = mir_eval.onset.f_measure(truth.drum_onsets, est, window=0.05)[0]
    assert f >= min_f, f"{name}: F={f:.3f}"


@pytest.mark.parametrize("name", ["90", "150", "pop"])
def test_onset_times_are_accurate_to_a_few_ms(songs, spectra, name):
    """Sesgo y dispersión tras corregir la latencia del detector. Un fotograma a
    60 fps son 16.7 ms: el error debe quedar muy por debajo."""
    _, truth = songs[name]
    est = [o.t for o in onsets.detect(spectra[name])]
    err = matched_errors(truth.drum_onsets, est) * 1000
    assert abs(np.median(err)) <= 3.0, f"sesgo {np.median(err):.2f} ms"
    assert np.percentile(np.abs(err - np.median(err)), 90) <= 5.0


@pytest.mark.parametrize("instrument", ["kick", "snare", "hat"])
def test_latency_correction_holds_for_each_instrument_in_silence_and_over_a_bed(instrument):
    """La constante está elegida para mezclas (música real). Un golpe aislado se
    adelanta algo más, pero sigue muy por debajo de un fotograma (16.7 ms)."""
    rng = np.random.default_rng(11)
    sample = {"kick": synth._kick, "snare": synth._snare, "hat": synth._hat}[instrument](rng)
    times = np.arange(0.5, 9.5, 0.5)
    for bed in (False, True):
        buf = np.zeros(int(10 * synth.SR), dtype=np.float32)
        if bed:
            t = np.arange(len(buf)) / synth.SR
            buf += (0.1 * sum(np.sin(2 * np.pi * f * t) for f in (110, 138.6, 165, 220)) / 4).astype(np.float32)
        for x in times:
            synth._place(buf, sample, x, 0.8)
        err = matched_errors(times, [o.t for o in onsets.detect(spectral.compute(buf))]) * 1000
        assert len(err) == len(times)
        assert abs(np.median(err)) <= 5.5, f"{instrument} {'colchón' if bed else 'silencio'}: {np.median(err):.2f} ms"


def test_sustained_chord_does_not_produce_onsets_d16():
    """Regresión del defecto D16 del analizador JS: un acorde con batidos, sin un
    solo golpe, producía cientos de onsets al normalizar contra su propio máximo."""
    y, _ = synth.make_song(bpm=120, sections=[synth.Section(bars=5, drums=False, hats=False)])
    found = onsets.detect(spectral.compute(y))
    assert len(found) <= 3, f"{len(found)} onsets en un acorde sostenido"


def test_attack_color_orders_kick_snare_hat(songs, spectra):
    _, truth = songs["pop"]
    found = onsets.detect(spectra["pop"])
    times = np.array([o.t for o in found])

    def colors(ref):
        out = []
        for r in ref:
            k = int(np.argmin(np.abs(times - r)))
            if abs(times[k] - r) < 0.02:
                out.append(found[k].color)
        return np.array(out)

    r4 = lambda a: np.round(a, 4)  # noqa: E731
    kicks = colors(np.setdiff1d(r4(truth.kicks), r4(truth.snares)))
    snares = colors(r4(truth.snares))
    hats = colors(np.setdiff1d(np.setdiff1d(r4(truth.hats), r4(truth.kicks)), r4(truth.snares)))
    low, high = 0, 2
    assert kicks[:, low].mean() > snares[:, low].mean() > hats[:, low].mean()
    assert hats[:, high].mean() > snares[:, high].mean() > kicks[:, high].mean()
    assert np.allclose(np.array([o.color for o in found]).sum(axis=1), 1.0, atol=1e-6)


def test_strength_is_normalized_and_loudness_invariant(songs):
    y, _ = songs["150"]
    loud = [o.strength for o in onsets.detect(spectral.compute(y))]
    quiet = [o.strength for o in onsets.detect(spectral.compute(y * 0.1))]
    assert all(0.0 <= s <= 1.0 for s in loud)
    assert len(loud) == len(quiet)
    assert np.allclose(loud, quiet, atol=0.02), "la misma canción 20 dB más baja da las mismas fuerzas"
