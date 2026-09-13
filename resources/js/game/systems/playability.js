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
// Sin Pixi, sin DOM, sin audio: corre en Node (tests) y en el navegador
// (el charter lo usa para reparar charts antes de devolverlos).

import { OBSTACLE_KIND, DINO_X, DINO_SIZE, COYOTE_TIME_S, JUMP_BUFFER_S, PHYSICS_STEP_S } from '../config.js';
import {
    applyJump,
    applyDuckStart,
    applyDuckEnd,
    integrateDino,
    dinoHitbox,
    obstacleHitbox,
    obstacleTopY,
    obstacleLeftX,
    actionLeadS,
    isDuckKind,
    aabbHit,
} from './physics.js';

/**
 * Paso por defecto: EL MISMO que la física del juego (`PHYSICS_STEP_S`). La
 * partida real avanza en pasos fijos de ese tamaño, así que lo que el
 * simulador valida es exactamente lo que se juega, a cualquier framerate.
 */
const DEFAULT_DT = PHYSICS_STEP_S;

/** Suelo arbitrario: la simulación solo depende de posiciones relativas a él. */
const SIM_GROUND_Y = 1000;

/**
 * Margen tras el cruce en el que el jugador virtual sigue agachado, en px más
 * allá de medio obstáculo. Suelta cuando el ptero ya ha pasado del todo.
 */
const DUCK_HOLD_MARGIN_PX = 60;

/**
 * Tolerancia humana por defecto: ±40 ms. Con ella, el hueco mínimo real entre
 * acciones de la configuración actual es 0.70 s en el peor caso (medido), que
 * coincide con SPAWN_WINDOW_S.min.
 */
export const DEFAULT_TOLERANCE_S = 0.04;

/**
 * @typedef {Object} SimObstacle
 * @property {number} t      Instante de acción (del chart).
 * @property {string} kind
 * @property {object} def    Entrada de OBSTACLE_KIND.
 * @property {number} cross  Instante en que el centro cruza al Dino.
 */

/**
 * Prepara los obstáculos de un chart para simular: orden por acción y cruce
 * precalculado.
 *
 * @param {Array<{ t: number, type: string, kind?: string }>} events
 * @returns {SimObstacle[]}
 */
