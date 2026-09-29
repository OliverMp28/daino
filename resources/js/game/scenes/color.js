// Color para el escenario (T01): conversiones, interpolación y
// medidas de legibilidad. Puro y sin Pixi: lo usan la paleta del cielo, el
// guardián de legibilidad y los tests.
//
// Por qué OKLab para interpolar: mezclar dos colores en sRGB pasa por grises
// sucios (del azul del día al naranja del ocaso sale un marrón). OKLab es
// perceptualmente uniforme: la mitad del camino se ve a mitad del camino.
// (Björn Ottosson, 2020; matrices de su definición de referencia.)

/** '#rrggbb' → [r, g, b] en [0, 1] (sRGB, con gamma). */
export function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** [r, g, b] en [0, 1] → 0xRRGGBB, cuantizado a 8 bits (lo que entiende `tint` de Pixi). */
export function rgbToNumber(rgb) {
    const q = (c) => Math.max(0, Math.min(255, Math.round(c * 255)));
    return (q(rgb[0]) << 16) | (q(rgb[1]) << 8) | q(rgb[2]);
}

/** [r, g, b] en [0, 1] → '#rrggbb'. */
export function rgbToHex(rgb) {
    return `#${rgbToNumber(rgb).toString(16).padStart(6, '0')}`;
}

function toLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toGamma(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * sRGB [0, 1] → OKLab.
 * @param {ArrayLike<number>} rgb
 * @param {number[] | Float64Array} [out]
 */
export function rgbToOklab(rgb, out = [0, 0, 0]) {
    const r = toLinear(rgb[0]);
    const g = toLinear(rgb[1]);
    const b = toLinear(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return out;
}

/**
 * OKLab → sRGB [0, 1] (recortado al gamut).
 * @param {ArrayLike<number>} lab
 * @param {number[] | Float32Array} [out]
 */
export function oklabToRgb(lab, out = [0, 0, 0]) {
    const l = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
    const m = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
    const s = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2];
    const l3 = l * l * l;
    const m3 = m * m * m;
    const s3 = s * s * s;
    out[0] = toGamma(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
    out[1] = toGamma(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
    out[2] = toGamma(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3);
    return out;
}

/** Luminancia relativa WCAG 2.x de un color sRGB [0, 1]. */
export function relativeLuminance(rgb) {
    return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

/**
 * Contraste WCAG entre dos colores sRGB [0, 1]: de 1 (iguales) a 21 (blanco y negro).
 * La WCAG 1.4.11 pide 3:1 para los gráficos que hay que percibir.
 */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
