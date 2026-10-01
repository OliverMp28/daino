// Historias de autor (T02.6, doc 11 §2.8-2.10): momentos coreografiados para UNA
// canción oficial, sobre un ambiente (One Day, sobre la Costa).
//
// Una historia declara:
//   moments   Los momentos de su relato, en orden. Cada uno se ANCLA a la
//             estructura de su canción (`at`: una función del esquema de la
//             canción —límites de sección, drops, subidas, clímax—, nunca
//             segundos puestos a mano: sobrevive a un re-charteo y a un
//             analizador nuevo) y ocurre a una HORA del cielo. El ciclo `story`
//             del reloj del cielo (skyClock.js) va de uno a otro: así el sol se
//             pone justo en la despedida.
//   holds     Cámara lenta alrededor de un momento: el destello verde dura
//             segundos de canción, no décimas. En esas ventanas (y mientras se
//             lee un rótulo) los efectos de la música se apartan: el cielo es de
//             la historia (GameSession).
//   captions  Rótulos breves que aparecen con un momento.
//   tracks    Coreografía de cada objeto de la historia (el barco, el cabo),
//             en fotogramas clave por HORA del cielo. El escenario depende de la
//             hora, nunca del audio (doc 11 §2.4): el panel dev enseña cualquier
//             instante de la historia moviendo la hora, y el epílogo tras superar
//             el nivel sigue la historia sin código aparte.
//
// Una hora se escribe como número (horas continuas: las 5:00 del día siguiente
// son 29), como el id de un momento, o como `{ limb: 'set' | 'rise', dh }`: el
// último instante del sol al ponerse en el horizonte de SU escena (o el primero
// al salir), del modelo del cielo, más `dh` horas. Así el barco y el destello
// caen donde de verdad se pone el sol aunque cambie la paleta.
//
// Puro y sin Pixi: el reloj del cielo, las capas de la historia y los tests lo
// usan igual.

import { sunLimbHour } from '../skyModel.js';
import { ONE_DAY_STORY } from './oneDay.js';

/** Historias por id (el `story` de una escena del registro). */
export const STORY_DEFS = Object.freeze({
    'one-day': ONE_DAY_STORY,
});

/** Hora de una historia: continua de 12:00 a 35:59 (las 5:00 del día siguiente son 29). */
export function storyHour(hour) {
    const h = ((hour % 24) + 24) % 24;
    return h < 12 ? h + 24 : h;
}

/**
 * Liga una historia a su escena: las horas de sus momentos en el cielo de ESA
 * escena y sus pistas con horas numéricas. Lo hace el registro al cargar.
 *
 * @param {object} def    Definición de la historia (p. ej. ONE_DAY_STORY).
 * @param {import('../registry.js').SceneDef} scene
 */
export function bindStory(def, scene) {
    const hours = {};
    const hourOf = (spec) => {
        if (typeof spec === 'number') return spec;
        if (typeof spec === 'string') {
            if (!(spec in hours)) throw new Error(`historia ${def.id}: momento desconocido "${spec}"`);
            return hours[spec];
        }
        if (spec !== null && typeof spec === 'object') {
            const base = spec.limb !== undefined ? storyHour(sunLimbHour(scene, spec.limb)) : hourOf(spec.moment);
            return base + (spec.dh ?? 0);
        }
        throw new Error(`historia ${def.id}: hora inválida ${JSON.stringify(spec)}`);
    };
    let prev = -Infinity;
    for (const m of def.moments) {
        const h = hourOf(m.hour);
        if (!(h > prev)) throw new Error(`historia ${def.id}: el momento "${m.id}" no va después del anterior en el cielo`);
        hours[m.id] = h;
        prev = h;
    }
    const tracks = {};
    for (const [prop, channels] of Object.entries(def.tracks)) {
        tracks[prop] = {};
        for (const [name, keys] of Object.entries(channels)) {
            const bound = keys.map(([h, v]) => [hourOf(h), v]);
            for (let i = 1; i < bound.length; i++) {
                if (bound[i][0] < bound[i - 1][0]) throw new Error(`historia ${def.id}: la pista ${prop}.${name} retrocede en la hora`);
            }
            tracks[prop][name] = bound;
        }
    }
    return deepFreeze({
        id: def.id,
        label: def.label,
        minGapS: def.minGapS ?? 2,
        moments: def.moments.map((m) => ({ id: m.id, label: m.label, hour: hours[m.id], at: m.at })),
        holds: def.holds ?? [],
        captions: def.captions ?? [],
        tracks,
        epilogueHour: hourOf(def.epilogueHour),
    });
}

