// Dónde cambia la canción — las fronteras entre pasajes que suenan distinto (tras el playtest de la Ola 6b).
//
// Jugando la 6b, los modos y el clímax no caían donde la música cambiaba:
//
//   - What's Up Danger: tras un break casi en silencio, la canción vuelve de golpe
//     a las 2:37 (bombo, y a las 2:40 el grito). Es el momento más intenso del
//     tema y el nivel seguía igual: el clímax y su antigravedad empezaban a las
//     2:52, en un compás donde la música no cambia nada.
//   - Dawn of Faith: el vuelo terminaba a las 1:42 sin que la canción cambiase;
//     el cambio de verdad (vuelven los graves) llega a las 1:49.6.
//   - Time: la antigravedad terminaba a las 1:30 en mitad de un pasaje que sigue
//     igual hasta las 1:45.7.
//
// El analizador no se equivocaba: sus secciones son de MATERIAL (qué grupo de
// timbre y armonía suena; un estribillo se parece a los otros estribillos), y un
// break o la vuelta tras él son el mismo material a otro volumen. Pero todo lo
// necesario ya estaba en su análisis: la energía, los graves, medios y agudos,
// la densidad y la percusividad de los golpes. Medido compás a compás en las
// tres canciones, cada cambio que se oyó salta a la vista (What's Up Danger 2:37,
// energía de 0.23 a 0.73; Dawn of Faith 1:49.6, de 0.25 a 0.66) y donde nada
// cambió (Time 1:30, Dawn of Faith 1:42) no hay nada. Lo que faltaba era leerlo:
// el arco solo partía una sección si la intensidad compuesta cambiaba de forma
// sostenida, a 8 compases o más del último corte y midiendo una actividad de
// golpes que en un muro de guitarras distorsionadas BAJA aunque suene más.
//
// Método: cada compás es un vector de rasgos, cada uno medido en su escala en la
// canción (z). Se busca la partición de la canción en pasajes homogéneos que
// mejor la explica —mínimos cuadrados con un coste fijo por frontera, resuelta
// exacta por programación dinámica (segmentación óptima, Jackson et al. 2005)—,
// de forma que una frontera solo aparece si separa dos pasajes que de verdad
// suenan distinto. Un par de compases tras los que todo vuelve a sonar como antes
// (una parada, un redoble) no son un cambio y se descartan.
// Las fronteras de sección del analizador (cambio de material) se conservan; una
// frontera de sonido a un compás de una de ellas es la misma y se lleva a su sitio.
//
// Cada frontera lleva:
//   strength  cuánto cambia el sonido: distancia media (en z) entre los compases
//             de antes y los de después, hasta 4 por lado.
//   rise      cuánto sube (o baja, si es negativa) la energía al cruzarla.
//   fill      cuánto se llena (o se vacía) el espectro: la media de graves,
//             medios y agudos. No es lo mismo: el break de What's Up Danger
//             (2:11.9) sube de energía porque se queda solo el bajo, y se vacía
//             (medios y agudos desaparecen). Sin bandas, igual a `rise`.
//
// No hay aquí detector de voces: un cantante que pasa de cantar a gritar sobre el
// mismo acompañamiento (What's Up Danger, 2:52-3:12) no cambia la mezcla lo
// bastante para medirlo sin separar pistas, y eso quedó descartado por memoria
// (doc 10, afinado del analizador).
//
// Puro: mismo análisis ⇒ mismas fronteras.

export const CHANGE_RULES = Object.freeze({
    /**
     * Peso de cada rasgo del compás. Densidad y percusividad pesan poco: el primer
     * compás de un pasaje suele traer un redoble o un platillo que las dispara, y
     * con más peso arrastraban la frontera un compás tarde.
     */
    weights: Object.freeze({ energy: 1, low: 1, mid: 0.8, high: 0.8, density: 0.25, perc: 0.25 }),
    /** Escala mínima de cada rasgo: variaciones por debajo de esto no son cambio. */
    floors: Object.freeze({ energy: 0.08, low: 0.1, mid: 0.08, high: 0.1, density: 0.3, perc: 0.1 }),
    /** Pasaje homogéneo más corto, en compases. */
    minBars: 2,
    /**
     * Un pasaje de hasta tantos compases tras el que la canción vuelve a sonar
     * como antes (distancia entre lo de antes y lo de después menor que
     * `blipReturn`) es una parada o un redoble, no dos cambios. En los 8
     * oficiales, el pasaje corto que más vuelve a lo de antes es el break de
     * What's Up Danger (2:32-2:37), a 0.65: tras él la canción suena más llena.
     */
    blipBars: 2,
    blipReturn: 0.3,
    /** Coste de una frontera (en z² medio por compás): cuánto tiene que explicar para existir. */
    penalty: 0.6,
    /** Compases a cada lado con los que se mide la fuerza de una frontera. */
    contextBars: 4,
    /** Una frontera de sonido a esta distancia (compases) de una de sección es la misma. */
    snapBars: 1,
});

