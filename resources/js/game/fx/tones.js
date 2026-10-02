// Tonos de los efectos (T03, tras el segundo playtest de los efectos).
//
// "Las barras se ven grisáceas: son rojizas y con el fondo azulado queda raro; de
// noche pasa lo mismo." Medido, eran tres cosas:
//
//   1. EL COLOR DEL EFECTO NO SABÍA QUÉ TENÍA DETRÁS. El rosa de los efectos está
//      a 107° de tono del azul del día. Dos colores tan lejanos, mezclados (una
//      barra translúcida, un resplandor bajo el limitador), pasan por el gris.
//   2. BAJO UN TECHO DE LUMINANCIA NO TODOS LOS COLORES SIGUEN SIENDO COLOR. La
//      franja jugable tiene techo (limiter.js). A esa luminancia un azul, un
//      violeta o un magenta son vivos (el azul puro mide 0.072); un rojo es un
//      granate, y un cian o un amarillo, un gris: el verde se come el presupuesto.
//   3. DEL CÁLIDO AL FRÍO EN LÍNEA RECTA POR sRGB se pasa por un malva sucio.
//
// Aquí está la respuesta a las tres, en reglas y no escena a escena:
//
//   harmonize     un color de efecto no queda a más de `maxHueDeg` del tono del
//                 cielo que tiene detrás: sobre el azul del día el rosa se va al
//                 magenta, en el ocaso rosa sigue siendo rosa. Lo aplica el director
//                 a los dos colores de los efectos (los de una escena que los fija,
//                 como una historia, no se tocan).
//   vividAt       el color más vivo que cabe en sRGB para un tono.
//   spectrumLight, spectrumShade
//                 el color de una barra del espectro: del cálido al frío POR EL
//                 TONO (violeta en medio, no gris), dentro del arco de tonos que
//                 brillan en oscuro; como luz (de noche) o en sombra (de día).
//
// Los tonos son los de OKLCh (el ángulo de OKLab, en grados): perceptualmente
// uniformes, que es lo que se quiere al girar un color sin cambiarle el brillo.
//
// Puro: lo usan el director, las barras, el guardián de legibilidad y los tests.

import { oklabToLinear, oklabToRgb, rgbToOklab } from '../scenes/color.js';
import { FX_LIMIT, capColor } from './limiter.js';

export const TONE_RULES = Object.freeze({
    /** Lo más lejos que un color de efecto queda del tono del cielo que tiene detrás (grados). */
    maxHueDeg: 70,
    /**
     * Croma del cielo por debajo de la cual no tiene un tono al que acercarse (un
     * gris) y con cuál ya manda del todo. Los cielos de las escenas van de 0.04
     * (noche cerrada) a 0.2 (pleno día).
     */
    skyChroma: Object.freeze([0.015, 0.04]),
    /**
     * Arco de tonos que siguen siendo color bajo el techo de luminancia de la
     * franja jugable: del añil (270°) al magenta rosado (352°), por el violeta. El
     * azul puro (264°) también cabe, pero a su lado todo lo demás parece apagado.
     */
    arc: Object.freeze([270, 352]),
    /** Un punto de blanco sobre el color más vivo: neón, no primario puro. */
    soft: 0.07,
});

/**
 * Las barras del espectro según lo claro que esté el cielo que tienen detrás (su
 * luminancia, en techos del limitador):
 *   - de noche son LUZ: el tono, a la luminancia del techo;
 *   - de día no cabe luz detrás de lo que se juega: son el mismo tono, EN SOMBRA
 *     (`shade` × la luminancia del cielo). Un color vivo y algo más oscuro que el
 *     cielo se lee como color; uno apagado, como suciedad.
 *   - AL ANOCHECER (`dusk`: entre qué claridades del cielo) son las dos cosas a
 *     la vez: cada barra se enciende de la punta hacia abajo. Un solo color que
 *     pasase de sombra a luz mediría, a mitad de camino, lo mismo que su cielo, y
 *     la barra desaparecería justo antes del clímax. Así la punta es luz contra el
 *     cielo alto, ya oscuro, y el pie es silueta contra el resplandor del
 *     horizonte: el cielo del ocaso es exactamente así.
 *   La sombra es más honda con el cielo a media luz (`shade[0]`) que a pleno día
 *   (`shade[1]`), entre las claridades de `shadeSky`.
 */