export function toSimObstacles(events) {
    const out = [];
    for (const e of events) {
        if (e.type !== 'obstacle') continue;
        const def = OBSTACLE_KIND[e.kind];
        if (def === undefined) continue;
        out.push({ t: e.t, kind: e.kind, def, cross: e.t + actionLeadS(def) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
}

/**
 * Juega una lista de obstáculos con un jugador virtual.
 *
 * @param {SimObstacle[]} obstacles
 * @param {number} speedPxS
 * @param {{ dt?: number, pressOffset?: (index: number) => number }} [opts]
 *        `pressOffset(i)` desplaza la pulsación del obstáculo i (segundos;
 *        negativo = se adelanta). Por defecto 0: jugador perfecto.
 * @returns {{ ok: true } | { ok: false, index: number, t: number, atSongTime: number }}
 */
export function simulateRun(obstacles, speedPxS, opts = {}) {
    if (obstacles.length === 0) return { ok: true };

    const dt = opts.dt ?? DEFAULT_DT;
    const pressOffset = opts.pressOffset ?? (() => 0);

    // Guion de pulsaciones del jugador virtual, ordenado en el tiempo.
    const presses = obstacles.map((o, i) => {
        const at = o.t + pressOffset(i);
        return isDuckKind(o.def)
            ? { at, action: 'duck', id: i, releaseAt: o.cross + (o.def.w / 2 + DUCK_HOLD_MARGIN_PX) / speedPxS }
            : { at, action: 'jump', id: i };
    }).sort((a, b) => a.at - b.at);

    const body = {
        x: DINO_X,
        y: SIM_GROUND_Y - DINO_SIZE.h,
        vy: 0,
        grounded: true,
        ducking: false,
        fastFall: false,
        jumpHeld: false,
        coyoteT: COYOTE_TIME_S,
        jumpBufferT: 0,
        dead: false,
    };

    // Ventana de obstáculos que pueden tocar al Dino en este instante: los que
    // cruzan en ±(margen) segundos. Dos punteros sobre la lista ordenada — el
    // coste por paso es O(obstáculos cercanos), no O(total).
    const reachS = 400 / speedPxS;
    let lo = 0;
    let hi = 0;

    // Hitboxes reutilizadas: cero asignaciones dentro del bucle.
    const dh = { x: 0, y: 0, w: 0, h: 0 };
    const oh = { x: 0, y: 0, w: 0, h: 0 };

    let pressIdx = 0;
    let duckOwner = -1;       // id de la pulsación de agachado vigente
    let duckReleaseAt = Infinity;
    let prevGrounded = true;

    const startT = Math.min(presses[0].at, obstacles[0].cross - reachS) - 0.25;
    const endT = obstacles[obstacles.length - 1].cross + reachS + 0.25;

    for (let tau = startT; tau <= endT; tau += dt) {
        while (pressIdx < presses.length && presses[pressIdx].at <= tau) {
            const p = presses[pressIdx++];
            if (p.action === 'jump') {
                // Igual que GameSession: si no puede saltar en el aire, se guarda.
                if (!applyJump(body) && !body.grounded) body.jumpBufferT = JUMP_BUFFER_S;
            } else {
                applyDuckStart(body);
                duckOwner = p.id;
                duckReleaseAt = p.releaseAt;
            }
        }
        // Solo suelta el agachado la pulsación que lo inició: si entre medias
        // hubo otra, esa manda.
        if (duckOwner >= 0 && tau >= duckReleaseAt) {
            applyDuckEnd(body);
            duckOwner = -1;
            duckReleaseAt = Infinity;
        }

        integrateDino(body, dt, SIM_GROUND_Y);
        if (!prevGrounded && body.grounded && body.jumpBufferT > 0) {
            body.jumpBufferT = 0;
            applyJump(body);
        }
        prevGrounded = body.grounded;

        while (hi < obstacles.length && obstacles[hi].cross <= tau + reachS) hi++;
        while (lo < hi && obstacles[lo].cross < tau - reachS) lo++;
        if (lo === hi) continue;

        dinoHitbox(body, dh);
        for (let i = lo; i < hi; i++) {
            const o = obstacles[i];
            const x = obstacleLeftX(o.def, o.cross, tau, speedPxS);
            obstacleHitbox(o.def, x, obstacleTopY(o.def, SIM_GROUND_Y), oh);
            if (aabbHit(dh, oh)) {
                return { ok: false, index: i, t: o.t, atSongTime: tau };
            }
        }
    }
    return { ok: true };
}

/**
 * ¿Es justo el chart? Lo supera un jugador perfecto Y uno que se desvía
 * `toleranceS` en cualquier dirección.
 *
 * Tres pasadas bastan. Los dos patrones alternos adelantan cada obstáculo en
 * una pasada y lo retrasan en la otra, y a la vez acortan y alargan cada par de
 * acciones consecutivas (una tarde y la siguiente pronto es el peor caso real
 * del hueco mínimo). Adelantar o retrasar TODO a la vez no añade cobertura:
 * deja los huecos iguales y cada obstáculo ya se prueba desplazado.
 *
 * @param {SimObstacle[]} obstacles
 * @param {number} speedPxS
 * @param {{ toleranceS?: number, dt?: number }} [opts]
 * @returns {{ ok: true } | { ok: false, index: number, t: number, pattern: string }}
 */
export function validatePlayability(obstacles, speedPxS, opts = {}) {
    const tol = opts.toleranceS ?? DEFAULT_TOLERANCE_S;
    const patterns = [
        ['perfecto', () => 0],
        ['tarde-pronto', (i) => (i % 2 === 0 ? tol : -tol)],
        ['pronto-tarde', (i) => (i % 2 === 0 ? -tol : tol)],
    ];
    for (const [name, pressOffset] of patterns) {
        const r = simulateRun(obstacles, speedPxS, { dt: opts.dt, pressOffset });
        if (!r.ok) return { ok: false, index: r.index, t: r.t, pattern: name };
    }
    return { ok: true };
}
