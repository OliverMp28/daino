// Geometría del juego: superficies, cajas de colisión y posiciones (Ola 6).
//
// Separada de physics.js para que cada modo de movimiento (systems/modes/) la
// use sin importar el despachador de física, que a su vez importa los modos.
// Pura, sin Pixi: la comparten la partida, el spawner y el simulador del charter.

import {
    DINO_X,
    DINO_SIZE,
    DINO_HITBOX_PADDING,
    CORRIDOR_HEIGHT_PX,
    GROUND_OFFSET_PX,
    OBSTACLE_HITBOX_PADDING,
} from '../config.js';

/**
 * Coordenada Y del SUELO para una vista de cierta altura (no la base del Dino):
 * donde se apoyan también los obstáculos.
 */
export function computeGroundY(viewportHeight) {
    return viewportHeight - GROUND_OFFSET_PX;
}

/** Superficie del techo de los modos que lo tienen (antigravedad, vuelo). */
export function ceilingYOf(groundY) {
    return groundY - CORRIDOR_HEIGHT_PX;
}

/**
 * Centro horizontal del hitbox del Dino de pie. Es el punto de referencia del
 * juego: un obstáculo "llega" al Dino cuando su centro cruza este x.
 * Constante porque el Dino nunca se mueve en horizontal.
 */
export const DINO_CENTER_X = DINO_X + DINO_HITBOX_PADDING.left
    + (DINO_SIZE.w - DINO_HITBOX_PADDING.left - DINO_HITBOX_PADDING.right) / 2;

/**
 * Hitbox del Dino de pie. Cabeza abajo (gravedad invertida) el relleno vertical
 * se refleja: los pies, que perdonan más, quedan contra el techo.
 *
 * @param {{ x: number, y: number }} body
 * @param {{ x: number, y: number, w: number, h: number }} out
 * @param {boolean} [inverted=false]
 */
export function standingHitbox(body, out, inverted = false) {
    const p = DINO_HITBOX_PADDING;
    out.x = body.x + p.left;
    out.y = body.y + (inverted ? p.bottom : p.top);
    out.w = DINO_SIZE.w - p.left - p.right;
    out.h = DINO_SIZE.h - p.top - p.bottom;
    return out;
}

/**
 * Y (esquina superior) de un obstáculo sobre el suelo dado. Los que cuelgan del
 * techo (`surface: 'ceiling'`) miden su altitud desde el techo hacia abajo.
 *
 * @param {{ h: number, altitude: number, surface?: string }} def  Entrada de OBSTACLE_KIND.
 * @param {number} groundY
 */
export function obstacleTopY(def, groundY) {
    if (def.surface === 'ceiling') return ceilingYOf(groundY) + def.altitude;
    return groundY - def.h - def.altitude;
}

/**
 * Rectángulo de colisión de un obstáculo cuya esquina superior izquierda está
 * en (x, y). Los del techo reflejan el relleno vertical, como su sprite.
 *
 * @param {{ w: number, h: number, surface?: string }} def
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, w: number, h: number }} [out]  Se rellena y se
 *        devuelve ese objeto: el simulador no asigna uno por paso.
 */
export function obstacleHitbox(def, x, y, out = { x: 0, y: 0, w: 0, h: 0 }) {
    const p = OBSTACLE_HITBOX_PADDING;
    out.x = x + p.left;
    out.y = y + (def.surface === 'ceiling' ? p.bottom : p.top);
    out.w = def.w - p.left - p.right;
    out.h = def.h - p.top - p.bottom;
    return out;
}

/**
 * Zona de un activador (anillo de salto, Ola 6c) cuya esquina superior izquierda
 * está en (x, y): su dibujo con la holgura `zone` de su kind por cada lado.
 *
 * @param {{ w: number, h: number, zone?: { padX: number, padY: number } }} def
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, w: number, h: number }} [out]
 */
export function triggerZone(def, x, y, out = { x: 0, y: 0, w: 0, h: 0 }) {
    const padX = def.zone?.padX ?? 0;
    const padY = def.zone?.padY ?? 0;
    out.x = x - padX;
    out.y = y - padY;
    out.w = def.w + 2 * padX;
    out.h = def.h + 2 * padY;
    return out;
}

/**
 * AABB entre dos hitboxes { x, y, w, h }.
 * @returns {boolean}
 */
export function aabbHit(a, b) {
    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
}