/**
 * @typedef {Object} SongChange
 * @property {number} bar       Primer compás del pasaje nuevo.
 * @property {number} t         Su primer tiempo.
 * @property {number} strength  Cuánto cambia el sonido (z medio; ~0.5 se nota, >1.5 es un golpe).
 * @property {number} rise      Cambio de energía al cruzarla (+ sube, − baja).
 * @property {number} fill      Cambio de la media de graves, medios y agudos (+ se llena, − se vacía).
 * @property {boolean} section  El analizador la marca como cambio de sección (material).
 */

/**
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} model
 * @returns {{ boundaries: SongChange[], at: (bar: number) => SongChange | null }}
 *          `boundaries` en orden, sin el compás 0; `at(bar)`, la que abre ese compás.
 */
export function detectChanges(model) {
    const R = CHANGE_RULES;
    const bars = model.bars;
    const n = bars.length;
    if (n < 2) return { boundaries: [], at: () => null };

    const features = barFeatures(model);
    const sums = prefixSums(features, n);
    const wsum = features.reduce((a, f) => a + f.weight, 0);

    const sectionBars = new Set();
    for (const s of model.sections) {
        if (s.start > 0) {
            const b = nearestBar(bars, s.start);
            if (b > 0) sectionBars.add(b);
        }
    }

    // Fronteras de sonido llevadas a la de sección vecina, si la hay.
    const found = dropBlips(optimalPartition(features, sums, wsum, n), features, sums, wsum, n).map((b) => {
        for (let d = 0; d <= R.snapBars; d++) {
            if (sectionBars.has(b - d)) return b - d;
            if (sectionBars.has(b + d)) return b + d;
        }
        return b;
    });

    const list = [...new Set([...found, ...sectionBars])].sort((a, b) => a - b);
    // Dos fronteras más juntas que un pasaje mínimo son la misma: queda la más fuerte.
    for (;;) {
        let merged = false;
        for (let i = 1; i < list.length; i++) {
            if (list[i] - list[i - 1] >= R.minBars) continue;
            const a = measure(features, sums, wsum, list, i - 1, n).strength;
            const b = measure(features, sums, wsum, list, i, n).strength;
            list.splice(a >= b ? i : i - 1, 1);
            merged = true;
            break;
        }
        if (!merged) break;
    }

    const boundaries = list.map((bar, i) => {
        const { strength, rise, fill } = measure(features, sums, wsum, list, i, n);
        return { bar, t: bars[bar].t0, strength: round3(strength), rise: round3(rise), fill: round3(fill), section: sectionBars.has(bar) };
    });
    const byBar = new Map(boundaries.map((b) => [b.bar, b]));
    return { boundaries, at: (bar) => byBar.get(bar) ?? null };
}

/**
 * Rasgos de cada compás en su escala (z, recortado a ±4). Los que el análisis no
 * trae (bandas y percusividad en el del navegador) no cuentan.
 */
function barFeatures(model) {
    const R = CHANGE_RULES;
    const bars = model.bars;
    const n = bars.length;
    const raw = { energy: [], low: [], mid: [], high: [], density: [], perc: [] };
    for (const bar of bars) {
        const dur = Math.max(1e-3, bar.t1 - bar.t0);
        const bands = model.bandsMean(bar.t0, bar.t1);
        raw.energy.push(model.energyMean(bar.t0, bar.t1));
        raw.low.push(bands?.low ?? null);
        raw.mid.push(bands?.mid ?? null);
        raw.high.push(bands?.high ?? null);
        raw.density.push(Math.log(0.1 + model.activity(bar.t0, bar.t1) / dur));
        raw.perc.push(model.percussiveness(bar.t0, bar.t1));
    }
    // Un compás sin golpes no tiene percusividad: se le da la típica de la canción.
    const percKnown = raw.perc.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    if (percKnown.length > 0) {
        const median = percKnown[Math.floor(percKnown.length / 2)];
        raw.perc = raw.perc.map((v) => (v !== null && Number.isFinite(v) ? v : median));
    }

    const out = [];
    for (const [key, weight] of Object.entries(R.weights)) {
        const values = raw[key];
        if (values.some((v) => v === null || !Number.isFinite(v))) continue;
        let mean = 0;
        for (const v of values) mean += v;
        mean /= n;
        let variance = 0;
        for (const v of values) variance += (v - mean) ** 2;
        const scale = Math.max(R.floors[key], Math.sqrt(variance / n));
        const z = Float64Array.from(values, (v) => clamp((v - mean) / scale, -4, 4));
        out.push({ key, weight, z, raw: Float64Array.from(values) });
    }
    return out;
}

