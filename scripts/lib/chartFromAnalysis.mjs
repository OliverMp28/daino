// Análisis → chart + estadísticas + dificultad + techo. Punto único que usan el
// horneado de oficiales y el worker del analizador (vía chart-from-analysis.mjs),
// para que un nivel se chartee igual venga de donde venga.
//
// Misma seed que el navegador con ese archivo (la derivada del hash): el chart
// de un nivel es el mismo lo genere quien lo genere.

import { buildChart } from '../../resources/js/game/levels/charter.js';
import { normalizeChart, seedFromSha256 } from '../../resources/js/game/levels/chartFormat.js';
import { chartStats, difficultyFromStats, difficultyScore } from '../../resources/js/game/levels/chartStats.js';
import { difficultyCeiling } from '../../resources/js/game/levels/difficultyCeiling.js';

/**
 * @param {object} analysis
 * @param {string} sha256
 */
export function chartFromAnalysis(analysis, sha256) {
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error('sha256 inválido');
    }
    const { chart: built, report } = buildChart(analysis, { sha256, seed: seedFromSha256(sha256) });
    const { chart, warnings } = normalizeChart(built);
    if (warnings.length > 0) throw new Error(`el charter produjo un chart con avisos: ${warnings.join('; ')}`);
    const stats = chartStats(chart);
    const ceiling = difficultyCeiling(analysis);
    return {
        chart: built,
        report,
        stats: { ...stats, score: difficultyScore(stats) },
        difficulty: difficultyFromStats(stats),
        difficultyCeiling: ceiling?.ceiling ?? null,
        musicalDensity: ceiling?.density ?? null,
    };
}
