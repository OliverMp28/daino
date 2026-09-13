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

/**
 * Análisis sintético con la forma exacta que produce `analyzeAudio`, sin DSP.
 *
 * El charter es una función pura del análisis, así que sus tests no necesitan
 * pasar por la FFT: basta con un análisis realista. La distribución de fuerzas
 * imita la medida sobre click tracks reales (golpes 0.32-1.0 con acento cada
 * 4, picos de ruido fuera de beat ≤ 0.1). Así los tests del charter corren en
 * milisegundos aunque la máquina esté cargada, y el DSP se prueba aparte.
 *
 * @param {{ bpm?: number, durationSec?: number, seed?: number,
 *           noisePerBeat?: number, firstBeatS?: number }} [opts]
 */
export function makeSyntheticAnalysis(opts = {}) {
    const bpm = opts.bpm ?? 128;
    const durationSec = opts.durationSec ?? 60;
    const noisePerBeat = opts.noisePerBeat ?? 3;
    const firstBeatS = opts.firstBeatS ?? 0;
    const rand = makeNoise(opts.seed ?? 99);
    const period = 60 / bpm;

    const onsets = [];
    for (let b = 0; firstBeatS + b * period < durationSec; b++) {
        const t = firstBeatS + b * period;
        onsets.push([round3(t), b % 4 === 0 ? 1 : round3(0.32 + 0.1 * (rand() + 1) / 2)]);
        for (let k = 0; k < noisePerBeat; k++) {
            // Ruido estrictamente entre beats (30-70 % del periodo).
            const tn = t + period * (0.3 + 0.4 * (rand() + 1) / 2);
            if (tn < durationSec) onsets.push([round3(tn), round3(0.1 * (rand() + 1) / 2)]);
        }
    }
    onsets.sort((a, b) => a[0] - b[0]);

    return {
        formatVersion: 1,
        analyzer: { name: 'daino-flux-js', version: 1 },
        durationSec,
        sampleRate: 44100,
        bpm,
        bpmConfidence: 0.9,
        beatPeriodS: period,
        onsets,
    };
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