function prefixSums(features, n) {
    return features.map((f) => {
        const s1 = new Float64Array(n + 1);
        const s2 = new Float64Array(n + 1);
        const e = new Float64Array(n + 1);
        for (let i = 0; i < n; i++) {
            s1[i + 1] = s1[i] + f.z[i];
            s2[i + 1] = s2[i] + f.z[i] * f.z[i];
            e[i + 1] = e[i] + f.raw[i];
        }
        return { s1, s2, e };
    });
}

/**
 * Partición en pasajes de ≥ `minBars` compases que minimiza la dispersión de
 * cada pasaje respecto a su media más `penalty` por frontera. Exacta, O(n²).
 * @returns {number[]} Primer compás de cada pasaje salvo el primero.
 */
function optimalPartition(features, sums, wsum, n) {
    const R = CHANGE_RULES;
    if (features.length === 0 || n < 2 * R.minBars) return [];
    const cost = (i, j) => {
        const m = j - i;
        let c = 0;
        for (let k = 0; k < features.length; k++) {
            const { s1, s2 } = sums[k];
            const s = s1[j] - s1[i];
            c += features[k].weight * ((s2[j] - s2[i]) - (s * s) / m);
        }
        return c / wsum;
    };
    const best = new Float64Array(n + 1).fill(Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    best[0] = -R.penalty;
    for (let j = R.minBars; j <= n; j++) {
        for (let i = 0; i <= j - R.minBars; i++) {
            if (best[i] === Infinity) continue;
            const v = best[i] + cost(i, j) + R.penalty;
            if (v < best[j] - 1e-12) {
                best[j] = v;
                from[j] = i;
            }
        }
    }
    const cuts = [];
    for (let j = n; j > 0 && from[j] >= 0; j = from[j]) if (from[j] > 0) cuts.push(from[j]);
    return cuts.reverse();
}

/**
 * Quita los pasajes de hasta `blipBars` compases tras los que la canción vuelve
 * a sonar como antes: sus dos fronteras no son cambios.
 */
function dropBlips(cuts, features, sums, wsum, n) {
    const R = CHANGE_RULES;
    const out = cuts.slice();
    for (let i = 0; i + 1 < out.length; i++) {
        const a = out[i];
        const b = out[i + 1];
        if (b - a > R.blipBars) continue;
        const lo = Math.max(i > 0 ? out[i - 1] : 0, a - R.contextBars);
        const hi = Math.min(i + 2 < out.length ? out[i + 2] : n, b + R.contextBars);
        if (a - lo < 1 || hi - b < 1) continue;
        if (distance(features, sums, wsum, lo, a, b, hi).strength < R.blipReturn) {
            out.splice(i, 2);
            i--;
        }
    }
    return out;
}

/** Fuerza y subida de la frontera `list[i]`, con hasta `contextBars` compases por lado sin cruzar las vecinas. */
function measure(features, sums, wsum, list, i, n) {
    const R = CHANGE_RULES;
    const bar = list[i];
    const lo = Math.max(i > 0 ? list[i - 1] : 0, bar - R.contextBars);
    const hi = Math.min(i + 1 < list.length ? list[i + 1] : n, bar + R.contextBars);
    return distance(features, sums, wsum, lo, bar, bar, hi);
}

/** Cuánto cambia el sonido de los compases [lo, a) a los [b, hi): distancia media en z, y subida de energía y plenitud. */
function distance(features, sums, wsum, lo, a, b, hi) {
    let acc = 0;
    let rise = 0;
    let fill = 0;
    let bands = 0;
    for (let k = 0; k < features.length; k++) {
        const { s1, e } = sums[k];
        const before = (s1[a] - s1[lo]) / (a - lo);
        const after = (s1[hi] - s1[b]) / (hi - b);
        acc += features[k].weight * (after - before) ** 2;
        const delta = (e[hi] - e[b]) / (hi - b) - (e[a] - e[lo]) / (a - lo);
        if (features[k].key === 'energy') rise = delta;
        if (BAND_KEYS.includes(features[k].key)) {
            fill += delta;
            bands++;
        }
    }
    return { strength: wsum > 0 ? Math.sqrt(acc / wsum) : 0, rise, fill: bands > 0 ? fill / bands : rise };
}

const BAND_KEYS = Object.freeze(['low', 'mid', 'high']);

function nearestBar(bars, t) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < bars.length; i++) {
        const d = Math.abs(bars[i].t0 - t);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
