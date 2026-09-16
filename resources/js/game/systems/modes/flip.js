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

import { DINO_SIZE, FLIP_MODE, JUMP_BUFFER_S, MODE_COLORS, OBSTACLE_HITBOX_PADDING, PHYSICS_STEP_S } from '../../config.js';
import { ceilingYOf, standingHitbox } from '../geometry.js';
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
        body.fastFall = false;
        body.jumpHeld = false;
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

    /**
     * Adelanto de un cristal: lo que tarda el Dino, desde la pulsación, en
     * despejar su altura, más `leadMarginS`. Se deriva de la física (paso a paso,
     * con el mismo paso que la partida): retocar el pasillo o la gravedad no
     * desplaza ningún chart publicado de su golpe.
     *
     * El margen deja la pulsación en el golpe con holgura por los dos lados en
     * los patrones apretados (suelo, techo, suelo… a un beat): medido en
     * tests/js/modes.test.mjs.
     */
    leadS(def) {
        return clearTimeS(def) + FLIP_MODE.leadMarginS;
    },
});

/**
 * Segundos desde que se invierte la gravedad apoyado en una superficie hasta
 * que el hitbox del Dino deja de solapar en vertical con un obstáculo de esa
 * superficie. Simétrico: suelo → techo y techo → suelo dan lo mismo.
 *
 * @param {{ h: number, altitude: number }} def
 */
export function clearTimeS(def) {
    const key = `${def.h}/${def.altitude}`;
    const cached = clearCache.get(key);
    if (cached !== undefined) return cached;

    const ground = 1000;
    const body = bodyState(ground);
    body.mode = 'flip';
    const box = { x: 0, y: 0, w: 0, h: 0 };
    // Borde superior del hitbox de un cristal del suelo (con su relleno).
    const hazardTop = ground - def.h - def.altitude + OBSTACLE_HITBOX_PADDING.top;
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
