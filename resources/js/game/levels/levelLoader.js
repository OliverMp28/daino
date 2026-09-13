// Cargador de niveles — de "quiero jugar esto" a audio + chart listos (Ola 3).
//
// Un único sitio decide, para cada partida, qué se puede sacar de caché, qué
// hay que descargar y qué hay que analizar. Antes esa lógica estaba repartida
// entre upload.js, modals.js y AppController, y ninguno cacheaba nada: cada
// partida repetía descarga, decodificación y análisis enteros.
//
// Dos orígenes:
//   - loadCatalog(level)  Nivel del servidor. Audio y chart vienen de la red la
//                         primera vez y de IndexedDB después. El jugador no
//                         analiza nunca si el nivel ya tiene chart publicado.
//   - loadLocal(file)     "Probar mi canción". El análisis (lo caro) se cachea
//                         por hash del archivo: soltar el mismo MP3 otra vez no
//                         lo vuelve a analizar.
//
// Todas las dependencias se inyectan (red, decodificador, analizador, caché,
// hash). Así el orden de operaciones y las decisiones de caché se prueban en
// Node sin navegador, sin servidor y sin audio real.

import { ANALYZER_KEY, isUsableAnalysis } from './analyze.js';
import { normalizeChart, seedFromSha256 } from './chartFormat.js';
import { catalogChartKey } from '../../storage/levelCache.js';

/** Fases que el cargador anuncia; la UI decide cómo mostrarlas. */
export const LOAD_STAGE = Object.freeze({
    READING: 'reading',
    DOWNLOADING: 'downloading',
    DECODING: 'decoding',
    ANALYZING: 'analyzing',
    CHARTING: 'charting',
});

export class LevelLoadError extends Error {
    /**
     * @param {'network'|'not_found'|'audio_mismatch'|'decode_failed'} code
     * @param {string} message
     * @param {unknown} [cause]
     */
    constructor(code, message, cause) {
        super(message);
        this.name = 'LevelLoadError';
        this.code = code;
        this.cause = cause;
    }
}

/**
 * @typedef {Object} LoadedLevel
 * @property {AudioBuffer} audioBuffer
 * @property {import('./chartFormat.js').Chart} chart
 * @property {import('./analyze.js').Analysis | null} analysis  null si el chart vino hecho.
 * @property {string} sha256
 * @property {string} title
 * @property {number | null} levelId
 * @property {{ decoded: boolean, audio: boolean, analysis: boolean, chart: boolean }} fromCache
 */

/**
 * @param {object} deps
 * @param {import('../../storage/levelCache.js').LevelCache} deps.cache
 * @param {(url: string) => Promise<Response>} deps.fetchAudio  GET binario (sin auth: solo niveles públicos).
 * @param {(path: string) => Promise<{ ok: boolean, status: number, data: any }>} deps.getJson  GET JSON de la API.
 * @param {(bytes: ArrayBuffer) => Promise<AudioBuffer>} deps.decode
 * @param {(audioBuffer: AudioBuffer, opts: { onProgress?: (r: number) => void }) => Promise<object>} deps.analyze
 * @param {(analysis: object, opts: { seed?: number, sha256?: string }) => { chart: object }} deps.buildChart
 * @param {(bytes: ArrayBuffer) => Promise<string>} deps.hash
 */
