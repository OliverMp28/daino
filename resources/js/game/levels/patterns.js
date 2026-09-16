// Patrones — compás a compás, qué huecos de la rejilla llevan acción y cuál (Ola 5).
//
// Cómo decide un compás, en orden:
//
//   1. CUÁNTAS acciones: las que pide la dificultad para el nivel del arco,
//      moduladas por la intensidad del propio compás (dentro de un tramo, un
//      compás más lleno lleva algo más) y más densas en las subidas a un drop.
//      Lo decide charter.js: los decimales se reparten de forma periódica por
//      posición en el tramo (2.5 por compás = 2-3-2-3), así la densidad media
//      es la pedida y la acción extra cae siempre en el mismo compás de la frase.
//   2. DÓNDE: cada hueco puntúa por la fuerza del golpe que suena ahí y por su
//      peso métrico (el primer tiempo manda). En calma solo cuentan los tiempos
//      fuertes; a contratiempo solo entra una síncopa real (un golpe fuerte
//      donde el pulso no lo tiene) y solo cuando la dificultad la desbloquea.
//      Donde la música calla, no hay pulso que jugar.
//   3. MEMORIA DE FRASES: si el compás suena como uno anterior del mismo nivel
//      (misma huella de golpes graves y agudos), repite su patrón. Un riff que
//      vuelve es un patrón que vuelve: el jugador lo reconoce y lo toca "de
//      oído", que es la conexión que un chart golpe a golpe no da.
//   4. QUÉ acción: el primer tiempo es un salto; los golpes brillantes (caja,
//      palmas, charles) y los contratiempos, agacharse; los graves, saltar. Sin
//      color de golpe (análisis del navegador) se usa el backbeat: se salta en
//      1 y 3 y se agacha en 2 y 4.
//   5. CABE: cada acción respeta el hueco mínimo con sus vecinas para ese par
//      de acciones, a la velocidad de ese momento y con la tolerancia de la
//      dificultad. Los huecos salen de medir la física (ver PAIR_GAP).
//
// Modos de movimiento (Ola 6): cada hueco pertenece al modo que rige en su
// instante (levels/modePlan.js). En antigravedad la única acción es invertir la
// gravedad; los portales dejan sin acciones los instantes a su alrededor, y las
// frases solo se repiten dentro del mismo modo.

import { MODE_RULES } from './modePlan.js';

/** Separación de las primeras acciones de un modo la primera vez que aparece. */
const MODE_INTRO_GAP_S = MODE_RULES.introGapS;

/**
 * Hueco mínimo entre dos acciones consecutivas, medido con el simulador de
 * física (playability.validatePlayability) barriendo huecos de 0.05 a 2.0 s a
 * 300-1100 px/s y ±40-80 ms de error (re-medido al subir el techo a 1000 px/s,
 * tras el playtest de la 6b):
 *
 *   salto → salto        0.68 (±40) · 0.70 (±47) · 0.71 (±55) · 0.73 (±65) · 0.76 (±80) s, sin depender de la velocidad
 *   salto → agachado     0.48 a 300 px/s · 0.26-0.30 a 600 · 0.23-0.27 a 900 · 0.22-0.26 a 1100 (fast-fall + agachado)
 *   agachado → salto     0.60-0.64 a 300 px/s · 0.50-0.54 a 600 · 0.46-0.50 a 1100
 *   agachado → agachado  0.06-0.17 s (se sigue agachado)
 *   inversión → inversión (suelo, techo, suelo…) 0.27-0.30 a 300 px/s · 0.22-0.26 a 450 · 0.21-0.26 a 600-1100
 *
 * Las fórmulas quedan por ENCIMA de lo medido en todo el rango (margen de
 * 0-80 ms): el validador final comprueba cada chart de verdad, así que aquí
 * basta con que casi nunca tenga que reparar.
 */
export const PAIR_GAP = Object.freeze({
    jumpJump: (_speed, tol) => 0.61 + 2 * tol,
    jumpDuck: (speed, tol) => 150 / speed + tol + 0.05,
    duckJump: (speed, tol) => 0.40 + 55 / speed + 0.9 * tol,
    duckDuck: (_speed, tol) => 0.20 + tol,
    flipFlip: (speed, tol) => 0.16 + 1.2 * tol + 36 / speed,
});

