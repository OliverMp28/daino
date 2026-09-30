// Forma de la ciudad (T02.4), sin Pixi: edificios y ventanas en celdas del arte.
// La rasteriza Skyline.js y la miden el guardián (scenes/backdrops.js) y los
// tests. Por hash del índice, como las crestas: al redimensionar, la ciudad
// conserva su forma.

import { hash01 } from './ridgeShape.js';

/**
 * Colores de las ventanas encendidas: casi todas cálidas, alguna de neón (la
 * ciudad es synthwave). No se tiñen con la hora: es luz propia.
 */
export const WINDOW_COLORS = Object.freeze(['#ffd98a', '#ffe7b0', '#8fe6ff', '#ff9ad0']);

/** Parte de las ventanas de cada color (el resto, el primero). */
const WINDOW_MIX = Object.freeze([0, 0.72, 0.9, 0.96]);

/** Escalones en los que se encienden las ventanas (una capa por escalón). */
export const WINDOW_STEPS = 6;

/**
 * Edificios de un periodo de `cells` celdas de ancho, que lo llenan hasta el
 * borde: el periodo se repite sin costura, y con `gapMax` 0 no queda ningún hueco
 * por el que asome el cielo (el guardián lo sabe: `skylineGapless`).
 *
 * @param {number} cells
 * @param {{ seed: number, minW: number, maxW: number, minH: number, maxH: number, gapMax: number, antennaChance: number, stepChance: number }} p
 * @returns {Array<{ x: number, w: number, h: number, roof: 'flat' | 'step' | 'antenna', top: number, antennaH: number }>}
 */
export function skylineBuildings(cells, p) {
    const out = [];
    let x = 0;
    for (let i = 0; x < cells; i++) {
        let w = p.minW + Math.floor(hash01(i * 5, p.seed) * (p.maxW - p.minW + 1));
        const rest = cells - x;
        if (rest < p.minW && out.length > 0) {
            // No cabe otro: el último se ensancha hasta el borde.
            out[out.length - 1].w += rest;
            break;
        }
        if (w > rest || rest - w < p.minW) w = rest;
        // Más bajos que altos: la ciudad tiene pocas torres.
        const h = p.minH + Math.floor(Math.pow(hash01(i * 5 + 1, p.seed), 1.4) * (p.maxH - p.minH + 1));
        const r = hash01(i * 5 + 2, p.seed);
        const tall = h > p.minH + (p.maxH - p.minH) * 0.55;
        const roof = tall && r < p.antennaChance ? 'antenna' : r > 1 - p.stepChance && w >= 6 ? 'step' : 'flat';
        const antennaH = roof === 'antenna' ? 3 + Math.floor(hash01(i * 5 + 3, p.seed) * 4) : 0;
        // `top`: lo más alto del edificio con su remate (para medirlo).
        out.push({ x, w, h, roof, top: h + (roof === 'step' ? 2 : 0) + antennaH, antennaH });
        x += w;
        // El hueco hasta el siguiente (nunca en el borde: ahí empieza la copia siguiente).
        if (x < cells) x = Math.min(cells, x + Math.floor(hash01(i * 5 + 4, p.seed) * (p.gapMax + 1)));
    }
    return out;
}

/** Si una fila de edificios tapa el cielo de punta a punta (sin huecos). */
export function skylineGapless(buildings, cells) {
    let x = 0;
    for (const b of buildings) {
        if (b.x !== x) return false;
        x = b.x + b.w;
    }
    return x === cells;
}

/**
 * Ventanas de un edificio: una celda cada dos columnas y cada tres filas, con un
 * margen. Cada una se enciende a partir de un umbral propio (`step`, de 0 a
 * WINDOW_STEPS − 1): con la ciudad a medio encender, se ve la mitad.
 *
 * @param {{ x: number, w: number, h: number }} b
 * @param {number} index  Posición del edificio en su periodo.
 * @param {number} seed
 * @returns {Array<{ x: number, y: number, step: number, color: string }>}  y desde el suelo.
 */
export function buildingWindows(b, index, seed) {
    const out = [];
    for (let cx = 1; cx < b.w - 1; cx += 2) {
        for (let cy = 2; cy < b.h - 1; cy += 3) {
            const k = index * 131 + cx * 17 + cy * 7;
            const step = Math.floor(hash01(k, seed + 11) * WINDOW_STEPS);
            const c = hash01(k, seed + 29);
            let color = WINDOW_COLORS[0];
            for (let j = WINDOW_MIX.length - 1; j >= 1; j--) {
                if (c >= WINDOW_MIX[j]) {
                    color = WINDOW_COLORS[j];
                    break;
                }
            }
            out.push({ x: b.x + cx, y: cy, step, color });
        }
    }
    return out;
}

/** Celdas del periodo de la ciudad para una vista de `width` unidades (como las crestas). */
export function skylineCells(width, pixelScale) {
    return Math.ceil(Math.max(width, 640) / pixelScale);
}
