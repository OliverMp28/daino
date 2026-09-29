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
//
// Ola 5: desde el charter musical la dificultad es un PARÁMETRO del charter
// (difficulty.js) y es la que se guarda y se enseña. Esta medida sigue siendo
// la comprobación independiente de que "Difícil" es de verdad más difícil que
// "Normal": se usa en tests y en el horneado, y para charts antiguos sin
// dificultad declarada. Con densidad variable, la media sola engaña (un nivel
// con clímax tiene la misma media que uno plano y es más exigente), así que la
// puntuación mezcla la densidad media con la del tramo más denso.
//
// Ola 6b: una nota mantenida del vuelo cuenta como una acción, con el margen de
// error que le deja la holgura de su túnel.

import { FLY_MODE, OBSTACLE_KIND } from '../config.js';
import { createFlightCourse } from '../systems/flightCourse.js';
import { actionLeadS } from '../systems/physics.js';
import { timingWindowS } from '../systems/playability.js';
import { speedProfileOf } from '../systems/speedProfile.js';

/** Ventana con la que se mide la densidad del tramo más exigente. */
const PEAK_WINDOW_S = 20;

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 5;

/**
 * Límite inferior de la puntuación para 2★, 3★, 4★ y 5★. Escala ABSOLUTA, no
 * relativa al catálogo. Recalibrada al subir la dificultad tras el playtest de
 * la 6b: los 8 oficiales generados en cada dificultad puntúan Relajado 28-39
 * (mediana 35), Fácil 42-68 (50), Normal 57-87 (71), Difícil 90-106 (101) y
 * Extremo 104-131 (115); los umbrales caen entre las medianas de cada grupo
 * (antes, con el charter de la Ola 5: 33, 47, 66, 82). Una canción densa en
 * Normal puede medir 4★: la etiqueta que se enseña es la dificultad elegida,
 * esto es la comprobación.
 */
export const DIFFICULTY_THRESHOLDS = Object.freeze([43, 61, 86, 108]);

/** Margen de error a partir del cual una acción ya no suma exigencia. */
const COMFORTABLE_WINDOW_S = 0.35;

/**
 * @typedef {Object} ChartStats
 * @property {number} actions            Obstáculos y notas mantenidas del chart.
 * @property {number} activeSpanS        Del primer al último instante de acción.
 * @property {number} actionsPerMin      Densidad media en el tramo jugado.
 * @property {number} peakActionsPerMin  Densidad de los 20 s más densos.
 * @property {number} tightGapS          Percentil 10 del hueco entre acciones.
 * @property {number} airShare           Fracción de obstáculos voladores [0,1].
 * @property {number} meanWindowS        Margen de error medio por acción.
 */

/**
 * @param {{ events: Array<{ t: number, type: string, kind?: string }>, world: { speedPxS: number, speedChanges?: object[] } }} chart
 * @returns {ChartStats}
 */
export function chartStats(chart) {
    const speed = speedProfileOf(chart);
    const obstacles = chart.events
        // Un activador (anillo, Ola 6c) no es una acción: la cuenta su obstáculo.
        .filter((e) => e.type === 'obstacle' && OBSTACLE_KIND[e.kind] !== undefined && OBSTACLE_KIND[e.kind].trigger === undefined)
        // Cada acción se mide a la velocidad a la que su obstáculo cruza al Dino.
        .map((e) => ({ t: e.t, air: OBSTACLE_KIND[e.kind].altitude > 0, windowS: timingWindowS(e.kind, speed.speedAt(e.t + actionLeadS(OBSTACLE_KIND[e.kind]))) }));
    // Una nota del vuelo admite el error que su túnel absorbe: la holgura cubre
    // tres veces lo que el Dino se desvía por segundo de error (flightCourse.js).
    const course = createFlightCourse(chart.events);
    const rate = Math.max(FLY_MODE.climbPxS, FLY_MODE.divePxS);
    const holds = course.spans.flatMap((s) => s.holds.map((h) => ({ t: h.t, air: false, windowS: (2 * s.margin) / (3 * rate) })));
    const list = [...obstacles, ...holds].sort((a, b) => a.t - b.t);
    const actions = list.length;
    if (actions < 2) {
        return { actions, activeSpanS: 0, actionsPerMin: 0, peakActionsPerMin: 0, tightGapS: 0, airShare: 0, meanWindowS: 0 };
    }

    const activeSpanS = list[actions - 1].t - list[0].t;
    const gaps = [];
    let air = 0;
    let windowSum = 0;
    for (let i = 0; i < actions; i++) {
        const o = list[i];
        if (i > 0) gaps.push(o.t - list[i - 1].t);
        if (o.air) air++;
        windowSum += o.windowS;
    }
    gaps.sort((a, b) => a - b);

    // Densidad del tramo más denso: ventana deslizante anclada en cada acción.
    let peak = 0;
    const window = Math.min(PEAK_WINDOW_S, activeSpanS);
    if (window > 0) {
        let j = 0;
        for (let i = 0; i < actions; i++) {
            while (j < actions && list[j].t < list[i].t + window) j++;
            peak = Math.max(peak, ((j - i - 1) / window) * 60);
        }
    }

    return {
        actions,
        activeSpanS: round(activeSpanS, 3),
        // (actions - 1) huecos en el tramo: acciones regulares cada g segundos
        // dan exactamente 60/g.
        actionsPerMin: activeSpanS > 0 ? round(((actions - 1) / activeSpanS) * 60, 2) : 0,
        peakActionsPerMin: round(peak, 2),
        tightGapS: round(gaps[Math.floor(gaps.length * 0.1)], 3),
        airShare: round(air / actions, 3),
        meanWindowS: round(windowSum / actions, 3),
    };
}

/**
 * Puntuación continua de exigencia. Unidades ≈ acciones por minuto (mitad
 * media, mitad del tramo más denso), más suplementos por márgenes estrechos,
 * pasajes apretados y obstáculos aéreos.
 *
 * @param {ChartStats} stats
 * @returns {number}
 */
export function difficultyScore(stats) {
    if (stats.actions < 2) return 0;
    const density = 0.5 * stats.actionsPerMin + 0.5 * (stats.peakActionsPerMin ?? stats.actionsPerMin);
    // Margen de 116 ms (cactus ancho a 250 px/s) suma ~23; ≥ 350 ms no suma.
    const narrow = Math.max(0, COMFORTABLE_WINDOW_S - stats.meanWindowS) * 100;
    // Un hueco de 1 s o más no aprieta; a 0.7 s suma 9.
    const tight = Math.max(0, 1 - stats.tightGapS) * 30;
    // Todos voladores sumaría 10; el reparto normal (~30 %) suma ~3.
    const air = stats.airShare * 10;
    return round(density + narrow + tight + air, 2);
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
