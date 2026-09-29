// Acentos — las acciones sobre los golpes fuertes, que exigen precisión.
//
// Tras el segundo playtest de la dificultad ("What's Up Danger en Extremo lo
// pasé a la segunda", "lo demás era lo típico de esquivar y saltar"): un cactus
// suelto deja ±200 ms de margen a cualquier velocidad y un cristal de la
// antigravedad perdona pulsar ~200 ms tarde, así que por muy rápido que vaya un
// nivel, cada acción suelta es fácil. Un acento es una acción sobre un golpe que
// suena fuerte con una VARIANTE de su obstáculo que deja menos margen: una hilera
// de cactus que hay que clavar, un cristal afilado que llega antes. La acción
// sigue en su golpe: lo que aprieta es el obstáculo, no el ritmo.
//
// Las variantes viven en el registro (config.js): un kind con `accentOf: 'X'` es
// una variante de acento de X. Este módulo no conoce ninguna por su nombre.
//
// Tres decisiones, en orden:
//
//   1. QUÉ acciones. Las que tienen variantes. En cada tramo, las que más suenan
//      (fuerza del golpe por su peso métrico, más un cambio de acorde; el drop
//      siempre) hasta la cuota de la dificultad por el factor de su nivel del
//      arco, con sitio alrededor (un acento pegado a otra acción sumaría dos
//      exigencias en una). Se decide por frase: el riff que vuelve trae los
//      mismos acentos en todas sus vueltas.
//   2. CUÁNTO aprietan. Cada acento pide un margen: el mínimo de la dificultad por
//      un factor que sigue a la canción (más holgado en la calma y en el primer
//      tercio, el más estrecho en el empuje y el clímax: se muere donde la música
//      aprieta, no en la intro) y por su golpe (el más flojo de su tramo, más
//      holgado). Encima, una escalera de holgura global, de más holgada a más
//      estrecha, hasta el escalón cuya exigencia para el jugador de referencia
//      (challenge.js) queda más cerca de la que pide la dificultad PARA LA
//      CANCIÓN ENTERA (Ola 6c: antes era por minuto, y una canción de 40 s salía
//      tres veces más fácil que una de 3 min con la misma dificultad). Si con el
//      margen mínimo no llega, entran más golpes como acento (hasta toda la cuota
//      posible): una canción corta aprieta más golpes.
//   3. CON QUÉ variante. La que deja el margen más estrecho sin bajar del pedido,
//      a la velocidad con la que cruza y CON SUS VECINAS (`accentVariant`, Ola 6c:
//      una hilera seguida de un agachado deja menos margen que sola, y medida sola
//      creaba "muros" donde moría una de cada cuatro partidas).
//
// Todo lo ajustable está en ACCENT_RULES y en `accent` de cada dificultad
// (difficulty.js). Cambiar cualquiera altera los charts: sube CHARTER_VERSION.

import { OBSTACLE_KIND } from '../config.js';
import { actionLeadS } from '../systems/physics.js';
import { timingMarginsS, toSimTriggers } from '../systems/playability.js';
import { createContextMargins, hazardOf, missChance } from './challenge.js';
import { pairGap } from './patterns.js';

