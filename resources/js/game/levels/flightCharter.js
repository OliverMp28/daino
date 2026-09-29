// Notas mantenidas del vuelo — dónde empieza y acaba cada una en un tramo (Olas 6b-6c).
//
// El vuelo se juega manteniendo: mientras la nota suena, el Dino sube; cuando
// acaba, baja (systems/modes/fly.js). Este módulo convierte un tramo de canción en
// esas notas, con las mismas ideas que el charter de correr:
//
//   1. DÓNDE empieza una nota: en un hueco de la rejilla con golpe o en el pulso
//      con la música sonando (en el pulso siempre; a contratiempo, solo un golpe
//      fuerte y si la dificultad desbloquea contratiempos). Puntúa por la fuerza
//      del golpe y el peso métrico, como `patterns.js`.
//   2. CUÁNTO dura: hasta un golpe con cuerpo que llega entre medio beat y dos
//      beats después (el siguiente o el de después), ajustada a la rejilla; sin
//      golpe, lo que dura un beat.
//   3. CUÁNTAS: las acciones por minuto del nivel del arco en esa dificultad
//      (una nota cuenta como un salto: un gesto musical).
//   4. FRASES ENCADENADAS (Ola 6c). En la 6b el Dino volvía al suelo tras cada
//      nota: quien pulsa a ciegas acumula el error de altura de nota en nota, y el
//      suelo lo pone a cero. Pero quien juega ve el túnel y corrige
//      (virtualPlayer.FLIGHT_PLAYER), así que dentro de una frase de
//      `fly.chainBars` compases (por dificultad) las notas se encadenan por el aire,
//      incluso ligadas (soltando 0.2 s antes de la siguiente); al terminar la
//      frase, el Dino vuelve al suelo. El Dino sube y baja por el aire en vez de
//      hacer una fila de picos desde el suelo, sin pegarse al techo.
//   5. ALTURA CON LA MELODÍA (Ola 6c, analizador 3). Si el tramo tiene melodía
//      que se mueve, cada nota prefiere la duración y el sitio que dejan la cima
//      del Dino a la altura de lo que canta: las notas agudas, arriba; las graves,
//      abajo. La altura es relativa al registro del propio tramo. Sin melodía (o
//      con un análisis que no la trae) se decide solo por el ritmo. Medido con una
//      melodía sintética que sube de 55 a 75 a lo largo del vuelo: las cimas pasan
//      de 60-100 a 120-216.
//   6. MEMORIA DE FRASES: un compás que suena como otro del tramo prefiere empezar
//      sus notas en los mismos golpes (su duración la sigue eligiendo la melodía).
//   7. ESTRENO: las dos primeras notas, en el pulso, separadas y volviendo al
//      suelo; y al final, el Dino en el suelo antes del portal de salida.
//
// Cada compás se decide probando las combinaciones de sus notas (pocas: un compás
// tiene como mucho 8 huecos y 3 finales por hueco), con la altura con la que llega
// del compás anterior. Puro: mismo tramo + misma dificultad ⇒ mismas notas.

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
     * dos gestos) el vuelo de What's Up Danger tenía 4 notas en 13 s.
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
    /** Finales que se prueban para cada nota (golpes con cuerpo en su rango, y el sostenido). */
    endOptions: 3,
    /**
     * Dentro de una frase, respiro mínimo entre dos notas encadenadas. Medido con
     * frases aleatorias y el jugador que corrige (virtualPlayer.FLIGHT_PLAYER): con
     * 0.2 s basta la holgura del túnel más 10 unidades.
     */
    chainRestS: 0.2,
    /** Una nota no deja al Dino pegado al techo más de esto. */
    maxCeilingS: 0.12,
    /** Lo que resta cada nota que falta para llegar a las del compás. */
    missPenalty: 0.25,
    /** Frase que termina sin dejar al Dino en el suelo antes del compás siguiente. */
    unlandedPenalty: 0.3,
    /** Lo que suma cada nota que repite la frase que suena igual. */
    echoBonus: 0.2,
    /**
     * Melodía: cuánto pesa acertar su altura (por altura del pasillo de error, sin
     * contar los primeros `melodyToleranceAlt`), entre qué alturas se reparte…
     * Un peso que pase de la puntuación de una nota hace que el compás prefiera
     * callar antes que no acertar: medido con 0.8 y sin tolerancia, el vuelo de
     * What's Up Danger se quedaba en 5 notas.
     */
    melodyWeight: 0.6,
    melodyToleranceAlt: 25,
    melodyAlt: Object.freeze([40, MAX_ALT - 20]),
    /** …y cuándo se usa: fracción del tramo con melodía y registro mínimo (semitonos). */
    melodyMinVoiced: 0.35,
    melodyMinRange: 3,
});

