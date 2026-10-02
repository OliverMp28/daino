// Ola 2 — reglas del catálogo sin DOM: dificultad medida, marcas locales,
// modelo de tarjeta y horneado de oficiales.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    chartStats, difficultyScore, difficultyFromStats, DIFFICULTY_THRESHOLDS,
} from '../../resources/js/game/levels/chartStats.js';
import { timingWindowS } from '../../resources/js/game/systems/playability.js';
import { createLocalBests, mergeBest, MAX_ENTRIES } from '../../resources/js/storage/localBests.js';
import {
    cardView, difficultyView, emptyView, formatDuration, playModeFor, tabsFor, PLAY_MODE,
} from '../../resources/js/ui/catalogModel.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { ANALYZER_KEY, isChartableAnalysis } from '../../resources/js/game/levels/analyze.js';
import { difficultyCeiling } from '../../resources/js/game/levels/difficultyCeiling.js';
import { CHARTER_NAME, CHARTER_VERSION, normalizeChart, seedFromSha256 } from '../../resources/js/game/levels/chartFormat.js';
import { toAudioBufferShape } from '../../scripts/lib/ffmpegDecode.mjs';
import { storyQuiet } from '../../scripts/lib/chartFromAnalysis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Chart sintético: acciones regulares cada `gapS`, con cuota de pteros. */
function regularChart({ gapS = 1.2, count = 60, speedPxS = 420, airEvery = 0 } = {}) {
    const events = [];
    for (let i = 0; i < count; i++) {
        const kind = airEvery > 0 && i % airEvery === 0 ? 'PTERO' : 'CACTUS_SMALL';
        events.push({ t: 3 + i * gapS, type: 'obstacle', kind });
    }
    return { events, world: { speedPxS } };
}

// --------------------------- Dificultad medida ---------------------------

test('margen de error: a menos velocidad el margen se estrecha (hallazgo de la Ola 2)', () => {
    for (const kind of ['CACTUS_SMALL', 'CACTUS_WIDE']) {
        const slow = timingWindowS(kind, 250);
        const mid = timingWindowS(kind, 400);
        const fast = timingWindowS(kind, 600);
        assert.ok(slow > 0, `${kind} debe ser superable a 250 px/s`);
        assert.ok(slow < mid && mid < fast, `${kind}: ${slow} < ${mid} < ${fast}`);
    }
    // Un jugador de ±40 ms (la tolerancia del charter) cabe en todos.
    assert.ok(timingWindowS('CACTUS_WIDE', 250) >= 0.08);
});

test('chartStats: densidad, hueco apretado y cuota aérea salen de los eventos', () => {
    const stats = chartStats(regularChart({ gapS: 1.5, count: 41, airEvery: 4 }));
    assert.equal(stats.actions, 41);
    assert.equal(stats.actionsPerMin, 40, '(n-1) huecos de 1.5 s → 40 por minuto');
    assert.equal(stats.tightGapS, 1.5);
    assert.equal(stats.airShare, Math.round((11 / 41) * 1000) / 1000);
    assert.ok(stats.meanWindowS > 0);
});

test('chartStats ignora eventos que no son obstáculos y kinds desconocidos', () => {
    const chart = regularChart({ count: 10 });
    const base = chartStats(chart);
    chart.events.push({ t: 50, type: 'section', label: 'chorus' }, { t: 60, type: 'obstacle', kind: 'NAVE_FUTURA' });
    assert.deepEqual(chartStats(chart), base);
});

test('dificultad: monótona en densidad y en velocidad lenta; siempre entre 1 y 5', () => {
    const sparse = difficultyScore(chartStats(regularChart({ gapS: 2.2 })));
    const dense = difficultyScore(chartStats(regularChart({ gapS: 0.8 })));
    assert.ok(dense > sparse, `más denso → más difícil (${sparse} < ${dense})`);

    const fast = difficultyScore(chartStats(regularChart({ gapS: 1.2, speedPxS: 600 })));
    const slow = difficultyScore(chartStats(regularChart({ gapS: 1.2, speedPxS: 250 })));
    assert.ok(slow > fast, `más lento → margen más estrecho → más difícil (${fast} < ${slow})`);

    assert.equal(difficultyFromStats(chartStats({ events: [], world: { speedPxS: 400 } })), 1);
    for (const gapS of [0.7, 0.9, 1.2, 1.8, 3, 6]) {
        const stars = difficultyFromStats(chartStats(regularChart({ gapS, speedPxS: 250, airEvery: 2 })));
        assert.ok(stars >= 1 && stars <= 5);
    }
    assert.deepEqual([...DIFFICULTY_THRESHOLDS].sort((a, b) => a - b), [...DIFFICULTY_THRESHOLDS], 'umbrales ordenados');
});

