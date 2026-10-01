// Lo que se ve frente a lo que choca.
//
// Coloca el dibujo del Dino (cada postura, con todos sus fotogramas) y el de un
// obstáculo en todas las posiciones relativas en que el juego da choque, y mide
// cuánto aire queda entre los dos dibujos: 0 celdas = se pisan, 1 = se tocan,
// ≥ 2 = hay hueco a la vista. Con la física y los dibujos reales, sin Pixi.
//
// Sirve para que nadie muera sin que se vea el golpe (tests/js/hitboxes.test.mjs).

import { CORRIDOR_HEIGHT_PX, DINO_SIZE, DINO_X, DUCK_SIZE, OBSTACLE_KIND, PIXEL_SCALE } from '../../../resources/js/game/config.js';
import { SPRITES } from '../../../resources/js/game/assets/sprites.js';
import { bodyFigure, bodyHitbox, bodyState, obstacleHit, obstacleTopY } from '../../../resources/js/game/systems/physics.js';

const S = PIXEL_SCALE;
const GROUND = 1000;
/** Hasta dónde se mide el aire (celdas): más allá da igual cuánto sea. */
const REACH = 16;

/** Celdas opacas de un dibujo, como lista de [columna, fila]; `flipY`: reflejado en vertical. */
function cellsOf(name, flipY = false) {
    const rows = SPRITES[name];
    const out = [];
    for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].length; x++) {
            if (rows[y][x] !== '.' && rows[y][x] !== ' ') out.push([x, flipY ? rows.length - 1 - y : y]);
        }
    }
    return { cells: out, w: Math.max(...rows.map((r) => r.length)), h: rows.length };
}

/** Distancia (Chebyshev, en celdas) de cada celda de una rejilla ampliada a la opaca más cercana. */
function distanceField(shape) {
    const W = shape.w + 2 * REACH;
    const H = shape.h + 2 * REACH;
    const d = new Uint8Array(W * H).fill(255);
    let frontier = [];
    for (const [x, y] of shape.cells) {
        const i = (y + REACH) * W + x + REACH;
        d[i] = 0;
        frontier.push(i);
    }
    for (let dist = 1; dist <= REACH && frontier.length > 0; dist++) {
        const next = [];
        for (const i of frontier) {
            const x = i % W;
            const y = (i - x) / W;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const j = ny * W + nx;
                    if (d[j] !== 255) continue;
                    d[j] = dist;
                    next.push(j);
                }
            }
        }
        frontier = next;
    }
    return { d, W, H };
}

/**
 * Posturas del Dino: cómo está el cuerpo y qué fotogramas puede enseñar. `heights`
 * son las alturas de sus pies sobre el suelo (unidades de mundo) que se prueban.
 */
const AIR = [];
for (let h = S; h <= 300; h += S) AIR.push(h);
const CORRIDOR_AIR = AIR.filter((h) => h < CORRIDOR_HEIGHT_PX - DINO_SIZE.h);

export const POSES = Object.freeze({
    run: { mode: 'run', frames: ['dinoRunA', 'dinoRunB'], heights: [0], set: { grounded: true } },
    jump: { mode: 'run', frames: ['dinoJump'], heights: AIR, set: { grounded: false } },
    duck: { mode: 'run', frames: ['dinoDuckA', 'dinoDuckB'], heights: [0], set: { grounded: true, ducking: true }, duck: true },
    flipFloor: { mode: 'flip', frames: ['dinoRunA', 'dinoRunB'], heights: [0], set: { grounded: true } },
    flipFall: { mode: 'flip', frames: ['dinoJump'], heights: CORRIDOR_AIR, set: { grounded: false } },
    flipRise: { mode: 'flip', frames: ['dinoJump'], heights: CORRIDOR_AIR, set: { grounded: false, gravityDir: -1 }, flipY: true },
    flipCeiling: { mode: 'flip', frames: ['dinoRunA', 'dinoRunB'], heights: [CORRIDOR_HEIGHT_PX - DINO_SIZE.h], set: { grounded: true, gravityDir: -1 }, flipY: true },
});

/**
 * El peor hueco a la vista entre el Dino en una postura y un kind de obstáculo, en
 * celdas, sobre todas las posiciones relativas en que chocan.
 *
 * @param {keyof typeof POSES} poseId
 * @param {string} kind
 * @param {(figure: number, bounds: object, def: object, x: number, y: number, scratch: object) => boolean} [hit]
 *        La colisión a medir; por defecto, la del juego. (Para comparar con otra regla.)
 * @returns {{ gap: number, hits: number, at: { height: number, obstacleX: number, frames: string } | null }}
 *          `hits` = posiciones con choque; `gap` 0 si no hay ninguna.
 */
export function worstVisibleGap(poseId, kind, hit = obstacleHit) {
    const pose = POSES[poseId];
    const def = OBSTACLE_KIND[kind];
    const ceiling = def.surface === 'ceiling';
    const fields = def.sprites.map((name) => ({ name, shape: cellsOf(name, ceiling), field: null }));
    for (const f of fields) f.field = distanceField(f.shape);
    const dinos = pose.frames.map((name) => ({ name, ...cellsOf(name, pose.flipY === true) }));

    const body = bodyState(GROUND);
    body.mode = pose.mode;
    Object.assign(body, pose.set);
    const dh = { x: 0, y: 0, w: 0, h: 0 };
    const oh = { x: 0, y: 0, w: 0, h: 0 };
    const top = obstacleTopY(def, GROUND);
    let worst = { gap: 0, hits: 0, at: null };

    for (const height of pose.heights) {
        body.y = GROUND - DINO_SIZE.h - height;
        bodyHitbox(body, dh);
        const figure = bodyFigure(body);
        // Esquina del dibujo del Dino: de pie llena su caja; agachado, centrado y apoyado.
        const dinoX = pose.duck ? body.x + (DINO_SIZE.w - DUCK_SIZE.w) / 2 : body.x;
        const dinoY = pose.duck ? body.y + DINO_SIZE.h - DUCK_SIZE.h : body.y;
        for (let x = DINO_X - def.w - 4 * S; x <= DINO_X + DINO_SIZE.w + 12 * S; x += S) {
            if (!hit(figure, dh, def, x, top, oh)) continue;
            worst.hits++;
            // Desfase en celdas del Dino respecto al obstáculo (todo va en la rejilla de S).
            const ox = Math.round((dinoX - x) / S);
            const oy = Math.round((dinoY - top) / S);
            for (const dino of dinos) {
                for (const f of fields) {
                    let gap = REACH;
                    for (const [cx, cy] of dino.cells) {
                        const gx = cx + ox + REACH;
                        const gy = cy + oy + REACH;
                        if (gx < 0 || gy < 0 || gx >= f.field.W || gy >= f.field.H) continue;
                        const v = f.field.d[gy * f.field.W + gx];
                        if (v < gap) gap = v;
                        if (gap === 0) break;
                    }
                    if (gap > worst.gap) worst = { gap, hits: worst.hits, at: { height, obstacleX: x, frames: `${dino.name}+${f.name}` } };
                }
            }
        }
    }
    return worst;
}

/** Kinds que se chocan (no activadores) en el modo de una postura. */
export function solidKindsFor(poseId) {
    const mode = POSES[poseId].mode;
    return Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].trigger === undefined && (OBSTACLE_KIND[k].mode ?? 'run') === mode);
}
