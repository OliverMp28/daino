// Los efectos del cielo, en números (T03.1, doc 11).
//
// El shader del fondo (background.frag) ya no decide nada de los efectos: recibe
// CANTIDADES ya calculadas y solo compone. Aquí, en una tabla, está cuánto pone
// cada efecto del cielo según las señales (señales × coeficientes × nivel del
// director). Afinar un efecto es cambiar un número de SKY_FX; añadir uno, una
// entrada, su hueco en `uFxA/B/C` y sus líneas en el shader.
//
// Huecos del shader (background.frag):
//   uFxA  x tinte del clímax · y avivado de las estrellas · z radio extra del sol · w halo del sol
//   uFxB  x brillo del horizonte · y línea fría del horizonte · z caída del brillo ·
//         w bombeo del cielo (cuánto se oscurece AHORA)
//   uFxC  x destello · y calma del break · z aurora (cuánta luz) · w lluvia de estrellas
//   uFxD  relojes de las firmas (T03.3): x fase de la aurora (fluye con la música) ·
//         y vaivén de sus cortinas (los graves) · z tanda de la lluvia (su número;
//         +0.5 si cae en un primer tiempo: es mayor) · w segundos desde que empezó
//
// Puro: lo prueban los tests de destellos (flashSafety.js) sin navegador.

import { FLASH_RULES, maxDimFor } from './flashSafety.js';

export const SKY_FX = Object.freeze({
    /** Tinte del clímax: la parte alta del cielo, latiendo con el pulso. */
    climaxTint: Object.freeze({ base: 0.035, pulse: 0.05 }),
    /** Estrellas vivas: titilan con los agudos, laten con el pulso y más en el primer tiempo. */
    starPulse: Object.freeze({ high: 2.6, pulse: 0.5, accent: 0.7 }),
    /** Latido del sol: cuánto crece su radio (en alturas de pantalla). */
    sunPulse: Object.freeze({ base: 0.018, intensity: 0.02 }),
    /** Resplandor del sol con los graves, el pulso y los momentos. */
    sunGlow: Object.freeze({ bass: 0.3, pulse: 0.1, pulseIntensity: 0.14, flash: 0.25 }),
    /** Brillo del horizonte: una banda cálida y, pegada a él, una línea fría. */
    horizonGlow: Object.freeze({
        bass: 0.55, pulse: 0.15, pulseIntensity: 0.30, pulseBuild: 0.35, flash: 0.45, build: 0.30,
        /** Caída con la distancia al horizonte: más ancha cuanto más empuja el tramo. */
        falloff: 26, falloffIntensity: 8,
        coolHigh: 0.35, coolFlash: 0.25,
    }),
    /**
     * Bombeo del cielo: cuánto se oscurece entre golpes (en el golpe vuelve a su
     * brillo). Más hondo cuanto más empuja el tramo y en las subidas.
     */
    beatPump: Object.freeze({ base: 0.09, intensity: 0.14, build: 0.06 }),
    /** Destello de un momento sobre el cielo (el de pantalla lo pone la partida). */
    dropFlash: Object.freeze({ amount: 0.10 }),
    /** Calma del break: cuánto se apaga el color hacia un gris frío y cuánto se oscurece. */
    breakCalm: Object.freeze({ desaturate: 0.6, darken: 0.22, tint: Object.freeze([0.78, 0.84, 1.0]) }),
    /**
     * Aurora (firma): cuánta luz ponen sus cortinas, más con los tramos que
     * empujan. Respira con el pulso HACIA ABAJO (entre golpes se atenúa `pulse`):
     * un cambio de luminancia muy por debajo de un destello. Fluye sola (`flow`,
     * en radianes por segundo) y más deprisa cuando la música se mueve; los graves
     * mecen las cortinas (`sway`, con su subida y su caída por segundo).
     * Las cortinas no se suman (el shader se queda con la de más luz): lo más que
     * pone la aurora en un píxel es su color vivo por esta cantidad.
     */
    aurora: Object.freeze({
        base: 0.52, intensity: 0.2, pulse: 0.1,
        flow: 0.22, flowMid: 0.55, flowIntensity: 0.3,
        sway: 0.9, swayRise: 9, swayFall: 1.6,
    }),
    /**
     * Lluvia de estrellas (firma): en el clímax, una tanda en cada primer tiempo
     * de compás y, si el compás es largo (`halfBarMinS`), otra menor a mitad de
     * compás: así cae una cada 1-2 s a cualquier tempo, siempre sobre el pulso.
     * `minGapS`: una tanda no pisa a la anterior (una fugaz dura 0.65 s).
     * `edge`: cuánto tiene que subir el pulso de un fotograma al siguiente para
     * contar como un golpe nuevo.
     */
    meteors: Object.freeze({ amount: 1.2, edge: 0.3, halfBarMinS: 1.9, minGapS: 0.75 }),
});