/**
 * Valor de una pista `[[hora, valor], …]` a una hora: lineal entre claves y
 * plana fuera de ellas. Dos claves con la misma hora hacen un salto.
 *
 * @param {ReadonlyArray<readonly [number, number]>} track
 * @param {number} hour  Hora continua (se lleva a la de la historia).
 */
export function trackAt(track, hour) {
    if (!track || track.length === 0) return 0;
    const h = storyHour(hour);
    if (h <= track[0][0]) return track[0][1];
    for (let i = 1; i < track.length; i++) {
        const [hb, vb] = track[i];
        if (h < hb) {
            const [ha, va] = track[i - 1];
            return hb > ha ? va + (vb - va) * (h - ha) / (hb - ha) : vb;
        }
    }
    return track[track.length - 1][1];
}

/**
 * Esquema de la canción que leen los momentos: secciones del chart (con su
 * nivel del arco y el clímax), sus límites y los efectos de estructura (subidas
 * hacia un drop, drops, lifts). Todo del chart: nada de segundos a mano.
 *
 * @param {{ durationSec: number, sections?: Array<{ t: number, level?: number, climax?: boolean }>, fx?: Array<{ t: number, fx?: string }> }} input
 */
export function songOutline({ durationSec, sections = [], fx = [] }) {
    const D = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1;
    const secs = sections
        .filter((s) => s && Number.isFinite(s.t) && s.t >= 0 && s.t < D)
        .slice()
        .sort((a, b) => a.t - b.t);
    const bounds = secs.map((s) => s.t).filter((t) => t > 0.5 && t < D - 0.5);
    const ci = secs.findIndex((s) => s.climax === true);
    const climax = ci >= 0 ? { start: secs[ci].t, end: ci + 1 < secs.length ? secs[ci + 1].t : D } : null;
    const fxTimes = (kind) => fx.filter((e) => e && e.fx === kind && Number.isFinite(e.t)).map((e) => e.t).sort((a, b) => a - b);
    const within = (list, a, b) => list.filter((t) => t >= a && t <= b);
    return Object.freeze({
        D,
        sections: secs,
        bounds,
        climax,
        drops: fxTimes('drop'),
        builds: fxTimes('build'),
        lifts: fxTimes('lift'),
        /** El primer valor de `list` en [a, b], o null. */
        first: (list, a, b) => within(list, a, b)[0] ?? null,
        /** El último valor de `list` en [a, b], o null. */
        last: (list, a, b) => within(list, a, b).at(-1) ?? null,
        /** El valor de `list` en [a, b] más cercano a `target`, o null. */
        nearest: (list, target, a, b) => {
            let best = null;
            for (const t of within(list, a, b)) if (best === null || Math.abs(t - target) < Math.abs(best - target)) best = t;
            return best;
        },
    });
}

/**
 * Coloca una historia en su canción: el instante de cada momento, las anclas del
 * cielo (con la cámara lenta de los `holds`) y los rótulos.
 *
 * Los momentos se resuelven en cualquier orden (uno puede depender de uno
 * posterior: el sol toca el mar 8 s antes de la despedida) y después se ordenan
 * dentro de la canción con `minGapS` entre ellos. Si la canción es tan corta que
 * no caben, se reparten en proporción: una historia nunca rompe un nivel.
 *
 * @param {ReturnType<typeof bindStory>} story
 * @param {ReturnType<typeof songOutline>} outline
 * @returns {{ moments: Array<{ id: string, label: string, t: number, hour: number }>, anchors: Array<{ t: number, hour: number }>, captions: Array<{ t: number, holdS: number, text: string }>, holds: Array<{ id: string, t0: number, t: number, t1: number }> }}
 */
