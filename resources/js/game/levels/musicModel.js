// Modelo musical — lo que el charter necesita saber de una canción, en una forma (Ola 5).
//
// El charter de la Ola 5 piensa como quien diseña un nivel a mano: en compases,
// pulsos y contratiempos, en tramos que suben y bajan, en golpes graves y
// agudos. Este módulo traduce el análisis a esos términos y es la ÚNICA pieza
// que conoce los formatos de análisis:
//
//   Formato 2 (servidor, Ola 4)  beats reales (beat_this), downbeats y compás,
//                                secciones, curva de energía y color de cada
//                                golpe. Se usa tal cual.
//   Formato 1 (navegador)        solo tempo y golpes. El pulso se reconstruye
//                                por programación dinámica sobre los golpes
//                                (ver `trackBeats`), el compás
//                                se deduce de dónde caen los acentos y la energía
//                                sale de la densidad de golpes. Menos rico, pero
//                                el charter funciona igual.
//
// Rejilla: cada beat tiene dos huecos donde puede ir una acción, EN el pulso y
// a CONTRATIEMPO (a mitad de beat, o donde caiga el swing si la canción lo
// tiene). Dos acciones seguidas nunca caben a una semicorchea (el salto dura
// 0.72 s), pero UNA acción sí puede caer en una: el bombo sincopado del hip-hop
// ("1 · 2e 2& · 3& · 4e") vive ahí. Medido en los oficiales: What's Up Danger
// tiene el 30 % de sus golpes fuertes en semicorcheas y Running With the Wolves
// el 38 %. Por eso cada compás lleva además `sixteenths`: los golpes reales que
// caen en la "e" y la "a" de cada beat, solo si la semicorchea dura lo bastante
// (SIXTEENTH_MIN_S) y la canción va recta (con swing no hay semicorcheas rectas).
//
// Función pura: mismo análisis ⇒ mismo modelo. Sin audio, sin DOM.

/** Por debajo de esta fuerza un onset no cuenta como golpe en la rejilla. */
const HIT_FLOOR = 0.12;

/** Un intervalo entre beats mayor que esto (× periodo típico) es un hueco sin pulso. */
const GAP_FACTOR = 1.8;

/** Semicorchea más corta que se considera (≤ 115 BPM): por debajo, el contratiempo ya basta. */
const SIXTEENTH_MIN_S = 0.13;

/**
 * @typedef {Object} GridSlot
 * @property {number} t          Instante de canción del hueco (el del golpe si lo hay).
 * @property {number} beat       Índice del beat.
 * @property {number} bar        Índice del compás.
 * @property {number} pos        Posición en el compás, en beats (0, 0.5, 1, …).
 * @property {boolean} onBeat    true en el pulso; false a contratiempo o en semicorchea.
 * @property {0|1|2|3} sub       Posición dentro del beat: 0 pulso, 1 "e", 2 contratiempo, 3 "a".
 * @property {boolean} chord     true si la armonía cambia en este pulso (acorde nuevo).
 * @property {number} metric     Peso métrico [0,1]: 1 el primer tiempo del compás.
 * @property {number} strength   Fuerza del golpe que cae en el hueco [0,1] (0 si ninguno).
 * @property {number} low        Reparto del golpe en graves, medios y agudos (suman 1).
 * @property {number} mid
 * @property {number} high
 */

/**
 * @typedef {Object} Bar
 * @property {number} index
 * @property {number} b0      Primer beat (incluido).
 * @property {number} b1      Último beat (excluido).
 * @property {number} t0
 * @property {number} t1
 * @property {number} beats   b1 − b0.
 * @property {GridSlot[]} slots  En orden temporal: pulso, contratiempo, pulso…
 * @property {GridSlot[]} sixteenths  Golpes reales en semicorchea ("e" y "a"), en orden; vacío si no aplica.
 */

/**
 * @param {object} analysis  Análisis de formato 1 o 2 (ver analyze.js / analyzer/).
 */
