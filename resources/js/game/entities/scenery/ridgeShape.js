// Forma de una cresta (T01/T02.2), sin Pixi: la dibuja Ridge.js y la miden el
// guardián de legibilidad (scenes/backdrops.js) y los tests. Alturas por hash del
// índice, no por Math.random: al redimensionar, el paisaje conserva su forma.

/** Cuánto baja un punto hundido bajo la línea de apoyo (queda tapado por el mar). */
export const SUNK = 6;

/**
 * [0,1) estable para (índice, semilla).
 *
 * Hasta la T02.2 devolvía [−0.5, 0.5): el último `^=` deja un entero de 32 bits
 * CON signo. La cordillera se dibujaba así (con alturas de `baseRise ± jag/2`) y
 * así se aprobó; sus parámetros se reescribieron para que siga idéntica con el
 * hash ya en [0,1) (registry.js).
 */
export function hash01(i, seed) {
    let x = (Math.imul(i + 1, 2654435761) ^ Math.imul(seed, 1597334677)) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    return x / 4294967296 + 0.5;
}

/**
 * Alturas de la cresta (unidades de mundo sobre su línea de apoyo), estables por
 * índice: de `baseRise` a `baseRise + jag`. Con `gaps`, esa fracción de los
 * puntos queda hundida, en rachas de `gapRun` (un punto hundido suelto dejaría un
 * pico con forma de diente): islas sueltas en vez de una cordillera.
 *
 * @param {number} n  Puntos del periodo.
 * @param {{ baseRise: number, jag: number, seed: number, gaps?: number, gapRun?: number }} params
 */
export function ridgeHeights(n, { baseRise, jag, seed, gaps = 0, gapRun = 1 }) {
    const heights = [];
    for (let i = 0; i < n; i++) {
        const sunk = gaps > 0 && hash01(Math.floor(i / gapRun), seed + 7) < gaps;
        heights.push(sunk ? -SUNK : baseRise + hash01(i, seed) * jag);
    }
    return heights;
}

/** Puntos del periodo de una cresta para una vista de `width` unidades de ancho (Ridge.js). */
export function ridgePoints(width, step) {
    return Math.ceil(Math.max(width, 640) / step);
}
