// Reloj de paso fijo para la física (Ola 3).
//
// Convierte un reloj que avanza a saltos irregulares (un frame de 7 ms, otro
// de 160 ms) en una secuencia de pasos de tamaño FIJO. Quien lo usa integra la
// física una vez por paso, así el resultado es idéntico a 30, 60 o 144 fps y
// no se desincroniza del reloj de la canción aunque haya tirones.
//
// Referencia del patrón: Glenn Fiedler, "Fix Your Timestep!".

/**
 * @param {{ stepS: number, maxCatchUpS: number }} cfg
 */
export function createFixedStepper(cfg) {
    const { stepS, maxCatchUpS } = cfg;
    let simT = null;

    return {
        /** Instante hasta el que se ha simulado, o null si aún no arrancó. */
        get time() {
            return simT;
        },

        /** Fija el reloj de simulación (p. ej. al arrancar la partida). */
        reset(t) {
            simT = t;
        },

        /**
         * Ejecuta `step(t)` para cada paso fijo hasta alcanzar `targetT`.
         * El resto menor que un paso se conserva para el siguiente frame.
         *
         * @param {number} targetT
         * @param {(t: number) => boolean | void} step  Devuelve true para
         *        detenerse (p. ej. al detectar una colisión).
         * @returns {boolean} true si algún paso pidió detenerse.
         */
        advance(targetT, step) {
            if (simT === null) simT = targetT;
            if (targetT - simT > maxCatchUpS) simT = targetT - maxCatchUpS;
            // Epsilon para que 1/120 acumulado no pierda un paso por redondeo.
            while (simT + stepS <= targetT + 1e-9) {
                simT += stepS;
                if (step(simT) === true) return true;
            }
            return false;
        },
    };
}
