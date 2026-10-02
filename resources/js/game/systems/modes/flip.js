// Modo ANTIGRAVEDAD — invertir la gravedad entre el suelo y un techo (Ola 6).
//
// Por qué este modo primero: es la mecánica nueva que mejor encaja con "actúa
// sobre el golpe". Cada pulsación es un gesto discreto (como un salto), pero lo
// que se juega es distinto: no hay que calcular la altura de un salto sino
// ESTAR en la superficie buena cuando pasa cada cristal, y los patrones de la
// canción se convierten en un zigzag suelo-techo que se ve desde lejos.
//
// Reglas:
//   - Cualquier pulsación (saltar o agacharse) invierte la gravedad, solo
//     apoyado en una superficie; en el aire se guarda y dispara al tocarla
//     (mismo jump buffer que el salto).
//   - Despega con impulso (`kickPxS`) y acelera hacia la otra superficie: el
//     viaje dura ~0.21 s, rápido para que no quede flotando en medio.
//   - Soltar no hace nada. Cabeza abajo el hitbox refleja su relleno.

import { DINO_SIZE, FLIP_MODE, JUMP_BUFFER_S, MODE_COLORS, PHYSICS_STEP_S } from '../../config.js';
import { FIGURE, ceilingYOf, obstacleHitbox, standingHitbox } from '../geometry.js';
import { trackMarginsS } from '../trackMargins.js';
import { BODY_EVENT, bodyState } from './body.js';

function flip(body) {
    body.gravityDir = body.gravityDir > 0 ? -1 : 1;
    body.vy = FLIP_MODE.kickPxS * body.gravityDir;
    body.grounded = false;
    body.coyoteT = 0;
}

/** Tiempo desde la pulsación hasta despejar un cristal de cada kind (memoria). */
const clearCache = new Map();

/** @type {import('./index.js').MovementMode} */
export const FLIP_MODE_DEF = Object.freeze({
    id: 'flip',
    label: 'Antigravedad',
    color: MODE_COLORS.flip,
    hint: Object.freeze({ keys: 'Espacio: invertir la gravedad', touch: 'Toca para invertir la gravedad' }),
    actions: Object.freeze(['flip']),
    /** Tras cruzar el portal, hasta poder actuar: el Dino puede venir del final de un salto. */
    settleS: 0.3,

    enter(body) {
        body.flyHeld = 0;
        body.ducking = false;
        body.duckHeld = false;
        body.jumpKey = false;
        body.jumpHeld = false;
        body.jumpT = -1;
        body.duckT = 0;
        body.fastFall = false;
        body.jumpBufferT = 0;
    },

    integrate(body, dt, groundY) {
        const ceilingY = ceilingYOf(groundY);
        const dir = body.gravityDir;
        const max = FLIP_MODE.maxSpeedPxS;
        body.vy += FLIP_MODE.gravity * dir * dt;
        if (body.vy > max) body.vy = max;
        else if (body.vy < -max) body.vy = -max;
        body.y += body.vy * dt;

        const wasGrounded = body.grounded;
        if (body.y + DINO_SIZE.h >= groundY) {
            body.y = groundY - DINO_SIZE.h;
            if (dir > 0) {
                body.vy = 0;
                body.grounded = true;
            }
        } else if (body.y <= ceilingY) {
            body.y = ceilingY;
            if (dir < 0) {
                body.vy = 0;
                body.grounded = true;
            }
        } else {
            body.grounded = false;
        }
        if (body.jumpBufferT > 0) body.jumpBufferT = Math.max(0, body.jumpBufferT - dt);

        if (wasGrounded || !body.grounded) return BODY_EVENT.NONE;
        if (body.jumpBufferT > 0) {
            body.jumpBufferT = 0;
            flip(body);
            return BODY_EVENT.LANDED | BODY_EVENT.BUFFERED;
        }
        return BODY_EVENT.LANDED;
    },

    input(body, input) {
        if (input !== 'jump' && input !== 'duckStart') return null;
        if (body.dead) return null;
        if (body.grounded) {
            flip(body);
            return 'flip';
        }
        body.jumpBufferT = JUMP_BUFFER_S;
        return null;
    },

    hitbox(body, out) {
        return standingHitbox(body, out, body.gravityDir < 0);
    },

    figure(body) {
        return body.gravityDir < 0 ? FIGURE.STANDING_INVERTED : FIGURE.STANDING;
    },

    /**
     * Adelanto de un cristal: lo que tarda el Dino, desde la pulsación, en
     * despejar su altura, más `leadMarginS`. Se deriva de la física (paso a paso,
     * con el mismo paso que la partida): retocar el pasillo o la gravedad no
     * desplaza ningún chart publicado de su golpe.
     *
     * El margen deja la pulsación en el golpe con holgura por los dos lados en
     * los patrones apretados (suelo, techo, suelo… a un beat): medido en
     * tests/js/modes.test.mjs. Un kind puede declarar el suyo (`leadMarginS`):
     * los cristales afilados de los acentos llegan antes tras el golpe.
     */
    leadS(def) {
        return def.actionLeadS ?? clearTimeS(def) + (def.leadMarginS ?? FLIP_MODE.leadMarginS);
    },

    /**
     * Márgenes de error de una inversión aislada ante un cristal, sin simular una
     * partida (systems/trackMargins.js): el viaje de una superficie a la otra se
     * integra una vez. Simétrico: lo que cuelga del techo se mide como si
     * estuviera en el suelo (el Dino sale de la superficie del cristal).
     *
     * Un cristal suelto no limita pulsar pronto (el margen llega al tope del
     * barrido); una pinza sí: tiene otro cristal en la superficie de llegada.
     *
     * @param {object} def
     * @param {number} speedPxS
     * @returns {{ early: number, late: number } | null}
     */
    marginsS(def, speedPxS) {
        if (def.action !== 'flip' || !(speedPxS > 0)) return null;
        const floor = def.surface === 'ceiling' ? floorTwin(def) : def;
        return trackMarginsS(floor, TRACK_GROUND - floor.h - floor.altitude, speedPxS, this.leadS(def), flipTrack());
    },
});

