// Arco de la canción — por dónde sube, dónde respira y dónde está el clímax (Ola 5).
//
// Un nivel de Geometry Dash no tiene la misma densidad de principio a fin: la
// intro enseña, la estrofa se asienta, el estribillo aprieta, el puente deja
// respirar y el último estribillo es lo más intenso antes de soltar. El charter
// de las Olas 3-4 ignoraba todo eso (medido: 55-65 acciones/min en intro,
// estrofa, estribillo y outro por igual), y por eso el juego no "sentía" la
// canción aunque cada obstáculo estuviera sobre un golpe.
//
// Este módulo decide la FORMA del nivel, sin decidir todavía ningún obstáculo:
//
//   1. Intensidad de cada compás: energía (cuánto suena), actividad (cuántos
//      golpes y de qué fuerza) y la energía de su sección.
//   2. Tramos: las secciones del análisis, partidas donde la intensidad cambia
//      de forma sostenida y fundidas si son demasiado cortas para jugarse.
//   3. Nivel de cada tramo (0 reposo · 1 calma · 2 groove · 3 empuje · 4 clímax),
//      relativo a la propia canción: toda canción tiene su calma y su cumbre.
//   4. Escalada: la segunda y la tercera vez que vuelve el mismo material (el
//      estribillo) cuentan un poco más. Es lo que hace que el final "llegue".
//   5. Clímax: el tramo más intenso de la segunda mitad; nunca dura más de
//      16 compases ni de 34 s (un clímax de un minuto no es un clímax, es
//      cansancio).
//   6. Subidas y drops: los compases previos a un salto grande de nivel se
//      marcan como subida; el primer compás del tramo alto, como drop.
//
// El arco NO depende de la dificultad: el mismo tema tiene la misma forma en
// Fácil y en Extremo; la dificultad decide cuánto se llena cada nivel.

export const ARC_LEVEL = Object.freeze({ REST: 0, CALM: 1, GROOVE: 2, DRIVE: 3, CLIMAX: 4 });

const ARC_RULES = Object.freeze({
    /** Tramo mínimo jugable, en compases. */
    minSegmentBars: 4,
    /** Diferencia de intensidad (ventanas de 4 compases) que parte un tramo. */
    splitDelta: 0.16,
    /** Duración máxima del clímax, en compases y en segundos (lo que llegue antes, con mínimo de 8 compases). */
    climaxMaxBars: 16,
    climaxMaxS: 34,
    /** El clímax se busca a partir de esta fracción de la canción. */
    climaxFrom: 0.45,
    /** Compases de subida antes de un drop. */
    buildBars: 2,
    /** Bonus de intensidad por cada repetición anterior del mismo material. */
    escalation: 0.05,
});

/**
 * @typedef {Object} ArcSegment
 * @property {number} index
 * @property {number} bar0        Primer compás (incluido).
 * @property {number} bar1        Último compás (excluido).
 * @property {number} t0
 * @property {number} t1
 * @property {number} intensity   [0,1] medida.
 * @property {number} level       0..4
 * @property {string} role        Rol de la sección del análisis (heurístico).
 * @property {string} cluster     Material musical (mismo cluster = se repite).
 * @property {number} occurrence  Cuántas veces sonó antes ese material.
 * @property {boolean} climax
 * @property {boolean} drop       Empieza con un salto de intensidad.
 * @property {boolean} lift       Empieza subiendo un nivel hacia el empuje.
 */

/**
 * @typedef {Object} ArcBar
 * @property {number} intensity   [0,1]
 * @property {number} level
 * @property {number} segment
 * @property {number} inSegment   Posición del compás dentro de su tramo.
 * @property {number} build       0 normal; 1 penúltimo compás antes de un drop; 2 el último.
 */

/**
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} model
 * @returns {{ bars: ArcBar[], segments: ArcSegment[], climax: number }}
 */
export function buildSongArc(model) {
    const nBars = model.bars.length;
    if (nBars === 0) return { bars: [], segments: [], climax: -1 };

    const raw = barIntensities(model);
    let segments = splitSegments(model, raw);
    segments = assignLevels(model, segments);
    const climax = pickClimax(model, segments);
    if (climax.split !== null) segments = climax.split;
    const climaxIndex = segments.findIndex((s) => s.climax);

    // Después del clímax nada iguala su nivel: el final se suelta.
    for (let i = climaxIndex + 1; climaxIndex >= 0 && i < segments.length; i++) {
        segments[i].level = Math.min(segments[i].level, ARC_LEVEL.DRIVE);
    }

    markDrops(segments);

    const bars = new Array(nBars);
    for (const seg of segments) {
        for (let b = seg.bar0; b < seg.bar1; b++) {
            bars[b] = { intensity: raw[b], level: seg.level, segment: seg.index, inSegment: b - seg.bar0, build: 0 };
        }
    }
    for (const seg of segments) {
        if (!seg.drop || seg.index === 0) continue;
        const prev = segments[seg.index - 1];
        for (let k = 1; k <= ARC_RULES.buildBars; k++) {
            const b = seg.bar0 - k;
            if (b >= prev.bar0 && b >= 0) bars[b].build = ARC_RULES.buildBars - k + 1;
        }
    }

    return { bars, segments, climax: climaxIndex };
}

