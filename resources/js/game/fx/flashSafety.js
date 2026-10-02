// Destellos seguros (T03.1, doc 11): nada de pantalla destella más de 3 veces por
// segundo.
//
// WCAG 2.3.1 llama "destello general" a un par de cambios opuestos de luminancia
// relativa de 0.10 o más (con la imagen oscura por debajo de 0.80) en una zona
// grande de la pantalla, y pide no pasar de tres por segundo. Los efectos laten
// con el pulso: a 180 BPM son 3 golpes por segundo, y en una subida, con el
// contratiempo, 6. Así que lo que late en la pantalla entera NO puede llegar a ser
// un destello: su cambio de luminancia se queda por debajo del umbral, con margen.
//
//   - El bombeo del cielo oscurece el color entre golpes; cuánto cambia la
//     luminancia depende de lo claro que esté el cielo. `maxDimFor` da el
//     oscurecimiento máximo para el cielo de cada hora: de noche (cielo oscuro) no
//     limita nada; de día, sí.
//   - Dentro de la franja jugable todo pasa por el limitador (limiter.js): la luz
//     de los efectos no sube de 0.085, por debajo del umbral.
//   - Los momentos (el destello del drop) sí son destellos, pero sueltos: van en
//     el primer tiempo de un tramo, a segundos unos de otros (lo prueba un test
//     sobre los niveles oficiales).
//   - Los relámpagos del escenario tienen su propio reloj (scenes/weather.js).
//
// Puro.

export const FLASH_RULES = Object.freeze({
    /** Cambio de luminancia relativa que ya es un destello (WCAG 2.3.1). */
    flashDelta: 0.1,
    /** Lo que se permite a lo que late con el pulso: por debajo, con margen. */
    maxBeatDelta: 0.08,
    /** Destellos por segundo permitidos. */
    maxPerSecond: 3,
    /** Exponente con el que un factor sobre el color sRGB sube la luminancia (≈ la curva sRGB). */
    gamma: 2.2,
});

/**
 * Oscurecimiento máximo del cielo entre golpes (la fracción que se le quita al
 * color) para que el golpe no cambie la luminancia del punto más claro del cielo
 * más de `maxBeatDelta`.
 *
 * @param {number} maxLuma  Luminancia relativa del punto más claro del cielo.
 * @param {typeof FLASH_RULES} [rules]
 */
export function maxDimFor(maxLuma, rules = FLASH_RULES) {
    // Un cielo más oscuro que el propio umbral no puede dar un destello.
    if (!(maxLuma > rules.maxBeatDelta)) return 1;
    return 1 - Math.pow(1 - rules.maxBeatDelta / maxLuma, 1 / rules.gamma);
}