const TRACK_GROUND = 1000;

/** El mismo kind apoyado en el suelo (para medir por simetría lo que cuelga del techo). */
const twins = new WeakMap();
function floorTwin(def) {
    let twin = twins.get(def);
    if (twin === undefined) {
        twin = { ...def, surface: 'floor' };
        twins.set(def, twin);
    }
    return twin;
}

/** Rastro de una inversión desde el suelo hasta quedar apoyado en el techo (trackMargins.BodyTrack). */
let flipTrackCache = null;
function flipTrack() {
    if (flipTrackCache !== null) return flipTrackCache;
    const body = bodyState(TRACK_GROUND);
    body.mode = 'flip';
    const snapshot = () => ({ box: FLIP_MODE_DEF.hitbox(body, { x: 0, y: 0, w: 0, h: 0 }), figure: FLIP_MODE_DEF.figure(body) });
    const rest = snapshot();
    flip(body);
    const steps = [];
    for (let i = 0; i < 400; i++) {
        FLIP_MODE_DEF.integrate(body, PHYSICS_STEP_S, TRACK_GROUND);
        steps.push(snapshot());
        if (body.grounded) break;
    }
    flipTrackCache = { rest, steps };
    return flipTrackCache;
}

/**
 * Segundos desde que se invierte la gravedad apoyado en una superficie hasta
 * que el hitbox del Dino deja de solapar en vertical con un obstáculo de esa
 * superficie. Simétrico: suelo → techo y techo → suelo dan lo mismo.
 *
 * @param {{ h: number, altitude: number }} def
 */
export function clearTimeS(def) {
    const ground = 1000;
    const box = { x: 0, y: 0, w: 0, h: 0 };
    // Borde superior del hitbox del kind apoyado en el suelo (con su relleno o sus piezas).
    const hazardTop = obstacleHitbox({ ...def, surface: 'floor' }, 0, ground - def.h - def.altitude, box).y;
    const key = hazardTop;
    const cached = clearCache.get(key);
    if (cached !== undefined) return cached;

    const body = bodyState(ground);
    body.mode = 'flip';
    flip(body);
    let t = 0;
    for (let i = 0; i < 2000; i++) {
        FLIP_MODE_DEF.integrate(body, PHYSICS_STEP_S, ground);
        t += PHYSICS_STEP_S;
        standingHitbox(body, box, body.gravityDir < 0);
        if (box.y + box.h <= hazardTop) break;
    }
    const out = Math.round(t * 1e6) / 1e6;
    clearCache.set(key, out);
    return out;
}
