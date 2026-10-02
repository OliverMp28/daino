// El espectro de lo que suena, en barras (T03.2, doc 11).
//
// Del AnalyserNode salen 1024 bins lineales (21.5 Hz cada uno): casi toda la
// música vive en los primeros 250, y repartidos tal cual a lo ancho la mitad
// derecha de un ecualizador queda vacía (le pasaba al del shader hasta la T03.1).
// Aquí se agrupan en bandas LOGARÍTMICAS, como oye el oído: cada barra cubre el
// mismo intervalo musical.
//
// Los bytes del AnalyserNode van en decibelios y suavizados: una canción a todo
// volumen los deja casi todos arriba y quietos. Lo que se quiere ver es lo que se
// MUEVE. Por eso cada barra se mide contra sí misma: lleva su suelo (lo que suena
// de fondo en su banda, que sube despacio) y su techo (su pico reciente, que cae
// despacio), y enseña dónde está entre los dos. Un bombo levanta su barra aunque
// el bajo no pare de sonar; una nota sostenida se va aplanando.
//
//   - sube al instante y cae suave (un pico se ve aunque dure un fotograma);
//   - por debajo del suelo de ruido, nada: el silencio es plano.
//
// Lo usan todos los pintores del espectro (las barras tras la silueta, el mar por
// bandas, el suelo): un solo cálculo por fotograma.
//
// Puro: recibe los bytes y devuelve números. Se prueba en Node.

export const SPECTRUM_RULES = Object.freeze({
    bars: 24,
    minHz: 45,
    maxHz: 11000,
    /** Caída de una barra (1/s, exponencial). */
    release: 6,
    /** Nivel (0-1 del byte) por debajo del cual una banda es silencio, y en cuánto entra del todo. */
    gate: 0.16,
    gateSpan: 0.14,
    /** El suelo de cada barra sube hacia lo que suena así de despacio (1/s). */
    floorRise: 0.55,
    /** Su techo cae hacia el suelo así de despacio (1/s). */
    ceilFall: 0.3,
    /** Distancia mínima entre suelo y techo: por debajo, el ruido no se amplifica. */
    minSpan: 0.1,
    /** Curva de la barra: > 1 destaca los golpes. */
    shape: 1.5,
});

/**
 * Las barras que nacen de una silueta del paisaje (entities/scenery/SilhouetteSpectrum.js;
 * el guardián de legibilidad lee de aquí cuánto suben: scenes/backdrops.js).
 *   count     barras a lo ancho de la vista.
 *   fill      parte de su hueco que ocupa cada barra (el resto, separación).
 *   maxRise   cuánto sube una barra a tope sobre la silueta (unidades de mundo).
 *   alpha     opacidad en reposo y a tope (mezcla normal con un color ya limitado:
 *             fx/limiter.js `capColor`).
 *   dayTint   de día las barras son silueta (el color de las montañas): cuánto
 *             llevan del color del efecto [0,1].
 */
export const SPECTRUM_BARS = Object.freeze({ count: 36, fill: 0.68, maxRise: 104, alpha: Object.freeze([0.7, 1]), dayTint: 0.25 });

/**
 * @param {{ sampleRate?: number, bins?: number, rules?: typeof SPECTRUM_RULES }} [opts]
 *   `bins`: bins del AnalyserNode (fftSize / 2).
 */
export function createSpectrum(opts = {}) {
    const R = opts.rules ?? SPECTRUM_RULES;
    const sampleRate = opts.sampleRate ?? 44100;
    const bins = opts.bins ?? 1024;
    const hzPerBin = sampleRate / 2 / bins;
    const n = R.bars;

    /** Rango de bins de cada barra: [from, to). Al menos uno, sin solaparse. */
    const from = new Uint16Array(n);
    const to = new Uint16Array(n);
    const ratio = Math.pow(R.maxHz / R.minHz, 1 / n);
    let lo = R.minHz;
    for (let i = 0; i < n; i++) {
        const hi = lo * ratio;
        const a = Math.min(bins - 1, Math.max(1, Math.floor(lo / hzPerBin)));
        from[i] = i > 0 && a < to[i - 1] ? to[i - 1] : a;
        to[i] = Math.min(bins, Math.max(from[i] + 1, Math.ceil(hi / hzPerBin)));
        lo = hi;
    }

    const bars = new Float32Array(n);
    const floor = new Float32Array(n);
    const ceil = new Float32Array(n);

    return {
        /** Nivel de cada barra [0,1], de graves a agudos. El mismo array cada vez. */
        bars,
        count: n,

        /**
         * @param {ArrayLike<number>} bytes  `getByteFrequencyData` (0-255), `bins` valores.
         * @param {number} dt
         */
        update(bytes, dt) {
            const step = Math.max(0, dt);
            const decay = Math.exp(-step * R.release);
            const up = 1 - Math.exp(-step * R.floorRise);
            const down = 1 - Math.exp(-step * R.ceilFall);
            for (let i = 0; i < n; i++) {
                let sum = 0;
                for (let b = from[i]; b < to[i]; b++) sum += bytes[b];
                const v = sum / ((to[i] - from[i]) * 255);
                // Suelo: baja al instante, sube despacio. Techo: sube al instante, cae despacio.
                floor[i] = v < floor[i] ? v : floor[i] + (v - floor[i]) * up;
                ceil[i] = v > ceil[i] ? v : ceil[i] - (ceil[i] - floor[i]) * down;
                const rel = (v - floor[i]) / Math.max(ceil[i] - floor[i], R.minSpan);
                const g = (v - R.gate) / R.gateSpan;
                const gate = g <= 0 ? 0 : g >= 1 ? 1 : g;
                const shaped = Math.pow(rel <= 0 ? 0 : rel >= 1 ? 1 : rel, R.shape) * gate;
                bars[i] = shaped > bars[i] * decay ? shaped : bars[i] * decay;
            }
        },

        /**
         * Las barras agrupadas en `groups` bandas (media), de graves a agudos.
         * @param {number} groups
         * @param {Float32Array | number[]} out
         */
        groups(groups, out) {
            for (let g = 0; g < groups; g++) {
                const a = Math.floor((g * n) / groups);
                const b = Math.max(a + 1, Math.floor(((g + 1) * n) / groups));
                let sum = 0;
                for (let i = a; i < b; i++) sum += bars[i];
                out[g] = sum / (b - a);
            }
            return out;
        },

        /** Nivel en un punto `u` [0,1] a lo ancho (interpolado entre barras). */
        at(u) {
            const x = (u < 0 ? 0 : u > 1 ? 1 : u) * (n - 1);
            const i = Math.floor(x);
            const f = x - i;
            return i >= n - 1 ? bars[n - 1] : bars[i] + (bars[i + 1] - bars[i]) * f;
        },

        /** Silencio (fin de la partida). */
        reset() {
            bars.fill(0);
            floor.fill(0);
            ceil.fill(0);
        },

        /** Rango de bins de cada barra (tests). */
        ranges: () => Array.from({ length: n }, (_, i) => [from[i], to[i]]),
    };
}
