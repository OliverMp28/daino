// Recorrido del vuelo: el camino que dibujan las notas mantenidas y su túnel (Ola 6b).
//
// Un tramo de vuelo de un chart es un portal `{ type: 'mode', mode: 'fly', margin }`
// seguido de notas mantenidas `{ type: 'hold', t, until }` y del portal que vuelve a
// correr. Con el Dino subiendo y bajando en línea recta a velocidad fija (modes/fly.js)
// esas notas determinan UN camino: altura en cada instante. El túnel son dos muros
// que siguen ese camino con `margin` de holgura por cada lado.
//
// Todo sale de aquí, sin copias:
//   - la partida pinta los muros (entities/FlightTunnel.js) y choca con ellos,
//   - el simulador del charter choca con los mismos muros,
//   - el charter calcula el camino de las notas que propone.
//
// Unidades: `alt` = altura de la base del box del Dino sobre el suelo (0 en el
// suelo, `MAX_ALT` pegado al techo). Muros en la misma escala.
//
// Coordenada horizontal: el camino está en TIEMPO. Un punto del muro está a la
// distancia del mundo en la que el Dino pasará en ese instante, así que el
// muro se ve llegar con la misma fórmula que los obstáculos (speedProfile.js) y
// su esquina de cada nota cruza al Dino exactamente en el instante de la nota.
//
// Puro, sin Pixi.

import { CORRIDOR_HEIGHT_PX, DINO_HITBOX_PADDING, DINO_SIZE, FLY_MODE } from '../config.js';
import { DINO_CENTER_X } from './geometry.js';
import { modeChanges } from './modeTimeline.js';

/** Altura máxima de la base del Dino: pegado al techo del pasillo. */
export const MAX_ALT = CORRIDOR_HEIGHT_PX - DINO_SIZE.h;

/** Del borde inferior del hitbox a la base del box, y alto del hitbox. */
const HITBOX_BOTTOM = DINO_HITBOX_PADDING.bottom;
const HITBOX_H = DINO_SIZE.h - DINO_HITBOX_PADDING.top - DINO_HITBOX_PADDING.bottom;

/** Margen admitido en un chart: fuera de esto el túnel no sería jugable o no sería un túnel. */
export const FLY_MARGIN_RANGE = Object.freeze({ min: 12, max: 120 });

/**
 * Camino de un tramo de vuelo: puntos (t, alt) unidos por rectas. Empieza en el
 * suelo en `tIn`; cada nota mantenida sube, cada silencio baja, siempre entre el
 * suelo y el techo.
 *
 * @param {Array<{ t: number, until: number }>} holds  En cualquier orden; se recortan al tramo.
 * @param {number} tIn
 * @param {number} tOut
 * @returns {Array<{ t: number, alt: number }>}
 */
export function flightPath(holds, tIn, tOut) {
    const up = FLY_MODE.climbPxS;
    const down = FLY_MODE.divePxS;
    const sorted = holds
        .map((h) => ({ a: Math.max(tIn, h.t), b: Math.min(tOut, h.until) }))
        .filter((h) => h.b > h.a)
        .sort((x, y) => x.a - y.a);

    const points = [{ t: tIn, alt: 0 }];
    let t = tIn;
    let alt = 0;
    const moveTo = (target, rate, limit) => {
        if (target <= t) return;
        const dir = Math.sign(limit - alt);
        if (dir !== 0) {
            const reach = t + Math.abs(limit - alt) / rate;
            if (reach < target) {
                points.push({ t: reach, alt: limit });
                alt = limit;
            } else {
                alt += dir * rate * (target - t);
            }
        }
        points.push({ t: target, alt });
        t = target;
    };
    for (const h of sorted) {
        const a = Math.max(h.a, t);
        moveTo(a, down, 0);
        moveTo(Math.max(a, h.b), up, MAX_ALT);
    }
    moveTo(tOut, down, 0);
    return dedupe(points);
}

/** Altura en un instante (t dentro de [primer punto, último punto]). */
export function altAt(points, t) {
    if (t <= points[0].t) return points[0].alt;
    const last = points[points.length - 1];
    if (t >= last.t) return last.alt;
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (points[m].t <= t) lo = m;
        else hi = m;
    }
    const p = points[lo];
    const q = points[hi];
    return q.t > p.t ? p.alt + (q.alt - p.alt) * ((t - p.t) / (q.t - p.t)) : q.alt;
}

/**
 * Borde superior del muro del suelo y borde inferior del muro del techo con el
 * Dino en `alt`. Fuera del pasillo (≤ 0 o ≥ el techo) no hay muro.
 */
export function wallsFor(alt, margin) {
    return {
        floorWall: alt + HITBOX_BOTTOM - margin,
        ceilingWall: alt + HITBOX_BOTTOM + HITBOX_H + margin,
    };
}

/**
 * Holgura del túnel para una dificultad: el desvío de altura de quien pulsa
 * `toleranceS` tarde o pronto, más lo que se inclina el camino a lo ancho del
 * hitbox a la velocidad más lenta del tramo, más una holgura fija.
 *
 * El desvío es 3 × velocidad × tolerancia, no 1×: empezar una nota tarde Y
 * soltarla pronto deja al Dino una tolerancia por debajo al subir, y al soltar
 * pronto baja mientras el camino aún sube (medido con el simulador). Y como la
 * altura es la suma de todo lo mantenido, esos desvíos se ACUMULAN nota tras
 * nota; por eso el charter hace que el camino vuelva al suelo entre notas
 * (flightCharter.js): el suelo pone el desvío a cero.
 *
 * @param {number} toleranceS
 * @param {number} minSpeedPxS
 */
