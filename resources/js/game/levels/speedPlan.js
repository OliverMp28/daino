// Plan de velocidad — cómo acelera el mundo a lo largo de la canción (afinado de velocidad, Sep 2026).
//
// Tras el playtest de la Ola 5 el nivel más largo y difícil (What's Up Danger,
// Extremo) no se sentía épico. Medido: arrancaba a 370 px/s, aceleraba solo en
// dos tramos (+10 % y +21 %) y VOLVÍA a la base entre ellos, justo del 61 % al
// 80 % de la canción. En el Daino legacy la velocidad solo subía, en escalones,
// y hacia el final se jugaba muchísimo más rápido: esa era la emoción.
//
// Tres ideas, en este orden de importancia:
//
//   1. MARCHAS. La velocidad sube en escalones repartidos entre el arranque y
//      el clímax (una marcha por cada ~36 s, hasta 3), y la última marcha ES el
//      clímax. Una canción corta apenas escala; una de tres minutos llega al
//      clímax bastante más rápida que empezó. Cada escalón cae en un compás que
//      abre tramo o, si no hay ninguno cerca, que abre frase (cada 8 compases).
//   2. TRINQUETE. Hasta que termina el clímax la velocidad nunca baja: un puente
//      tranquilo tras un estribillo se juega igual de rápido (menos denso, no
//      más lento). El único frenazo es al soltar tras el clímax, en rampa.
//      Encima de las marchas, el nivel del arco suma: el empuje algo, el clímax
//      bastante más. Todo multiplicado por la amplitud de la dificultad.
//   3. ANACRUSA. Un acelerón nunca cae encima de una acción: el mundo acelera
//      en la pulsación anterior al primer tiempo del tramo (medio beat antes, o
//      uno entero si medio no llega a READER_ADAPT_S), para que la acción de
//      ese primer tiempo ya se vea llegar a la velocidad nueva. Antes el portal
//      caía en el primer tiempo del drop y quien juega con la vista pulsaba esa
//      acción 41-58 ms tarde (playability.readerOffsetS).
//
// La sincronía no depende de nada de esto: cada obstáculo cruza al Dino en su
// instante musical con cualquier perfil (speedProfile.js). La velocidad solo
// decide a qué distancia se ven los obstáculos, cuánto margen da cada salto (a
// más velocidad, más: playability.timingWindowS) y cuánto tiempo hay para leer
// lo que viene. Eso último manda el techo de velocidad.
//
// Función pura: mismo arco + misma dificultad ⇒ mismo plan.

import { READER_ADAPT_S } from '../systems/playability.js';

/**
 * Reglas del plan de velocidad. Cambiar cualquiera altera los charts: sube
 * `CHARTER_VERSION` en chartFormat.js al hacerlo.
 */
