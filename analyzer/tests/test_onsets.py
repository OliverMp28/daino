"""Onsets: detección, tiempos, suelo absoluto (D16) y color del ataque."""

from __future__ import annotations

import mir_eval
import numpy as np
import pytest

from daino_analyzer import onsets, spectral
from tests import synth
from tests.conftest import matched_errors
from tests.synth import TonalSection


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


def _auc(pos, neg) -> float:
    pos, neg = np.asarray(pos), np.asarray(neg)
    return float(np.mean([(p > neg).mean() + 0.5 * (p == neg).mean() for p in pos]))


@pytest.mark.parametrize("drum_gain, min_auc", [(2.5, 0.95), (1.0, 0.95), (0.35, 0.85)])
def test_percussiveness_separates_drum_hits_from_note_attacks(drum_gain, min_auc):
    """Melodía a semicorcheas (fuera de la rejilla del charles) y acordes con
    armónicos, contra golpes de batería. Se comparan solo los ataques que no
    coinciden con el otro tipo: un golpe sobre una nota es, con razón, golpe."""
    y, truth = synth.tonal_song([TonalSection(["Am", "F", "Dm", "E"], key="A minor", repeats=3, melody_grid=0.25)],
                                bpm=120, drum_gain=drum_gain, seed=22)
    found = onsets.detect(spectral.compute(y))
    times = np.array([o.t for o in found])
    perc = np.array([o.percussive for o in found])
    chord_starts = np.array([a for a, _, label in truth.chords if label != "N"])
    notes = np.unique(np.round(np.concatenate([truth.melody_onsets, chord_starts]), 4))
    drums = np.round(truth.drum_onsets, 4)
    only_drums = [d for d in drums if np.min(np.abs(notes - d)) > 0.03]
    only_notes = [n for n in notes if np.min(np.abs(drums - n)) > 0.03]

    def near(ref):
        return [int(np.argmin(np.abs(times - r))) for r in ref if np.min(np.abs(times - r)) < 0.025]

    d, n = perc[near(only_drums)], perc[near(only_notes)]
    assert len(d) >= 20 and len(n) >= 10
    # Con la batería 9 dB por debajo de la armonía (0.35) los charles apenas
    # asoman sobre la cola de las notas: medido AUC 0.91. Sigue ordenando, peor.
    assert _auc(d, n) >= min_auc, f"batería x{drum_gain}: AUC {_auc(d, n):.3f}"
    assert d.mean() > n.mean() + 0.3 and n.mean() < 0.35, f"batería {d.mean():.2f}, notas {n.mean():.2f}"


def test_percussiveness_is_loudness_invariant(songs):
    y, _ = songs["pop"]
    loud = [o.percussive for o in onsets.detect(spectral.compute(y))]
    quiet = [o.percussive for o in onsets.detect(spectral.compute(y * 0.1))]
    assert len(loud) == len(quiet)
    assert np.allclose(loud, quiet, atol=0.02)
    assert all(0.0 <= p <= 1.0 for p in loud)
