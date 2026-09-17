// Exigencia — cuánto le cuesta a un jugador de referencia superar un nivel.
//
// Tras el segundo playtest de la dificultad ("What's Up Danger en Extremo lo
// pasé a la segunda", "un nivel medio o difícil no puede pasarse a la primera
// como uno fácil") se midió con un jugador simulado que pulsa con un error
// gaussiano de ±45 ms (Monte Carlo con la física real): What's Up Danger en
// Extremo se superaba el 51 % de las veces, Mi Fiesta y Dawn of Faith en Difícil
// el 58-62 %, y Dawn of Faith sin su vuelo el 100 %. Un cactus suelto deja
// ±200 ms de margen a cualquier velocidad: casi solo mataban las combinaciones
// rápidas, y con las mismas reglas cada canción salía con una exigencia distinta
// (a 65 BPM los saltos van un beat separados y no aprietan).
//
// La exigencia que se puede DECIDIR sin tocar el ritmo es la de los acentos: el
// salto sobre un golpe fuerte lleva un obstáculo más largo que deja menos margen
// (charter.js::assignKinds). Este módulo dice cuánto cuesta cada uno: la
// probabilidad de que el error del jugador de referencia se salga de su margen
// por cualquier lado, y su exigencia, −ln(1 − p) (muertes esperadas: se suman).
// El charter aprieta los acentos de toda la canción hasta que su exigencia llega
// a la que pide la dificultad por minuto de juego.
//
// Lo que no se decide ahí (las combinaciones rápidas que salen de la música, el
// vuelo) suma aparte: `referencePassRate` juega el nivel entero con ese jugador
// (Monte Carlo con la física) y es la medida con la que se calibran las
// dificultades y se protegen los playtests como tests.

import { OBSTACLE_KIND } from '../config.js';
import { createFlightCourse } from '../systems/flightCourse.js';
import { actionLeadS } from '../systems/physics.js';
import { simulateRun, timingMarginsS, toSimHolds, toSimModes, toSimObstacles } from '../systems/playability.js';
import { speedProfileOf } from '../systems/speedProfile.js';

/**
 * Jugador con el que se mide la exigencia: pulsa sobre el golpe con un error
 * gaussiano de desviación `sigmaS`. ±45 ms es alguien que ya juega bien: con él,
 * What's Up Danger en Extremo (charter 8) se superaba ~1 de cada 2 veces, lo que
 * cuadra con pasarlo a la segunda.
 */
export const REFERENCE_PLAYER = Object.freeze({ sigmaS: 0.045 });

/**
 * Probabilidad de que un error N(0, σ) se salga del margen [−early, +late].
 *
 * @param {number} early
 * @param {number} late
 * @param {number} [sigma]
 */
export function missChance(early, late, sigma = REFERENCE_PLAYER.sigmaS) {
    return Math.min(1, upperTail(early / sigma) + upperTail(late / sigma));
}

/** −ln(1 − p): lo que suma una acción a la exigencia (muertes esperadas). */
export function hazardOf(p) {
    if (p <= 0) return 0;
    return p >= 1 ? 50 : -Math.log(1 - p);
}

/**
 * Exigencia de una acción aislada con un kind, a la velocidad con la que cruza.
 *
 * @param {string} kind
 * @param {number} t          Instante de acción.
 * @param {(t: number) => number} speedAt
 * @param {number} [sigma]
 */
export function kindHazard(kind, t, speedAt, sigma = REFERENCE_PLAYER.sigmaS) {
    const def = OBSTACLE_KIND[kind];
    if (def === undefined) return 0;
    const m = timingMarginsS(kind, speedAt(t + actionLeadS(def)));
    return hazardOf(missChance(m.early, m.late, sigma));
}

/**
 * P(Z > z) de la normal estándar (Abramowitz y Stegun 26.2.17, error < 7.5e-8).
 * @param {number} z
 */
function upperTail(z) {
    if (z < 0) return 1 - upperTail(-z);
    const t = 1 / (1 + 0.2316419 * z);
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * poly;
}

/**
 * Probabilidad de que el jugador de referencia supere un chart, jugándolo de
 * verdad: `runs` partidas con la física real y un error N(0, σ) independiente en
 * cada pulsación (Monte Carlo, determinista con `seed`). Es la medida con la que
 * se calibran las dificultades y la regresión de los playtests; cuesta ~25 ms por
 * partida de 3 min, así que es para herramientas y tests, no para el charter.
 *
 * Sin `flight`, las notas del vuelo no cuentan: ahí quien juega corrige mirando
 * el túnel, y un error a ciegas que se acumula de nota en nota no lo representa.
 *
 * @param {{ events: Array<object>, world: { speedPxS: number, speedChanges?: object[] } }} chart
 * @param {{ sigmaS?: number, runs?: number, seed?: number, flight?: boolean }} [opts]
 * @returns {{ passRate: number, deaths: number[] }}  Fracción de partidas superadas e instante de canción de cada muerte.
 */
export function referencePassRate(chart, opts = {}) {
    const sigma = opts.sigmaS ?? REFERENCE_PLAYER.sigmaS;
    const runs = opts.runs ?? 100;
    const flight = opts.flight ?? false;
    const obstacles = toSimObstacles(chart.events);
    const speed = speedProfileOf(chart);
    const modes = toSimModes(chart.events);
    const holds = flight ? toSimHolds(chart.events) : [];
    const course = flight ? createFlightCourse(chart.events) : null;
    const presses = obstacles.length + 2 * holds.length;
    const random = mulberry32(opts.seed ?? 1);
    const offsets = new Float64Array(presses);
    const pressOffset = (i) => offsets[i];
    const deaths = [];
    let passed = 0;
    for (let r = 0; r < runs; r++) {
        for (let i = 0; i < presses; i++) offsets[i] = sigma * gaussian(random);
        const result = simulateRun(obstacles, speed, {
            pressOffset,
            modes,
            holds,
            course: course === null || course.empty ? null : course,
        });
        if (result.ok) passed++;
        else deaths.push(result.atSongTime);
    }
    return { passRate: runs > 0 ? passed / runs : 1, deaths };
}

/** Generador pseudoaleatorio de 32 bits (mulberry32): mismo `seed`, misma secuencia. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Normal estándar por Box-Muller. */
function gaussian(random) {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
