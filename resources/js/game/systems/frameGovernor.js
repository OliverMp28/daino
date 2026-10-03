// La calidad automática (T05.2): mide los fotogramas de la partida y decide el
// nivel de calidad y el ritmo.
//
// Lo que había antes (Ola 1) no reaccionaba. Contaba +1 por cada fotograma de más
// de 24 ms y −1 por cada uno más corto, y bajaba al llegar a 90: un equipo a
// 25 FPS con fotogramas alternos (16, 33, 100 ms…) se quedaba en "Alta" para
// siempre (medido: 15 s sin moverse), y uno a 45 FPS a trompicones, también. Y
// cuando bajaba no arreglaba nada: Media y Baja no abarataban el cielo, que es lo
// que cuesta (RenderProfile.js).
//
// Cómo mide ahora
// ---------------
// Un fotograma es TARDÍO si su intervalo pasa de 1,5 veces el previsto (el de la
// pantalla por el ritmo actual: vale igual a 60, 90, 120 o 144 Hz). En ventanas de
// 2 s se mira qué fracción lo fue: con un 12 % dos ventanas seguidas, o un 30 % en
// una, baja un escalón. Un tirón suelto no mueve nada. No se mide el arranque del
// nivel, ni justo después de un cambio, ni un hueco de pestaña oculta.
//
// Qué baja, y en qué orden
// ------------------------
// Lo decidió el user: primero el detalle del cielo, y los fotogramas, lo último.
//   1. En una pantalla rápida (≥ 100 Hz), la mitad del ritmo: 60 parejos se ven
//      mejor que 120 a trompicones, y no se pierde nada de dibujo.
//   2. El cielo a menos texeles (Alta → Media → Baja).
//   3. `STEADY_FPS` estables.
// Si lo que falta es PROCESADOR (el JS del fotograma se come más de la mitad del
// intervalo), bajar el cielo no sirve de nada: se salta directo al ritmo.
//
// Volver a subir
// --------------
// Nunca en mitad de una partida (oscilar se ve peor que quedarse abajo). Al
// empezar un intento, si el anterior fue limpio, prueba a deshacer el último paso;
// si vuelve a fallar, ya no lo intenta más en la sesión. Lo aprendido se guarda
// (`memory()`): la próxima visita no repite los segundos de tirones.
//
// Pura, sin Pixi ni DOM: se prueba en Node con trenes de fotogramas sintéticos.

import { TIER_ORDER } from '../RenderProfile.js';

export const GOVERNOR_RULES = Object.freeze({
    /** Ventana de medida, en segundos de fotogramas pintados. */
    windowS: 2,
    /** Tardío: más de estas veces el intervalo previsto. */
    lateFactor: 1.5,
    /** Fracción de tardíos que, dos ventanas seguidas, hace bajar. */
    lateRatio: 0.12,
    /** …y la que lo hace con una sola. */
    hardRatio: 0.30,
    /** Tras un cambio de escalón no se mide durante este tiempo (lo nuevo se asienta). */
    settleS: 1.5,
    /** Arranque de un intento: fundido, primeras texturas. */
    startS: 2,
    /** Un hueco así es una pausa o una pestaña oculta: no cuenta y la ventana empieza de nuevo. */
    gapMs: 250,
    /** Falta procesador: el JS del fotograma pasa de esta parte del intervalo previsto… */
    cpuShare: 0.55,
    /** …en al menos esta fracción de los fotogramas de la ventana. */
    cpuFrames: 0.5,
    /** Desde aquí una pantalla admite ir a la mitad. */
    fastHz: 100,
    /** Intento limpio (para probar a subir): casi sin tardíos y con duración suficiente. */
    cleanRatio: 0.02,
    cleanMinS: 20,
    /** Nivel de salida en una pantalla táctil: los móviles tienen más píxeles y menos gráfica. */
    coarseTier: 'medium',
});

/**
 * @typedef {{ tier: string, pace: 'native'|'half'|'steady' }} QualityState
 * @typedef {QualityState & { why: 'gpu'|'cpu'|'retry'|'manual'|'screen' }} QualityChange
 *          `why`: falta gráfica · falta procesador · subida de prueba al empezar un
 *          intento · elección de AJUSTES · se midió (o cambió) la pantalla.
 */

const sameState = (a, b) => a.tier === b.tier && a.pace === b.pace;

function validState(s) {
    return s !== null && typeof s === 'object' && TIER_ORDER.includes(s.tier) && ['native', 'half', 'steady'].includes(s.pace);
}

