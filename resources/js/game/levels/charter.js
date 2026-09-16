// Charter — convierte un análisis musical en un nivel (Ola 5: charter musical).
//
// Segunda mitad de la separación ANÁLISIS / CHARTING (doc 10 §2.1). Función
// pura: mismo análisis + misma seed + misma dificultad ⇒ mismo chart, byte a
// byte. Sin audio, sin DOM, sin Pixi; cuesta milisegundos.
//
// Por qué se reescribió (medido en los 8 oficiales con el charter v2):
//   - Densidad PLANA: 55-65 acciones/min en intro, estrofa, estribillo y outro
//     por igual. La música subía y bajaba; el nivel no.
//   - Ritmo IRREGULAR: hasta un 34 % de los obstáculos fuera de la rejilla de
//     beats y contratiempos, con huecos de 1.25 y 1.75 beats sin intención.
//   - Sin estructura: el último estribillo igual que el primer verso, ningún
//     momento preparado, ningún final.
//
// El nivel se construye como lo haría quien diseña a mano:
//
//   musicModel   compases, pulsos y contratiempos, color de cada golpe
//   songArc      tramos, niveles de intensidad, clímax, subidas y drops
//   difficulty   cuánto se llena cada nivel, con qué margen, qué se desbloquea
//   speedPlan    marchas hacia el clímax y en qué pulsación acelera el mundo
//   modePlan     qué momentos de la canción cambian las reglas del cuerpo y con
//                qué modo (antigravedad, vuelo), según cómo suena cada tramo (Ola 6)
//   flightCharter  las notas mantenidas de cada tramo de vuelo (Ola 6b)
//   patterns     compás a compás: dónde va cada acción y cuál, con memoria de
//                frases (un riff que vuelve es un patrón que vuelve)
//   aquí         silencios demasiado largos, tipo de obstáculo, validación
//                jugando y eventos para el runtime
//
// La progresión hacia el final no es "más rápido cada N segundos": sale de la
// canción. Las mecánicas se estrenan en momentos del arco (agacharse en el
// primer groove, cactus anchos y síncopas al empezar a empujar, combinaciones
// rápidas en el clímax), el mismo material suena más intenso cada vez que
// vuelve, el mundo sube de marcha en compases que abren tramo o frase sin
// volver a frenar hasta el clímax, y el clímax es lo más denso y lo más rápido
// antes de soltar en la outro.

import { OBSTACLE_KIND, speedFromBpm } from '../config.js';
import { actionLeadS } from '../systems/physics.js';
import { toSimHolds, toSimModes, toSimObstacles, validatePlayability, timingWindowS, readerOffsetS } from '../systems/playability.js';
import { createFlightCourse, flightMargin } from '../systems/flightCourse.js';
import { createSpeedProfile } from '../systems/speedProfile.js';
import { SPEED_RULES, planSpeed } from './speedPlan.js';
import { MODE_RULES, createModeGuide, modeEvents, planModes } from './modePlan.js';
import { chartHolds } from './flightCharter.js';
import { Seeded } from './Seed.js';
import {
    CHART_FORMAT_VERSION,
    CHARTER_NAME,
    CHARTER_VERSION,
    compactChart,
    seedFromSha256,
} from './chartFormat.js';
import { buildMusicModel } from './musicModel.js';
import { buildSongArc } from './songArc.js';
import { difficultyCeiling } from './difficultyCeiling.js';
import {
    DIFFICULTY_PROFILES,
    STAGE,
    normalizeRequestedDifficulty,
    resolveDifficulty,
} from './difficulty.js';
import { PAIR_GAP, chooseBarActions, createPhraseMemory, duckThreshold, pairGap } from './patterns.js';

/**
 * Reglas del charter. Cambiar cualquiera altera los charts generados: sube
 * `CHARTER_VERSION` en chartFormat.js al hacerlo.
 */