export function buildMusicModel(analysis) {
    const durationSec = analysis.durationSec;
    const bpm = analysis.bpm > 0 ? analysis.bpm : 120;
    const nominalPeriod = analysis.beatPeriodS > 0 ? analysis.beatPeriodS : 60 / bpm;

    const onsets = readOnsets(analysis);

    const realBeats = Array.isArray(analysis.beats) && analysis.beats.length >= 8;
    const beats = realBeats
        ? Float64Array.from(analysis.beats)
        : trackBeats(onsets, nominalPeriod, durationSec);
    const period = medianInterval(beats, nominalPeriod);

    const meter = Number.isInteger(analysis.meter) && analysis.meter >= 2 && analysis.meter <= 12
        ? analysis.meter
        : 4;
    const isDownbeat = realBeats && Array.isArray(analysis.downbeats) && analysis.downbeats.length > 0
        ? markDownbeats(beats, analysis.downbeats)
        : inferDownbeats(beats, onsets, meter);

    const energy = readEnergy(analysis, onsets, durationSec);
    const swing = detectSwing(beats, onsets, period);
    const bars = buildBars(beats, isDownbeat, period, meter, durationSec);
    const sixteenths = swing === 0.5 && period / 4 >= SIXTEENTH_MIN_S;
    for (const bar of bars) {
        bar.slots = buildSlots(bar, beats, isDownbeat, onsets, period, swing, meter);
        bar.sixteenths = sixteenths ? buildSixteenths(bar, beats, onsets, period) : [];
    }

    const sections = readSections(analysis, durationSec, energy);
    const bands = readBands(analysis);
    const tonal = readTonal(analysis, durationSec);
    markChordChanges(bars, tonal);
    const melody = readMelody(analysis);

    return {
        formatVersion: analysis.formatVersion,
        durationSec,
        bpm,
        beatPeriodS: period,
        beats,
        realBeats,
        isDownbeat,
        meter,
        swing,
        bars,
        onsets,
        sections,
        features: analysis.features ?? null,
        /** Energía relativa media en [t0, t1), [0,1]. */
        energyMean: (t0, t1) => meanOver(energy, t0, t1),
        /** Suma de fuerzas de golpe en [t0, t1). */
        activity: (t0, t1) => strengthSum(onsets, t0, t1),
        // Carácter del sonido (Ola 6b: dónde encaja cada modo). Todo es null o
        // vacío si el análisis no lo trae (formato 1, analizador 1).
        /** Percusividad media de los golpes de [t0, t1), ponderada por fuerza: >0.5 batería, <0.5 notas. null sin dato. */
        percussiveness: (t0, t1) => weightedPercussive(onsets, t0, t1),
        /**
         * Nivel de graves, medios y agudos de la canción ENTERA respecto a la mezcla,
         * en dB (analizador 2): comparable entre canciones, al contrario que las
         * curvas relativas de `bandsMean`. null sin dato (T02.5).
         */
        bandLevelDb: readBandLevels(analysis),
        /** Nivel medio de graves, medios y agudos en [t0, t1), relativos [0,1]. null sin dato. */
        bandsMean: (t0, t1) => (bands === null ? null : {
            low: meanOver(bands.low, t0, t1),
            mid: meanOver(bands.mid, t0, t1),
            high: meanOver(bands.high, t0, t1),
        }),
        /**
         * Tonalidad global (con su confianza), acordes por beat, cambios de acorde
         * por compás y modulaciones (null sin análisis tonal).
         */
        tonal,
        /** Cambios de acorde por segundo en [t0, t1) (null sin acordes). */
        chordChangeRate: (t0, t1) => chordChangeRate(tonal, t0, t1),
        // Melodía (analizador 3, Ola 6c): la altura que canta la canción. null sin dato.
        /** Contorno melódico: `{ hopSec, pitch }` (MIDI por fotograma, 0 sin melodía), o null. */
        melody,
        /** Mediana de la altura de la melodía en [t0, t1) (MIDI), o null si ahí no suena. */
        melodyAt: (t0, t1) => melodyMedian(melody, t0, t1),
        /** Registro de la melodía en [t0, t1): percentiles 10 y 90 y fracción de fotogramas con melodía. */
        melodyRange: (t0, t1) => melodyRange(melody, t0, t1),
    };
}

