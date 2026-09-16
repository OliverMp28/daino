// Carácter de cada tramo de la canción — cómo suena y cuánto se distingue del resto (Ola 6b).
//
// Tras jugar la Ola 6a: los modos de movimiento aparecían donde volvía el
// estribillo, tres veces en un tema largo, y se sentían repetitivos. Lo que se
// pidió es que un modo sea un EVENTO en el momento de la canción que suena
// distinto: un puente, un tramo pasivo, uno épico; que cada canción, con sus
// sonidos, decida si tiene ese momento y cuál es.
//
// Para cada tramo del arco (songArc.js) se mide:
//
//   contrast   [0,1] cuánto se aparta del sonido TÍPICO de la canción: energía,
//              densidad de golpes, percusividad, graves/medios/agudos y ritmo
//              armónico, cada uno frente a la mediana de la canción y en su
//              escala; más si su material no se repite, si es un puente o break
//              y si cambia de tonalidad.
//   arrival    [0,1] cuánto sube o se vacía la canción al empezar el tramo: la
//              mayor de las subidas de energía y de plenitud (graves, medios y
//              agudos) de su frontera (songChanges.js). Es lo que se oye al
//              llegar. Tras el playtest de la 6b: el final de What's Up Danger
//              entra con el golpe más fuerte del tema (energía +0.50) pero suena
//              como sus estrofas fuertes (contraste con lo típico 0.30), y el
//              modo se lo llevaba un tramo menor. Un cambio de textura sin
//              cambio de volumen (Mi Fiesta, +0.06) no es una llegada.
//   rises      si al llegar el sonido se llena (un drop, un estribillo que
//              revienta) o se vacía (un break, un pasaje sin bajo ni batería).
//   passive    [0,1] más tranquilo que lo típico.
//   epic       [0,1] más intenso que lo típico (1 en el clímax).
//   sustain    [0,1] notas que se sostienen: pocos golpes y poco percusivos.
//   rhythmic   [0,1] golpes marcados: densos y percusivos.
//
// Con análisis del navegador (formato 1) faltan percusividad, bandas y
// armonía: se usa lo que hay y el contraste sale más bajo (menos momentos).
//
// Puro: mismo análisis ⇒ mismo carácter.

/** Escala mínima de cada rasgo: diferencias por debajo de esto no son contraste. */
const FLOORS = Object.freeze({ energy: 0.08, density: 0.3, perc: 0.1, low: 0.1, mid: 0.08, high: 0.1, chords: 0.06 });

/** Peso de cada rasgo en el contraste. Los graves pesan: un puente sin bajo se oye enseguida. */
const WEIGHTS = Object.freeze({ energy: 1, density: 1, perc: 1, low: 1, mid: 0.5, high: 0.7, chords: 0.6 });

export const CHARACTER_RULES = Object.freeze({
    /** Multiplica el contraste medio de los rasgos (un tramo típico ronda 0.1-0.25). */
    contrastGain: 1.5,
    /**
     * Subida (o vaciado) de energía o plenitud con la que la llegada vale 1.
     * Medido: ±0.35-0.5 es un cambio que nadie pasa por alto (el break de Dawn
     * of Faith a las 1:28.8, la vuelta del bajo a las 1:49.6, el final de What's
     * Up Danger); +0.2, uno claro pero suave (Time 1:15.2).
     */
    arrivalFull: 0.35,
    /** Material que solo suena una vez en la canción. */
    rareBonus: 0.12,
    /** Tramo que el análisis reconoce como puente o break. */
    bridgeBonus: 0.12,
    /** Tramo en otra tonalidad (o con una modulación dentro). */
    keyBonus: 0.15,
});

/**
 * @typedef {Object} SegmentCharacter
 * @property {number} index     Índice del tramo en el arco.
 * @property {number} contrast
 * @property {number} arrival
 * @property {boolean} rises
 * @property {number} passive
 * @property {number} epic
 * @property {number} sustain
 * @property {number} rhythmic
 * @property {number} density   Densidad de golpes relativa a la típica (1 = típica).
 * @property {{ rare: boolean, bridge: boolean, keyChange: boolean }} traits
 */

/**
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} model
 * @param {ReturnType<import('./songArc.js').buildSongArc>} arc
 * @returns {SegmentCharacter[]}  Uno por tramo, en el orden del arco.
 */