export const CHARTER_RULES = Object.freeze({
    /**
     * Primera acción no antes de este segundo. Da tiempo a que la música
     * arranque y a que el primer obstáculo entre desde el borde de la pantalla.
     */
    firstActionMinS: 3.0,
    /** Tras el último cruce, la canción termina sin obstáculos (descanso final). */
    tailRestS: 2.0,
    /** Primeras acciones "de tutorial": saltos en tiempos fuertes, bien espaciados. */
    introActions: 3,
    /**
     * Rango del tempo que decide la velocidad BASE (Ola 4). Una canción a 63 BPM
     * se juega con la velocidad de 126: mismo pulso musical y sin el scroll
     * lento que estrecha el margen de cada salto.
     */
    speedTempoMin: 90,
    speedTempoMax: 200,
    // La aceleración del mundo vive en speedPlan.js (SPEED_RULES).
    /** Un cactus de acento solo si su margen de error supera N veces la tolerancia. */
    accentWindowFactor: 2.4,
    /** En un tramo de reposo, el silencio de juego máximo (`maxRestS`) se alarga tanto. */
    restLevelFactor: 1.6,
    /** Techo de reparaciones del validador (defensa ante bucles). */
    maxRepairs: 400,
});

/**
 * Tempo con el que se calcula la velocidad base: el real, doblado o dividido
 * por dos hasta caer en [speedTempoMin, speedTempoMax].
 *
 * @param {number} bpm
 * @returns {number}
 */
export function gameplayTempo(bpm) {
    let t = bpm > 0 ? bpm : 120;
    for (let i = 0; i < 3 && t < CHARTER_RULES.speedTempoMin; i++) t *= 2;
    for (let i = 0; i < 3 && t > CHARTER_RULES.speedTempoMax; i++) t /= 2;
    return t;
}

/**
 * @typedef {Object} ChartReport
 * @property {number} onsetsIn        Onsets recibidos del análisis.
 * @property {number} obstacles       Obstáculos del chart final.
 * @property {number} fillers         Acciones añadidas para cortar silencios de juego demasiado largos.
 * @property {number} repaired        Acciones eliminadas o suavizadas por el validador.
 * @property {number} difficulty      Dificultad efectiva (1-5).
 * @property {'auto'|number} requested
 * @property {number|null} ceiling
 * @property {number} segments
 * @property {{ t0: number, t1: number } | null} climax
 * @property {number} speedChanges
 * @property {number[]} gears         Primer tiempo de cada marcha (la última, el clímax).
 * @property {number} topSpeedPxS     Velocidad máxima del nivel.
 * @property {Array<{ mode: string, t0: number, t1: number, score: number }>} modes  Momentos con otro modo de movimiento.
 * @property {number} holds           Notas mantenidas (vuelo).
 */

/**
 * @param {import('./analyze.js').Analysis} analysis  Formato 1 o 2.
 * @param {{ seed?: number, sha256?: string | null, difficulty?: 'auto' | number }} [opts]
 *        Sin `seed`, se deriva del hash del audio (mismo archivo ⇒ mismo nivel).
 *        `difficulty`: la que pide quien sube la canción; 'auto' por defecto.
 * @returns {{ chart: import('./chartFormat.js').Chart, report: ChartReport }}
 */