// --------------------------- Onsets ---------------------------

function readOnsets(analysis) {
    const raw = Array.isArray(analysis.onsets) ? analysis.onsets : [];
    const colors = Array.isArray(analysis.onsetColor) && analysis.onsetColor.length === raw.length
        ? analysis.onsetColor
        : null;
    const n = raw.length;
    const perc = Array.isArray(analysis.onsetPercussive) && analysis.onsetPercussive.length === n
        ? Float32Array.from(analysis.onsetPercussive, (v) => (Number.isFinite(v) ? v : 0.5))
        : null;
    const t = new Float64Array(n);
    const s = new Float32Array(n);
    const low = new Float32Array(n);
    const mid = new Float32Array(n);
    const high = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        t[i] = raw[i][0];
        s[i] = raw[i][1];
        const c = colors?.[i];
        if (Array.isArray(c) && c.length === 3) {
            low[i] = c[0];
            mid[i] = c[1];
            high[i] = c[2];
        } else {
            low[i] = mid[i] = high[i] = 1 / 3;
        }
    }
    return { t, s, low, mid, high, perc, count: n, hasColor: colors !== null };
}

/** Primer índice con t[i] ≥ value. */
export function lowerBound(arr, value, from = 0, to = arr.length) {
    let lo = from;
    let hi = to;
    while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (arr[m] < value) lo = m + 1;
        else hi = m;
    }
    return lo;
}

/**
 * Onset más relevante para un hueco: fuerza penalizada por la distancia.
 * @returns {number} índice o −1
 */
