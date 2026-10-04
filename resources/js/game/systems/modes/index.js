// Modos de movimiento — REGISTRO ÚNICO Y EXTENSIBLE (Ola 6).
//
// Un modo es un conjunto de reglas del cuerpo durante un tramo de la canción. El
// nivel cambia de modo con eventos `mode` del chart (un portal que cruza al Dino
// en ese instante) y todo lo demás lo consume de forma genérica:
//
//   physics.js       despacha integración, entradas y hitbox al modo del cuerpo
//   playability.js   el simulador aplica los cambios de modo en su instante
//   charter          qué acciones existen en cada modo y cuánto adelanto tienen
//   GameSession      portal, avisos y lo visual de cada modo
//
// Añadir un modo = un archivo con este contrato + una entrada aquí + sus kinds en
// OBSTACLE_KIND (con `mode` y `action`) + las reglas de dónde va (modePlan.js).
//
// Contrato:
//
// @typedef {Object} MovementMode
// @property {string} id
// @property {string} label        Nombre para el jugador.
// @property {{ keys: string, touch: string }} hint  Cómo se juega, con teclado y en táctil.
// @property {number} color        Portal, mapa de la canción y avisos.
// @property {readonly string[]} actions  Acciones del charter en este modo.
// @property {number} settleS      Tras entrar, cuánto esperar para la primera acción.
// @property {(body: object) => void} enter  Al cruzar su portal (el cuerpo viene del modo anterior).
// @property {(body: object, dt: number, groundY: number) => number} integrate  Devuelve BODY_EVENT.
// @property {(body: object, input: string) => string | null} input
//           Aplica una entrada cruda ('jump', 'jumpEnd', 'duckStart', 'duckEnd').
//           Devuelve el gesto que produjo ('jump', 'duck', 'flip') o null.
// @property {boolean} [tapJump]
//           Opcional: el modo distingue 'jumpTap', el salto de quien no puede decir
//           cuánto lo mantiene (el control facial de Vout). Sin él, le llega como
//           'jump' (physics.applyInput). Correr lo declara: ahí mantener alarga el
//           salto, y un 'jumpTap' da siempre el arco del nivel.
// @property {(body: object, out: object) => object} hitbox  La caja que envuelve al cuerpo.
// @property {(body: object) => number} [figure]
//           Opcional: qué parte de esa caja es cuerpo (geometry.FIGURE). Sin él, la caja entera.
// @property {(body: object, hits: (box: object, figure: number) => boolean) => void} [settle]
//           Opcional: la postura tras cada paso, que puede depender de lo que hay
//           alrededor (`hits` dice si una caja chocaría ahora). Correr lo usa para
//           no levantarse debajo de algo.
// @property {(def: object) => number} leadS  Adelanto de un kind de este modo.
// @property {(def: object, speedPxS: number, holdS?: number) => ({ early: number, late: number } | null)} [marginsS]
//           Opcional: márgenes de error de un kind aislado sin simular (el de
//           correr los calcula para los saltos, a toques o manteniendo `holdS`).
//           null o ausente: se simulan (playability.timingMarginsS).
// @property {(body: object, def: object) => string | null} [trigger]
//           Opcional (Ola 6c): el cuerpo atraviesa un activador del registro (un kind
//           con `trigger`, como el anillo de salto). Decide si se activa y aplica su
//           efecto; devuelve el gesto ('ring') o null. Un modo sin este gancho
//           ignora los activadores.

import { RUN_MODE } from './run.js';
import { FLIP_MODE_DEF } from './flip.js';
import { FLY_MODE_DEF } from './fly.js';

export { BODY_EVENT, bodyState } from './body.js';

export const MOVEMENT_MODES = Object.freeze({
    run: RUN_MODE,
    flip: FLIP_MODE_DEF,
    fly: FLY_MODE_DEF,
});

/** Modo con el que empieza todo nivel. */
export const DEFAULT_MODE = 'run';

/** @param {unknown} id */
export function isMovementMode(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MOVEMENT_MODES, id);
}

/** @param {string} id */
export function movementMode(id) {
    return MOVEMENT_MODES[id] ?? RUN_MODE;
}