export function buildChart(analysis, opts = {}) {
    const sha256 = opts.sha256 ?? null;
    const seedInput = opts.seed ?? (sha256 !== null ? seedFromSha256(sha256) : undefined);
    const prng = new Seeded(seedInput);

    const requested = normalizeRequestedDifficulty(opts.difficulty);
    const ceiling = difficultyCeiling(analysis)?.ceiling ?? null;
    const difficulty = resolveDifficulty(requested, ceiling);
    const profile = DIFFICULTY_PROFILES[difficulty];

    const model = buildMusicModel(analysis);
    const arc = buildSongArc(model);

    const tempoSpeed = speedFromBpm(gameplayTempo(model.bpm)) * (profile.baseSpeed ?? 1);
    const speedPlanOut = planSpeed({ arc, model, profile, tempoSpeed, tStart: CHARTER_RULES.firstActionMinS });
    const baseSpeed = speedPlanOut.base;
    const speedChanges = speedPlanOut.changes;
    const speed = createSpeedProfile(baseSpeed, speedChanges);
    const readerOk = readerCheck(speed);

    const unlockTimes = unlockSchedule(arc, profile);
    const unlocked = (mechanic, t) => t >= unlockTimes[mechanic];

    const maxLead = Math.max(...Object.values(OBSTACLE_KIND).map(actionLeadS));
    const tMin = CHARTER_RULES.firstActionMinS;
    const tMax = model.durationSec - CHARTER_RULES.tailRestS - maxLead;

    const plan = tMax > tMin ? planModes({ arc, model, profile, tMax }) : [];
    // El túnel del vuelo tiene la holgura de la dificultad a la velocidad más lenta del tramo.
    for (const span of plan) {
        if (span.mode === 'fly') span.margin = flightMargin(profile.toleranceS, minSpeedIn(speed, span.tIn, span.tOut));
    }
    const modes = createModeGuide(plan, model.beatPeriodS);
    const structure = [...structureEvents(arc), ...modeEvents(plan)];
    const simModes = toSimModes(structure);

    const ctx = { model, arc, profile, speed, readerOk, unlocked, tMin, tMax, prng, modes, simModes, structure };
    let actions = [];
    let holds = [];
    let fillers = 0;
    let repaired = 0;
    if (tMax > tMin && model.bars.length > 0) {
        actions = chartActions(ctx);
        const before = actions.length;
        actions = fillLongRests(actions, ctx);
        fillers = actions.length - before;
        assignKinds(actions, ctx);
        for (const span of plan) {
            if (span.mode === 'fly') holds.push(...chartHolds({ span, model, arc, profile, unlocked }));
        }
        repaired = repairUnplayable(actions, holds, ctx);
    }

    const events = [
        ...structure,
        ...holds.map((h) => ({ t: h.t, type: 'hold', until: h.until })),
        ...actions.map((a) => ({ t: round3(a.t), type: 'obstacle', kind: a.kind })),
    ].sort((a, b) => (a.t - b.t) || (EVENT_ORDER[a.type] - EVENT_ORDER[b.type]));

    const climax = arc.climax >= 0 ? arc.segments[arc.climax] : null;
    const chart = compactChart({
        formatVersion: CHART_FORMAT_VERSION,
        charter: { name: CHARTER_NAME, version: CHARTER_VERSION },
        seed: prng.seed,
        audio: { sha256, durationSec: model.durationSec, sampleRate: analysis.sampleRate },
        music: {
            bpm: analysis.bpm,
            bpmConfidence: analysis.bpmConfidence,
            beatPeriodS: analysis.beatPeriodS > 0 ? analysis.beatPeriodS : 60 / analysis.bpm,
            beats: Array.from(model.beats, round3),
            downbeats: Array.from(model.beats).filter((_, i) => model.isDownbeat[i] === 1).map(round3),
        },
        difficulty: { level: difficulty, requested, ceiling },
        world: { speedPxS: baseSpeed, speedChanges },
        events,
    });

    return {
        chart,
        report: {
            onsetsIn: analysis.onsets.length,
            obstacles: actions.length,
            fillers,
            repaired,
            difficulty,
            requested,
            ceiling,
            segments: arc.segments.length,
            climax: climax === null ? null : { t0: round3(climax.t0), t1: round3(climax.t1) },
            speedChanges: speedChanges.length,
            gears: speedPlanOut.gears,
            topSpeedPxS: speed.maxSpeed,
            modes: plan.map((s) => ({ mode: s.mode, t0: s.tIn, t1: s.tOut, at: s.at, score: s.score })),
            holds: holds.length,
        },
    };
}

