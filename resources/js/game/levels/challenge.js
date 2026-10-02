// Exigencia — cuánto le cuesta a un jugador de referencia superar un nivel.
//
// Tras el segundo playtest de la dificultad ("What's Up Danger en Extremo lo
// pasé a la segunda", "un nivel medio o difícil no puede pasarse a la primera
// como uno fácil") se midió con un jugador simulado que pulsa con un error
// gaussiano (Monte Carlo con la física real). Un cactus suelto deja ±200 ms de
// margen a cualquier velocidad: casi solo mataban las combinaciones rápidas, y
// con las mismas reglas cada canción salía con una exigencia distinta (a 65 BPM
// los saltos van un beat separados y no aprietan).
//
// La exigencia que se puede DECIDIR sin tocar el ritmo es la de los acentos: la
// acción sobre un golpe fuerte lleva una variante de su obstáculo que deja menos
// margen (accents.js). Este módulo dice cuánto cuesta cada una: la probabilidad
// de que el error del jugador de referencia se salga de su margen por cualquier
// lado, y su exigencia, −ln(1 − p) (muertes esperadas: se suman). El charter
// aprieta los acentos hasta que la exigencia de la canción llega a la que pide
// su dificultad.
//
// Tercer playtest (Oct 2026: "el Extremo lo pasé al segundo intento"): ese
// jugador era de ±45 ms y solo daba toques. Ahora es alguien con práctica (±30 ms)
// que en cada salto hace el gesto que más le conviene, toque o mantener
// (`REFERENCE_PLAYER`, `createReferenceOdds`). Y la medida vale para comprobar
// que un nivel cuesta lo mismo se juegue como se juegue: `referencePassRate` con
// `hold: false` (solo toques) y con `biasS` (adelantándose).
//
// Lo que no son acentos (las combinaciones rápidas que salen de la música, el
// vuelo) suma aparte: el charter lo descuenta de lo que pide a los acentos, y
// `referencePassRate` juega el nivel entero con ese jugador (Monte Carlo con la
// física): es la medida con la que se calibran las dificultades y se protegen los
// playtests como tests.

import { OBSTACLE_KIND } from '../config.js';
import { createFlightCourse } from '../systems/flightCourse.js';
import { actionLeadS } from '../systems/physics.js';
import { simulateRun, timingMarginsS, toSimHolds, toSimModes, toSimObstacles, toSimTriggers } from '../systems/playability.js';
import { speedProfileOf } from '../systems/speedProfile.js';

/**
 * Jugador con el que se mide la exigencia: alguien CON PRÁCTICA. Pulsa sobre el
 * golpe con un error gaussiano de desviación `sigmaS` y, en cada salto, hace el
 * gesto que más le conviene: un toque o mantener (`holdS`), que lo hace más alto
 * y más largo.
 *
 * Hasta el charter 14 era alguien de ±45 ms que solo daba toques. Tercer playtest
 * de la dificultad (Oct 2026): "el Extremo lo pasé al segundo intento". Medido:
 * con ±45 ms What's Up Danger en Extremo se superaba el 7 % de las veces, pero
 * con ±30 ms el 81 %, y manteniendo los saltos el 88 %. La exigencia estaba
 * calibrada para quien no la necesitaba: casi imposible para quien empieza y
 * un paseo para quien ya juega. Y mantener un salto regala ~130 ms por el lado
 * de pulsar pronto: una hilera que hay que clavar a toques, mantenida solo
 * castiga llegar tarde.
 */
export const REFERENCE_PLAYER = Object.freeze({ sigmaS: 0.03, holdS: 0.45 });

/** Por debajo de esta probabilidad de fallar por pulsar pronto, mantener ya no mejora nada que se note. */
const HOLD_WORTH = 5e-4;

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
 * Se simula solo la ventana de ±`CONTEXT_S` con la física real (bisección de menos
 * de 5 ms) y se recuerda por la forma de la ventana (kinds, distancias y velocidad),
 * así que un riff que se repite se mide una vez.
 *
 *
 * Con `hold`, los márgenes de esa acción MANTENIENDO el salto (`REFERENCE_PLAYER.holdS`):
 * el arco mantenido va por encima del base y aterriza más tarde, así que perdona
 * pulsar pronto, salvo que lo que viene después no deje sitio para aterrizar
 * (por eso su ventana mira algo más lejos).
 *
 * @param {{ obstacles: Array<{ t: number, kind: string, def: object, cross: number }>, triggers?: Array<object>,
 *           speed: import('../systems/speedProfile.js').SpeedProfile, modes?: Array<{ t: number, mode: string }> }} p
 * @returns {(index: number, kind?: string, hold?: boolean) => { early: number, late: number }}
 *          Márgenes de la acción `index` con su kind o con `kind` en su lugar.
 */
