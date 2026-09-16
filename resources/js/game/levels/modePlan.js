// Plan de modos — en qué tramos de la canción cambian las reglas del cuerpo (Ola 6).
//
// Un modo de movimiento no es un obstáculo más: es un MOMENTO del nivel. Por eso
// se decide con la estructura de la canción, antes de colocar ninguna acción,
// como las marchas de velocidad:
//
//   1. Dónde: tramos que suenan con cuerpo (groove o más), pasado el primer
//      tramo de aprendizaje. El modo cubre frases completas desde que empieza el
//      tramo, entre 12 y 24 s: un momento, no media canción (en un tema a 65 BPM
//      16 compases son 44 s).
//   2. En qué orden: primero el ESTRENO (el primer tramo posible), después el
//      CLÍMAX si la dificultad lo permite (lo más intenso del nivel con las
//      reglas cambiadas) y después el material del primer tramo que empuja
//      (típicamente, el estribillo). Cada vez que ese material vuelve, vuelve su
//      modo: el jugador aprende que "el estribillo es la antigravedad" y lo
//      espera, igual que la memoria de frases repite los patrones de un riff.
//   3. Cuántas veces y desde cuándo: lo decide la dificultad (difficulty.js,
//      `modes`). Relajado no cambia de reglas; en Normal el clímax sigue siendo
//      correr a toda velocidad; en Difícil y Extremo el modo también puede ser
//      el clímax. Entre dos tramos de modo se corre al menos 16 s.
//   4. Cómo se entra y se sale: por un portal en la anacrusa del primer compás
//      (el mismo instante que un acelerón, `pickupTime`), nunca encima de una
//      acción. Antes del portal la última acción deja pasar su obstáculo; después
//      el Dino tiene tiempo de asentarse (`settleS` de cada modo). La primera vez
//      que aparece un modo en la canción, sus primeras acciones esperan y van
//      espaciadas: se estrena, no se impone.
//
// Función pura: mismo arco + misma dificultad ⇒ mismo plan.

import { MOVEMENT_MODES } from '../systems/modes/index.js';
import { OBSTACLE_KIND } from '../config.js';
import { actionLeadS } from '../systems/physics.js';
import { pickupTime } from './speedPlan.js';

/**
 * Reglas del plan de modos. Cambiar cualquiera altera los charts: sube
 * `CHARTER_VERSION` en chartFormat.js al hacerlo.
 */
export const MODE_RULES = Object.freeze({
    /** Un tramo de modo son frases completas de tantos compases… */
    phraseBars: 4,
    maxBars: 16,
    /** …que duran entre esto y esto (segundos). */
    minS: 12,
    maxS: 24,
    /** Ningún modo antes de este segundo ni de esta fracción de la canción. */
    minStartS: 24,
    minStartFraction: 0.2,
    /** Segundos corriendo como mínimo entre dos tramos de modo: un modo es un momento, no la norma. */
    minGapS: 16,
    /**
     * Antes de un portal, la última acción del modo que termina deja al menos su
     * adelanto más esto: su obstáculo ya ha pasado cuando cambian las reglas.
     * Medido: bastan 0.20-0.29 s en total (tests/js/modes.test.mjs).
     */
    exitClearS: 0.25,
    /** Estreno de un modo en la canción: su primera acción, tantos beats tras el portal… */
    introBeats: 2,
    /** …y sus primeras acciones, en el pulso y separadas al menos esto. */
    introActions: 2,
    introGapS: 1.1,
});

/**
 * @typedef {Object} ModeSpan
 * @property {string} mode
 * @property {number} bar0     Primer compás del modo.
 * @property {number} bar1     Primer compás de vuelta a correr.
 * @property {number} tIn      Portal de entrada (anacrusa de bar0).
 * @property {number} tOut     Portal de salida (anacrusa de bar1).
 * @property {number} at       Primer tiempo de bar0.
 * @property {boolean} first   Primera vez que aparece este modo en la canción.
 */