/** A igual instante: la sección, su efecto, el portal, la nota mantenida y, al final, el obstáculo. */
const EVENT_ORDER = Object.freeze({ section: 0, fx: 1, mode: 2, hold: 3, obstacle: 4 });

/** Velocidad más lenta del mundo en [t0, t1]. */
function minSpeedIn(speed, t0, t1) {
    let min = Math.min(speed.speedAt(t0), speed.speedAt(t1));
    for (let t = t0; t < t1; t += 0.25) min = Math.min(min, speed.speedAt(t));
    return min;
}

// --------------------------- Velocidad ---------------------------

/**
 * ¿Se puede colocar una acción de este tipo en `t` sin engañar a quien juega
 * con la vista? Con velocidad constante, siempre. Alrededor de un cambio de
 * velocidad, solo si el error de su pulsación (playability.readerOffsetS) cabe
 * en `SPEED_RULES.readerBudgetS` con el adelanto de cada kind de ese tipo: un
 * kind futuro con adelanto propio queda cubierto sin tocar nada.
 *
 * @param {import('../systems/speedProfile.js').SpeedProfile} speed
 * @returns {(t: number, type: 'jump'|'duck'|'flip') => boolean}
 */
function readerCheck(speed) {
    if (speed.constant) return () => true;
    const leads = {};
    for (const def of Object.values(OBSTACLE_KIND)) {
        const list = leads[def.action] ?? (leads[def.action] = []);
        const lead = actionLeadS(def);
        if (!list.includes(lead)) list.push(lead);
    }
    return (t, type) => (leads[type] ?? []).every((lead) => Math.abs(readerOffsetS(speed, t, lead)) <= SPEED_RULES.readerBudgetS);
}

// --------------------------- Desbloqueo de mecánicas ---------------------------

/**
 * Instante desde el que cada mecánica puede aparecer, según las etapas del arco:
 *   START         desde el principio
 *   FIRST_GROOVE  primer tramo de groove o más (nunca antes del segundo 8)
 *   FIRST_DRIVE   primer tramo que empuja tras ese groove (o el siguiente groove)
 *   CLIMAX        el clímax
 */
export function unlockSchedule(arc, profile) {
    const segs = arc.segments;
    const climax = arc.climax >= 0 ? segs[arc.climax] : null;
    const groove = segs.find((s) => s.level >= 2);
    const s1 = groove !== undefined ? Math.max(groove.t0, 8) : (climax?.t0 ?? Infinity);
    const s3 = climax !== null ? Math.max(climax.t0, s1) : Infinity;
    const drive = segs.find((s) => s.level >= 3 && s.t0 >= s1 - 1e-6)
        ?? segs.find((s) => s.level >= 2 && groove !== undefined && s.index > groove.index);
    // Lo que se estrena "al empujar" nunca llega después del clímax.
    const s2 = Math.min(s3, Math.max(s1, drive !== undefined ? drive.t0 : s3));

    const at = (stage) => {
        switch (stage) {
            case STAGE.START: return 0;
            case STAGE.FIRST_GROOVE: return s1;
            case STAGE.FIRST_DRIVE: return s2;
            case STAGE.CLIMAX: return s3;
            default: return Infinity;
        }
    };
    return {
        duck: at(profile.unlock.duck),
        wide: at(profile.unlock.wide),
        offbeat: at(profile.unlock.offbeat),
        combo: at(profile.unlock.combo),
    };
}

// --------------------------- Acciones ---------------------------

