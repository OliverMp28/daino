// Director de la canción — el estado de la estructura durante la partida (Ola 5).
//
// El charter decide en qué tramo está cada instante (eventos `section`) y qué
// efectos lo subrayan (eventos `fx`, levels/fxPlan.js). Este módulo lo sigue con el
// reloj de la canción y da al runtime lo que necesita cada frame:
//
//   intensity  [0,1] suavizada: sube rápido (un drop se nota YA) y baja
//              despacio (soltar sin apagón). La consumen el fondo, las
//              partículas y el suelo.
//   level      nivel del tramo actual (0 reposo … 4 clímax).
//   climax     si el tramo actual es el clímax.
//   fired      efectos de momento que tocan en este frame (drops y lifts).
//   build      [0,1] (Ola 6c) cuánto va de la subida hacia el próximo drop.
//   calm       [0,1] (Ola 6c) cuánto contiene el mundo la respiración en un break.
//   hue        (Ola 6c) giro del color del cielo, en vueltas, por los cambios de
//              tonalidad de la canción (suavizado).
//
// Cómo se vive cada efecto lo dice FX_KINDS: un efecto nuevo del charter es una
// entrada aquí (y lo que el runtime haga con su valor). Un `fx` que no está en el
// registro se ignora.
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
 * Registro de efectos: cómo se vive cada `fx` del chart.
 *   moment  se dispara una vez en su instante (`fired`): drop, lift.
 *   span    dura de `t` a `until` y da un valor [0,1] (`build`, `calm`):
 *           `ramp` 'rise' crece a lo largo del tramo (una subida); 'hold' entra y
 *           sale con fundidos de `inS` y `outS`.
 *   shift   cambia algo de forma permanente desde su instante (`hue`).
 */
export const FX_KINDS = Object.freeze({
    drop: Object.freeze({ kind: 'moment' }),
    lift: Object.freeze({ kind: 'moment' }),
    build: Object.freeze({ kind: 'span', value: 'build', ramp: 'rise' }),
    break: Object.freeze({ kind: 'span', value: 'calm', ramp: 'hold', inS: 0.35, outS: 0.6 }),
    key: Object.freeze({ kind: 'shift', value: 'hue', turnsPerSemitone: 1 / 12, rate: 1.4 }),
});

/**
 * @param {{ events: Array<{ t: number, type: string, level?: number, climax?: boolean, fx?: string, until?: number, semitones?: number }> }} chart
 */
export function createSongDirector(chart) {
    const sections = chart.events.filter((e) => e.type === 'section' && Number.isInteger(e.level) && e.level >= 0 && e.level <= 4);
    const known = chart.events.filter((e) => e.type === 'fx' && typeof e.fx === 'string' && FX_KINDS[e.fx] !== undefined);
    const moments = known.filter((e) => FX_KINDS[e.fx].kind === 'moment');
    const spans = known.filter((e) => FX_KINDS[e.fx].kind === 'span' && Number.isFinite(e.until) && e.until > e.t);
    const shifts = known.filter((e) => FX_KINDS[e.fx].kind === 'shift');
    const structured = sections.length > 0;

    let sectionIdx = -1;
    let momentIdx = 0;
    let intensity = structured ? LEVEL_INTENSITY[sections[0].level] : FLAT_INTENSITY;
    let lastTime = -Infinity;
    let hue = 0;
    const values = { build: 0, calm: 0 };
    /** @type {Array<{ t: number, type: string, fx?: string, level?: number }>} */
    const fired = [];

    const current = () => (sectionIdx >= 0 ? sections[sectionIdx] : null);

    /** Valor [0,1] de un efecto de tramo en `t`. */
    function spanValue(e, t) {
        const def = FX_KINDS[e.fx];
        if (def.ramp === 'rise') return t >= e.t && t < e.until ? (t - e.t) / (e.until - e.t) : 0;
        if (t < e.t || t > e.until + def.outS) return 0;
        const fadeIn = def.inS > 0 ? Math.min(1, (t - e.t) / def.inS) : 1;
        const fadeOut = t <= e.until ? 1 : 1 - (t - e.until) / def.outS;
        return Math.max(0, Math.min(fadeIn, fadeOut));
    }

    return {
        /**
         * Avanza hasta `songTime`. Devuelve los efectos de momento que tocan desde
         * la llamada anterior (el mismo array cada vez: no guardarlo).
         *
         * @param {number} songTime
         * @param {number} dt  Delta de frame (solo para el suavizado).
         */
        update(songTime, dt) {
            fired.length = 0;
            if (songTime < lastTime) return fired;   // el reloj no retrocede
            lastTime = songTime;

            while (sectionIdx + 1 < sections.length && sections[sectionIdx + 1].t <= songTime) sectionIdx++;
            while (momentIdx < moments.length && moments[momentIdx].t <= songTime) fired.push(moments[momentIdx++]);

            const sec = current();
            const target = structured ? LEVEL_INTENSITY[(sec ?? sections[0]).level] : FLAT_INTENSITY;
            const rate = target > intensity ? RISE_RATE : FALL_RATE;
            const k = 1 - Math.exp(-Math.max(0, dt) * rate);
            intensity += (target - intensity) * k;

            values.build = 0;
            values.calm = 0;
            for (const e of spans) {
                const v = spanValue(e, songTime);
                const key = FX_KINDS[e.fx].value;
                if (v > values[key]) values[key] = v;
            }

            let hueTarget = 0;
            for (const e of shifts) {
                if (e.t > songTime) break;
                hueTarget += (e.semitones ?? 0) * FX_KINDS[e.fx].turnsPerSemitone;
            }
            hue += (hueTarget - hue) * (1 - Math.exp(-Math.max(0, dt) * FX_KINDS.key.rate));
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
        /** [0,1] subida hacia el próximo drop. */
        get build() {
            return values.build;
        },
        /** [0,1] el mundo en pausa de un break. */
        get calm() {
            return values.calm;
        },
        /** Giro del color del cielo en vueltas (suavizado). */
        get hue() {
            return hue;
        },
    };
}