/**
 * @typedef {Object} FlightNote
 * @property {number} t
 * @property {number} until
 * @property {number} score
 */

/**
 * @param {object} p
 * @param {import('./modePlan.js').ModeSpan} p.span
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} p.model
 * @param {ReturnType<import('./songArc.js').buildSongArc>} p.arc
 * @param {import('./difficulty.js').DifficultyProfile} p.profile
 * @param {(mechanic: string, t: number) => boolean} p.unlocked
 * @returns {{ holds: FlightNote[], melody: boolean, chained: number }}
 *          `melody`: si las alturas siguieron a la melodía; `chained`: notas que
 *          empiezan sin haber vuelto al suelo.
 */
export function chartHolds({ span, model, arc, profile, unlocked }) {
    const R = FLY_RULES;
    const beat = model.beatPeriodS > 0 ? model.beatPeriodS : 0.5;
    const tol = profile.toleranceS;
    const settle = Math.max(FLY_MODE.entryOpenS, MODE_RULES.introBeats * beat - 0.02);
    const firstStart = span.tIn + settle;
    const chainBars = profile.fly?.chainBars ?? 0;
    const melody = melodyTarget(model, span);
    const memory = createPhraseMemory();
    /** @type {Array<FlightNote & { si: number, bar: number, peak: number }>} */
    const holds = [];

    const ctx = { span, beat, tol, chainBars, melody, firstStart };
    for (let b = span.bar0; b < span.bar1; b++) {
        const bar = model.bars[b];
        const level = arc.segments[arc.bars[b].segment].level;
        const target = Math.max(0, Math.round((profile.apm[level] * R.apmShare * (bar.t1 - bar.t0)) / 60));
        const intro = holds.length < MODE_RULES.introActions;

        const options = [];
        bar.slots.forEach((slot, si) => {
            if (slot.t < firstStart) return;
            if (!slot.onBeat && (intro || !unlocked('offbeat', slot.t) || slot.strength < 0.45)) return;
            if (slot.strength === 0 && model.energyMean(slot.t - 0.3, slot.t + 0.3) < 0.06) return;
            const prior = slot.onBeat ? (slot.metric >= 1 ? 0.22 : slot.metric >= 0.8 ? 0.12 : 0.05) : 0;
            const score = Math.pow(slot.strength, 0.8) * (0.55 + 0.45 * slot.metric) + prior;
            for (const until of noteEnds(slot, b, model, beat)) {
                options.push({ t: slot.t, until, score, si, bar: b });
            }
        });

        const signature = barSignature(bar, Infinity);
        const echo = intro ? null : memory.find(b, signature, level, target, 'fly');
        // La frase que suena igual repite DÓNDE empiezan las notas; cuánto duran (y
        // así a qué altura llegan) lo sigue decidiendo la melodía de este compás.
        const echoed = new Set(echo === null ? [] : echo.picks.map((p) => p.si));
        const nextBarT = model.bars[b + 1]?.t0 ?? span.tOut;
        const closesPhrase = chainBars > 0 && ((b - span.bar0 + 1) % chainBars === 0);
        const picked = bestBar(options, holds, target, { ...ctx, echoed, nextBarT, closesPhrase });

        holds.push(...picked);
        memory.remember(b, signature, level, target, picked.map((h) => ({ si: h.si, type: 'hold', event: h })), 'fly');
    }

    // Al final, el Dino en el suelo antes de salir: fuera las notas que no lo permiten.
    while (holds.length > 0 && restEnd(holds[holds.length - 1], tol, holds[holds.length - 1].peak) + R.landBeforeExitS > span.tOut) holds.pop();
    let chained = 0;
    for (let i = 1; i < holds.length; i++) if (holds[i].t < restEnd(holds[i - 1], tol, holds[i - 1].peak) - 1e-9) chained++;
    return {
        holds: holds.map((h) => ({ t: round3(h.t), until: round3(h.until), score: h.score })),
        melody: melody !== null,
        chained,
    };
}