function chartActions(ctx) {
    const { model, arc, profile, speed, readerOk, unlocked, tMin, tMax, modes } = ctx;
    const memory = createPhraseMemory();
    const threshold = duckThreshold(model);
    const placed = [];
    /** Acciones colocadas en cada tramo de modo (para su estreno). */
    const spanCounts = new Map();

    let segment = -1;
    let previousPositions = null;
    let segmentCounts = { airDucks: 0, airTotal: 0 };

    for (const bar of model.bars) {
        const arcBar = arc.bars[bar.index];
        const seg = arc.segments[arcBar.segment];
        if (arcBar.segment !== segment) {
            segment = arcBar.segment;
            previousPositions = null;
            segmentCounts = { airDucks: 0, airTotal: 0 };
        }
        if (bar.t1 <= tMin || bar.t0 > tMax) continue;

        // Densidad: la del nivel, algo más o menos según lo lleno que suene
        // este compás dentro de su tramo. En la subida a un drop se acerca a la
        // del nivel que viene (un 35 % y un 60 % del camino): la tensión crece
        // hacia el drop y el último beat se deja en silencio (patterns.js).
        let levelApm = profile.apm[seg.level];
        if (arcBar.build > 0) {
            const upcoming = arc.segments[arcBar.segment + 1];
            if (upcoming !== undefined) {
                const k = arcBar.build === 1 ? 0.35 : 0.6;
                levelApm += (profile.apm[upcoming.level] - levelApm) * k;
            }
        }
        // Modulación por lo lleno que suena el compás, en décimas: el ruido de la
        // energía entre dos compases de un mismo riff no debe cambiar cuántas
        // acciones lleva cada uno (con más densidad por compás, un ±2 % cruzaba el
        // redondeo a cuartos y la frase dejaba de repetirse).
        const apm = levelApm * (1 + Math.round(clamp((arcBar.intensity - seg.intensity) * 1.2, -0.25, 0.25) * 10) / 10);
        const exact = (apm * (bar.t1 - bar.t0)) / 60;
        // Reparto periódico de la parte decimal (Bresenham) por posición en el
        // tramo, con la fracción llevada a cuartos: 2.5 acciones por compás dan
        // 2-3-2-3 y 2.25 dan 2-2-2-3, así que la acción extra cae siempre en el
        // mismo compás de cada frase de 2 o 4 (el último, donde suelen ir los
        // fills). Medido antes: con un arrastre de decimales un riff repetido
        // salía "J J" / "J D J" / "J D J D" sin periodo, y con la fracción exacta
        // (0.6) el periodo era de 5 compases; en ambos casos la memoria de frases
        // no podía repetir la frase.
        let whole = Math.floor(exact + 1e-9);
        let frac = Math.round((exact - whole) * 4) / 4;
        if (frac >= 1) {
            whole++;
            frac = 0;
        }
        const k = arcBar.inSegment;
        const target = whole + Math.floor((k + 1) * frac + 1e-6) - Math.floor(k * frac + 1e-6);

        const span = modes.spanAt(bar.t0);
        const spanCount = span === null ? 0 : (spanCounts.get(span) ?? 0);
        const chosen = chooseBarActions({
            bar,
            nextBar: model.bars[bar.index + 1] ?? null,
            nextArcBar: arc.bars[bar.index + 1] ?? null,
            arcBar,
            segment: seg,
            target,
            placed,
            speedAt: speed.speedAt,
            readerOk,
            profile,
            unlocked,
            tMin,
            tMax,
            threshold,
            hasColor: model.onsets.hasColor,
            meter: model.meter,
            energyMean: model.energyMean,
            memory,
            previousPositions,
            segmentCounts,
            introActions: Math.max(0, CHARTER_RULES.introActions - placed.length),
            modes,
            modeIntroLeft: span?.first ? Math.max(0, MODE_RULES.introActions - spanCount) : 0,
        });

        for (const a of chosen) {
            placed.push(a);
            if (a.type === 'flip') {
                const s = modes.spanAt(a.t);
                if (s !== null) spanCounts.set(s, (spanCounts.get(s) ?? 0) + 1);
                continue;
            }
            segmentCounts.airTotal++;
            if (a.type === 'duck') segmentCounts.airDucks++;
        }
        previousPositions = new Set(chosen.map((a) => a.slot.pos));
    }
    return placed;
}

