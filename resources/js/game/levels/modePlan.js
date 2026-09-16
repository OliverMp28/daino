// Plan de modos — qué momentos de la canción cambian las reglas del cuerpo, y con qué modo (Ola 6).
//
// Un modo de movimiento no es un obstáculo más: es un MOMENTO del nivel, y se
// decide con la canción antes de colocar ninguna acción, como las marchas.
//
// Ola 6a los ponía donde volvía el estribillo, hasta tres veces. Jugado, se sentía
// repetitivo. Desde la Ola 6b el plan es un REPARTO:
//
//   1. Cada tramo tiene un carácter (songCharacter.js): cuánto contrasta con el
//      resto de la canción, cuánto sube o se vacía al llegar, y si suena pasivo,
//      épico, sostenido o a golpes.
//   2. Cada modo declara con qué carácter encaja (MODE_CASTING): la antigravedad,
//      que se juega a golpes, con los tramos rítmicos y épicos; el vuelo, que se
//      juega manteniendo, con los pasajes sostenidos y pasivos. Los dos piden
//      contraste: un modo aparece donde la canción hace algo distinto (o llega
//      de golpe: una llegada que revienta es de antigravedad, una que se vacía,
//      de vuelo).
//   3. Solo entran los encajes claros (`minScore`, `minContrast`). Una canción
//      que suena igual de principio a fin puede no tener ningún momento: cada
//      canción es un mundo, y así cada nivel se siente distinto.
//   4. Cada modo, como mucho UNA vez por nivel: es un evento, no una rutina. La
//      dificultad decide cuántos momentos caben según la duración (`moments`) y
//      qué modos existen (Fácil solo antigravedad, Normal+ también vuelo; en
//      Difícil y Extremo el clímax puede ser uno). Relajado no cambia de reglas.
//   5. Entre todas las combinaciones posibles se elige la de mejor encaje total.
//
// Cuánto dura (tras el playtest de la 6b): lo que dura su pasaje. Un modo entra
// donde la canción cambia y SALE donde vuelve a cambiar: es siempre un tramo del
// arco entero, y las fronteras de los tramos son cambios de la música
// (songChanges.js). Antes el momento se cortaba en frases de 4 compases desde su
// inicio hasta 24 s, y se jugó así: el vuelo de Dawn of Faith acababa a las 1:42
// y la antigravedad de Time a las 1:30 con la canción sonando igual ("termina,
// pero no suena distinto"). Un pasaje de más de 40 s (lo que dura como mucho un
// clímax) no es un momento: es media canción.
//
// Cómo se entra y se sale: por un portal en la anacrusa del primer compás (el
// mismo instante que un acelerón, `pickupTime`), nunca encima de una acción. Antes
// del portal la última acción deja pasar su obstáculo; después el Dino tiene
// tiempo de asentarse (`settleS` de cada modo), y como cada modo aparece una sola
// vez, sus primeras acciones siempre esperan y van espaciadas: se estrena.
//
// Función pura: mismo arco + misma dificultad ⇒ mismo plan.

import { MOVEMENT_MODES } from '../systems/modes/index.js';
import { OBSTACLE_KIND } from '../config.js';
import { actionLeadS } from '../systems/physics.js';
import { pickupTime } from './speedPlan.js';
import { describeSegments } from './songCharacter.js';

/**
 * Reglas del plan de modos. Cambiar cualquiera altera los charts: sube
 * `CHARTER_VERSION` en chartFormat.js al hacerlo.
 */