export const SPEED_RULES = Object.freeze({
    /** Una marcha por cada tantos segundos de canción entre el arranque y el clímax. */
    gearEveryS: 36,
    maxGears: 3,
    /** Subida de cada marcha, × `speedAmp` de la dificultad. */
    gearBoost: 0.08,
    /**
     * Subida por nivel del arco (reposo, calma, groove, empuje, clímax), ×
     * `speedAmp`. Solo acelera: a menos velocidad el margen de cada salto se
     * ESTRECHA (hallazgo de la Ola 2), así que frenar por debajo de la base
     * volvería la calma más difícil.
     */
    levelBoost: Object.freeze([0, 0, 0, 0.06, 0.18]),
    /**
     * Techo de velocidad. A 690 px/s un móvil apaisado de 844 px ve cada
     * obstáculo 1 s antes de que llegue; y los huecos mínimos entre acciones
     * (patterns.PAIR_GAP) se midieron hasta 720 px/s.
     */
    maxSpeedPxS: 690,
    /** Un tramo más corto que esto no sube por su nivel (salvo el clímax): un portal cada pocos segundos marea. */
    minLevelSegmentS: 8,
    /** Marchas separadas al menos esto, y del arranque y del clímax. */
    minGearGapS: 16,
    /** Un compás que abre frase (y no tramo) cuesta esta fracción del reparto al elegir dónde va una marcha. */
    phrasePenalty: 0.25,
    /** Frase, en compases: dentro de un tramo largo, una marcha puede caer cada tantos. */
    phraseBars: 8,
    /** Un cambio de menos de esto no se hace: no se nota y exige respirar alrededor. */
    minStepRatio: 0.03,
    /**
     * Antelación mínima del acelerón respecto al primer tiempo que abre el
     * tramo: la de la vista (READER_ADAPT_S). Con menos, la acción de ese
     * primer tiempo se vería llegar a una velocidad que el ojo aún no ha medido.
     */
    pickupMinS: READER_ADAPT_S,
    /** Al soltar tras el clímax, la velocidad baja en tantos beats. */
    releaseBeats: 4,
    /**
     * Error máximo que se acepta a quien juega con la vista (readerOffsetS)
     * al colocar una acción. Alrededor de un acelerón deja sin acciones la
     * pulsación en que ocurre: la respiración antes del tramo nuevo.
     */
    readerBudgetS: 0.02,
});

/**
 * @typedef {Object} SpeedTransition
 * @property {number} t       Instante del cambio (la anacrusa, en los acelerones).
 * @property {number} at      Primer tiempo del compás que lo motiva.
 * @property {number} from    Velocidad anterior (px/s).
 * @property {number} to      Velocidad nueva.
 * @property {'up'|'down'} kind
 * @property {boolean} gear   true si en ese compás entra una marcha.
 */

/**
 * @param {object} p
 * @param {ReturnType<import('./songArc.js').buildSongArc>} p.arc
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} p.model
 * @param {{ speedAmp: number }} p.profile     Perfil de dificultad.
 * @param {number} p.tempoSpeed                Velocidad del pulso de la canción (sin aceleración).
 * @param {number} p.tStart                    Desde cuándo se reparten las marchas.
 * @returns {{ base: number, changes: Array<{ t: number, speedPxS: number, rampS: number }>, transitions: SpeedTransition[], gears: number[] }}
 *          `gears`: primer tiempo de cada marcha que acelera, en orden.
 */
export function planSpeed({ arc, model, profile, tempoSpeed, tStart }) {
    const R = SPEED_RULES;
    const segs = arc.segments;
    if (segs.length === 0 || model.bars.length === 0) return { base: tempoSpeed, changes: [], transitions: [], gears: [] };

    const amp = profile.speedAmp;
    const climax = arc.climax >= 0 ? segs[arc.climax] : null;
    const gearBars = placeGears(arc, model, tStart, climax);

    const levelBoostOf = (seg) => (seg.t1 - seg.t0 >= R.minLevelSegmentS || seg.climax ? R.levelBoost[seg.level] : 0);
    const speedOf = (gear, levelBoost) => Math.round(Math.min(
        Math.max(tempoSpeed, R.maxSpeedPxS),
        tempoSpeed * (1 + amp * (R.gearBoost * gear + levelBoost)),
    ));

    // Compases donde puede cambiar algo: inicio de cada tramo y de cada marcha.
    const points = [...new Set([...segs.map((s) => s.bar0), ...gearBars])].sort((a, b) => a - b);

    // Trinquete sobre el NIVEL, no sobre la velocidad: la subida por nivel es
    // la mayor alcanzada hasta ahí y cada marcha suma siempre encima. Probado
    // antes con trinquete sobre la velocidad: en una canción que arranca
    // empujando ("Instrumental", de la comunidad, 2:55) la marcha intermedia
    // caía en una estrofa, pedía menos que el tramo inicial y desaparecía, así
    // que el nivel solo aceleraba en el clímax. Tras el clímax, un único
    // frenazo: el nivel vuelve al del tramo de después y sigue el trinquete.
    let level = levelBoostOf(segs[0]);
    const base = speedOf(0, level);
    let current = base;
    let released = false;
    const changes = [];
    const transitions = [];
    for (const bar of points) {
        if (bar === 0) continue;
        const seg = segs.find((s) => bar >= s.bar0 && bar < s.bar1);
        const gear = gearBars.filter((b) => b <= bar).length;
        if (climax !== null && bar >= climax.bar1 && !released) {
            released = true;
            level = levelBoostOf(seg);
        } else {
            level = Math.max(level, levelBoostOf(seg));
        }
        const target = speedOf(gear, level);
        if (Math.abs(target - current) < current * R.minStepRatio) continue;

        const at = model.bars[bar].t0;
        const up = target > current;
        const t = up ? pickupTime(model, bar) : at;
        const rampS = up ? 0 : round3(R.releaseBeats * model.beatPeriodS);
        changes.push({ t: round3(t), speedPxS: target, rampS });
        transitions.push({ t: round3(t), at: round3(at), from: current, to: target, kind: up ? 'up' : 'down', gear: gearBars.includes(bar) });
        current = target;
    }

    // Marchas que de verdad aceleran: con el techo de velocidad ya alcanzado, o
    // una subida por debajo de `minStepRatio`, una marcha no cambia nada y no
    // se cuenta.
    const gears = transitions.filter((tr) => tr.gear && tr.kind === 'up').map((tr) => tr.at);
    return { base, changes, transitions, gears };
}

