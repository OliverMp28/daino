// El ritmo de los fotogramas (T05.2): cuáles de los que ofrece la pantalla se pintan.
//
// Antes el tope de fotogramas era `ticker.maxFPS` de Pixi, que compara tiempos
// truncados a milisegundos: en una pantalla que no es múltiplo del tope los
// fotogramas salen DESIGUALES (medido con su misma lógica: a 144 Hz con tope 60,
// intervalos de 13,9 y 20,8 ms alternos; a 90 Hz, de 11 y 22). Un fotograma
// desigual se ve como un tirón aunque la media sea buena.
//
// Aquí el ritmo se cuenta en fotogramas de la pantalla: se pinta uno de cada k,
// siempre parejos. 60 Hz con objetivo 30 → uno de cada 2; 120 Hz a la mitad → 60;
// 144 Hz con objetivo 30 → uno de cada 5 (28,8).
//
// "Uno de cada k" se decide por TIEMPO, no contando rAF: se pinta el primer rAF
// que llega a medio intervalo de pantalla del vencimiento. Con la pantalla a su
// ritmo es lo mismo; pero a un equipo que no llega los rAF le llegan a menos de
// los de la pantalla, y contando se pintaría uno de cada k de ESOS: pedir 30
// estables a un equipo que entrega 25 rAF por segundo lo dejaba en 12 (medido).
//
// Para eso hay que saber cada cuánto ofrece un fotograma la pantalla, y no hay
// una API que lo diga: se mide con los propios rAF. Solo se aprende en los estados
// "de confianza" (el menú, los resultados: se pinta poco y a un ritmo bajo, así
// que casi todos los rAF llegan a su hora). En plena partida un equipo que no
// llega entrega los rAF tarde y la medida diría "pantalla de 30 Hz": con eso, la
// calidad automática daría por bueno ir a 30.
//
// Pura, sin Pixi ni DOM: se prueba en Node con trenes de rAF sintéticos.

import { STEADY_FPS } from '../RenderProfile.js';

export const PACE_RULES = Object.freeze({
    /** Hasta que se mide, se supone la pantalla más común. */
    defaultHz: 60,
    /** rAF recientes con los que se estima el intervalo (su mediana). */
    window: 48,
    /** Un cambio menor que esto no mueve la estimación (ruido). */
    tolerance: 0.03,
    /** Un hueco así no es de la pantalla: pestaña oculta, depurador, el render parado. */
    ignoreMs: 250,
    /** Frecuencias de pantalla conocidas: la medida se ajusta a la más cercana si cae a menos del 4 %. */
    knownHz: Object.freeze([24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]),
    snap: 0.04,
    /** Lo que se acepta como pantalla. */
    minHz: 20,
    maxHz: 400,
});

/**
 * De cada cuántos fotogramas de la pantalla se pinta uno.
 *
 * @param {number} refreshHz  Fotogramas por segundo de la pantalla.
 * @param {number} maxFPS     Tope del estado (RenderProfile); 0 = sin tope.
 * @param {'native'|'half'|'steady'} [pace]  Ritmo que pide la calidad.
 * @returns {number} entero ≥ 1
 */
export function divisorFor(refreshHz, maxFPS, pace = 'native') {
    let k = maxFPS > 0 ? Math.max(1, Math.round(refreshHz / maxFPS)) : 1;
    if (pace === 'half') k = Math.max(k, 2);
    else if (pace === 'steady') k = Math.max(k, Math.round(refreshHz / STEADY_FPS), 1);
    return k;
}

/**
 * @param {typeof PACE_RULES} [rules]
 */
export function createFramePacer(rules = PACE_RULES) {
    const samples = new Float64Array(rules.window);
    const sorted = new Float64Array(rules.window);
    let count = 0;
    let head = 0;
    let last = NaN;
    let refreshMs = 1000 / rules.defaultHz;
    let measured = false;
    let divisor = 1;
    /** Tiempo del último rAF pintado (NaN: el siguiente pinta). */
    let painted = NaN;

    function snapMs(ms) {
        const hz = 1000 / ms;
        let best = hz;
        let bestErr = rules.snap;
        for (const k of rules.knownHz) {
            const err = Math.abs(hz - k) / k;
            if (err < bestErr) {
                bestErr = err;
                best = k;
            }
        }
        return 1000 / best;
    }

    function learn() {
        if (count < rules.window) return;
        sorted.set(samples);
        sorted.sort();
        const median = sorted[rules.window >> 1];
        const hz = 1000 / median;
        if (!(hz >= rules.minHz && hz <= rules.maxHz)) return;
        const next = snapMs(median);
        if (!measured || Math.abs(next - refreshMs) / refreshMs > rules.tolerance) {
            refreshMs = next;
            measured = true;
        }
    }

    return {
        /**
         * Un rAF de la pantalla. Devuelve si toca pintar este fotograma.
         *
         * @param {number} now       El tiempo del rAF (ms).
         * @param {boolean} trusted  Estado en el que los rAF llegan a su hora (ver arriba).
         */
        tick(now, trusted = false) {
            const delta = now - last;
            last = now;
            if (trusted && delta > 0 && delta < rules.ignoreMs) {
                samples[head] = delta;
                head = (head + 1) % rules.window;
                if (count < rules.window) count++;
                // Una vez por vuelta del anillo basta (ordenar 48 números).
                if (head === 0) learn();
            } else if (!trusted) {
                // Lo que se midió en otro estado no se mezcla con el siguiente.
                count = 0;
                head = 0;
            }
            // Toca pintar si desde el último pintado ha pasado el intervalo previsto
            // (con medio fotograma de pantalla de margen: los rAF tienen ruido).
            if (divisor > 1 && now - painted < refreshMs * (divisor - 0.5)) return false;
            painted = now;
            return true;
        },

        /** De cada cuántos fotogramas de la pantalla se pinta uno. El siguiente rAF pinta. */
        setDivisor(k) {
            const next = Math.max(1, Math.round(k));
            if (next === divisor) return;
            divisor = next;
            painted = NaN;
        },

        /** Tras parar el render (carga, pestaña oculta): el primer rAF no cuenta como intervalo. */
        skip() {
            last = NaN;
            painted = NaN;
        },

        get divisor() { return divisor; },
        /** Intervalo de la pantalla (ms). */
        get refreshMs() { return refreshMs; },
        get refreshHz() { return 1000 / refreshMs; },
        /** Intervalo previsto entre dos fotogramas pintados (ms). */
        get frameMs() { return refreshMs * divisor; },
        /** ¿Se ha medido ya la pantalla, o es la supuesta? */
        get measured() { return measured; },
    };
}
