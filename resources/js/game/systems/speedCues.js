// Señales de velocidad durante la partida (afinado de velocidad, Sep 2026).
//
// El charter decide CUÁNDO acelera el mundo (world.speedChanges: marchas hacia
// el clímax, siempre en la pulsación anterior a un primer tiempo). Este módulo
// lo convierte en lo que el jugador ve venir y en lo que nota al llegar:
//
//   ups        los acelerones del nivel, con el primer tiempo que los motiva
//              (el mapa de la barra de progreso los marca).
//   gearAt     marchas encendidas en el HUD: cuánto más rápido va el mundo que
//              al empezar, en escalones fáciles de leer de reojo.
//   aheadAt    [0,1] cercanía del próximo acelerón en los compases previos:
//              el HUD avisa y el pulso del suelo se dobla (una subida).
//   linesAt    [0,1] intensidad de las líneas de velocidad.
//   update     acelerones que ocurren en este frame (ráfaga y marcha nueva).
//
// Sin Pixi y sin DOM: mismo chart y mismos instantes ⇒ mismas señales, así que
// se prueba en Node. Funciona con cualquier chart con `speedChanges`, también
// los de charters anteriores (sus portales caían en el primer tiempo).

import { speedProfileOf } from './speedProfile.js';

export const SPEED_CUES = Object.freeze({
    /** Un cambio cuenta como acelerón si sube al menos esta fracción. */
    minRise: 0.03,
    /**
     * Marchas del HUD: velocidad relativa a la de arranque a partir de la que se
     * enciende cada una. Ola 6a: la progresión llega a ×1.3 en Relajado y a ×1.8
     * en Extremo; la cuarta marcha es cosa de las dificultades altas.
     */
    gearThresholds: Object.freeze([1.08, 1.24, 1.42, 1.62]),
    /** El aviso empieza tantos beats antes del acelerón (dos compases de 4/4)… */
    warnBeats: 8,
    /** …y nunca menos de estos segundos. */
    warnMinS: 2,
    /** Líneas de velocidad: ninguna por debajo de esta velocidad relativa… */
    linesFromRatio: 1.04,
    /** …y todas a partir de esta. */
    linesFullRatio: 1.7,
    /** Un primer tiempo más lejos que esto del acelerón no es el suyo (en beats). */
    downbeatSearchBeats: 1.25,
});

/**
 * @typedef {Object} SpeedUp
 * @property {number} t      Instante del acelerón.
 * @property {number} at     Primer tiempo que lo motiva (el del tramo o frase nuevos).
 * @property {number} from   px/s antes.
 * @property {number} to     px/s después.
 * @property {number} gear   Marchas encendidas tras él.
 */

/**
 * @param {{ world: { speedPxS: number, speedChanges?: Array<{ t: number, speedPxS: number }> },
 *           music: { beatPeriodS?: number, downbeats?: number[] } }} chart
 * @param {import('./speedProfile.js').SpeedProfile} [profile]
 */
export function createSpeedCues(chart, profile = speedProfileOf(chart)) {
    const base = profile.base;
    const beat = chart.music.beatPeriodS > 0 ? chart.music.beatPeriodS : 0.5;
    const downbeats = chart.music.downbeats ?? [];
    const warnS = Math.max(SPEED_CUES.warnMinS, SPEED_CUES.warnBeats * beat);

    const gearOf = (speed) => {
        const ratio = speed / base;
        let gear = 0;
        for (const threshold of SPEED_CUES.gearThresholds) if (ratio >= threshold - 1e-9) gear++;
        return gear;
    };

    /** @type {SpeedUp[]} */
    const ups = [];
    for (const c of chart.world.speedChanges ?? []) {
        const from = profile.speedAt(c.t - 1e-6);
        if (!(c.speedPxS > from * (1 + SPEED_CUES.minRise))) continue;
        ups.push({ t: c.t, at: downbeatAfter(downbeats, c.t, SPEED_CUES.downbeatSearchBeats * beat) ?? c.t, from, to: c.speedPxS, gear: gearOf(c.speedPxS) });
    }

    let cursor = 0;
    let lastTime = -Infinity;
    /** @type {SpeedUp[]} */
    const fired = [];
    /** Resultado de `aheadAt`, reutilizado: se consulta cada frame. */
    const ahead = { ahead: 0, next: /** @type {SpeedUp | null} */ (null) };

    /** Índice del primer acelerón con t > songTime. */
    const nextIndex = (songTime) => {
        let lo = 0;
        let hi = ups.length;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (ups[m].t <= songTime) lo = m + 1;
            else hi = m;
        }
        return lo;
    };

    return {
        /** Acelerones del nivel, en orden. */
        ups,
        /** Segundos de aviso antes de cada acelerón. */
        warnS,

        /**
         * Avanza hasta `songTime` y devuelve los acelerones que tocan desde la
         * llamada anterior (el mismo array cada vez: no guardarlo). El reloj no
         * retrocede; un salto largo los dispara todos de golpe, sin repetir.
         *
         * @param {number} songTime
         */
        update(songTime) {
            fired.length = 0;
            if (songTime < lastTime) return fired;
            lastTime = songTime;
            while (cursor < ups.length && ups[cursor].t <= songTime) fired.push(ups[cursor++]);
            return fired;
        },

        /** Marchas encendidas (0…4) en un instante. */
        gearAt(songTime) {
            return gearOf(profile.speedAt(songTime));
        },

        /**
         * Aviso del próximo acelerón: 0 fuera de su ventana, sube hasta 1 justo
         * al llegar. `next` es ese acelerón (o null). Devuelve el mismo objeto
         * cada vez (se consulta cada frame): leerlo, no guardarlo.
         *
         * @param {number} songTime
         * @returns {{ ahead: number, next: SpeedUp | null }}
         */
        aheadAt(songTime) {
            const next = ups[nextIndex(songTime)] ?? null;
            const left = next === null ? Infinity : next.t - songTime;
            ahead.next = next;
            ahead.ahead = left >= warnS ? 0 : 1 - left / warnS;
            return ahead;
        },

        /** Intensidad [0,1] de las líneas de velocidad en un instante. */
        linesAt(songTime) {
            const ratio = profile.speedAt(songTime) / base;
            const k = (ratio - SPEED_CUES.linesFromRatio) / (SPEED_CUES.linesFullRatio - SPEED_CUES.linesFromRatio);
            return k <= 0 ? 0 : k >= 1 ? 1 : k;
        },
    };
}

/** Primer downbeat en [t, t + window], o null. */
function downbeatAfter(downbeats, t, window) {
    let lo = 0;
    let hi = downbeats.length;
    while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (downbeats[m] < t - 1e-6) lo = m + 1;
        else hi = m;
    }
    const d = downbeats[lo];
    return d !== undefined && d - t <= window ? d : null;
}
