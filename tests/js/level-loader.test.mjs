// Cargador de niveles (Ola 3): qué sale de caché, qué de red, qué se analiza.
//
// Es la prueba de la queja original "¿por qué a la segunda vez vuelve a
// descargarse y a analizar?". Todas las dependencias son dobles de prueba que
// cuentan sus llamadas, así que se verifica el ORDEN y las DECISIONES sin
// navegador, sin servidor y sin audio real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLevelLoader, LevelLoadError, LOAD_STAGE } from '../../resources/js/game/levels/levelLoader.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { createMemoryLevelCache } from '../../resources/js/storage/levelCache.js';
import { sha256Hex } from '../../resources/js/storage/hash.js';
import { makeSyntheticAnalysis } from './helpers/synthetic-audio.mjs';

const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

async function makeWorld(overrides = {}) {
    const sha = await sha256Hex(MP3_BYTES);
    const calls = { fetchAudio: 0, getJson: 0, decode: 0, analyze: 0 };
    const analysis = makeSyntheticAnalysis({ bpm: 120, durationSec: 40 });
    const serverChart = buildChart(analysis, { sha256: sha, seed: 11 }).chart;

    const deps = {
        cache: createMemoryLevelCache(),
        hash: sha256Hex,
        buildChart,
        async fetchAudio() {
            calls.fetchAudio++;
            return new Response(MP3_BYTES.slice(), {
                status: 200,
                headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(MP3_BYTES.length) },
            });
        },
        async getJson() {
            calls.getJson++;
            return { ok: true, status: 200, data: structuredClone(serverChart) };
        },
        async decode(bytes) {
            calls.decode++;
            // Como el decodificador real: desengancha el buffer recibido.
            structuredClone(bytes, { transfer: [bytes] });
            return { duration: 40, sampleRate: 44100 };
        },
        async analyze() {
            calls.analyze++;
            return structuredClone(analysis);
        },
        ...overrides,
    };
    return { sha, calls, deps, loader: createLevelLoader(deps), serverChart };
}

const catalogLevel = (sha, extra = {}) => ({
    id: 7, title: 'Neon', audio_sha256: sha, has_chart: true, chart_version: 1, generator_seed: '11', ...extra,
});

const localFile = () => ({ name: 'Mi canción.mp3', arrayBuffer: async () => MP3_BYTES.slice().buffer });

test('catálogo, primera partida: descarga audio y chart, NO analiza', async () => {
    const { sha, calls, loader } = await makeWorld();
    const stages = [];
    const out = await loader.loadCatalog(catalogLevel(sha), { onStage: (s) => stages.push(s) });

    assert.deepEqual(calls, { fetchAudio: 1, getJson: 1, decode: 1, analyze: 0 });
    assert.equal(out.levelId, 7);
    assert.equal(out.sha256, sha);
    assert.equal(out.analysis, null, 'el chart vino hecho del servidor');
    assert.ok(stages.includes(LOAD_STAGE.DOWNLOADING));
    assert.ok(!stages.includes(LOAD_STAGE.ANALYZING));
});

test('catálogo, reintento inmediato: cero red, cero decodificación, cero análisis', async () => {
    const { sha, calls, loader } = await makeWorld();
    await loader.loadCatalog(catalogLevel(sha));
    const out = await loader.loadCatalog(catalogLevel(sha));

    assert.deepEqual(calls, { fetchAudio: 1, getJson: 1, decode: 1, analyze: 0 });
    assert.deepEqual(out.fromCache, { decoded: true, audio: false, analysis: false, chart: true });
});

test('catálogo tras recargar la página: audio y chart salen de la caché persistente', async () => {
    const world = await makeWorld();
    await world.loader.loadCatalog(catalogLevel(world.sha));

    // Loader nuevo (memoria de la pestaña perdida) con la MISMA caché persistente.
    const reloaded = createLevelLoader(world.deps);
    const out = await reloaded.loadCatalog(catalogLevel(world.sha));

    assert.equal(world.calls.fetchAudio, 1, 'sin segunda descarga');
    assert.equal(world.calls.getJson, 1, 'sin segunda petición del chart');
    assert.equal(world.calls.decode, 2, 'decodificar sí hace falta: el AudioBuffer no se persiste');
    assert.deepEqual(out.fromCache, { decoded: false, audio: true, analysis: false, chart: true });
});

