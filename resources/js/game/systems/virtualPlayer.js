// Jugador virtual — qué pulsa alguien que juega el chart sobre los golpes (Ola 6).
//
// Una sola definición de "jugar bien" para el simulador del charter
// (playability.js), las pruebas del bucle de frame y el bot de los E2E: ante cada
// obstáculo pulsa en su instante de acción (desplazado lo que diga
// `pressOffset`), según la acción de su kind:
//
//   jump   pulsa saltar. Si el Dino va por el aire dentro de un anillo (Ola 6c),
//          la física lo convierte en un segundo salto: el jugador no hace nada distinto.
//   duck   mantiene ↓ desde el golpe hasta que el ptero pasó del todo; si el
//          siguiente también se pasa agachado y llega antes, no suelta entre medias.
//          Con `tapS`, en cambio, da un toque: pulsa y suelta enseguida, como quien
//          juega en un móvil. El nivel tiene que superarse igual (una pulsación,
//          un gesto): lo comprueban los tests con los oficiales.
//   flip   pulsa (cualquier botón invierte la gravedad).
//   hold   (vuelo, Ola 6b) mantiene desde que empieza la nota hasta que acaba.
//
// Los cambios de modo NO son pulsaciones: los aplica quien simula, en su instante.
//
// El vuelo se juega MIRANDO (Ola 6c). La altura del Dino es la suma de todo lo
// mantenido: quien pulsa cada nota a ciegas acumula el error de nota en nota y
// acaba chocando (medido en la 6b: a la tercera nota con ±55 ms). Una persona no
// vuela así: ve el túnel y, si va alta, empieza la nota siguiente un poco más
// tarde; si va baja, la suelta un poco después. `FLIGHT_PLAYER` modela esa
// corrección: en cada esquina del camino pulsa (o suelta) donde su recta de
// subida o bajada se juntaría con la del camino, corrigiendo solo una parte del
// desvío y dentro de un límite de tiempo, y encima comete el error de la pauta
// (`pressOffset`). Con eso las notas pueden encadenarse sin volver al suelo.

import { FLY_MODE } from '../config.js';
import { MAX_ALT, altAt } from './flightCourse.js';

/**
 * Margen tras el cruce en el que sigue agachado, en px más allá de medio
 * obstáculo: suelta cuando el ptero ya ha pasado del todo.
 */
export const DUCK_HOLD_MARGIN_PX = 60;

/**
 * Cómo vuela quien mira el túnel.
 *
 *   correctionGain   Fracción del desvío de altura que corrige en cada esquina del
 *                    camino. Medido con frases encadenadas aleatorias (90-150 BPM,
 *                    silencios de medio beat): con 1 bastaría la holgura de la 6b;
 *                    con 0.5 hacían falta 25-40 unidades más; con 0.7, unas 10.
 *                    Se toma 0.7: corrige, pero no como un bot.
 *   maxCorrectionS   Nunca adelanta ni retrasa una pulsación más que esto para
 *                    corregir (un desvío mayor no se arregla en una sola nota).
 *   minGapS          Lo mínimo entre soltar y volver a pulsar, y entre pulsar y soltar.
 */
export const FLIGHT_PLAYER = Object.freeze({
    correctionGain: 0.7,
    maxCorrectionS: 0.25,
    minGapS: 0.04,
});

/**
 * @typedef {Object} ScriptedInput
 * @property {number} at      Instante de canción.
 * @property {string} input   Entrada cruda: 'jump', 'jumpEnd', 'duckStart', 'duckEnd'.
 * @property {number} index   Obstáculo al que responde.
 */

/**
 * @param {Array<{ t: number, cross: number, def: { action: string, w: number } }>} obstacles
 *        Ordenados por `t` (toSimObstacles).
 * @param {{ speedAt: (t: number) => number }} profile
 * @param {(index: number) => number} [pressOffset]  Desplazamiento de la pulsación del
 *        obstáculo i en segundos (negativo = pronto). Por defecto 0. Las notas
 *        mantenidas siguen a los obstáculos: la nota k tiene sus dos extremos en
 *        los índices `n + 2k` (empezar) y `n + 2k + 1` (soltar), así los patrones
 *        del validador la acortan y la alargan.
 * @param {Array<{ t: number, until: number }>} [holds]  Notas mantenidas, en orden.
 * @param {{ course?: { spans: Array<{ tIn: number, tOut: number, points: Array<{ t: number, alt: number }> }> } | null,
 *           player?: typeof FLIGHT_PLAYER | null, tapS?: number | null | ((index: number) => number | null) }} [flight]
 *        Con `course` (el túnel del nivel), las notas se vuelan mirándolo con
 *        `player` (FLIGHT_PLAYER por defecto; null = a ciegas). Sin él, a ciegas.
 *        `tapS`: saltar y agacharse son toques de esa duración (por defecto se
 *        mantiene el agachado hasta que pasa el obstáculo y el salto se suelta en
 *        el acto: el arco base). Una función da el gesto de cada obstáculo: así
 *        juega quien mantiene solo los saltos que le conviene (challenge.js).
 * @returns {ScriptedInput[]}  Ordenado por `at` (estable).
 */