/**
 * Inversiones seguidas sin combinaciones desbloqueadas: por la física cabrían a
 * un cuarto de segundo, pero leer suelo-techo-suelo a esa velocidad es cosa de
 * los tramos donde la dificultad permite combinaciones. Antes, como mucho, una
 * por beat a 125 BPM.
 */
const FLIP_CALM_GAP_S = 0.48;

/**
 * @param {'jump'|'duck'|'flip'} a  Acción anterior.
 * @param {'jump'|'duck'|'flip'} b  Acción siguiente.
 * @param {number} speed     Velocidad del mundo cuando llega la siguiente.
 * @param {{ toleranceS: number, minGapS: number }} profile
 * @param {boolean} combos   ¿Se permiten combinaciones rápidas (salto↔agachado, inversiones seguidas)?
 */
export function pairGap(a, b, speed, profile, combos) {
    const tol = profile.toleranceS;
    if (a === 'flip' || b === 'flip') {
        // Una de correr y otra de antigravedad solo son vecinas a través de un
        // portal, y alrededor del portal ya no hay acciones (modePlan.js).
        if (a !== b) return profile.minGapS;
        const flips = PAIR_GAP.flipFlip(speed, tol);
        return Math.max(combos ? flips : Math.max(flips, FLIP_CALM_GAP_S), profile.minGapS);
    }
    const jj = PAIR_GAP.jumpJump(speed, tol);
    let gap;
    if (a === 'jump' && b === 'jump') gap = jj;
    else if (a === 'jump') gap = combos ? PAIR_GAP.jumpDuck(speed, tol) : jj;
    else if (b === 'jump') gap = combos ? PAIR_GAP.duckJump(speed, tol) : Math.max(jj, PAIR_GAP.duckJump(speed, tol));
    else gap = Math.max(PAIR_GAP.duckDuck(speed, tol), combos ? 0 : jj);
    return Math.max(gap, profile.minGapS);
}

/** Cuánto "brilla" un golpe: agudos y medios frente a graves, en [-1, 1]. */
export function brightness(slot) {
    return slot.high + 0.5 * slot.mid - slot.low;
}

/**
 * Umbral de brillo a partir del cual un golpe en el pulso se juega agachándose:
 * el percentil 55 de los golpes con cuerpo que no caen en primer tiempo. Así
 * cada canción reparte según SU sonido (en una canción oscura, "brillante" es
 * lo menos oscuro).
 *
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} model
 */
export function duckThreshold(model) {
    const values = [];
    for (const bar of model.bars) {
        for (const s of bar.slots) {
            if (s.onBeat && s.metric < 1 && s.strength >= 0.3) values.push(brightness(s));
        }
    }
    if (values.length < 8) return Infinity;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length * 0.55)];
}

// --------------------------- Memoria de frases ---------------------------

/**
 * Huella rítmica de un compás: por hueco, fuerza en tres escalones y, si el
 * golpe tiene cuerpo, si es brillante u oscuro.
 */
export function barSignature(bar, threshold) {
    return bar.slots.map((s) => {
        if (s.strength < 0.2) return 0;
        const level = s.strength < 0.5 ? 1 : 2;
        const bright = brightness(s) >= threshold ? 1 : 0;
        return level * 2 + bright;
    });
}

/** Parecido entre dos huellas del mismo tamaño: fracción de huecos iguales. */
export function signatureSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0) return 0;
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    return same / a.length;
}

