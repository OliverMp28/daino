// Márgenes de una acción aislada, sin simular la partida.
//
// Una pulsación desde el reposo mueve al cuerpo siempre igual: el salto es el
// mismo arco, la inversión de la gravedad el mismo viaje. Esa trayectoria (el
// "rastro": dónde está su caja y qué figura tiene tras cada paso de la física) se
// integra una vez, y el margen de cualquier obstáculo sale de pasarla por delante
// de él: para cada adelanto o retraso de la pulsación, ¿algún paso lo toca?
//
// Es la colisión de la partida (geometry.obstacleHit: piezas, figura, hueco del
// lomo) y su mismo paso, pero sin el resto del simulador: guion, modos, ventanas
// de obstáculos. El charter lo pide miles de veces al elegir acentos; simular cada
// uno costaba cientos de milisegundos por chart.
//
// Lo que mide es el margen MEDIO sobre la rejilla de la física: la pulsación cae
// en cualquier punto entre dos pasos, así que cada paso se comprueba medio paso
// después. Un barrido del simulador con una rejilla fija se queda con la peor
// fase y da hasta medio paso menos por cada lado (tests/js/challenge.test.mjs).

import { PHYSICS_STEP_S } from '../config.js';
import { DINO_CENTER_X, obstacleHit } from './geometry.js';

/**
 * @typedef {Object} BodyTrack
 * @property {{ box: { x: number, y: number, w: number, h: number }, figure: number }} rest
 *           El cuerpo antes de pulsar.
 * @property {Array<{ box: { x: number, y: number, w: number, h: number }, figure: number }>} steps
 *           El cuerpo tras cada paso de la física desde la pulsación; el último se
 *           mantiene (aterrizó, o llegó a la otra superficie).
 */

/** Hasta dónde se busca el margen por cada lado y con qué finura. */
const SCAN = Object.freeze({ maxS: 0.5, coarseS: 0.04, fineS: 0.002 });

/**
 * @param {object} def        Entrada de OBSTACLE_KIND.
 * @param {number} topY       Y de la esquina superior del obstáculo (physics.obstacleTopY con el suelo del rastro).
 * @param {number} speedPxS
 * @param {number} leadS      Su adelanto: el centro cruza al Dino esto después del golpe.
 * @param {BodyTrack} track
 * @returns {{ early: number, late: number }}  0 y 0 si ni la pulsación exacta lo supera.
 */
export function trackMarginsS(def, topY, speedPxS, leadS, track) {
    const dt = PHYSICS_STEP_S;
    const scratch = { x: 0, y: 0, w: 0, h: 0 };
    // Pasos en los que la caja del obstáculo puede solapar a la del cuerpo (que no se mueve en horizontal).
    let left = track.rest.box.x;
    let right = track.rest.box.x + track.rest.box.w;
    for (const s of track.steps) {
        left = Math.min(left, s.box.x);
        right = Math.max(right, s.box.x + s.box.w);
    }
    const aheadMax = right - DINO_CENTER_X + def.w / 2;
    const aheadMin = left - DINO_CENTER_X - def.w / 2;
    const last = track.steps.length - 1;

    const collides = (delta) => {
        // El paso k se comprueba (k + ½)·dt después de pulsar; el obstáculo está entonces
        // (leadS − delta − (k + ½)·dt)·v por delante de su cruce.
        const kFrom = Math.ceil((leadS - delta - aheadMax / speedPxS) / dt - 0.5);
        const kTo = Math.floor((leadS - delta - aheadMin / speedPxS) / dt - 0.5);
        for (let k = kFrom; k <= kTo; k++) {
            const state = k < 0 ? track.rest : track.steps[k > last ? last : k];
            const x = DINO_CENTER_X + (leadS - delta - (k + 0.5) * dt) * speedPxS - def.w / 2;
            if (obstacleHit(state.figure, state.box, def, x, topY, scratch)) return true;
        }
        return false;
    };
    if (collides(0)) return { early: 0, late: 0 };

    const side = (sign) => {
        let ok = 0;
        let fail = SCAN.maxS;
        for (let off = SCAN.coarseS; off <= SCAN.maxS + 1e-9; off += SCAN.coarseS) {
            if (collides(sign * off)) {
                fail = off;
                break;
            }
            ok = off;
        }
        if (ok >= SCAN.maxS - 1e-9) return SCAN.maxS;
        while (fail - ok > SCAN.fineS) {
            const mid = (ok + fail) / 2;
            if (collides(sign * mid)) fail = mid;
            else ok = mid;
        }
        return (ok + fail) / 2;
    };
    return { early: side(-1), late: side(1) };
}