// --------------------------- 1. Intensidad por compás ---------------------------

function barIntensities(model) {
    const n = model.bars.length;
    const energy = new Float64Array(n);
    const activity = new Float64Array(n);
    const section = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const bar = model.bars[i];
        const dur = Math.max(1e-3, bar.t1 - bar.t0);
        energy[i] = model.energyMean(bar.t0, bar.t1);
        activity[i] = model.activity(bar.t0, bar.t1) / dur;
        section[i] = sectionAt(model, (bar.t0 + bar.t1) / 2).energy;
    }
    // La actividad no tiene escala propia: se normaliza a su percentil 90 en la
    // canción (un compás lleno de golpes vale ~1 en cualquier tema).
    const p90 = percentile(activity, 0.9) || 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const act = Math.min(1, activity[i] / p90);
        out[i] = clamp01(0.5 * energy[i] + 0.3 * act + 0.2 * section[i]);
    }
    return out;
}

// --------------------------- 2. Tramos ---------------------------

function splitSegments(model, raw) {
    const nBars = model.bars.length;
    const cuts = new Set([0]);

    // Fronteras de sección del análisis, llevadas al compás más cercano.
    for (const s of model.sections) {
        if (s.start <= 0) continue;
        cuts.add(nearestBar(model, s.start));
    }

    // Cambios sostenidos de intensidad dentro de una sección larga: se compara
    // la media de los 4 compases anteriores con la de los 4 siguientes.
    const W = 4;
    let lastCut = 0;
    for (let b = W; b <= nBars - W; b++) {
        if (cuts.has(b)) {
            lastCut = b;
            continue;
        }
        if (b - lastCut < ARC_RULES.minSegmentBars * 2) continue;
        const before = mean(raw, b - W, b);
        const after = mean(raw, b, b + W);
        if (Math.abs(after - before) >= ARC_RULES.splitDelta) {
            cuts.add(b);
            lastCut = b;
        }
    }

    const starts = [...cuts].filter((b) => b >= 0 && b < nBars).sort((a, b) => a - b);
    let segs = starts.map((b0, i) => makeSegment(model, raw, b0, i + 1 < starts.length ? starts[i + 1] : nBars));

    // Tramos demasiado cortos: se funden con el vecino de intensidad más parecida.
    for (;;) {
        const idx = segs.findIndex((s) => s.bar1 - s.bar0 < ARC_RULES.minSegmentBars);
        if (idx < 0 || segs.length === 1) break;
        const s = segs[idx];
        const left = segs[idx - 1];
        const right = segs[idx + 1];
        let into;
        if (left === undefined) into = idx + 1;
        else if (right === undefined) into = idx - 1;
        else into = Math.abs(left.intensity - s.intensity) <= Math.abs(right.intensity - s.intensity) ? idx - 1 : idx + 1;
        const a = Math.min(idx, into);
        const merged = makeSegment(model, raw, segs[a].bar0, segs[a + 1].bar1);
        segs.splice(a, 2, merged);
    }
    return segs.map((s, i) => ({ ...s, index: i }));
}

function makeSegment(model, raw, bar0, bar1) {
    const t0 = model.bars[bar0].t0;
    const t1 = model.bars[bar1 - 1].t1;
    let sum = 0;
    let dur = 0;
    for (let b = bar0; b < bar1; b++) {
        const d = model.bars[b].t1 - model.bars[b].t0;
        sum += raw[b] * d;
        dur += d;
    }
    // Rol y material de la sección del análisis que más solapa con el tramo.
    let best = model.sections[0];
    let bestOverlap = -1;
    for (const s of model.sections) {
        const overlap = Math.min(t1, s.end) - Math.max(t0, s.start);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            best = s;
        }
    }
    return {
        index: 0, bar0, bar1, t0, t1,
        intensity: dur > 0 ? sum / dur : 0,
        level: ARC_LEVEL.GROOVE,
        role: best.role,
        cluster: best.cluster,
        sectionStart: best.start,
        occurrence: 0,
        climax: false,
        drop: false,
    };
}

// --------------------------- 3-4. Niveles y escalada ---------------------------

