// Reloj continuo a partir de uno que avanza a escalones (Oct 2026).
//
// `AudioContext.currentTime` es el reloj de la canción, pero el hilo principal no
// lo ve avanzar de forma continua: sube a escalones, cada vez que el sistema pide
// otro bloque de audio. Medido en Chrome (Windows, 60 FPS): escalones de 9 a 20 ms
// y un retraso medio de 7 ms (hasta 13) entre lo que marca y lo que de verdad ha
// sonado; en móviles los bloques son mayores. Leído tal cual, un fotograma avanza
// la canción 9 ms y el siguiente 20: los obstáculos, que se colocan desde ese
// reloj, tiemblan frente al suelo, y una pulsación se fecha con ese mismo error.
//
// Este reloj da el instante continuo: el reloj de alta resolución
// (`performance.now`) más un desfase. El desfase verdadero es el del reloj a
// escalones JUSTO al saltar (entre saltos se va quedando atrás), así que se estima
// con la envolvente superior de las muestras recientes, y se corrige despacio:
// el resultado es monótono y sin saltos.
//
// Pieza pura (sin audio ni DOM): quien la usa le da los dos relojes en cada lectura.

/**
 * @param {object} [opts]
 * @param {number} [opts.windowS=0.6]     Ventana de la envolvente: muestras más
 *        viejas no cuentan (si el audio se quedó atrás por un corte, el reloj lo
 *        sigue pasado este tiempo).
 * @param {number} [opts.slewRate=0.05]   Velocidad máxima de corrección, como
 *        fracción del tiempo transcurrido: el reloj avanza siempre entre el 95 % y
 *        el 105 % del ritmo real.
 * @param {number} [opts.resyncS=0.25]    Desfase a partir del cual no se corrige
 *        despacio sino de golpe (una pausa, un cambio de dispositivo).
 * @param {number} [opts.maxAheadS=0.12]  Nunca más de esto por delante del reloj a
 *        escalones: si el audio se detiene sin avisar, el reloj se detiene con él.
 */
export function createSteadyClock(opts = {}) {
    const windowS = opts.windowS ?? 0.6;
    const slewRate = opts.slewRate ?? 0.05;
    const resyncS = opts.resyncS ?? 0.25;
    const maxAheadS = opts.maxAheadS ?? 0.12;

    /** Muestras recientes del desfase, en cola monótona decreciente (su cabeza es el máximo). */
    const queue = [];
    let offset = null;       // desfase aplicado
    let lastWallS = 0;
    let lastOut = -Infinity;

    function reset() {
        queue.length = 0;
        offset = null;
    }

    return {
        /**
         * Instante continuo del reloj a escalones.
         *
         * @param {number} wallS   Reloj de alta resolución, en segundos (`performance.now() / 1000`).
         * @param {number} stepS   Reloj a escalones en ese mismo instante (`ctx.currentTime`).
         * @returns {number}       Nunca menor que la lectura anterior.
         */
        read(wallS, stepS) {
            const sample = stepS - wallS;
            while (queue.length > 0 && queue[queue.length - 1].off <= sample) queue.pop();
            queue.push({ at: wallS, off: sample });
            while (queue[0].at < wallS - windowS) queue.shift();
            const target = queue[0].off;

            if (offset === null || Math.abs(target - offset) > resyncS) {
                // Primera lectura, o los relojes se separaron de golpe: se re-ancla
                // en la muestra de ahora (lo de antes ya no dice nada).
                queue.length = 0;
                queue.push({ at: wallS, off: sample });
                offset = sample;
            } else {
                const maxStep = Math.max(0, wallS - lastWallS) * slewRate;
                offset += Math.max(-maxStep, Math.min(maxStep, target - offset));
            }
            lastWallS = wallS;

            const t = Math.min(wallS + offset, stepS + maxAheadS);
            if (t > lastOut) lastOut = t;
            return lastOut;
        },

        /** Última lectura (el reloj parado, p. ej. con el audio en pausa). */
        get last() {
            return lastOut;
        },

        /** Olvida lo aprendido: la siguiente lectura re-ancla. No retrocede. */
        reset,

        /** Empieza de cero, también el suelo de monotonía (otra canción). */
        restart() {
            reset();
            lastOut = -Infinity;
        },
    };
}
