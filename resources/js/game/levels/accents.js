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
//      (challenge.js) queda más cerca de la que pide la dificultad por minuto de
//      juego. Así una canción de saltos separados a 65 BPM y una de 104 BPM llena
//      de golpes piden lo mismo en Difícil.
//   3. CON QUÉ variante. La que deja el margen más estrecho sin bajar del pedido,
//      a la velocidad con la que cruza (`accentVariant`).
//
// Todo lo ajustable está en ACCENT_RULES y en `accent` de cada dificultad
// (difficulty.js). Cambiar cualquiera altera los charts: sube CHARTER_VERSION.

import { OBSTACLE_KIND } from '../config.js';
import { actionLeadS } from '../systems/physics.js';
import { timingMarginsS } from '../systems/playability.js';
import { kindHazard } from './challenge.js';
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
});

/**
 * @typedef {Object} AccentSummary
 * @property {number} accents   Acciones con variante de acento.
 * @property {number} hazard    Exigencia de los acentos para el jugador de referencia (muertes esperadas).
 * @property {number} budget    Exigencia que pedía la dificultad para esta canción.
 * @property {number} scale     Escalón de holgura con el que se quedó (1 = el margen mínimo).
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
 * @param {number} ctx.introActions  Las primeras acciones (tutorial) nunca llevan acento.
 * @param {number} ctx.durationSec   Duración de la canción (la apertura se mide sobre ella).
 * @returns {AccentSummary}
 */
export function assignAccents(actions, ctx) {
    const rule = ctx.profile.accent ?? null;
    const summary = { accents: 0, hazard: 0, budget: 0, scale: 0 };
    if (rule === null) return summary;
    const chosen = chooseAccents(actions, ctx, rule);
    if (chosen.length === 0) return summary;

    summary.budget = rule.hazardPerMin * playedMinutes(actions, ctx.modes);
    // Escalón a escalón hasta pasar del presupuesto; se queda el más cercano (en
    // proporción) de los dos últimos: pasarse de largo también es fallar. Si ni el
    // margen mínimo llega, se queda en él: la canción no da para más.
    let best = null;
    for (const [scale, spread] of ladder()) {
        const targets = chosen.map((a) => rule.marginS * scale * (1 + spread * (a.accentRank ?? 0)) * shapeFactor(a, ctx));
        const kinds = chosen.map((a, k) => accentVariant(a.kind, a.t, targets[k], ctx));
        const hazard = kinds.reduce((sum, kind, k) => sum + (kind === null ? 0 : kindHazard(kind, chosen[k].t, ctx.speed.speedAt)), 0);
        const step = { targets, kinds, hazard, scale };
        if (hazard < summary.budget - 1e-9) {
            best = step;
            continue;
        }
        if (best === null || Math.log(hazard / summary.budget) < Math.log(summary.budget / Math.max(best.hazard, 1e-6))) best = step;
        break;
    }
    chosen.forEach((a, k) => {
        if (best.kinds[k] === null) return;
        a.kind = best.kinds[k];
        a.accentTarget = best.targets[k];
        summary.accents++;
    });
    summary.hazard = Math.round(best.hazard * 1000) / 1000;
    summary.budget = Math.round(summary.budget * 1000) / 1000;
    summary.scale = best.scale;
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
 * @returns {string | null}
 */
export function accentVariant(baseKind, t, targetS, ctx) {
    const plain = timingMarginsS(baseKind, ctx.speed.speedAt(t + actionLeadS(OBSTACLE_KIND[baseKind])));
    const plainSide = Math.min(plain.early, plain.late);
    let best = null;
    let bestMargin = Infinity;
    for (const kind of variantsOf(baseKind)) {
        const def = OBSTACLE_KIND[kind];
        const m = timingMarginsS(kind, ctx.speed.speedAt(t + actionLeadS(def)));
        const side = Math.min(m.early, m.late);
        // Una variante que a esta velocidad deja MÁS margen que la acción normal no
        // es un acento (el cactus ancho es bajo: a partir de ~600 px/s perdona más).
        if (side >= plainSide || side < targetS - 1e-9 || m.early + m.late < ACCENT_RULES.windowFactor * ctx.profile.toleranceS) continue;
        if (side < bestMargin) {
            bestMargin = side;
            best = kind;
        }
    }
    return best;
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
function accentScore(a) {
    if (a.forced) return 10;
    const chord = a.slot.chord === true;
    if (a.slot.strength < ACCENT_RULES.minStrength && !chord) return 0;
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
function chooseAccents(actions, ctx, rule) {
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
        const list = bySegment.get(a.segment) ?? [];
        list.push(i);
        bySegment.set(a.segment, list);
    });

    const out = new Set();
    for (const [segment, list] of bySegment) {
        const quota = Math.round(Math.min(1, rule.share * ACCENT_RULES.levelFactor[arc.segments[segment].level]) * list.length);
        const groups = new Map();
        for (const i of list) {
            const root = rootOf(actions[i]);
            const group = groups.get(root) ?? { score: 0, first: actions[i].t, members: [], roomy: 0 };
            group.score = Math.max(group.score, accentScore(actions[i]));
            group.members.push(actions[i]);
            if (roomy(i)) group.roomy++;
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
 * acercan a los fuertes. Pares [escala del margen mínimo, reparto].
 */
function ladder() {
    const R = ACCENT_RULES;
    return [
        ...R.scales.map((scale) => [scale, R.spread]),
        ...R.finalSpreads.map((k) => [1, R.spread * k]),
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

/** Minutos de juego con obstáculos: de la primera a la última acción, sin los tramos de vuelo. */
function playedMinutes(actions, modes) {
    if (actions.length < 2) return 0;
    const t0 = actions[0].t;
    const t1 = actions[actions.length - 1].t;
    let seconds = t1 - t0;
    for (const span of modes.plan) {
        if (span.mode === 'fly') seconds -= Math.max(0, Math.min(t1, span.tOut) - Math.max(t0, span.tIn));
    }
    return Math.max(0, seconds) / 60;
}