export function createPhraseMemory({ minSimilarity = 0.8, maxAgeBars = 48 } = {}) {
    /** @type {Array<{ bar: number, signature: number[], level: number, target: number, mode: string, picks: Array<{ si: number, type: string, event: object }> }>} */
    const entries = [];
    return {
        /**
         * Compás anterior más parecido con el mismo tamaño, el mismo modo de
         * movimiento y un nivel del arco a ±1. A igual parecido, el que buscaba
         * el mismo número de acciones (en un tramo que alterna 2-3-2-3, el de
         * hace dos compases) y, después, el más reciente.
         */
        find(barIndex, signature, level, target, mode = 'run') {
            let best = null;
            let bestScore = minSimilarity;
            for (let i = entries.length - 1; i >= 0; i--) {
                const e = entries[i];
                if (barIndex - e.bar > maxAgeBars) break;
                if (e.mode !== mode || Math.abs(e.level - level) > 1 || e.signature.length !== signature.length) continue;
                const score = signatureSimilarity(e.signature, signature) + (e.target === target ? 0.01 : 0);
                if (score > bestScore + 1e-9) {
                    bestScore = score;
                    best = e;
                }
            }
            return best;
        },
        remember(barIndex, signature, level, target, picks, mode = 'run') {
            if (picks.length === 0) return;
            entries.push({ bar: barIndex, signature, level, target, mode, picks });
        },
    };
}

// --------------------------- Selección en un compás ---------------------------

/**
 * @typedef {Object} ChartAction
 * @property {number} t
 * @property {'jump'|'duck'|'flip'} type
 * @property {import('./musicModel.js').GridSlot} slot
 * @property {number} score        Importancia musical (decide qué se sacrifica al reparar).
 * @property {boolean} forced      Drop o primeras acciones: se conservan antes que nada.
 * @property {number} bar
 * @property {number} segment
 * @property {object | null} echo  Acción de la que copia el patrón (memoria de frases).
 * @property {string} [kind]
 */

/**
 * Elige las acciones de un compás.
 *
 * @param {object} ctx
 * @param {import('./musicModel.js').Bar} ctx.bar
 * @param {import('./musicModel.js').Bar | null} ctx.nextBar
 * @param {{ level: number } | null} ctx.nextArcBar
 * @param {{ intensity: number, level: number, segment: number, build: number }} ctx.arcBar
 * @param {{ intensity: number, level: number, drop: boolean, bar0: number }} ctx.segment
 * @param {number} ctx.target                  Acciones que se buscan.
 * @param {ChartAction[]} ctx.placed           Acciones ya fijadas, ordenadas (compases anteriores).
 * @param {(t: number) => number} ctx.speedAt
 * @param {(t: number, type: 'jump'|'duck'|'flip') => boolean} [ctx.readerOk]  ¿Se lee bien una acción ahí? (alrededor de un cambio de velocidad)
 * @param {object} ctx.profile                 Perfil de dificultad.
 * @param {(mechanic: string, t: number) => boolean} ctx.unlocked
 * @param {number} ctx.tMin
 * @param {number} ctx.tMax
 * @param {number} ctx.threshold               Umbral de brillo (duckThreshold).
 * @param {boolean} ctx.hasColor
 * @param {number} ctx.meter
 * @param {(t0: number, t1: number) => number} ctx.energyMean
 * @param {ReturnType<typeof createPhraseMemory>} ctx.memory
 * @param {Set<number> | null} ctx.previousPositions  Posiciones elegidas en el compás anterior del mismo tramo.
 * @param {{ airDucks: number, airTotal: number }} ctx.segmentCounts
 * @param {number} ctx.introActions            Acciones de "tutorial" que quedan (solo saltos en el pulso, espaciados).
 * @param {ReturnType<import('./modePlan.js').createModeGuide>} [ctx.modes]  Modo de cada instante y portales.
 * @param {number} [ctx.modeIntroLeft]         Acciones de estreno que quedan en el tramo de modo de este compás.
 * @returns {ChartAction[]}
 */
