// Onset detection vía Spectral Flux. Funciones puras — el LevelGenerator
// las invoca offline (antes de arrancar la partida) sobre el AudioBuffer
// completo. NO se ejecuta en runtime durante el gameplay.
//
// Por qué casero (FFT propio) y no OfflineAudioContext + AnalyserNode:
//   - AnalyserNode aplica smoothing fijo y promedia en bins log-escala —
//     bueno para visual, malo para detección precisa de transitorios.
//   - OfflineAudioContext renderiza en bloques internos que no se exponen
//     frame por frame; sacar magnitudes alineadas a hops específicos exige
//     un AudioWorklet, que añade complejidad de mensajería.
//   - Una FFT Cooley-Tukey iterativa son ~50 líneas, cero deps, determinista
//     y alineable al hop exacto. Con la tabla de twiddles precomputada (Ola 0)
//     un MP3 de 4 min se analiza en unos cientos de ms en escritorio.
//
// Algoritmo (estándar de la literatura — "Spectral Flux", Dixon 2006):
//   1. Mix multi-canal a mono.
//   2. Por cada hop, ventana Hann sobre frame de N samples.
//   3. FFT real → magnitudes |X[k]|.
//   4. Flux[t] = Σ max(0, |X[k]|_t − |X[k]|_(t-1)) sobre todos los bins.
//   5. Normalizar el envelope (dividir por max).
//
// El resultado es un Float32Array de un valor por hop. Su sample rate
// efectivo es `audioBuffer.sampleRate / hopSize`.

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

/**
 * Cada cuántos hops se cede el hilo al event loop durante el análisis.
 *
 * Con el yield sin clamp (ver {@link yieldToEventLoop}) el coste por yield es
 * de microsegundos, así que 512 hops (~6 s de audio a 44.1 kHz) mantiene la
 * UI respondiendo sin penalizar. Debe ser potencia de 2: el loop comprueba
 * con una máscara de bits, no con un módulo.
 */
const DEFAULT_YIELD_EVERY = 512;

/**
 * Cede el hilo al event loop sin el clamp de 4 ms.
 *
 * `setTimeout(fn, 0)` anidado se clampa a 4 ms en todos los navegadores tras
 * 5 niveles de anidamiento (spec HTML, "timer nesting level"). Con ~70 yields
 * eso son ~280 ms de reloj de pared sin trabajo útil. `MessageChannel` no
 * está sujeto a ese clamp: la tarea se encola y se ejecuta en el siguiente
 * turno del event loop, que es exactamente lo que queremos (dejar respirar a
 * la UI, no dormir).
 *
 * Fallback a `setTimeout` donde no exista `MessageChannel` (entornos Node
 * antiguos o runtimes exóticos); en Node moderno sí existe.
 *
 * @returns {Promise<void>}
 */
function yieldToEventLoop() {
    if (typeof MessageChannel === 'undefined') {
        return new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(undefined);
    });
}

/**
 * @typedef {Object} OnsetEnvelopeResult
 * @property {Float32Array} envelope     Onset strength por hop (normalizado [0,1]).
 * @property {number}       sampleRate   Sample rate del envelope (= audioRate / hopSize).
 * @property {number}       hopSize      Hop size usado en samples.
 * @property {number}       frameSize    Frame size usado en samples.
 * @property {number}       latencyS     Adelanto sistemático del detector, en segundos.
 *                                       Sumarlo a los tiempos de onset los alinea con el
 *                                       ataque real (ver `detectorLatencyS`).
 */

/**
 * Calcula el envelope de onsets por Spectral Flux.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {{
 *   onProgress?: (ratio:number) => void,
 *   yieldEvery?: number,
 * }} [opts]  `yieldEvery` = cada cuántos hops se cede el hilo. 0 = nunca
 *            (úsalo en Web Worker o en Node, donde no hay UI que desbloquear).
 *            Por defecto {@link DEFAULT_YIELD_EVERY}.
 * @returns {Promise<OnsetEnvelopeResult>}
 */
