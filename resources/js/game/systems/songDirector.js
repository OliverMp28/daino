// Director de la canción — el estado de la estructura durante la partida (Ola 5).
//
// El charter decide en qué tramo está cada instante (eventos `section`) y dónde
// hay un momento (`fx: 'drop'` o `'lift'`). Este módulo lo sigue con el reloj de la canción y
// da al runtime lo que necesita cada frame:
//
//   intensity  [0,1] suavizada: sube rápido (un drop se nota YA) y baja
//              despacio (soltar sin apagón). La consumen el fondo, las
//              partículas y el suelo.
//   level      nivel del tramo actual (0 reposo … 4 clímax).
//   climax     si el tramo actual es el clímax.
//   progress   fracción de canción: el sol se pone con ella.
//   fired      efectos que tocan en este frame (drops y lifts).
//
// Sin Pixi, sin audio: el mismo chart y los mismos instantes dan siempre los
// mismos estados, así que se prueba en Node.

/** Intensidad visual de cada nivel del arco. */
export const LEVEL_INTENSITY = Object.freeze([0.12, 0.32, 0.52, 0.76, 1]);

/** Intensidad de un chart sin estructura (formato 1). */
const FLAT_INTENSITY = 0.5;

/** Velocidad de convergencia al subir y al bajar (1/s). */
const RISE_RATE = 7;
const FALL_RATE = 1.2;

/**
 * @param {{ events: Array<{ t: number, type: string, level?: number, climax?: boolean, fx?: string }> }} chart
 * @param {number} durationSec
 */
export function createSongDirector(chart, durationSec) {
    const sections = chart.events.filter((e) => e.type === 'section' && Number.isInteger(e.level) && e.level >= 0 && e.level <= 4);
    const effects = chart.events.filter((e) => e.type === 'fx' && typeof e.fx === 'string');
    const structured = sections.length > 0;

    let sectionIdx = -1;
    let effectIdx = 0;
    let intensity = structured ? LEVEL_INTENSITY[sections[0].level] : FLAT_INTENSITY;
    let lastTime = -Infinity;
    /** @type {Array<{ t: number, type: string, fx?: string, level?: number }>} */
    const fired = [];

    const current = () => (sectionIdx >= 0 ? sections[sectionIdx] : null);

    return {
        /**
         * Avanza hasta `songTime`. Devuelve los efectos que tocan desde la llamada
         * anterior (el mismo array cada vez: no guardarlo).
         *
         * @param {number} songTime
         * @param {number} dt  Delta de frame (solo para el suavizado).
         */
        update(songTime, dt) {
            fired.length = 0;
            if (songTime < lastTime) return fired;   // el reloj no retrocede
            lastTime = songTime;

            while (sectionIdx + 1 < sections.length && sections[sectionIdx + 1].t <= songTime) sectionIdx++;
            while (effectIdx < effects.length && effects[effectIdx].t <= songTime) fired.push(effects[effectIdx++]);

            const sec = current();
            const target = structured ? LEVEL_INTENSITY[(sec ?? sections[0]).level] : FLAT_INTENSITY;
            const rate = target > intensity ? RISE_RATE : FALL_RATE;
            intensity += (target - intensity) * (1 - Math.exp(-Math.max(0, dt) * rate));
            return fired;
        },

        get intensity() {
            return intensity;
        },
        get level() {
            return current()?.level ?? (structured ? sections[0].level : 2);
        },
        get climax() {
            return current()?.climax === true;
        },
        /** @param {number} songTime */
        progress(songTime) {
            return durationSec > 0 ? Math.min(1, Math.max(0, songTime / durationSec)) : 0;
        },
    };
}