/**
 * La calma del break sobre un color, como la pinta el shader (espejo de
 * background.frag; el guardián comprueba con ella que apagar el color no borra
 * lo que se juega). Los números de SKY_FX.breakCalm están repetidos en el shader.
 */
export function applyCalm(rgb, calm, out) {
    const C = SKY_FX.breakCalm;
    const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    for (let i = 0; i < 3; i++) {
        const grey = luma * C.tint[i];
        out[i] = (rgb[i] + (grey - rgb[i]) * C.desaturate * calm) * (1 - C.darken * calm);
    }
    return out;
}

/**
 * La luz de las firmas no usa los colores de los efectos tal cual: los lleva a
 * una viveza y una claridad fijas (su mismo tono, tan vivo como cabe). Un color
 * pálido sumado a medias sobre un cielo oscuro no se lee como luz, sino como
 * polvo. Espejo de `fxVivid` (background.frag): un test vigila que coincidan.
 */
export const VIVID_LIGHT = Object.freeze({ level: 0.55, floor: 0.04 });

/**
 * @param {ArrayLike<number>} rgb
 * @param {number[]} out
 */
export function vividLight(rgb, out) {
    const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const d0 = rgb[0] - l;
    const d1 = rgb[1] - l;
    const d2 = rgb[2] - l;
    const k = VIVID_LIGHT.level / Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2), VIVID_LIGHT.floor);
    out[0] = Math.max(0, Math.min(1, VIVID_LIGHT.level + d0 * k));
    out[1] = Math.max(0, Math.min(1, VIVID_LIGHT.level + d1 * k));
    out[2] = Math.max(0, Math.min(1, VIVID_LIGHT.level + d2 * k));
    return out;
}

/** @returns {{ a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array }} */
export function createSkyAmounts() {
    return { a: new Float32Array(4), b: new Float32Array(4), c: new Float32Array(4), d: new Float32Array(4) };
}

/**
 * Relojes de las firmas del cielo: lo que el shader no puede saber con `uTime`,
 * porque depende de la música (cuánto ha fluido la aurora, cuándo cayó el último
 * primer tiempo).
 */
export function createSkyClocks() {
    return {
        auroraPhase: 0, auroraSway: 0,
        /** Número de la tanda en curso, si cayó en un primer tiempo y los segundos que lleva. */
        showerIndex: 0, showerBig: false, showerSince: 60,
        /** El compás, medido con los golpes que van llegando. */
        lastPulse: 0, lastAccent: 0, beatsInBar: 0, barBeats: 0, barS: 0, sinceBar: 0,
    };
}

/** Relojes a cero (fin de la partida: la siguiente no hereda nada). */
export function resetSkyClocks(clocks) {
    clocks.auroraPhase = 0;
    clocks.auroraSway = 0;
    clocks.showerIndex = 0;
    clocks.showerBig = false;
    clocks.showerSince = 60;
    clocks.lastPulse = 0;
    clocks.lastAccent = 0;
    clocks.beatsInBar = 0;
    clocks.barBeats = 0;
    clocks.barS = 0;
    clocks.sinceBar = 0;
}

/** Vuelta de la tanda de la lluvia: el shader la usa de semilla (un float exacto). */
const SHOWER_WRAP = 4096;

/**
 * Avanza los relojes un fotograma.
 *
 * @param {ReturnType<typeof createSkyClocks>} clocks
 * @param {Record<string, number>} levels   Del director.
 * @param {import('./signals.js').FxSignals} s
 * @param {number} dt
 */