export function createContextMargins({ obstacles, triggers = [], speed, modes = [] }) {
    const cache = new Map();
    return (index, kind = obstacles[index].kind, hold = false) => {
        const base = obstacles[index];
        const def = OBSTACLE_KIND[kind];
        const target = { t: base.t, kind, def, cross: base.t + actionLeadS(def) };
        const v = speed.speedAt(target.cross);
        const isolated = timingMarginsS(kind, v, hold ? REFERENCE_PLAYER.holdS : 0);
        const after = hold ? CONTEXT_S + HOLD_CONTEXT_S : CONTEXT_S;
        let a = index;
        while (a > 0 && target.cross - obstacles[a - 1].cross <= CONTEXT_S) a--;
        let b = index;
        while (b + 1 < obstacles.length && obstacles[b + 1].cross - target.cross <= after) b++;
        // En antigravedad la ventana empieza con el Dino en el suelo: un cristal del suelo.
        while (a > 0 && obstacles[a].def.mode === 'flip' && obstacles[a].def.surface === 'ceiling') a--;
        if (!hold && a === index && b === index) return isolated;

        const local = obstacles.slice(a, b + 1).map((o, j) => (j === index - a ? target : o));
        const at = index - a;
        const near = triggers.filter((tr) => tr.cross >= local[0].cross - CONTEXT_S && tr.cross <= local[local.length - 1].cross + CONTEXT_S);
        const key = local.map((o) => `${o.kind}@${Math.round((o.cross - target.cross) * 1000)}`).join('|')
            + `#${at}#${Math.round(v / 5)}#${near.map((tr) => Math.round((tr.cross - target.cross) * 1000)).join(',')}#${modeKey(modes, local)}${hold ? '#H' : ''}`;
        const cached = cache.get(key);
        if (cached !== undefined) return cached;

        const tapS = hold ? (j) => (j === at ? REFERENCE_PLAYER.holdS : null) : null;
        // La velocidad solo cambia a escalones y rampas: la más lenta del trozo está en un extremo.
        const minSpeedPxS = Math.min(v, speed.speedAt(local[0].t - 1.5), speed.speedAt(local[local.length - 1].cross + 1.5));
        const survives = (offset) => simulateRun(local, speed, { modes, triggers: near, tapS, minSpeedPxS, pressOffset: (j) => (j === at ? offset : 0) }).ok;
        let out;
        if (!survives(0)) {
            out = { early: 0, late: 0 };
        } else {
            const side = (sign, max) => {
                // En su sitio nunca hay más margen que aislada (con el mismo gesto).
                const cap = Math.min(max, CONTEXT_MAX_MARGIN_S);
                if (survives(sign * cap)) return cap;
                let lo = 0;
                let hi = cap;
                for (let k = 0; k < BISECT_STEPS; k++) {
                    const mid = (lo + hi) / 2;
                    if (survives(sign * mid)) lo = mid;
                    else hi = mid;
                }
                // El centro del último intervalo: sin sesgo hacia ningún lado.
                return (lo + hi) / 2;
            };
            out = { early: side(-1, isolated.early), late: side(1, isolated.late) };
        }
        cache.set(key, out);
        return out;
    };
}

/**
 * Pasos de la bisección de cada lado: el tope (hasta 0.3 s, casi siempre ~0.2)
 * entre 32, y se toma el centro: ±3-5 ms. Con 4 pasos y el extremo bajo (charter
 * 12-14) el error llegaba a 12-19 ms: para el jugador de ±45 ms de entonces daba
 * igual; para el de ±30 dobla la exigencia que se le calcula a una acción.
 */
const BISECT_STEPS = 5;

/** Un salto mantenido aterriza ~0.13 s más tarde: su ventana mira esto más lejos. */
const HOLD_CONTEXT_S = 0.3;

/** ¿Es un salto del suelo, al que mantener le cambia el arco? (En antigravedad y en vuelo pulsar es otra cosa.) */
function canHoldJump(def) {
    return def !== undefined && def.action === 'jump' && (def.mode ?? 'run') === 'run' && def.trigger === undefined;
}

/**
 * Probabilidad de que el jugador de referencia falle cada acción EN SU SITIO, con
 * el gesto que más le conviene (un toque o mantener el salto).
 *
 * @param {Parameters<typeof createContextMargins>[0]} p
 * @param {number} [sigma]
 * @param {ReturnType<typeof createContextMargins>} [context]  Los márgenes en contexto de `p`, si ya existen (comparten memoria).
 * @returns {(index: number, kind?: string) => { miss: number, hold: boolean, tap: { early: number, late: number } }}
 *          `tap`: los márgenes a toques (lo que el nivel garantiza a quien no mantiene).
 */
