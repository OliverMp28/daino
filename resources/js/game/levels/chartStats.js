// Estadísticas de un chart y su dificultad MEDIDA (Ola 2).
//
// Las tarjetas del catálogo muestran estrellas de dificultad. Hasta aquí todo
// nivel se guardaba con `difficulty: 3` fijo (defecto D6), así que las
// estrellas no habrían dicho nada. Esto no es todavía la dificultad "de primera
// clase" de la Ola 5 (quien sube elige y el charter genera PARA esa
// dificultad): es una lectura honesta de lo exigente que es el chart que ya
// existe, para que la tarjeta no mienta.
//
// Qué hace difícil un chart del runner, medido con el simulador de física:
//   1. Densidad de acciones en el tramo jugado (acciones por minuto).
//   2. Margen de error de cada acción. Depende del tipo de obstáculo Y de la
//      velocidad: a menos px/s el margen se estrecha (ver
//      `playability.timingWindowS`). Una balada lenta con cactus anchos exige
//      más precisión que una canción rápida con la misma densidad.
//   3. Pasajes apretados: el percentil 10 del hueco entre acciones.
//   4. Cuota de obstáculos aéreos (hay que decidir saltar o agacharse).
//
// Función pura, sin DOM: la usan el horneado de oficiales (Node) y el guardado
// de canciones locales (navegador), así que los dos puntúan igual.

import { OBSTACLE_KIND } from '../config.js';
import { timingWindowS } from '../systems/playability.js';

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 5;

/**
 * Límite inferior de la puntuación para 2★, 3★, 4★ y 5★. Escala ABSOLUTA, no
 * relativa al catálogo: ~30 es una acción cada dos segundos con margen amplio;
 * ≥ 75 es denso, con pasajes al hueco mínimo y márgenes estrechos. Con el
 * charter v1 casi todo cae en 3-5★ porque aún no sabe generar niveles suaves
 * (llega con la Ola 5). Cambiarlos no altera ningún chart, solo la etiqueta.
 */
export const DIFFICULTY_THRESHOLDS = Object.freeze([30, 45, 60, 75]);

/** Margen de error a partir del cual una acción ya no suma exigencia. */
const COMFORTABLE_WINDOW_S = 0.35;

/**
 * @typedef {Object} ChartStats
 * @property {number} actions         Obstáculos del chart.
 * @property {number} activeSpanS     Del primer al último instante de acción.
 * @property {number} actionsPerMin   Densidad en el tramo jugado.
 * @property {number} tightGapS       Percentil 10 del hueco entre acciones.
 * @property {number} airShare        Fracción de obstáculos voladores [0,1].
 * @property {number} meanWindowS     Margen de error medio por acción.
 */

/**
 * @param {{ events: Array<{ t: number, type: string, kind?: string }>, world: { speedPxS: number } }} chart
 * @returns {ChartStats}
 */
export function chartStats(chart) {
    const obstacles = chart.events.filter((e) => e.type === 'obstacle' && OBSTACLE_KIND[e.kind] !== undefined);
    const actions = obstacles.length;
    if (actions < 2) {
        return { actions, activeSpanS: 0, actionsPerMin: 0, tightGapS: 0, airShare: 0, meanWindowS: 0 };
    }

    const speed = chart.world.speedPxS;
    const activeSpanS = obstacles[actions - 1].t - obstacles[0].t;
    const gaps = [];
    let air = 0;
    let windowSum = 0;
    for (let i = 0; i < actions; i++) {
        const o = obstacles[i];
        if (i > 0) gaps.push(o.t - obstacles[i - 1].t);
        if (OBSTACLE_KIND[o.kind].altitude > 0) air++;
        windowSum += timingWindowS(o.kind, speed);
    }
    gaps.sort((a, b) => a - b);

    return {
        actions,
        activeSpanS: round(activeSpanS, 3),
        // (actions - 1) huecos en el tramo: acciones regulares cada g segundos
        // dan exactamente 60/g.
        actionsPerMin: activeSpanS > 0 ? round(((actions - 1) / activeSpanS) * 60, 2) : 0,
        tightGapS: round(gaps[Math.floor(gaps.length * 0.1)], 3),
        airShare: round(air / actions, 3),
        meanWindowS: round(windowSum / actions, 3),
    };
}

/**
 * Puntuación continua de exigencia. Unidades ≈ acciones por minuto, más
 * suplementos por márgenes estrechos, pasajes apretados y obstáculos aéreos.
 *
 * @param {ChartStats} stats
 * @returns {number}
 */
export function difficultyScore(stats) {
    if (stats.actions < 2) return 0;
    // Margen de 116 ms (cactus ancho a 250 px/s) suma ~23; ≥ 350 ms no suma.
    const narrow = Math.max(0, COMFORTABLE_WINDOW_S - stats.meanWindowS) * 100;
    // Un hueco de 1 s o más no aprieta; a 0.7 s (el mínimo del charter) suma 9.
    const tight = Math.max(0, 1 - stats.tightGapS) * 30;
    // Todos voladores sumaría 10; el reparto normal (~30 %) suma ~3.
    const air = stats.airShare * 10;
    return round(stats.actionsPerMin + narrow + tight + air, 2);
}

/**
 * Estrellas de 1 a 5.
 *
 * @param {ChartStats} stats
 * @returns {number}
 */
export function difficultyFromStats(stats) {
    const score = difficultyScore(stats);
    let stars = DIFFICULTY_MIN;
    for (const threshold of DIFFICULTY_THRESHOLDS) {
        if (score >= threshold) stars++;
    }
    return Math.min(DIFFICULTY_MAX, stars);
}

function round(v, decimals) {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
}
