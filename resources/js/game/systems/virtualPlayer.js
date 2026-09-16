// Jugador virtual — qué pulsa alguien que juega el chart sobre los golpes (Ola 6).
//
// Una sola definición de "jugar bien" para el simulador del charter
// (playability.js), las pruebas del bucle de frame y el bot de los E2E: ante cada
// obstáculo pulsa en su instante de acción (desplazado lo que diga
// `pressOffset`), según la acción de su kind:
//
//   jump   pulsa saltar (salto completo: no suelta antes de tiempo).
//   duck   mantiene ↓ desde el golpe hasta que el ptero pasó del todo; si el
//          siguiente también se pasa agachado y llega antes, no suelta entre medias.
//   flip   pulsa (cualquier botón invierte la gravedad).
//   hold   (vuelo, Ola 6b) mantiene desde que empieza la nota hasta que acaba.
//
// Los cambios de modo NO son pulsaciones: los aplica quien simula, en su instante.

/**
 * Margen tras el cruce en el que sigue agachado, en px más allá de medio
 * obstáculo: suelta cuando el ptero ya ha pasado del todo.
 */
export const DUCK_HOLD_MARGIN_PX = 60;

/**
 * @typedef {Object} ScriptedInput
 * @property {number} at      Instante de canción.
 * @property {string} input   Entrada cruda: 'jump', 'duckStart', 'duckEnd'.
 * @property {number} index   Obstáculo al que responde.
 */

/**
 * @param {Array<{ t: number, cross: number, def: { action: string, w: number } }>} obstacles
 *        Ordenados por `t` (toSimObstacles).
 * @param {{ speedAt: (t: number) => number }} profile
 * @param {(index: number) => number} [pressOffset]  Desplazamiento de la pulsación del
 *        obstáculo i en segundos (negativo = pronto). Por defecto 0. Las notas
 *        mantenidas siguen a los obstáculos: la nota k tiene sus dos extremos en
 *        los índices `n + 2k` (empezar) y `n + 2k + 1` (soltar), así los patrones
 *        del validador la acortan y la alargan.
 * @param {Array<{ t: number, until: number }>} [holds]  Notas mantenidas, en orden.
 * @returns {ScriptedInput[]}  Ordenado por `at` (estable).
 */
export function virtualPlayerScript(obstacles, profile, pressOffset = () => 0, holds = []) {
    const presses = obstacles.map((o, index) => {
        const at = o.t + pressOffset(index);
        return o.def.action === 'duck'
            ? { at, input: 'duckStart', index, releaseAt: o.cross + (o.def.w / 2 + DUCK_HOLD_MARGIN_PX) / profile.speedAt(o.cross) }
            : { at, input: 'jump', index, releaseAt: -1 };
    });
    presses.sort((a, b) => a.at - b.at);

    const script = [];
    let nextDuckAt = Infinity;
    for (let i = presses.length - 1; i >= 0; i--) {
        const p = presses[i];
        script.push({ at: p.at, input: p.input, index: p.index });
        if (p.input !== 'duckStart') continue;
        // Solo suelta si nadie vuelve a agacharse antes: entonces manda ese.
        if (nextDuckAt >= p.releaseAt) script.push({ at: p.releaseAt, input: 'duckEnd', index: p.index });
        nextDuckAt = p.at;
    }
    script.reverse();
    const n = obstacles.length;
    holds.forEach((h, k) => {
        const start = h.t + pressOffset(n + 2 * k);
        // Soltar nunca antes de empezar, aunque los desplazamientos se crucen.
        const end = Math.max(start + 0.01, h.until + pressOffset(n + 2 * k + 1));
        script.push({ at: start, input: 'jump', index: n + 2 * k });
        script.push({ at: end, input: 'jumpEnd', index: n + 2 * k + 1 });
    });
    // Estable: a igual instante, pulsar antes que soltar (como llegan del jugador).
    return script
        .map((s, order) => ({ s, order }))
        .sort((a, b) => (a.s.at - b.s.at) || (a.order - b.order))
        .map(({ s }) => s);
}
