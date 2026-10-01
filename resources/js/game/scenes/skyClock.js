// Reloj del cielo (T01, doc 11 §2.1): qué hora del día es en cada instante
// de la canción. EL CIELO CUENTA LA CANCIÓN.
//
// En una canción típica el día cubre la intro, las estrofas y los estribillos;
// el atardecer cae en la sección que prepara el final (la calma antes de la
// noche); la noche de neón es el clímax, y el amanecer, la resolución. Así que el
// plan se ancla a la estructura que el charter ya escribe en el chart (eventos
// `section` con `level` y `climax`), igual que speedCues.js deriva las marchas de
// `world.speedChanges`: sin campos nuevos en el chart, sin tocar el charter.
//
// La hora es continua (5:00 del día siguiente = 29) y lineal a trozos entre
// anclas: nunca retrocede. Puro y sin Pixi.

import { phaseOfHour } from './skyModel.js';
import { placeStory, songOutline } from './stories/index.js';

/**
 * Horas del viaje. Las del ocaso y el alba se miden con la cordillera delante:
 * el sol asoma sobre las crestas hasta ~18:25 y a las 18:50 ya se ha hundido.
 */
export const SKY_HOURS = Object.freeze({
    /** Nunca se empieza antes: un día largo empieza temprano, pero no de mañana. */
    dayStartMin: 13,
    /** Empieza la tarde dorada: arranca el atardecer. */
    golden: 17.25,
    /** El sol ya se ha hundido tras las montañas (así acaban las canciones cortas). */
    sunDown: 18.85,
    /** Noche cerrada: estrellas fuera. Cae con el drop del clímax. */
    nightfall: 19.5,
    /** Primera luz (5:00 del día siguiente). */
    firstLight: 29,
    /** El sol asoma sobre las crestas (6:36): así acaba la canción con amanecer. */
    sunrise: 30.6,
});

/**
 * Reglas del reparto. Tabla congelada: se retoca con HMR tras un playtest.
 *
 *   minDayS / minDayFraction  El atardecer de una canción larga no empieza antes
 *                             de 1:00 ni del 35 % (petición del user: nada
 *                             "dentro del minuto 1").
 *   eveningTargetS            Lo que dura el atardecer ideal (hora dorada, ocaso y
 *                             hora azul): empieza en el límite de sección más
 *                             cercano a `clímax − 36 s`.
 *   eveningMinS               Un atardecer más corto se vería a trompicones.
 *   noClimaxFraction          Sin clímax utilizable, el atardecer empieza en el
 *                             primer límite desde el 45 % (y 1:00).
 *   nightMinS                 Una noche más corta no deja ver la luna.
 *   nightNominalS             Ritmo de la noche cuando la canción acaba de noche.
 *   dawnMinS / dawnMaxS       El amanecer ocupa la última sección si deja 8-26 s…
 *   dawnFallbackS             …si no, los últimos 20 s (si la noche cabe).
 *   short*                    Canción corta: el sol se pone en su última sección,
 *                             en el último límite entre D − 36 y D − 16 s (o en
 *                             D − 45 % acotado a 20-36 s).
 *   dayNominalS               Un día de 120 s va de las 14:30 a la tarde dorada:
 *                             el sol baja siempre al mismo ritmo, y una canción
 *                             con un día más corto empieza más tarde.
 *   epilogue*                 Tras superar el nivel el cielo sigue hasta el
 *                             siguiente hito (se pone el sol, o sale): 1.6 s por
 *                             hora de cielo, entre 4 y 14 s.
 */
export const SKY_RULES = Object.freeze({
    minDayS: 60,
    minDayFraction: 0.35,
    eveningTargetS: 36,
    eveningMinS: 20,
    noClimaxFraction: 0.45,
    nightMinS: 15,
    nightNominalS: 60,
    dawnMinS: 8,
    dawnMaxS: 26,
    dawnFallbackS: 20,
    shortMaxS: 36,
    shortMinS: 16,
    shortFraction: 0.45,
    shortFloorS: 20,
    dayNominalS: 120,
    epilogueSPerHour: 1.6,
    epilogueMinS: 4,
    epilogueMaxS: 14,
});

/**
 * La noche de una ciudad (T02.4, ciclo `nocturne`): la canción empieza en la hora
 * azul, cuando la ciudad enciende sus ventanas, y la noche es la canción entera.
 *
 *   startHour         Hora azul del principio (el sol acaba de ponerse).
 *   nightfallTargetS  La noche se cierra en el límite de sección más cercano a
 *   nightfallMinS/MaxS   estos segundos, entre el mínimo y el máximo.
 *   nightfallFraction Canción corta: la noche se cierra a esta fracción.
 *   climaxHour        El clímax empieza a medianoche: la hora más viva de la ciudad.
 *   climaxMinAfterS   …si llega al menos tantos segundos después de cerrarse la noche.
 *   shortEndHour      Una canción sin alba termina, como mucho, a esta hora.
 */
