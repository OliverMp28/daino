// Cuerpo físico del Dino: el estado que integran los modos de movimiento (Ola 6).
//
// La entidad Dino (Pixi) y el jugador virtual del simulador tienen estos mismos
// campos, así que las reglas de cada modo se ejecutan igual sobre los dos.

import { COYOTE_TIME_S, DINO_SIZE, DINO_X } from '../../config.js';

/**
 * Lo que ocurre dentro de un paso de integración, como máscara de bits: la
 * partida lo usa para lo visual (squash al aterrizar, gesto de un salto
 * guardado); el simulador lo ignora.
 */
export const BODY_EVENT = Object.freeze({
    NONE: 0,
    /** Tocó la superficie hacia la que cae. */
    LANDED: 1,
    /** Al tocarla ejecutó la pulsación guardada (jump buffer). */
    BUFFERED: 2,
});

/**
 * @typedef {Object} Body
 * @property {number} x
 * @property {number} y            Esquina superior del box de pie (DINO_SIZE).
 * @property {number} vy
 * @property {boolean} grounded    Apoyado en la superficie hacia la que cae.
 * @property {boolean} ducking     Postura agachada (se ve y cuenta en el suelo).
 * @property {boolean} duckHeld    Se mantiene pulsado agacharse.
 * @property {number} duckT        Lo que queda del mínimo de un agachado (DUCK_MIN_S).
 * @property {boolean} fastFall
 * @property {boolean} jumpKey     La tecla de salto está abajo.
 * @property {boolean} jumpHeld    Este salto sigue mantenido (sube más: JUMP_HOLD).
 * @property {boolean} jumpGesture Lo mantiene un gesto de Vout, no una tecla: otra regla (GESTURE_JUMP).
 * @property {number} jumpT        Segundos desde que despegó del suelo (−1: no es un salto del suelo).
 * @property {number} coyoteT
 * @property {number} jumpBufferT
 * @property {boolean} dead
 * @property {string} mode         Id del modo de movimiento vigente.
 * @property {1 | -1} gravityDir   1 hacia el suelo; −1 hacia el techo.
 * @property {number} flyHeld      Botones mantenidos en el vuelo (Ola 6b).
 */

/** Estado de un cuerpo de pie en el suelo, corriendo. */
export function bodyState(groundY) {
    return {
        x: DINO_X,
        y: groundY - DINO_SIZE.h,
        vy: 0,
        grounded: true,
        ducking: false,
        duckHeld: false,
        duckT: 0,
        fastFall: false,
        jumpKey: false,
        jumpHeld: false,
        jumpGesture: false,
        jumpT: -1,
        coyoteT: COYOTE_TIME_S,
        jumpBufferT: 0,
        dead: false,
        mode: 'run',
        gravityDir: 1,
        flyHeld: 0,
    };
}
