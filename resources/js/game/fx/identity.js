// La identidad de los efectos de un nivel, tal como la lee el juego (T03.3).
//
// El servidor reparte (fx/casting.js) y guarda en `levels.fx_auto` lo que la
// canción tiene de propio: `{ palette?, signature? }`. Aquí se convierte en lo que
// el director entiende. Lo que este cliente no conoce (una paleta o una firma más
// nuevas que él, un valor mal formado) se ignora y cae en lo de siempre, como una
// escena desconocida (scenes/registry.js, playSceneId).
//
// Sin `fx_auto` (canción local, nivel sin analizar por el servidor): la paleta de
// siempre y ninguna firma.
//
// Puro.

import { DEFAULT_PALETTE, FX_PALETTES, isPalette } from './palettes.js';
import { FX } from './registry.js';

/**
 * @typedef {object} FxIdentity
 * @property {string} paletteId                              Id de fx/palettes.js.
 * @property {{ warm: ReadonlyArray<number>, cool: ReadonlyArray<number> }} palette
 * @property {string | null} signature                       Id del efecto firma, o null.
 */

/** ¿Es el id de un efecto de la familia `signature`? */
export function isSignature(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FX, id) && FX[id].family === 'signature';
}

/** Ids de las firmas que existen, en el orden del registro. */
export const SIGNATURE_IDS = Object.freeze(Object.keys(FX).filter((id) => FX[id].family === 'signature'));

/**
 * @param {{ palette?: unknown, signature?: unknown } | null | undefined} auto  `fx_auto` de la fila de la API.
 * @returns {FxIdentity}
 */
export function fxIdentityOf(auto) {
    const paletteId = isPalette(auto?.palette) ? auto.palette : DEFAULT_PALETTE;
    return {
        paletteId,
        palette: FX_PALETTES[paletteId],
        signature: isSignature(auto?.signature) ? auto.signature : null,
    };
}

/**
 * La identidad con la que se juega un nivel.
 * @param {{ fx_auto?: { palette?: string, signature?: string } | null } | null | undefined} level  Fila de la API.
 */
export function resolveFxIdentity(level) {
    return fxIdentityOf(level?.fx_auto);
}

/** Lo de siempre: el menú, una canción local. */
export const DEFAULT_FX_IDENTITY = Object.freeze(fxIdentityOf(null));
