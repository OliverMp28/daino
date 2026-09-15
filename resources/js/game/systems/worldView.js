// Vista del mundo — cuánto mundo se ve y a qué escala (tamaños de pantalla, Sep 2026).
//
// El juego vive en UNIDADES DE MUNDO: el Dino mide 84, salta 162, un cactus
// avanza a 370-690 por segundo. Hasta ahora una unidad era un píxel CSS, así
// que el tamaño de la pantalla decidía cuánto mundo se veía:
//
//   pantalla (CSS)   mundo visible   un obstáculo a 572/s aparece antes de llegar
//   390 × 844        390 × 844       0.4 s   (móvil vertical: injugable)
//   844 × 390        844 × 390       1.2 s
//   1920 × 1080      1920 × 1080     3.1 s   (la velocidad se diluye)
//   3840 × 2160      3840 × 2160     6.4 s   (una franja diminuta al pie)
//
// Ahora la vista se ESCALA: toda pantalla apaisada enseña casi el mismo mundo
// (16:9 → ~1100 × 620), así que el tiempo para ver venir cada obstáculo, el
// tamaño del Dino respecto a la pantalla y la emoción de un acelerón son los
// mismos en un móvil, un portátil y un 4K. Es lo que hacen los juegos de
// plataformas: la cámara fija el alto de mundo y el ancho sale del formato.
//
// La sincronía no cambia: la posición de cada obstáculo sale del reloj de la
// canción en unidades de mundo (physics.obstacleLeftX); la escala solo decide
// cómo se dibuja. Ni el charter ni la física leen la pantalla.
//
// Pixel art nítido: la escala se redondea para que cada celda del arte ocupe
// un número ENTERO de píxeles de dispositivo (con `devicePixelRatio` 1.25, 7 px
// por celda y no 6.9). Así nunca se emborrona ni tiene columnas desiguales.
//
// Pura, sin Pixi ni DOM: se prueba en Node con una matriz de pantallas.

import { WORLD_VIEW, GROUND_OFFSET_PX, PIXEL_SCALE } from '../config.js';
import { DINO_CENTER_X } from './physics.js';

/**
 * @typedef {Object} WorldView
 * @property {number} scale         Píxeles CSS por unidad de mundo.
 * @property {number} width         Ancho visible en unidades de mundo.
 * @property {number} height        Alto visible en unidades de mundo.
 * @property {number} groundY       Línea del suelo en unidades de mundo.
 * @property {number} screenWidth   Pantalla en px CSS.
 * @property {number} screenHeight
 * @property {number} screenGroundY Línea del suelo en px CSS (la del shader).
 * @property {number} cellPx        Px CSS por celda del arte.
 * @property {number} cellDevicePx  Px de dispositivo por celda del arte (entero).
 */

/**
 * @param {{ width: number, height: number, dpr?: number }} screen  px CSS y la
 *        resolución con la que rasteriza el renderer.
 * @param {typeof WORLD_VIEW} [rules]
 * @returns {WorldView}
 */
export function computeWorldView(screen, rules = WORLD_VIEW) {
    const W = Math.max(1, Number(screen.width) || 1);
    const H = Math.max(1, Number(screen.height) || 1);
    const dpr = Number.isFinite(screen.dpr) && screen.dpr > 0 ? screen.dpr : 1;

    // Escala que enseña `targetHeight` de mundo, sin pasar de `maxWidth` de
    // ancho visible (ultrapanorámicas)…
    let ideal = Math.max(H / rules.targetHeight, W / rules.maxWidth);
    // …y que en ningún caso deja ver menos de `minWidth` × `minHeight`.
    const ceiling = Math.min(W / rules.minWidth, H / rules.minHeight);
    ideal = Math.min(ideal, ceiling);

    // Celda del arte en píxeles de dispositivo: entera. Se redondea al más
    // cercano salvo que eso pase del techo (se vería menos que el mínimo).
    const unit = PIXEL_SCALE * dpr;
    let cell = Math.max(1, Math.round(ideal * unit));
    if (cell > 1 && cell / unit > ceiling + 1e-9) cell = Math.max(1, Math.floor(ceiling * unit + 1e-9));
    const scale = cell / unit;

    const width = W / scale;
    const height = H / scale;
    return {
        scale,
        width,
        height,
        groundY: height - GROUND_OFFSET_PX,
        screenWidth: W,
        screenHeight: H,
        screenGroundY: H - GROUND_OFFSET_PX * scale,
        cellPx: cell / dpr,
        cellDevicePx: cell,
    };
}

/**
 * Segundos que un obstáculo tarda en llegar al Dino desde que asoma por el
 * borde derecho, a una velocidad dada: lo que hay para verlo venir.
 *
 * @param {WorldView} view
 * @param {number} speedPxS  Unidades de mundo por segundo.
 */
export function readAheadS(view, speedPxS) {
    return (view.width - DINO_CENTER_X) / Math.max(1, speedPxS);
}

/**
 * ¿Dos vistas dibujan distinto? (resize que no cambia nada: no se toca la escena).
 * @param {WorldView | null} a
 * @param {WorldView} b
 */
export function sameView(a, b) {
    return a !== null && a.scale === b.scale && a.screenWidth === b.screenWidth && a.screenHeight === b.screenHeight;
}
