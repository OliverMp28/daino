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
import { FIGURE, standingHitbox } from '../geometry.js';
import { trackMarginsS } from '../trackMargins.js';
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
    /** Aquí mantener da forma al salto: un 'jumpTap' no lo alarga (ver `input`). */
    tapJump: true,

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
            case 'jumpTap':
                // 'jumpTap': un salto cuyo "soltar" no es de fiar (el control facial
                // de Vout lo avisa medio segundo tarde). No cuenta como mantenido:
                // da siempre el arco del nivel, dure lo que dure el gesto.
                body.jumpKey = input === 'jump';
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
     * Márgenes de error de un salto aislado, sin simular una partida: el salto se
     * integra UNA vez con el paso de la física (`jumpTrack`) y se pasa por delante
     * del obstáculo con la colisión de la partida (systems/trackMargins.js). Lo usa
     * `playability.timingMarginsS` (el charter lo consulta miles de veces al elegir
     * acentos). null para lo que no es un salto sobre algo apoyado en el suelo:
     * eso se mide simulando.
     *
     * Vale para cualquier dibujo: una hilera (el salto tiene que cubrirla entera),
     * un paso de medusa (algo encima antes del cactus: saltar pronto es subir contra
     * ello). Contrastado con el barrido fino del simulador (tests/js/challenge.test.mjs).
     *
     * Con `holdS`, los del salto MANTENIDO ese tiempo: sube más y aterriza más
     * tarde, así que perdona pulsar bastante antes, salvo que haya algo encima.
     *
     * @param {object} def
     * @param {number} speedPxS
     * @param {number} [holdS]  Cuánto se mantiene el salto (0: un toque, el arco base).
     * @returns {{ early: number, late: number } | null}
     */
    marginsS(def, speedPxS, holdS = 0) {
        if (def.action !== 'jump' || (def.surface ?? 'floor') !== 'floor' || def.altitude !== 0 || !(speedPxS > 0)) return null;
        return trackMarginsS(def, TRACK_GROUND - def.h, speedPxS, this.leadS(def), jumpTrack(holdS));
    },
});

/** Suelo sobre el que se integran los rastros (solo cuentan las posiciones relativas a él). */
const TRACK_GROUND = 1000;

/**
 * Rastro de un salto desde el suelo (trackMargins.BodyTrack): el arco base (un
 * toque) o el de mantener la tecla `holdS` segundos.
 */
const trackCache = new Map();
function jumpTrack(holdS = 0) {
    const cached = trackCache.get(holdS);
    if (cached !== undefined) return cached;
    const body = bodyState(TRACK_GROUND);
    const snapshot = () => ({ box: RUN_MODE.hitbox(body, { x: 0, y: 0, w: 0, h: 0 }), figure: RUN_MODE.figure(body) });
    const rest = snapshot();
    body.jumpKey = holdS > 0;
    jump(body);
    const steps = [];
    for (let i = 0; i < 400; i++) {
        // Igual que en la partida: soltar llega antes de integrar su paso.
        if (i * PHYSICS_STEP_S >= holdS) body.jumpHeld = false;
        RUN_MODE.integrate(body, PHYSICS_STEP_S, TRACK_GROUND);
        steps.push(snapshot());
        if (body.grounded) break;
    }
    const track = { rest, steps };
    trackCache.set(holdS, track);
    return track;
}