export function createReferenceOdds(p, sigma = REFERENCE_PLAYER.sigmaS, context = createContextMargins(p)) {
    const margins = createPlacedMargins(p, context);
    return (index, kind = p.obstacles[index].kind) => {
        const tap = margins(index, kind);
        const out = { miss: missChance(tap.early, tap.late, sigma), hold: false, tap };
        // Mantener solo cambia el lado de pulsar pronto: si ese ya no falla, no hay nada que ganar.
        if (!canHoldJump(OBSTACLE_KIND[kind]) || upperTail(tap.early / sigma) < HOLD_WORTH) return out;
        const held = margins(index, kind, true);
        const miss = missChance(held.early, held.late, sigma);
        if (miss < out.miss) {
            out.miss = miss;
            out.hold = true;
        }
        return out;
    };
}

/**
 * Márgenes de una acción en su sitio con CUALQUIER variante de su obstáculo, sin
 * simular cada una: lo que deja la variante por sí sola (aislada, a su velocidad)
 * recortado por lo que dejan las vecinas, que se mide una vez con el obstáculo
 * normal de la acción. Lo que limita una vecina es CUÁNDO despega y aterriza el
 * Dino, que no depende de lo largo que sea lo que salta; lo que limita el
 * obstáculo propio es lo mismo que aislado.
 *
 * El charter prueba decenas de variantes por acento en cada escalón de la
 * escalera (accents.js): simular cada una en su ventana costaba 2-10 s por chart.
 *
 * @param {Parameters<typeof createContextMargins>[0]} p
 * @param {ReturnType<typeof createContextMargins>} [context]
 * @returns {(index: number, kind?: string, hold?: boolean) => { early: number, late: number }}
 */
export function createPlacedMargins(p, context = createContextMargins(p)) {
    // Lo que dejan las vecinas, por acción y gesto (con su obstáculo normal): se pide miles de veces.
    const around = [new Map(), new Map()];
    return (index, kind = p.obstacles[index].kind, hold = false) => {
        const def = OBSTACLE_KIND[kind];
        const own = timingMarginsS(kind, p.speed.speedAt(p.obstacles[index].t + actionLeadS(def)), hold ? REFERENCE_PLAYER.holdS : 0);
        const plain = def.accentOf ?? kind;
        const memo = around[hold ? 1 : 0];
        let near = memo.get(index);
        if (near === undefined || near.kind !== plain) {
            near = { kind: plain, m: context(index, plain, hold) };
            memo.set(index, near);
        }
        return { early: Math.min(own.early, near.m.early), late: Math.min(own.late, near.m.late) };
    };
}

/**
 * Gesto del jugador de referencia en cada obstáculo de un nivel (para
 * `simulateRun({ tapS })`): cuánto mantiene cada salto, o null (un toque).
 *
 * @param {Parameters<typeof createContextMargins>[0]} p
 * @param {number} [sigma]
 * @returns {Array<number | null>}
 */
export function referenceGestures(p, sigma = REFERENCE_PLAYER.sigmaS) {
    const odds = createReferenceOdds(p, sigma);
    return p.obstacles.map((o, i) => (canHoldJump(o.def) && odds(i).hold ? REFERENCE_PLAYER.holdS : null));
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
 * `hold: false` es quien solo da toques (como se juega con un dedo): para él las
 * hileras aprietan por los dos lados.
 *
 * @param {{ events: Array<object>, world: { speedPxS: number, speedChanges?: object[] } }} chart
 * @param {{ sigmaS?: number, runs?: number, seed?: number, flight?: boolean, hold?: boolean, biasS?: number }} [opts]
 *        `biasS`: adelanto (negativo) o retraso fijo de todas las pulsaciones, para
 *        medir a quien juega anticipándose.
 * @returns {{ passRate: number, deaths: number[] }}  Fracción de partidas superadas e instante de canción de cada muerte.
 */
export function referencePassRate(chart, opts = {}) {
    const sigma = opts.sigmaS ?? REFERENCE_PLAYER.sigmaS;
    const runs = opts.runs ?? 100;
    const flight = opts.flight ?? true;
    const bias = opts.biasS ?? 0;
    const obstacles = toSimObstacles(chart.events);
    const speed = speedProfileOf(chart);
    const modes = toSimModes(chart.events);
    const triggers = toSimTriggers(chart.events);
    const gestures = (opts.hold ?? true) ? referenceGestures({ obstacles, triggers, speed, modes }, sigma) : null;
    const tapS = gestures === null ? null : (i) => gestures[i] ?? null;
    const holds = flight ? toSimHolds(chart.events) : [];
    const course = flight ? createFlightCourse(chart.events) : null;
    const presses = obstacles.length + 2 * holds.length;
    const random = mulberry32(opts.seed ?? 1);
    const offsets = new Float64Array(presses);
    const pressOffset = (i) => offsets[i];
    const deaths = [];
    let passed = 0;
    for (let r = 0; r < runs; r++) {
        for (let i = 0; i < presses; i++) offsets[i] = bias + sigma * gaussian(random);
        const result = simulateRun(obstacles, speed, {
            pressOffset,
            modes,
            holds,
            course: course === null || course.empty ? null : course,
            triggers,
            tapS,
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