export function createLevelLoader(deps) {
    const { cache, fetchAudio, getJson, decode, analyze, buildChart, hash } = deps;

    /**
     * Último audio decodificado, en memoria. Un AudioBuffer de 3-4 min ocupa
     * decenas de MB, así que se guarda UNO: cubre el caso más frecuente con
     * diferencia (morir y reintentar la misma canción) sin disparar la memoria.
     * @type {{ sha: string, audioBuffer: AudioBuffer } | null}
     */
    let lastDecoded = null;

    async function decodeOnce(sha, bytes, onStage, fromCache) {
        if (lastDecoded !== null && lastDecoded.sha === sha) {
            fromCache.decoded = true;
            return lastDecoded.audioBuffer;
        }
        onStage(LOAD_STAGE.DECODING);
        let audioBuffer;
        try {
            audioBuffer = await decode(bytes);
        } catch (err) {
            throw new LevelLoadError('decode_failed', 'No se pudo decodificar el audio. ¿Es un MP3 válido?', err);
        }
        lastDecoded = { sha, audioBuffer };
        return audioBuffer;
    }

    async function analysisFor(sha, audioBuffer, onStage, fromCache) {
        const cached = await cache.getAnalysis(sha, ANALYZER_KEY);
        if (isUsableAnalysis(cached)) {
            fromCache.analysis = true;
            return cached;
        }
        onStage(LOAD_STAGE.ANALYZING, 0);
        const analysis = await analyze(audioBuffer, {
            onProgress: (ratio) => onStage(LOAD_STAGE.ANALYZING, ratio),
        });
        await cache.putAnalysis(sha, ANALYZER_KEY, analysis);
        return analysis;
    }

    return {
        /**
         * @param {File | { name: string, arrayBuffer: () => Promise<ArrayBuffer> }} file
         * @param {{ onStage?: (stage: string, progress?: number) => void, seed?: number }} [opts]
         * @returns {Promise<LoadedLevel>}
         */
        async loadLocal(file, opts = {}) {
            const onStage = opts.onStage ?? noop;
            const fromCache = { decoded: false, audio: false, analysis: false, chart: false };

            onStage(LOAD_STAGE.READING);
            const bytes = await file.arrayBuffer();
            // Hash ANTES de decodificar: decodeAudioData desengancha el buffer.
            const sha256 = await hash(bytes);

            const audioBuffer = await decodeOnce(sha256, bytes, onStage, fromCache);
            const analysis = await analysisFor(sha256, audioBuffer, onStage, fromCache);

            onStage(LOAD_STAGE.CHARTING);
            const { chart: built } = buildChart(analysis, { seed: opts.seed, sha256 });
            const { chart } = normalizeChart(built);

            return {
                audioBuffer, chart, analysis, sha256,
                title: stripExtension(file.name),
                levelId: null,
                fromCache,
            };
        },

        /**
         * @param {{ id: number, title: string, audio_sha256?: string|null,
         *           has_chart?: boolean, chart_version?: number|null,
         *           generator_seed?: string }} level  Fila del catálogo (GET /api/levels).
         * @param {{ onStage?: (stage: string, progress?: number) => void }} [opts]
         * @returns {Promise<LoadedLevel>}
         */
        async loadCatalog(level, opts = {}) {
            const onStage = opts.onStage ?? noop;
            const fromCache = { decoded: false, audio: false, analysis: false, chart: false };
            const expectedSha = typeof level.audio_sha256 === 'string' ? level.audio_sha256 : null;

            // --- Audio: memoria → IndexedDB → red ---
            let sha256 = expectedSha;
            let audioBuffer = null;
            if (expectedSha !== null && lastDecoded?.sha === expectedSha) {
                audioBuffer = lastDecoded.audioBuffer;
                fromCache.decoded = true;
            } else {
                let bytes = expectedSha !== null ? await cache.getAudio(expectedSha) : null;
                if (bytes !== null) {
                    fromCache.audio = true;
                } else {
                    bytes = await download(`/api/levels/${level.id}/file`, onStage);
                    const actual = await hash(bytes);
                    if (expectedSha !== null && actual !== expectedSha) {
                        // El servidor sirvió otro archivo del que el nivel
                        // dice tener: su chart no casaría con este audio.
                        throw new LevelLoadError('audio_mismatch', 'El audio descargado no coincide con el del nivel.');
                    }
                    sha256 = actual;
                    await cache.putAudio(sha256, bytes);
                }
                audioBuffer = await decodeOnce(sha256, bytes, onStage, fromCache);
            }

            // --- Chart: IndexedDB → servidor → generarlo aquí ---
            let chart = null;
            let analysis = null;
            if (level.has_chart === true && Number.isInteger(level.chart_version)) {
                const key = catalogChartKey(level.id, level.chart_version);
                chart = tryNormalize(await cache.getChart(key));
                if (chart !== null) {
                    fromCache.chart = true;
                } else {
                    const res = await getJson(`/api/levels/${level.id}/chart`);
                    if (res.ok) {
                        chart = tryNormalize(res.data);
                        if (chart !== null) await cache.putChart(key, chart);
                    }
                }
            }

            if (chart === null) {
                // Nivel publicado antes de la Ola 3 (sin chart en el servidor)
                // o chart ilegible. Se genera en el cliente con la seed del
                // nivel, así que todos los jugadores obtienen el mismo.
                analysis = await analysisFor(sha256, audioBuffer, onStage, fromCache);
                onStage(LOAD_STAGE.CHARTING);
                const seed = parseSeed(level.generator_seed) ?? seedFromSha256(sha256);
                chart = normalizeChart(buildChart(analysis, { seed, sha256 }).chart).chart;
            }

            return {
                audioBuffer, chart, analysis, sha256,
                title: level.title,
                levelId: level.id,
                fromCache,
            };
        },
    };

    async function download(url, onStage) {
        onStage(LOAD_STAGE.DOWNLOADING, 0);
        let res;
        try {
            res = await fetchAudio(url);
        } catch (err) {
            throw new LevelLoadError('network', 'No hay conexión con el servidor.', err);
        }
        if (res.status === 404) throw new LevelLoadError('not_found', 'El nivel ya no está disponible.');
        if (!res.ok) throw new LevelLoadError('network', `El servidor respondió ${res.status}.`);

        const total = Number(res.headers.get('Content-Length')) || 0;
        if (res.body === null || total === 0 || typeof res.body.getReader !== 'function') {
            const buf = await res.arrayBuffer();
            onStage(LOAD_STAGE.DOWNLOADING, 1);
            return buf;
        }

        // Lectura en streaming solo para poder informar del progreso real.
        const reader = res.body.getReader();
        const out = new Uint8Array(total);
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (received + value.length > out.length) {
                // Content-Length mentía (compresión intermedia): acumular sin techo.
                return concatRemaining(out.subarray(0, received), value, reader, onStage);
            }
            out.set(value, received);
            received += value.length;
            onStage(LOAD_STAGE.DOWNLOADING, received / total);
        }
        return out.buffer.slice(0, received);
    }
}

async function concatRemaining(head, chunk, reader, onStage) {
    const parts = [head, chunk];
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
    }
    const size = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(size);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    onStage(LOAD_STAGE.DOWNLOADING, 1);
    return out.buffer;
}

function tryNormalize(raw) {
    if (raw === null || raw === undefined) return null;
    try {
        const { chart, warnings } = normalizeChart(raw);
        if (warnings.length > 0) console.warn('[levelLoader] chart con avisos:', warnings);
        return chart;
    } catch (err) {
        console.warn('[levelLoader] chart descartado:', err.message);
        return null;
    }
}

function parseSeed(raw) {
    if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n | 0 : null;
}

function stripExtension(name) {
    const base = String(name ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').trim();
    return base === '' ? 'Canción sin título' : base;
}

function noop() {}