export const NOCTURNE_RULES = Object.freeze({
    startHour: 19,
    nightfallTargetS: 20,
    nightfallMinS: 10,
    nightfallMaxS: 32,
    nightfallFraction: 0.35,
    climaxHour: 24,
    climaxMinAfterS: 20,
    shortEndHour: 23,
});

/**
 * Ciclos: cómo corre el cielo en una escena. `journey` es el viaje de la tarde
 * al amanecer anclado a la canción; `nocturne`, una noche entera de la hora azul
 * al alba (T02.4, la ciudad); `fixed` deja el cielo quieto a una hora. Añadir un
 * ciclo es una entrada aquí y su planificador en `planSky`.
 *
 * Una historia de autor (T02.6) trae su propio ciclo: `{ kind: 'story', story }`
 * (registry.sceneCycle), con las horas de sus momentos (stories/).
 */
export const SKY_CYCLES = Object.freeze({
    journey: Object.freeze({ kind: 'journey', rules: SKY_RULES, hours: SKY_HOURS }),
    nocturne: Object.freeze({ kind: 'nocturne', rules: SKY_RULES, hours: SKY_HOURS, night: NOCTURNE_RULES }),
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** El valor de `list` más cercano a `target` (el más tardío si empatan), o null. */
function nearest(list, target) {
    let best = null;
    for (const v of list) {
        if (best === null || Math.abs(v - target) <= Math.abs(best - target)) best = v;
    }
    return best;
}

/**
 * Plan del cielo de un nivel.
 *
 * @param {{ sections?: Array<{ t: number, level?: number, climax?: boolean }>, fx?: Array<{ t: number, fx: string }>, durationSec: number }} input
 *   Los eventos `section` y `fx` del chart (las historias leen también los drops).
 * @param {{ kind: 'journey', rules: typeof SKY_RULES, hours: typeof SKY_HOURS } | { kind: 'fixed', hour: number } | { kind: 'story', story: object }} [cycle]
 */
export function planSky({ sections = [], fx = [], durationSec }, cycle = SKY_CYCLES.journey) {
    const D = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1;
    if (cycle.kind === 'fixed') {
        return buildPlan(D, [{ t: 0, hour: cycle.hour }, { t: D, hour: cycle.hour }], {}, null);
    }
    if (cycle.kind === 'story') return planStory(D, { sections, fx, durationSec: D }, cycle.story);
    const R = cycle.rules;
    const H = cycle.hours;
    const secs = sections
        .filter((s) => s && Number.isFinite(s.t) && s.t >= 0 && s.t < D)
        .sort((a, b) => a.t - b.t);
    const bounds = secs.map((s) => s.t).filter((t) => t > 0.5 && t < D - 0.5);
    const ci = secs.findIndex((s) => s.climax === true);
    const climax = ci >= 0 ? { start: secs[ci].t, end: ci + 1 < secs.length ? secs[ci + 1].t : D } : null;
    if (cycle.kind === 'nocturne') return planNocturne(D, bounds, climax, R, H, cycle.night);
    const dayRate = (H.golden - 14.5) / R.dayNominalS;
    const dayStartFor = (eveningStart) => clamp(H.golden - eveningStart * dayRate, H.dayStartMin, H.golden - 0.25);

    // ---------- Atardecer y noche ----------
    const earliest = Math.max(R.minDayS, R.minDayFraction * D);
    let eveningStart;
    let nightfall;
    let anchoredToClimax = false;
    if (climax !== null && climax.start - R.eveningMinS >= earliest) {
        const lo = earliest;
        const hi = climax.start - R.eveningMinS;
        const target = climax.start - R.eveningTargetS;
        eveningStart = nearest(bounds.filter((b) => b >= lo && b <= hi), target) ?? clamp(target, lo, hi);
        nightfall = climax.start;
        anchoredToClimax = true;
    } else {
        const from = Math.max(R.minDayS, R.noClimaxFraction * D);
        eveningStart = bounds.find((b) => b >= from) ?? from;
        nightfall = eveningStart + R.eveningTargetS;
    }

    // ---------- Canción corta: el sol se pone en su última sección ----------
    if (nightfall + R.nightMinS > D) {
        const inWindow = bounds.filter((b) => b >= D - R.shortMaxS && b <= D - R.shortMinS);
        const start = inWindow.length > 0
            ? inWindow[inWindow.length - 1]
            : Math.max(0, D - clamp(R.shortFraction * D, R.shortFloorS, R.shortMaxS));
        const anchors = start > 0.01
            ? [{ t: 0, hour: dayStartFor(start) }, { t: start, hour: H.golden }, { t: D, hour: H.sunDown }]
            : [{ t: 0, hour: H.golden }, { t: D, hour: H.sunDown }];
        return buildPlan(D, anchors, { eveningStart: start }, { R, H });
    }

    // ---------- Amanecer ----------
    const afterClimax = anchoredToClimax ? climax.end : nightfall;
    const dawnCandidates = bounds.filter((b) => b >= afterClimax
        && b - nightfall >= R.nightMinS
        && D - b >= R.dawnMinS
        && D - b <= R.dawnMaxS);
    let dawnStart = dawnCandidates.length > 0 ? dawnCandidates[dawnCandidates.length - 1] : null;
    if (dawnStart === null && D - R.dawnFallbackS - nightfall >= R.nightMinS) dawnStart = D - R.dawnFallbackS;

    const anchors = [
        { t: 0, hour: dayStartFor(eveningStart) },
        { t: eveningStart, hour: H.golden },
        { t: nightfall, hour: H.nightfall },
    ];
    if (dawnStart !== null) {
        anchors.push({ t: dawnStart, hour: H.firstLight }, { t: D, hour: H.sunrise });
    } else {
        // Acaba de noche (el clímax dura hasta el final): la luna sigue su curso.
        const endHour = H.nightfall + (D - nightfall) * (H.firstLight - H.nightfall) / R.nightNominalS;
        anchors.push({ t: D, hour: Math.min(H.firstLight - 0.5, endHour) });
    }
    return buildPlan(D, anchors, { eveningStart, nightfall, dawnStart }, { R, H });
}

/**
 * La noche de una ciudad (`nocturne`): hora azul al empezar, la noche cerrada en
 * el primer límite de sección cercano a los 20 s, medianoche en el drop del
 * clímax y el alba con las mismas reglas del viaje (la última sección, si deja
 * 8-26 s; si no, los últimos 20 s; si tampoco, acaba de noche).
 *
 * @param {number} D
 * @param {number[]} bounds
 * @param {{ start: number, end: number } | null} climax
 * @param {typeof SKY_RULES} R
 * @param {typeof SKY_HOURS} H
 * @param {typeof NOCTURNE_RULES} N
 */
function planNocturne(D, bounds, climax, R, H, N) {
    const near = bounds.filter((b) => b >= N.nightfallMinS && b <= Math.min(N.nightfallMaxS, D * 0.5));
    const nightfall = nearest(near, N.nightfallTargetS) ?? Math.min(N.nightfallTargetS, D * N.nightfallFraction);
    const anchors = [{ t: 0, hour: N.startHour }, { t: nightfall, hour: H.nightfall }];

    // Canción corta: no cabe el alba; la noche avanza hasta la hora de las cortas.
    if (nightfall + R.nightMinS > D) {
        anchors.push({ t: D, hour: Math.max(H.nightfall + 0.5, Math.min(N.shortEndHour, H.nightfall + (D - nightfall) / R.nightNominalS * 3)) });
        return buildPlan(D, anchors, { nightfall }, { R, H });
    }

    const midnight = climax !== null && climax.start - nightfall >= N.climaxMinAfterS ? climax.start : null;
    // El alba nunca llega antes de que acabe el clímax, aunque caiga tan pronto que
    // no le dé tiempo a ser medianoche: el clímax es lo más hondo de la noche.
    const afterPeak = climax !== null && climax.end > nightfall ? climax.end : nightfall;
    const dawnCandidates = bounds.filter((b) => b >= afterPeak
        && b - (midnight ?? nightfall) >= R.nightMinS
        && D - b >= R.dawnMinS
        && D - b <= R.dawnMaxS);
    let dawnStart = dawnCandidates.length > 0 ? dawnCandidates[dawnCandidates.length - 1] : null;
    if (dawnStart === null && D - R.dawnFallbackS - (midnight ?? nightfall) >= R.nightMinS) dawnStart = D - R.dawnFallbackS;

    if (midnight !== null) anchors.push({ t: midnight, hour: N.climaxHour });
    if (dawnStart !== null) {
        anchors.push({ t: dawnStart, hour: H.firstLight }, { t: D, hour: H.sunrise });
    } else {
        // Acaba de noche: la madrugada sigue a su ritmo, sin llegar a la primera luz.
        const from = anchors[anchors.length - 1];
        const endHour = from.hour + (D - from.t) * (H.firstLight - H.nightfall) / R.nightNominalS;
        anchors.push({ t: D, hour: Math.min(H.firstLight - 0.5, Math.max(from.hour + 0.25, endHour)) });
    }
    return buildPlan(D, anchors, { nightfall, dawnStart }, { R, H });
}

/**
 * El cielo de una historia de autor (T02.6): de momento en momento de su relato,
 * a las horas que ella dice, con la cámara lenta de sus `holds`. Tras superar el
 * nivel, el epílogo sigue hasta su `epilogueHour`.
 *
 * @param {number} D
 * @param {{ sections: Array<object>, fx: Array<object>, durationSec: number }} input
 * @param {ReturnType<typeof import('./stories/index.js').bindStory>} story
 */
function planStory(D, input, story) {
    const placed = placeStory(story, songOutline(input));
    const at = (id) => placed.moments.find((m) => m.id === id)?.t ?? null;
    return buildPlan(
        D,
        placed.anchors,
        { eveningStart: at('touch'), nightfall: at('farewell'), dawnStart: at('dawn') },
        null,
        { story: { id: story.id, moments: placed.moments, captions: placed.captions, holds: placed.holds }, epilogueTo: story.epilogueHour },
    );
}

/**
 * @param {number} D
 * @param {Array<{ t: number, hour: number }>} anchors
 * @param {{ eveningStart?: number, nightfall?: number, dawnStart?: number | null }} marks
 * @param {{ R: typeof SKY_RULES, H: typeof SKY_HOURS } | null} journey
 * @param {{ story?: object, epilogueTo?: number }} [extra]  Historias (T02.6): su
 *   relato colocado en la canción y la hora a la que llega el epílogo.
 */
function buildPlan(D, anchors, marks, journey, extra = {}) {
    const pts = Object.freeze(anchors.map((a) => Object.freeze({ t: a.t, hour: a.hour })));

    function hourAt(t) {
        if (!(t > pts[0].t)) return pts[0].hour;
        for (let i = 1; i < pts.length; i++) {
            const b = pts[i];
            if (t <= b.t) {
                const a = pts[i - 1];
                return b.t > a.t ? a.hour + (b.hour - a.hour) * (t - a.t) / (b.t - a.t) : b.hour;
            }
        }
        return pts[pts.length - 1].hour;
    }

    /** Primer instante en que el cielo llega a `hour`, o null si no llega. */
    function timeAtHour(hour) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            if (hour >= a.hour && hour <= b.hour && b.hour > a.hour) return a.t + (b.t - a.t) * (hour - a.hour) / (b.hour - a.hour);
        }
        return null;
    }

    const events = Object.freeze({
        eveningStart: marks.eveningStart ?? null,
        sunDown: journey ? timeAtHour(journey.H.sunDown) : null,
        nightfall: marks.nightfall ?? null,
        dawnStart: marks.dawnStart ?? null,
        sunrise: journey && marks.dawnStart != null ? D : null,
    });

    return Object.freeze({
        durationSec: D,
        anchors: pts,
        events,
        /** La historia de autor colocada en la canción (momentos y rótulos), o null. */
        story: extra.story ?? null,
        hourAt,
        timeAtHour,
        /** Fase del cielo (clave de SKY_PHASES) en el instante `t`. */
        phaseAt: (t) => phaseOfHour(hourAt(t)),
        /**
         * Epílogo tras superar el nivel: hasta dónde sigue el cielo y en cuánto.
         * Si el sol aún no se había puesto, termina de ponerse; si era de noche o
         * de alba, sale.
         *
         * @param {number} hour  Hora con la que acabó la canción.
         * @returns {{ from: number, to: number, durationS: number }}
         */
        epilogue(hour) {
            if (Number.isFinite(extra.epilogueTo)) {
                const R = SKY_RULES;
                const dh = extra.epilogueTo - hour;
                const durationS = dh > 0 ? clamp(dh * R.epilogueSPerHour, R.epilogueMinS, R.epilogueMaxS) : 0;
                return { from: hour, to: Math.max(hour, extra.epilogueTo), durationS };
            }
            if (journey === null) return { from: hour, to: hour, durationS: 0 };
            const { R, H } = journey;
            const to = hour < H.sunDown ? H.sunDown + 0.15 : Math.max(hour, H.sunrise + 0.4);
            const dh = to - hour;
            const durationS = dh > 0 ? clamp(dh * R.epilogueSPerHour, R.epilogueMinS, R.epilogueMaxS) : 0;
            return { from: hour, to, durationS };
        },
    });
}