/**
 * @param {object} p
 * @param {ReturnType<import('./songArc.js').buildSongArc>} p.arc
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} p.model
 * @param {{ modes?: Record<string, { from: number, segments: number, climax: boolean }> }} p.profile
 * @param {(stage: number) => number} p.stageTime  Instante de cada etapa del arco (unlockSchedule).
 * @param {number} p.tMax                          Última acción posible del nivel.
 * @returns {ModeSpan[]}  En orden temporal.
 */
export function planModes({ arc, model, profile, stageTime, tMax }) {
    const R = MODE_RULES;
    const bars = model.bars;
    if (arc.segments.length === 0 || bars.length === 0) return [];

    /** @type {ModeSpan[]} */
    const chosen = [];
    for (const [modeId, rule] of Object.entries(profile.modes ?? {})) {
        if (MOVEMENT_MODES[modeId] === undefined || !(rule.segments > 0)) continue;
        const from = Math.max(stageTime(rule.from), R.minStartS, model.durationSec * R.minStartFraction);

        const candidates = [];
        for (const seg of arc.segments) {
            if (seg.index === 0 || seg.level < 2 || (seg.climax && !rule.climax) || seg.t0 < from - 1e-6) continue;
            const span = spanOf(model, seg, tMax);
            if (span !== null) candidates.push({ seg, ...span });
        }
        if (candidates.length === 0) continue;

        // Estreno, clímax y, después, el material del primer tramo que empuja
        // antes que el resto (ver cabecera).
        const anchor = candidates.find((c) => c.seg.level >= 3) ?? candidates[0];
        const ordered = [
            candidates[0],
            ...candidates.filter((c) => c.seg.climax),
            ...candidates.filter((c) => c.seg.cluster === anchor.seg.cluster),
            ...candidates,
        ];
        let count = 0;
        for (const c of ordered) {
            if (count >= rule.segments) break;
            const clash = chosen.some((o) => c.tIn < o.tOut + R.minGapS && o.tIn < c.tOut + R.minGapS);
            if (clash) continue;
            chosen.push({ mode: modeId, bar0: c.bar0, bar1: c.bar1, tIn: round3(c.tIn), tOut: round3(c.tOut), at: round3(bars[c.bar0].t0), first: false });
            count++;
        }
    }

    chosen.sort((a, b) => a.bar0 - b.bar0);
    const seen = new Set();
    for (const span of chosen) {
        span.first = !seen.has(span.mode);
        seen.add(span.mode);
    }
    return chosen;
}

/**
 * Frases completas desde el primer compás del tramo: las más posibles sin pasar
 * de `maxS` ni del tramo, con al menos `minS`, y con la vuelta a correr antes de
 * la última acción del nivel. null si no cabe.
 */
function spanOf(model, seg, tMax) {
    const R = MODE_RULES;
    const bars = model.bars;
    for (let n = Math.floor(Math.min(seg.bar1 - seg.bar0, R.maxBars) / R.phraseBars) * R.phraseBars; n >= R.phraseBars; n -= R.phraseBars) {
        const bar1 = seg.bar0 + n;
        if (bar1 >= bars.length) continue;
        const dur = bars[bar1].t0 - bars[seg.bar0].t0;
        if (dur > R.maxS) continue;
        if (dur < R.minS) return null;
        const tOut = pickupTime(model, bar1);
        if (tOut > tMax) continue;
        return { bar0: seg.bar0, bar1, tIn: pickupTime(model, seg.bar0), tOut };
    }
    return null;
}

/** Eventos `mode` del chart para un plan: entrada y vuelta a correr. */
export function modeEvents(plan) {
    const out = [];
    for (const span of plan) {
        out.push({ t: span.tIn, type: 'mode', mode: span.mode });
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

    return {
        plan,
        constant: plan.length === 0,

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