export const ACCENT_RULES = Object.freeze({
    /** Una variante solo si su margen total supera N veces la tolerancia de la dificultad. */
    windowFactor: 2.4,
    /** Un golpe es acento si suena al menos así de fuerte (o cambia el acorde, o es el drop). */
    minStrength: 0.45,
    /** Lo que suma un cambio de acorde a la puntuación de un golpe. */
    chordBonus: 0.35,
    /** Cuota de acentos de cada nivel del arco (reposo … clímax), × la de la dificultad. */
    levelFactor: Object.freeze([0.5, 0.7, 1, 1.2, 1.5]),
    /** Holgura sobre el hueco mínimo con sus vecinas para que una acción lleve acento. */
    roomS: 0.05,
    /** El acento más flojo de un tramo pide este tanto por uno más de margen que el más fuerte. */
    spread: 0.5,
    /**
     * Margen de cada nivel del arco (reposo … clímax), × el pedido. Medido sin
     * esto en What's Up Danger (Extremo): la mitad de las muertes del jugador de
     * referencia caían en los segundos 15-21, en los acentos más fuertes de la
     * primera estrofa.
     */
    levelMargin: Object.freeze([1.5, 1.35, 1.2, 1.12, 1]),
    /** Durante la primera `progress` de la canción el margen se abre hasta × `factor` al empezar. */
    opening: Object.freeze({ progress: 0.35, factor: 1.3 }),
    /** Márgenes que se prueban, × el mínimo de la dificultad, de holgado a estrecho. */
    scales: Object.freeze([3, 2.5, 2.1, 1.8, 1.55, 1.35, 1.2, 1.1, 1]),
    /** En el margen mínimo, los acentos flojos se acercan a los fuertes en estos pasos (× spread). */
    finalSpreads: Object.freeze([0.75, 0.5, 0.25, 0]),
    /**
     * Último recurso: cierra las APERTURAS (nivel del arco, principio de la
     * canción, reparto) hacia el margen mínimo de la dificultad, que nunca se
     * cruza. Lo necesitan las canciones cortas: en 40 s casi todo cae dentro de
     * la apertura y en tramos de calma, así que el margen pedido salía ×1.5-1.9
     * del mínimo y el nivel no llegaba ni a un tercio de su exigencia (Sugar Red
     * en Extremo: 0.84 de 2.94). Una canción larga llega al presupuesto mucho
     * antes y no pisa estos escalones.
     */
    closings: Object.freeze([0.85, 0.7, 0.6, 0.5]),
    /**
     * Si ni el margen mínimo llega a la exigencia, la cuota de acentos se multiplica
     * por estos factores, por orden, hasta llegar (Ola 6c). En los pasos `relaxed`
     * también valen golpes más flojos (`relaxedStrength`) y acciones sin holgura
     * alrededor: el margen de cada acento ya se mide con sus vecinas, así que no
     * puede quedar por debajo del pedido. Lo necesitan las canciones cortas: Last
     * Christmas en Extremo (39 s) tenía 5 acentos con la cuota normal.
     */
    shareSteps: Object.freeze([
        Object.freeze({ factor: 1, relaxed: false }),
        Object.freeze({ factor: 1.5, relaxed: false }),
        Object.freeze({ factor: 2.2, relaxed: true }),
        Object.freeze({ factor: 3, relaxed: true }),
    ]),
    relaxedStrength: 0.25,
    /** Presupuesto mínimo de los acentos, en fracción del de la dificultad. */
    minBudgetShare: 0.15,
    /** Por debajo de esta fracción del presupuesto, se prueba la cuota siguiente. */
    shortfall: 0.85,
});

/**
 * @typedef {Object} AccentSummary
 * @property {number} accents   Acciones con variante de acento.
 * @property {number} hazard    Exigencia de los acentos para el jugador de referencia (muertes esperadas).
 * @property {number} budget    Exigencia que pedía la dificultad para esta canción.
 * @property {number} scale     Escalón de holgura con el que se quedó (1 = el margen mínimo).
 * @property {number} share     Factor de cuota con el que se quedó (1 = la de la dificultad).
 */

/**
 * Decide los acentos de un chart y les pone su variante: `kind` y `accentTarget`
 * (el margen pedido, para volver a elegir variante si la acción cambia de kind,
 * como un cristal que pasa del suelo al techo al repararse el chart). Las
 * acciones llegan con su kind normal.
 *
 * @param {Array<{ t: number, type: string, kind: string, slot: object, forced: boolean, segment: number, echo: object | null, accentTarget?: number | null }>} actions
 *        Todas las acciones del chart, en orden.
 * @param {object} ctx
 * @param {import('./difficulty.js').DifficultyProfile} ctx.profile
 * @param {{ segments: Array<{ level: number }> }} ctx.arc
 * @param {{ speedAt: (t: number) => number }} ctx.speed
 * @param {(mechanic: string, t: number) => boolean} ctx.unlocked
 * @param {{ plan: Array<{ mode: string, tIn: number, tOut: number }> }} ctx.modes
 * @param {Array<{ t: number, mode: string }>} [ctx.simModes]  Cambios de modo (para medir en contexto).
 * @param {number} [ctx.restHazard]  Lo que el nivel ya exige sin acentos: se descuenta del presupuesto.
 * @param {number} ctx.introActions  Las primeras acciones (tutorial) nunca llevan acento.
 * @param {number} ctx.durationSec   Duración de la canción (la apertura se mide sobre ella).
 * @returns {AccentSummary}
 */
