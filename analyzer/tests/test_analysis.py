"""Análisis completo: secciones, energía, rasgos, esquema y determinismo."""

from __future__ import annotations

import copy
import math
import json

import mir_eval
import numpy as np
import pytest

from daino_analyzer import ANALYSIS_FORMAT_VERSION, ANALYZER_NAME, ANALYZER_VERSION, analysis, energy, schema, spectral
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


def test_chords_follow_the_song_with_tracked_beats(songs, analyses):
    """Integración: beats seguidos por beat_this, no los de la verdad. Los pads de
    `pop_song` son tríadas mayores (1, 5/4, 3/2 de la fundamental): Sol, La, Re,
    Mi y Re. El acorde que más dura en cada sección debe ser el suyo."""
    _, truth = songs["pop"]
    a = analyses["pop"]
    chords = a["tonal"]["chords"]
    starts = truth.section_starts
    expected = ["G:maj", "A:maj", "D:maj", "E:maj", "D:maj"]
    for i, want in enumerate(expected):
        t0, t1 = starts[i] + 0.5, starts[i + 1] - 0.5
        held: dict[str, float] = {}
        for j, (t, label) in enumerate(chords):
            end = chords[j + 1][0] if j + 1 < len(chords) else a["durationSec"]
            held[label] = held.get(label, 0.0) + max(0.0, min(t1, end) - max(t0, t))
        assert max(held, key=held.get) == want, f"sección {i}: {held}"


def test_band_energy_says_where_the_bass_is():
    """5 s de bajo y 5 s de charles: la curva de graves sube en el primero y la de
    agudos en el segundo, cada una en [0,1] y paralela a la global."""
    sr = synth.SR
    t = np.arange(5 * sr) / sr
    bass = (0.6 * np.sin(2 * np.pi * 55 * t)).astype(np.float32)
    rng = np.random.default_rng(4)
    hats = (0.3 * np.diff(rng.standard_normal(5 * sr + 1))).astype(np.float32)
    en = energy.analyze(spectral.compute(np.concatenate([bass, hats])))
    half = len(en.relative) // 2
    low, high = en.bands["low"], en.bands["high"]
    assert len(low) == len(high) == len(en.bands["mid"]) == len(en.relative)
    assert low[5:half - 5].mean() > 0.7 and low[half + 5:-5].mean() < 0.3
    assert high[half + 5:-5].mean() > 0.7 and high[5:half - 5].mean() < 0.3
    assert abs(sum(10 ** (v / 10) for v in en.band_level_db) - 1) < 1e-6


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
        assert a["analyzer"]["version"] == ANALYZER_VERSION == 3
        assert len(a["onsetPercussive"]) == len(a["onsets"])
        assert set(a["tonal"]) == {"tuningCents", "key", "keyConfidence", "chords", "chordConfidence",
                                   "harmonicRhythm", "modulations"}
        assert all("key" in s and "keyConfidence" in s for s in a["sections"])
        assert set(a["melody"]) == {"hopSec", "pitch", "voicedRatio"}
        assert abs(len(a["melody"]["pitch"]) - math.ceil(a["durationSec"] / a["melody"]["hopSec"])) <= 1
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
        lambda a: a["onsetPercussive"].pop(),
        lambda a: a["sections"][0].update(key="H major"),
        lambda a: a["energy"]["bands"]["low"].pop(),
        lambda a: a["energy"].update(bandLevelDb=[-20.0, -30.0, 3.0]),
        lambda a: a["tonal"]["chords"].append(list(a["tonal"]["chords"][-1])),
        lambda a: a["tonal"]["chords"][0].__setitem__(1, "C:dim"),
        lambda a: a["tonal"]["modulations"].append({"t": 1.0, "key": "C major", "semitones": 9}),
        lambda a: a["tonal"].update(tuningCents=80.0),
        lambda a: a["melody"]["pitch"].append(140.0),
        lambda a: a["melody"]["pitch"].extend([0.0] * 400),
        lambda a: a["melody"].update(voicedRatio=1.5),
    ):
        a = copy.deepcopy(base)
        mutate(a)
        with pytest.raises(schema.SchemaError):
            schema.validate(a)
        broken.append(True)
    assert len(broken) == 19


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
