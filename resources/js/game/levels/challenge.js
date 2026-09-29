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
import { simulateRun, timingMarginsS, toSimHolds, toSimModes, toSimObstacles, toSimTriggers } from '../systems/playability.js';
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
    if (def === undefined || def.trigger !== undefined) return 0;
    const m = timingMarginsS(kind, speedAt(t + actionLeadS(def)));
    return hazardOf(missChance(m.early, m.late, sigma));
}

/**
 * Vecinas más lejos que esto (entre cruces) no cambian el margen de una acción: un
 * salto dura 0.72 s en el aire (0.86 tras un anillo) y un agachado se suelta ~0.3 s
 * tras el cruce.
 */
export const CONTEXT_S = 0.95;

/**
 * Márgenes de error de una acción EN SU SITIO del chart (Ola 6c): con sus vecinas
 * jugadas en su instante, cuánto se puede adelantar y retrasar su pulsación. Una
 * hilera de acento seguida de un agachado a 0.4 s deja menos margen tarde que la
 * hilera sola (el Dino aterriza más tarde); medido en Sugar Red (Difícil): el
 * 24 % de las partidas del jugador de referencia moría en una sola de esas
 * parejas, que el margen aislado daba por holgada.
 *
 * Se simula solo la ventana de ±`CONTEXT_S` con la física real (bisección de ~19 ms,
 * por debajo de lo que distingue el jugador de referencia) y se recuerda por la forma
 * de la ventana (kinds, distancias y velocidad), así que un riff que se repite se mide
 * una vez. Medido en los 8 oficiales × 5 dificultades: 0.2-1.2 s por chart.
 *
 * @param {{ obstacles: Array<{ t: number, kind: string, def: object, cross: number }>, triggers?: Array<object>,
 *           speed: import('../systems/speedProfile.js').SpeedProfile, modes?: Array<{ t: number, mode: string }> }} p
 * @returns {(index: number, kind?: string) => { early: number, late: number }}
 *          Márgenes de la acción `index` con su kind o con `kind` en su lugar.
 */
export function createContextMargins({ obstacles, triggers = [], speed, modes = [] }) {
    const cache = new Map();
    return (index, kind = obstacles[index].kind) => {
        const base = obstacles[index];
        const def = OBSTACLE_KIND[kind];
        const target = { t: base.t, kind, def, cross: base.t + actionLeadS(def) };
        const v = speed.speedAt(target.cross);
        const isolated = timingMarginsS(kind, v);
        let a = index;
        while (a > 0 && target.cross - obstacles[a - 1].cross <= CONTEXT_S) a--;
        let b = index;
        while (b + 1 < obstacles.length && obstacles[b + 1].cross - target.cross <= CONTEXT_S) b++;
        // En antigravedad la ventana empieza con el Dino en el suelo: un cristal del suelo.
        while (a > 0 && obstacles[a].def.mode === 'flip' && obstacles[a].def.surface === 'ceiling') a--;
        if (a === index && b === index) return isolated;

        const local = obstacles.slice(a, b + 1).map((o, j) => (j === index - a ? target : o));
        const at = index - a;
        const near = triggers.filter((tr) => tr.cross >= local[0].cross - CONTEXT_S && tr.cross <= local[local.length - 1].cross + CONTEXT_S);
        const key = local.map((o) => `${o.kind}@${Math.round((o.cross - target.cross) * 1000)}`).join('|')
            + `#${at}#${Math.round(v / 5)}#${near.map((tr) => Math.round((tr.cross - target.cross) * 1000)).join(',')}#${modeKey(modes, local)}`;
        const cached = cache.get(key);
        if (cached !== undefined) return cached;

        const survives = (offset) => simulateRun(local, speed, { modes, triggers: near, pressOffset: (j) => (j === at ? offset : 0) }).ok;
        let out;
        if (!survives(0)) {
            out = { early: 0, late: 0 };
        } else {
            const side = (sign, max) => {
                const cap = Math.min(max, CONTEXT_MAX_MARGIN_S);
                if (survives(sign * cap)) return cap;
                let lo = 0;
                let hi = cap;
                for (let k = 0; k < 4; k++) {
                    const mid = (lo + hi) / 2;
                    if (survives(sign * mid)) lo = mid;
                    else hi = mid;
                }
                return lo;
            };
            out = { early: side(-1, isolated.early), late: side(1, isolated.late) };
        }
        cache.set(key, out);
        return out;
    };
}

/** Más margen que esto ya no cambia la exigencia de nadie (2σ de un jugador muy impreciso). */
const CONTEXT_MAX_MARGIN_S = 0.3;

/** Modo al empezar la ventana y portales dentro de ella: la misma forma en otro modo es otra ventana. */
function modeKey(modes, local) {
    const from = local[0].t - CONTEXT_S;
    const to = local[local.length - 1].cross + CONTEXT_S;
    let mode = 'run';
    const inside = [];
    for (const m of modes) {
        if (m.t <= from) mode = m.mode;
        else if (m.t <= to) inside.push(`${m.mode}@${Math.round((m.t - local[0].t) * 1000)}`);
    }
    return `${mode}${inside.join(',')}`;
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
 * El vuelo cuenta (Ola 6c): sus notas se vuelan corrigiendo mirando el túnel
 * (virtualPlayer.FLIGHT_PLAYER), con el mismo error en cada pulsación y en cada
 * soltar. Hasta la 6b no contaba: el jugador virtual volaba a ciegas y el error
 * que se acumulaba de nota en nota no representaba a nadie. `flight: false` lo
 * deja fuera (para comparar con medidas anteriores).
 *
 * @param {{ events: Array<object>, world: { speedPxS: number, speedChanges?: object[] } }} chart
 * @param {{ sigmaS?: number, runs?: number, seed?: number, flight?: boolean }} [opts]
 * @returns {{ passRate: number, deaths: number[] }}  Fracción de partidas superadas e instante de canción de cada muerte.
 */
export function referencePassRate(chart, opts = {}) {
    const sigma = opts.sigmaS ?? REFERENCE_PLAYER.sigmaS;
    const runs = opts.runs ?? 100;
    const flight = opts.flight ?? true;
    const obstacles = toSimObstacles(chart.events);
    const speed = speedProfileOf(chart);
    const modes = toSimModes(chart.events);
    const triggers = toSimTriggers(chart.events);
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
            triggers,
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
