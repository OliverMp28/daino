// El ARCO de un ambiente (T02.3/T02.4, doc 11 §2.8): lo que le pasa a una escena
// con la canción. Curvas por HORA del cielo, y como la hora ya sigue la
// estructura de la canción (skyClock.js: la noche cae con el clímax, el alba
// llega con el final), una curva que sube hacia la noche sube hacia el clímax:
// la tormenta estalla con él y escampa con el alba sin leer nada más del chart.
// Nunca la señal en vivo: eso son efectos (§2.4).
//
// También el reloj de los relámpagos: cuándo cae un rayo y cómo destella, con el
// límite de la WCAG 2.3.1 (nunca más de 3 destellos por segundo).
//
// Puro y sin Pixi: lo usan skyModel.js, las capas y los tests.

import { hash01 } from '../entities/scenery/ridgeShape.js';

/**
 * Lo que puede declarar el arco de una escena (`scene.arc`), todo en [0, 1]:
 *   overcast   cielo encapotado (tiñe el cielo, vela el sol, la luna y las estrellas)
 *   rain       fuerza de la lluvia
 *   lightning  frecuencia de los relámpagos
 *   snow       fuerza de la nevada
 *   windows    ventanas encendidas de la ciudad
 */
export const ARC_KEYS = Object.freeze(['overcast', 'rain', 'lightning', 'snow', 'windows']);

/** Hora "de la noche continua": de 12:00 a 35:59 (las 5:00 son 29), como skyModel. */
function continuousHour(hour) {
    const h = ((hour % 24) + 24) % 24;
    return h < 12 ? h + 24 : h;
}

/**
 * Valor de una curva `[[hora, valor], …]` (horas continuas de 12 a 36, en orden)
 * a una hora: lineal entre puntos y plana fuera de ellos.
 *
 * @param {ReadonlyArray<readonly [number, number]>} curve
 * @param {number} hour
 */
export function sampleCurve(curve, hour) {
    if (!curve || curve.length === 0) return 0;
    const h = continuousHour(hour);
    if (h <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
        const [hb, vb] = curve[i];
        if (h <= hb) {
            const [ha, va] = curve[i - 1];
            return hb > ha ? va + (vb - va) * (h - ha) / (hb - ha) : vb;
        }
    }
    return curve[curve.length - 1][1];
}

/**
 * El arco de una escena a una hora. Lo que la escena no declara vale 0.
 *
 * @param {{ arc?: Record<string, ReadonlyArray<readonly [number, number]>> }} scene
 * @param {number} hour
 * @param {Record<string, number>} out
 */
export function arcAt(scene, hour, out) {
    for (const key of ARC_KEYS) out[key] = scene.arc?.[key] ? sampleCurve(scene.arc[key], hour) : 0;
    return out;
}

// ---------------------------------------------------------------------------
// Relámpagos

/**
 * Reglas de los relámpagos. La WCAG 2.3.1 ("tres destellos o menos") pide que
 * nada destelle más de 3 veces en un segundo: un rayo son como mucho 2 destellos
 * en 0.2 s y entre dos rayos pasan al menos `minGapS`.
 *
 *   gapAtFullS / gapAtLowS  Hueco típico entre rayos con la tormenta a tope y con
 *                           apenas tormenta (se reparte al azar ±40 %).
 *   minIntensity            Por debajo, no cae ninguno.
 *   flashes                 Destellos de un rayo: [desde, hasta, fuerza] en s.
 *   fadeS                   Lo que tarda en apagarse el último.
 *   skyAlpha                Cuánto aclara el cielo un destello a tope.
 */
export const LIGHTNING = Object.freeze({
    gapAtFullS: 2.8,
    gapAtLowS: 10,
    minGapS: 1.4,
    minIntensity: 0.08,
    flashes: Object.freeze([Object.freeze([0, 0.07, 1]), Object.freeze([0.13, 0.19, 0.75])]),
    between: 0.15,
    fadeS: 0.35,
    skyAlpha: 0.2,
});

/**
 * Fuerza del destello de un rayo `t` segundos después de caer: dos destellos y
 * una cola que se apaga. 0 antes y después.
 *
 * @param {number} t
 */
export function flashAt(t) {
    const L = LIGHTNING;
    if (!(t >= 0)) return 0;
    for (let i = 0; i < L.flashes.length; i++) {
        const [a, b, v] = L.flashes[i];
        if (t < a) return L.between;
        if (t < b) return v;
    }
    const [, end, last] = L.flashes[L.flashes.length - 1];
    const k = (t - end) / L.fadeS;
    return k < 1 ? last * (1 - k) : 0;
}

/**
 * Reloj de relámpagos: `tick(dt, intensidad)` devuelve un rayo nuevo (dónde y con
 * qué forma, en [0, 1]) o null. Determinista por semilla: la misma tormenta cae
 * igual cada vez.
 *
 * @param {number} seed
 */
export function createLightningClock(seed) {
    const L = LIGHTNING;
    let n = 0;
    let since = L.minGapS;
    let gap = null;

    function nextGap(intensity) {
        const base = L.gapAtLowS + (L.gapAtFullS - L.gapAtLowS) * Math.min(1, intensity);
        return Math.max(L.minGapS, base * (0.6 + 0.8 * hash01(n * 3 + 1, seed)));
    }

    return {
        /**
         * @param {number} dt
         * @param {number} intensity  [0, 1] (`state.arc.lightning`).
         * @returns {{ index: number, x: number, top: number, shape: number } | null}
         */
        tick(dt, intensity) {
            since += dt;
            if (intensity < L.minIntensity) {
                gap = null;
                return null;
            }
            if (gap === null) gap = nextGap(intensity);
            if (since < gap) return null;
            const strike = { index: n, x: hash01(n * 3 + 2, seed), top: hash01(n * 3 + 3, seed), shape: n * 7 + seed };
            n++;
            since = 0;
            gap = nextGap(intensity);
            return strike;
        },
    };
}