export function placeStory(story, outline) {
    const { D } = outline;
    const times = new Map();
    const resolving = new Set();
    const at = (id) => {
        if (times.has(id)) return times.get(id);
        const def = story.moments.find((m) => m.id === id);
        if (def === undefined) throw new Error(`historia ${story.id}: momento desconocido "${id}"`);
        if (resolving.has(id)) throw new Error(`historia ${story.id}: el momento "${id}" depende de sí mismo`);
        resolving.add(id);
        const t = def.at(outline, at);
        resolving.delete(id);
        times.set(id, Number.isFinite(t) ? t : NaN);
        return times.get(id);
    };
    const n = story.moments.length;
    let ts = story.moments.map((m) => at(m.id));
    const gap = story.minGapS;
    const fits = ts.every(Number.isFinite) && (n - 1) * gap <= D;
    if (fits) {
        // Dentro de la canción y en orden, con aire entre momentos: primero hacia
        // delante y, si el último se sale, hacia atrás desde el final.
        ts = ts.map((t) => Math.min(Math.max(t, 0), D));
        ts[0] = 0;
        ts[n - 1] = D;
        for (let i = 1; i < n; i++) ts[i] = Math.max(ts[i], ts[i - 1] + gap);
        for (let i = n - 2; i >= 0; i--) ts[i] = Math.min(ts[i], ts[i + 1] - gap);
        ts[0] = 0;
    }
    if (!fits || ts.some((t, i) => i > 0 && !(t > ts[i - 1]))) {
        ts = story.moments.map((_, i) => (D * i) / Math.max(1, n - 1));
    }
    const moments = story.moments.map((m, i) => Object.freeze({ id: m.id, label: m.label, t: ts[i], hour: m.hour }));

    // Anclas: los momentos y, alrededor de los que tienen cámara lenta, un
    // tramo corto en que la hora apenas avanza. Nunca cruzan a sus vecinos.
    const anchors = [];
    for (let i = 0; i < n; i++) {
        const m = moments[i];
        const hold = story.holds.find((h) => h.at === m.id);
        if (hold && i > 0) {
            const prev = anchors[anchors.length - 1];
            const t = m.t - hold.beforeS;
            const hour = m.hour - hold.dhBefore;
            if (t > prev.t + 0.5 && hour > prev.hour) anchors.push({ t, hour });
        }
        anchors.push({ t: m.t, hour: m.hour });
        if (hold && i < n - 1) {
            const next = moments[i + 1];
            const t = m.t + hold.afterS;
            const hour = m.hour + hold.dhAfter;
            if (t < next.t - 0.5 && hour < next.hour) anchors.push({ t, hour });
        }
    }

    // Las ventanas de cámara lenta en segundos de canción: los instantes clave de
    // la historia, donde los efectos de la música se apartan (GameSession).
    const holds = story.holds
        .map((h) => {
            const m = moments.find((x) => x.id === h.at);
            if (m === undefined) throw new Error(`historia ${story.id}: cámara lenta en un momento desconocido "${h.at}"`);
            return Object.freeze({ id: m.id, t0: Math.max(0, m.t - h.beforeS), t: m.t, t1: Math.min(D, m.t + h.afterS) });
        })
        .sort((a, b) => a.t0 - b.t0);

    const captions = story.captions
        .map((c) => {
            const m = moments.find((x) => x.id === c.at);
            if (m === undefined) throw new Error(`historia ${story.id}: rótulo en un momento desconocido "${c.at}"`);
            return Object.freeze({ t: Math.min(Math.max(0, m.t + (c.afterS ?? 0)), Math.max(0, D - c.holdS)), holdS: c.holdS, text: c.text });
        })
        .sort((a, b) => a.t - b.t);

    return { moments, anchors, captions, holds };
}

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}
