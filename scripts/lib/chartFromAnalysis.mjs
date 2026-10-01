// Análisis → chart + estadísticas + dificultad + techo. Punto único que usan el
// horneado de oficiales y el worker del analizador (vía chart-from-analysis.mjs),
// para que un nivel se chartee igual venga de donde venga.
//
// Misma seed que el navegador con ese archivo (la derivada del hash): el chart
// de un nivel es el mismo lo genere quien lo genere.
//
// Ola 5: la dificultad es un parámetro. `difficulty` es la que pidió quien subió
// la canción ('auto' o 1-5); la efectiva nunca supera el techo de la canción.
//
// `variants: true` (tras el playtest de la Ola 5): además, el chart de CADA
// dificultad que la canción admite ('auto' y 1..techo). Un nivel recién analizado
// queda listo para publicar con todas generadas, y su autor cambia entre ellas
// al instante, sin volver a pasar por la cola del analizador.
//
// T02.5: también el escenario Automático (scenes/sceneCasting.js): el ambiente
// que pega con cómo suena la canción, o null (la Cordillera). No toca el chart;
// va aquí porque es donde el servidor tiene su análisis.

import { buildChart } from '../../resources/js/game/levels/charter.js';
import { normalizeChart, seedFromSha256 } from '../../resources/js/game/levels/chartFormat.js';
import { chartStats, difficultyFromStats, difficultyScore } from '../../resources/js/game/levels/chartStats.js';
import { difficultyCeiling } from '../../resources/js/game/levels/difficultyCeiling.js';
import { DIFFICULTY_AUTO, difficultyOptions, normalizeRequestedDifficulty } from '../../resources/js/game/levels/difficulty.js';
import { castScene } from '../../resources/js/game/scenes/sceneCasting.js';
import { SCENES } from '../../resources/js/game/scenes/registry.js';
import { placeStory, songOutline } from '../../resources/js/game/scenes/stories/index.js';

/**
 * Ventanas sin acciones que pide la historia de autor de una escena (sus
 * `breaths`), en la canción de este chart. Salen de la estructura (secciones y
 * efectos), que no depende de los obstáculos.
 */
export function storyQuiet(chart, sceneId) {
    const story = SCENES[sceneId]?.story;
    if (!story || story.breaths.length === 0) return [];
    const outline = songOutline({
        durationSec: chart.audio.durationSec,
        sections: chart.events.filter((e) => e.type === 'section'),
        fx: chart.events.filter((e) => e.type === 'fx'),
    });
    return placeStory(story, outline).breaths.map((b) => ({ t0: b.t0, t1: b.t1 }));
}

/**
 * @param {object} analysis
 * @param {string} sha256
 * @param {{ difficulty?: 'auto' | number | string | null, variants?: boolean, scene?: string | null }} [opts]
 *        `scene`: el escenario de un oficial; si es una historia con respiros, el
 *        chart los respeta.
 */
export function chartFromAnalysis(analysis, sha256, opts = {}) {
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error('sha256 inválido');
    }
    const requested = normalizeRequestedDifficulty(opts.difficulty ?? DIFFICULTY_AUTO);
    const seed = seedFromSha256(sha256);
    const charted = (difficulty) => {
        let { chart, report } = buildChart(analysis, { sha256, seed, difficulty });
        const quiet = opts.scene ? storyQuiet(chart, opts.scene) : [];
        if (quiet.length > 0) ({ chart, report } = buildChart(analysis, { sha256, seed, difficulty, quiet }));
        const { warnings } = normalizeChart(chart);
        if (warnings.length > 0) throw new Error(`el charter produjo un chart con avisos: ${warnings.join('; ')}`);
        return { chart, report };
    };

    const { chart: built, report } = charted(requested);
    const { options } = difficultyOptions(analysis);
    let variants = null;
    if (opts.variants === true) {
        variants = {};
        for (const key of [DIFFICULTY_AUTO, ...options]) {
            variants[String(key)] = key === requested ? built : charted(key).chart;
        }
    }

    const stats = chartStats(normalizeChart(built).chart);
    const ceiling = difficultyCeiling(analysis);
    const casting = castScene(analysis);
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
        difficultyOptions: options,
        musicalDensity: ceiling?.density ?? null,
        /** Charts de cada dificultad admitida, por clave ('auto', '1'…), o null si no se pidieron. */
        variants,
        /** Escenario Automático propuesto (T02.5), o null: la Cordillera. */
        sceneAuto: casting.scene,
        /** Por qué: rasgos de la canción y encaje de cada ambiente (informe, horneado, registro del worker). */
        sceneCasting: casting,
    };
}
