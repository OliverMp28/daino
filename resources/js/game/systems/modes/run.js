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
    PHYSICS_STEP_S,
} from '../../config.js';
import { DINO_CENTER_X, obstacleHitbox, standingHitbox } from '../geometry.js';
import { BODY_EVENT, bodyState } from './body.js';

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
    hint: Object.freeze({ keys: 'Espacio: saltar · ↓: agacharse', touch: 'Toca a la izquierda para saltar y mantén la derecha para agacharte' }),
    actions: Object.freeze(['jump', 'duck']),
    /** Tras entrar, cuánto tarda en poder actuar con garantías: caer desde el techo de otro modo. */
    settleS: 0.45,

    enter(body) {
        body.jumpBufferT = 0;
        body.flyHeld = 0;
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

    /**
     * Márgenes de error de un salto aislado sobre un obstáculo del suelo, sin
     * simular una partida: el salto completo se integra UNA vez con el paso de la
     * física (`jumpArc`) y el margen sale de cuándo va por encima del obstáculo
     * frente a cuándo se solapan en horizontal, con los mismos hitboxes que la
     * partida. Lo usa `playability.timingMarginsS` (el charter lo consulta miles
     * de veces al elegir acentos). null para lo que no es un salto sobre algo
     * apoyado en el suelo: eso se mide simulando.
     *
     * Contrastado con el barrido fino del simulador en 7 kinds a 350-1050 px/s:
     * sesgo < 1 ms y error máximo 6 ms (tests/js/challenge.test.mjs).
     *
     * @param {object} def
     * @param {number} speedPxS
     * @returns {{ early: number, late: number } | null}
     */
    marginsS(def, speedPxS) {
        if (def.action !== 'jump' || (def.surface ?? 'floor') !== 'floor' || def.altitude !== 0 || !(speedPxS > 0)) return null;
        const G = 1000;
        const body = bodyState(G);
        const dino = standingHitbox(body, { x: 0, y: 0, w: 0, h: 0 });
        const box = obstacleHitbox(def, DINO_CENTER_X - def.w / 2, G - def.h, { x: 0, y: 0, w: 0, h: 0 });
        // Con el centro del obstáculo sobre el del Dino, cuánto mundo le falta
        // para dejar de solapar por cada lado: antes del cruce ya solapa desde
        // `reachBefore` de distancia y sigue haciéndolo `reachAfter` después.
        const reachBefore = dino.x + dino.w - box.x;
        const reachAfter = box.x + box.w - dino.x;
        // Va por encima mientras la base de su hitbox no baja de la cima del obstáculo.
        const clearY = box.y - (dino.y + dino.h - body.y);
        const arc = jumpArc();
        let first = -1;
        let last = -1;
        for (let k = 0; k < arc.length; k++) {
            if (arc[k] > clearY) continue;
            if (first < 0) first = k;
            last = k;
        }
        if (first < 0) return { early: 0, late: 0 };
        // El paso k del arco se comprueba k pasos después de pulsar, más medio
        // paso de media (la pulsación cae en cualquier punto de la rejilla). Al
        // bajar, el choque lo detecta el paso SIGUIENTE al último por encima, y
        // aterrizar lo retrasa otro medio: +2 pasos, medido.
        const dt = PHYSICS_STEP_S;
        const lead = this.leadS(def);
        const late = lead - (first + 0.5) * dt - reachBefore / speedPxS;
        const early = (last + 2) * dt - lead - reachAfter / speedPxS;
        return late < 0 || early < 0 ? { early: 0, late: 0 } : { early, late };
    },
});

/** Y (esquina superior del box de pie) tras cada paso de un salto completo desde un suelo en 1000. */
let arcCache = null;
function jumpArc() {
    if (arcCache !== null) return arcCache;
    const body = bodyState(1000);
    jump(body);
    const ys = [];
    for (let i = 0; i < 400; i++) {
        RUN_MODE.integrate(body, PHYSICS_STEP_S, 1000);
        ys.push(body.y);
        if (body.grounded) break;
    }
    arcCache = Float64Array.from(ys);
    return arcCache;
}