export async function computeOnsetEnvelope(audioBuffer, opts = {}) {
    const sampleRate = audioBuffer.sampleRate;
    const mono = mixToMono(audioBuffer);
    const hann = makeHannWindow(FRAME_SIZE);

    const numHops = Math.max(0, Math.floor((mono.length - FRAME_SIZE) / HOP_SIZE) + 1);
    const envelope = new Float32Array(numHops);

    // Reusable FFT scratch — no allocations dentro del loop.
    const re = new Float32Array(FRAME_SIZE);
    const im = new Float32Array(FRAME_SIZE);
    const halfBins = FRAME_SIZE / 2;
    // Doble buffer alternado: en cada iteración leemos de `prevMag` y
    // escribimos en `curMag`, luego hacemos swap. Así evitamos allocar.
    let prevMag = new Float32Array(halfBins);
    let curMag = new Float32Array(halfBins);

    let maxFlux = 0;
    // Yield al event loop cada YIELD_EVERY hops para no congelar la UI durante
    // canciones largas. 0 = nunca ceder (Worker / Node).
    const yieldEvery = opts.yieldEvery ?? DEFAULT_YIELD_EVERY;
    const yieldMask = yieldEvery > 0 ? yieldEvery - 1 : 0;

    for (let h = 0; h < numHops; h++) {
        const offset = h * HOP_SIZE;
        for (let i = 0; i < FRAME_SIZE; i++) {
            re[i] = mono[offset + i] * hann[i];
            im[i] = 0;
        }
        fftRadix2(re, im);

        // Magnitudes (solo medio espectro — el resto es conjugado para
        // input real). Spectral Flux con half-wave rectification.
        let flux = 0;
        for (let k = 0; k < halfBins; k++) {
            const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            curMag[k] = mag;
            const diff = mag - prevMag[k];
            if (diff > 0) flux += diff;
        }
        envelope[h] = flux;
        if (flux > maxFlux) maxFlux = flux;

        // Swap: cur pasa a ser prev en la próxima iteración. El array que
        // era prev queda libre para sobrescribirse como nuevo cur.
        const tmp = prevMag;
        prevMag = curMag;
        curMag = tmp;

        if (yieldEvery > 0 && (h & yieldMask) === 0 && h > 0) {
            if (opts.onProgress) opts.onProgress(h / numHops);
            await yieldToEventLoop();
        }
    }

    // Normalizar a [0, 1] dividiendo por max.
    if (maxFlux > 0) {
        const inv = 1 / maxFlux;
        for (let i = 0; i < envelope.length; i++) envelope[i] *= inv;
    }

    if (opts.onProgress) opts.onProgress(1);

    // Yield final — cede al event loop para que la UI pinte el "Generando…"
    // si el caller lo necesita.
    if (yieldEvery > 0) await yieldToEventLoop();

    return {
        latencyS: detectorLatencyS(sampleRate),
        envelope,
        sampleRate: sampleRate / HOP_SIZE,
        hopSize: HOP_SIZE,
        frameSize: FRAME_SIZE,
    };
}

/**
 * Adelanto sistemático con el que el flujo espectral fecha un ataque.
 *
 * El envelope asigna a cada hop el instante de INICIO de su frame, pero con
 * ventana Hann la energía de un transitorio pesa al máximo cuando cae en el
 * CENTRO del frame. Resultado: cada onset queda fechado medio frame antes de
 * sonar. Medido sobre click tracks de 90, 128, 150 y 174 BPM: mediana de
 * −23.0 a −23.4 ms en todos, que es exactamente `FRAME_SIZE / 2 / sampleRate`
 * (23.2 ms a 44.1 kHz). Sin corregirlo, cada obstáculo llega ~23 ms antes que
 * su golpe — por debajo de lo evidente pero dentro de lo que se nota como
 * "ligeramente adelantado" en un juego de ritmo.
 *
 * @param {number} sampleRate
 */
export function detectorLatencyS(sampleRate) {
    return FRAME_SIZE / 2 / sampleRate;
}

/**
 * Picos locales del envelope por encima de la mediana móvil, con su fuerza (el
 * valor normalizado del envelope en el pico). El charter usa la fuerza para
 * decidir, ante dos onsets demasiado juntos, cuál conservar: el golpe fuerte en
 * vez del primero que llegue.
 *
 *   thresholdRatio  Multiplicador sobre la mediana móvil (default 1.5).
 *   windowSec       Ventana de la mediana móvil en segundos (default 0.4).
 *
 * Los tiempos NO incluyen la corrección de latencia: se devuelven en la misma
 * escala que el envelope para que este módulo siga siendo una función pura del
 * análisis. Quien los use como tiempos musicales debe sumar `env.latencyS`.
 *
 * @param {OnsetEnvelopeResult} env
 * @param {{ thresholdRatio?: number, windowSec?: number }} [opts]
 * @returns {Array<{ t: number, strength: number }>}
 */
export function pickOnsets(env, opts = {}) {
    const { envelope, sampleRate } = env;
    const thresholdRatio = opts.thresholdRatio ?? 1.5;
    const windowSec = opts.windowSec ?? 0.4;
    const halfWindow = Math.max(1, Math.round((windowSec / 2) * sampleRate));

    const onsets = [];
    const buf = new Float32Array(2 * halfWindow + 1);

    for (let i = 1; i < envelope.length - 1; i++) {
        const lo = Math.max(0, i - halfWindow);
        const hi = Math.min(envelope.length - 1, i + halfWindow);
        const n = hi - lo + 1;
        for (let j = 0; j < n; j++) buf[j] = envelope[lo + j];
        // `subarray` es una vista sobre `buf` (scratch reusable) y `sort()` de
        // TypedArray ordena in-place: sin copias por iteración.
        const median = buf.subarray(0, n).sort()[(n / 2) | 0];

        const v = envelope[i];
        if (v > median * thresholdRatio && v > envelope[i - 1] && v >= envelope[i + 1]) {
            onsets.push({ t: i / sampleRate, strength: v });
        }
    }
    return onsets;
}