export function chooseBarActions(ctx) {
    const { bar, arcBar, tMin, tMax } = ctx;
    ctx = { ...ctx, modes: ctx.modes ?? NO_MODES, modeIntroLeft: ctx.modeIntroLeft ?? 0 };
    const candidates = barCandidates(ctx);
    if (candidates.length === 0) return [];
    ctx.reserved = reservedDownbeat(ctx);

    const barMode = ctx.modes.modeAt(bar.t0);
    const signature = barSignature(bar, ctx.threshold);
    const chosen = [];
    const tutorial = ctx.introActions > 0 || ctx.modeIntroLeft > 0;
    const echo = tutorial ? null : ctx.memory.find(bar.index, signature, arcBar.level, ctx.target, barMode);

    const tryAdd = (cand, type, echoEvent) => {
        if (cand.slot.t < tMin || cand.slot.t > tMax) return false;
        const action = {
            t: cand.slot.t,
            type,
            slot: cand.slot,
            score: cand.score,
            forced: cand.forced,
            bar: bar.index,
            segment: arcBar.segment,
            echo: echoEvent,
        };
        if (!fits(action, chosen, ctx)) return false;
        insertSorted(chosen, action);
        return true;
    };

    if (echo !== null) {
        // Repetir el patrón de la frase que suena igual, hueco a hueco.
        for (const pick of echo.picks) {
            const cand = candidates.find((c) => c.si === pick.si);
            if (cand !== undefined && chosen.length < ctx.target + (cand.forced ? 1 : 0)) {
                tryAdd(cand, allowedType(pick.type, cand, ctx), pick.event);
            }
        }
    }

    // Completar (o construir) por importancia.
    const byScore = [...candidates].sort((a, b) => (b.score - a.score) || (a.slot.t - b.slot.t));
    for (const cand of byScore) {
        if (chosen.length >= ctx.target && !cand.forced) break;
        if (chosen.some((c) => c.slot === cand.slot)) continue;
        const preferred = preferredType(cand, ctx, chosen);
        if (tryAdd(cand, preferred, null)) continue;
        // En antigravedad solo hay una acción.
        if (preferred === 'flip') continue;
        // No cabe como lo pide el sonido: probar la otra acción si está permitida
        // (un agachado encaja a menos distancia de un salto que otro salto).
        const alt = preferred === 'jump' ? 'duck' : 'jump';
        if (alt === 'duck' && !canDuck(cand, ctx, chosen)) continue;
        if (alt === 'jump' || cand.slot.metric < 1) tryAdd({ ...cand, score: cand.score * 0.9 }, alt, null);
    }

    // Sobran (la memoria trajo más de los que pide este compás): fuera los menos importantes.
    while (chosen.length > ctx.target) {
        let worst = -1;
        for (let i = 0; i < chosen.length; i++) {
            if (chosen[i].forced) continue;
            if (worst < 0 || chosen[i].score < chosen[worst].score) worst = i;
        }
        if (worst < 0) break;
        chosen.splice(worst, 1);
    }

    // Respiración antes del drop: el último beat de la subida queda vacío salvo
    // que ahí suene un golpe muy fuerte (romper el silencio con él SÍ es musical).
    if (arcBar.build === 2) {
        const localBeat = bar.beats > 0 ? (bar.t1 - bar.t0) / bar.beats : 0.5;
        for (let i = chosen.length - 1; i >= 0; i--) {
            if (chosen[i].t > bar.t1 - localBeat - 0.02 && chosen[i].slot.strength < 0.75 && !chosen[i].forced) chosen.splice(i, 1);
        }
    }

    ctx.memory.remember(bar.index, signature, arcBar.level, ctx.target, chosen.map((a) => ({
        si: bar.slots.indexOf(a.slot),
        type: a.type,
        event: a,
    })), barMode);
    return chosen;
}

/** Síncopa de verdad: un golpe fuerte y claramente por encima del pulso que lo rodea. */
const DEFAULT_OFFBEAT = Object.freeze({ strength: 0.4, ratio: 0.85 });

/** Sin plan de modos: se corre de principio a fin. */
const NO_MODES = Object.freeze({ constant: true, modeAt: () => 'run', allows: () => true, spanAt: () => null });