export function advanceSkyClocks(clocks, levels, s, dt) {
    const step = Math.max(0, dt);
    const A = SKY_FX.aurora;
    if (levels.aurora > 0) {
        clocks.auroraPhase += step * (A.flow + A.flowMid * s.live.mid + A.flowIntensity * s.song.intensity);
        const target = A.sway * s.live.bass;
        const rate = target > clocks.auroraSway ? A.swayRise : A.swayFall;
        clocks.auroraSway += (target - clocks.auroraSway) * (1 - Math.exp(-step * rate));
    }
    // El compás se mide con los golpes: un golpe nuevo es un flanco de subida del
    // pulso (la partida lo da a 1 en el golpe y cayendo hasta el siguiente), y si
    // sube también el acento, es un primer tiempo.
    const M = SKY_FX.meteors;
    clocks.showerSince = Math.min(60, clocks.showerSince + step);
    clocks.sinceBar = Math.min(60, clocks.sinceBar + step);
    const beat = s.beat.pulse - clocks.lastPulse > M.edge;
    const downbeat = beat && s.beat.accent - clocks.lastAccent > M.edge;
    clocks.lastPulse = s.beat.pulse;
    clocks.lastAccent = s.beat.accent;
    if (downbeat) {
        // Golpes del compás que acaba: los que siguieron a su primer tiempo, y él.
        clocks.barBeats = clocks.beatsInBar + 1;
        clocks.barS = clocks.sinceBar;
        clocks.beatsInBar = 0;
        clocks.sinceBar = 0;
    } else if (beat) {
        clocks.beatsInBar++;
    }
    // Las tandas: solo con la lluvia en marcha (fuera del clímax no hay).
    if (beat && levels.meteors * s.song.climax > 0.05 && clocks.showerSince >= M.minGapS) {
        const half = clocks.barBeats >= 2 && clocks.barBeats % 2 === 0 && clocks.beatsInBar === clocks.barBeats / 2 && clocks.barS >= M.halfBarMinS;
        if (downbeat || half) {
            clocks.showerIndex = (clocks.showerIndex + 1) % SHOWER_WRAP;
            clocks.showerBig = downbeat;
            clocks.showerSince = 0;
        }
    }
    return clocks;
}

/**
 * Cantidades del fotograma.
 *
 * @param {Record<string, number>} levels   Del director.
 * @param {import('./signals.js').FxSignals} s
 * @param {ReturnType<typeof createSkyAmounts>} out
 * @param {ReturnType<typeof createSkyClocks> | null} [clocks]  Sin ellos, las firmas quedan quietas.
 */
export function skyAmounts(levels, s, out, clocks = null) {
    const F = SKY_FX;
    const pulse = s.beat.world;
    const I = s.song.intensity;
    const build = s.song.build;
    // El destello de un momento lo gobierna un solo efecto, lo pinte quien lo pinte.
    const flash = s.song.flash * levels.dropFlash;

    out.a[0] = levels.climaxTint * s.song.climax * (F.climaxTint.base + F.climaxTint.pulse * pulse);
    out.a[1] = levels.starPulse * (F.starPulse.high * s.live.high + F.starPulse.pulse * pulse + F.starPulse.accent * s.beat.accent);
    out.a[2] = levels.sunPulse * pulse * (F.sunPulse.base + F.sunPulse.intensity * I);
    out.a[3] = levels.sunGlow * (F.sunGlow.bass * s.live.bass + pulse * (F.sunGlow.pulse + F.sunGlow.pulseIntensity * I) + F.sunGlow.flash * flash);

    const H = F.horizonGlow;
    out.b[0] = levels.horizonGlow * (H.bass * s.live.bass + pulse * (H.pulse + H.pulseIntensity * I + H.pulseBuild * build) + H.flash * flash + H.build * build);
    out.b[1] = levels.horizonGlow * (H.coolHigh * s.live.high + H.coolFlash * flash);
    out.b[2] = H.falloff - H.falloffIntensity * I;
    // El bombeo: el cielo se oscurece entre golpes y vuelve en el golpe. Con tope:
    // en un cielo claro (de día) el golpe no puede ser un destello de pantalla
    // (flashSafety.js).
    const depth = Math.min(levels.beatPump * (F.beatPump.base + F.beatPump.intensity * I + F.beatPump.build * build), maxDimFor(s.sky.maxLuma, FLASH_RULES));
    out.b[3] = depth * (1 - pulse);

    out.c[0] = flash * F.dropFlash.amount;
    out.c[1] = levels.breakCalm * s.song.calm;
    // Firmas (T03.3). La aurora respira hacia abajo, como el bombeo: en el golpe
    // está entera y entre golpes se atenúa un poco.
    const A = F.aurora;
    out.c[2] = levels.aurora * (A.base + A.intensity * I) * (1 - A.pulse * (1 - pulse));
    out.c[3] = levels.meteors * s.song.climax * F.meteors.amount;
    if (clocks !== null) {
        out.d[0] = clocks.auroraPhase;
        out.d[1] = clocks.auroraSway;
        out.d[2] = clocks.showerIndex + (clocks.showerBig ? 0.5 : 0);
        out.d[3] = clocks.showerSince;
    }
    return out;
}