/**
 * Finales posibles de una nota que empieza en `slot` (entre medio beat y dos beats,
 * y `maxHoldS`):
 *   - en un golpe con cuerpo (los primeros `endOptions`): la nota suena hasta
 *     que llega otra; sin ninguno, el hueco más cercano a `sustainBeats`;
 *   - la nota corta, en el primer hueco de la rejilla (encadenadas, una nota larga
 *     tras otra subiría al Dino hasta el techo);
 *   - LIGADA (Ola 6c): soltando `chainRestS` antes de uno de los dos primeros
 *     huecos de la rejilla, para que la nota siguiente empiece ahí casi sin
 *     respiro. Sin ligadas, entre dos notas encadenadas siempre había medio beat
 *     de bajada (0.46 s a 65 BPM) y el Dino volvía al suelo solo: el vuelo era una
 *     fila de picos, no una frase por el aire.
 */
function noteEnds(slot, b, model, beat) {
    const R = FLY_RULES;
    const t = slot.t;
    const minEnd = t + R.minHoldBeats * beat - 0.02;
    const maxEnd = t + Math.min(R.maxHoldBeats * beat, R.maxHoldS) + 1e-6;
    const sustainEnd = t + R.sustainBeats * beat;
    const ends = [];
    const grid = [];
    let shortest = null;
    let sustain = null;
    for (let k = b; k < Math.min(model.bars.length, b + 3); k++) {
        for (const s of model.bars[k].slots) {
            if (s.t <= t + 1e-9) continue;
            if (s.t > maxEnd + R.chainRestS) break;
            if (grid.length < 2 && s.t - R.chainRestS > minEnd) grid.push(s.t);
            if (s.t <= minEnd || s.t > maxEnd) continue;
            if (shortest === null) shortest = s.t;
            if (s.strength >= R.noteStrength && ends.length < R.endOptions) ends.push(s.t);
            if (sustain === null || Math.abs(s.t - sustainEnd) < Math.abs(sustain - sustainEnd)) sustain = s.t;
        }
    }
    if (ends.length === 0 && sustain !== null) ends.push(sustain);
    if (shortest !== null && !ends.includes(shortest)) ends.push(shortest);
    for (const g of grid) {
        const legato = Math.round((g - R.chainRestS) * 1000) / 1000;
        if (legato <= maxEnd && !ends.some((e) => Math.abs(e - legato) < 1e-6)) ends.push(legato);
    }
    return ends.sort((x, y) => x - y);
}

/**
 * Las notas de un compás: la combinación de opciones (en orden de tiempo, sin
 * solaparse) con mejor puntuación dadas las notas ya decididas. Como mucho
 * `target` notas.
 */
function bestBar(options, holds, target, ctx) {
    const R = FLY_RULES;
    const byTime = [...options].sort((a, b) => (a.t - b.t) || (a.until - b.until));
    let best = [];
    let bestScore = score([], 0);

    function score(chosen, fit) {
        let total = fit - R.missPenalty * Math.max(0, target - chosen.length);
        for (const n of chosen) {
            total += n.score;
            if (ctx.echoed.has(n.si)) total += R.echoBonus;
        }
        const last = chosen.length > 0 ? chosen[chosen.length - 1] : null;
        if (ctx.closesPhrase && last !== null && restEnd(last, ctx.tol, last.peak) > ctx.nextBarT + 1e-9) total -= R.unlandedPenalty;
        return total;
    }

    const chosen = [];
    function visit(from, prev, fit) {
        const s = score(chosen, fit);
        if (s > bestScore + 1e-9) {
            best = chosen.slice();
            bestScore = s;
        }
        if (chosen.length >= target) return;
        for (let i = from; i < byTime.length; i++) {
            const opt = byTime[i];
            const note = place(opt, prev, holds.length + chosen.length, ctx);
            if (note === null) continue;
            chosen.push(note);
            visit(i + 1, note, fit + note.fit);
            chosen.pop();
        }
    }
    visit(0, holds.length > 0 ? holds[holds.length - 1] : null, 0);
    return best;
}