export function assignAccents(actions, ctx) {
    const rule = ctx.profile.accent ?? null;
    const summary = { accents: 0, hazard: 0, budget: 0, scale: 0, share: 0 };
    if (rule === null || actions.length === 0) return summary;
    // Los acentos ponen lo que falta hasta la exigencia de la dificultad, y algo
    // siempre (los golpes fuertes se subrayan aunque el nivel ya exija bastante).
    summary.budget = Math.max(ACCENT_RULES.minBudgetShare * rule.hazard, rule.hazard - (ctx.restHazard ?? 0));

    // Márgenes en contexto: cada acción con sus vecinas tal como están (kinds normales).
    const sim = actions.map((a) => {
        const def = OBSTACLE_KIND[a.kind];
        return { t: a.t, kind: a.kind, def, cross: a.t + actionLeadS(def) };
    });
    const triggers = toSimTriggers(actions.filter((a) => a.type === 'ring').map((a) => ({ t: a.t, type: 'obstacle', kind: a.ring })));
    const context = createContextMargins({ obstacles: sim, triggers, speed: ctx.speed, modes: ctx.simModes ?? [] });
    const indexOf = new Map(actions.map((a, i) => [a, i]));

    let best = null;
    let bestChosen = [];
    for (const step of ACCENT_RULES.shareSteps) {
        const factor = step.factor;
        const chosen = chooseAccents(actions, ctx, rule, step);
        // Un paso que no añade golpes no cambia nada; el siguiente (más relajado) quizá sí.
        if (chosen.length === 0 || chosen.length <= bestChosen.length) continue;
        const marginsOf = chosen.map((a) => (kind) => context(indexOf.get(a), kind));
        // Escalón a escalón hasta pasar del presupuesto; se queda el más cercano (en
        // proporción) de los dos últimos: pasarse de largo también es fallar.
        let found = null;
        for (const [scale, spread] of ladder()) {
            // El margen mínimo de la dificultad es un SUELO: el sitio en la canción
            // (arco, apertura) y el reparto solo lo abren, y en los últimos
            // escalones se cierran hasta él (nunca por debajo).
            const targets = chosen.map((a) => rule.marginS * Math.max(1, scale * (1 + spread * (a.accentRank ?? 0)) * shapeFactor(a, ctx)));
            const kinds = chosen.map((a, k) => accentVariant(a.kind, a.t, targets[k], ctx, marginsOf[k]));
            const hazard = kinds.reduce((sum, kind, k) => {
                if (kind === null) return sum;
                const m = marginsOf[k](kind);
                return sum + hazardOf(missChance(m.early, m.late));
            }, 0);
            const step = { targets, kinds, hazard, scale, share: factor };
            if (hazard < summary.budget - 1e-9) {
                found = step;
                continue;
            }
            if (found === null || Math.log(hazard / summary.budget) < Math.log(summary.budget / Math.max(found.hazard, 1e-6))) found = step;
            break;
        }
        best = found;
        bestChosen = chosen;
        // Si ni con el margen mínimo llega, más golpes como acento; si llega, basta.
        if (found.hazard >= ACCENT_RULES.shortfall * summary.budget) break;
    }
    if (best === null) return summary;
    bestChosen.forEach((a, k) => {
        if (best.kinds[k] === null) return;
        a.kind = best.kinds[k];
        a.accentTarget = best.targets[k];
        summary.accents++;
    });
    summary.hazard = Math.round(best.hazard * 1000) / 1000;
    summary.budget = Math.round(summary.budget * 1000) / 1000;
    summary.scale = best.scale;
    summary.share = best.share;
    return summary;
}

/**
 * Variante de acento de `baseKind` para una acción en `t`: la que deja el margen
 * más estrecho (del lado más estrecho, a la velocidad con la que cruza) sin bajar
 * de `targetS`. null si ninguna cabe o el kind no tiene variantes.
 *
 * @param {string} baseKind
 * @param {number} t
 * @param {number} targetS
 * @param {{ profile: { toleranceS: number }, speed: { speedAt: (t: number) => number } }} ctx
 * @param {((kind: string) => { early: number, late: number }) | null} [marginsOf]
 *        Márgenes de la acción con un kind EN SU SITIO (challenge.createContextMargins).
 *        Sin él, aislados.
 * @returns {string | null}
 */