function barCandidates(ctx) {
    const { bar, nextBar, arcBar, segment, unlocked, tMin, tMax, modes } = ctx;
    const out = [];
    const dropBar = segment.drop && bar.index === segment.bar0;
    let dropForced = false;

    for (let si = 0; si < bar.slots.length; si++) {
        const slot = bar.slots[si];
        if (slot.t < tMin || slot.t > tMax) continue;
        // Alrededor de un portal no hay acciones (modePlan.js).
        if (!modes.allows(slot.t)) continue;
        const mode = modes.modeAt(slot.t);

        if (ctx.introActions > 0 && (!slot.onBeat || slot.metric < 0.8)) continue;
        // Estreno de un modo: sus primeras acciones, en el pulso.
        if (mode !== 'run' && ctx.modeIntroLeft > 0 && !slot.onBeat) continue;

        if (!slot.onBeat) {
            if (arcBar.level < 2 || !unlocked('offbeat', slot.t)) continue;
            const neighbor = Math.max(bar.slots[si - 1]?.strength ?? 0, bar.slots[si + 1]?.strength ?? nextBar?.slots[0]?.strength ?? 0);
            const rule = ctx.profile.offbeat ?? DEFAULT_OFFBEAT;
            const syncopation = slot.strength >= rule.strength && slot.strength >= rule.ratio * neighbor;
            // En el clímax de las dificultades altas se juega la subdivisión:
            // contratiempos con golpe, aunque no sea una síncopa, o con la
            // música a tope alrededor.
            const climax = ctx.profile.climaxOffbeat ?? null;
            const subdivision = climax !== null && arcBar.level === 4
                && (slot.strength >= climax.strength || ctx.energyMean(slot.t - 0.15, slot.t + 0.15) >= climax.energy);
            if (!syncopation && !subdivision) continue;
        } else if (arcBar.level <= 1 && slot.metric < 0.8 && slot.strength < (ctx.profile.calmBeatStrength ?? 0.5)) {
            continue;
        }

        // Sin golpe y con la música callada no hay pulso que seguir.
        if (slot.strength === 0 && ctx.energyMean(slot.t - 0.3, slot.t + 0.3) < 0.06) continue;

        const prior = slot.onBeat ? (slot.metric >= 1 ? 0.22 : slot.metric >= 0.8 ? 0.12 : 0.05) : 0;
        let score = Math.pow(slot.strength, 0.8) * (0.55 + 0.45 * slot.metric) + prior;
        if (ctx.previousPositions?.has(slot.pos)) score += 0.08;
        // En los tramos que empujan, el golpe brillante del pulso (la caja, las
        // palmas) gana peso frente al bombo del tiempo 3: "bum-CLAP" en vez de
        // "bum . bum". Medido sin esto: a 128-160 BPM el bombo ganaba siempre y
        // los estribillos salían solo con saltos. En estrofas no aplica: la
        // calma también es no mezclar acciones.
        if (mode === 'run' && arcBar.level >= 3 && slot.onBeat && slot.metric < 1 && unlocked('duck', slot.t) && isBright(slot, ctx)) {
            score += 0.12 * (arcBar.level - 2);
        }

        let forced = false;
        if (dropBar && slot.onBeat && !dropForced) {
            // El primer tiempo del drop se juega siempre: es el golpe que el
            // jugador está esperando desde la subida.
            forced = true;
            dropForced = true;
            score += 2;
        }
        out.push({ slot, si, score, forced });
    }
    return out;
}

/** Primer tiempo del compás siguiente como vecina virtual, si ese compás se va a jugar. */
function reservedDownbeat(ctx) {
    const next = ctx.nextBar;
    if (next === null || ctx.nextArcBar === null || ctx.nextArcBar.level < 1) return null;
    const slot = next.slots[0];
    if (slot === undefined || slot.t < ctx.tMin || slot.t > ctx.tMax || !ctx.modes.allows(slot.t)) return null;
    if (slot.strength === 0 && ctx.energyMean(slot.t - 0.3, slot.t + 0.3) < 0.06) return null;
    const type = ctx.modes.modeAt(slot.t) === 'flip' ? 'flip' : 'jump';
    return { t: slot.t, type, score: Math.pow(slot.strength, 0.8) + 0.22 };
}

function preferredType(cand, ctx, chosen) {
    const { slot } = cand;
    if (ctx.modes.modeAt(slot.t) === 'flip') return 'flip';
    if (cand.forced || slot.metric >= 1) return 'jump';
    if (!canDuck(cand, ctx, chosen)) return 'jump';
    const duck = slot.onBeat ? isBright(slot, ctx) : !(ctx.hasColor && slot.low > 0.5);
    return duck ? 'duck' : 'jump';
}