export const MODE_RULES = Object.freeze({
    /** Un momento (un tramo entero) dura entre esto y esto (segundos); el máximo, el de un clímax (songArc.js). */
    minS: 10,
    maxS: 40,
    /** Ningún modo antes de este segundo ni de esta fracción de la canción. */
    minStartS: 24,
    minStartFraction: 0.2,
    /**
     * Segundos corriendo como mínimo entre dos momentos. 10 y no 12: en Dawn of
     * Faith, entre el vuelo del break y la antigravedad del clímax suena la
     * vuelta del bajo (11.1 s), un tramo entero corriendo.
     */
    minGapS: 10,
    /** Encaje mínimo de un modo con un tramo… */
    minScore: 0.5,
    /**
     * …y cuánto tiene que ser un momento para ese modo (`MODE_CASTING.event`):
     * sin algo distinto que jugar, no hay momento. El clímax ya es un momento
     * único de la canción y pide menos (medido en los oficiales: con 0.28 para
     * todos, un estribillo que vuelve se llevaba el modo antes que el puente de
     * la misma canción).
     */
    minContrast: 0.4,
    climaxMinContrast: 0.28,
    /**
     * Al repartir, el clímax (donde la dificultad lo permite) cuenta este encaje
     * de más: es el momento más intenso de la canción. Sin esto, en Dawn of
     * Faith la antigravedad se iba al tramo de después del clímax por 0.006 de
     * encaje, con una entrada que apenas cambia el sonido.
     */
    climaxBonus: 0.1,
    /** Golpes o pulsos jugables mínimos en el tramo (en el pulso, con la música sonando). */
    minPlayableSlots: 8,
    /**
     * Antes de un portal, la última acción del modo que termina deja al menos su
     * adelanto más esto: su obstáculo ya ha pasado cuando cambian las reglas.
     * Medido: bastan 0.20-0.29 s en total (tests/js/modes.test.mjs).
     */
    exitClearS: 0.25,
    /** Estreno de un modo: su primera acción, tantos beats tras el portal… */
    introBeats: 2,
    /** …y sus primeras acciones, en el pulso y separadas al menos esto. */
    introActions: 2,
    introGapS: 1.1,
});

/**
 * Con qué carácter encaja cada modo (songCharacter.js). Añadir un modo = una
 * entrada aquí además de la de systems/modes/.
 *
 *   event(c)      Cuánto es un momento el tramo PARA ESTE MODO [0,1]: cuánto se
 *                 aparta de lo típico de la canción, o cuánto cambia al llegar
 *                 si llega hacia el carácter del modo. Tras el playtest de la 6b:
 *                 el final de What's Up Danger entra con un golpe que es lo más
 *                 intenso del tema pero suena como sus estrofas fuertes
 *                 (contraste con lo típico 0.30), y el modo se lo llevaba un
 *                 tramo menor. Una llegada que revienta hacia lo más intenso es
 *                 un momento de antigravedad; una que se vacía hacia la calma,
 *                 de vuelo. Una estrofa normal tras un estribillo también baja,
 *                 pero a lo típico: no es un momento (de ahí epic y passive).
 *   affinity(c)   Encaje [0,1] con un tramo de carácter `c`.
 *   minDensity    Densidad de golpes mínima respecto a la típica (un modo que se
 *                 juega a golpes no cabe en un pasaje casi sin golpes).
 */
export const MODE_CASTING = Object.freeze({
    flip: Object.freeze({
        event: (c) => Math.max(c.contrast, c.rises ? c.arrival * c.epic : 0),
        affinity: (c) => 0.45 * MODE_CASTING.flip.event(c) + 0.3 * c.rhythmic + 0.25 * c.epic,
        minDensity: 0.35,
    }),
    fly: Object.freeze({
        event: (c) => Math.max(c.contrast, c.rises ? 0 : c.arrival * c.passive),
        affinity: (c) => 0.45 * MODE_CASTING.fly.event(c) + 0.4 * c.sustain + 0.15 * Math.max(c.passive, 0.6 * c.epic),
        minDensity: 0,
    }),
});

/**
 * @typedef {Object} ModeSpan
 * @property {string} mode
 * @property {number} bar0     Primer compás del modo.
 * @property {number} bar1     Primer compás de vuelta a correr.
 * @property {number} tIn      Portal de entrada (anacrusa de bar0).
 * @property {number} tOut     Portal de salida (anacrusa de bar1).
 * @property {number} at       Primer tiempo de bar0.
 * @property {boolean} first   Primera vez que aparece este modo en la canción (siempre, desde la Ola 6b).
 * @property {number} score    Encaje del modo con el tramo.
 * @property {number} segment  Tramo del arco.
 * @property {import('./songCharacter.js').SegmentCharacter} character
 * @property {number} [margin] Holgura del túnel (vuelo); la pone el charter.
 */

/**
 * Cuántos momentos caben en una canción de `durationSec` con una dificultad.
 * @param {{ moments?: number[] }} profile  `moments[k]` = duración mínima para k+1 momentos.
 */
