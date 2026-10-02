// Precisión del jugador en una partida: cuánto se adelanta o se retrasa al pulsar.
//
// La dificultad se calibra con un jugador de referencia que pulsa con un error
// de ±30 ms (levels/challenge.js). Cuánto se supera un nivel depende muchísimo de
// ese número (con ±25 ms un Extremo se pasa una de cada dos veces; con ±35, una de
// cada cien), así que conviene poder MEDIRLO en quien juega en vez de suponerlo.
//
// Cada salto o inversión se empareja con la acción de su tipo más cercana del
// chart y se anota la diferencia. Los agachados no cuentan (agacharse antes es
// gratis y lo normal es adelantarse mucho) ni las notas del vuelo (se corrigen
// mirando el túnel). Puro: sin Pixi ni audio.

/** Una pulsación a más de esto de cualquier acción no era para ninguna. */
const MATCH_WINDOW_S = 0.2;

/**
 * @param {Array<{ t: number, action: string }>} targets  Acciones del chart, ordenadas por instante.
 */
export function createTimingLog(targets) {
    const list = targets.filter((x) => x.action === 'jump' || x.action === 'flip');
    const used = new Uint8Array(list.length);
    let cursor = 0;
    let n = 0;
    let sum = 0;
    let sumSq = 0;

    return {
        /**
         * @param {number} at  Instante de canción de la pulsación de salto.
         */
        record(at) {
            while (cursor < list.length && list[cursor].t < at - MATCH_WINDOW_S) cursor++;
            let best = -1;
            for (let i = cursor; i < list.length && list[i].t <= at + MATCH_WINDOW_S; i++) {
                if (used[i] === 1) continue;
                if (best < 0 || Math.abs(list[i].t - at) < Math.abs(list[best].t - at)) best = i;
            }
            if (best < 0) return;
            used[best] = 1;
            const d = at - list[best].t;
            n++;
            sum += d;
            sumSq += d * d;
        },

        /**
         * @returns {{ presses: number, biasMs: number, sigmaMs: number } | null}
         *          `biasMs`: adelanto (negativo) o retraso medio; `sigmaMs`: dispersión
         *          alrededor de esa media. null con menos de 8 pulsaciones emparejadas.
         */
        summary() {
            if (n < 8) return null;
            const mean = sum / n;
            const variance = Math.max(0, sumSq / n - mean * mean);
            return { presses: n, biasMs: Math.round(mean * 1000), sigmaMs: Math.round(Math.sqrt(variance) * 1000) };
        },
    };
}
