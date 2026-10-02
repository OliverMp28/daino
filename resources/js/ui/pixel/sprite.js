// Los dibujos del juego, en la interfaz (T04, doc 12).
//
// El Dino del panel de resultados, el que trota mientras se prepara un nivel o los
// personajes de AJUSTES son los MISMOS sprites que se juegan (assets/sprites.js),
// con la misma paleta y los mismos skins: aquí se rasterizan a una imagen de una
// celda por píxel y el CSS la amplía por un número entero de píxeles de pantalla
// (`--cell`, pixel/grid.js) sin suavizar.
//
// Las portadas de los niveles usan el mismo camino (coverImage.js).

import { PALETTE } from '../../game/assets/palette.js';
import { SPRITES } from '../../game/assets/sprites.js';
import { DINO_SKINS, normalizeSkinId } from '../../game/assets/pixelart.js';

/** @type {Map<string, { url: string, cols: number, rows: number }>} */
const cache = new Map();

/**
 * Imagen de una rejilla de celdas (cada carácter, un color de la paleta).
 *
 * @param {string} key       Única por dibujo y variante: es la clave de la caché.
 * @param {string[]} rows
 * @param {Record<string, string> | null} [overrides]  Remapeo de colores (un skin).
 * @returns {{ url: string, cols: number, rows: number }}
 */
export function artImage(key, rows, overrides = null) {
    let img = cache.get(key);
    if (img) return img;
    const cols = Math.max(...rows.map((r) => r.length));
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows.length;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < rows.length; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
            const color = (overrides && overrides[row[x]]) || PALETTE[row[x]];
            if (!color) continue;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    img = { url: canvas.toDataURL('image/png'), cols, rows: rows.length };
    cache.set(key, img);
    return img;
}

/**
 * Imagen de un sprite del juego, con el skin del Dino si se pide.
 *
 * @param {keyof typeof SPRITES} name
 * @param {string} [skinId]
 */
export function spriteImage(name, skinId = 'classic') {
    const skin = normalizeSkinId(skinId);
    const rows = SPRITES[name];
    if (!rows) throw new Error(`sprite desconocido "${name}"`);
    return artImage(`${name}@${skin}`, rows, DINO_SKINS[skin].overrides);
}

/**
 * Pone una imagen de celdas en un elemento: su tamaño son sus celdas por `--cell`.
 *
 * @param {HTMLElement} el
 * @param {{ url: string, cols: number, rows: number }} img
 */
export function paintArt(el, img) {
    el.classList.add('px-art');
    el.style.setProperty('--cols', String(img.cols));
    el.style.setProperty('--rows', String(img.rows));
    el.style.backgroundImage = `url(${img.url})`;
    return el;
}

/**
 * Un elemento con un sprite del juego.
 *
 * @param {keyof typeof SPRITES} name
 * @param {{ skin?: string, className?: string, alt?: string }} [opts]
 */
export function spriteEl(name, opts = {}) {
    const el = document.createElement('span');
    if (opts.className) el.className = opts.className;
    paintArt(el, spriteImage(name, opts.skin));
    el.setAttribute('aria-hidden', 'true');
    return el;
}

/**
 * Un Dino que trota: sus dos poses de correr, alternadas por CSS.
 *
 * @param {{ skin?: string, className?: string }} [opts]
 */
export function runningDinoEl(opts = {}) {
    const el = document.createElement('span');
    el.className = opts.className ? `px-runner ${opts.className}` : 'px-runner';
    const a = spriteImage('dinoRunA', opts.skin);
    const b = spriteImage('dinoRunB', opts.skin);
    paintArt(el, a);
    el.style.setProperty('--frame-a', `url(${a.url})`);
    el.style.setProperty('--frame-b', `url(${b.url})`);
    el.setAttribute('aria-hidden', 'true');
    return el;
}