function bestOnsetNear(onsets, t, window) {
    let best = -1;
    let bestScore = 0;
    for (let i = lowerBound(onsets.t, t - window); i < onsets.count && onsets.t[i] <= t + window; i++) {
        if (onsets.s[i] < HIT_FLOOR) continue;
        const score = onsets.s[i] * (1 - 0.5 * Math.abs(onsets.t[i] - t) / window);
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return best;
}

function strengthSum(onsets, t0, t1) {
    let sum = 0;
    for (let i = lowerBound(onsets.t, t0); i < onsets.count && onsets.t[i] < t1; i++) {
        if (onsets.s[i] >= HIT_FLOOR) sum += onsets.s[i];
    }
    return sum;
}

// --------------------------- Pulso ---------------------------

function medianInterval(beats, fallback) {
    if (beats.length < 2) return fallback;
    const d = [];
    for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
    d.sort((a, b) => a - b);
    // Mediana de los intervalos "normales": los huecos sin pulso la sesgarían.
    const m = d[Math.floor(d.length / 2)];
    return m > 0 ? m : fallback;
}

/** Fotogramas por segundo de la envolvente del seguidor de beats. */
const TRACK_FPS = 100;

/** Rigidez del tempo (la de librosa): cuánto cuesta alejarse del periodo. */
const TRACK_TIGHTNESS = 100;

/**
 * Pulso reconstruido a partir de los golpes (análisis de formato 1).
 *
 * Seguimiento por programación dinámica (Ellis, "Beat Tracking by Dynamic
 * Programming", 2007; es `librosa.beat.beat_track`): elige la secuencia de
 * beats que maximiza la fuerza de los golpes donde cae cada beat menos una
 * penalización logarítmica por alejarse del periodo. Mira la canción ENTERA,
 * así que un tramo sin golpes no descoloca el pulso: se une por el camino más
 * coherente con lo que hay antes y después.
 *
 * Probado antes un bucle de fase (predecir y corregir hacia el golpe más
 * cercano): en canciones suaves perdía el pulso en cuanto faltaban golpes
 * (Dawn of Faith: 34 % de beats sobre los del servidor). La programación
 * dinámica es el método de referencia para exactamente este caso.
 *
 * El formato 1 solo trae onsets discretos: la envolvente se reconstruye
 * poniendo cada fuerza en su fotograma y suavizando.
 */
export function trackBeats(onsets, period, durationSec) {
    const p0 = period > 0 ? period : 0.5;
    if (!(durationSec > p0 * 4) || onsets.count === 0) {
        const out = [];
        for (let t = 0; t <= durationSec; t += p0) out.push(t);
        return Float64Array.from(out.length > 0 ? out : [0]);
    }

    const n = Math.ceil(durationSec * TRACK_FPS) + 1;
    const env = new Float64Array(n);
    for (let i = 0; i < onsets.count; i++) {
        const k = Math.round(onsets.t[i] * TRACK_FPS);
        if (k >= 0 && k < n) env[k] = Math.max(env[k], onsets.s[i]);
    }

    // Puntuación local: envolvente normalizada por su desviación y convolución
    // con una gaussiana de un periodo (como librosa).
    const fpb = p0 * TRACK_FPS;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env[i];
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (env[i] - mean) ** 2;
    const std = Math.sqrt(variance / n) || 1;
    const half = Math.round(fpb);
    const kernel = new Float64Array(2 * half + 1);
    for (let j = -half; j <= half; j++) kernel[j + half] = Math.exp(-0.5 * ((j * 32) / fpb) ** 2);
    const local = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        if (env[i] === 0) continue;
        const v = env[i] / std;
        for (let j = -half; j <= half; j++) {
            const k = i + j;
            if (k >= 0 && k < n) local[k] += v * kernel[j + half];
        }
    }

    // Programación dinámica: para cada fotograma, el mejor beat anterior entre
    // 0.5 y 2 periodos atrás.
    const from = -2 * Math.round(fpb);
    const to = -Math.round(fpb / 2);
    const weights = new Float64Array(to - from + 1);
    for (let j = 0; j < weights.length; j++) weights[j] = -TRACK_TIGHTNESS * Math.log(-(from + j) / fpb) ** 2;
    const cum = new Float64Array(n);
    const back = new Int32Array(n).fill(-1);
    let maxLocal = 0;
    for (let i = 0; i < n; i++) maxLocal = Math.max(maxLocal, local[i]);
    let firstBeat = true;
    for (let i = 0; i < n; i++) {
        let best = -Infinity;
        let bestK = -1;
        for (let j = 0; j < weights.length; j++) {
            const k = i + from + j;
            if (k < 0) continue;
            const c = weights[j] + cum[k];
            if (c > best) {
                best = c;
                bestK = k;
            }
        }
        cum[i] = local[i] + (bestK >= 0 ? best : 0);
        if (firstBeat && local[i] < 0.01 * maxLocal) {
            back[i] = -1;
        } else {
            back[i] = bestK;
            firstBeat = false;
        }
    }

    // Último beat: el último máximo local por encima de la mitad de la mediana.
    const maxima = [];
    for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(cum[i]);
    maxima.sort((a, b) => a - b);
    const medianMax = maxima.length > 0 ? maxima[Math.floor(maxima.length / 2)] : 0;
    let last = n - 1;
    for (let i = n - 2; i > 0; i--) {
        if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1] && 2 * cum[i] > medianMax) {
            last = i;
            break;
        }
    }
    const frames = [];
    for (let i = last; i >= 0; i = back[i]) frames.push(i);
    frames.reverse();

    // Recorte: fuera los beats de los extremos sin golpe cerca (silencio inicial
    // o final), como `trim` en librosa.
    let rms = 0;
    for (const f of frames) rms += local[f] ** 2;
    const threshold = 0.5 * Math.sqrt(rms / Math.max(1, frames.length));
    let a = 0;
    let b = frames.length;
    while (a < b && local[frames[a]] <= threshold) a++;
    while (b > a && local[frames[b - 1]] <= threshold) b--;
    const kept = frames.slice(a, b);
    const beats = Array.from(kept.length >= 2 ? kept : frames, (f) => f / TRACK_FPS);

    // Afinado al ataque real (la rejilla de 10 ms y el suavizado desplazan unos
    // ms): como hace el analizador del servidor con beat_this.
    for (let i = 0; i < beats.length; i++) {
        const j = bestOnsetNear(onsets, beats[i], 0.035);
        if (j < 0 || onsets.s[j] < 0.2) continue;
        const t = onsets.t[j];
        if ((i === 0 || t > beats[i - 1] + p0 * 0.25) && (i === beats.length - 1 || t < beats[i + 1] - p0 * 0.25)) beats[i] = t;
    }
    return Float64Array.from(beats);
}

