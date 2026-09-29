// Simulador headless de jugabilidad (Ola 3).
//
// Responde a una pregunta que nadie comprobaba: ¿se puede superar este chart?
// Juega el nivel entero con un jugador virtual que actúa en el instante
// musical de cada evento, usando EXACTAMENTE la física del juego
// (physics.js: mismas acciones, mismo integrador, mismos hitboxes, misma
// fórmula de posición que el spawner). No hay una segunda copia de las reglas
// que se pueda desincronizar.
//
// Un jugador perfecto no basta: un chart que solo supera un bot es injusto.
// Por eso `validatePlayability` lo juega varias veces con el jugador
// adelantándose y retrasándose `toleranceS`, incluido el caso peor de dos
// acciones seguidas (una tarde y la siguiente pronto, que acorta el hueco).
//
// Y dos maneras de jugar (afinado de velocidad, Sep 2026): quien pulsa con el
// OÍDO, en el golpe, y quien pulsa con la VISTA, cuando el obstáculo "está a la
// distancia de siempre". Con velocidad constante son lo mismo. Justo después de
// un cambio de velocidad no: la vista tarda en recalibrar y pulsa tarde (o
// pronto, si el mundo frena). `readerOffsetS` mide ese error con la velocidad
// del nivel y el validador exige que las dos maneras de jugar superen el chart.
//
// Modos de movimiento (Ola 6): el nivel se juega con los cambios de modo del
// chart (`opts.modes`) aplicados en su instante, igual que en la partida, y el
// jugador virtual (virtualPlayer.js) responde a cada obstáculo con la acción de
// su kind.
//
// Sin Pixi, sin DOM, sin audio: corre en Node (tests) y en el navegador
// (el charter lo usa para reparar charts antes de devolverlos).

import { OBSTACLE_KIND, PHYSICS_STEP_S } from '../config.js';
import {
    applyInput,
    applyTrigger,
    bodyHitbox,
    bodyState,
    enterMode,
    integrateBody,
    obstacleHitbox,
    obstacleTopY,
    triggerZone,
    actionLeadS,
    aabbHit,
    DINO_CENTER_X,
} from './physics.js';
import { modeChanges } from './modeTimeline.js';
import { movementMode } from './modes/index.js';
import { createFlightCourse } from './flightCourse.js';
import { asSpeedProfile, speedProfileOf } from './speedProfile.js';
import { virtualPlayerScript } from './virtualPlayer.js';

/**
 * Paso por defecto: EL MISMO que la física del juego (`PHYSICS_STEP_S`). La
 * partida real avanza en pasos fijos de ese tamaño, así que lo que el
 * simulador valida es exactamente lo que se juega, a cualquier framerate.
 */
const DEFAULT_DT = PHYSICS_STEP_S;

/** Suelo arbitrario: la simulación solo depende de posiciones relativas a él. */
const SIM_GROUND_Y = 1000;

/**
 * Tolerancia humana por defecto: ±40 ms (la de Extremo). Cada dificultad
 * valida con la suya (levels/difficulty.js): Relajado exige superar el chart
 * con ±80 ms. Con ±40 ms, dos saltos seguidos necesitan 0.68 s (medido).
 */
export const DEFAULT_TOLERANCE_S = 0.04;

/**
 * Cuánto tarda la vista en recalibrar la velocidad del mundo: el jugador que
 * se guía por la vista estima la velocidad como la media de los últimos
 * READER_ADAPT_S segundos. Del orden de lo que tarda una persona en corregir un
 * movimiento de intercepción cuando el objetivo cambia de velocidad
 * (150-300 ms); se toma el extremo largo.
 */
export const READER_ADAPT_S = 0.3;

/**
 * @typedef {Object} SimObstacle
 * @property {number} t      Instante de acción (del chart).
 * @property {string} kind
 * @property {object} def    Entrada de OBSTACLE_KIND.
 * @property {number} cross  Instante en que el centro cruza al Dino.
 */