export const SPECTRUM_TONES = Object.freeze({
    shade: Object.freeze([0.35, 0.65]),
    shadeSky: Object.freeze([0.5, 1]),
    dusk: Object.freeze([0.26, 0.62]),
});

const DEG = 180 / Math.PI;
const wrap360 = (h) => ((h % 360) + 360) % 360;
/** Diferencia de tono con signo, en (−180, 180]. */
const hueDelta = (a, b) => {
    const d = wrap360(a - b);
    return d > 180 ? d - 360 : d;
};
const ramp = (v, from, to) => {
    const x = (v - from) / (to - from);
    return x <= 0 ? 0 : x >= 1 ? 1 : x;
};

const labA = [0, 0, 0];
const labB = [0, 0, 0];
const linTmp = [0, 0, 0];

/** Tono OKLCh de un color sRGB [0,1], en grados [0, 360). */
export function hueOf(rgb) {
    rgbToOklab(rgb, labA);
    return wrap360(Math.atan2(labA[2], labA[1]) * DEG);
}

// ---------------------------------------------------------------------------
// El color más vivo de cada tono.
//
// El color de más croma que cabe en sRGB para un tono está siempre en las aristas
// del cubo RGB que van de un primario al siguiente (un canal a 1 y otro a 0): los
// colores saturados de toda la vida. Se recorren esas aristas una vez y se guarda,
// grado a grado de tono, cuál toca.

/** @type {Float32Array | null}  360 colores (r, g, b), uno por grado de tono. */
let vividTable = null;

function edgeColor(turn, out) {
    const x = wrap360(turn * 360) / 60;
    const i = Math.floor(x) % 6;
    const f = x - Math.floor(x);
    out[0] = [1, 1 - f, 0, 0, f, 1][i];
    out[1] = [f, 1, 1, 1 - f, 0, 0][i];
    out[2] = [0, 0, f, 1, 1, 1 - f][i];
    return out;
}

function buildVivid() {
    const table = new Float32Array(360 * 3);
    const filled = new Uint8Array(360);
    const c = [0, 0, 0];
    const STEPS = 2880;
    for (let k = 0; k < STEPS; k++) {
        edgeColor(k / STEPS, c);
        const h = Math.round(hueOf(c)) % 360;
        table[h * 3] = c[0];
        table[h * 3 + 1] = c[1];
        table[h * 3 + 2] = c[2];
        filled[h] = 1;
    }
    // Un grado sin muestra (el tono corre deprisa en ese tramo): el del vecino.
    for (let h = 0; h < 360; h++) {
        if (filled[h]) continue;
        let n = h;
        for (let d = 1; d < 360 && !filled[n]; d++) n = (h + d) % 360;
        table.copyWithin(h * 3, n * 3, n * 3 + 3);
    }
    return table;
}

/**
 * El color más vivo que cabe en sRGB con ese tono (grados OKLCh).
 * @param {number} hueDeg
 * @param {number[]} out
 */
export function vividAt(hueDeg, out) {
    if (vividTable === null) vividTable = buildVivid();
    const h = wrap360(hueDeg);
    const i = Math.floor(h) % 360;
    const j = (i + 1) % 360;
    const f = h - Math.floor(h);
    for (let k = 0; k < 3; k++) out[k] = vividTable[i * 3 + k] + (vividTable[j * 3 + k] - vividTable[i * 3 + k]) * f;
    return out;
}

// ---------------------------------------------------------------------------
// A juego con el cielo.

/**
 * Un color de efecto, a juego con el cielo que tiene detrás: si su tono queda a
 * más de `maxHueDeg` del tono del cielo, gira hacia él hasta esa distancia (por
 * el camino corto), con su mismo brillo y su misma viveza (menos, si girado no
 * cabe en sRGB). Si ya está cerca, o el cielo es gris, no cambia.
 *
 * @param {ArrayLike<number>} rgb
 * @param {ArrayLike<number>} sky
 * @param {number[]} out
 * @param {typeof TONE_RULES} [rules]
 */
