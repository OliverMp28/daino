// La rejilla del cielo (T05.1): a cuántos texeles se pinta el shader del fondo, y
// cómo se reparte ese trabajo entre fotogramas.
//
// El cielo es lo que más cuesta de un fotograma: se calcula píxel a píxel. Medido
// (Intel UHD 620, 1080p): 7,5 ms de GPU de los 8 del fotograma; todo lo demás
// —capas del escenario, lluvia, nieve, sprites— 0,5 ms. Y costaba más cuanto más
// grande fuera la pantalla: en 4K, 24-33 FPS; en un móvil de DPR 3, nueve veces
// los píxeles de su tamaño CSS.
//
// Por eso el cielo se pinta en su propio búfer (shaders/skyBuffer.js) y su
// resolución no se mide en píxeles de pantalla, sino en TEXELES POR CELDA DEL
// ARTE. Dos consecuencias:
//
//   - Cuesta lo mismo en un portátil, en un 4K y en un móvil: toda pantalla
//     enseña casi el mismo mundo (systems/worldView.js), así que a 4 texeles por
//     celda el cielo de un 16:9 mide ~1097 × 617 en cualquiera.
//   - Lo que el shader dibuja en celdas (estrellas, lucero, fugaces, aurora, y la
//     luna a media celda) sale EXACTO: el texel mide celda/N, las fronteras de las
//     celdas caen en fronteras de texel y el búfer se enseña sin suavizar. Lo
//     suave (degradado, resplandores, el disco del sol) queda en escalones de un
//     texel. Medido píxel a píxel contra la resolución completa, en las siete
//     escenas a seis horas: con 6 texeles cambia (más de 24/255) el 0,06 % de los
//     píxeles como mucho; con 4, el 0,09 %; con 2, el 0,13 %.
//
// Y en el tiempo, por BANDAS: el cielo no se desplaza con el mundo, así que no
// hace falta una imagen nueva en cada fotograma. Cada imagen del cielo se pinta en
// k fotogramas, una franja horizontal en cada uno, y se enseña cuando está entera
// (shaders/skyBuffer.js). El cielo se renueva `skyHz` veces por segundo y todos
// los fotogramas cuestan lo mismo.
//
// Pura, sin Pixi ni DOM: se prueba en Node con la matriz de pantallas.

/**
 * @typedef {Object} SkyGrid
 * @property {number} texels       Texeles por celda del arte (≤ los pedidos y ≤ los nativos).
 * @property {number} native       Los de la pantalla: píxeles de dispositivo por celda.
 * @property {number} width        Ancho del búfer, en texeles.
 * @property {number} height       Alto del búfer, en texeles (sus filas).
 * @property {number} texelPx      Px CSS por texel: exactamente celda / texels.
 * @property {number} spriteWidth  Ancho en px CSS de lo que se enseña (≥ la pantalla).
 * @property {number} spriteHeight
 * @property {[number, number]} frameScale  Cuánto sobra por el borde: tamaño de lo
 *           enseñado / tamaño de la pantalla (≥ 1).
 */

/**
 * La rejilla del cielo para una vista y un detalle pedido.
 *
 * Nunca pasa de los texeles de la pantalla (no tiene sentido pintar más de un
 * texel por píxel) y cubre la pantalla entera: como el texel no divide el ancho
 * de la pantalla, sobra menos de un texel por la derecha y por abajo.
 *
 * @param {{ screenWidth: number, screenHeight: number, cellPx: number, cellDevicePx: number }} view
 *        La vista del mundo (systems/worldView.js).
 * @param {number} texels  Texeles por celda del arte que se quieren.
 * @returns {SkyGrid}
 */
export function skyBufferFor(view, texels) {
    const native = Math.max(1, Math.round(view.cellDevicePx));
    const wanted = Number.isFinite(texels) ? Math.round(texels) : native;
    const n = Math.max(1, Math.min(native, wanted));
    const texelPx = view.cellPx / n;
    // El −1e-6 evita un texel de más cuando el cociente es un entero con ruido.
    const width = Math.max(1, Math.ceil(view.screenWidth / texelPx - 1e-6));
    const height = Math.max(1, Math.ceil(view.screenHeight / texelPx - 1e-6));
    const spriteWidth = width * texelPx;
    const spriteHeight = height * texelPx;
    return {
        texels: n,
        native,
        width,
        height,
        texelPx,
        spriteWidth,
        spriteHeight,
        frameScale: [spriteWidth / view.screenWidth, spriteHeight / view.screenHeight],
    };
}

/**
 * En cuántas bandas se reparte cada imagen del cielo para sacar `skyHz` por
 * segundo pintando una banda por fotograma: a 60 fotogramas y 30 Hz, dos.
 *
 * @param {number} frameMs  Intervalo entre fotogramas pintados.
 * @param {number} skyHz
 * @param {number} [max]    Tope: con muchas bandas, la imagen tarda demasiados fotogramas en estar.
 */
export function skyBandCount(frameMs, skyHz, max = 6) {
    if (!(skyHz > 0) || !(frameMs > 0)) return 1;
    return Math.max(1, Math.min(max, Math.round(1000 / frameMs / skyHz)));
}

/**
 * Una banda del búfer: sus filas y la uv de PANTALLA que cubre (uFrameRect del
 * shader: esquina y lo que abarca). Las bandas se reparten las filas sin dejarse
 * ninguna ni repetirla.
 *
 * @param {SkyGrid} grid
 * @param {number} index  Qué banda (0 = la de arriba).
 * @param {number} count  En cuántas se reparte el cielo.
 * @param {Float32Array | number[]} [uv]  Donde dejar la uv (x, y, ancho, alto).
 * @returns {{ row: number, rows: number, uv: Float32Array | number[] }}
 */
export function skyBand(grid, index, count, uv = [0, 0, 1, 1]) {
    const n = Math.max(1, Math.min(grid.height, Math.round(count)));
    const i = Math.max(0, Math.min(n - 1, Math.round(index)));
    const row = Math.floor((grid.height * i) / n);
    const rows = Math.floor((grid.height * (i + 1)) / n) - row;
    const perRow = grid.frameScale[1] / grid.height;   // uv de pantalla por fila
    uv[0] = 0;
    uv[1] = row * perRow;
    uv[2] = grid.frameScale[0];
    uv[3] = rows * perRow;
    return { row, rows, uv };
}

/** ¿Dos rejillas piden el mismo búfer? (un resize que no lo cambia no lo recrea). */
export function sameSkyGrid(a, b) {
    return a !== null && b !== null && a.width === b.width && a.height === b.height && a.texelPx === b.texelPx;
}