/**
 * Prepara los obstáculos de un chart para simular: orden por acción y cruce
 * precalculado. Solo los que se chocan: los activadores (anillos, Ola 6c) van
 * aparte (`toSimTriggers`), así el índice de un obstáculo sigue siendo el de su
 * pulsación.
 *
 * @param {Array<{ t: number, type: string, kind?: string }>} events
 * @returns {SimObstacle[]}
 */
export function toSimObstacles(events) {
    return simEvents(events, (def) => def.trigger === undefined);
}

/**
 * Activadores de un chart (anillos de salto, Ola 6c), en el mismo formato que los
 * obstáculos: no se chocan ni piden pulsación propia.
 *
 * @param {Array<{ t: number, type: string, kind?: string }>} events
 * @returns {SimObstacle[]}
 */
export function toSimTriggers(events) {
    return simEvents(events, (def) => def.trigger !== undefined);
}

function simEvents(events, keep) {
    const out = [];
    for (const e of events) {
        if (e.type !== 'obstacle') continue;
        const def = OBSTACLE_KIND[e.kind];
        if (def === undefined || !keep(def)) continue;
        out.push({ t: e.t, kind: e.kind, def, cross: e.t + actionLeadS(def) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
}

/**
 * Notas mantenidas (vuelo, Ola 6b) de una lista de eventos, en orden.
 * @param {Array<{ t: number, type: string, until?: number }>} events
 * @returns {Array<{ t: number, until: number }>}
 */
export function toSimHolds(events) {
    return events
        .filter((e) => e.type === 'hold' && Number.isFinite(e.t) && Number.isFinite(e.until) && e.until > e.t)
        .map((e) => ({ t: e.t, until: e.until }))
        .sort((a, b) => a.t - b.t);
}

/**
 * Cambios de modo de una lista de eventos, listos para `opts.modes`.
 * @param {Array<{ t: number, type: string, mode?: string }>} events
 * @returns {Array<{ t: number, mode: string }>}
 */
export function toSimModes(events) {
    return modeChanges(events).map(({ t, mode }) => ({ t, mode }));
}

/**
 * Juega una lista de obstáculos con un jugador virtual.
 *
 * @param {SimObstacle[]} obstacles
 * @param {number | import('./speedProfile.js').SpeedProfile} speed
 *        Velocidad constante o perfil de velocidad del nivel (Ola 5).
 * @param {{ dt?: number, pressOffset?: (index: number) => number, modes?: Array<{ t: number, mode: string }>,
 *           holds?: Array<{ t: number, until: number }>, course?: ReturnType<typeof createFlightCourse> | null,
 *           triggers?: SimObstacle[], flightPlayer?: object | null }} [opts]
 *        `pressOffset(i)` desplaza la pulsación del obstáculo i (segundos;
 *        negativo = se adelanta). Por defecto 0: jugador perfecto.
 *        `modes`: cambios de modo del nivel en orden (toSimModes). Sin ellos, se corre.
 *        `holds` y `course` (Ola 6b): notas mantenidas del vuelo y su túnel. Un
 *        choque con el túnel se atribuye a la nota más reciente (índice `n + 2k`).
 *        `triggers` (Ola 6c): activadores del nivel (toSimTriggers).
 *        `flightPlayer`: cómo vuela el jugador virtual (virtualPlayer.FLIGHT_PLAYER por
 *        defecto: corrige mirando el túnel; null: a ciegas).
 * @returns {{ ok: true } | { ok: false, index: number, t: number, atSongTime: number }}
 */
export function simulateRun(obstacles, speed, opts = {}) {
    const holds = opts.holds ?? [];
    const course = opts.course ?? null;
    const triggers = opts.triggers ?? [];
    // Sin nada que jugar no hay choque posible; con un túnel sí (no pulsar es chocar).
    if (obstacles.length === 0 && holds.length === 0 && (course === null || course.empty)) return { ok: true };

    const dt = opts.dt ?? DEFAULT_DT;
    const profile = asSpeedProfile(speed);
    const modes = opts.modes ?? [];

    // Distancia del mundo en el cruce de cada obstáculo: la x de cada paso es
    // DINO + (crossD − D(ahora)) − w/2, con D(ahora) calculada una vez por paso.
    const crossD = new Float64Array(obstacles.length);
    const triggerD = new Float64Array(triggers.length);
    if (!profile.constant) {
        for (let i = 0; i < obstacles.length; i++) crossD[i] = profile.distanceAt(obstacles[i].cross);
        for (let i = 0; i < triggers.length; i++) triggerD[i] = profile.distanceAt(triggers[i].cross);
    }

    const script = virtualPlayerScript(obstacles, profile, opts.pressOffset, holds, {
        course,
        player: opts.flightPlayer,
    });
    const body = bodyState(SIM_GROUND_Y);

    // Ventana de obstáculos que pueden tocar al Dino en este instante: los que
    // cruzan en ±(margen) segundos. Dos punteros sobre la lista ordenada — el
    // coste por paso es O(obstáculos cercanos), no O(total). Con la velocidad
    // más baja del perfil, la ventana más holgada.
    const reachS = 400 / profile.minSpeed;
    let lo = 0;
    let hi = 0;

    // Hitboxes reutilizadas: cero asignaciones dentro del bucle.
    const dh = { x: 0, y: 0, w: 0, h: 0 };
    const oh = { x: 0, y: 0, w: 0, h: 0 };

    // Activadores: cada uno se usa una vez; ventana por el mismo par de punteros.
    const used = new Uint8Array(triggers.length);
    let tlo = 0;
    let thi = 0;

    let inputIdx = 0;
    let modeIdx = 0;

    const flying = course !== null && !course.empty;
    let startT = script.length > 0 ? script[0].at : Infinity;
    let endT = -Infinity;
    if (obstacles.length > 0) {
        startT = Math.min(startT, obstacles[0].cross - reachS);
        endT = obstacles[obstacles.length - 1].cross + reachS;
    }
    if (flying) {
        startT = Math.min(startT, course.spans[0].tIn);
        endT = Math.max(endT, course.lastEnd);
    }
    startT -= 0.25;
    endT += 0.25;
    let holdIdx = -1;   // última nota que ya empezó (para atribuir un choque con el túnel)

    for (let tau = startT; tau <= endT; tau += dt) {
        // Mismo orden que GameSession: primero el portal, después las pulsaciones.
        while (modeIdx < modes.length && modes[modeIdx].t <= tau) enterMode(body, modes[modeIdx++].mode);
        while (inputIdx < script.length && script[inputIdx].at <= tau) applyInput(body, script[inputIdx++].input);

        integrateBody(body, dt, SIM_GROUND_Y);
        bodyHitbox(body, dh);

        if (triggers.length > 0) {
            while (thi < triggers.length && triggers[thi].cross <= tau + reachS) thi++;
            while (tlo < thi && triggers[tlo].cross < tau - reachS) tlo++;
            const nowD = profile.constant ? 0 : profile.distanceAt(tau);
            for (let i = tlo; i < thi; i++) {
                if (used[i] === 1) continue;
                const o = triggers[i];
                const ahead = profile.constant ? (o.cross - tau) * profile.base : triggerD[i] - nowD;
                triggerZone(o.def, DINO_CENTER_X + ahead - o.def.w / 2, obstacleTopY(o.def, SIM_GROUND_Y), oh);
                if (aabbHit(dh, oh) && applyTrigger(body, o.def) !== null) {
                    used[i] = 1;
                    bodyHitbox(body, dh);
                }
            }
        }

        if (flying) {
            while (holdIdx + 1 < holds.length && holds[holdIdx + 1].t <= tau) holdIdx++;
            if (course.collisionAt(dh, tau, SIM_GROUND_Y, profile.speedAt(tau))) {
                const k = Math.max(0, holdIdx);
                return { ok: false, index: obstacles.length + 2 * k, t: holds[k]?.t ?? tau, atSongTime: tau };
            }
        }

        while (hi < obstacles.length && obstacles[hi].cross <= tau + reachS) hi++;
        while (lo < hi && obstacles[lo].cross < tau - reachS) lo++;
        if (lo === hi) continue;

        const nowD = profile.distanceAt(tau);
        for (let i = lo; i < hi; i++) {
            const o = obstacles[i];
            // Con velocidad constante, la fórmula exacta de la Ola 3 (sin restar
            // dos distancias grandes): mismos resultados bit a bit que antes.
            const ahead = profile.constant ? (o.cross - tau) * profile.base : crossD[i] - nowD;
            const x = DINO_CENTER_X + ahead - o.def.w / 2;
            obstacleHitbox(o.def, x, obstacleTopY(o.def, SIM_GROUND_Y), oh);
            if (aabbHit(dh, oh)) {
                return { ok: false, index: i, t: o.t, atSongTime: tau };
            }
        }
    }
    return { ok: true };
}

/**
 * Error de la pulsación de quien juega con la VISTA (segundos; positivo =
 * tarde) ante una acción en `t` cuyo obstáculo cruza al Dino `leadS` después.
 *
 * Ese jugador pulsa cuando "distancia que falta / velocidad que percibe" llega
 * al adelanto de siempre. Con velocidad constante acierta exactamente (error
 * 0). Si el mundo acaba de acelerar, percibe una velocidad menor que la real,
 * cree que el obstáculo tarda más en llegar y pulsa tarde; si acaba de frenar,
 * pronto. El error empieza ANTES del cambio: un obstáculo se coloca con la
 * distancia que el mundo va a recorrer, así que el que cruza poco después de
 * un acelerón ya se ve más lejos de lo normal mientras el mundo aún no ha
 * acelerado. Medido con el charter de la Ola 5, que aceleraba en el primer
 * tiempo de cada drop: la acción del drop salía 41-58 ms tarde en los oficiales.
 *
 * Velocidad percibida = media real de los últimos `adaptS` segundos, que sale
 * exacta del perfil: (D(τ) − D(τ − adaptS)) / adaptS.
 *
 * @param {import('./speedProfile.js').SpeedProfile} profile
 * @param {number} t       Instante de acción del chart.
 * @param {number} leadS   Adelanto del kind (`physics.actionLeadS`).
 * @param {number} [adaptS=READER_ADAPT_S]
 * @returns {number}
 */
export function readerOffsetS(profile, t, leadS, adaptS = READER_ADAPT_S) {
    if (profile.constant) return 0;
    const cross = t + leadS;
    const crossD = profile.distanceAt(cross);
    // f(τ) = distancia que falta − adelanto × velocidad percibida. Decrece con
    // τ en todo el rango de perfiles del juego (cambios de ±50 %), así que su
    // raíz, el instante en que ese jugador pulsa, se encuentra por bisección.
    const f = (tau) => {
        const d = profile.distanceAt(tau);
        return crossD - d - leadS * (d - profile.distanceAt(tau - adaptS)) / adaptS;
    };
    let lo = t - READER_SEARCH_S;
    let hi = cross;
    if (f(lo) <= 0) return -READER_SEARCH_S;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2 - t;
}

/** Margen de búsqueda de la pulsación de `readerOffsetS` alrededor del instante del chart. */
const READER_SEARCH_S = 1;

/**
 * ¿Es justo el chart? Lo supera un jugador perfecto Y uno que se desvía
 * `toleranceS` en cualquier dirección, tanto si se guía por el oído (pulsa en
 * el golpe) como por la vista (con el error de `readerOffsetS` sumado).
 *
 * Tres pasadas por manera de jugar bastan. Los dos patrones alternos adelantan
 * cada obstáculo en una pasada y lo retrasan en la otra, y a la vez acortan y
 * alargan cada par de acciones consecutivas (una tarde y la siguiente pronto es
 * el peor caso real del hueco mínimo). Adelantar o retrasar TODO a la vez no
 * añade cobertura: deja los huecos iguales y cada obstáculo ya se prueba
 * desplazado. Con velocidad constante las dos maneras coinciden y se juega una.
 *
 * @param {SimObstacle[]} obstacles
 * @param {number | import('./speedProfile.js').SpeedProfile} speed
 * @param {{ toleranceS?: number, dt?: number, adaptS?: number, modes?: Array<{ t: number, mode: string }>,
 *           holds?: Array<{ t: number, until: number }>, course?: object | null, triggers?: SimObstacle[], flightPlayer?: object | null }} [opts]
 * @returns {{ ok: true } | { ok: false, index: number, t: number, pattern: string }}
 */
export function validatePlayability(obstacles, speed, opts = {}) {
    const tol = opts.toleranceS ?? DEFAULT_TOLERANCE_S;
    const profile = asSpeedProfile(speed);
    const patterns = [
        ['perfecto', () => 0],
        ['tarde-pronto', (i) => (i % 2 === 0 ? tol : -tol)],
        ['pronto-tarde', (i) => (i % 2 === 0 ? -tol : tol)],
    ];
    const runs = [...patterns];
    if (!profile.constant) {
        const adaptS = opts.adaptS ?? READER_ADAPT_S;
        const reader = obstacles.map((o) => readerOffsetS(profile, o.t, o.cross - o.t, adaptS));
        // Solo si la vista se equivoca en algún obstáculo añade algo jugarlo así.
        if (reader.some((e) => Math.abs(e) > 1e-4)) {
            for (const [name, offset] of patterns) runs.push([`vista-${name}`, (i) => (reader[i] ?? 0) + offset(i)]);
        }
    }
    for (const [name, pressOffset] of runs) {
        const r = simulateRun(obstacles, profile, {
            dt: opts.dt, pressOffset, modes: opts.modes, holds: opts.holds, course: opts.course, triggers: opts.triggers, flightPlayer: opts.flightPlayer,
        });
        if (!r.ok) return { ok: false, index: r.index, t: r.t, pattern: name };
    }
    return { ok: true };
}

/**
 * `validatePlayability` de un chart entero: sus obstáculos, sus portales y su
 * perfil de velocidad. La forma de validar un chart sin olvidar ninguna de las
 * tres cosas.
 *
 * @param {{ events: Array<{ t: number, type: string }>, world: { speedPxS: number, speedChanges?: object[] } }} chart
 * @param {{ toleranceS?: number, dt?: number, adaptS?: number }} [opts]
 */
export function validateChart(chart, opts = {}) {
    const course = createFlightCourse(chart.events);
    return validatePlayability(toSimObstacles(chart.events), speedProfileOf(chart), {
        ...opts,
        modes: toSimModes(chart.events),
        holds: toSimHolds(chart.events),
        course: course.empty ? null : course,
        triggers: toSimTriggers(chart.events),
    });
}

/** Resolución del barrido de `timingMarginsS`: 5 ms, por debajo de un frame. */
const WINDOW_SCAN_STEP_S = 0.005;
const WINDOW_SCAN_MAX_S = 0.5;
const marginCache = new Map();
const NO_MARGIN = Object.freeze({ early: 0, late: 0 });

/**
 * Anchura, en segundos, del margen de error de UNA acción aislada: el intervalo
 * continuo de desplazamientos de la pulsación (alrededor del instante del chart)
 * con los que el jugador sobrevive.
 *
 * Mide la exigencia de timing de un tipo de obstáculo a una velocidad, con la
 * física real. Hallazgo al medirlo (Ola 2): la velocidad importa, y al revés de
 * lo intuitivo — a menos px/s el obstáculo tarda más en atravesar al Dino y el
 * margen se ESTRECHA. CACTUS_WIDE: 116 ms a 250 px/s, 298 ms a 400 y 398 ms a
 * 600. Las canciones lentas son las más exigentes en timing.
 *
 * Memorizado por (kind, velocidad redondeada): el barrido cuesta ~200
 * simulaciones de un obstáculo, milisegundos, y se repite poco.
 *
 * Kinds de otros modos (Ola 6): se miden dentro de su modo, y uno que cuelga del
 * techo con el Dino ya arriba (un cristal del suelo antes, pulsado en su golpe).
 * En antigravedad nada limita pulsar pronto ante un cristal aislado: el margen
 * medido es el de pulsar tarde más el tope del barrido; lo que de verdad lo
 * acota es el cristal anterior, y eso lo cubre `validatePlayability`.
 *
 * @param {string} kind  Clave de OBSTACLE_KIND.
 * @param {number} speedPxS
 * @returns {number}  0 si ni la pulsación exacta sobrevive.
 */
export function timingWindowS(kind, speedPxS) {
    const { early, late } = timingMarginsS(kind, speedPxS);
    return Math.round((early + late) * 1000) / 1000;
}

/**
 * Los dos lados del margen de `timingWindowS`: cuánto se puede adelantar
 * (`early`) y retrasar (`late`) la pulsación de una acción aislada. Un
 * obstáculo exige tanta precisión como su lado más estrecho.
 *
 * @param {string} kind
 * @param {number} speedPxS
 * @returns {{ early: number, late: number }}  0 y 0 si ni la pulsación exacta sobrevive.
 */
export function timingMarginsS(kind, speedPxS) {
    // Un activador no se supera ni se falla por sí solo: lo mide el obstáculo que lo acompaña.
    if (OBSTACLE_KIND[kind]?.trigger !== undefined) return NO_MARGIN;
    const key = `${kind}@${Math.round(speedPxS)}`;
    const cached = marginCache.get(key);
    if (cached !== undefined) return cached;
    // Los modos que lo saben calcular sin simular (un salto al correr) lo dan directo.
    const known = OBSTACLE_KIND[kind] !== undefined ? movementMode(OBSTACLE_KIND[kind].mode ?? 'run').marginsS?.(OBSTACLE_KIND[kind], Math.round(speedPxS)) : null;
    if (known !== null && known !== undefined) {
        const fast = { early: Math.min(WINDOW_SCAN_MAX_S, Math.round(known.early * 1000) / 1000), late: Math.min(WINDOW_SCAN_MAX_S, Math.round(known.late * 1000) / 1000) };
        marginCache.set(key, fast);
        return fast;
    }

    const def = OBSTACLE_KIND[kind];
    const events = [{ t: 5, type: 'obstacle', kind }];
    let modes = [];
    if (def !== undefined && (def.mode ?? 'run') !== 'run') {
        modes = [{ t: 2, mode: def.mode }];
        if (def.surface === 'ceiling') {
            const lift = Object.keys(OBSTACLE_KIND).find((k) => OBSTACLE_KIND[k].mode === def.mode && OBSTACLE_KIND[k].surface === 'floor');
            if (lift !== undefined) events.unshift({ t: 3.5, type: 'obstacle', kind: lift });
        }
    }
    const obstacles = toSimObstacles(events);
    const target = obstacles.findIndex((o) => o.kind === kind && o.t === 5);
    const survives = (offset) => simulateRun(obstacles, speedPxS, { modes, pressOffset: (i) => (i === target ? offset : 0) }).ok;

    const out = { early: 0, late: 0 };
    if (target >= 0 && survives(0)) {
        const steps = Math.round(WINDOW_SCAN_MAX_S / WINDOW_SCAN_STEP_S);
        let early = 0;
        while (early < steps && survives(-(early + 1) * WINDOW_SCAN_STEP_S)) early++;
        let late = 0;
        while (late < steps && survives((late + 1) * WINDOW_SCAN_STEP_S)) late++;
        out.early = Math.round(early * WINDOW_SCAN_STEP_S * 1000) / 1000;
        out.late = Math.round(late * WINDOW_SCAN_STEP_S * 1000) / 1000;
    }
    marginCache.set(key, out);
    return out;
}
