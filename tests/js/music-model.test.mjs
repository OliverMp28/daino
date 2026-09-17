// Modelo musical (Ola 5): pulso, compases y rejilla desde cualquier análisis.
//
// Lo delicado es el formato 1 (analizador del navegador): solo trae tempo y
// golpes, y el pulso se reconstruye con programación dinámica. Se prueba con
// verdad conocida: golpes sintéticos con error de tempo, huecos y swing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMusicModel, trackBeats } from '../../resources/js/game/levels/musicModel.js';
import { makeSyntheticSong } from './helpers/synthetic-audio.mjs';

/** Onsets en la forma interna del modelo a partir de pares [t, fuerza]. */
function onsetArrays(pairs) {
    const n = pairs.length;
    return {
        t: Float64Array.from(pairs, (p) => p[0]),
        s: Float32Array.from(pairs, (p) => p[1]),
        low: new Float32Array(n).fill(1 / 3),
        mid: new Float32Array(n).fill(1 / 3),
        high: new Float32Array(n).fill(1 / 3),
        count: n,
        hasColor: false,
    };
}

function nearest(sorted, t) {
    let best = Infinity;
    for (const x of sorted) best = Math.min(best, Math.abs(x - t));
    return best;
}

/** Análisis de formato 1 (sin beats) con golpes en un pulso real conocido. */
function format1(pairs, bpm, durationSec) {
    return {
        formatVersion: 1,
        analyzer: { name: 'daino-flux-js', version: 1 },
        durationSec,
        sampleRate: 44100,
        bpm,
        bpmConfidence: 0.8,
        beatPeriodS: 60 / bpm,
        onsets: pairs,
    };
}

test('seguidor de beats: con el tempo detectado un 2 % desviado, sigue los golpes reales', () => {
    const truePeriod = 0.5;
    const pairs = [];
    for (let t = 1; t < 60; t += truePeriod) {
        pairs.push([Math.round(t * 1000) / 1000, 0.8]);
        // Ruido débil entre golpes (lo que da el detector del navegador).
        pairs.push([Math.round((t + 0.21) * 1000) / 1000, 0.1]);
    }
    const beats = trackBeats(onsetArrays(pairs), truePeriod * 1.02, 60);
    const truth = pairs.filter((p) => p[1] > 0.5).map((p) => p[0]);
    let hits = 0;
    for (const b of beats) if (nearest(truth, b) <= 0.02) hits++;
    assert.ok(hits / beats.length >= 0.95, `${hits}/${beats.length} beats a ≤ 20 ms de un golpe real`);
    assert.ok(beats.length >= truth.length * 0.9, `${beats.length} beats para ${truth.length} golpes`);
});

test('seguidor de beats: un tramo sin golpes no descoloca el pulso de después', () => {
    const period = 0.6;
    const pairs = [];
    for (let t = 0.6; t < 20; t += period) pairs.push([Math.round(t * 1000) / 1000, 0.9]);
    // 8 s sin golpes (un puente sin batería) y vuelve el pulso en fase.
    for (let t = 28.2; t < 50; t += period) pairs.push([Math.round(t * 1000) / 1000, 0.9]);
    const beats = trackBeats(onsetArrays(pairs), period, 50);
    const after = [...beats].filter((b) => b > 30);
    const truth = pairs.map((p) => p[0]);
    for (const b of after) assert.ok(nearest(truth, b) <= 0.02, `beat en ${b.toFixed(3)} fuera de fase tras el hueco`);
    assert.ok(after.length >= 30);
});

test('formato 2: usa los beats y downbeats del análisis tal cual', () => {
    const analysis = makeSyntheticSong({ bpm: 120 });
    const model = buildMusicModel(analysis);
    assert.equal(model.realBeats, true);
    assert.deepEqual([...model.beats], analysis.beats);
    const down = [...model.beats].filter((_, i) => model.isDownbeat[i] === 1);
    assert.deepEqual(down, analysis.downbeats);
    assert.equal(model.meter, 4);
    assert.equal(model.onsets.hasColor, true);
});

