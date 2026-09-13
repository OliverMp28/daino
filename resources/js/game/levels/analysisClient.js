// Análisis local fuera del hilo principal (Ola 4, doc 10 §Ola 4).
//
// Mismo contrato que `analyzeAudio(audioBuffer, { onProgress })`, pero el
// trabajo pesado (la FFT de toda la canción) corre en un Web Worker. El hilo
// principal solo mezcla a mono (una pasada lineal) y TRANSFIERE ese buffer: no
// se copia el audio dos veces ni se toca el AudioBuffer que va a sonar.
//
// Degradación: si el navegador no puede crear el Worker, o el Worker se cae,
// se analiza en el hilo principal (con yields) y el resultado es idéntico. La
// caída se recuerda: no se reintenta un Worker roto en cada canción.
//
// Todo inyectable para probarlo en Node (tests/js/analysis-worker.test.mjs).

import { mixToMono } from './SpectralFlux.js';

/**
 * @typedef {{ postMessage: (msg: any, transfer?: Transferable[]) => void,
 *             addEventListener: (type: string, fn: (ev: any) => void) => void,
 *             terminate: () => void }} WorkerLike
 */

/**
 * @param {{
 *   spawn: (() => WorkerLike) | null,
 *   analyzeInline: (audioBuffer: object, opts: { onProgress?: (r: number) => void }) => Promise<object>,
 * }} deps
 */
export function createWorkerAnalyzer({ spawn, analyzeInline }) {
    /** @type {WorkerLike | null} */
    let worker = null;
    let broken = spawn === null;
    let nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, onProgress?: Function }>} */
    const pending = new Map();

    function fail(reason) {
        broken = true;
        try { worker?.terminate(); } catch { /* ya muerto */ }
        worker = null;
        const waiting = [...pending.values()];
        pending.clear();
        for (const p of waiting) p.reject(reason);
    }

    function ensureWorker() {
        if (worker !== null || broken) return worker;
        try {
            worker = spawn();
        } catch (err) {
            fail(err);
            return null;
        }
        worker.addEventListener('message', (ev) => {
            const msg = ev.data ?? {};
            const p = pending.get(msg.id);
            if (p === undefined) return;
            if (msg.type === 'progress') {
                p.onProgress?.(msg.ratio);
            } else if (msg.type === 'result') {
                pending.delete(msg.id);
                p.resolve(msg.analysis);
            } else if (msg.type === 'error') {
                // Un error DEL ANÁLISIS (audio raro) no es un Worker roto: se
                // propaga igual que lo haría analyzeAudio en el hilo principal.
                pending.delete(msg.id);
                p.reject(new Error(msg.message));
            }
        });
        // Error de carga del script o excepción no capturada: el Worker no sirve.
        worker.addEventListener('error', (ev) => {
            ev?.preventDefault?.();
            fail(new WorkerUnavailable(ev?.message ?? 'worker error'));
        });
        worker.addEventListener('messageerror', () => fail(new WorkerUnavailable('messageerror')));
        return worker;
    }

    async function inWorker(audioBuffer, opts) {
        const w = ensureWorker();
        if (w === null) throw new WorkerUnavailable('sin worker');
        const samples = mixToMono(audioBuffer);
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject, onProgress: opts.onProgress });
            try {
                w.postMessage(
                    { id, samples, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration },
                    [samples.buffer],
                );
            } catch (err) {
                pending.delete(id);
                fail(new WorkerUnavailable(String(err)));
                reject(new WorkerUnavailable(String(err)));
            }
        });
    }

    return {
        /**
         * @param {object} audioBuffer  AudioBuffer (o su forma).
         * @param {{ onProgress?: (ratio: number) => void }} [opts]
         * @returns {Promise<object>}  el análisis
         */
        async analyze(audioBuffer, opts = {}) {
            if (!broken) {
                try {
                    return await inWorker(audioBuffer, opts);
                } catch (err) {
                    if (!(err instanceof WorkerUnavailable)) throw err;
                    // El Worker no está disponible: se hace aquí, sin fallar la partida.
                }
            }
            return analyzeInline(audioBuffer, opts);
        },

        /** ¿Corre (o correrá) el próximo análisis fuera del hilo principal? */
        get offThread() {
            return !broken;
        },

        dispose() {
            fail(new WorkerUnavailable('disposed'));
        },
    };
}

/**
 * Cómo arrancar un Worker de módulo desde `scriptUrl`.
 *
 * En desarrollo el JS lo sirve Vite desde otro origen (:5174) que la página
 * (:8090), y el navegador prohíbe crear un Worker con un script de otro origen
 * (SecurityError). Un Worker desde un Blob sí es del origen de la página, y un
 * módulo puede importar el script remoto (Vite responde con CORS). En producción
 * los assets salen del mismo origen y se usa el script directamente.
 *
 * @param {string} scriptUrl  absoluta
 * @param {string} pageOrigin `location.origin`
 * @returns {{ kind: 'direct', url: string } | { kind: 'blob', source: string }}
 */
export function workerBootstrap(scriptUrl, pageOrigin) {
    const url = new URL(scriptUrl);
    if (url.origin === pageOrigin) return { kind: 'direct', url: url.href };
    return { kind: 'blob', source: `import ${JSON.stringify(url.href)};\n` };
}

/**
 * El Worker del análisis local.
 *
 * La expresión `new Worker(new URL('./analysisWorker.js', import.meta.url), …)`
 * tiene que ir LITERAL: es el patrón que Vite reconoce para empaquetar el Worker
 * con sus imports. Con la URL construida en otra función, Vite la trataba como un
 * asset suelto (un `data:` sin sus imports) y en producción el Worker nunca
 * cargaba: todo se analizaba en el hilo principal sin que nada lo dijera.
 *
 * En desarrollo el script llega desde el servidor de Vite (otro origen) y el
 * constructor lanza SecurityError: se arranca desde un Blob ({@link workerBootstrap}).
 *
 * @returns {Worker}
 */
export function spawnAnalysisWorker() {
    try {
        return new Worker(new URL('./analysisWorker.js', import.meta.url), { type: 'module' });
    } catch (err) {
        if (import.meta.env && import.meta.env.DEV && err?.name === 'SecurityError') {
            return spawnModuleWorker(new URL('./analysisWorker.js', import.meta.url));
        }
        throw err;
    }
}

/**
 * Crea un Worker de módulo según {@link workerBootstrap}.
 * @param {URL | string} scriptUrl
 * @returns {Worker}
 */
export function spawnModuleWorker(scriptUrl) {
    const boot = workerBootstrap(String(scriptUrl), location.origin);
    if (boot.kind === 'direct') return new Worker(boot.url, { type: 'module' });
    const blobUrl = URL.createObjectURL(new Blob([boot.source], { type: 'text/javascript' }));
    try {
        return new Worker(blobUrl, { type: 'module' });
    } finally {
        // El Worker ya tiene su script: la URL del Blob no hace falta más.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    }
}

/** El Worker no se pudo usar; el análisis se repite en el hilo principal. */
export class WorkerUnavailable extends Error {
    constructor(message) {
        super(message);
        this.name = 'WorkerUnavailable';
    }
}