function markDownbeats(beats, downbeats) {
    const flags = new Uint8Array(beats.length);
    let j = 0;
    for (const d of downbeats) {
        while (j < beats.length && beats[j] < d - 1e-6) j++;
        if (j < beats.length && Math.abs(beats[j] - d) < 0.0015) flags[j] = 1;
    }
    return flags;
}

/** Compás deducido: la fase cuyos beats concentran más fuerza de golpe. */
function inferDownbeats(beats, onsets, meter) {
    const sums = new Array(meter).fill(0);
    const w = 0.06;
    for (let i = 0; i < beats.length; i++) {
        const j = bestOnsetNear(onsets, beats[i], w);
        if (j >= 0) sums[i % meter] += onsets.s[j] * (0.5 + onsets.low[j]);
    }
    let phase = 0;
    for (let k = 1; k < meter; k++) if (sums[k] > sums[phase] + 1e-9) phase = k;
    const flags = new Uint8Array(beats.length);
    for (let i = phase; i < beats.length; i += meter) flags[i] = 1;
    return flags;
}

/**
 * ¿Dónde cae el contratiempo? 0.5 en música "recta"; en torno a 0.62-0.70 con
 * swing (shuffle). Se decide con los golpes que caen entre dos beats.
 */
function detectSwing(beats, onsets, period) {
    let straight = 0;
    let swung = 0;
    const swungPhases = [];
    for (let i = 0; i + 1 < beats.length; i++) {
        const span = beats[i + 1] - beats[i];
        if (span > period * GAP_FACTOR) continue;
        let best = -1;
        for (let j = lowerBound(onsets.t, beats[i] + span * 0.3); j < onsets.count && onsets.t[j] < beats[i] + span * 0.8; j++) {
            if (onsets.s[j] >= 0.2 && (best < 0 || onsets.s[j] > onsets.s[best])) best = j;
        }
        if (best < 0) continue;
        const phase = (onsets.t[best] - beats[i]) / span;
        if (Math.abs(phase - 0.5) < 0.06) straight += onsets.s[best];
        else if (Math.abs(phase - 0.667) < 0.07) {
            swung += onsets.s[best];
            swungPhases.push(phase);
        }
    }
    if (swungPhases.length >= 16 && swung > straight * 1.5) {
        swungPhases.sort((a, b) => a - b);
        return swungPhases[Math.floor(swungPhases.length / 2)];
    }
    return 0.5;
}

// --------------------------- Compases y rejilla ---------------------------

function buildBars(beats, isDownbeat, period, meter, durationSec) {
    const n = beats.length;
    const starts = [];
    for (let i = 0; i < n; i++) {
        const gapBefore = i > 0 && beats[i] - beats[i - 1] > period * GAP_FACTOR;
        if (i === 0 || isDownbeat[i] === 1 || gapBefore) starts.push(i);
    }
    const bars = [];
    for (let k = 0; k < starts.length; k++) {
        const b1 = k + 1 < starts.length ? starts[k + 1] : n;
        // Un tramo anómalamente largo sin downbeats (el seguidor no los marcó,
        // o tras un hueco) se parte en compases del tamaño del de la canción.
        // Hasta compás y medio se deja entero: beat_this da a veces compases
        // de 5 o 6 beats en cambios de frase, y partirlos crearía uno de 1-2.
        for (let s = starts[k]; s < b1;) {
            const e = b1 - s > meter * 1.5 ? s + meter : b1;
            const last = e - 1;
            const nextT = e < n ? beats[e] : Math.min(durationSec, beats[last] + period);
            const t1 = nextT - beats[last] > period * GAP_FACTOR ? beats[last] + period : nextT;
            bars.push({ index: bars.length, b0: s, b1: e, t0: beats[s], t1, beats: e - s, slots: [] });
            s = e;
        }
    }
    return mergeShortBars(bars, meter);
}

