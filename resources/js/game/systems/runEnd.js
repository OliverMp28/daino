// Dónde termina de JUGARSE un nivel.
//
// Un nivel dura lo que hay que jugar, no lo que dura el archivo de audio. Tras
// cruzar el último obstáculo ya no queda nada que hacer: si la canción sigue (un
// final que se apaga, segundos de silencio al cierre del MP3), ese rato es tiempo
// muerto ("¿ya lo superé? ¿cuánto falta?"). Medido en los oficiales: Dawn of
// Faith tenía 14.5 s entre el último cactus y el final del audio, 12 de ellos en
// silencio; Time, 10.6 s; los demás, 4-5 s.
//
// El nivel se da por superado un momento después del último cruce: lo justo para
// aterrizar y ver la celebración. La música no se corta: sigue sonando bajo el
// panel de resultados hasta su final, y el cielo sigue hasta su siguiente hito.
//
// Puro: lo usan la partida (victoria, barra y porcentaje) y los tests.

import { OBSTACLE_KIND } from '../config.js';
import { actionLeadS } from './physics.js';
import { createFlightCourse } from './flightCourse.js';
import { speedProfileOf } from './speedProfile.js';

export const RUN_END = Object.freeze({
    /** Segundos entre que el último obstáculo queda atrás y el panel de resultados. */
    afterClearS: 1.6,
    /** Si a la canción le queda esto o menos, se la deja terminar: no merece cortar. */
    keepTailS: 1.2,
    /** Lo que sobresale el Dino por detrás de su centro: el obstáculo "queda atrás" al pasarlo. */
    behindPx: 40,
});

/**
 * Instante de canción en el que el nivel se da por superado.
 *
 * @param {{ events: Array<{ t: number, type: string, kind?: string }>, world: { speedPxS: number, speedChanges?: object[] } }} chart
 * @param {number} durationSec  Duración del audio.
 * @param {typeof RUN_END} [rules]
 * @returns {number}  Nunca más allá del final del audio; con un chart sin nada que jugar, el final del audio.
 */
export function playEndSec(chart, durationSec, rules = RUN_END) {
    const speed = speedProfileOf(chart);
    let clear = -Infinity;
    for (const e of chart.events) {
        if (e.type !== 'obstacle') continue;
        const def = OBSTACLE_KIND[e.kind];
        if (def === undefined) continue;
        const cross = e.t + actionLeadS(def);
        clear = Math.max(clear, cross + (def.w / 2 + rules.behindPx) / speed.speedAt(cross));
    }
    const course = createFlightCourse(chart.events);
    if (!course.empty) clear = Math.max(clear, course.lastEnd);
    if (!Number.isFinite(clear)) return durationSec;
    const end = clear + rules.afterClearS;
    return durationSec - end <= rules.keepTailS ? durationSec : end;
}