test('compases: del tamaño del compás, y los de 1-2 beats del seguidor se funden', () => {
    const analysis = makeSyntheticSong({ bpm: 100, sections: [{ bars: 12, energy: 0.7, hits: 0.7 }] });
    // El seguidor de downbeats "se equivoca" a mitad: tiradas de 2 y un "3 1".
    const b = analysis.beats;
    analysis.downbeats = [b[0], b[4], b[8], b[10], b[12], b[14], b[16], b[19], b[20], b[24], b[28], b[32], b[36], b[40], b[44]];
    const model = buildMusicModel(analysis);
    const lengths = model.bars.map((bar) => bar.beats);
    assert.ok(lengths.every((n) => n >= 3 && n <= 5), `compases de ${JSON.stringify(lengths)}`);
    assert.equal(lengths.reduce((a, n) => a + n, 0), b.length, 'ningún beat se pierde');
});

test('rejilla: pulso y contratiempo por beat, con la fuerza y el color del golpe que suena', () => {
    const analysis = makeSyntheticSong({ bpm: 120, sections: [{ bars: 4, energy: 0.8, hits: 0.9, riff: true }] });
    const model = buildMusicModel(analysis);
    const bar = model.bars[1];
    assert.equal(bar.slots.length, 8);
    const [one, oneAnd, two] = bar.slots;
    assert.equal(one.onBeat, true);
    assert.equal(one.metric, 1, 'primer tiempo');
    assert.ok(one.low > one.high, 'el bombo del 1 suena grave');
    assert.equal(oneAnd.onBeat, false);
    assert.ok(Math.abs(oneAnd.t - (one.t + 0.25)) < 0.002, 'contratiempo a mitad de beat');
    assert.ok(oneAnd.high > oneAnd.low, 'el charles suena agudo');
    assert.equal(two.metric, 0.7, 'backbeat');
    assert.ok(two.high + 0.5 * two.mid > two.low, 'la caja del 2 suena brillante');
    assert.equal(bar.slots[4].metric, 0.8, 'tiempo fuerte de la mitad del compás');
});

test('swing: el contratiempo se coloca donde caen los golpes (2/3 del beat en un shuffle)', () => {
    const bpm = 96;
    const period = 60 / bpm;
    const pairs = [];
    const beats = [];
    for (let i = 0; i < 64; i++) {
        const t = 0.5 + i * period;
        beats.push(Math.round(t * 1000) / 1000);
        pairs.push([Math.round(t * 1000) / 1000, 0.8]);
        pairs.push([Math.round((t + period * 0.667) * 1000) / 1000, 0.5]);
    }
    const analysis = { ...format1(pairs, bpm, 0.5 + 64 * period + 1), formatVersion: 2, beats, downbeats: beats.filter((_, i) => i % 4 === 0), meter: 4 };
    const model = buildMusicModel(analysis);
    assert.ok(Math.abs(model.swing - 0.667) < 0.03, `swing detectado ${model.swing}`);
    const off = model.bars[2].slots[1];
    assert.ok(off.strength > 0.4, 'el contratiempo swing recoge su golpe');
});

test('formato 1: pulso reconstruido, compás deducido y energía desde la densidad de golpes', () => {
    const bpm = 110;
    const period = 60 / bpm;
    const pairs = [];
    for (let i = 0; i * period + 0.4 < 80; i++) {
        const t = 0.4 + i * period;
        // Acento en 1 de cada 4 (el primer tiempo), y la segunda mitad más llena.
        pairs.push([Math.round(t * 1000) / 1000, i % 4 === 0 ? 0.95 : 0.5]);
        if (t > 40) pairs.push([Math.round((t + period / 2) * 1000) / 1000, 0.45]);
    }
    const model = buildMusicModel(format1(pairs, bpm, 80));
    assert.equal(model.realBeats, false);
    const truth = pairs.map((p) => p[0]);
    let ok = 0;
    for (const b of model.beats) if (nearest(truth, b) <= 0.015) ok++;
    assert.ok(ok / model.beats.length >= 0.95, `${ok}/${model.beats.length} beats sobre golpes`);
    // El primer tiempo deducido cae en los acentos.
    const downs = [...model.beats].filter((_, i) => model.isDownbeat[i] === 1);
    const accents = pairs.filter((p) => p[1] > 0.9).map((p) => p[0]);
    const onAccent = downs.filter((d) => nearest(accents, d) <= 0.015).length;
    assert.ok(onAccent / downs.length >= 0.9, `${onAccent}/${downs.length} primeros tiempos sobre acentos`);
    assert.ok(model.energyMean(50, 70) > model.energyMean(10, 30), 'la mitad más llena tiene más energía');
    assert.equal(model.sections.length, 1);
});