/**
 * Funde compases de 1-2 beats con el siguiente.
 *
 * Medido en los temas reales: el seguidor de downbeats cambia a veces de nivel
 * a mitad de canción (Dawn of Faith pasa de compases de 3 a tiradas de 2; Time
 * y Running With the Wolves intercalan "2 2" y "3 1" entre compases de 4). Para
 * la jugabilidad un compás es una unidad de frase, y una de 1-2 beats partiría
 * patrones y densidades a la mitad. Fundidos, "2 2" vuelve a ser un compás de
 * 4 y "3 1" también; el primer tiempo de la segunda mitad conserva su acento.
 */
function mergeShortBars(bars, meter) {
    const limit = Math.max(4, meter + 1);
    const out = [];
    for (const bar of bars) {
        const prev = out[out.length - 1];
        // Contiguos: un hueco sin pulso entre ambos separa frases de verdad.
        const contiguous = prev !== undefined && prev.b1 === bar.b0 && Math.abs(prev.t1 - bar.t0) < 1e-6;
        const fits = contiguous && prev.beats + bar.beats <= limit;
        // Un compás corto se une al anterior; si el corto es el anterior, este
        // se le une. La anacrusa inicial no se alarga más allá del compás.
        const mergeable = fits && (bar.beats <= 2 || (prev.beats <= 2 && !(out.length === 1 && prev.beats + bar.beats > meter)));
        if (mergeable) {
            prev.b1 = bar.b1;
            prev.t1 = bar.t1;
            prev.beats += bar.beats;
            continue;
        }
        out.push({ ...bar, index: out.length });
    }
    return out;
}

function buildSlots(bar, beats, isDownbeat, onsets, period, swing, meter) {
    const slots = [];
    for (let i = bar.b0; i < bar.b1; i++) {
        const nextRaw = i + 1 < beats.length ? beats[i + 1] : beats[i] + period;
        const span = nextRaw - beats[i] > period * GAP_FACTOR ? period : nextRaw - beats[i];
        const posBeats = i - bar.b0;

        // Peso métrico: primer tiempo > tiempo fuerte de la mitad del compás >
        // backbeat (2 y 4 en 4/4, donde suele ir la caja) > resto de pulsos >
        // contratiempos.
        let metric = 0.6;
        if (isDownbeat[i] === 1 || posBeats === 0) metric = 1;
        else if (meter % 2 === 0 && posBeats === meter / 2) metric = 0.8;
        else if (meter === 4 && posBeats % 2 === 1) metric = 0.7;

        slots.push(makeSlot(beats[i], true, i, bar.index, posBeats, metric, onsets, Math.min(0.05, span * 0.15), beats[i]));
        slots.push(makeSlot(beats[i] + span * swing, false, i, bar.index, posBeats + 0.5, 0.35, onsets, Math.min(0.06, span * 0.18), null));
    }
    return slots;
}

/**
 * Semicorcheas con golpe: la "e" y la "a" de cada beat, en el instante del golpe
 * real. Ventana estrecha (≤ 40 ms): nunca se solapa con la del pulso ni con la
 * del contratiempo, así que un golpe no ocupa dos huecos.
 */
function buildSixteenths(bar, beats, onsets, period) {
    const out = [];
    for (let i = bar.b0; i < bar.b1; i++) {
        const nextRaw = i + 1 < beats.length ? beats[i + 1] : beats[i] + period;
        const span = nextRaw - beats[i] > period * GAP_FACTOR ? period : nextRaw - beats[i];
        const window = Math.min(0.04, span * 0.08);
        for (const [sub, frac] of [[1, 0.25], [3, 0.75]]) {
            const slot = makeSlot(beats[i] + span * frac, false, i, bar.index, i - bar.b0 + frac, 0.2, onsets, window, null, sub);
            if (slot.strength > 0) out.push(slot);
        }
    }
    return out;
}

