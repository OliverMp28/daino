// Modo CORRER — saltar y agacharse (Bloque 5 + rediseño Jul 2026).
//
// Una pulsación, un gesto (Oct 2026): cada acción del nivel se supera pulsando
// en su golpe, se mantenga la tecla o no.
//   - Saltar: un toque da el arco base, el que el charter usa para colocar los
//     obstáculos. Mantener lo hace más alto y más largo (JUMP_HOLD): el jugador
//     calcula su salto. El arco mantenido va siempre por encima del base.
//   - Agacharse: un toque deja al Dino agachado un mínimo (DUCK_MIN_S) y, si al
//     soltar tiene algo encima, sigue agachado hasta que pasa (`settle`): nadie
//     se levanta debajo de un ptero. Mantener sigue valiendo.
//   - ↓ en el aire (fast-fall) → gravedad × FAST_FALL_MULTIPLIER: es la manera de
//     caer antes.
//   - Coyote time tras dejar el suelo y jump buffer justo antes de aterrizar.

import {
    COYOTE_TIME_S,
    DINO_SIZE,
    DUCK_HITBOX_PADDING,
    DUCK_MIN_S,
    DUCK_SIZE,
    FAST_FALL_DOWN_MULTIPLIER,
    FAST_FALL_MULTIPLIER,
    FLIP_MODE,
    GRAVITY,
    JUMP_BUFFER_S,
    JUMP_HOLD,
    JUMP_RING,
    JUMP_VELOCITY,
    MODE_COLORS,
    PHYSICS_STEP_S,
} from '../../config.js';
import { DINO_CENTER_X, FIGURE, obstacleRects, standingHitbox } from '../geometry.js';
import { BODY_EVENT, bodyState } from './body.js';

/** Caja de pie para preguntar si cabe levantarse (`settle`): no se asigna una por paso. */
const STAND_PROBE = { x: 0, y: 0, w: 0, h: 0 };

function jump(body) {
    if (body.dead) return false;
    if (!body.grounded && body.coyoteT <= 0) return false;
    launch(body, JUMP_VELOCITY);
    // Salto del suelo: mantenido sube más (JUMP_HOLD). El de un anillo, no.
    body.jumpT = 0;
    body.jumpHeld = body.jumpKey;
    return true;
}

function launch(body, velocity) {
    body.vy = -velocity;
    body.grounded = false;
    body.coyoteT = 0;
    // Saltar deja de agacharse, aunque ↓ siga pulsado (hay que volver a pulsarlo).
    body.ducking = false;
    body.duckHeld = false;
    body.duckT = 0;
    body.fastFall = false;
    body.jumpT = -1;
    body.jumpHeld = false;
}

