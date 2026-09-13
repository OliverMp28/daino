"""Fixtures compartidas del analizador.

Las canciones sintéticas y sus análisis se calculan una vez por sesión: beat_this
tarda unos segundos por canción en CPU y varios tests miran el mismo resultado.
"""

from __future__ import annotations

import numpy as np
import pytest

from daino_analyzer import spectral
from daino_analyzer.decode import DecodedAudio
from tests import synth


@pytest.fixture(scope="session")
def songs():
    return {
        "90": synth.make_song(bpm=90, sections=[synth.Section(bars=10)]),
        "128swing": synth.make_song(bpm=128, swing=0.25, sections=[synth.Section(bars=12)]),
        "150": synth.make_song(bpm=150, sections=[synth.Section(bars=14)]),
        "174busy": synth.make_song(bpm=174, sections=[synth.Section(bars=16, busy=True)]),
        "waltz": synth.make_song(bpm=100, meter=3, sections=[synth.Section(bars=12)]),
        "pop": synth.pop_song(),
    }


@pytest.fixture(scope="session")
def spectra(songs):
    return {name: spectral.compute(y) for name, (y, _truth) in songs.items()}


@pytest.fixture(scope="session")
def analyses(songs):
    from daino_analyzer import analysis

    out = {}
    for name in ("pop", "waltz", "174busy"):
        y, _ = songs[name]
        out[name] = analysis.analyze(DecodedAudio(samples=synth.to_stereo(y), sample_rate=synth.SR))
    return out


def matched_errors(ref: np.ndarray, est: np.ndarray, window: float = 0.05) -> np.ndarray:
    """Error (est - ref, s) de cada referencia con su estimación más cercana dentro de la ventana."""
    est = np.asarray(est, dtype=float)
    if len(est) == 0:
        return np.array([])
    out = []
    for r in ref:
        k = int(np.argmin(np.abs(est - r)))
        if abs(est[k] - r) <= window:
            out.append(est[k] - r)
    return np.array(out)
