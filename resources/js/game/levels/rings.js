// Anillos de salto — con qué obstáculo se juega cada anillo (Ola 6c).
//
// patterns.js decide DÓNDE va un anillo: sobre un golpe que sigue a un salto
// demasiado cerca para volver a saltar desde el suelo. Aquí se decide QUÉ lo hace
// necesario. Un anillo que se puede ignorar no es una acción: si el primer salto
// ya salva lo que viene, pulsar en el aro no cambia nada y el jugador aprende a no
// hacerle caso. Por eso cada anillo lleva el obstáculo más corto que:
//
//   1. se supera pulsando dentro del aro en el golpe, con la tolerancia de la
//      dificultad (las pautas del validador), y
//   2. NO se supera sin esa pulsación.
//
// Medido con el simulador (patterns.js, PAIR_GAP): un cactus suelto basta desde
// ~0.24 s tras el salto; antes, el primer salto aún lo salva y hace falta una
// hilera (88-288 de largo según la velocidad). Si ninguno cumple, el anillo se
// quita (el golpe se queda sin acción antes que con una acción de mentira).
//
// Sin azar y con memoria: la misma figura a la misma velocidad da el mismo obstáculo.

import { OBSTACLE_KIND } from '../config.js';
import { simulateRun, toSimObstacles, toSimTriggers, validatePlayability } from '../systems/playability.js';

/**
 * Obstáculos con los que se puede jugar un anillo, de más corto a más largo: los
 * saltos apoyados en el suelo de correr (el normal y sus variantes de acento).
 */
export const RING_HAZARDS = Object.freeze(
    Object.keys(OBSTACLE_KIND)
        .filter((k) => {
            const d = OBSTACLE_KIND[k];
            return d.mode === 'run' && d.action === 'jump' && d.altitude === 0 && d.trigger === undefined
                && (d.surface ?? 'floor') === 'floor' && d.gate !== true;
        })
        .sort((a, b) => (OBSTACLE_KIND[a].w - OBSTACLE_KIND[b].w) || (a < b ? -1 : 1)),
);

/** Kind del aro: el activador de salto del registro. */
export const RING_KIND = Object.keys(OBSTACLE_KIND).find((k) => OBSTACLE_KIND[k].trigger === 'jump') ?? null;

const cache = new Map();

/**
 * Pone a cada anillo su obstáculo (`kind`) y su aro (`ring`), y quita los que no
 * se pueden hacer necesarios y jugables. Las acciones llegan ordenadas; el anillo
 * sigue siempre a su salto.
 *
 * @param {Array<{ t: number, type: string, kind?: string, ring?: string }>} actions
 * @param {{ speed: { speedAt: (t: number) => number }, profile: { toleranceS: number } }} ctx
 * @returns {number} anillos quitados.
 */
export function assignRingKinds(actions, ctx) {
    let removed = 0;
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.type !== 'ring') continue;
        const prev = actions[i - 1];
        const hazard = RING_KIND === null || prev === undefined || prev.type !== 'jump'
            ? null
            : ringHazard(prev.kind, a.t - prev.t, ctx.speed.speedAt(a.t), ctx.profile.toleranceS);
        if (hazard === null) {
            actions.splice(i, 1);
            i--;
            removed++;
            continue;
        }
        a.kind = hazard;
        a.ring = RING_KIND;
        a.accentTarget = null;
    }
    return removed;
}

/**
 * El obstáculo más corto que hace necesario un anillo `gapS` después de un salto
 * sobre `jumpKind`, a `speedPxS`, con `toleranceS`; null si ninguno.
 *
 * @param {string} jumpKind
 * @param {number} gapS
 * @param {number} speedPxS
 * @param {number} toleranceS
 */
export function ringHazard(jumpKind, gapS, speedPxS, toleranceS) {
    const key = `${jumpKind}|${Math.round(gapS * 1000)}|${Math.round(speedPxS)}|${Math.round(toleranceS * 1000)}`;
    if (cache.has(key)) return cache.get(key);
    let found = null;
    for (const hazard of RING_HAZARDS) {
        const events = [
            { t: 5, type: 'obstacle', kind: jumpKind },
            { t: 5 + gapS, type: 'obstacle', kind: hazard },
            { t: 5 + gapS, type: 'obstacle', kind: RING_KIND },
        ];
        const obstacles = toSimObstacles(events);
        const triggers = toSimTriggers(events);
        if (!validatePlayability(obstacles, speedPxS, { toleranceS, triggers }).ok) continue;
        // Sin pulsar en el aro (la pulsación del obstáculo llega mucho después): tiene que chocar.
        const target = obstacles.findIndex((o) => o.kind === hazard && o.t > 5);
        const skipped = simulateRun(obstacles, speedPxS, { triggers, pressOffset: (i) => (i === target ? 5 : 0) });
        if (skipped.ok) continue;
        found = hazard;
        break;
    }
    cache.set(key, found);
    return found;
}
