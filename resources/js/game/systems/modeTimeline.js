// Línea de modos de un chart — qué modo de movimiento rige cada instante (Ola 6).
//
// Un chart cambia de modo con eventos `{ t, type: 'mode', mode }`: en `t` un
// portal cruza al Dino y desde ese instante rigen las reglas del modo nuevo. Todo
// nivel empieza corriendo. La leen la partida, el spawner de portales, el
// simulador del charter y la validación del formato, así que la interpretación
// es una sola.

import { DEFAULT_MODE, isMovementMode } from './modes/index.js';

/**
 * @typedef {Object} ModeChange
 * @property {number} t     Instante en que el portal cruza al Dino.
 * @property {string} mode  Modo que empieza.
 * @property {string} from  Modo que termina.
 */

/**
 * @typedef {Object} ModeSegment
 * @property {string} mode
 * @property {number} t0
 * @property {number} t1   Infinity si llega al final.
 */

/**
 * Cambios de modo válidos de una lista de eventos, en orden. Los que no cambian
 * nada (repetir el modo vigente) o nombran un modo desconocido se ignoran.
 *
 * @param {Array<{ t: number, type: string, mode?: string }>} events
 * @returns {ModeChange[]}
 */
export function modeChanges(events) {
    const raw = events
        .filter((e) => e.type === 'mode' && Number.isFinite(e.t) && isMovementMode(e.mode))
        .sort((a, b) => a.t - b.t);
    const out = [];
    let current = DEFAULT_MODE;
    for (const e of raw) {
        if (e.mode === current) continue;
        out.push({ t: e.t, mode: e.mode, from: current });
        current = e.mode;
    }
    return out;
}

/**
 * @param {Array<{ t: number, type: string, mode?: string }>} events
 */
export function createModeTimeline(events) {
    const changes = modeChanges(events);

    /** @type {ModeSegment[]} */
    const segments = [];
    let t0 = 0;
    let mode = DEFAULT_MODE;
    for (const c of changes) {
        if (c.t > t0) segments.push({ mode, t0, t1: c.t });
        mode = c.mode;
        t0 = c.t;
    }
    segments.push({ mode, t0, t1: Infinity });

    /** Índice del primer cambio con t > songTime. */
    const nextIndex = (songTime) => {
        let lo = 0;
        let hi = changes.length;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (changes[m].t <= songTime) lo = m + 1;
            else hi = m;
        }
        return lo;
    };

    return {
        changes,
        segments,
        /** true si el nivel no sale nunca de correr. */
        constant: changes.length === 0,

        /** Modo que rige en `songTime` (un portal en t ya rige en t). */
        modeAt(songTime) {
            const i = nextIndex(songTime);
            return i === 0 ? DEFAULT_MODE : changes[i - 1].mode;
        },

        /** Próximo cambio estrictamente posterior a `songTime`, o null. */
        nextChange(songTime) {
            return changes[nextIndex(songTime)] ?? null;
        },

        /** Tramos de un modo concreto (sin el modo por defecto si no se pide). */
        segmentsOf(modeId) {
            return segments.filter((s) => s.mode === modeId);
        },
    };
}