export function describeSegments(model, arc) {
    const segs = arc.segments;
    if (segs.length === 0) return [];

    const raw = segs.map((s) => {
        const dur = Math.max(1e-3, s.t1 - s.t0);
        const bands = model.bandsMean(s.t0, s.t1);
        return {
            weight: dur,
            energy: model.energyMean(s.t0, s.t1),
            density: Math.log(0.05 + model.activity(s.t0, s.t1) / dur),
            densityLinear: model.activity(s.t0, s.t1) / dur,
            perc: model.percussiveness(s.t0, s.t1),
            low: bands?.low ?? null,
            mid: bands?.mid ?? null,
            high: bands?.high ?? null,
            chords: model.chordChangeRate(s.t0, s.t1),
        };
    });

    // Lo típico de la canción: mediana ponderada por duración y dispersión (MAD).
    const typical = {};
    for (const key of Object.keys(WEIGHTS)) {
        const values = [];
        const weights = [];
        raw.forEach((r) => {
            if (r[key] !== null && Number.isFinite(r[key])) {
                values.push(r[key]);
                weights.push(r.weight);
            }
        });
        if (values.length < 2) continue;
        const median = weightedPercentile(values, weights, 0.5);
        const mad = weightedPercentile(values.map((v) => Math.abs(v - median)), weights, 0.5);
        typical[key] = { median, scale: Math.max(FLOORS[key], mad * 1.4826) };
    }
    const typicalDensity = weightedPercentile(raw.map((r) => r.densityLinear), raw.map((r) => r.weight), 0.5) || 1;
    const medEnergy = typical.energy?.median ?? 0.5;

    const clusterCount = new Map();
    for (const sec of model.sections) clusterCount.set(sec.cluster, (clusterCount.get(sec.cluster) ?? 0) + 1);
    const globalKey = model.tonal?.key ?? null;

    return segs.map((s, i) => {
        const r = raw[i];
        let sum = 0;
        let wsum = 0;
        for (const [key, t] of Object.entries(typical)) {
            if (r[key] === null || !Number.isFinite(r[key])) continue;
            sum += WEIGHTS[key] * Math.min(3, Math.abs(r[key] - t.median) / t.scale) / 3;
            wsum += WEIGHTS[key];
        }
        const featureContrast = wsum > 0 ? sum / wsum : 0;

        const section = dominantSection(model, s.t0, s.t1);
        const rare = section !== null && (clusterCount.get(section.cluster) ?? 0) === 1;
        const bridge = section !== null && (section.role === 'bridge' || section.role === 'break');
        const keyChange = (globalKey !== null && section?.key !== null && section?.key !== undefined && section.key !== globalKey)
            || (model.tonal?.modulations ?? []).some((m) => m.t >= s.t0 - 2 && m.t < s.t1);

        const R = CHARACTER_RULES;
        const contrast = clamp01(featureContrast * R.contrastGain
            + (rare ? R.rareBonus : 0) + (bridge ? R.bridgeBonus : 0) + (keyChange ? R.keyBonus : 0));
        const entry = i > 0 ? arc.changes?.at(s.bar0) ?? null : null;
        const arrival = entry === null ? 0 : clamp01(Math.max(Math.abs(entry.rise), Math.abs(entry.fill)) / R.arrivalFull);
        const rises = entry !== null && entry.fill > 0;

        const density = r.densityLinear / typicalDensity;
        const passive = clamp01(0.5 + (medEnergy - r.energy) * 2.5);
        const epic = s.climax ? 1 : clamp01(0.5 + (r.energy - medEnergy) * 2.5) * (s.level >= 3 ? 1 : 0.7);
        const sustain = r.perc === null
            ? clamp01(1 - density * 0.6)
            : 0.7 * clamp01((0.75 - r.perc) / 0.5) + 0.3 * clamp01(1.2 - density);
        const rhythmic = r.perc === null
            ? clamp01(density - 0.3)
            : 0.6 * clamp01((r.perc - 0.35) / 0.5) + 0.4 * clamp01(density * 0.8);

        return {
            index: s.index,
            contrast: round3(contrast),
            arrival: round3(arrival),
            rises,
            passive: round3(passive),
            epic: round3(epic),
            sustain: round3(sustain),
            rhythmic: round3(rhythmic),
            density: round3(density),
            traits: { rare, bridge, keyChange },
        };
    });
}

/** Sección del análisis que más solapa con [t0, t1). */
function dominantSection(model, t0, t1) {
    let best = null;
    let bestOverlap = 0;
    for (const sec of model.sections) {
        const overlap = Math.min(t1, sec.end) - Math.max(t0, sec.start);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            best = sec;
        }
    }
    return best;
}

function weightedPercentile(values, weights, p) {
    if (values.length === 0) return 0;
    const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (const i of idx) {
        acc += weights[i];
        if (acc >= p * total) return values[i];
    }
    return values[idx[idx.length - 1]];
}

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
