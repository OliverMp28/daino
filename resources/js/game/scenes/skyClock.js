// Reloj del cielo (fase E1, doc 11 §2.1): qué hora del día es en cada instante
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
 * Ciclos: cómo corre el cielo en una escena. `journey` es el viaje de la tarde
 * al amanecer anclado a la canción; `fixed` deja el cielo quieto a una hora (una
 * escena de noche perpetua, un atardecer eterno…). Añadir un ciclo es una
 * entrada aquí y su planificador en `planSky`.
 */
export const SKY_CYCLES = Object.freeze({
    journey: Object.freeze({ kind: 'journey', rules: SKY_RULES, hours: SKY_HOURS }),
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
 * @param {{ sections?: Array<{ t: number, level?: number, climax?: boolean }>, durationSec: number }} input
 * @param {{ kind: 'journey', rules: typeof SKY_RULES, hours: typeof SKY_HOURS } | { kind: 'fixed', hour: number }} [cycle]
 */
export function planSky({ sections = [], durationSec }, cycle = SKY_CYCLES.journey) {
    const D = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1;
    if (cycle.kind === 'fixed') {
        return buildPlan(D, [{ t: 0, hour: cycle.hour }, { t: D, hour: cycle.hour }], {}, null);
    }
    const R = cycle.rules;
    const H = cycle.hours;
    const secs = sections
        .filter((s) => s && Number.isFinite(s.t) && s.t >= 0 && s.t < D)
        .sort((a, b) => a.t - b.t);
    const bounds = secs.map((s) => s.t).filter((t) => t > 0.5 && t < D - 0.5);
    const ci = secs.findIndex((s) => s.climax === true);
    const climax = ci >= 0 ? { start: secs[ci].t, end: ci + 1 < secs.length ? secs[ci + 1].t : D } : null;
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
 * @param {number} D
 * @param {Array<{ t: number, hour: number }>} anchors
 * @param {{ eveningStart?: number, nightfall?: number, dawnStart?: number | null }} marks
 * @param {{ R: typeof SKY_RULES, H: typeof SKY_HOURS } | null} journey
 */
function buildPlan(D, anchors, marks, journey) {
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
            if (journey === null) return { from: hour, to: hour, durationS: 0 };
            const { R, H } = journey;
            const to = hour < H.sunDown ? H.sunDown + 0.15 : Math.max(hour, H.sunrise + 0.4);
            const dh = to - hour;
            const durationS = dh > 0 ? clamp(dh * R.epilogueSPerHour, R.epilogueMinS, R.epilogueMaxS) : 0;
            return { from: hour, to, durationS };
        },
    });
}