/** Marca los pulsos donde cambia el acorde (analizador 2; nada sin análisis tonal). */
function markChordChanges(bars, tonal) {
    if (tonal === null || tonal.chords.length < 2) return;
    const changes = [];
    for (let i = 1; i < tonal.chords.length; i++) {
        if (tonal.chords[i][1] !== tonal.chords[i - 1][1]) changes.push(tonal.chords[i][0]);
    }
    let k = 0;
    for (const bar of bars) {
        for (const slot of bar.slots) {
            if (!slot.onBeat) continue;
            while (k < changes.length && changes[k] < slot.t - 0.08) k++;
            if (k < changes.length && Math.abs(changes[k] - slot.t) <= 0.08) slot.chord = true;
        }
    }
}

function makeSlot(t, onBeat, beat, bar, pos, metric, onsets, window, anchorT, sub = onBeat ? 0 : 2) {
    const j = bestOnsetNear(onsets, t, window);
    const slot = { t, beat, bar, pos, onBeat, sub, chord: false, metric, strength: 0, low: 1 / 3, mid: 1 / 3, high: 1 / 3 };
    if (j >= 0) {
        slot.strength = onsets.s[j];
        slot.low = onsets.low[j];
        slot.mid = onsets.mid[j];
        slot.high = onsets.high[j];
        // En el pulso manda el beat (el seguidor ya lo afinó al ataque); a
        // contratiempo, el golpe real: el swing y la síncopa no son exactos.
        slot.t = anchorT ?? onsets.t[j];
    }
    return slot;
}

// --------------------------- Energía y secciones ---------------------------

function readEnergy(analysis, onsets, durationSec) {
    const e = analysis.energy;
    if (e !== null && typeof e === 'object' && e.hopSec > 0 && Array.isArray(e.values) && e.values.length > 0) {
        return { hopSec: e.hopSec, values: Float32Array.from(e.values) };
    }
    // Sin curva de energía (formato 1): densidad de golpes suavizada en ±1 s,
    // normalizada a su percentil 95. Distingue un estribillo lleno de una
    // estrofa desnuda, que es lo que el arco necesita.
    const hop = 0.1;
    const n = Math.max(1, Math.ceil(durationSec / hop));
    const values = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const c = (k + 0.5) * hop;
        values[k] = strengthSum(onsets, c - 1, c + 1);
    }
    const sorted = Float32Array.from(values).sort();
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
    for (let k = 0; k < n; k++) values[k] = Math.min(1, values[k] / p95);
    return { hopSec: hop, values };
}

function meanOver(energy, t0, t1) {
    const { hopSec, values } = energy;
    const i0 = clamp(Math.floor(t0 / hopSec), 0, values.length - 1);
    const i1 = clamp(Math.ceil(t1 / hopSec), i0 + 1, values.length);
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += values[i];
    return sum / (i1 - i0);
}

function readSections(analysis, durationSec, energy) {
    const raw = Array.isArray(analysis.sections) ? analysis.sections : [];
    const out = [];
    for (const s of raw) {
        if (!Number.isFinite(s?.startSec) || !Number.isFinite(s?.endSec) || s.endSec <= s.startSec) continue;
        out.push({
            start: s.startSec,
            end: s.endSec,
            cluster: typeof s.cluster === 'string' ? s.cluster : 'A',
            role: typeof s.role === 'string' ? s.role : 'verse',
            energy: Number.isFinite(s.energy) ? s.energy : meanOver(energy, s.startSec, s.endSec),
            key: typeof s.key === 'string' ? s.key : null,
        });
    }
    if (out.length === 0) {
        out.push({ start: 0, end: durationSec, cluster: 'A', role: 'verse', energy: meanOver(energy, 0, durationSec), key: null });
    }
    return out;
}

function weightedPercussive(onsets, t0, t1) {
    if (onsets.perc === null) return null;
    let ws = 0;
    let wp = 0;
    for (let i = lowerBound(onsets.t, t0); i < onsets.count && onsets.t[i] < t1; i++) {
        if (onsets.s[i] < HIT_FLOOR) continue;
        ws += onsets.s[i];
        wp += onsets.s[i] * onsets.perc[i];
    }
    return ws > 0 ? wp / ws : null;
}