/**
 * Corta los silencios de juego demasiado largos mientras la música suena: una
 * acción en el tiempo con más golpe cerca del centro del hueco (un salto o, si no
 * cabe entre sus vecinas y la dificultad lo permite, un agachado). Donde la
 * música calla de verdad (un break en silencio), el nivel también calla.
 *
 * Tras el playtest de la 6b: con silencios de hasta 4.5-8 s por dificultad, un
 * compás entero sin nada que hacer era lo normal en las canciones de 60-95 BPM
 * (What's Up Danger en Extremo: 16 huecos de 2 s o más). Ahora el máximo va de
 * 3.2 s (Relajado) a 1.4 s (Extremo), algo más en los tramos de reposo.
 */
function fillLongRests(actions, ctx) {
    const { model, arc, profile, speed, readerOk, tMin, tMax, unlocked, modes } = ctx;
    const out = actions.slice();
    // El estreno de cada modo (sus primeras acciones, espaciadas) no se rellena.
    const debutEnd = new Map();
    for (const span of modes.plan) {
        const own = actions.filter((x) => x.t >= span.tIn && x.t < span.tOut);
        debutEnd.set(span, own[MODE_RULES.introActions - 1]?.t ?? span.tOut);
    }
    for (let guard = 0; guard < 2000; guard++) {
        let inserted = false;
        // Tampoco el tutorial del principio: sus saltos van espaciados a propósito.
        for (let i = CHARTER_RULES.introActions - 1; i < out.length; i++) {
            const a = i >= 0 ? out[i] : null;
            const b = i + 1 < out.length ? out[i + 1] : null;
            const rest = longestRest(a !== null ? a.t : tMin, b !== null ? b.t : tMax, modes.freeSpans);
            if (rest === null) continue;
            const { from, to } = rest;
            const mid = (from + to) / 2;
            const resting = arc.bars[barAt(model, mid)]?.level === 0;
            if (to - from <= profile.maxRestS * (resting ? CHARTER_RULES.restLevelFactor : 1)) continue;
            if (model.energyMean(from, to) < 0.12) continue;

            let best = null;
            let bestType = 'jump';
            let bestScore = -Infinity;
            for (const bar of model.bars) {
                if (bar.t1 < from || bar.t0 > to) continue;
                for (const slot of bar.slots) {
                    if (!slot.onBeat || slot.t < tMin || slot.t > tMax || !modes.allows(slot.t)) continue;
                    if (a === null && slot.t < from) continue;
                    const span = modes.spanAt(slot.t);
                    if (span !== null && slot.t <= debutEnd.get(span)) continue;
                    // El relleno es la acción básica de cada modo: saltar o invertir; al
                    // correr, agacharse si un salto no cabe.
                    const flip = modes.modeAt(slot.t) === 'flip';
                    const types = flip ? ['flip'] : unlocked('duck', slot.t) ? ['jump', 'duck'] : ['jump'];
                    for (const type of types) {
                        if (!readerOk(slot.t, type)) continue;
                        if (a !== null && slot.t - a.t < pairGap(a.type, type, speed.speedAt(slot.t), profile, unlocked('combo', slot.t)) + 0.1) continue;
                        if (b !== null && b.t - slot.t < pairGap(type, b.type, speed.speedAt(b.t), profile, unlocked('combo', b.t)) + 0.1) continue;
                        const score = slot.strength + 0.3 * slot.metric - (0.4 * Math.abs(slot.t - mid)) / (to - from) - (type === 'duck' ? 0.2 : 0);
                        if (score > bestScore) {
                            bestScore = score;
                            best = slot;
                            bestType = type;
                        }
                        break;
                    }
                }
            }
            if (best === null) continue;
            out.splice(i + 1, 0, {
                t: best.t, type: bestType, slot: best, score: 0.15, forced: false,
                bar: best.bar, segment: ctx.arc.bars[best.bar].segment, echo: null,
            });
            inserted = true;
            break;
        }
        if (!inserted) break;
    }
    return out;
}