export function accentVariant(baseKind, t, targetS, ctx, marginsOf = null) {
    const isolated = (kind) => isolatedMargins(kind, ctx.speed.speedAt(t + actionLeadS(OBSTACLE_KIND[kind])));
    const narrow = (m) => Math.min(m.early, m.late);
    const plainSide = narrow((marginsOf ?? isolated)(baseKind));
    // De la más estrecha a la más holgada (aislada): la primera que, en su sitio,
    // deja el margen pedido. En su sitio el margen nunca es mayor que aislada, así que
    // las que aisladas ya no llegan no hace falta medirlas.
    const candidates = variantsOf(baseKind)
        .map((kind) => ({ kind, alone: isolated(kind) }))
        .filter((c) => narrow(c.alone) >= targetS - 1e-9 && c.alone.early + c.alone.late >= ACCENT_RULES.windowFactor * ctx.profile.toleranceS)
        .sort((x, y) => narrow(x.alone) - narrow(y.alone));
    if (candidates.length === 0) return null;
    const fits = (c) => {
        const m = marginsOf === null ? c.alone : marginsOf(c.kind);
        const side = narrow(m);
        // Una variante que a esta velocidad deja MÁS margen que la acción normal no
        // es un acento (el cactus ancho es bajo: a partir de ~600 px/s perdona más).
        return side < plainSide && side >= targetS - 1e-9 && m.early + m.late >= ACCENT_RULES.windowFactor * ctx.profile.toleranceS;
    };
    if (marginsOf === null) return candidates.find(fits)?.kind ?? null;
    // En su sitio el margen crece con el índice (variantes de más apretada a más
    // holgada): se busca la primera que llega por bisección, no una a una.
    if (fits(candidates[0])) return candidates[0].kind;
    let lo = 0;
    let hi = candidates.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fits(candidates[mid])) hi = mid - 1;
        else lo = mid;
    }
    const chosen = candidates[Math.min(lo + 1, candidates.length - 1)];
    return fits(chosen) ? chosen.kind : null;
}

/**
 * Márgenes de un kind aislado a una velocidad, con memoria al px/s. Cada escalón
 * de la escalera mide todas las variantes de cada acento (17 hileras × ~13
 * escalones × ~90 acentos en un Extremo largo) y la velocidad es constante por
 * tramo: sin la memoria, el charter dedicaba a esto casi tanto como al validador.
 */
const marginCache = new Map();
function isolatedMargins(kind, speedPxS) {
    const key = `${kind}@${Math.round(speedPxS)}`;
    let m = marginCache.get(key);
    if (m === undefined) {
        m = timingMarginsS(kind, speedPxS);
        marginCache.set(key, m);
    }
    return m;
}

/** Kinds con `accentOf === baseKind`, en el orden del registro (memoria). */
const variantCache = new Map();
function variantsOf(baseKind) {
    let list = variantCache.get(baseKind);
    if (list === undefined) {
        list = Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].accentOf === baseKind);
        variantCache.set(baseKind, list);
    }
    return list;
}

/** Cuánto suena como acento una acción (0 si no lo es). */
function accentScore(a, minStrength = ACCENT_RULES.minStrength) {
    if (a.forced) return 10;
    const chord = a.slot.chord === true;
    if (a.slot.strength < minStrength && !chord) return 0;
    return a.slot.strength * (0.5 + 0.5 * a.slot.metric) + (chord ? ACCENT_RULES.chordBonus : 0);
}

/**
 * Acciones que llevan acento, en orden. Se decide por FRASE: las acciones que
 * repiten el mismo golpe de un riff (la memoria de frases de patterns.js las
 * enlaza con `echo`) forman un grupo, y un grupo lleva acento entero o no lo
 * lleva, puntuado por su golpe más fuerte. Así el riff que vuelve trae los mismos
 * acentos en todas sus vueltas. En cada tramo entran grupos, de más a menos
 * fuerte, hasta su cuota. Cada acción queda con `accentRank`: 0 el grupo más
 * fuerte de su tramo, 1 el más flojo de los elegidos.
 */