/**
 * Análisis de formato 2 con pulso recto conocido: bombo en cada beat, golpes en
 * la "e" y la "a" que se pidan y, opcionalmente, acordes (analizador 2).
 */
function straightSong(bpm, { sixteenths = [], chords = null, beats = 64 } = {}) {
    const period = 60 / bpm;
    const pairs = [];
    const beatTimes = [];
    for (let i = 0; i < beats; i++) {
        const t = Math.round((0.5 + i * period) * 1000) / 1000;
        beatTimes.push(t);
        pairs.push([t, 0.8]);
        for (const [frac, strength] of sixteenths) pairs.push([Math.round((t + period * frac) * 1000) / 1000, strength]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const analysis = {
        ...format1(pairs, bpm, 0.5 + beats * period + 1),
        formatVersion: 2,
        beats: beatTimes,
        downbeats: beatTimes.filter((_, i) => i % 4 === 0),
        meter: 4,
    };
    if (chords !== null) analysis.tonal = { key: 'C:maj', chordConfidence: 0.8, chords, modulations: [] };
    return analysis;
}

test('semicorcheas: los golpes reales de la "e" y la "a", solo si la canción es recta y le caben', () => {
    // El bombo sincopado del hip-hop (What's Up Danger: el 30 % de sus golpes
    // fuertes cae en semicorcheas) necesita un hueco propio en la rejilla.
    const model = buildMusicModel(straightSong(95, { sixteenths: [[0.75, 0.7]] }));
    const bar = model.bars[2];
    assert.equal(bar.slots.length, 8, 'pulso y contratiempo siguen siendo la rejilla base');
    assert.equal(bar.sixteenths.length, 4, 'una "a" con golpe por beat');
    for (const s of bar.sixteenths) {
        assert.equal(s.sub, 3);
        assert.equal(s.onBeat, false);
        assert.ok(Math.abs((s.pos % 1) - 0.75) < 1e-9, `posición ${s.pos}`);
        assert.ok(s.strength >= 0.7 - 1e-6, 'con la fuerza de su golpe');
    }
    assert.ok(bar.slots.every((s) => s.sub === 0 || s.sub === 2), 'la rejilla base: pulso (0) y contratiempo (2)');
    // Sin golpe en la semicorchea no hay hueco (nada que jugar ahí).
    assert.equal(buildMusicModel(straightSong(95)).bars[2].sixteenths.length, 0);
    // A 150 BPM la semicorchea dura 0.1 s: no se consideran.
    assert.equal(buildMusicModel(straightSong(150, { sixteenths: [[0.75, 0.7]] })).bars[2].sixteenths.length, 0);
});

test('acordes: se marcan los pulsos donde cambia la armonía', () => {
    const period = 60 / 100;
    const at = (beat) => Math.round((0.5 + beat * period) * 1000) / 1000;
    const chords = [[0, 'C:maj'], [at(8), 'A:min'], [at(16), 'A:min'], [at(20), 'F:maj']];
    const model = buildMusicModel(straightSong(100, { chords }));
    const marked = model.bars.flatMap((bar) => bar.slots.filter((s) => s.chord)).map((s) => s.t);
    assert.deepEqual(marked, [at(8), at(20)], 'solo donde el acorde cambia (repetir etiqueta no es cambio)');
    assert.ok(model.bars.every((bar) => bar.slots.every((s) => !s.chord || s.onBeat)), 'en el pulso');
    // Sin análisis tonal, nada marcado.
    assert.ok(buildMusicModel(straightSong(100)).bars.every((bar) => bar.slots.every((s) => s.chord === false)));
});
