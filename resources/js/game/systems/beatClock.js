// Reloj de beat para el pulso visual (uBpmPulse del shader, obstáculos, suelo).
//
// Ola 3: la fase se re-anclaba en cada evento del chart, que ya estaba sobre un
// golpe real. Antes el pulso se calculaba como `songTime % periodo`, con la
// fase anclada al segundo 0 (casi nunca un beat) y cada vez más desfasada.
//
// Ola 5: con charts de formato 2 las anclas son los BEATS REALES de la canción
// (`chart.music.beats`), así que el mundo late con la música también donde no
// hay obstáculos: en la intro, en un puente vacío, en la outro. Y los primeros
// tiempos de compás (`music.downbeats`) marcan un acento: el pulso del "uno"
// pesa más que el del resto, que es como se oye un compás.
//
// Entre dos anclas el pulso sigue el periodo; en la siguiente se corrige solo.
// Nunca acumula más error que el de unos pocos beats.

/**
 * @param {number[]} anchorTimes   Instantes de golpe conocidos, ordenados.
 * @param {number} periodS         Periodo de beat en segundos.
 * @param {number[]} [accentTimes] Subconjunto de anclas con acento (primeros tiempos).
 */
export function createBeatClock(anchorTimes, periodS, accentTimes = []) {
    const period = periodS > 0 ? periodS : 0.5;
    const accents = new Set(accentTimes);
    let idx = 0;

    function seek(songTime) {
        if (idx > 0 && anchorTimes[idx] > songTime) idx = 0;
        while (idx + 1 < anchorTimes.length && anchorTimes[idx + 1] <= songTime) idx++;
    }

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
            seek(songTime);
            // Antes del primer ancla se ancla a él hacia atrás, para que el
            // pulso ya vaya en fase durante la intro.
            const anchor = anchorTimes[idx];
            // Pasado el último ancla, o en un hueco sin pulso más largo que un
            // beat, se sigue el periodo desde el último ancla conocido.
            return mod(songTime - anchor, period) / period;
        },

        /**
         * ¿El beat en curso es un primer tiempo de compás? Solo es exacto en el
         * beat del ancla (entre anclas lejanas no se sabe qué beat suena).
         * @param {number} songTime
         */
        isAccentAt(songTime) {
            if (anchorTimes.length === 0 || accents.size === 0) return false;
            seek(songTime);
            const anchor = anchorTimes[idx];
            return songTime >= anchor && songTime - anchor < period && accents.has(anchor);
        },
    };
}

/** Módulo matemático (siempre en [0, m)), a diferencia de `%` con negativos. */
function mod(x, m) {
    return ((x % m) + m) % m;
}
