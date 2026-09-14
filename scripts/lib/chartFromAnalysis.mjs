// Análisis → chart + estadísticas + dificultad + techo. Punto único que usan el
// horneado de oficiales y el worker del analizador (vía chart-from-analysis.mjs),
// para que un nivel se chartee igual venga de donde venga.
//
// Misma seed que el navegador con ese archivo (la derivada del hash): el chart
// de un nivel es el mismo lo genere quien lo genere.
//
// Ola 5: la dificultad es un parámetro. `difficulty` es la que pidió quien subió
// la canción ('auto' o 1-5); la efectiva nunca supera el techo de la canción.

import { buildChart } from '../../resources/js/game/levels/charter.js';
import { normalizeChart, seedFromSha256 } from '../../resources/js/game/levels/chartFormat.js';
import { chartStats, difficultyFromStats, difficultyScore } from '../../resources/js/game/levels/chartStats.js';
import { difficultyCeiling } from '../../resources/js/game/levels/difficultyCeiling.js';
import { difficultyOptions, normalizeRequestedDifficulty } from '../../resources/js/game/levels/difficulty.js';

/**
 * @param {object} analysis
 * @param {string} sha256
 * @param {{ difficulty?: 'auto' | number | string | null }} [opts]
 */
export function chartFromAnalysis(analysis, sha256, opts = {}) {
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error('sha256 inválido');
    }
    const requested = normalizeRequestedDifficulty(opts.difficulty ?? 'auto');
    const { chart: built, report } = buildChart(analysis, { sha256, seed: seedFromSha256(sha256), difficulty: requested });
    const { chart, warnings } = normalizeChart(built);
    if (warnings.length > 0) throw new Error(`el charter produjo un chart con avisos: ${warnings.join('; ')}`);
    const stats = chartStats(chart);
    const ceiling = difficultyCeiling(analysis);
    return {
        chart: built,
        report,
        stats: { ...stats, score: difficultyScore(stats) },
        /** Dificultad efectiva del nivel (la que se guarda y se enseña). */
        difficulty: report.difficulty,
        requestedDifficulty: requested,
        /** Comprobación independiente: estrellas que mide el chart generado. */
        measuredDifficulty: difficultyFromStats(stats),
        difficultyCeiling: ceiling?.ceiling ?? null,
        difficultyOptions: difficultyOptions(analysis).options,
        musicalDensity: ceiling?.density ?? null,
    };
}