export function momentBudget(profile, durationSec) {
    const thresholds = profile.moments ?? [];
    let n = 0;
    for (const minS of thresholds) if (durationSec >= minS) n++;
    return n;
}

/**
 * @param {object} p
 * @param {ReturnType<import('./songArc.js').buildSongArc>} p.arc
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} p.model
 * @param {{ modes?: Record<string, { climax: boolean }>, moments?: number[] }} p.profile
 * @param {number} p.tMax  Última acción posible del nivel.
 * @returns {ModeSpan[]}  En orden temporal.
 */
export function planModes({ arc, model, profile, tMax }) {
    const R = MODE_RULES;
    const budget = momentBudget(profile, model.durationSec);
    const allowed = Object.entries(profile.modes ?? {}).filter(([id]) => MOVEMENT_MODES[id] !== undefined && MODE_CASTING[id] !== undefined);
    if (budget <= 0 || allowed.length === 0 || arc.segments.length === 0 || model.bars.length === 0) return [];

    const characters = describeSegments(model, arc);
    const from = Math.max(R.minStartS, model.durationSec * R.minStartFraction);
    // Un tramo empieza donde la canción cambia, salvo cuando songArc.js recorta
    // un clímax largo por una frase en la que no cambia nada. Un modo entra en un
    // cambio, y sale en un cambio o en el borde del clímax, donde el nivel
    // también cambia (la velocidad sube o se suelta).
    const changesAt = (bar) => arc.changes?.at(bar) != null;

    const candidates = [];
    for (const seg of arc.segments) {
        const c = characters[seg.index];
        if (seg.index === 0 || seg.level < 1 || seg.t0 < from - 1e-6) continue;
        const next = arc.segments[seg.index + 1];
        if (!changesAt(seg.bar0) || (next !== undefined && !changesAt(next.bar0) && !seg.climax && !next.climax)) continue;
        const span = spanOf(model, seg, tMax);
        if (span === null || playableSlots(model, span) < R.minPlayableSlots) continue;
        for (const [modeId, rule] of allowed) {
            const cast = MODE_CASTING[modeId];
            if (seg.climax && !rule.climax) continue;
            if (cast.event(c) < (seg.climax ? R.climaxMinContrast : R.minContrast)) continue;
            if (c.density < cast.minDensity) continue;
            const score = round3(cast.affinity(c));
            if (score < R.minScore) continue;
            const weight = score + (seg.climax ? R.climaxBonus : 0);
            candidates.push({ mode: modeId, segment: seg.index, character: c, score, weight, ...span });
        }
    }

    const best = bestCombination(candidates, budget);
    const bars = model.bars;
    return best
        .sort((a, b) => a.bar0 - b.bar0)
        .map((c) => ({
            mode: c.mode,
            bar0: c.bar0,
            bar1: c.bar1,
            tIn: round3(c.tIn),
            tOut: round3(c.tOut),
            at: round3(bars[c.bar0].t0),
            first: true,
            score: c.score,
            segment: c.segment,
            character: c.character,
        }));
}

/**
 * La combinación de mejor encaje total (el del clímax, con `climaxBonus`): como
 * mucho `budget` momentos, cada modo una vez y separados `minGapS`. Pocos
 * candidatos (≤ 2 por tramo): basta con probar las combinaciones. A igual
 * encaje, la que empieza antes.
 */
function bestCombination(candidates, budget) {
    const R = MODE_RULES;
    let best = [];
    let bestScore = 0;
    const clash = (a, b) => a.mode === b.mode || (a.tIn < b.tOut + R.minGapS && b.tIn < a.tOut + R.minGapS);
    const visit = (start, chosen, total) => {
        if (total > bestScore + 1e-9 || (Math.abs(total - bestScore) < 1e-9 && chosen.length > 0 && earlier(chosen, best))) {
            best = chosen.slice();
            bestScore = total;
        }
        if (chosen.length >= budget) return;
        for (let i = start; i < candidates.length; i++) {
            const c = candidates[i];
            if (chosen.some((o) => clash(o, c))) continue;
            chosen.push(c);
            visit(i + 1, chosen, total + c.weight);
            chosen.pop();
        }
    };
    visit(0, [], 0);
    return best;
}

function earlier(a, b) {
    const ta = Math.min(...a.map((c) => c.tIn));
    const tb = b.length > 0 ? Math.min(...b.map((c) => c.tIn)) : Infinity;
    return ta < tb;
}

