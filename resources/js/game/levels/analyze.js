// Análisis de audio — los HECHOS musicales de una canción, sin decisiones de juego.
//
// Ola 3: primera mitad de la separación ANÁLISIS / CHARTING acordada en el
// doc 10 §2.1. Este módulo responde "¿qué pasa en la canción?" (tempo, dónde
// suenan los golpes y con qué fuerza). No sabe nada de cactus, velocidades ni
// dificultad — eso es el charter.
//
// Por qué partirlo:
//   - El análisis es lo CARO (FFT sobre toda la canción); el charting cuesta
//     milisegundos. Separarlos permite cachear el análisis por hash del audio
//     y re-chartear gratis: otra seed, otra dificultad, un charter mejorado.
//   - La Ola 4 sustituye este análisis por uno en servidor (Python). Si ambos
//     producen este mismo esquema, el charter no cambia ni una línea.
//
// El resultado es un objeto JSON plano (sin Float32Array ni referencias al
// AudioBuffer), apto para IndexedDB y para enviarse al servidor.

import { computeOnsetEnvelope, pickOnsets } from './SpectralFlux.js';
import { detectBpm } from './Bpm.js';

export const ANALYSIS_FORMAT_VERSION = 1;
export const ANALYZER_NAME = 'daino-flux-js';

/**
 * Versión del analizador. Súbela si cambia algo que altere los onsets o el
 * tempo detectados para el mismo audio: invalida las caches de análisis.
 */
export const ANALYZER_VERSION = 1;

/** Clave estable para cachear el análisis de un audio con este analizador. */
export const ANALYZER_KEY = `${ANALYZER_NAME}@${ANALYZER_VERSION}`;

/** Parámetros del detector de picos. Forman parte de la versión del analizador. */
const PEAK_OPTS = Object.freeze({ thresholdRatio: 1.5, windowSec: 0.4 });

/**
 * @typedef {Object} Analysis
 * @property {number} formatVersion
 * @property {{ name: string, version: number }} analyzer
 * @property {number} durationSec
 * @property {number} sampleRate
 * @property {number} bpm
 * @property {number} bpmConfidence
 * @property {number} beatPeriodS
 * @property {Array<[number, number]>} onsets  Pares [t, fuerza], t en segundos
 *           de canción YA corregidos por la latencia del detector, ordenados.
 */

/**
 * @param {{ numberOfChannels: number, length: number, sampleRate: number,
 *           duration: number, getChannelData: (c: number) => Float32Array }} audioBuffer
 *        Un AudioBuffer o cualquier objeto con esa forma (los tests usan uno sintético).
 * @param {{ onProgress?: (ratio: number) => void, yieldEvery?: number }} [opts]
 * @returns {Promise<Analysis>}
 */
export async function analyzeAudio(audioBuffer, opts = {}) {
    const env = await computeOnsetEnvelope(audioBuffer, {
        onProgress: opts.onProgress,
        yieldEvery: opts.yieldEvery,
    });
    const { bpm, confidence } = detectBpm(env);

    const durationSec = audioBuffer.duration;
    const onsets = [];
    for (const o of pickOnsets(env, PEAK_OPTS)) {
        const t = o.t + env.latencyS;
        if (t > durationSec) break;
        onsets.push([round3(t), round3(o.strength)]);
    }

    return {
        formatVersion: ANALYSIS_FORMAT_VERSION,
        analyzer: { name: ANALYZER_NAME, version: ANALYZER_VERSION },
        durationSec,
        sampleRate: audioBuffer.sampleRate,
        bpm,
        bpmConfidence: confidence,
        beatPeriodS: 60 / bpm,
        onsets,
    };
}

/**
 * Comprueba que un objeto tiene forma de análisis utilizable. Se usa al leerlo
 * de una caché: si una versión anterior guardó otra forma, se descarta y se
 * vuelve a analizar en vez de romper el charter.
 *
 * @param {unknown} a
 * @returns {a is Analysis}
 */
export function isUsableAnalysis(a) {
    return a !== null
        && typeof a === 'object'
        && a.formatVersion === ANALYSIS_FORMAT_VERSION
        && a.analyzer?.name === ANALYZER_NAME
        && a.analyzer?.version === ANALYZER_VERSION
        && Number.isFinite(a.durationSec) && a.durationSec > 0
        && Number.isFinite(a.bpm) && a.bpm > 0
        && Array.isArray(a.onsets);
}

/**
 * ¿Puede el charter trabajar con este análisis, venga del analizador que venga?
 * Formato 1 (este analizador) o 2 (el del servidor, Ola 4, con beats, secciones
 * y rasgos). A diferencia de `isUsableAnalysis`, no exige que lo haya producido
 * ESTE analizador: es la comprobación de los análisis horneados o guardados en
 * el servidor, no la de la caché local.
 *
 * @param {unknown} a
 * @returns {boolean}
 */
export function isChartableAnalysis(a) {
    return a !== null
        && typeof a === 'object'
        && (a.formatVersion === 1 || (a.formatVersion === 2 && Array.isArray(a.beats)))
        && typeof a.analyzer?.name === 'string'
        && Number.isInteger(a.analyzer?.version)
        && Number.isFinite(a.durationSec) && a.durationSec > 0
        && Number.isFinite(a.bpm) && a.bpm > 0
        && Array.isArray(a.onsets);
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