test('dificultad: una acción cada 2 s con margen amplio es fácil; al hueco mínimo es de 4★ o más', () => {
    assert.ok(difficultyFromStats(chartStats(regularChart({ gapS: 2.0, speedPxS: 500 }))) <= 2);
    assert.ok(difficultyFromStats(chartStats(regularChart({ gapS: 0.75, speedPxS: 400, airEvery: 3 }))) >= 4);
});

// --------------------------- Marcas locales ---------------------------

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        _map: map,
    };
}

test('localBests: solo sube, puntos y porcentaje por separado (como el servidor)', () => {
    const bests = createLocalBests({ storage: memoryStorage(), now: () => 1 });
    assert.equal(bests.get(7), null);
    assert.equal(bests.record(7, { points: 500, percentage: 40 }).improved, true);
    const worse = bests.record(7, { points: 300, percentage: 70 });
    assert.equal(worse.improved, false);
    assert.deepEqual({ points: worse.best.points, percentage: worse.best.percentage }, { points: 500, percentage: 70 });
    assert.equal(bests.get(7).points, 500);
});

test('localBests: sobrevive a almacenamiento roto, corrupto o inexistente', () => {
    const throwing = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cuota'); } };
    const a = createLocalBests({ storage: throwing });
    assert.doesNotThrow(() => a.record(1, { points: 10, percentage: 5 }));
    assert.equal(a.get(1), null);

    const corrupt = memoryStorage();
    corrupt.setItem('daino:bests', '{no es json');
    assert.equal(createLocalBests({ storage: corrupt }).get(1), null);

    const none = createLocalBests({ storage: null });
    assert.equal(none.record(2, { points: 1, percentage: 1 }).improved, true);
});

test('localBests: al superar el techo olvida los jugados hace más tiempo', () => {
    let clock = 0;
    const storage = memoryStorage();
    const bests = createLocalBests({ storage, now: () => ++clock });
    for (let id = 1; id <= MAX_ENTRIES + 5; id++) bests.record(id, { points: id, percentage: 1 });
    bests.record(3, { points: 1, percentage: 1 });   // el 3 se vuelve reciente
    const kept = Object.keys(JSON.parse(storage.getItem('daino:bests')));
    assert.equal(kept.length, MAX_ENTRIES);
    assert.ok(kept.includes('3'), 'el jugado hace poco se conserva');
    assert.ok(!kept.includes('1') && !kept.includes('2'), 'los más antiguos se olvidan');
});

test('localBests: olvidar la marca de un nivel cuyo chart cambió no toca las demás', () => {
    const storage = memoryStorage();
    const bests = createLocalBests({ storage, now: () => 1 });
    bests.record(4, { points: 100, percentage: 50 });
    bests.record(5, { points: 200, percentage: 60 });
    bests.forget(4);
    bests.forget(99);   // sin marca: nada que hacer, no rompe
    assert.equal(bests.get(4), null);
    assert.equal(bests.get(5).points, 200);
});

test('mergeBest: la tarjeta enseña la mayor entre servidor y local', () => {
    assert.equal(mergeBest(null, null), null);
    assert.deepEqual(mergeBest({ points: 900, percentage: 30 }, { points: 400, percentage: 80 }), { points: 900, percentage: 80 });
    assert.deepEqual(mergeBest(undefined, { points: 5, percentage: 1 }), { points: 5, percentage: 1 });
});

// --------------------------- Modelo de tarjeta ---------------------------

