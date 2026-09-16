// Notas mantenidas del vuelo — dónde empieza y acaba cada una en un tramo (Ola 6b).
//
// El vuelo se juega manteniendo: mientras la nota suena, el Dino sube; cuando
// acaba, baja (systems/modes/fly.js). Este módulo convierte un tramo de canción en
// esas notas, con las mismas ideas que el charter de correr:
//
//   1. DÓNDE empieza una nota: en un hueco de la rejilla con golpe o en el pulso
//      con la música sonando (en el pulso siempre; a contratiempo, solo un golpe
//      fuerte y si la dificultad desbloquea contratiempos). Puntúa por la fuerza
//      del golpe y el peso métrico, como `patterns.js`.
//   2. CUÁNTO dura: hasta el siguiente golpe con cuerpo (la nota suena hasta que
//      llega la siguiente), entre medio beat y dos beats, ajustada a la rejilla.
//      Si no llega ninguno, un beat: en un pasaje que calla, la nota se sostiene.
//   3. CUÁNTAS: las acciones por minuto del nivel del arco en esa dificultad
//      (una nota cuenta como un salto: un gesto musical).
//   4. VUELTA AL SUELO entre notas. La altura del Dino es la suma de todo lo
//      mantenido, así que un error de tiempo en una nota desplaza todas las
//      siguientes; el suelo lo pone a cero (medido: sin esta regla, un jugador
//      con ±40 ms choca a la tercera nota; con ella, ninguna dificultad falla).
//      El silencio tras una nota dura lo que tarda en bajar más 4 tolerancias.
//   5. MEMORIA DE FRASES: un compás que suena como otro del tramo repite sus notas.
//   6. ESTRENO: las dos primeras notas, en el pulso y separadas; y al final, el
//      Dino vuelve al suelo antes del portal de salida.
//
// Puro: mismo tramo + misma dificultad ⇒ mismas notas.

import { FLY_MODE } from '../config.js';
import { MAX_ALT } from '../systems/flightCourse.js';
import { MODE_RULES } from './modePlan.js';
import { barSignature, createPhraseMemory } from './patterns.js';

/**
 * Reglas del vuelo. Cambiar cualquiera altera los charts: sube `CHARTER_VERSION`.
 */
export const FLY_RULES = Object.freeze({
    /** Nota más corta y más larga, en beats. */
    minHoldBeats: 0.5,
    maxHoldBeats: 2,
    /** Nota más larga en segundos (a más, el Dino se queda pegado al techo sin nada que jugar). */
    maxHoldS: 1.1,
    /**
     * Fracción de las acciones por minuto del nivel. Medido: con 0.5 (una nota =
     * dos gestos) el vuelo de What's Up Danger tenía 4 notas en 13 s; la vuelta al
     * suelo ya limita la densidad por sí sola.
     */
    apmShare: 1,
    /** Holgura del silencio tras bajar, además de las 4 tolerancias. */
    restSlackS: 0.04,
    /** Fuerza de golpe con la que se considera que "llega otra nota". */
    noteStrength: 0.2,
    /** Duración de una nota tras la que no llega ninguna, en beats. */
    sustainBeats: 1,
    /** Tras la última nota, el Dino debe estar en el suelo esto antes del portal de salida. */
    landBeforeExitS: 0.3,
});

/**
 * @param {object} p
 * @param {import('./modePlan.js').ModeSpan} p.span
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} p.model
 * @param {ReturnType<import('./songArc.js').buildSongArc>} p.arc
 * @param {import('./difficulty.js').DifficultyProfile} p.profile
 * @param {(mechanic: string, t: number) => boolean} p.unlocked
 * @returns {Array<{ t: number, until: number, score: number }>}
 */