/**
 * La nota `opt` tras `prev` (o null), si cabe: con su cima y lo que acierta la
 * melodía. null si no respeta el respiro, el estreno o el techo.
 */
function place(opt, prev, index, ctx) {
    const R = FLY_RULES;
    if (opt.t < ctx.firstStart - 1e-9) return null;
    let alt = 0;
    if (prev !== null) {
        if (opt.t < prev.until + 1e-9) return null;
        const intro = index < MODE_RULES.introActions;
        if (intro && opt.t - prev.t < MODE_RULES.introGapS - 1e-9) return null;
        if (mustLand(prev, opt, index, ctx)) {
            if (opt.t < restEnd(prev, ctx.tol, prev.peak) - 1e-9) return null;
        } else {
            if (opt.t < prev.until + R.chainRestS - 1e-9) return null;
            alt = Math.max(0, prev.peak - FLY_MODE.divePxS * (opt.t - prev.until));
        }
    }
    const len = opt.until - opt.t;
    const room = (MAX_ALT - alt) / FLY_MODE.climbPxS;
    if (len - room > R.maxCeilingS + 1e-9) return null;
    const peak = Math.min(MAX_ALT, alt + FLY_MODE.climbPxS * len);
    let fit = 0;
    const aim = ctx.melody?.(opt.t, opt.until) ?? null;
    if (aim !== null) fit = -R.melodyWeight * Math.max(0, Math.abs(peak - aim) - R.melodyToleranceAlt) / MAX_ALT;
    return { ...opt, peak, fit };
}

/**
 * ¿Debe el Dino volver al suelo entre `prev` y la nota siguiente? Siempre sin
 * frases (`chainBars` 0), en el estreno y entre dos frases.
 */
function mustLand(prev, next, index, ctx) {
    if (ctx.chainBars <= 0 || index <= MODE_RULES.introActions) return true;
    const phrase = (bar) => Math.floor((bar - ctx.span.bar0) / ctx.chainBars);
    return phrase(prev.bar) !== phrase(next.bar);
}

/**
 * Altura objetivo de la cima de una nota según la melodía que suena en ella,
 * repartida entre `melodyAlt` según el registro del tramo; null sin melodía útil.
 */
function melodyTarget(model, span) {
    const R = FLY_RULES;
    const range = model.melodyRange?.(span.tIn, span.tOut) ?? null;
    if (range === null || range.low === null || range.voiced < R.melodyMinVoiced || range.high - range.low < R.melodyMinRange) return null;
    const [low, high] = R.melodyAlt;
    return (t0, t1) => {
        const pitch = model.melodyAt(t0, t1);
        if (pitch === null) return null;
        const k = Math.min(1, Math.max(0, (pitch - range.low) / (range.high - range.low)));
        return low + k * (high - low);
    };
}

/**
 * Cuándo puede empezar la siguiente nota si el Dino debe volver antes al suelo:
 * lo que tarda en bajar desde su cima, más 4 tolerancias de holgura.
 *
 * @param {{ t: number, until: number }} hold
 * @param {number} tol
 * @param {number} [peak]  Cima de la nota; por defecto, la de subir desde el suelo.
 */
export function restEnd(hold, tol, peak = Math.min(MAX_ALT, (hold.until - hold.t) * FLY_MODE.climbPxS)) {
    return hold.until + peak / FLY_MODE.divePxS + 4 * tol + FLY_RULES.restSlackS;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
