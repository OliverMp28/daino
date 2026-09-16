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
//   1. Intensidad de cada compás: energía (cuánto suena), plenitud (graves,
//      medios y agudos a la vez), actividad (cuántos golpes y de qué fuerza) y
//      la energía de su sección.
//   2. Tramos: los pasajes entre los cambios de la canción que se oyen
//      (songChanges.js: un break, la vuelta tras él, un instrumento que entra,
//      un cambio de sección que cambia el sonido), fundidos por su frontera más
//      débil si son demasiado cortos para jugarse.
//   3. Nivel de cada tramo (0 reposo · 1 calma · 2 groove · 3 empuje · 4 clímax),
//      relativo a la propia canción: toda canción tiene su calma y su cumbre.
//   4. Escalada: la segunda y la tercera vez que vuelve el mismo material (el
//      estribillo) cuentan un poco más. Es lo que hace que el final "llegue".
//   5. Clímax: el tramo más intenso de la segunda mitad; nunca dura más de
//      16 compases ni de 40 s (un clímax de un minuto no es un clímax, es
//      cansancio). Si el tramo es más largo y entra de golpe (un drop), el
//      clímax empieza donde entra la música, no unos compases después.
//   6. Subidas y drops: los compases previos a un salto grande de nivel se
//      marcan como subida; el primer compás del tramo alto, como drop.
//
// El arco NO depende de la dificultad: el mismo tema tiene la misma forma en
// Fácil y en Extremo; la dificultad decide cuánto se llena cada nivel.

import { detectChanges } from './songChanges.js';

export const ARC_LEVEL = Object.freeze({ REST: 0, CALM: 1, GROOVE: 2, DRIVE: 3, CLIMAX: 4 });

export const ARC_RULES = Object.freeze({
    /**
     * Tramo mínimo jugable: 4 compases o 8 s. Solo en compases, a 65 BPM y 3/4
     * la vuelta de Dawn of Faith (3 compases, 11 s) se fundía con su clímax.
     */
    minSegmentBars: 4,
    minSegmentS: 8,
    /**
     * Fuerza mínima de un cambio (songChanges.js) para que empiece un tramo.
     * Medido en los oficiales: lo que se oye como otro pasaje va de 0.56 (Time
     * 1:45.7, entran instrumentos) a 3 (What's Up Danger 3:22.7). Por debajo de
     * 0.5 hay variaciones dentro de un mismo pasaje y cambios de sección que no
     * cambian el sonido (Dawn of Faith 2:21 y 2:32, 0.21 y 0.33): partían su
     * clímax en trozos.
     */
    splitStrength: 0.5,
    /** Subida de energía mínima para que un tramo "entre de golpe" (un drop). */
    dropRise: 0.1,
    /** Un principio o final de canción cortos se quedan como tramo si su frontera es al menos así de clara. */
    edgeStrength: 1,
    /** Duración máxima del clímax, en compases y en segundos (lo que llegue antes), y mínima al recortarlo. */
    climaxMaxBars: 16,
    climaxMaxS: 40,
    climaxMinBars: 8,
    /** Frase con la que se cuenta desde el final de un tramo largo, en compases. */
    phraseBars: 4,
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
 * @returns {{ bars: ArcBar[], segments: ArcSegment[], climax: number, changes: ReturnType<typeof detectChanges> }}
 */
export function buildSongArc(model) {
    const nBars = model.bars.length;
    const changes = detectChanges(model);
    if (nBars === 0) return { bars: [], segments: [], climax: -1, changes };

    const raw = barIntensities(model);
    let segments = splitSegments(model, raw, changes);
    segments = assignLevels(model, segments);
    const climax = pickClimax(model, segments, changes);
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

    return { bars, segments, climax: climaxIndex, changes };
}

// --------------------------- 1. Intensidad por compás ---------------------------

function barIntensities(model) {
    const n = model.bars.length;
    const energy = new Float64Array(n);
    const activity = new Float64Array(n);
    const full = new Float64Array(n);
    const section = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const bar = model.bars[i];
        const dur = Math.max(1e-3, bar.t1 - bar.t0);
        energy[i] = model.energyMean(bar.t0, bar.t1);
        const bands = model.bandsMean(bar.t0, bar.t1);
        full[i] = bands === null ? energy[i] : (bands.low + bands.mid + bands.high) / 3;
        activity[i] = model.activity(bar.t0, bar.t1) / dur;
        section[i] = sectionAt(model, (bar.t0 + bar.t1) / 2).energy;
    }
    // La actividad no tiene escala propia: se normaliza a su percentil 90 en la
    // canción (un compás lleno de golpes vale ~1 en cualquier tema). Pesa poco:
    // un muro de guitarras distorsionadas suena más que una estrofa limpia y da
    // MENOS golpes separables. En What's Up Danger, con la actividad al 30 %, el
    // final (energía 0.88, la más alta) quedaba por debajo de una estrofa (0.80
    // de energía y el triple de golpes) y el clímax se iba a la estrofa.
    const p90 = percentile(activity, 0.9) || 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const act = Math.min(1, activity[i] / p90);
        out[i] = clamp01(0.5 * energy[i] + 0.2 * full[i] + 0.1 * act + 0.2 * section[i]);
    }
    return out;
}