test('una versión nueva del chart en el servidor invalida la cacheada', async () => {
    const { sha, calls, loader } = await makeWorld();
    await loader.loadCatalog(catalogLevel(sha, { chart_version: 1 }));
    await loader.loadCatalog(catalogLevel(sha, { chart_version: 2 }));
    assert.equal(calls.getJson, 2);
});

test('si el audio descargado no coincide con el hash del nivel, se rechaza', async () => {
    const { calls, loader } = await makeWorld();
    await assert.rejects(
        loader.loadCatalog(catalogLevel('0'.repeat(64))),
        (err) => err instanceof LevelLoadError && err.code === 'audio_mismatch',
    );
    assert.equal(calls.decode, 0, 'no se llega a decodificar un audio que no casa con su chart');
});

test('nivel anterior a la Ola 3 (sin chart): se genera igual para todos con su seed', async () => {
    const { sha, calls, loader } = await makeWorld();
    const legacy = { id: 3, title: 'Viejo', audio_sha256: null, has_chart: false, chart_version: null, generator_seed: '-1234' };
    const a = await loader.loadCatalog(legacy);
    assert.equal(calls.getJson, 0);
    assert.equal(calls.analyze, 1);
    assert.equal(a.chart.seed, -1234, 'la seed del nivel se respeta: mismo chart para cualquier jugador');
    assert.equal(a.sha256, sha, 'el hash se calcula de los bytes descargados');

    const again = await createLevelLoader({ ...(await makeWorld()).deps }).loadCatalog(legacy);
    assert.deepEqual(again.chart.events, a.chart.events);
});

test('chart del servidor ilegible: se cae a generarlo localmente sin romper', async () => {
    const { sha, calls, loader } = await makeWorld({
        async getJson() { return { ok: true, status: 200, data: { formatVersion: 99 } }; },
    });
    const out = await loader.loadCatalog(catalogLevel(sha));
    assert.equal(calls.analyze, 1);
    assert.ok(out.chart.events.length > 0);
});

test('archivo local: el segundo intento con el mismo MP3 no vuelve a analizar', async () => {
    const { sha, calls, loader } = await makeWorld();
    const first = await loader.loadLocal(localFile());
    assert.equal(first.title, 'Mi canción');
    assert.equal(first.levelId, null);
    assert.equal(first.sha256, sha);
    assert.equal(calls.analyze, 1);

    const second = await createLevelLoader((await makeWorldWithCache(first)).deps).loadLocal(localFile());
    assert.equal(second.fromCache.analysis, true);
    assert.deepEqual(second.chart, first.chart, 'mismo archivo ⇒ mismo nivel');
});

test('archivo local: nunca pide nada a la red', async () => {
    const { calls, loader } = await makeWorld();
    await loader.loadLocal(localFile());
    assert.equal(calls.fetchAudio, 0);
    assert.equal(calls.getJson, 0);
});

test('audio que no se puede decodificar: error claro, sin caché envenenada', async () => {
    const { calls, loader, deps } = await makeWorld({
        async decode() { throw new Error('EncodingError'); },
    });
    await assert.rejects(loader.loadLocal(localFile()), (e) => e instanceof LevelLoadError && e.code === 'decode_failed');
    assert.equal(calls.analyze, 0);
    assert.equal(await deps.cache.getAnalysis(await sha256Hex(MP3_BYTES), 'daino-flux-js@1'), null);
});

test('el nivel ya no existe en el servidor: error not_found', async () => {
    const { loader } = await makeWorld({ async fetchAudio() { return new Response('', { status: 404 }); } });
    await assert.rejects(loader.loadCatalog(catalogLevel('f'.repeat(64))), (e) => e.code === 'not_found');
});

test('una caché rota nunca impide jugar', async () => {
    const broken = {
        kind: 'broken',
        getAudio: async () => null, putAudio: async () => {},
        getAnalysis: async () => null, putAnalysis: async () => {},
        getChart: async () => null, putChart: async () => {},
    };
    const { sha, loader } = await makeWorld({ cache: broken });
    const out = await loader.loadCatalog(catalogLevel(sha));
    assert.ok(out.chart.events.length > 0);
});

/** Mundo nuevo que comparte la caché (con el análisis) del resultado previo. */
async function makeWorldWithCache(previous) {
    const world = await makeWorld();
    await world.deps.cache.putAnalysis(previous.sha256, 'daino-flux-js@1', previous.analysis);
    return world;
}
