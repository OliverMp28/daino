// Modo CORRER — saltar y agacharse (Bloque 5 + rediseño Jul 2026).
//
// Gravedad variable de plataformas moderno:
//   - Subiendo con el botón ya soltado → gravedad × JUMP_CUT_MULTIPLIER
//     (soltar pronto = salto corto; mantener = salto completo).
//   - ↓ en el aire (fast-fall) → gravedad × FAST_FALL_MULTIPLIER, y anula el
//     corte de salto (la intención "bajar YA" gana).
//   - Coyote time tras dejar el suelo y jump buffer justo antes de aterrizar.

import {
    COYOTE_TIME_S,
    DINO_SIZE,
    DUCK_HITBOX_PADDING,
    DUCK_SIZE,
    FAST_FALL_MULTIPLIER,
    FLIP_MODE,
    GRAVITY,
    JUMP_BUFFER_S,
    JUMP_CUT_MULTIPLIER,
    JUMP_VELOCITY,
    MODE_COLORS,
} from '../../config.js';
import { standingHitbox } from '../geometry.js';
import { BODY_EVENT } from './body.js';

function jump(body) {
    if (body.dead) return false;
    if (!body.grounded && body.coyoteT <= 0) return false;
    body.vy = -JUMP_VELOCITY;
    body.grounded = false;
    body.coyoteT = 0;
    body.jumpHeld = true;
    body.ducking = false;
    body.fastFall = false;
    return true;
}

/** @type {import('./index.js').MovementMode} */
export const RUN_MODE = Object.freeze({
    id: 'run',
    label: 'Correr',
    color: MODE_COLORS.run,
    actions: Object.freeze(['jump', 'duck']),
    /** Tras entrar, cuánto tarda en poder actuar con garantías: caer desde el techo de otro modo. */
    settleS: 0.45,

    enter(body) {
        body.jumpBufferT = 0;
        if (body.gravityDir < 0) {
            // Se sale cabeza abajo: vuelve la gravedad de siempre y el Dino cae
            // al suelo con impulso y fast-fall (~0.2 s desde el techo), no con la
            // caída lenta de un salto.
            body.gravityDir = 1;
            body.grounded = false;
            body.coyoteT = 0;
            body.vy = FLIP_MODE.kickPxS;
            body.fastFall = true;
        }
    },

    integrate(body, dt, groundY) {
        let g = GRAVITY;
        if (body.fastFall) g = GRAVITY * FAST_FALL_MULTIPLIER;
        else if (body.vy < 0 && !body.jumpHeld) g = GRAVITY * JUMP_CUT_MULTIPLIER;

        body.vy += g * dt;
        body.y += body.vy * dt;

        const wasGrounded = body.grounded;
        if (body.y + DINO_SIZE.h >= groundY) {
            body.y = groundY - DINO_SIZE.h;
            body.vy = 0;
            body.grounded = true;
            body.coyoteT = COYOTE_TIME_S;
            body.fastFall = false;
        } else {
            body.grounded = false;
            body.coyoteT = Math.max(0, body.coyoteT - dt);
        }
        if (body.jumpBufferT > 0) body.jumpBufferT = Math.max(0, body.jumpBufferT - dt);

        if (wasGrounded || !body.grounded) return BODY_EVENT.NONE;
        if (body.jumpBufferT > 0) {
            body.jumpBufferT = 0;
            jump(body);
            return BODY_EVENT.LANDED | BODY_EVENT.BUFFERED;
        }
        return BODY_EVENT.LANDED;
    },

    input(body, input) {
        switch (input) {
            case 'jump':
                if (jump(body)) return 'jump';
                // Pulsado un pelín antes de aterrizar: se guarda (jump buffer).
                if (!body.grounded && !body.dead) body.jumpBufferT = JUMP_BUFFER_S;
                return null;
            case 'jumpEnd':
                body.jumpHeld = false;
                return null;
            case 'duckStart': {
                if (body.dead) return null;
                const wasStanding = !body.ducking;
                body.ducking = true;
                if (!body.grounded) body.fastFall = true;
                return wasStanding && body.grounded ? 'duck' : null;
            }
            case 'duckEnd':
                body.ducking = false;
                body.fastFall = false;
                return null;
            default:
                return null;
        }
    },

    hitbox(body, out) {
        if (body.ducking && body.grounded) {
            // Agachado EN EL SUELO: box bajo, anclado a los pies y centrado.
            const p = DUCK_HITBOX_PADDING;
            const baseY = body.y + DINO_SIZE.h;
            const left = body.x + (DINO_SIZE.w - DUCK_SIZE.w) / 2;
            out.x = left + p.left;
            out.y = baseY - DUCK_SIZE.h + p.top;
            out.w = DUCK_SIZE.w - p.left - p.right;
            out.h = DUCK_SIZE.h - p.top - p.bottom;
            return out;
        }
        return standingHitbox(body, out, false);
    },

    /**
     * Adelanto por defecto: el tiempo al ápice del salto. Medido con la física
     * real (tests/js/sync-and-playability.test.mjs): la pulsación que maximiza
     * el margen ante un cactus cae 0.355-0.36 s antes del cruce a cualquier
     * velocidad, y para el ptero ese mismo adelanto queda holgado. Un kind puede
     * declarar `actionLeadS` propio.
     */
    leadS(def) {
        return def.actionLeadS ?? JUMP_VELOCITY / GRAVITY;
    },
});