/**
 * El momento es el tramo entero: entra con él (un cambio de la canción) y sale
 * con él (el siguiente), por portales en sus anacrusas. Un tramo de menos de
 * `minS` o de más de `maxS`, o que termina con la canción o después de la
 * última acción del nivel, no es un momento.
 */
function spanOf(model, seg, tMax) {
    const R = MODE_RULES;
    const bars = model.bars;
    if (seg.bar1 >= bars.length) return null;
    const dur = bars[seg.bar1].t0 - bars[seg.bar0].t0;
    if (dur < R.minS - 1e-6 || dur > R.maxS + 1e-6) return null;
    const tOut = pickupTime(model, seg.bar1);
    if (tOut > tMax) return null;
    return { bar0: seg.bar0, bar1: seg.bar1, tIn: pickupTime(model, seg.bar0), tOut };
}

/** Huecos del pulso con la música sonando (donde puede ir una acción de cualquier modo). */
function playableSlots(model, span) {
    let n = 0;
    for (let b = span.bar0; b < span.bar1; b++) {
        for (const slot of model.bars[b].slots) {
            if (slot.onBeat && (slot.strength >= 0.2 || model.energyMean(slot.t - 0.3, slot.t + 0.3) >= 0.06)) n++;
        }
    }
    return n;
}

/** Eventos `mode` del chart para un plan: entrada (con la holgura del túnel si la hay) y vuelta a correr. */
export function modeEvents(plan) {
    const out = [];
    for (const span of plan) {
        const enter = { t: span.tIn, type: 'mode', mode: span.mode };
        if (Number.isFinite(span.margin)) enter.margin = span.margin;
        out.push(enter);
        out.push({ t: span.tOut, type: 'mode', mode: 'run' });
    }
    return out;
}

/**
 * Lo que el charter pregunta al colocar cada acción: en qué modo cae y si el
 * instante respeta los portales.
 *
 * @param {ModeSpan[]} plan
 * @param {number} beatPeriodS
 */
export function createModeGuide(plan, beatPeriodS) {
    const R = MODE_RULES;
    const beat = beatPeriodS > 0 ? beatPeriodS : 0.5;

    // Adelanto máximo de los obstáculos de cada modo: lo que su última acción
    // necesita antes de que cambien las reglas.
    const maxLead = {};
    for (const def of Object.values(OBSTACLE_KIND)) {
        const mode = def.mode ?? 'run';
        maxLead[mode] = Math.max(maxLead[mode] ?? 0, actionLeadS(def));
    }
    const portals = [];
    for (const span of plan) {
        portals.push({ t: span.tIn, from: 'run', to: span.mode, span, entering: true });
        portals.push({ t: span.tOut, from: span.mode, to: 'run', span, entering: false });
    }

    const spanAt = (t) => plan.find((s) => t >= s.tIn && t < s.tOut) ?? null;
    // Un modo sin obstáculos en el registro (el vuelo: sus muros son el túnel) no
    // recibe acciones del charter de correr; lo juega su propio charter.
    const freeSpans = plan.filter((s) => maxLead[s.mode] === undefined);

    return {
        plan,
        constant: plan.length === 0,
        freeSpans,

        /** Modo que rige en `t`. */
        modeAt(t) {
            return spanAt(t)?.mode ?? 'run';
        },

        /** Tramo de modo que contiene `t`, o null si se corre. */
        spanAt,

        /**
         * ¿Puede ir una acción en `t`? Lejos de los portales siempre. Cerca: la del
         * modo que termina deja pasar su obstáculo, la del que empieza espera a
         * que el Dino se asiente (y, en el estreno del modo, un par de beats más).
         */
        allows(t) {
            for (const s of freeSpans) if (t >= s.tIn && t < s.tOut) return false;
            for (const p of portals) {
                if (t < p.t) {
                    if (p.t - t < (maxLead[p.from] ?? 0) + R.exitClearS - 1e-9) return false;
                } else {
                    let settle = MOVEMENT_MODES[p.to].settleS;
                    if (p.entering && p.span.first) settle = Math.max(settle, R.introBeats * beat - 0.02);
                    if (t - p.t < settle - 1e-9) return false;
                }
            }
            return true;
        },
    };
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