// --------------------------- 2. Tramos ---------------------------

function splitSegments(model, raw, changes) {
    const nBars = model.bars.length;
    const cuts = new Set([0]);

    // Donde la canción cambia de verdad. Antes: toda frontera de sección del
    // análisis más un salto de intensidad compuesta a ≥ 8 compases del último
    // corte. La vuelta tras el break de What's Up Danger (2:37) quedaba a 5
    // compases de la sección anterior y nunca partía nada.
    for (const change of changes.boundaries) {
        if (change.strength >= ARC_RULES.splitStrength) cuts.add(change.bar);
    }

    const starts = [...cuts].filter((b) => b >= 0 && b < nBars).sort((a, b) => a - b);
    let segs = starts.map((b0, i) => makeSegment(model, raw, b0, i + 1 < starts.length ? starts[i + 1] : nBars));

    // Tramos demasiado cortos, del más corto al más largo: se funden con el vecino
    // al otro lado de su frontera más débil (lo que menos cambia es lo que menos
    // separa). A igual fuerza, con el de intensidad más parecida. Así un break de
    // 2 compases antes de un drop se queda con lo anterior, no con el drop. El
    // principio o el final de la canción separados por un cambio claro de un
    // tramo largo se quedan como tramo: fundido, el final de Mi Fiesta (5 s que
    // se apagan tras 3:04) metía su silencio en el clímax.
    const strengthAt = (bar) => changes.at(bar)?.strength ?? 0;
    const keepsEdge = (i) => {
        if (segs.length < 2 || (i !== 0 && i !== segs.length - 1)) return false;
        const neighbor = i === 0 ? segs[1] : segs[i - 1];
        const boundary = i === 0 ? segs[1].bar0 : segs[i].bar0;
        return !isShort(model, neighbor.bar0, neighbor.bar1) && strengthAt(boundary) >= ARC_RULES.edgeStrength;
    };
    for (;;) {
        let idx = -1;
        for (let i = 0; i < segs.length; i++) {
            if (!isShort(model, segs[i].bar0, segs[i].bar1) || keepsEdge(i)) continue;
            if (idx < 0 || segs[i].t1 - segs[i].t0 < segs[idx].t1 - segs[idx].t0) idx = i;
        }
        if (idx < 0 || segs.length === 1) break;
        const s = segs[idx];
        const left = segs[idx - 1];
        const right = segs[idx + 1];
        let into;
        if (left === undefined) into = idx + 1;
        else if (right === undefined) into = idx - 1;
        else {
            const inStrength = strengthAt(s.bar0);
            const outStrength = strengthAt(right.bar0);
            if (Math.abs(inStrength - outStrength) > 0.05) into = inStrength < outStrength ? idx - 1 : idx + 1;
            else into = Math.abs(left.intensity - s.intensity) <= Math.abs(right.intensity - s.intensity) ? idx - 1 : idx + 1;
        }
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

function pickClimax(model, segs, changes) {
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
    const whole = () => {
        target.climax = true;
        target.level = ARC_LEVEL.CLIMAX;
        return { split: null };
    };
    // Máximo en compases Y en segundos: 16 compases a 63 BPM son un minuto.
    const fits = (b0, b1) => b1 - b0 <= ARC_RULES.climaxMaxBars && model.bars[b1 - 1].t1 - model.bars[b0].t0 <= ARC_RULES.climaxMaxS;
    if (fits(target.bar0, target.bar1)) return whole();

    // Tramo largo: el clímax es un trozo, y el corte va donde el tramo cambia
    // algo por dentro (un cambio de sección que apenas cambia el sonido, por
    // debajo de lo que parte un tramo; el más marcado) o, si no cambia nada, en
    // una frase de 4 compases contada desde el final del tramo: una sección
    // cambia al acabar una frase aunque su entrada traiga una anacrusa o un
    // compás de más. Ningún corte deja fuera un trozo más corto que un tramo.
    const inner = changes.boundaries
        .filter((c) => c.bar > target.bar0 && c.bar < target.bar1)
        .sort((a, b) => b.strength - a.strength || a.bar - b.bar)
        .map((c) => c.bar);
    const split = (cut, climaxFirst) => {
        const first = { ...target, bar1: cut, t1: model.bars[cut - 1].t1, climax: climaxFirst, level: climaxFirst ? ARC_LEVEL.CLIMAX : target.level };
        const second = { ...target, bar0: cut, t0: model.bars[cut].t0, climax: !climaxFirst, level: climaxFirst ? target.level : ARC_LEVEL.CLIMAX };
        return { split: [...segs.slice(0, best), first, second, ...segs.slice(best + 1)].map((s, i) => ({ ...s, index: i })) };
    };

    const entry = changes.at(target.bar0);
    const dropsIn = target.index > 0 && entry !== null && entry.rise >= ARC_RULES.dropRise && entry.strength >= ARC_RULES.splitStrength;
    if (dropsIn) {
        // Entra de golpe: el clímax empieza donde entra la música (lo más intenso
        // se siente al llegar). Antes el clímax eran los ÚLTIMOS compases y en
        // What's Up Danger empezaba 15 s después del drop (2:52 en vez de 2:37),
        // en un compás donde la música no cambia nada.
        const ok = (end) => end >= target.bar0 + ARC_RULES.climaxMinBars && end < target.bar1 && fits(target.bar0, end) && !isShort(model, end, target.bar1);
        const phrases = [];
        for (let b = target.bar1 - ARC_RULES.phraseBars; b > target.bar0; b -= ARC_RULES.phraseBars) phrases.push(b);
        for (let len = ARC_RULES.climaxMaxBars; len >= ARC_RULES.climaxMinBars; len -= ARC_RULES.phraseBars) phrases.push(target.bar0 + len);
        const end = [...inner, ...phrases].find(ok);
        return end === undefined ? whole() : split(end, true);
    }

    // Se llega poco a poco: el clímax es el final del tramo (la frase que
    // desemboca en el final o en la outro); lo anterior conserva su nivel.
    // Recortar nunca deja delante un trozo más corto que un tramo. Medido sin
    // eso: en un tema de la comunidad la cabeza quedó de 1 compás (1.7 s) y el
    // nivel encadenaba dos drops seguidos.
    const ok = (start) => start > target.bar0 && start <= target.bar1 - ARC_RULES.climaxMinBars && fits(start, target.bar1) && !isShort(model, target.bar0, start);
    const phrases = [];
    for (let len = ARC_RULES.climaxMaxBars; len >= ARC_RULES.climaxMinBars; len -= ARC_RULES.phraseBars) phrases.push(target.bar1 - len);
    const start = [...inner, ...phrases].find(ok);
    return start === undefined ? whole() : split(start, false);
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

/** ¿Demasiado corto para ser un tramo? (menos de 4 compases y de 8 s). */
function isShort(model, bar0, bar1) {
    if (bar1 <= bar0) return true;
    return bar1 - bar0 < ARC_RULES.minSegmentBars && model.bars[bar1 - 1].t1 - model.bars[bar0].t0 < ARC_RULES.minSegmentS;
}

function sectionAt(model, t) {
    for (const s of model.sections) if (t >= s.start && t < s.end) return s;
    return model.sections[model.sections.length - 1];
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