/** Compás que contiene `t` (el último si `t` pasa del final). */
function barAt(model, t) {
    const bars = model.bars;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (bars[m].t0 <= t) lo = m;
        else hi = m - 1;
    }
    return lo;
}

/**
 * Silencio de juego más largo dentro de [from, to]: un tramo que se juega sin
 * obstáculos (el vuelo) corta el hueco en dos, el de antes y el de después.
 */
function longestRest(from, to, freeSpans) {
    let best = null;
    let cursor = from;
    const consider = (a, b) => {
        if (b > a && (best === null || b - a > best.to - best.from)) best = { from: a, to: b };
    };
    for (const s of freeSpans) {
        if (s.tOut <= cursor || s.tIn >= to) continue;
        consider(cursor, Math.min(s.tIn, to));
        cursor = Math.max(cursor, s.tOut);
    }
    consider(cursor, to);
    return best;
}

// --------------------------- Tipo de obstáculo ---------------------------

function assignKinds(actions, ctx) {
    const { model, profile, speed, unlocked, prng } = ctx;
    const tol = profile.toleranceS;
    const jj = PAIR_GAP.jumpJump(0, tol);

    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.type === 'flip') continue;
        if (a.type === 'duck') {
            a.kind = pickKindForRole('duck', prng);
            continue;
        }
        const prev = actions[i - 1];
        const next = actions[i + 1];
        const cross = a.t + actionLeadS(OBSTACLE_KIND.CACTUS_SMALL);
        const roomy = (prev === undefined || a.t - prev.t >= jj + 0.15) && (next === undefined || next.t - a.t >= jj + 0.15);
        let recentAccents = 0;
        for (let k = Math.max(0, i - 6); k < i; k++) if (OBSTACLE_KIND[actions[k].kind]?.role === 'accent') recentAccents++;
        const accentKind = pickKindForRole('accent', null);
        const windowOk = accentKind !== null && timingWindowS(accentKind, speed.speedAt(cross)) >= CHARTER_RULES.accentWindowFactor * tol;
        const allowed = unlocked('wide', a.t) && roomy && windowOk && recentAccents < 2;

        let role = 'jump';
        if (allowed) {
            if (a.echo !== null && a.echo.kind !== undefined) {
                // Frase repetida: el mismo obstáculo que la primera vez.
                role = OBSTACLE_KIND[a.echo.kind]?.role === 'accent' ? 'accent' : 'jump';
            } else {
                const accent = a.forced || (a.slot.metric >= 0.8 && a.slot.strength >= 0.55 && (!model.onsets.hasColor || a.slot.low >= 0.34));
                if (accent || prng.next() < 0.1) role = 'accent';
            }
        }
        a.kind = pickKindForRole(role, prng) ?? pickKindForRole('jump', prng);
    }
    assignFlipKinds(actions, ctx);
}

/**
 * Cristales de la antigravedad: cada inversión la obliga un cristal en la
 * superficie que el Dino deja, así que dentro de cada tramo alternan suelo y
 * techo empezando por el suelo (se entra corriendo por el suelo). Se recalcula
 * entero tras cada reparación: quitar una inversión cambia la superficie de las
 * siguientes. Sin azar: el mismo chart en cualquier orden de reparación.
 */
function assignFlipKinds(actions, ctx) {
    let span = null;
    let onFloor = true;
    for (const a of actions) {
        if (a.type !== 'flip') continue;
        const s = ctx.modes.spanAt(a.t);
        if (s !== span) {
            span = s;
            onFloor = true;
        }
        a.kind = pickKindForRole('flip', null, onFloor ? 'floor' : 'ceiling');
        onFloor = !onFloor;
    }
}

