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
    STANDING_NOTCH,
} from '../config.js';

/**
 * Figura de un cuerpo dentro de su caja de colisión. La caja (`bodyHitbox`) es
 * el rectángulo que lo envuelve; la figura dice qué parte de esa caja es cuerpo.
 *
 *   BOX                La caja entera.
 *   STANDING           De pie: la caja menos el hueco sobre el lomo (STANDING_NOTCH).
 *   STANDING_INVERTED  De pie cabeza abajo (antigravedad): el hueco, abajo.
 */
export const FIGURE = Object.freeze({ BOX: 0, STANDING: 1, STANDING_INVERTED: 2 });

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

/** Caja que envuelve las piezas de cada kind con `hitParts`, como relleno (memoria). */
const partsPad = new WeakMap();

function padOf(def) {
    if (def.hitParts === undefined) return def.hitPad ?? OBSTACLE_HITBOX_PADDING;
    let pad = partsPad.get(def);
    if (pad === undefined) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const [px, py, pw, ph] of def.hitParts) {
            x0 = Math.min(x0, px);
            y0 = Math.min(y0, py);
            x1 = Math.max(x1, px + pw);
            y1 = Math.max(y1, py + ph);
        }
        pad = { top: y0, right: def.w - x1, bottom: def.h - y1, left: x0 };
        partsPad.set(def, pad);
    }
    return pad;
}

/**
 * Rectángulo de colisión de un obstáculo cuya esquina superior izquierda está
 * en (x, y). Los del techo reflejan el relleno vertical, como su sprite. El
 * relleno es el de su kind (`hitPad`) o el común; con `hitParts`, es la caja que
 * envuelve a sus piezas (chocar de verdad lo decide `obstacleHit`).
 *
 * @param {{ w: number, h: number, surface?: string, hitPad?: { top: number, right: number, bottom: number, left: number }, hitParts?: number[][] }} def
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, w: number, h: number }} [out]  Se rellena y se
 *        devuelve ese objeto: el simulador no asigna uno por paso.
 */
export function obstacleHitbox(def, x, y, out = { x: 0, y: 0, w: 0, h: 0 }) {
    const p = padOf(def);
    out.x = x + p.left;
    out.y = y + (def.surface === 'ceiling' ? p.bottom : p.top);
    out.w = def.w - p.left - p.right;
    out.h = def.h - p.top - p.bottom;
    return out;
}

/**
 * Las cajas que chocan de un obstáculo en (x, y): sus piezas (`hitParts`,
 * reflejadas si cuelga del techo) o su única caja. Asigna: para cálculos que se
 * hacen una vez (márgenes), no para el bucle de la partida.
 *
 * @returns {Array<{ x: number, y: number, w: number, h: number }>}
 */
export function obstacleRects(def, x, y) {
    if (def.hitParts === undefined) return [obstacleHitbox(def, x, y)];
    const flip = def.surface === 'ceiling';
    return def.hitParts.map(([px, py, pw, ph]) => ({ x: x + px, y: y + (flip ? def.h - py - ph : py), w: pw, h: ph }));
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

/**
 * ¿Toca `other` a un cuerpo de caja `bounds` y figura `figure`? Es LA colisión
 * del juego: la usan la partida (spawner) y el simulador del charter.
 *
 * De pie, lo que `other` pisa de la caja tiene que salir del hueco: llegar a la
 * columna de la cabeza o bajar hasta el lomo.
 *
 * @param {number} figure  FIGURE
 * @param {{ x: number, y: number, w: number, h: number }} bounds
 * @param {{ x: number, y: number, w: number, h: number }} other
 */
export function figureHit(figure, bounds, other) {
    if (!aabbHit(bounds, other)) return false;
    if (figure === FIGURE.BOX) return true;
    if (other.x + other.w > bounds.x + STANDING_NOTCH.w) return true;
    if (figure === FIGURE.STANDING) return other.y + other.h > bounds.y + STANDING_NOTCH.h;
    return other.y < bounds.y + bounds.h - STANDING_NOTCH.h;
}

/**
 * ¿Toca un cuerpo (caja `bounds`, figura `figure`) a un obstáculo cuya esquina
 * superior izquierda está en (x, y)? Con piezas, a alguna de ellas.
 *
 * @param {number} figure  FIGURE
 * @param {{ x: number, y: number, w: number, h: number }} bounds
 * @param {object} def     Entrada de OBSTACLE_KIND.
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, w: number, h: number }} scratch  Caja de trabajo (se pisa).
 */
export function obstacleHit(figure, bounds, def, x, y, scratch) {
    const parts = def.hitParts;
    if (parts === undefined) return figureHit(figure, bounds, obstacleHitbox(def, x, y, scratch));
    if (!aabbHit(bounds, obstacleHitbox(def, x, y, scratch))) return false;
    const flip = def.surface === 'ceiling';
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        scratch.x = x + p[0];
        scratch.y = y + (flip ? def.h - p[1] - p[3] : p[1]);
        scratch.w = p[2];
        scratch.h = p[3];
        if (figureHit(figure, bounds, scratch)) return true;
    }
    return false;
}