export function harmonize(rgb, sky, out, rules = TONE_RULES) {
    out[0] = rgb[0];
    out[1] = rgb[1];
    out[2] = rgb[2];
    rgbToOklab(sky, labB);
    const w = ramp(Math.hypot(labB[1], labB[2]), rules.skyChroma[0], rules.skyChroma[1]);
    if (w <= 0) return out;
    rgbToOklab(rgb, labA);
    let chroma = Math.hypot(labA[1], labA[2]);
    if (chroma < 1e-4) return out;
    const skyHue = Math.atan2(labB[2], labB[1]) * DEG;
    const d = hueDelta(Math.atan2(labA[2], labA[1]) * DEG, skyHue);
    const far = Math.abs(d) - rules.maxHueDeg;
    if (far <= 0) return out;
    const hue = (skyHue + d - Math.sign(d) * far * w) / DEG;
    const L = labA[0];
    // Un color muy claro apenas tiene croma que conservar en otro tono: se baja
    // hasta que quepa (recortar canales le cambiaría el tono).
    for (let i = 0; i < 40; i++) {
        labA[0] = L;
        labA[1] = chroma * Math.cos(hue);
        labA[2] = chroma * Math.sin(hue);
        oklabToLinear(labA, linTmp);
        const lo = Math.min(linTmp[0], linTmp[1], linTmp[2]);
        const hi = Math.max(linTmp[0], linTmp[1], linTmp[2]);
        if (lo >= -1e-4 && hi <= 1 + 1e-4) break;
        chroma *= 0.9;
    }
    return oklabToRgb(labA, out);
}

// ---------------------------------------------------------------------------
// El espectro.

/** Posición de un tono dentro del arco, en grados desde su inicio; si cae fuera, su extremo más cercano. */
function arcPos(hueDeg, arc) {
    const span = wrap360(arc[1] - arc[0]);
    const p = wrap360(hueDeg - arc[0]);
    if (p <= span) return p;
    return p - span < 360 - p ? span : 0;
}

/**
 * Los extremos de la rampa del espectro para dos colores de efectos: dónde caen
 * su cálido (los graves) y su frío (los agudos) dentro del arco de tonos que
 * brillan en oscuro.
 *
 * @param {{ warm: ArrayLike<number>, cool: ArrayLike<number> }} colors
 * @param {number[]} out  [posición del cálido, posición del frío]
 */
export function spectrumEnds(colors, out, rules = TONE_RULES) {
    out[0] = arcPos(hueOf(colors.warm), rules.arc);
    out[1] = arcPos(hueOf(colors.cool), rules.arc);
    return out;
}

const vividTmp = [0, 0, 0];

/** El tono de la barra `t` ([0,1], de los graves a los agudos), tan vivo como cabe. */
function barTone(ends, t, rules) {
    vividAt(rules.arc[0] + ends[0] + (ends[1] - ends[0]) * t, vividTmp);
    for (let k = 0; k < 3; k++) vividTmp[k] += (1 - vividTmp[k]) * rules.soft;
    return vividTmp;
}

/**
 * Una barra del espectro como LUZ: su tono, a la luminancia del techo de la
 * franja jugable. Es lo más claro que llega a ser una barra.
 *
 * @param {ArrayLike<number>} ends   De `spectrumEnds`.
 * @param {number} t                 [0,1] de los graves a los agudos.
 * @param {number[]} out
 */
export function spectrumLight(ends, t, out, rules = TONE_RULES) {
    return capColor(barTone(ends, t, rules), out, FX_LIMIT.cap);
}

/**
 * Una barra del espectro EN SOMBRA: el mismo tono, más oscuro que el cielo que
 * tiene detrás.
 *
 * @param {ArrayLike<number>} ends
 * @param {number} t
 * @param {number} skyLuma  Sustituto de luminancia (limiter.js `proxyLuma`) del cielo de detrás.
 * @param {number[]} out
 */
export function spectrumShade(ends, t, skyLuma, out, rules = TONE_RULES, tones = SPECTRUM_TONES) {
    const k = skyLuma / FX_LIMIT.cap;
    const depth = tones.shade[0] + (tones.shade[1] - tones.shade[0]) * ramp(k, tones.shadeSky[0], tones.shadeSky[1]);
    return capColor(barTone(ends, t, rules), out, Math.min(FX_LIMIT.cap, skyLuma * depth));
}

/**
 * Cuánto de las barras es sombra con ese cielo detrás: 0 de noche (todo luz), 1
 * de día (todo sombra) y, entre medias, la parte de cada barra que aún no se ha
 * encendido, contada desde el pie.
 */
export function spectrumDay(skyLuma, tones = SPECTRUM_TONES) {
    return ramp(skyLuma / FX_LIMIT.cap, tones.dusk[0], tones.dusk[1]);
}