/** @type {import('./index.js').MovementMode} */
export const RUN_MODE = Object.freeze({
    id: 'run',
    label: 'Correr',
    color: MODE_COLORS.run,
    hint: Object.freeze({ keys: 'Espacio: saltar · ↓: agacharse', touch: 'Toca a la izquierda para saltar y a la derecha para agacharte' }),
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
        if (body.fastFall) g = GRAVITY * (body.vy > 0 ? FAST_FALL_DOWN_MULTIPLIER : FAST_FALL_MULTIPLIER);
        else if (body.jumpT >= 0) {
            // Mantenido, sube con menos gravedad: más alto y más tiempo en el aire.
            // Solo pasado `afterS`: un toque es exactamente el arco base.
            if (body.jumpHeld && body.vy < 0 && body.jumpT >= JUMP_HOLD.afterS) g = GRAVITY * JUMP_HOLD.liftGravity;
            body.jumpT += dt;
        }

        body.vy += g * dt;
        body.y += body.vy * dt;

        const wasGrounded = body.grounded;
        if (body.y + DINO_SIZE.h >= groundY) {
            body.y = groundY - DINO_SIZE.h;
            body.vy = 0;
            body.grounded = true;
            body.coyoteT = COYOTE_TIME_S;
            body.fastFall = false;
            body.jumpT = -1;
        } else {
            body.grounded = false;
            body.coyoteT = Math.max(0, body.coyoteT - dt);
        }
        if (body.jumpBufferT > 0) body.jumpBufferT = Math.max(0, body.jumpBufferT - dt);
        if (body.duckT > 0) body.duckT = Math.max(0, body.duckT - dt);

        if (wasGrounded || !body.grounded) return BODY_EVENT.NONE;
        if (body.jumpBufferT > 0) {
            body.jumpBufferT = 0;
            jump(body);
            return BODY_EVENT.LANDED | BODY_EVENT.BUFFERED;
        }
        return BODY_EVENT.LANDED;
    },

    /**
     * Levantarse. Quien ya no mantiene ↓ y agotó el mínimo del gesto se levanta
     * en cuanto cabe: en el suelo, solo si de pie no chocaría con nada (`hits`).
     * Soltar pronto bajo un ptero ya no es morir; el Dino espera a que pase.
     */
    settle(body, hits) {
        if (!body.ducking || body.duckHeld || body.duckT > 0) return;
        if (body.grounded && hits(standingHitbox(body, STAND_PROBE, false), FIGURE.STANDING)) return;
        body.ducking = false;
        body.fastFall = false;
    },

    input(body, input) {
        switch (input) {
            case 'jump':
                body.jumpKey = true;
                if (jump(body)) return 'jump';
                // Pulsado un pelín antes de aterrizar: se guarda (jump buffer).
                if (!body.grounded && !body.dead) body.jumpBufferT = JUMP_BUFFER_S;
                return null;
            case 'jumpEnd':
                body.jumpKey = false;
                body.jumpHeld = false;
                return null;
            case 'duckStart': {
                if (body.dead) return null;
                const wasStanding = !body.ducking;
                body.ducking = true;
                body.duckHeld = true;
                body.duckT = DUCK_MIN_S;
                if (!body.grounded) body.fastFall = true;
                return wasStanding && body.grounded ? 'duck' : null;
            }
            case 'duckEnd':
                // La postura la resuelve `settle`: el mínimo del gesto y lo que haya encima.
                body.duckHeld = false;
                return null;
            default:
                return null;
        }
    },

    /**
     * Activador atravesado (Ola 6c). Un anillo de salto vuelve a impulsar al Dino
     * si hay una pulsación de salto pendiente: hecha dentro del aro o guardada un
     * pelín antes (jump buffer), igual que al aterrizar. En el suelo no hace nada:
     * ahí la pulsación ya fue un salto normal.
     *
     * @returns {string | null}  'ring' si se activó.
     */
    trigger(body, def) {
        if (def.trigger !== 'jump' || body.dead || body.grounded || body.jumpBufferT <= 0) return null;
        body.jumpBufferT = 0;
        launch(body, JUMP_RING.impulsePxS);
        return 'ring';
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

    figure(body) {
        return body.ducking && body.grounded ? FIGURE.BOX : FIGURE.STANDING;
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
     * simular una partida: el salto se integra UNA vez con el paso de la
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
        const arc = jumpArc();
        const dt = PHYSICS_STEP_S;
        const lead = this.leadS(def);
        let early = Infinity;
        let late = Infinity;
        // Cada pieza del obstáculo (una sola caja, casi siempre) deja su margen;
        // el salto tiene que salvarlas todas: manda la más estrecha por cada lado.
        for (const box of obstacleRects(def, DINO_CENTER_X - def.w / 2, G - def.h)) {
            // Con el centro del obstáculo sobre el del Dino, cuánto mundo le falta
            // para dejar de solapar por cada lado: antes del cruce ya solapa desde
            // `reachBefore` de distancia y sigue haciéndolo `reachAfter` después.
            const reachBefore = dino.x + dino.w - box.x;
            const reachAfter = box.x + box.w - dino.x;
            // Va por encima mientras la base de su hitbox no baja de la cima de la pieza.
            const clearY = box.y - (dino.y + dino.h - body.y);
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
            late = Math.min(late, lead - (first + 0.5) * dt - reachBefore / speedPxS);
            early = Math.min(early, (last + 2) * dt - lead - reachAfter / speedPxS);
        }
        return late < 0 || early < 0 ? { early: 0, late: 0 } : { early, late };
    },
});

/** Y (esquina superior del box de pie) tras cada paso de un salto desde un suelo en 1000. */
let arcCache = null;
function jumpArc() {
    if (arcCache !== null) return arcCache;
    const body = bodyState(1000);
    jump(body);   // sin mantener: el arco base
    const ys = [];
    for (let i = 0; i < 400; i++) {
        RUN_MODE.integrate(body, PHYSICS_STEP_S, 1000);
        ys.push(body.y);
        if (body.grounded) break;
    }
    arcCache = Float64Array.from(ys);
    return arcCache;
}