/**
 * Tiempos de los onsets (sin fuerza). Se mantiene por compatibilidad; delega
 * en {@link pickOnsets} para que exista una sola implementación del detector.
 *
 * @param {OnsetEnvelopeResult} env
 * @param {{ thresholdRatio?: number, windowSec?: number }} [opts]
 * @returns {number[]}
 */
export function pickPeaks(env, opts = {}) {
    return pickOnsets(env, opts).map((o) => o.t);
}

// --------------------------- Helpers ---------------------------

/** Promedia todos los canales del buffer a un único Float32Array mono. */
function mixToMono(audioBuffer) {
    const ch = audioBuffer.numberOfChannels;
    const len = audioBuffer.length;
    if (ch === 1) return audioBuffer.getChannelData(0).slice();

    const out = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
        const data = audioBuffer.getChannelData(c);
        for (let i = 0; i < len; i++) out[i] += data[i];
    }
    const inv = 1 / ch;
    for (let i = 0; i < len; i++) out[i] *= inv;
    return out;
}

/** Ventana Hann de N puntos. Reduce leakage en el FFT. */
function makeHannWindow(n) {
    const w = new Float32Array(n);
    const k = (2 * Math.PI) / (n - 1);
    for (let i = 0; i < n; i++) {
        w[i] = 0.5 * (1 - Math.cos(i * k));
    }
    return w;
}

/**
 * Tablas de twiddle factors por tamaño de FFT, cacheadas a nivel de módulo.
 *
 * Por qué existe esto (Ola 0): la versión anterior llamaba a `Math.cos()` y
 * `Math.sin()` DENTRO del bucle interno de mariposas. El twiddle factor solo
 * depende de `(size, k)`, nunca del bloque `i`, así que se recalculaba una y
 * otra vez: ~22.500 llamadas trigonométricas por hop × ~18.000 hops =
 * **~407 millones** por canción de 3:30. Era el 93% del coste de todo el
 * análisis. Precomputarlo una vez da 3-10× sin cambiar un solo resultado.
 *
 * Layout: un único par de arrays planos por tamaño `n`, con las etapas
 * concatenadas. La etapa de `half = size/2` ocupa `[half - 1, 2*half - 1)`,
 * porque 1 + 2 + 4 + ... + n/2 = n - 1 entradas en total. El offset `half - 1`
 * sale de esa progresión geométrica y evita una tabla de offsets aparte.
 *
 * @type {Map<number, { cos: Float64Array, sin: Float64Array }>}
 */
const twiddleCache = new Map();

/**
 * Float64 (no Float32) a propósito: la precisión intermedia de la FFT afecta
 * al envelope, y la tabla se calcula una sola vez — el coste de memoria son
 * 32 KB para n=2048, irrelevante frente al determinismo numérico.
 *
 * @param {number} n  Tamaño de FFT (potencia de 2).
 */
function getTwiddles(n) {
    const cached = twiddleCache.get(n);
    if (cached !== undefined) return cached;

    const cos = new Float64Array(n - 1);
    const sin = new Float64Array(n - 1);
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = (-2 * Math.PI) / size;
        const base = half - 1;
        for (let k = 0; k < half; k++) {
            const angle = step * k;
            cos[base + k] = Math.cos(angle);
            sin[base + k] = Math.sin(angle);
        }
    }

    const table = { cos, sin };
    twiddleCache.set(n, table);
    return table;
}

/**
 * FFT Cooley-Tukey radix-2 iterativa, in-place. N debe ser potencia de 2.
 * Implementación estándar — sirve para magnitudes (no nos importa la fase).
 *
 * @param {Float32Array} re  Parte real (input/output).
 * @param {Float32Array} im  Parte imaginaria (input/output).
 */
function fftRadix2(re, im) {
    const n = re.length;
    if ((n & (n - 1)) !== 0) throw new Error(`FFT: n=${n} no es potencia de 2`);

    // Bit-reversal permutation.
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let tr = re[i]; re[i] = re[j]; re[j] = tr;
            tr = im[i]; im[i] = im[j]; im[j] = tr;
        }
    }

    // Cooley-Tukey butterflies con twiddles precomputados.
    const { cos: twCos, sin: twSin } = getTwiddles(n);
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const base = half - 1;
        for (let i = 0; i < n; i += size) {
            for (let k = 0; k < half; k++) {
                const wr = twCos[base + k];
                const wi = twSin[base + k];
                const ix = i + k;
                const jx = ix + half;
                const tre = re[jx] * wr - im[jx] * wi;
                const tim = re[jx] * wi + im[jx] * wr;
                re[jx] = re[ix] - tre;
                im[jx] = im[ix] - tim;
                re[ix] += tre;
                im[ix] += tim;
            }
        }
    }
}