const official = {
    id: 3, title: 'HOPE', artist: null, is_official: true, is_public: true, has_audio: true, is_mine: false,
    difficulty: 4, bpm: 161, duration_sec: 79, duration_ms: 79047, players: 0, my_best: null,
    audio_sha256: '6a7375ae9bfa2e39ea4d9fa73eb9b726b8cc7011062decf844bd9ae282ac0a97', author: null,
};

test('tarjeta de un oficial: sin autor, pulsarla juega y con marca local si no hay de servidor', () => {
    const view = cardView(official, { points: 1234, percentage: 42 });
    assert.equal(view.badge, 'Oficial');
    assert.equal(view.byline, '', 'sin artista no repite "oficial": ya lo dice la insignia');
    assert.equal(cardView({ ...official, artist: 'Aurora' }).byline, 'Aurora');
    assert.equal(view.playMode, PLAY_MODE.CATALOG);
    assert.match(view.actionLabel, /^Jugar «HOPE»\. Dificultad 4 de 5: Difícil\. 1:19\.$/, 'la tarjeta anuncia lo que hace: jugar');
    assert.equal(view.duration, '1:19');
    assert.equal(view.bpm, '161 BPM');
    assert.deepEqual(view.best, { points: (1234).toLocaleString('es-ES'), percentage: '42 %', completed: false, ratio: 0.42 });
    assert.equal(view.players, null);
    assert.equal(view.canPublish, false);
});

test('tarjeta de comunidad y propias: autor, publicar, y qué hace pulsarla en cada estado', () => {
    const community = { ...official, id: 9, is_official: false, author: { username: 'ana' }, players: 1 };
    assert.equal(cardView(community).byline, 'por ana');
    assert.equal(cardView(community).players, '1 jugador');
    assert.equal(cardView(community).badge, null, 'en la vista única, lo de la comunidad se distingue por su autor');

    const privateMine = { ...official, id: 10, is_official: false, is_public: false, has_audio: false, is_mine: true, players: 1 };
    const view = cardView(privateMine);
    assert.equal(view.players, null, 'en lo privado el único jugador es su autor: no se cuenta');
    assert.equal(view.playMode, PLAY_MODE.NEEDS_FILE);
    assert.equal(view.playLabel, 'Elegir MP3 y jugar');
    assert.match(view.actionLabel, /^Elegir el MP3 de «HOPE» y jugar/);
    assert.equal(view.canPublish, true);
    assert.equal(view.badge, 'Privado');
    assert.equal(view.byline, 'Tu nivel', 'lo tuyo no dice "por <tu nombre>"');

    // Listo para publicar: su audio está en el servidor, su autor lo prueba sin elegir el archivo.
    const ready = cardView({ ...privateMine, has_audio: true, publish_ready: true });
    assert.deepEqual([ready.playMode, ready.badge, ready.canPublish, ready.publish.canConfirm], [PLAY_MODE.CATALOG, 'Listo para publicar', false, true]);
    // Analizándose: su chart va a cambiar; pulsar abre la ficha con el progreso.
    const analyzing = cardView({ ...privateMine, has_audio: true, pending_public: true });
    assert.equal(analyzing.playMode, PLAY_MODE.UNAVAILABLE);
    assert.match(analyzing.actionLabel, /analizándose/);

    const foreignPrivate = { ...privateMine, is_mine: false };
    assert.equal(playModeFor(foreignPrivate), PLAY_MODE.UNAVAILABLE);
    assert.equal(playModeFor({ ...foreignPrivate, has_audio: true }), PLAY_MODE.UNAVAILABLE, 'el audio privado ajeno no se juega');
});

test('pestañas: una vista para todo lo jugable y "Míos" solo con sesión; vacíos ofrecen subir canción', () => {
    assert.deepEqual(tabsFor(false).map((t) => t.id), ['public']);
    assert.deepEqual(tabsFor(true).map((t) => t.id), ['public', 'mine']);
    for (const tab of ['public', 'mine']) assert.equal(emptyView(tab).action, 'upload');
});

test('formatos: duración y estrellas acotadas', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(59.6), '1:00');
    assert.equal(formatDuration(215.6), '3:36');
    assert.equal(difficultyView(9).value, 5);
    assert.equal(difficultyView(undefined).value, 3);
});