/**
 * Kind del registro para un papel musical (y superficie, si se pide). Si hay
 * varios, ruleta por `weight` con la seed del nivel; con uno solo no se consume azar.
 */
function pickKindForRole(role, prng, surface = null) {
    const kinds = Object.entries(OBSTACLE_KIND).filter(([, def]) => def.role === role && (surface === null || def.surface === surface));
    if (kinds.length === 0) return null;
    if (kinds.length === 1 || prng === null) return kinds[0][0];
    const total = kinds.reduce((s, [, def]) => s + (def.weight ?? 1), 0);
    const r = prng.next() * total;
    let acc = 0;
    for (const [key, def] of kinds) {
        acc += def.weight ?? 1;
        if (r < acc) return key;
    }
    return kinds[kinds.length - 1][0];
}

// --------------------------- Validación jugando ---------------------------

/**
 * Juega el chart con la física real, la velocidad del nivel y la tolerancia de
 * la dificultad. Ante un choque: si el obstáculo es un acento, pasa a salto
 * normal; si no, se quita el menos importante del par (el que choca y el
 * anterior), así un golpe de relleno nunca se lleva por delante un drop. Un
 * choque con el túnel del vuelo quita la nota menos importante de las dos
 * últimas (el error de altura se arrastra de una nota a la siguiente).
 */
function repairUnplayable(actions, holds, ctx) {
    const { speed, profile, simModes, structure } = ctx;
    let repaired = 0;
    while (repaired < CHARTER_RULES.maxRepairs && (actions.length > 0 || holds.length > 0)) {
        const sim = toSimObstacles(actions.map((a) => ({ t: a.t, type: 'obstacle', kind: a.kind })));
        const holdEvents = holds.map((h) => ({ t: h.t, type: 'hold', until: h.until }));
        const course = holds.length > 0 ? createFlightCourse([...structure, ...holdEvents]) : null;
        const verdict = validatePlayability(sim, speed, {
            toleranceS: profile.toleranceS,
            modes: simModes,
            holds: toSimHolds(holdEvents),
            course: course === null || course.empty ? null : course,
        });
        if (verdict.ok) break;
        repaired++;
        const i = verdict.index;
        if (i >= actions.length) {
            const k = Math.min(holds.length - 1, (i - actions.length) >> 1);
            const victim = k > 0 && holds[k - 1].score < holds[k].score ? k - 1 : k;
            holds.splice(victim, 1);
            continue;
        }
        const hit = actions[i];
        if (OBSTACLE_KIND[hit.kind]?.role === 'accent') {
            hit.kind = pickKindForRole('jump', null);
            continue;
        }
        const weight = (a) => a.score + (a.forced ? 10 : 0);
        const victim = i > 0 && weight(actions[i - 1]) < weight(hit) ? i - 1 : i;
        const removed = actions.splice(victim, 1)[0];
        if (removed.type === 'flip') assignFlipKinds(actions, ctx);
    }
    return repaired;
}

// --------------------------- Eventos de estructura ---------------------------

/**
 * `section` al empezar cada tramo (nivel e intensidad para el runtime: fondo,
 * partículas, HUD), `fx: 'drop'` donde la intensidad salta y `fx: 'lift'` donde
 * sube un nivel hacia el empuje. Los clientes que no los conocen los ignoran
 * (chartFormat.js, tolerancia hacia delante).
 */
function structureEvents(arc) {
    const out = [];
    for (const seg of arc.segments) {
        const t = seg.index === 0 ? 0 : round3(seg.t0);
        out.push({ t, type: 'section', level: seg.level, intensity: round2(seg.intensity), role: seg.role, climax: seg.climax });
        if (seg.drop) out.push({ t, type: 'fx', fx: 'drop', level: seg.level });
        else if (seg.lift) out.push({ t, type: 'fx', fx: 'lift', level: seg.level });
    }
    return out;
}

// --------------------------- Utilidades ---------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}

function round2(v) {
    return Math.round(v * 100) / 100;
}
