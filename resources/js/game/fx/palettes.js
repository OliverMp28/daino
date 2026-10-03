// Paletas de los efectos (T03.3, doc 11): UNA PALETA ES UNA ENTRADA.
//
// Cada canción tiene la suya, elegida por cómo suena (fx/casting.js, en el
// servidor; el nivel la trae en `fx_auto`). Son dos colores, un cálido y un
// frío, y son una INTENCIÓN: el director los gira con los cambios de tonalidad y
// los pone a juego con el cielo de cada hora (tones.js). Los pintores no saben de
// paletas: reciben los dos colores del fotograma.
//
// POR QUÉ ESTAS Y NO OTRAS. El cielo de detrás del juego va siempre del azul al
// magenta (tono 265°-339° en todas las escenas y horas), y un color de efecto no
// queda a más de 70° de él. Medido: un naranja o un oro se vuelven rosa de día y
// de noche, y el oro salta de cian a rosa a media tarde. Así que una paleta solo
// puede elegir DENTRO de lo que el cielo admite, del cian al rosa:
//
//   Neón          los dos extremos: rosa y cian. La de siempre, y la red.
//   Ultravioleta  el centro, hondo: violeta y azul eléctrico.
//   Hielo         el lado frío, pálido: lavanda y celeste.
//   Fucsia        el lado cálido, hondo: rojo rosado y violeta.
//   Rosa          el lado cálido, pálido: rosas claros.
//
// Cada una da su propia rampa en las barras del espectro (del magenta al añil,
// del violeta al añil, toda añil, del magenta al violeta, toda rosa).
//
// Una paleta nueva tiene que pasar las tres medidas de fx/paletteCheck.js en
// todas las escenas y horas (lo vigila un test): ESTABLE (su tono no salta entre
// horas vecinas), VIVA (conserva su croma tras ponerse a juego con el cielo) y
// DISTINTA de las demás. Mejor cuatro distintas que cinco parecidas.
//
// Las historias de autor no eligen paleta: traen sus colores (`scene.fx.colors`).
//
// Puro.

import { hexToRgb } from '../scenes/color.js';
import { FX_COLORS } from './registry.js';

/**
 * @typedef {object} FxPalette
 * @property {string} label   Nombre en español (panel dev, informes).
 * @property {string} blurb   Qué colores son.
 * @property {ReadonlyArray<number>} warm  sRGB [0,1].
 * @property {ReadonlyArray<number>} cool
 */

const pair = (warm, cool) => ({ warm: Object.freeze(hexToRgb(warm)), cool: Object.freeze(hexToRgb(cool)) });

/** @type {Record<string, FxPalette>} */
export const FX_PALETTES = Object.freeze({
    neon: Object.freeze({ label: 'Neón', blurb: 'rosa y cian', warm: FX_COLORS.warm, cool: FX_COLORS.cool }),
    ultra: Object.freeze({ label: 'Ultravioleta', blurb: 'violeta y azul eléctrico', ...pair('#b04cff', '#4a6bff') }),
    ice: Object.freeze({ label: 'Hielo', blurb: 'lavanda y celeste', ...pair('#c2b0ff', '#a4dcff') }),
    fucsia: Object.freeze({ label: 'Fucsia', blurb: 'rojo rosado y violeta', ...pair('#ff3d5f', '#a13dff') }),
    rose: Object.freeze({ label: 'Rosa', blurb: 'rosas claros', ...pair('#ff86c8', '#ffd0e8') }),
});

/** La de siempre: la de una canción sin reparto (local, sin analizar) o sin encaje claro. */
export const DEFAULT_PALETTE = 'neon';

export const PALETTE_IDS = Object.freeze(Object.keys(FX_PALETTES));

/** ¿Existe esa paleta? (Un id que este cliente no conoce no es ninguna.) */
export function isPalette(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FX_PALETTES, id);
}
