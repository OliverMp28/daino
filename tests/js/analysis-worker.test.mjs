// Ola 4 — análisis local en Web Worker. Se ejecuta el script REAL del Worker
// (analysisWorker.js) dentro de este proceso con un `self` simulado y mensajería
// con structuredClone + transferencia, como haría el navegador.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeAudio } from '../../resources/js/game/levels/analyze.js';
import { createWorkerAnalyzer, workerBootstrap } from '../../resources/js/game/levels/analysisClient.js';
import { makeClickTrack } from './helpers/synthetic-audio.mjs';

// --------------------------- Worker simulado ---------------------------

const workerScope = new EventTarget();
let toClient = null;
globalThis.self = {
    addEventListener: (type, fn) => workerScope.addEventListener(type, fn),
    postMessage: (msg) => toClient(msg),
};
await import('../../resources/js/game/levels/analysisWorker.js');

/** Un "Worker" que habla con el script real por structuredClone, en otro turno. */
function fakeWorker({ crashAfterMessages = Infinity } = {}) {
    const client = new EventTarget();
    let sent = 0;
    let terminated = false;
    toClient = (msg) => {
        if (terminated) return;
        sent++;
        if (sent > crashAfterMessages) {
            terminated = true;
            setImmediate(() => client.dispatchEvent(Object.assign(new Event('error'), { message: 'crash' })));
            return;
        }
        const copy = structuredClone(msg);
        setImmediate(() => client.dispatchEvent(new MessageEvent('message', { data: copy })));
    };
    return {
        worker: {
            postMessage(msg, transfer) {
                const copy = structuredClone(msg, { transfer });
                setImmediate(() => workerScope.dispatchEvent(new MessageEvent('message', { data: copy })));
            },
            addEventListener: (type, fn) => client.addEventListener(type, fn),
            terminate() { terminated = true; },
        },
    };
}

/** Estéreo con canales DISTINTOS, para que la mezcla a mono importe de verdad. */
function stereoSong(bpm = 124, durationSec = 14) {
    const click = makeClickTrack({ bpm, durationSec, channels: 1 });
    const left = click.getChannelData(0);
    const right = new Float32Array(left.length);
    for (let i = 0; i < right.length; i++) right[i] = left[i] * 0.35 + 0.05 * Math.sin(i * 0.013);
    const channels = [left, right];
    return {
        numberOfChannels: 2,
        length: left.length,
        sampleRate: click.sampleRate,
        duration: left.length / click.sampleRate,
        getChannelData: (c) => channels[c],
    };
}

const inlineCalls = [];
const inline = async (buf, opts) => {
    inlineCalls.push(buf);
    return analyzeAudio(buf, { ...opts, yieldEvery: 0 });
};

// --------------------------- Tests ---------------------------

test('el Worker da EXACTAMENTE el análisis del hilo principal e informa del progreso', async () => {
    const song = stereoSong();
    const leftBefore = song.getChannelData(0).slice(0, 4096);
    const expected = await analyzeAudio(song, { yieldEvery: 0 });

    const { worker } = fakeWorker();
    let spawned = 0;
    const analyzer = createWorkerAnalyzer({ spawn: () => { spawned++; return worker; }, analyzeInline: inline });
    const progress = [];
    const got = await analyzer.analyze(song, { onProgress: (r) => progress.push(r) });

    assert.deepEqual(got, expected, 'mismos onsets, tempo y fuerza: la caché de análisis vale para ambos caminos');
    assert.equal(spawned, 1);
    assert.equal(analyzer.offThread, true);
    assert.ok(progress.length >= 2 && progress.some((r) => r > 0 && r < 1), `progreso intermedio: ${progress}`);
    assert.equal(progress.at(-1), 1);
    assert.deepEqual(song.getChannelData(0).slice(0, 4096), leftBefore, 'el AudioBuffer que va a sonar no se toca');

    // Otro análisis reutiliza el mismo Worker.
    await analyzer.analyze(stereoSong(96, 8));
    assert.equal(spawned, 1);
});

test('análisis simultáneos: cada respuesta vuelve a su petición', async () => {
    const { worker } = fakeWorker();
    const analyzer = createWorkerAnalyzer({ spawn: () => worker, analyzeInline: inline });
    const [a, b] = await Promise.all([analyzer.analyze(stereoSong(90, 10)), analyzer.analyze(stereoSong(150, 10))]);
    assert.ok(Math.abs(a.bpm - 90) < 2, `a: ${a.bpm}`);
    assert.ok(Math.abs(b.bpm - 150) < 3, `b: ${b.bpm}`);
});

test('sin Worker (no se puede crear) se analiza en el hilo principal', async () => {
    inlineCalls.length = 0;
    const song = stereoSong(120, 6);
    const failing = createWorkerAnalyzer({ spawn: () => { throw new Error('CSP'); }, analyzeInline: inline });
    const got = await failing.analyze(song);
    assert.deepEqual(got, await analyzeAudio(song, { yieldEvery: 0 }));
    assert.equal(inlineCalls.length, 1);
    assert.equal(failing.offThread, false, 'el render se congelará durante el análisis');

    const none = createWorkerAnalyzer({ spawn: null, analyzeInline: inline });
    assert.equal(none.offThread, false);
    await none.analyze(song);
    assert.equal(inlineCalls.length, 2);
});

test('si el Worker se cae a mitad, la partida no falla: se repite aquí y no se vuelve a intentar', async () => {
    inlineCalls.length = 0;
    const song = stereoSong(128, 12);
    const { worker } = fakeWorker({ crashAfterMessages: 1 });
    let spawned = 0;
    const analyzer = createWorkerAnalyzer({ spawn: () => { spawned++; return worker; }, analyzeInline: inline });

    const got = await analyzer.analyze(song);
    assert.deepEqual(got, await analyzeAudio(song, { yieldEvery: 0 }));
    assert.equal(inlineCalls.length, 1);
    assert.equal(analyzer.offThread, false);

    await analyzer.analyze(song);
    assert.equal(spawned, 1, 'un Worker roto no se recrea en cada canción');
});

test('arranque del Worker: directo en el mismo origen, desde Blob si el script viene de Vite (otro origen)', () => {
    const prod = workerBootstrap('https://daino.test/build/assets/analysisWorker-abc.js', 'https://daino.test');
    assert.deepEqual(prod, { kind: 'direct', url: 'https://daino.test/build/assets/analysisWorker-abc.js' });

    const dev = workerBootstrap('http://localhost:5174/resources/js/game/levels/analysisWorker.js', 'http://localhost:8090');
    assert.equal(dev.kind, 'blob');
    assert.equal(dev.source, 'import "http://localhost:5174/resources/js/game/levels/analysisWorker.js";\n');
    // La URL va escapada como literal JS: una comilla en la ruta no rompe el módulo.
    assert.match(workerBootstrap('http://localhost:5174/a"b.js', 'http://localhost:8090').source, /^import "http:\/\/localhost:5174\/a%22b\.js";/);
});

test('un error DEL análisis se propaga; el Worker sigue sirviendo', async () => {
    const { worker } = fakeWorker();
    const analyzer = createWorkerAnalyzer({ spawn: () => worker, analyzeInline: inline });
    const broken = { numberOfChannels: 1, length: 10, sampleRate: Number.NaN, duration: 1, getChannelData: () => new Float32Array(10) };
    await assert.rejects(analyzer.analyze(broken), /mal formada/);
    assert.equal(analyzer.offThread, true);
    const ok = await analyzer.analyze(stereoSong(110, 6));
    assert.ok(ok.bpm > 0);
});