/**
 * Compases de las marchas. La última es el primer compás del clímax; las
 * anteriores se reparten a partes iguales entre `tStart` y el clímax, cada una
 * en el compás candidato más cercano a su reparto: el que abre un tramo o,
 * con una pequeña penalización, el que abre una frase dentro de un tramo largo.
 */
function placeGears(arc, model, tStart, climax) {
    const R = SPEED_RULES;
    if (climax === null) return [];
    const span = climax.t0 - tStart;
    const count = Math.min(R.maxGears, Math.floor(span / R.gearEveryS));
    if (count <= 0) return [];

    const candidates = [];
    for (const seg of arc.segments) {
        if (seg.index > 0) candidates.push({ bar: seg.bar0, phrase: false });
        // Frases dentro del tramo, con al menos medio tramo de frase por delante:
        // una marcha no cae a dos compases de que empiece otro tramo.
        for (let b = seg.bar0 + R.phraseBars; b <= seg.bar1 - R.phraseBars / 2; b += R.phraseBars) {
            candidates.push({ bar: b, phrase: true });
        }
    }

    const spacing = span / count;
    const bars = [];
    let prevT = tStart;
    for (let k = 1; k < count; k++) {
        const ideal = tStart + spacing * k;
        let best = null;
        let bestCost = Infinity;
        for (const c of candidates) {
            const t = model.bars[c.bar].t0;
            if (t < prevT + R.minGearGapS || t > climax.t0 - R.minGearGapS) continue;
            const cost = Math.abs(t - ideal) + (c.phrase ? R.phrasePenalty * spacing : 0);
            if (cost < bestCost - 1e-9) {
                bestCost = cost;
                best = c;
            }
        }
        if (best === null) continue;
        bars.push(best.bar);
        prevT = model.bars[best.bar].t0;
    }
    bars.push(climax.bar0);
    return bars;
}

/**
 * Instante del acelerón que abre el compás `bar`: el último hueco de la
 * rejilla del compás anterior con al menos `pickupMinS` de antelación (el
 * contratiempo del último beat, o ese beat si a la canción no le da medio).
 */
export function pickupTime(model, bar) {
    const at = model.bars[bar].t0;
    const prev = model.bars[bar - 1];
    if (prev === undefined) return at;
    for (let i = prev.slots.length - 1; i >= 0; i--) {
        if (at - prev.slots[i].t >= SPEED_RULES.pickupMinS - 1e-9) return prev.slots[i].t;
    }
    return prev.t0;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
