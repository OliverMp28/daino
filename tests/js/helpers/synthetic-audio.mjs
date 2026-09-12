// Generador de audio sintético para los tests del pipeline de análisis.
//
// El analizador (`levels/SpectralFlux.js`) solo toca cuatro propiedades del
// AudioBuffer: `numberOfChannels`, `length`, `sampleRate` y `getChannelData(c)`.
// `LevelGenerator` añade `duration`. Eso es TODA la superficie de dependencia
// con la Web Audio API, así que un objeto plano con esos cinco miembros basta
// para ejercitar el pipeline entero en Node, sin navegador y sin mocks.
//
// Esa misma propiedad es la que hará posible mover el análisis a un Worker o
// a un proceso servidor en las Olas 4-5 sin reescribir el algoritmo.

/**
 * PRNG determinista (xorshift32) para que el ruido del click track sea
 * reproducible entre ejecuciones — si no, los tests de determinismo no
 * podrían distinguir "el generador es determinista" de "la entrada lo era".
 *
 * @param {number} seed
 * @returns {() => number} valores en [-1, 1)
 */
function makeNoise(seed) {
    let x = seed | 0 || 0x9e3779b9;
    return () => {
        x ^= x << 13; x |= 0;
        x ^= x >>> 17;
        x ^= x << 5; x |= 0;
        return ((x >>> 0) / 2147483648) - 1;
    };
}

/**
 * Construye un "click track": un golpe percusivo (ruido con decaimiento
 * exponencial) en cada beat, sobre un colchón tonal suave. Produce onsets
 * limpios y periódicos, que es justo lo que el detector de BPM debe capturar.
 *
 * @param {{
 *   bpm?: number,
 *   durationSec?: number,
 *   sampleRate?: number,
 *   channels?: number,
 *   seed?: number,
 *   accentEvery?: number,
 * }} [opts]
 * @returns {{ numberOfChannels: number, length: number, sampleRate: number,
 *             duration: number, getChannelData: (c: number) => Float32Array }}
 */
export function makeClickTrack(opts = {}) {
    const bpm = opts.bpm ?? 130;
    const durationSec = opts.durationSec ?? 30;
    const sampleRate = opts.sampleRate ?? 44100;
    const channels = opts.channels ?? 2;
    const accentEvery = opts.accentEvery ?? 4;
    const noise = makeNoise(opts.seed ?? 12345);

    const length = Math.floor(durationSec * sampleRate);
    const mono = new Float32Array(length);

    // Colchón tonal: no aporta onsets, pero evita un espectro degenerado.
    for (let i = 0; i < length; i++) {
        mono[i] = 0.04 * Math.sin((2 * Math.PI * 110 * i) / sampleRate);
    }

    // Golpes en cada beat. Decaimiento exponencial ~60 ms.
    const beatSamples = (60 / bpm) * sampleRate;
    const decay = Math.exp(-1 / (0.06 * sampleRate));
    const numBeats = Math.floor(length / beatSamples);
    for (let b = 0; b < numBeats; b++) {
        const start = Math.round(b * beatSamples);
        const gain = b % accentEvery === 0 ? 1.0 : 0.6;
        let env = gain;
        for (let i = 0; i < 0.12 * sampleRate && start + i < length; i++) {
            mono[start + i] += noise() * env;
            env *= decay;
        }
    }

    const data = [];
    for (let c = 0; c < channels; c++) data.push(mono);

    return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (c) => data[c],
    };
}

/**
 * Señal puramente tonal, sin percusión: no debe producir un BPM con
 * confianza alta. Sirve para ejercitar la rama de fallback del detector.
 *
 * @param {{ durationSec?: number, sampleRate?: number }} [opts]
 */
export function makeDrone(opts = {}) {
    const durationSec = opts.durationSec ?? 20;
    const sampleRate = opts.sampleRate ?? 44100;
    const length = Math.floor(durationSec * sampleRate);
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        mono[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sampleRate)
                + 0.2 * Math.sin((2 * Math.PI * 330 * i) / sampleRate);
    }
    return {
        numberOfChannels: 1,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => mono,
    };
}