export function flightMargin(toleranceS, minSpeedPxS) {
    const rate = Math.max(FLY_MODE.climbPxS, FLY_MODE.divePxS);
    const halfWidth = (DINO_SIZE.w - DINO_HITBOX_PADDING.left - DINO_HITBOX_PADDING.right) / 2;
    const slope = rate * (halfWidth / Math.max(1, minSpeedPxS));
    return Math.ceil(3 * rate * toleranceS + slope + FLY_MODE.baseMarginPx);
}

/**
 * Los tramos de vuelo de un chart con su camino y su túnel.
 *
 * @param {Array<{ t: number, type: string, mode?: string, margin?: number, until?: number }>} events
 */
export function createFlightCourse(events) {
    const changes = modeChanges(events);
    const holds = events.filter((e) => e.type === 'hold' && Number.isFinite(e.t) && Number.isFinite(e.until));
    const portals = events.filter((e) => e.type === 'mode' && e.mode === 'fly');

    /**
     * `tWalls`: donde empiezan los muros (la boca del túnel, `FLY_MODE.entryOpenS`).
     * @type {Array<{ tIn: number, tWalls: number, tOut: number, margin: number, points: Array<{ t: number, alt: number }>, holds: Array<{ t: number, until: number }> }>}
     */
    const spans = [];
    for (let i = 0; i < changes.length; i++) {
        if (changes[i].mode !== 'fly') continue;
        const tIn = changes[i].t;
        const tOut = changes[i + 1]?.t ?? Infinity;
        const portal = portals.find((p) => Math.abs(p.t - tIn) < 1e-9);
        const margin = Number.isFinite(portal?.margin) ? portal.margin : FLY_MARGIN_RANGE.max;
        const own = holds.filter((h) => h.t >= tIn && h.t < tOut);
        const end = Number.isFinite(tOut) ? tOut : Math.max(tIn, ...own.map((h) => h.until)) + MAX_ALT / FLY_MODE.divePxS;
        spans.push({ tIn, tWalls: Math.min(end, tIn + FLY_MODE.entryOpenS), tOut: end, margin, points: flightPath(own, tIn, end), holds: own });
    }

    const spanAt = (t) => {
        for (const s of spans) if (t >= s.tIn && t <= s.tOut) return s;
        return null;
    };

    return {
        spans,
        empty: spans.length === 0,
        /** Fin del último tramo de vuelo (−∞ si no hay). */
        lastEnd: spans.length === 0 ? -Infinity : spans[spans.length - 1].tOut,

        /** Altura del camino en `t`, o null fuera de un tramo de vuelo. */
        altAt(t) {
            const s = spanAt(t);
            return s === null ? null : altAt(s.points, t);
        },

        /**
         * ¿Toca el hitbox algún muro del túnel en el instante `t`?
         *
         * El hitbox tiene anchura: su borde izquierdo está donde el camino estuvo
         * hace un momento y el derecho donde estará. Se comprueban los muros en todo
         * ese intervalo de tiempo (extremos y esquinas del camino dentro), así una
         * esquina no atraviesa el hitbox entre dos pasos de física.
         *
         * @param {{ x: number, y: number, w: number, h: number }} box  Coordenadas de mundo.
         * @param {number} t
         * @param {number} groundY
         * @param {number} speedPxS  Velocidad del mundo en `t`.
         */
        collisionAt(box, t, groundY, speedPxS) {
            if (spans.length === 0) return false;
            const v = Math.max(1, speedPxS);
            const t0 = t + (box.x - DINO_CENTER_X) / v;
            const t1 = t + (box.x + box.w - DINO_CENTER_X) / v;
            const bottomAlt = groundY - (box.y + box.h);
            const topAlt = groundY - box.y;
            for (const s of spans) {
                const a = Math.max(t0, s.tWalls);
                const b = Math.min(t1, s.tOut);
                if (b < a) continue;
                let lowest = Infinity;
                let highest = -Infinity;
                const visit = (alt) => {
                    if (alt < lowest) lowest = alt;
                    if (alt > highest) highest = alt;
                };
                visit(altAt(s.points, a));
                visit(altAt(s.points, b));
                for (const p of s.points) if (p.t > a && p.t < b) visit(p.alt);
                // El muro del suelo sube con el camino más alto del intervalo; el del
                // techo baja con el más bajo.
                const floorWall = wallsFor(highest, s.margin).floorWall;
                const ceilingWall = wallsFor(lowest, s.margin).ceilingWall;
                if (floorWall > 0 && bottomAlt < floorWall - 1e-6) return true;
                if (ceilingWall < CORRIDOR_HEIGHT_PX && topAlt > ceilingWall + 1e-6) return true;
            }
            return false;
        },
    };
}

function dedupe(points) {
    const out = [];
    for (const p of points) {
        const prev = out[out.length - 1];
        if (prev !== undefined && Math.abs(prev.t - p.t) < 1e-9) {
            prev.alt = p.alt;
            continue;
        }
        out.push({ t: p.t, alt: p.alt });
    }
    return out;
}
