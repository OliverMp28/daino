// Cola de pulsaciones fechadas en tiempo de canción (Ola 3).
//
// La física avanza a paso fijo (fixedStep.js). Si las pulsaciones se aplicaran
// en el momento en que el hilo principal las LEE, un frame largo las
// desplazaría: tras un tirón de 250 ms, una tecla pulsada justo en el beat se
// aplicaría al principio de los pasos de recuperación, cientos de ms antes de
// cuando se pulsó de verdad. Aquí cada pulsación guarda su instante real
// convertido a tiempo de canción, y cada paso de física aplica solo las que le
// corresponden.
//
// Pieza pura, sin DOM ni audio: se prueba en Node.

/**
 * Convierte la marca de tiempo de un evento de entrada a tiempo de canción.
 *
 * `songTimeNow` es lo que el jugador oye en este instante; el evento ocurrió
 * `nowMs - eventTimeStamp` ms antes, así que su instante musical es ese mismo
 * tiempo atrás. Nunca antes de `floorT`: la física ya simulada no se reescribe,
 * así que una pulsación más vieja que el último paso se aplica en el siguiente.
 *
 * @param {number} songTimeNow     Tiempo de canción oído ahora (segundos).
 * @param {number} eventTimeStamp  `Event.timeStamp` (ms, reloj de performance.now).
 * @param {number} nowMs           `performance.now()` en el momento de procesar.
 * @param {number} [floorT]        Último instante ya simulado.
 */
export function songTimeOfEvent(songTimeNow, eventTimeStamp, nowMs, floorT = -Infinity) {
    const ageS = Math.max(0, nowMs - eventTimeStamp) / 1000;
    return Math.max(songTimeNow - ageS, floorT);
}

/**
 * @template T
 */
export function createInputTimeline() {
    /** @type {Array<{ action: T, songT: number }>} ordenado por songT */
    const queue = [];

    return {
        /**
         * Encola una acción. Mantiene el orden temporal; a igualdad de instante,
         * el orden de llegada (pulsar y soltar en el mismo frame no se invierten).
         * @param {T} action
         * @param {number} songT
         */
        push(action, songT) {
            let i = queue.length;
            while (i > 0 && queue[i - 1].songT > songT) i--;
            queue.splice(i, 0, { action, songT });
        },

        /**
         * Aplica, en orden, las acciones con instante ≤ `t`.
         * @param {number} t
         * @param {(action: T) => void} apply
         */
        drainUntil(t, apply) {
            let n = 0;
            while (n < queue.length && queue[n].songT <= t) apply(queue[n++].action);
            if (n > 0) queue.splice(0, n);
        },

        clear() {
            queue.length = 0;
        },

        get size() {
            return queue.length;
        },
    };
}