function assignLevels(model, segs) {
    for (const s of segs) {
        // Cuántas veces sonó ANTES el mismo material. Se cuenta por sección del
        // análisis, no por tramo: una sección partida en dos no suma dos veces.
        s.occurrence = model.sections.filter((x) => x.cluster === s.cluster && x.start < s.sectionStart - 1e-6).length;
    }

    // El nivel sale de cuánto se aparta cada tramo de la intensidad TÍPICA de la
    // canción (su mediana ponderada por duración), no de su posición en un
    // ranking. Probado primero por ranking: en temas de energía plana (Last
    // Christmas, Mi Fiesta: todos los tramos entre 0.62 y 0.72) inflaba
    // diferencias de 0.05 hasta repartir los tramos de "calma" a "clímax", y el
    // último estribillo acababa en calma. Con la mediana, un tema plano queda
    // casi todo en groove y un tema con dinámica real se reparte entero.
    const values = segs.map((s) => s.intensity);
    const weights = segs.map((s) => s.t1 - s.t0);
    const median = weightedPercentile(values, weights, 0.5);

    for (const s of segs) {
        let d = s.intensity - median;
        if (d > -0.05) d += ARC_RULES.escalation * Math.min(2, s.occurrence);
        let level;
        if (d <= -0.2 && s.intensity < 0.25) level = ARC_LEVEL.REST;
        else if (d <= -0.08) level = ARC_LEVEL.CALM;
        else if (d < 0.08) level = ARC_LEVEL.GROOVE;
        else level = ARC_LEVEL.DRIVE;
        // Intro y outro enmarcan: no empujan salvo que suenen de verdad fuerte
        // (canciones que arrancan con el estribillo).
        if ((s.role === 'intro' || s.role === 'outro') && s.intensity < 0.7) level = Math.min(level, ARC_LEVEL.GROOVE);
        s.q = 0.5 + d;
        s.level = level;
    }
    return segs;
}

// --------------------------- 5. Clímax ---------------------------

function pickClimax(model, segs) {
    const duration = model.durationSec;
    let best = -1;
    let bestScore = -Infinity;
    const consider = (fromFraction) => {
        for (const s of segs) {
            const center = (s.t0 + s.t1) / 2 / duration;
            if (center < fromFraction || s.level < ARC_LEVEL.GROOVE) continue;
            // Más cerca del final, mejor clímax; un estribillo más, una outro menos.
            const roleBonus = s.role === 'chorus' ? 0.08 : s.role === 'outro' ? -0.06 : 0;
            const score = s.q + 0.25 * center + roleBonus;
            if (score > bestScore) {
                bestScore = score;
                best = s.index;
            }
        }
    };
    consider(ARC_RULES.climaxFrom);
    if (best < 0) consider(0);
    if (best < 0) {
        // Canción plana (todo reposo/calma): el clímax es su tramo más intenso.
        best = segs.reduce((b, s) => (s.q > segs[b].q ? s.index : b), 0);
    }

    const target = segs[best];
    // Máximo en compases Y en segundos: 16 compases a 63 BPM son un minuto.
    let maxBars = ARC_RULES.climaxMaxBars;
    while (maxBars > 8 && model.bars[target.bar1 - 1].t1 - model.bars[Math.max(target.bar0, target.bar1 - maxBars)].t0 > ARC_RULES.climaxMaxS) {
        maxBars -= 4;
    }
    // Si recortar dejaría delante un trozo más corto que un tramo jugable, el
    // clímax se lo queda entero. Medido sin esto: en un tema de la comunidad la
    // cabeza quedó de 1 compás (1.7 s) y el nivel encadenaba dos drops seguidos.
    if (target.bar1 - target.bar0 <= maxBars + ARC_RULES.minSegmentBars - 1) {
        target.climax = true;
        target.level = ARC_LEVEL.CLIMAX;
        return { split: null };
    }

    // Tramo largo: el clímax son sus últimos compases (la frase que desemboca
    // en el final o en la outro); lo anterior conserva su nivel.
    const cut = target.bar1 - maxBars;
    const head = { ...target, bar1: cut, t1: model.bars[cut - 1].t1, climax: false };
    const tail = { ...target, bar0: cut, t0: model.bars[cut].t0, climax: true, level: ARC_LEVEL.CLIMAX };
    const split = [...segs.slice(0, best), head, tail, ...segs.slice(best + 1)].map((s, i) => ({ ...s, index: i }));
    return { split };
}

// --------------------------- 6. Drops ---------------------------

/**
 * drop: la intensidad salta dos niveles o más, o empieza el clímax.
 * lift: sube un nivel hacia el empuje (típicamente, estrofa → estribillo). Un
 * momento más suave que un drop, pero un momento: el runtime lo marca.
 */
function markDrops(segs) {
    if (segs.length > 0) {
        segs[0].drop = false;
        segs[0].lift = false;
    }
    for (let i = 1; i < segs.length; i++) {
        const prev = segs[i - 1];
        const s = segs[i];
        s.drop = s.level - prev.level >= 2 || (s.climax && s.level > prev.level);
        s.lift = !s.drop && s.level - prev.level === 1 && s.level >= ARC_LEVEL.DRIVE;
    }
}

// --------------------------- Utilidades ---------------------------

function sectionAt(model, t) {
    for (const s of model.sections) if (t >= s.start && t < s.end) return s;
    return model.sections[model.sections.length - 1];
}

function nearestBar(model, t) {
    let best = 0;
    let bestD = Infinity;
    for (const bar of model.bars) {
        const d = Math.abs(bar.t0 - t);
        if (d < bestD) {
            bestD = d;
            best = bar.index;
        }
    }
    return best;
}

function mean(arr, a, b) {
    let s = 0;
    for (let i = a; i < b; i++) s += arr[i];
    return b > a ? s / (b - a) : 0;
}

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = Float64Array.from(arr).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function weightedPercentile(values, weights, p) {
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
