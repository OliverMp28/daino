// physics.js — la física del juego, pura y sin Pixi.
//
// La partida (GameSession) y el simulador del charter (playability.js) llaman a
// estas mismas funciones: no hay una segunda copia de las reglas que se pueda
// desincronizar. Si alguien retoca el salto, el coyote time o la antigravedad,
// el validador de charts lo hereda solo.
//
// Ola 6 — las reglas del cuerpo dependen del MODO DE MOVIMIENTO vigente
// (systems/modes/): correr, antigravedad… Este módulo despacha al modo del
// cuerpo; la geometría compartida (superficies, hitboxes, posiciones) vive en
// geometry.js.
//
// "Cuerpo" = cualquier objeto con los campos de `modes/body.js` (la entidad
// Dino o el jugador virtual del simulador).

import { GRAVITY, JUMP_VELOCITY } from '../config.js';
import { MOVEMENT_MODES, movementMode } from './modes/index.js';
import { DINO_CENTER_X, FIGURE } from './geometry.js';

export {
    DINO_CENTER_X,
    FIGURE,
    aabbHit,
    ceilingYOf,
    computeGroundY,
    figureHit,
    obstacleHit,
    obstacleHitbox,
    obstacleRects,
    obstacleTopY,
    triggerZone,
} from './geometry.js';
export { BODY_EVENT, bodyState } from './modes/index.js';

/**
 * Integra un paso sobre el cuerpo con las reglas de su modo. Mutación in-place:
 * cero basura en el bucle de frame.
 *
 * @param {object} body
 * @param {number} dt       Segundos (en partida, siempre PHYSICS_STEP_S).
 * @param {number} groundY  Suelo en unidades de mundo.
 * @returns {number}        Máscara BODY_EVENT (aterrizó, disparó una pulsación guardada).
 */
export function integrateBody(body, dt, groundY) {
    return movementMode(body.mode).integrate(body, dt, groundY);
}

/**
 * Aplica una entrada cruda del jugador ('jump', 'jumpEnd', 'duckStart',
 * 'duckEnd'). Cada modo decide qué significa: corriendo, saltar o agacharse; en
 * antigravedad, cualquier pulsación invierte la gravedad.
 *
 * 'jumpGesture' es el salto que pulsa un gesto del control facial de Vout. Solo
 * lo distingue el modo que lo declara (`gestureJump`): para los demás es un 'jump'
 * como cualquiera (el propulsor sube mientras dure, lo pulse quien lo pulse).
 *
 * @param {object} body
 * @param {string} input
 * @returns {string | null}  Gesto que produjo ('jump', 'duck', 'flip') o null.
 */
export function applyInput(body, input) {
    const mode = movementMode(body.mode);
    return mode.input(body, input === 'jumpGesture' && mode.gestureJump !== true ? 'jump' : input);
}

/**
 * El cuerpo atraviesa un activador (anillo de salto, Ola 6c): lo decide y lo
 * aplica su modo. La partida y el simulador lo llaman igual, tras integrar el paso,
 * con el activador cuya zona (`triggerZone`) toca el hitbox.
 *
 * @param {object} body
 * @param {{ trigger: string }} def  Entrada de OBSTACLE_KIND con `trigger`.
 * @returns {string | null}  Gesto que produjo ('ring') o null si no se activó.
 */
export function applyTrigger(body, def) {
    return movementMode(body.mode).trigger?.(body, def) ?? null;
}

/**
 * Cambia el modo del cuerpo (un portal cruza al Dino). Idempotente.
 * @param {object} body
 * @param {string} modeId
 */
export function enterMode(body, modeId) {
    if (body.mode === modeId || MOVEMENT_MODES[modeId] === undefined) return;
    body.mode = modeId;
    MOVEMENT_MODES[modeId].enter(body);
}

/**
 * Rectángulo de colisión del cuerpo en su modo y postura.
 * @param {object} body
 * @param {{ x: number, y: number, w: number, h: number }} [out]  Se rellena y se devuelve.
 */
export function bodyHitbox(body, out = { x: 0, y: 0, w: 0, h: 0 }) {
    return movementMode(body.mode).hitbox(body, out);
}

/**
 * Qué parte de su caja es cuerpo (geometry.FIGURE): con ella y la caja,
 * `figureHit` decide si algo lo toca.
 * @param {object} body
 */
export function bodyFigure(body) {
    return movementMode(body.mode).figure?.(body) ?? FIGURE.BOX;
}

/**
 * Postura del cuerpo tras un paso (después de `integrateBody`, antes de mirar
 * choques). La partida y el simulador lo llaman igual. `hits(box, figure)` dice
 * si esa caja chocaría con algo en este instante.
 *
 * @param {object} body
 * @param {(box: { x: number, y: number, w: number, h: number }, figure: number) => boolean} hits
 */
export function settlePosture(body, hits) {
    movementMode(body.mode).settle?.(body, hits);
}

/**
 * Segundos desde el despegue hasta el ápice del salto. Deriva de la
 * física: retocar `JUMP_VELOCITY` o `GRAVITY` reajusta solo el adelanto de los
 * obstáculos de correr.
 */
export function jumpApexTimeS() {
    return JUMP_VELOCITY / GRAVITY;
}

/**
 * Adelanto entre el instante musical de un evento (`chart.events[].t`, cuando el
 * jugador debe actuar) y el instante en que el centro del obstáculo cruza al
 * Dino. Lo decide el modo del kind: el ápice del salto al correr, lo que tarda
 * en despejar un cristal en antigravedad. Pulsar SOBRE el golpe es siempre la
 * jugada buena.
 *
 * @param {{ mode?: string, actionLeadS?: number }} def  Entrada de OBSTACLE_KIND.
 */
export function actionLeadS(def) {
    return movementMode(def.mode ?? 'run').leadS(def);
}

/**
 * X (borde izquierdo) de un obstáculo en un instante de canción dado.
 *
 * Es LA fórmula de la sincronía (Ola 3), compartida por el spawner real y por el
 * simulador. La posición se DERIVA del reloj de audio en vez de integrarse: no
 * acumula deriva y no depende del ancho de la ventana. Con velocidad variable
 * (Ola 5), "(cruce − ahora) · velocidad" es la distancia que el mundo recorre
 * entre ambos instantes (speedProfile.js); el cruce sigue ocurriendo en `crossT`.
 *
 * @param {{ w: number }} def
 * @param {number} crossT     Instante en que el centro del obstáculo cruza al Dino.
 * @param {number} songTime   Instante actual de canción.
 * @param {number | import('./speedProfile.js').SpeedProfile} speed
 */
export function obstacleLeftX(def, crossT, songTime, speed) {
    const ahead = typeof speed === 'number' ? (crossT - songTime) * speed : speed.distanceBetween(songTime, crossT);
    return DINO_CENTER_X + ahead - def.w / 2;
}