/**
 * @param {object} [opts]
 * @param {typeof GOVERNOR_RULES} [opts.rules]
 * @param {number} [opts.refreshHz]  Fotogramas por segundo de la pantalla (systems/framePacer.js).
 * @param {boolean} [opts.coarse]    Pantalla táctil (`pointer: coarse`).
 * @param {{ state: QualityState, history: QualityState[] } | null} [opts.remembered]
 *        Lo que dejó la visita anterior (`memory()`).
 */
export function createFrameGovernor(opts = {}) {
    const rules = opts.rules ?? GOVERNOR_RULES;
    const coarse = opts.coarse === true;
    let fast = (opts.refreshHz ?? 60) >= rules.fastHz;

    /** Donde empieza un equipo del que no se sabe nada. */
    function startState() {
        return coarse
            ? { tier: rules.coarseTier, pace: fast ? 'half' : 'native' }
            : { tier: TIER_ORDER[0], pace: 'native' };
    }

    /** @type {QualityState} */
    let state = startState();
    /** Los estados de los que se ha ido bajando: subir es volver al último. @type {QualityState[]} */
    let history = [];
    /** Sin nada medido ni recordado, el estado sigue a `startState()` si cambia la pantalla. */
    let pristine = true;

    const mem = opts.remembered;
    if (mem && validState(mem.state) && Array.isArray(mem.history) && mem.history.every(validState)) {
        state = { tier: mem.state.tier, pace: mem.state.pace };
        history = mem.history.map((s) => ({ tier: s.tier, pace: s.pace }));
        pristine = false;
    }

    /** Elección manual (AJUSTES): un nivel fijo, a los fotogramas de la pantalla. */
    let locked = null;
    /** Ya falló una subida de prueba en esta sesión. */
    let noClimb = false;
    /** El intento en curso empezó (o sigue) con una subida de prueba sin confirmar. */
    let trial = false;
    /** ¿Fue limpio el intento anterior? `null`: aún no ha habido ninguno. */
    let lastClean = null;

    let holdS = 0;
    let winS = 0;
    let winFrames = 0;
    let winLate = 0;
    let winCpu = 0;
    let prevBad = false;

    const run = { frames: 0, late: 0, seconds: 0, cpuMs: 0, worstMs: 0, downs: 0 };
    const live = { lateRatio: 0, cpuMs: 0 };

    function resetWindow() {
        winS = 0;
        winFrames = 0;
        winLate = 0;
        winCpu = 0;
    }

    function resetRun() {
        run.frames = 0;
        run.late = 0;
        run.seconds = 0;
        run.cpuMs = 0;
        run.worstMs = 0;
        run.downs = 0;
    }

    /** El paso siguiente hacia abajo, o null si ya no hay. */
    function nextDown(cpuBound) {
        const t = TIER_ORDER.indexOf(state.tier);
        if (fast && state.pace === 'native') return { tier: state.tier, pace: 'half' };
        if (cpuBound) {
            if (state.pace !== 'steady') return { tier: state.tier, pace: 'steady' };
            // Ya va al ritmo estable y sigue sin llegar: quizá era también la gráfica.
            return t < TIER_ORDER.length - 1 ? { tier: TIER_ORDER[t + 1], pace: 'steady' } : null;
        }
        if (t < TIER_ORDER.length - 1) return { tier: TIER_ORDER[t + 1], pace: state.pace };
        if (state.pace !== 'steady') return { tier: state.tier, pace: 'steady' };
        return null;
    }

    /** @returns {QualityChange | null} */
    function stepDown(cpuBound) {
        const next = nextDown(cpuBound);
        if (next === null) return null;
        history.push(state);
        state = next;
        pristine = false;
        holdS = rules.settleS;
        prevBad = false;
        resetWindow();
        run.downs++;
        if (trial) {
            // La subida de prueba no aguantó: en esta sesión no se vuelve a intentar.
            trial = false;
            noClimb = true;
        }
        return { ...state, why: cpuBound ? 'cpu' : 'gpu' };
    }

    return {
        /** Nivel y ritmo vigentes. */
        get state() { return locked ?? state; },
        get locked() { return locked !== null; },

        /**
         * Un fotograma pintado de la partida.
         *
         * @param {number} dtMs     Lo que tardó en llegar desde el anterior.
         * @param {number} cpuMs    Lo que costó su JS (lógica + órdenes de dibujo).
         * @param {number} frameMs  El intervalo previsto (pantalla × ritmo).
         * @returns {QualityChange | null}  Si hay que cambiar de calidad.
         */
        sample(dtMs, cpuMs, frameMs) {
            if (!(dtMs > 0) || dtMs > rules.gapMs) {
                resetWindow();
                prevBad = false;
                return null;
            }
            const dtS = dtMs / 1000;
            if (holdS > 0) {
                holdS -= dtS;
                return null;
            }
            const late = dtMs > rules.lateFactor * frameMs;
            run.frames++;
            run.seconds += dtS;
            run.cpuMs += cpuMs;
            if (late) run.late++;
            if (dtMs > run.worstMs) run.worstMs = dtMs;

            winFrames++;
            winS += dtS;
            if (late) winLate++;
            if (cpuMs > rules.cpuShare * frameMs) winCpu++;
            if (winS < rules.windowS) return null;

            const ratio = winLate / winFrames;
            const cpuBound = winCpu / winFrames >= rules.cpuFrames;
            live.lateRatio = ratio;
            live.cpuMs = run.frames > 0 ? run.cpuMs / run.frames : 0;
            const bad = ratio >= rules.lateRatio;
            const decide = ratio >= rules.hardRatio || (bad && prevBad);
            prevBad = bad;
            resetWindow();
            if (!decide || locked !== null) return null;
            return stepDown(cpuBound);
        },

        /**
         * Empezar de cero: olvida lo aprendido y vuelve al nivel de salida. Es lo que
         * pide quien elige "Auto" en AJUSTES (quizá aquel día el equipo iba cargado).
         *
         * @returns {QualityChange}
         */
        reset() {
            locked = null;
            state = startState();
            history = [];
            pristine = true;
            noClimb = false;
            trial = false;
            lastClean = null;
            prevBad = false;
            resetWindow();
            holdS = Math.max(holdS, rules.settleS);
            return { ...state, why: 'manual' };
        },

        /** No medir durante `seconds` (cambio de estado, de tamaño de ventana…). */
        hold(seconds = rules.settleS) {
            holdS = Math.max(holdS, seconds);
            resetWindow();
            prevBad = false;
        },

        /** La pantalla, cuando se mide (o cambia). */
        setRefresh(hz) {
            const next = hz >= rules.fastHz;
            if (next === fast) return null;
            fast = next;
            if (pristine) {
                state = startState();
                return locked === null ? { ...state, why: 'screen' } : null;
            }
            if (!fast && state.pace === 'half') {
                // A 60 Hz "la mitad" serían 30: eso es el ritmo estable, y hay que ganárselo.
                state = { tier: state.tier, pace: 'native' };
                history = history.filter((s) => s.pace !== 'half');
                return locked === null ? { ...state, why: 'screen' } : null;
            }
            return null;
        },

        /**
         * Elección manual de AJUSTES: un nivel fijo (`null` = automática). Fija, no
         * se mide para cambiarla: si alguien pide Alta, bajársela sería ignorarle.
         *
         * @param {string | null} tier
         * @returns {QualityChange}
         */
        lock(tier) {
            locked = TIER_ORDER.includes(tier) ? { tier, pace: 'native' } : null;
            resetWindow();
            prevBad = false;
            holdS = Math.max(holdS, rules.settleS);
            return { ...(locked ?? state), why: 'manual' };
        },

        /**
         * Empieza un intento (nivel nuevo o reintento). Es el único momento en que
         * la calidad puede SUBIR: bajo el fundido, nunca a mitad de partida.
         *
         * @returns {QualityChange | null}
         */
        attemptStart() {
            resetRun();
            resetWindow();
            prevBad = false;
            holdS = rules.startS;
            if (locked !== null || noClimb || trial || history.length === 0 || lastClean !== true) return null;
            state = history.pop();
            trial = true;
            return { ...state, why: 'retry' };
        },

        /** Termina el intento: ¿fue limpio? (lo mira el siguiente `attemptStart`). */
        attemptEnd() {
            // Demasiado corto para saber nada: ni confirma una prueba ni permite otra.
            if (run.seconds < rules.cleanMinS) return;
            const clean = run.downs === 0 && run.late / Math.max(1, run.frames) <= rules.cleanRatio;
            lastClean = clean;
            if (clean) trial = false;
        },

        /** Resumen del intento en curso (panel de resultados, lectura `?perf=1`). */
        stats() {
            return {
                frames: run.frames,
                seconds: run.seconds,
                fps: run.seconds > 0 ? run.frames / run.seconds : 0,
                lateRatio: run.frames > 0 ? run.late / run.frames : 0,
                cpuMs: run.frames > 0 ? run.cpuMs / run.frames : 0,
                worstMs: run.worstMs,
                downs: run.downs,
            };
        },

        /** Lo último medido (una ventana). */
        get live() { return live; },

        /** Lo que conviene recordar para la próxima visita. */
        memory() {
            return { state: { ...state }, history: history.map((s) => ({ ...s })) };
        },

        /** ¿Hay algo aprendido que guardar? (un equipo que nunca bajó no deja rastro). */
        get learned() { return !pristine; },
    };
}

export { sameState };
