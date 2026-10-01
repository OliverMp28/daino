// pixelart.js — arte del juego como código. Cada sprite es una rejilla de
// strings donde cada carácter mapea a un color de PALETTE ('.' = transparente);
// los dibujos viven en sprites.js (datos puros) y aquí se rasterizan.
// Un rasterizador los convierte en canvas 1px-por-celda y de ahí a Texture de
// Pixi con scaleMode 'nearest' — el escalado x4 lo hace la GPU y queda crujiente.
//
// Por qué así y no PNGs:
//   - Cero assets binarios en el repo; los sprites se revisan en diff como texto.
//   - Iterables con HMR: tocas una fila, guardas, y el sprite cambia en caliente.
//   - La paleta vive en UN sitio y está sincronizada con los tokens de main.css
//     y las constantes del shader (COLOR_BEAT/COLOR_HIGH).
//
// El ADN visual viene del legacy (../daino-legacy/img/): dino corredor con
// ciclo de 2 poses, cactus saguaro, suelo-tira con motas, nubes. Redibujado
// aquí en paleta "retro-pixel neón" para brillar sobre el shader oscuro
// (decisión del rediseño visual, Jul 2026). NO se copian los PNGs del legacy.

import { Texture } from 'pixi.js';
import { PIXEL_SCALE } from '../config.js';
import { PALETTE } from './palette.js';
import { SPRITES } from './sprites.js';

/**
 * Factor de escala de celda → unidades de mundo. 4 ⇒ un dino de 21 celdas = 84.
 * Vive en config.js (lo necesita la vista del mundo, que se prueba sin Pixi);
 * se reexporta aquí para los consumidores de siempre.
 */
export { PIXEL_SCALE };

// --------------------------- Paleta global ---------------------------
// Vive en assets/palette.js (sin Pixi): la usan también las pruebas de
// legibilidad del escenario (scenes/readability.js).

// --------------------------- Skins (palette-swap) ---------------------------
// Un skin NO cambia la silueta: solo remapea caracteres de la paleta al
// rasterizar. Añadir un skin nuevo = una entrada aquí. El selector del modal
// AJUSTES los lista automáticamente; `daino:skin` en localStorage persiste
// la elección (ui/settings.js).
export const DINO_SKINS = Object.freeze({
    classic: { label: 'Clásico', overrides: null },
    beat: { label: 'Rosa Beat', overrides: { W: '#ffc9d6', w: '#e8879f', C: '#ffe08a' } },
    gold: { label: 'Dorado', overrides: { W: '#ffe2a8', w: '#d9a75f', C: '#7fe6ff' } },
});

/** Skin id saneado: cualquier valor desconocido cae a 'classic'. */
export function normalizeSkinId(id) {
    return Object.prototype.hasOwnProperty.call(DINO_SKINS, id) ? id : 'classic';
}

// --------------------------- Rasterizador ---------------------------

/** @type {Map<string, Texture>} Cache por `${sprite}@${variante}`. */
const cache = new Map();

/**
 * Rasteriza una def de sprite a canvas 1px-por-celda. Las filas se normalizan
 * al ancho máximo (pad con transparente) — así un pixel de más o de menos al
 * editar el arte a mano no rompe el render, solo se nota y se corrige.
 *
 * @param {string[]} rows
 * @param {Record<string,string> | null} overrides  Remapeo char→color del skin.
 */
function rasterize(rows, overrides) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    for (let y = 0; y < h; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch === '.' || ch === ' ') continue;
            const color = (overrides && overrides[ch]) || PALETTE[ch];
            if (!color) continue; // carácter desconocido = transparente
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    return canvas;
}

/**
 * Devuelve la Texture de un sprite por nombre, rasterizando y cacheando la
 * primera vez. scaleMode 'nearest' — el x4 en pantalla lo hace el sprite via
 * scale, y la GPU no interpola (pixel art crujiente).
 *
 * @param {keyof typeof SPRITES} name
 * @param {string} [skinId]  Variante de paleta (solo aplica a sprites del dino;
 *                           en el resto es inocuo porque no usan chars W/w/C
 *                           con overrides). Default 'classic' = paleta base.
 * @returns {Texture}
 */
export function getTexture(name, skinId = 'classic') {
    const skin = DINO_SKINS[normalizeSkinId(skinId)];
    const variant = skin.overrides ? normalizeSkinId(skinId) : 'classic';
    const key = `${name}@${variant}`;

    let tex = cache.get(key);
    if (tex) return tex;

    const def = SPRITES[name];
    if (!def) throw new Error(`pixelart: sprite desconocido "${name}"`);

    tex = Texture.from(rasterize(def, skin.overrides));
    tex.source.scaleMode = 'nearest';
    cache.set(key, tex);
    return tex;
}

/**
 * Textura de un arte que no vive en este archivo (T02): las capas de las escenas
 * nuevas se cargan bajo demanda y traen su propio arte, que no tiene por qué ir
 * en el bundle principal. Misma paleta, mismo rasterizado y misma caché, por
 * clave: la segunda llamada con la misma clave devuelve la misma textura.
 *
 * @param {string} key   Única entre todo el arte (p. ej. 'scene:lighthouse').
 * @param {string[]} rows
 * @returns {Texture}
 */
export function artTexture(key, rows) {
    const cacheKey = `${key}@art`;
    let tex = cache.get(cacheKey);
    if (tex) return tex;
    tex = Texture.from(rasterize(rows, null));
    tex.source.scaleMode = 'nearest';
    cache.set(cacheKey, tex);
    return tex;
}

/** Tamaño en px de pantalla de un sprite (celdas × PIXEL_SCALE). */
export function spriteSize(name) {
    const def = SPRITES[name];
    if (!def) throw new Error(`pixelart: sprite desconocido "${name}"`);
    const w = Math.max(...def.map((r) => r.length));
    return { w: w * PIXEL_SCALE, h: def.length * PIXEL_SCALE };
}