export function virtualPlayerScript(obstacles, profile, pressOffset = () => 0, holds = [], flight = {}) {
    const tapOf = typeof flight.tapS === 'function' ? flight.tapS : () => flight.tapS ?? null;
    const presses = obstacles.map((o, index) => {
        const at = o.t + pressOffset(index);
        const tapS = tapOf(index) ?? null;
        // Sin `tapS` suelta en el mismo instante: el arco base, con el que se valida todo.
        if (o.def.action !== 'duck') return { at, input: 'jump', index, releaseAt: tapS === null ? at : at + tapS };
        return { at, input: 'duckStart', index, releaseAt: tapS === null ? o.cross + (o.def.w / 2 + DUCK_HOLD_MARGIN_PX) / profile.speedAt(o.cross) : at + tapS };
    });
    presses.sort((a, b) => a.at - b.at);

    const script = [];
    let nextDuckAt = Infinity;
    for (let i = presses.length - 1; i >= 0; i--) {
        const p = presses[i];
        if (p.input !== 'duckStart') {
            // La lista se construye al revés: soltar va antes para quedar detrás de pulsar.
            if (p.releaseAt >= 0) script.push({ at: p.releaseAt, input: 'jumpEnd', index: p.index });
            script.push({ at: p.at, input: p.input, index: p.index });
            continue;
        }
        script.push({ at: p.at, input: p.input, index: p.index });
        // Solo suelta si nadie vuelve a agacharse antes: entonces manda ese.
        if (nextDuckAt >= p.releaseAt) script.push({ at: p.releaseAt, input: 'duckEnd', index: p.index });
        nextDuckAt = p.at;
    }
    script.reverse();

    const n = obstacles.length;
    const course = flight.course ?? null;
    const player = flight.player === undefined ? FLIGHT_PLAYER : flight.player;
    const flown = flownHolds(holds, course, (j) => pressOffset(n + j), player);
    flown.forEach((h, k) => {
        script.push({ at: h.t, input: 'jump', index: n + 2 * k });
        script.push({ at: h.until, input: 'jumpEnd', index: n + 2 * k + 1 });
    });
    // Estable: a igual instante, pulsar antes que soltar (como llegan del jugador).
    return script
        .map((s, order) => ({ s, order }))
        .sort((a, b) => (a.s.at - b.s.at) || (a.order - b.order))
        .map(({ s }) => s);
}

/**
 * Cuándo empieza y suelta cada nota quien vuela un recorrido (flightCourse.js).
 * `holds` son las notas que toca, en orden (normalmente las del túnel; menos, para
 * probar qué pasa si se salta alguna). `offset(j)` es el error de la transición j
 * (2k empezar la nota k, 2k + 1 soltarla).
 *
 * Con `player`, cada transición se hace donde la recta del Dino se junta con la
 * recta del camino tras su esquina (la altura del Dino es lineal a trozos: sube o
 * baja a velocidad fija, entre el suelo y el techo), corrigiendo `correctionGain`
 * del desvío y como mucho `maxCorrectionS`; después se suma el error. Sin
 * `player`, cada transición cae en su esquina más el error: el error de altura se
 * arrastra de nota en nota.
 *
 * @param {Array<{ t: number, until: number }>} holds
 * @param {{ spans: Array<{ tIn: number, tOut: number, points: Array<{ t: number, alt: number }> }> } | null} course
 * @param {(j: number) => number} offset
 * @param {typeof FLIGHT_PLAYER | null} player
 * @returns {Array<{ t: number, until: number }>}
 */
export function flownHolds(holds, course, offset, player) {
    const up = FLY_MODE.climbPxS;
    const down = FLY_MODE.divePxS;
    const out = [];
    const spans = course?.spans ?? [];
    let span = null;
    let tp = 0;
    let ap = 0;
    for (let k = 0; k < holds.length; k++) {
        const h = holds[k];
        const next = holds[k + 1];
        const own = spans.find((s) => h.t >= s.tIn && h.t < s.tOut) ?? null;
        if (own !== span) {
            // El Dino entra en cada tramo por el suelo (la boca del túnel le da tiempo a bajar).
            span = own;
            tp = own?.tIn ?? h.t;
            ap = 0;
        }
        const aim = player !== null && span !== null;
        const minGap = player?.minGapS ?? 0.01;
        const nextInSpan = next !== undefined && span !== null && next.t < span.tOut ? next.t : (span?.tOut ?? Infinity);

        // Empezar: el Dino baja desde (tp, ap); el camino sube desde su esquina.
        let s = h.t;
        if (aim) {
            const c = h.t;
            const B = altAt(span.points, c);
            const meet = (ap + down * tp - B + up * c) / (up + down);
            const root = meet <= tp + ap / down ? meet : c - B / up;
            s = corrected(c, root, player, tp + minGap, h.until - minGap);
        }
        s = Math.max(tp + 0.01, s + offset(2 * k));
        ap = Math.max(0, ap - down * (s - tp));
        tp = s;

        // Soltar: el Dino sube desde (tp, ap); el camino baja desde su esquina.
        let u = h.until;
        if (aim) {
            const c = h.until;
            const B = altAt(span.points, c);
            const meet = (B + down * c - ap + up * tp) / (up + down);
            const root = meet <= tp + (MAX_ALT - ap) / up ? meet : c - (MAX_ALT - B) / down;
            u = corrected(c, root, player, tp + minGap, nextInSpan - minGap);
        }
        u = Math.max(s + 0.01, u + offset(2 * k + 1));
        ap = Math.min(MAX_ALT, ap + up * (u - tp));
        tp = u;
        out.push({ t: s, until: u });
    }
    return out;
}

/** Transición corregida hacia `root` desde la esquina `c`, con la ganancia y los límites del jugador. */
function corrected(c, root, player, lo, hi) {
    const shift = Math.max(-player.maxCorrectionS, Math.min(player.maxCorrectionS, player.correctionGain * (root - c)));
    const t = c + shift;
    return hi > lo ? Math.min(hi, Math.max(lo, t)) : c;
}