/**
 * ¿Suena brillante este golpe del pulso? Con color de golpe, frente al umbral
 * de la canción; sin él (análisis del navegador), el backbeat: 2 y 4.
 */
function isBright(slot, ctx) {
    if (ctx.hasColor) return brightness(slot) >= ctx.threshold;
    return ctx.meter % 2 === 0 && Math.round(slot.pos) % 2 === 1;
}

/** Tipo de una acción copiada de la memoria, si sigue permitido aquí. */
function allowedType(type, cand, ctx) {
    if (ctx.modes.modeAt(cand.slot.t) === 'flip') return 'flip';
    if (type === 'flip') return preferredType(cand, ctx, []);
    return type === 'duck' && !canDuck(cand, ctx, []) ? 'jump' : type;
}

function canDuck(cand, ctx, chosen) {
    if (!ctx.unlocked('duck', cand.slot.t) || ctx.introActions > 0) return false;
    if (ctx.modes.modeAt(cand.slot.t) !== 'run') return false;
    const ducks = ctx.segmentCounts.airDucks + chosen.filter((a) => a.type === 'duck').length;
    const total = ctx.segmentCounts.airTotal + chosen.length;
    // Cuota proporcional con al menos uno: como fracción pura, la primera acción
    // de un tramo valía el 100 % y nunca podía ser un agachado, y la memoria de
    // frases copiaba ese primer compás sin agachados a todo el estribillo.
    return ducks + 1 <= Math.max(1, Math.floor(ctx.profile.airShare * (total + 1) + 1e-9));
}

/** ¿Cabe la acción entre sus vecinas (ya fijadas y de este compás)? */
function fits(action, chosen, ctx) {
    const { placed, profile, speedAt } = ctx;
    // Alrededor de un acelerón, quien juega con la vista se equivocaría: esa
    // pulsación se deja libre (speedPlan.js, SPEED_RULES.readerBudgetS).
    if (ctx.readerOk !== undefined && !ctx.readerOk(action.t, action.type)) return false;
    const prev = neighborBefore(action.t, placed, chosen);
    // Sin vecina posterior en el compás, el primer tiempo del SIGUIENTE compás
    // cuenta como reservado: un golpe al final de este no le quita el ancla al
    // otro. Medido sin reserva: en Mi Fiesta salían compases "1, 4 | 2, 4" en
    // vez de "1, 3 | 1, 3". Solo lo rompe un golpe más importante que ese
    // primer tiempo (una síncopa de verdad fuerte).
    let next = neighborAfter(action.t, chosen);
    if (next === null && ctx.reserved !== null && action.score <= ctx.reserved.score + 0.1) next = ctx.reserved;
    const combos = ctx.unlocked('combo', action.t);
    // Tutorial del principio (saltos) o estreno de un modo (sus primeras acciones).
    const introGap = ctx.introActions > 0 ? 1.1 : (action.type === 'flip' && ctx.modeIntroLeft > 0 ? MODE_INTRO_GAP_S : 0);

    if (prev !== null) {
        const need = Math.max(introGap, pairGap(prev.type, action.type, speedAt(action.t), profile, combos));
        if (action.t - prev.t < need - 1e-9) return false;
    }
    if (next !== null) {
        const need = Math.max(introGap, pairGap(action.type, next.type, speedAt(next.t), profile, ctx.unlocked('combo', next.t)));
        if (next.t - action.t < need - 1e-9) return false;
    }
    return true;
}

function neighborBefore(t, placed, chosen) {
    for (let i = chosen.length - 1; i >= 0; i--) {
        if (chosen[i].t < t) return chosen[i];
    }
    // Los compases se deciden en orden: todo lo fijado antes queda por delante.
    return placed.length > 0 ? placed[placed.length - 1] : null;
}

function neighborAfter(t, chosen) {
    for (const a of chosen) if (a.t > t) return a;
    return null;
}

function insertSorted(list, action) {
    let i = list.length;
    while (i > 0 && list[i - 1].t > action.t) i--;
    list.splice(i, 0, action);
}
