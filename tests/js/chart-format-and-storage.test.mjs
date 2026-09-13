// Formato de chart, hash y caché de niveles (Ola 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import {
    ChartError,
    CHART_FORMAT_VERSION,
    compactChart,
    normalizeChart,
    obstacleEvents,
    seedFromSha256,
} from '../../resources/js/game/levels/chartFormat.js';
import { sha256Fallback, sha256Hex } from '../../resources/js/storage/hash.js';
import { catalogChartKey, createMemoryLevelCache } from '../../resources/js/storage/levelCache.js';

const validChart = () => ({
    formatVersion: 1,
    charter: { name: 'daino-charter', version: 1 },
    seed: 42,
    audio: { sha256: 'a'.repeat(64), durationSec: 60, sampleRate: 44100 },
    music: { bpm: 128, bpmConfidence: 0.9, beatPeriodS: 0.46875 },
    world: { speedPxS: 436 },
    events: [
        { t: 4.2, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 3.1, type: 'obstacle', kind: 'PTERO' },
    ],
});

// --------------------------- normalizeChart ---------------------------

test('normaliza un chart válido y ordena los eventos por t', () => {
    const { chart, warnings } = normalizeChart(validChart());
    assert.deepEqual(warnings, []);
    assert.deepEqual(chart.events.map((e) => e.t), [3.1, 4.2]);
    assert.equal(chart.audio.sha256, 'a'.repeat(64));
});

test('rechaza lo que no se puede jugar con seguridad', () => {
    const cases = [
        [null, 'no objeto'],
        [[], 'array'],
        [{ ...validChart(), formatVersion: CHART_FORMAT_VERSION + 1 }, 'formato futuro'],
        [{ ...validChart(), formatVersion: '1' }, 'versión como texto'],
        [{ ...validChart(), audio: { durationSec: -1 } }, 'duración negativa'],
        [{ ...validChart(), world: { speedPxS: Number.NaN } }, 'velocidad NaN'],
        [{ ...validChart(), world: { speedPxS: 99999 } }, 'velocidad absurda'],
        [{ ...validChart(), events: 'x' }, 'events no es array'],
        [{ ...validChart(), events: new Array(20_001).fill({ t: 1, type: 'obstacle', kind: 'PTERO' }) }, 'demasiados eventos'],
    ];
    for (const [raw, label] of cases) {
        assert.throws(() => normalizeChart(raw), ChartError, label);
    }
});

test('descarta obstáculos de kind desconocido en vez de reventar la partida', () => {
    const raw = validChart();
    raw.events.push({ t: 5, type: 'obstacle', kind: 'DRAGON' });
    raw.events.push({ t: 6, type: 'obstacle' });
    const { chart, warnings } = normalizeChart(raw);
    assert.equal(obstacleEvents(chart).length, 2);
    assert.equal(warnings.length, 1);
});

test('descarta eventos mal formados o fuera de la canción', () => {
    const raw = validChart();
    raw.events.push({ t: 'mañana', type: 'obstacle', kind: 'PTERO' });
    raw.events.push({ t: 61, type: 'obstacle', kind: 'PTERO' });
    raw.events.push(null);
    const { chart, warnings } = normalizeChart(raw);
    assert.equal(chart.events.length, 2);
    assert.match(warnings.join(), /mal formados/);
});

test('conserva tipos de evento futuros (tolerancia hacia delante)', () => {
    const raw = validChart();
    raw.events.push({ t: 30, type: 'section', label: 'chorus' });
    const { chart } = normalizeChart(raw);
    assert.equal(chart.events.length, 3);
    assert.deepEqual(chart.events.find((e) => e.type === 'section'), { t: 30, type: 'section', label: 'chorus' });
    assert.equal(obstacleEvents(chart).length, 2, 'el runtime solo juega obstáculos');
});

test('no muta la entrada', () => {
    const raw = validChart();
    const before = JSON.stringify(raw);
    normalizeChart(raw);
    assert.equal(JSON.stringify(raw), before);
});

