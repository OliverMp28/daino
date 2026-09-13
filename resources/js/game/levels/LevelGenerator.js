// LevelGenerator — fachada: audio → análisis → chart, en una llamada.
//
// Ola 3: el generador monolítico del Bloque 5 se partió en dos piezas con
// responsabilidades distintas (doc 10 §2.1):
//
//   analyze.js   Audio → hechos musicales (tempo, onsets). Caro. Cacheable
//                por hash del audio. Sustituible por el analizador de servidor.
//   charter.js   Hechos → chart jugable. Barato y puro. Regenerable siempre.
//
// Este módulo solo las encadena para quien tenga un AudioBuffer y quiera un
// chart sin gestionar cachés (tests, herramientas). El flujo del juego usa
// `levelLoader.js`, que sí cachea el análisis entre las dos fases.

import { analyzeAudio } from './analyze.js';
import { buildChart } from './charter.js';

/**
 * @param {AudioBuffer} audioBuffer
 * @param {{
 *   seed?: number,
 *   sha256?: string | null,
 *   onProgress?: (ratio: number) => void,
 *   yieldEvery?: number,
 * }} [opts]
 * @returns {Promise<{
 *   analysis: import('./analyze.js').Analysis,
 *   chart: import('./chartFormat.js').Chart,
 *   report: import('./charter.js').ChartReport,
 * }>}
 */
export async function generate(audioBuffer, opts = {}) {
    const analysis = await analyzeAudio(audioBuffer, {
        onProgress: opts.onProgress,
        yieldEvery: opts.yieldEvery,
    });
    const { chart, report } = buildChart(analysis, { seed: opts.seed, sha256: opts.sha256 ?? null });
    return { analysis, chart, report };
}