// --------------------------- Horneado de oficiales ---------------------------

test('toAudioBufferShape: desentrelaza estéreo y expone la forma que usa el analizador', () => {
    const shape = toAudioBufferShape(new Float32Array([1, -1, 2, -2, 3, -3]));
    assert.equal(shape.numberOfChannels, 2);
    assert.equal(shape.length, 3);
    assert.equal(shape.sampleRate, 44100);
    assert.deepEqual([...shape.getChannelData(0)], [1, 2, 3]);
    assert.deepEqual([...shape.getChannelData(1)], [-1, -2, -3]);
});

test('los oficiales horneados del repo están al día con el analizador, el charter y la escala', async () => {
    // Guardia de CI: si alguien cambia el charter, la escala de dificultad o la
    // del techo y no vuelve a hornear, este test lo dice (sin MP3, ffmpeg ni Python).
    const dir = path.join(ROOT, 'database/seeds/official');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const files = (await readdir(path.join(dir, 'baked'))).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, manifest.levels.length, 'un horneado por entrada del manifiesto');

    for (const entry of manifest.levels) {
        const baked = JSON.parse(await readFile(path.join(dir, 'baked', `${entry.slug}.json`), 'utf8'));
        const a = baked.analysis;
        assert.equal(baked.file, entry.file, entry.slug);
        assert.ok(isChartableAnalysis(a), `${entry.slug}: análisis utilizable`);
        // Los oficiales se hornean con el analizador del servidor (Ola 4): el del
        // navegador no da beats, secciones ni techo de dificultad.
        assert.equal(a.formatVersion, 2, `${entry.slug}: análisis del servidor`);
        assert.notEqual(`${a.analyzer.name}@${a.analyzer.version}`, ANALYZER_KEY, `${entry.slug}: no es el analizador JS`);
        assert.equal(baked.bakedWith.analyzer, `${a.analyzer.name}@${a.analyzer.version}`, `${entry.slug}: analizador`);
        assert.equal(baked.bakedWith.charter, `${CHARTER_NAME}@${CHARTER_VERSION}`, `${entry.slug}: charter`);

        const sha = baked.audio.sha256;
        const requested = entry.difficulty ?? 'auto';
        const plain = buildChart(a, { sha256: sha, seed: seedFromSha256(sha), difficulty: requested });
        // Un oficial con historia de autor respeta sus respiros (sin obstáculo en el destello).
        const quiet = entry.scene ? storyQuiet(plain.chart, entry.scene) : [];
        const { chart: rebuilt, report } = quiet.length > 0 ? buildChart(a, { sha256: sha, seed: seedFromSha256(sha), difficulty: requested, quiet }) : plain;
        assert.deepEqual(rebuilt, baked.chart, `${entry.slug}: el chart se reproduce desde su análisis y su dificultad`);
        assert.equal(normalizeChart(baked.chart).warnings.length, 0, `${entry.slug}: chart limpio`);
        // Ola 5: la dificultad guardada es la del charter (la del manifiesto
        // limitada por el techo); la medida es la comprobación independiente.
        assert.equal(baked.difficulty, report.difficulty, `${entry.slug}: dificultad`);
        assert.equal(baked.chart.difficulty.level, report.difficulty, `${entry.slug}: dificultad en el chart`);
        assert.equal(baked.requestedDifficulty, requested, `${entry.slug}: dificultad pedida`);
        const measured = difficultyFromStats(chartStats(normalizeChart(rebuilt).chart));
        assert.equal(baked.measuredDifficulty, measured, `${entry.slug}: dificultad medida`);
        assert.ok(Math.abs(measured - report.difficulty) <= 1, `${entry.slug}: medida ${measured}★ lejos de la elegida ${report.difficulty}★`);
        const ceiling = difficultyCeiling(a);
        assert.equal(baked.difficultyCeiling, ceiling.ceiling, `${entry.slug}: techo de dificultad`);
        assert.equal(baked.stats.musicalDensity, ceiling.density, `${entry.slug}: densidad musical`);
    }
});
