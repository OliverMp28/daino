// Modo VUELO — mantener para subir, soltar para bajar (Ola 6b).
//
// La antigravedad se juega a golpes: cada pulsación, un cambio. El vuelo se juega
// con NOTAS MANTENIDAS: mientras la nota suena, el Dino sube; cuando acaba, baja.
// Es el verbo que al juego le faltaba (en Piano Tiles, una de sus referencias,
// las fichas largas) y por eso el reparto de modos lo pone en los pasajes
// sostenidos y melódicos, y la antigravedad en los de golpes marcados.
//
// Reglas:
//   - Mantener cualquier botón (saltar o agacharse, izquierda o derecha en
//     táctil) sube; soltarlos todos, baja. Se cuentan los mantenidos: soltar uno
//     de dos no baja.
//   - Sube y baja en línea recta y a velocidad fija, entre el suelo y el techo
//     del pasillo. Nada de inercia: el camino que dibuja el Dino es exactamente
//     el ritmo de las pulsaciones, y el túnel (systems/flightCourse.js) se
//     construye con ese mismo camino.
//   - No hay obstáculos sueltos: el túnel sigue el camino de las notas.

import { DINO_SIZE, FLY_MODE, MODE_COLORS } from '../../config.js';
import { ceilingYOf, standingHitbox } from '../geometry.js';
import { BODY_EVENT } from './body.js';

/** @type {import('./index.js').MovementMode} */
export const FLY_MODE_DEF = Object.freeze({
    id: 'fly',
    label: 'Vuelo',
    color: MODE_COLORS.fly,
    hint: Object.freeze({ keys: 'Mantén Espacio para subir', touch: 'Mantén el dedo en la pantalla para subir' }),
    actions: Object.freeze(['hold']),
    /** Tras cruzar el portal: el Dino puede venir del final de un salto (boca del túnel). */
    settleS: FLY_MODE.entryOpenS,

    enter(body) {
        // Se empieza sin nada mantenido: lo que se pulsó corriendo (un salto, un
        // agachado) no debe hacer subir al Dino nada más cruzar el portal.
        body.flyHeld = 0;
        body.gravityDir = 1;
        body.ducking = false;
        body.fastFall = false;
        body.jumpHeld = false;
        body.jumpBufferT = 0;
        body.vy = 0;
    },

    integrate(body, dt, groundY) {
        const top = ceilingYOf(groundY);
        const bottom = groundY - DINO_SIZE.h;
        body.vy = body.flyHeld > 0 ? -FLY_MODE.climbPxS : FLY_MODE.divePxS;
        body.y += body.vy * dt;
        if (body.y < top) body.y = top;
        if (body.y > bottom) body.y = bottom;

        const wasGrounded = body.grounded;
        body.grounded = body.y >= bottom;
        if (body.grounded || body.y <= top) body.vy = 0;
        return !wasGrounded && body.grounded ? BODY_EVENT.LANDED : BODY_EVENT.NONE;
    },

    input(body, input) {
        if (input === 'jump' || input === 'duckStart') {
            if (body.dead) return null;
            body.flyHeld++;
            return body.flyHeld === 1 ? 'climb' : null;
        }
        if (input === 'jumpEnd' || input === 'duckEnd') {
            body.flyHeld = Math.max(0, body.flyHeld - 1);
        }
        return null;
    },

    hitbox(body, out) {
        return standingHitbox(body, out, false);
    },

    /** Sin obstáculos sueltos: el túnel se coloca con el camino, no con adelanto. */
    leadS() {
        return 0;
    },
});