/** Curvas de graves/medios/agudos del analizador 2, con la forma de `readEnergy`. */
function readBands(analysis) {
    const e = analysis.energy;
    const b = e?.bands;
    if (b === null || typeof b !== 'object' || !(e.hopSec > 0)) return null;
    const curves = {};
    for (const name of ['low', 'mid', 'high']) {
        if (!Array.isArray(b[name]) || b[name].length === 0) return null;
        curves[name] = { hopSec: e.hopSec, values: Float32Array.from(b[name]) };
    }
    return curves;
}

function readTonal(analysis, durationSec) {
    const t = analysis.tonal;
    if (t === null || typeof t !== 'object') return null;
    const chords = Array.isArray(t.chords)
        ? t.chords.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && c[0] <= durationSec && typeof c[1] === 'string')
        : [];
    const modulations = Array.isArray(t.modulations)
        ? t.modulations.filter((m) => Number.isFinite(m?.t) && typeof m.key === 'string')
        : [];
    return {
        key: typeof t.key === 'string' ? t.key : null,
        keyConfidence: Number.isFinite(t.keyConfidence) ? t.keyConfidence : 0,
        chordConfidence: Number.isFinite(t.chordConfidence) ? t.chordConfidence : 0,
        /** Cambios de acorde por compás, donde hay acordes (null sin dato). */
        harmonicRhythm: Number.isFinite(t.harmonicRhythm) ? t.harmonicRhythm : null,
        chords,
        modulations,
    };
}

/** `energy.bandLevelDb` del analizador 2 como `{ low, mid, high }`, o null. */
function readBandLevels(analysis) {
    const v = analysis.energy?.bandLevelDb;
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return null;
    return { low: v[0], mid: v[1], high: v[2] };
}

/** Contorno melódico del análisis, o null si no lo trae (analizadores 1-2, navegador). */
function readMelody(analysis) {
    const m = analysis.melody;
    if (m === null || typeof m !== 'object' || !(m.hopSec > 0) || !Array.isArray(m.pitch) || m.pitch.length === 0) return null;
    const pitch = Float32Array.from(m.pitch, (v) => (Number.isFinite(v) && v > 0 ? v : 0));
    return { hopSec: m.hopSec, pitch };
}

function melodyFrames(melody, t0, t1) {
    const i0 = Math.max(0, Math.floor(t0 / melody.hopSec));
    const i1 = Math.min(melody.pitch.length, Math.max(i0 + 1, Math.ceil(t1 / melody.hopSec)));
    const voiced = [];
    for (let i = i0; i < i1; i++) if (melody.pitch[i] > 0) voiced.push(melody.pitch[i]);
    return { voiced, total: Math.max(1, i1 - i0) };
}

function melodyMedian(melody, t0, t1) {
    if (melody === null || !(t1 > t0)) return null;
    const { voiced } = melodyFrames(melody, t0, t1);
    if (voiced.length === 0) return null;
    voiced.sort((a, b) => a - b);
    return voiced[voiced.length >> 1];
}

function melodyRange(melody, t0, t1) {
    if (melody === null || !(t1 > t0)) return null;
    const { voiced, total } = melodyFrames(melody, t0, t1);
    if (voiced.length === 0) return { low: null, high: null, voiced: 0 };
    voiced.sort((a, b) => a - b);
    return {
        low: voiced[Math.floor(voiced.length * 0.1)],
        high: voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * 0.9))],
        voiced: voiced.length / total,
    };
}

function chordChangeRate(tonal, t0, t1) {
    if (tonal === null || tonal.chords.length === 0 || !(t1 > t0)) return null;
    let changes = 0;
    let prev = null;
    for (const [t, label] of tonal.chords) {
        if (t >= t1) break;
        if (t >= t0 && prev !== null && label !== prev) changes++;
        prev = label;
    }
    return changes / (t1 - t0);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