function chooseAccents(actions, ctx, rule, step = ACCENT_RULES.shareSteps[0]) {
    const factor = step.factor;
    const minStrength = step.relaxed ? ACCENT_RULES.relaxedStrength : ACCENT_RULES.minStrength;
    const { profile, arc, speed, unlocked } = ctx;
    const roomy = (i) => {
        const a = actions[i];
        const prev = actions[i - 1];
        const next = actions[i + 1];
        const apart = (x, y) => (x.type === 'flip') !== (y.type === 'flip');
        return (prev === undefined || apart(prev, a) || a.t - prev.t >= pairGap(prev.type, a.type, speed.speedAt(a.t), profile, unlocked('combo', a.t)) + ACCENT_RULES.roomS)
            && (next === undefined || apart(a, next) || next.t - a.t >= pairGap(a.type, next.type, speed.speedAt(next.t), profile, unlocked('combo', next.t)) + ACCENT_RULES.roomS);
    };
    const rootOf = (a) => {
        let root = a;
        while (root.echo !== null && root.echo !== undefined && root.echo.type === root.type) root = root.echo;
        return root;
    };

    const bySegment = new Map();
    actions.forEach((a, i) => {
        if (i < ctx.introActions || variantsOf(a.kind).length === 0 || !unlocked('accent', a.t)) return;
        // Un anillo y el salto que lo lleva ya son una figura que exige: sin acento encima.
        if (a.type === 'ring' || actions[i + 1]?.type === 'ring') return;
        const list = bySegment.get(a.segment) ?? [];
        list.push(i);
        bySegment.set(a.segment, list);
    });

    const out = new Set();
    for (const [segment, list] of bySegment) {
        const quota = Math.round(Math.min(1, rule.share * factor * ACCENT_RULES.levelFactor[arc.segments[segment].level]) * list.length);
        const groups = new Map();
        for (const i of list) {
            const root = rootOf(actions[i]);
            const group = groups.get(root) ?? { score: 0, first: actions[i].t, members: [], roomy: 0 };
            group.score = Math.max(group.score, accentScore(actions[i], minStrength));
            group.members.push(actions[i]);
            if (step.relaxed || roomy(i)) group.roomy++;
            groups.set(root, group);
        }
        // Un grupo entra si la mayoría de sus vueltas tiene sitio: el riff no pierde
        // el acento en la vuelta que queda a milisegundos del hueco; si alguna no
        // se deja jugar, el validador la devuelve a su acción normal.
        const ranked = [...groups.values()]
            .filter((g) => g.score > 0 && g.roomy * 2 >= g.members.length)
            .sort((x, y) => (y.score - x.score) || (x.first - y.first));
        const picked = [];
        let count = 0;
        for (const g of ranked) {
            if (count > 0 && count + g.members.length > quota) continue;
            if (count >= quota) break;
            picked.push(g);
            count += g.members.length;
        }
        picked.forEach((g, k) => {
            for (const a of g.members) {
                a.accentRank = picked.length > 1 ? k / (picked.length - 1) : 0;
                // Toda la frase con la forma de su primera vuelta en el tramo: la
                // apertura del principio no cambia el largo de una hilera a mitad de riff.
                a.accentShapeT = g.first;
                out.add(a);
            }
        });
    }
    return actions.filter((a) => out.has(a));
}

/**
 * Escalera de holgura, de más holgada a más estrecha: primero se estrecha el
 * margen de todos con los flojos algo más holgados; en el mínimo, los flojos se
 * acercan a los fuertes; y si aún falta exigencia, se cierran las aperturas del
 * sitio en la canción (`closings`) hasta el margen mínimo, nunca por debajo.
 * Pares [escala del margen mínimo, reparto].
 */
function ladder() {
    const R = ACCENT_RULES;
    return [
        ...R.scales.map((scale) => [scale, R.spread]),
        ...R.finalSpreads.map((k) => [1, R.spread * k]),
        ...R.closings.map((scale) => [scale, 0]),
    ];
}

/**
 * Lo que se abre el margen de un acento por su sitio en la canción: su nivel del
 * arco y, en el primer tramo de la canción, la apertura.
 */
function shapeFactor(a, ctx) {
    const R = ACCENT_RULES;
    const level = ctx.arc.segments[a.segment]?.level ?? 2;
    const progress = ctx.durationSec > 0 ? (a.accentShapeT ?? a.t) / ctx.durationSec : 1;
    const opening = progress >= R.opening.progress ? 1 : R.opening.factor - (R.opening.factor - 1) * (progress / R.opening.progress);
    return R.levelMargin[level] * opening;
}
