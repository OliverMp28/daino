// Análisis de audio real (Ola 3): DSP de verdad sobre audio sintético.
//
// Pistas cortas a propósito: la FFT es lo caro y estos tests deben seguir
// siendo rápidos en una máquina ocupada. La lógica del charter se prueba sin
// DSP en charter.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeAudio, isChartableAnalysis, isUsableAnalysis, ANALYZER_KEY } from '../../resources/js/game/levels/analyze.js';
import { generate } from '../../resources/js/game/levels/LevelGenerator.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { detectBpm } from '../../resources/js/game/levels/Bpm.js';
import { computeOnsetEnvelope, detectorLatencyS } from '../../resources/js/game/levels/SpectralFlux.js';
import { normalizeChart } from '../../resources/js/game/levels/chartFormat.js';
import { FALLBACK_BPM } from '../../resources/js/game/config.js';
import { makeClickTrack, makeDrone } from './helpers/synthetic-audio.mjs';

const OPTS = { yieldEvery: 0 };

const cache = new Map();
async function analysisOf(bpm, durationSec = 16) {
    const key = `${bpm}@${durationSec}`;
    if (!cache.has(key)) cache.set(key, await analyzeAudio(makeClickTrack({ bpm, durationSec }), OPTS));
    return cache.get(key);
}

test('detecta el BPM de un click track con alta confianza', async () => {
    for (const bpm of [90, 128, 160]) {
        const env = await computeOnsetEnvelope(makeClickTrack({ bpm, durationSec: 12 }), OPTS);
        const res = detectBpm(env);
        assert.ok([bpm, bpm / 2, bpm * 2].some((c) => Math.abs(res.bpm - c) < 3), `real ${bpm}, detectado ${res.bpm.toFixed(1)}`);
        assert.ok(res.confidence > 0.3, `confianza ${res.confidence.toFixed(3)}`);
    }
});

test('un drone sin pulso cae al BPM de fallback con confianza baja', async () => {
    const res = detectBpm(await computeOnsetEnvelope(makeDrone({ durationSec: 10 }), OPTS));
    assert.equal(res.bpm, FALLBACK_BPM);
    // Confianza MEDIDA, no 0: distingue "sin datos" de "medido y débil".
    assert.ok(res.confidence < 0.1, `confianza ${res.confidence}`);
});

test('la latencia del detector (medio frame) queda corregida en los onsets', async () => {
    assert.ok(Math.abs(detectorLatencyS(44100) - 1024 / 44100) < 1e-12);
    // Sin corrección, la mediana del error frente al golpe real era −23 ms.
    const analysis = await analysisOf(128);
    const period = 60 / 128;
    const errs = analysis.onsets
        .filter(([, s]) => s > 0.3)
        .map(([t]) => t - Math.round(t / period) * period)
        .sort((a, b) => a - b);
    const median = errs[errs.length >> 1];
    assert.ok(Math.abs(median) < 0.005, `mediana ${(median * 1000).toFixed(1)} ms`);
});

test('el análisis es JSON plano, versionado y descartable si cambia de versión', async () => {
    const analysis = await analysisOf(128);
    assert.ok(isUsableAnalysis(analysis));
    assert.deepEqual(JSON.parse(JSON.stringify(analysis)), analysis);
    assert.equal(ANALYZER_KEY, 'daino-flux-js@1');
    assert.equal(isUsableAnalysis({ ...analysis, analyzer: { name: 'daino-flux-js', version: 0 } }), false);
    assert.equal(isUsableAnalysis(null), false);
});

test('isChartableAnalysis acepta el formato del servidor, pero la caché local no lo reutiliza', async () => {
    const local = await analysisOf(128);
    const server = {
        ...local, formatVersion: 2, analyzer: { name: 'daino-mir-py', version: 1, models: { beats: 'x' } },
        beats: [0.5, 1.0], downbeats: [0.5], meter: 4, sections: [], features: {},
    };
    assert.ok(isChartableAnalysis(local));
    assert.ok(isChartableAnalysis(server));
    // La caché local solo reutiliza análisis de ESTE analizador.
    assert.equal(isUsableAnalysis(server), false);
    assert.equal(isChartableAnalysis({ ...server, beats: undefined }), false, 'formato 2 sin beats');
    assert.equal(isChartableAnalysis({ ...server, formatVersion: 3 }), false, 'formato futuro');
    assert.equal(isChartableAnalysis({ ...server, analyzer: { name: 'x', version: '1' } }), false);
    assert.equal(isChartableAnalysis({ ...local, bpm: 0 }), false);
    assert.equal(isChartableAnalysis(null), false);
});

test('de punta a punta: con audio real los eventos caen sobre los golpes', async () => {
    for (const bpm of [90, 128, 150]) {
        const { chart } = buildChart(await analysisOf(bpm, 20), { seed: 7 });
        const period = 60 / bpm;
        const off = chart.events.filter((e) => Math.abs(e.t - Math.round(e.t / period) * period) > 0.015);
        assert.ok(chart.events.length >= 5, `${bpm} BPM: solo ${chart.events.length} eventos`);
        assert.equal(off.length, 0, `${bpm} BPM: ${off.length}/${chart.events.length} fuera de ±15 ms`);
    }
});

test('generate() encadena análisis y charting', async () => {
    const sha = 'ab'.repeat(32);
    const out = await generate(makeClickTrack({ bpm: 120, durationSec: 12 }), { seed: 5, sha256: sha, ...OPTS });
    assert.ok(isUsableAnalysis(out.analysis));
    assert.equal(out.chart.audio.sha256, sha);
    assert.equal(out.chart.seed, 5);
    assert.doesNotThrow(() => normalizeChart(out.chart));
});