test('compactChart redondea los tiempos a 1 ms y reduce el payload', () => {
    const raw = validChart();
    raw.events = [];
    for (let i = 0; i < 300; i++) raw.events.push({ t: 3 + i / 86.1328125, type: 'obstacle', kind: 'CACTUS_SMALL' });
    const compact = compactChart(normalizeChart(raw).chart);
    for (const e of compact.events) {
        assert.ok(/^\d+(\.\d{1,3})?$/.test(String(e.t)), `t=${e.t} con más de 3 decimales`);
    }
    // Tiempos crudos de 17 dígitos → 4-5 dígitos: ~12 bytes menos por evento.
    const saved = (JSON.stringify(raw).length - JSON.stringify(compact).length) / raw.events.length;
    assert.ok(saved >= 10, `solo ${saved.toFixed(1)} bytes ahorrados por evento`);
});

test('seedFromSha256 es estable y de 32 bits con signo', () => {
    const sha = 'ffffffff' + '0'.repeat(56);
    assert.equal(seedFromSha256(sha), -1);
    assert.equal(seedFromSha256('00000001' + '0'.repeat(56)), 1);
});

// --------------------------- hash ---------------------------

test('SHA-256: el fallback cumple los vectores FIPS 180-2 y coincide con el nativo', async () => {
    const enc = new TextEncoder();
    const hex = (b) => Buffer.from(b).toString('hex');
    assert.equal(hex(sha256Fallback(enc.encode(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(hex(sha256Fallback(enc.encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(
        hex(sha256Fallback(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    // Longitudes en los bordes del bloque de 64 bytes, donde falla el relleno.
    for (const n of [55, 56, 63, 64, 65, 119, 120, 4096]) {
        const b = randomBytes(n);
        assert.equal(hex(sha256Fallback(b)), createHash('sha256').update(b).digest('hex'), `longitud ${n}`);
        assert.equal(await sha256Hex(b), createHash('sha256').update(b).digest('hex'));
    }
});

// --------------------------- caché ---------------------------

test('la caché devuelve lo guardado y copias independientes del audio', async () => {
    const cache = createMemoryLevelCache();
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await cache.putAudio('s1', bytes);

    const first = await cache.getAudio('s1');
    // Quien la usa puede desenganchar (detach) el buffer al decodificar; la
    // entrada cacheada no debe verse afectada.
    new Uint8Array(first).fill(0);
    assert.deepEqual([...new Uint8Array(await cache.getAudio('s1'))], [1, 2, 3, 4]);
    assert.equal(await cache.getAudio('nope'), null);

    await cache.putAnalysis('s1', 'a@1', { x: 1 });
    assert.deepEqual(await cache.getAnalysis('s1', 'a@1'), { x: 1 });
    assert.equal(await cache.getAnalysis('s1', 'a@2'), null, 'otra versión del analizador no comparte entrada');

    await cache.putChart(catalogChartKey(7, 1), { c: 1 });
    assert.deepEqual(await cache.getChart('level:7:v1'), { c: 1 });
    assert.equal(await cache.getChart('level:7:v2'), null, 'una versión nueva del chart no pisa la vieja');
});

test('la caché desaloja lo menos usado al pasar del presupuesto', async () => {
    const cache = createMemoryLevelCache({ limits: { audioMaxEntries: 2, audioMaxBytes: 1000 } });
    await cache.putAudio('a', new Uint8Array(10));
    await cache.putAudio('b', new Uint8Array(10));
    await cache.getAudio('a');                    // 'a' pasa a ser el más reciente
    await cache.putAudio('c', new Uint8Array(10)); // desaloja 'b'
    assert.notEqual(await cache.getAudio('a'), null);
    assert.equal(await cache.getAudio('b'), null);
    assert.notEqual(await cache.getAudio('c'), null);

    const bySize = createMemoryLevelCache({ limits: { audioMaxEntries: 100, audioMaxBytes: 25 } });
    await bySize.putAudio('x', new Uint8Array(10));
    await bySize.putAudio('y', new Uint8Array(10));
    await bySize.putAudio('z', new Uint8Array(10));   // 30 > 25: sale 'x'
    assert.equal(await bySize.getAudio('x'), null);
    assert.notEqual(await bySize.getAudio('z'), null);
});
