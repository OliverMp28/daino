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

/**
 * Canción sintética con ESTRUCTURA conocida, en formato 2 (el del analizador
 * del servidor) — Ola 5.
 *
 * Cada sección declara cuántos compases dura, cuánta energía tiene y cuánto
 * golpea (`hits` en [0,1]). En cada compás: bombo grave en los tiempos impares
 * (1 y 3), caja brillante en los pares (2 y 4) y, si la sección golpea con
 * ganas, charles agudo a contratiempo. Así el charter se prueba contra una
 * verdad conocida: dónde está el pulso, qué suena brillante, qué tramo empuja.
 *
 * `riff: true` en una sección hace que cada compás repita exactamente el mismo
 * patrón de fuerzas (para la memoria de frases); si no, las fuerzas varían un
 * poco de compás a compás.
 *
 * @param {{ bpm?: number, meter?: number, firstBeatS?: number, seed?: number,
 *           tailBeats?: number,
 *           sections?: Array<{ bars: number, energy: number, hits?: number, role?: string,
 *                              cluster?: string, silent?: boolean, riff?: boolean }> }} [opts]
 */
export function makeSyntheticSong(opts = {}) {
    const bpm = opts.bpm ?? 120;
    const meter = opts.meter ?? 4;
    const period = 60 / bpm;
    const rand = makeNoise(opts.seed ?? 7);
    const sections = opts.sections ?? DEFAULT_SONG_SECTIONS;

    const beats = [];
    const downbeats = [];
    const onsets = [];
    const onsetColor = [];
    const outSections = [];
    const energySpans = [];
    let t = opts.firstBeatS ?? 0.5;

    const hit = (time, strength, color) => {
        onsets.push([round3(time), round3(Math.min(1, strength))]);
        onsetColor.push(color);
    };

    for (let si = 0; si < sections.length; si++) {
        const s = sections[si];
        const start = si === 0 ? 0 : t;
        const hits = s.hits ?? 0.6;
        let hitCount = 0;
        for (let b = 0; b < s.bars; b++) {
            for (let k = 0; k < meter; k++) {
                const bt = round3(t);
                beats.push(bt);
                if (k === 0) downbeats.push(bt);
                if (!s.silent) {
                    const jitter = s.riff ? 0 : 0.06 * (rand() + 1) / 2;
                    if (k % 2 === 0) hit(bt, 0.35 + 0.6 * hits * (k === 0 ? 1 : 0.85) + jitter, [0.72, 0.2, 0.08]);
                    else hit(bt, 0.3 + 0.55 * hits + jitter, [0.12, 0.43, 0.45]);
                    hitCount++;
                    if (hits > 0.45) {
                        hit(t + period / 2, 0.12 + 0.3 * hits, [0.05, 0.25, 0.7]);
                        hitCount++;
                    }
                }
                t += period;
            }
        }
        outSections.push({
            startSec: round3(start),
            endSec: round3(t),
            cluster: s.cluster ?? String.fromCharCode(65 + si),
            role: s.role ?? 'verse',
            energy: s.silent ? 0.02 : s.energy,
            density: round3(hitCount / Math.max(1e-3, t - start)),
        });
        energySpans.push({ start, end: t, energy: s.silent ? 0.02 : s.energy });
    }

    const durationSec = round3(t + period * (opts.tailBeats ?? 4));
    outSections[outSections.length - 1].endSec = durationSec;

    const hop = 0.1;
    const values = [];
    for (let k = 0; k * hop < durationSec; k++) {
        const c = k * hop;
        const span = energySpans.find((e) => c >= e.start && c < e.end) ?? energySpans[energySpans.length - 1];
        values.push(round3(Math.min(1, Math.max(0, span.energy + 0.03 * rand()))));
    }

    const minutes = durationSec / 60;
    const strong = onsets.filter((o) => o[1] >= 0.5).length;
    const events = onsets.filter((o) => o[1] >= 0.2).length;
    return {
        formatVersion: 2,
        analyzer: { name: 'synthetic-song', version: 1 },
        durationSec,
        sampleRate: 44100,
        bpm,
        bpmConfidence: 1,
        beatPeriodS: period,
        onsets,
        onsetColor,
        beats,
        downbeats,
        meter,
        sections: outSections,
        energy: { hopSec: hop, values },
        features: {
            tempoStability: 1,
            beatSupport: 0.95,
            pulseDoubled: false,
            percussiveRatio: 0.4,
            eventsPerMin: round3(events / minutes),
            strongEventsPerMin: round3(strong / minutes),
            loudnessDbfs: -12,
            dynamicRangeDb: 14,
            silenceRatio: 0,
        },
    };
}

/** Forma pop típica: intro, estrofa, estribillo, estrofa, estribillo, puente, estribillo final, outro. */
export const DEFAULT_SONG_SECTIONS = Object.freeze([
    { bars: 8, energy: 0.25, hits: 0.3, role: 'intro', cluster: 'A' },
    { bars: 12, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
    { bars: 8, energy: 0.85, hits: 0.95, role: 'chorus', cluster: 'C' },
    { bars: 12, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
    { bars: 8, energy: 0.85, hits: 0.95, role: 'chorus', cluster: 'C' },
    { bars: 8, energy: 0.3, hits: 0.25, role: 'bridge', cluster: 'D' },
    { bars: 8, energy: 0.9, hits: 1, role: 'chorus', cluster: 'C' },
    { bars: 6, energy: 0.2, hits: 0.2, role: 'outro', cluster: 'A' },
]);

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
