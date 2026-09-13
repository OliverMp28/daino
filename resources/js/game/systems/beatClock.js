// Reloj de beat para el pulso visual del shader (uBpmPulse) — Ola 3.
//
// Antes el pulso se calculaba como `songTime % periodo`, con la fase anclada
// al segundo 0 de la canción. Pero el segundo 0 casi nunca cae en un beat
// (silencio inicial, anacrusa), así que el sol latía con el tempo correcto y
// la fase equivocada: siempre a destiempo, y cada vez más por el error del BPM.
//
// Ahora la fase se re-ancla en cada evento del chart, que ya está sobre un
// golpe real. Entre dos eventos el pulso sigue el periodo detectado; en el
// siguiente evento se corrige solo. Así nunca acumula más error que el de
// unos pocos beats, y el sol late exactamente cuando el jugador tiene que
// actuar.

/**
 * @param {number[]} anchorTimes  Instantes de golpe conocidos (eventos del chart), ordenados.
 * @param {number} periodS        Periodo de beat en segundos.
 */
export function createBeatClock(anchorTimes, periodS) {
    const period = periodS > 0 ? periodS : 0.5;
    let idx = 0;

    return {
        /**
         * Fase del beat en [0, 1): 0 justo en el golpe.
         * Pensado para llamarse con tiempos crecientes (cada frame): el cursor
         * solo avanza, O(1) amortizado. Un tiempo menor que el anterior sigue
         * dando un resultado correcto, solo que sin aprovechar el cursor.
         *
         * @param {number} songTime
         */
        phaseAt(songTime) {
            if (anchorTimes.length === 0) return mod(songTime, period) / period;

            if (idx > 0 && anchorTimes[idx] > songTime) idx = 0;
            while (idx + 1 < anchorTimes.length && anchorTimes[idx + 1] <= songTime) idx++;

            // Antes del primer evento se ancla a él hacia atrás, para que el
            // pulso ya vaya en fase durante la intro.
            const anchor = anchorTimes[idx];
            return mod(songTime - anchor, period) / period;
        },
    };
}

/** Módulo matemático (siempre en [0, m)), a diferencia de `%` con negativos. */
function mod(x, m) {
    return ((x % m) + m) % m;
}
