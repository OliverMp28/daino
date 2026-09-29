// Plan de efectos — los momentos de la canción que el nivel subraya sin tocar la jugabilidad (Ola 6c).
//
// El chart lleva, además de lo que se juega, eventos `fx` que el runtime convierte
// en luz, color y movimiento (systems/songDirector.js, GameSession, fondo). Solo
// visual: ni el simulador ni la física los leen, así que añadir uno no cambia si un
// nivel se supera. Un cliente que no conoce un efecto lo ignora.
//
// Cada efecto es una entrada del registro FX_PLANNERS: una función pura que, con
// el modelo musical y el arco, devuelve sus eventos. Añadir un efecto = un
// planificador aquí + su entrada en `songDirector.FX_KINDS` (cómo se vive) + lo que
// haga el runtime con su estado.
//
//   drop   (Ola 5) el tramo entra de golpe: destello, golpe de cámara y ola.
//   lift   (Ola 5) sube un nivel hacia el empuje: una ola más suave.
//   build  la subida hacia un drop (los compases que songArc.js marca antes de él):
//          el fondo y el suelo se van tensando hasta el golpe.
//   break  la música se vacía de golpe (un tramo en reposo tras uno con cuerpo): el
//          mundo contiene la respiración, el color se apaga y no hay líneas de
//          velocidad hasta que vuelve.
//   key    la canción cambia de tonalidad (analizador 2): el cielo cambia de color
//          en proporción al salto (una quinta arriba no es lo mismo que un semitono).
//
// Función pura: mismo modelo + mismo arco ⇒ mismos eventos.

/**
 * Reglas de los efectos. Cambian los charts: sube `CHARTER_VERSION`.
 */
export const FX_RULES = Object.freeze({
    /** Un break: tramo de este nivel o menos… */
    breakMaxLevel: 0,
    /** …tras uno de este nivel o más… */
    breakFromLevel: 2,
    /** …que dura al menos esto. */
    breakMinS: 2,
    /** Una modulación solo cuenta pasado esto de la canción (las primeras notas no son un cambio). */
    keyMinT: 8,
});

/**
 * @typedef {Object} FxEvent
 * @property {number} t
 * @property {'fx'} type
 * @property {string} fx
 * @property {number} [level]      drop/lift: nivel del tramo que empieza.
 * @property {number} [until]      build/break: hasta cuándo dura.
 * @property {number} [semitones]  key: cuánto se mueve la tónica.
 */

/** Planificadores, en orden: cada uno devuelve sus eventos. */
export const FX_PLANNERS = Object.freeze({
    /** Drops y lifts: el primer tiempo del tramo (los decide songArc.js). */
    drops({ arc }) {
        const out = [];
        for (const seg of arc.segments) {
            if (seg.index === 0) continue;
            if (seg.drop) out.push({ t: round3(seg.t0), type: 'fx', fx: 'drop', level: seg.level });
            else if (seg.lift) out.push({ t: round3(seg.t0), type: 'fx', fx: 'lift', level: seg.level });
        }
        return out;
    },

    /** La subida a cada drop: desde el primer compás marcado como subida hasta el drop. */
    builds({ model, arc }) {
        const out = [];
        for (const seg of arc.segments) {
            if (!seg.drop || seg.index === 0) continue;
            let first = -1;
            for (let b = seg.bar0 - 1; b >= 0 && arc.bars[b].build > 0; b--) first = b;
            if (first < 0) continue;
            out.push({ t: round3(model.bars[first].t0), type: 'fx', fx: 'build', until: round3(seg.t0) });
        }
        return out;
    },

    /** La música se vacía: un tramo en reposo justo después de uno con cuerpo. */
    breaks({ arc }) {
        const R = FX_RULES;
        const out = [];
        for (let i = 1; i < arc.segments.length; i++) {
            const seg = arc.segments[i];
            const prev = arc.segments[i - 1];
            if (seg.level > R.breakMaxLevel || prev.level < R.breakFromLevel || seg.t1 - seg.t0 < R.breakMinS) continue;
            out.push({ t: round3(seg.t0), type: 'fx', fx: 'break', until: round3(seg.t1) });
        }
        return out;
    },

    /** Cambios de tonalidad del análisis tonal. */
    keys({ model }) {
        const mods = model.tonal?.modulations ?? [];
        return mods
            .filter((m) => m.t >= FX_RULES.keyMinT && m.t < model.durationSec && Number.isInteger(m.semitones) && m.semitones !== 0)
            .map((m) => ({ t: round3(m.t), type: 'fx', fx: 'key', semitones: m.semitones }));
    },
});

/**
 * Todos los eventos `fx` de una canción, en orden.
 *
 * @param {{ model: ReturnType<import('./musicModel.js').buildMusicModel>, arc: ReturnType<import('./songArc.js').buildSongArc> }} p
 * @returns {FxEvent[]}
 */
export function planFx(p) {
    const out = [];
    for (const planner of Object.values(FX_PLANNERS)) out.push(...planner(p));
    return out.sort((a, b) => a.t - b.t);
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
