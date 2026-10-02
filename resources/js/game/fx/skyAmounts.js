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
//   uFxC  x destello · y calma del break · z, w libres (T03.3: aurora, lluvia de estrellas)
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

/** @returns {{ a: Float32Array, b: Float32Array, c: Float32Array }} */
export function createSkyAmounts() {
    return { a: new Float32Array(4), b: new Float32Array(4), c: new Float32Array(4) };
}

/**
 * Cantidades del fotograma.
 *
 * @param {Record<string, number>} levels   Del director.
 * @param {import('./signals.js').FxSignals} s
 * @param {ReturnType<typeof createSkyAmounts>} out
 */
export function skyAmounts(levels, s, out) {
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
    out.c[2] = 0;
    out.c[3] = 0;
    return out;
}
