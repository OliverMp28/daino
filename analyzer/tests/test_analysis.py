"""Análisis completo: secciones, energía, rasgos, esquema y determinismo."""

from __future__ import annotations

import copy
import json

import mir_eval
import numpy as np
import pytest

from daino_analyzer import ANALYSIS_FORMAT_VERSION, ANALYZER_NAME, analysis, schema
from daino_analyzer.decode import DecodedAudio
from tests import synth


def test_sections_find_the_real_boundaries_within_a_bar(songs, analyses):
    _, truth = songs["pop"]
    a = analyses["pop"]
    ref = np.stack([truth.section_starts[:-1], truth.section_starts[1:]], axis=1)
    ref[0, 0] = 0.0
    est = np.array([[s["startSec"], s["endSec"]] for s in a["sections"]])
    bar = 4 * 60 / truth.bpm
    precision, recall, f = mir_eval.segment.detection(ref, est, window=bar, trim=True)
    assert f >= 0.8, f"fronteras F={f:.3f} (verdad {np.round(truth.section_starts, 2)}, estimadas {est[:, 0]})"


def test_repeated_chorus_is_recognized_as_the_same_material(analyses):
    secs = analyses["pop"]["sections"]
    assert len(secs) == 5
    assert secs[2]["cluster"] == secs[4]["cluster"], "los dos estribillos son el mismo grupo"
    assert len({s["cluster"] for s in secs}) == 4, "intro, estrofa, estribillo y puente son materiales distintos"
    assert secs[0]["role"] == "intro"
    assert secs[2]["role"] == secs[4]["role"] == "chorus"
    assert secs[2]["energy"] > secs[1]["energy"] > secs[3]["energy"], "estribillo > estrofa > puente sin batería"


def test_energy_curve_follows_the_song(songs, analyses):
    _, truth = songs["pop"]
    a = analyses["pop"]
    vals = np.array(a["energy"]["values"])
    hop = a["energy"]["hopSec"]
    starts = truth.section_starts

    def mean_between(t0, t1):
        return float(vals[int(t0 / hop): int(t1 / hop)].mean())

    chorus = mean_between(starts[2] + 1, starts[3] - 1)
    bridge = mean_between(starts[3] + 1, starts[4] - 1)
    assert chorus > bridge + 0.2


def test_features_describe_percussive_vs_ambient():
    drums, _ = synth.make_song(bpm=120, sections=[synth.Section(bars=12, busy=True)])
    pad, _ = synth.make_song(bpm=120, sections=[synth.Section(bars=12, drums=False, hats=False)])
    fd = analysis.analyze(DecodedAudio(synth.to_stereo(drums), synth.SR))["features"]
    fp = analysis.analyze(DecodedAudio(synth.to_stereo(pad), synth.SR))["features"]
    assert fd["percussiveRatio"] > fp["percussiveRatio"] + 0.2
    assert fd["strongEventsPerMin"] > 60 > fp["strongEventsPerMin"]
    assert fd["beatSupport"] > 0.8


def test_output_is_valid_format_2_and_compatible_with_format_1(analyses):
    for a in analyses.values():
        schema.validate(a)
        assert a["formatVersion"] == ANALYSIS_FORMAT_VERSION == 2
        assert a["analyzer"]["name"] == ANALYZER_NAME
        assert a["analyzer"]["models"]["beats"].startswith("beat_this:")
        # Núcleo del formato 1 intacto: el charter JS actual lo lee sin cambios.
        assert all(isinstance(o, list) and len(o) == 2 for o in a["onsets"])
        assert a["beatPeriodS"] == pytest.approx(60 / a["bpm"], rel=0.02)
        assert len(json.dumps(a)) < 200_000


def test_schema_rejects_broken_analyses(analyses):
    base = analyses["waltz"]
    broken = []
    for mutate in (
        lambda a: a.update(formatVersion=1),
        lambda a: a["onsets"].reverse(),
        lambda a: a["onsetColor"].pop(),
        lambda a: a["downbeats"].append(a["durationSec"] + 5),
        lambda a: a["sections"][0].update(startSec=1.0),
        lambda a: a["sections"][0].update(role="drop"),
        lambda a: a["energy"]["values"].append(2.0),
        lambda a: a["features"].update(percussiveRatio=float("nan")),
    ):
        a = copy.deepcopy(base)
        mutate(a)
        with pytest.raises(schema.SchemaError):
            schema.validate(a)
        broken.append(True)
    assert len(broken) == 8


def test_analysis_is_deterministic(songs, analyses):
    y, _ = songs["waltz"]
    again = analysis.analyze(DecodedAudio(synth.to_stereo(y), synth.SR))
    assert json.dumps(again, sort_keys=True) == json.dumps(analyses["waltz"], sort_keys=True)


def test_progress_is_reported_in_order():
    y, _ = synth.make_song(bpm=110, sections=[synth.Section(bars=4)])
    seen = []
    analysis.analyze(DecodedAudio(synth.to_stereo(y), synth.SR), progress=lambda s, r: seen.append((s, r)))
    ratios = [r for _, r in seen]
    assert ratios == sorted(ratios) and ratios[-1] == 1.0
    assert [s for s, _ in seen][-1] == "done"