export function chartHolds({ span, model, arc, profile, unlocked }) {
    const R = FLY_RULES;
    const beat = model.beatPeriodS > 0 ? model.beatPeriodS : 0.5;
    const tol = profile.toleranceS;
    const settle = Math.max(FLY_MODE.entryOpenS, MODE_RULES.introBeats * beat - 0.02);
    const firstStart = span.tIn + settle;
    const memory = createPhraseMemory();
    const holds = [];
    let nextAllowed = firstStart;

    for (let b = span.bar0; b < span.bar1; b++) {
        const bar = model.bars[b];
        const arcBar = arc.bars[b];
        const level = arc.segments[arcBar.segment].level;
        const exact = (profile.apm[level] * R.apmShare * (bar.t1 - bar.t0)) / 60;
        const target = Math.max(0, Math.round(exact));
        // Estreno: las primeras notas del tramo, solo en el pulso y separadas.
        const intro = holds.length < MODE_RULES.introActions;

        const candidates = [];
        bar.slots.forEach((slot, si) => {
            if (slot.t < firstStart) return;
            if (!slot.onBeat && (intro || !unlocked('offbeat', slot.t) || slot.strength < 0.45)) return;
            if (slot.strength === 0 && model.energyMean(slot.t - 0.3, slot.t + 0.3) < 0.06) return;
            const prior = slot.onBeat ? (slot.metric >= 1 ? 0.22 : slot.metric >= 0.8 ? 0.12 : 0.05) : 0;
            candidates.push({ slot, si, score: Math.pow(slot.strength, 0.8) * (0.55 + 0.45 * slot.metric) + prior });
        });

        const signature = barSignature(bar, Infinity);
        const echo = intro ? null : memory.find(b, signature, level, target, 'fly');
        // Primero lo que repite la frase que suena igual; después, por importancia.
        const byScore = [...candidates].sort((x, y) => (y.score - x.score) || (x.slot.t - y.slot.t));
        const echoed = echo === null ? [] : echo.picks.map((p) => candidates.find((c) => c.si === p.si)).filter(Boolean);
        const order = [...echoed, ...byScore.filter((c) => !echoed.includes(c))];

        const picked = [];
        for (const cand of order) {
            if (picked.length >= target) break;
            // En orden de puntuación, pero una nota solo cabe si respeta la vuelta al
            // suelo de la anterior y de la siguiente ya elegidas en este compás.
            const hold = holdFrom(cand, bar, b, model, beat);
            if (hold === null) continue;
            const trial = [...holds, ...picked, hold].sort((x, y) => x.t - y.t);
            if (hold.t < nextAllowed - 1e-9 || !restsOk(trial, tol)) continue;
            picked.push(hold);
        }
        picked.sort((x, y) => x.t - y.t);
        holds.push(...picked);
        if (holds.length > 0) nextAllowed = restEnd(holds[holds.length - 1], tol);
        memory.remember(b, signature, level, target, picked.map((h) => ({ si: h.si, type: 'hold', event: h })), 'fly');
    }

    // Al final, el Dino en el suelo antes de salir: fuera las notas que no lo permiten.
    while (holds.length > 0 && restEnd(holds[holds.length - 1], tol) + R.landBeforeExitS > span.tOut) holds.pop();
    return holds.map((h) => ({ t: round3(h.t), until: round3(h.until), score: h.score }));
}

/**
 * Nota que empieza en `cand`: dura hasta el siguiente golpe con cuerpo, entre
 * medio beat y dos beats (y `maxHoldS`), acabando en un hueco de la rejilla. Sin
 * golpe en ese rango, el hueco más cercano a `sustainBeats`.
 */
function holdFrom(cand, bar, b, model, beat) {
    const R = FLY_RULES;
    const t = cand.slot.t;
    const minEnd = t + R.minHoldBeats * beat - 0.02;
    const maxEnd = t + Math.min(R.maxHoldBeats * beat, R.maxHoldS) + 1e-6;
    const sustainEnd = t + R.sustainBeats * beat;
    let sustain = null;
    for (let k = b; k < Math.min(model.bars.length, b + 3); k++) {
        for (const slot of model.bars[k].slots) {
            if (slot.t <= minEnd) continue;
            if (slot.t > maxEnd) return sustain === null ? null : { t, until: sustain, score: cand.score, si: cand.si };
            if (slot.strength >= R.noteStrength) return { t, until: slot.t, score: cand.score, si: cand.si };
            if (sustain === null || Math.abs(slot.t - sustainEnd) < Math.abs(sustain - sustainEnd)) sustain = slot.t;
        }
    }
    return sustain === null ? null : { t, until: sustain, score: cand.score, si: cand.si };
}

/** Cuándo puede empezar la siguiente nota: el Dino ya ha vuelto al suelo, con 4 tolerancias de holgura. */
export function restEnd(hold, tol) {
    const peak = Math.min(MAX_ALT, (hold.until - hold.t) * FLY_MODE.climbPxS);
    return hold.until + peak / FLY_MODE.divePxS + 4 * tol + FLY_RULES.restSlackS;
}

/** ¿Respetan estas notas (en orden) la vuelta al suelo y el estreno? */
function restsOk(holds, tol) {
    for (let i = 1; i < holds.length; i++) {
        if (holds[i].t < restEnd(holds[i - 1], tol) - 1e-9) return false;
        if (i < MODE_RULES.introActions && holds[i].t - holds[i - 1].t < MODE_RULES.introGapS - 1e-9) return false;
    }
    return true;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
