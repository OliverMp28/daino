// Charter — convierte un análisis musical en un chart jugable (Ola 3).
//
// Segunda mitad de la separación ANÁLISIS / CHARTING (doc 10 §2.1). Función
// pura: mismo análisis + misma seed ⇒ mismo chart, byte a byte. Sin audio, sin
// DOM, sin Pixi. Cuesta milisegundos, así que se puede regenerar siempre que
// cambie la seed o el algoritmo sin volver a analizar.
//
// Qué hace hoy (y qué no)
// -----------------------
// Es el algoritmo del Bloque 5 llevado a la semántica correcta y con sus
// defectos arreglados. NO es todavía el charter musical de la Ola 5 (patrones,
// secciones, curva de dificultad). Cambios respecto al LevelGenerator anterior:
//
//   1. Tiempos de ACCIÓN, no de aparición (ver chartFormat.js). Arregla el
//      desfase de 3-7 s del §1.A del doc 10.
//   2. Ante dos onsets demasiado juntos se queda el MÁS FUERTE, no el primero
//      que llega (que suele ser un pre-transitorio débil).
//   3. La ventana temporal se aplica ANTES del espaciado (defecto D13: los
//      onsets descartados por tempranos consumían hueco y suprimían onsets
//      legítimos justo después).
//   4. Los rellenos de huecos largos caen en BEATS, anclados al último onset
//      real, y nunca a menos del hueco mínimo del siguiente (defecto D17: el
//      relleno se insertaba a `prev + 1.8 s` con 0.1 s de margen y podía dejar
//      dos obstáculos a 0.15 s).
//   5. Los picos de ruido no llegan a ser obstáculos: un onset solo cuenta si
//      alcanza una fracción de la fuerza máxima de su entorno. Mitiga en el
//      charter el defecto D16 del detector (sin suelo de energía absoluto),
//      cuya causa sigue abierta hasta la Ola 5.
//   6. El chart resultante se valida jugándolo con la física real y un jugador
//      de ±40 ms; lo que no se puede superar se elimina.
//
// Por qué los rellenos se anclan localmente y no a una rejilla global: el BPM
// detectado tiene 0.7-1.3 % de error (medido). Sobre una rejilla global eso son
// 1.3-2.4 s de deriva en tres minutos — los obstáculos acabarían entre beats.
// Anclando cada relleno al último golpe real, el error se queda en unos
// milisegundos. La rejilla global robusta llega con el beat tracking del
// analizador de la Ola 4.

import { OBSTACLE_KIND, SPAWN_WINDOW_S, speedFromBpm } from '../config.js';
import { actionLeadS } from '../systems/physics.js';
import { toSimObstacles, validatePlayability, DEFAULT_TOLERANCE_S } from '../systems/playability.js';
import { Seeded } from './Seed.js';
import {
    CHART_FORMAT_VERSION,
    CHARTER_NAME,
    CHARTER_VERSION,
    compactChart,
    seedFromSha256,
} from './chartFormat.js';

/**
 * Reglas del charter. Cambiar cualquiera altera los charts generados: sube
 * `CHARTER_VERSION` en chartFormat.js al hacerlo.
 */
export const CHARTER_RULES = Object.freeze({
    /**
     * Primera acción no antes de este segundo. Da tiempo a que la música
     * arranque y a que el primer obstáculo entre desde el borde de la pantalla
     * en vez de aparecer ya dentro.
     */
    firstActionMinS: 3.0,
    /** Tras el último cruce, la canción termina sin obstáculos (descanso final). */
    tailRestS: 2.0,
    /** Hueco mínimo entre acciones. Medido: 0.70 s es seguro con ±40 ms. */
    minGapS: SPAWN_WINDOW_S.min,
    /** Hueco máximo antes de rellenar. */
    maxGapS: SPAWN_WINDOW_S.max,
    /** Desviación humana que el chart debe tolerar. */
    toleranceS: DEFAULT_TOLERANCE_S,
    /** Techo de eliminaciones por jugabilidad (defensa ante bucles). */
    maxRepairs: 64,
    /**
     * Un onset cuenta si su fuerza es al menos esta fracción del máximo en
     * ±`strengthWindowS`. Medido en click tracks: golpes reales 0.32-0.39,
     * picos de ruido ≤ 0.097 (≤ 25 % del golpe). Local y no global a
     * propósito: un umbral global eliminaría estrofas suaves enteras frente a
     * un estribillo fuerte, y los rellenos de esos tramos derivarían.
     */
    localStrengthRatio: 0.3,
    strengthWindowS: 4,
});

/**
 * @typedef {Object} ChartReport
 * @property {number} onsetsIn     Onsets recibidos del análisis.
 * @property {number} fromOnsets   Eventos que salen de onsets reales.
 * @property {number} fillers      Eventos de relleno en beats.
 * @property {number} repaired     Eventos eliminados por no ser superables.
 */

/**
 * @param {import('./analyze.js').Analysis} analysis
 * @param {{ seed?: number, sha256?: string | null }} [opts]
 *        Si no se da `seed`, se deriva del hash del audio (mismo archivo ⇒
 *        mismo nivel). Sin hash ni seed, una aleatoria.
 * @returns {{ chart: import('./chartFormat.js').Chart, report: ChartReport }}
 */
export function buildChart(analysis, opts = {}) {
    const sha256 = opts.sha256 ?? null;
    const seedInput = opts.seed ?? (sha256 !== null ? seedFromSha256(sha256) : undefined);
    const prng = new Seeded(seedInput);

    const durationSec = analysis.durationSec;
    const speedPxS = speedFromBpm(analysis.bpm);
    const beatPeriodS = analysis.beatPeriodS > 0 ? analysis.beatPeriodS : 60 / analysis.bpm;
    const rules = CHARTER_RULES;

    // Ventana de acción: el último cruce debe dejar el descanso final entero.
    const maxLead = Math.max(...Object.values(OBSTACLE_KIND).map(actionLeadS));
    const tMin = rules.firstActionMinS;
    const tMax = durationSec - rules.tailRestS - maxLead;

    let times = [];
    let fromOnsets = 0;
    let fillers = 0;

    if (tMax > tMin) {
        // (3) Ventana primero, (5) suelo local de fuerza, (2) espaciado.
        const windowed = [];
        for (const [t, strength] of analysis.onsets) {
            if (t >= tMin && t <= tMax) windowed.push({ t, strength });
        }
        const candidates = dropWeakOnsets(windowed, rules.strengthWindowS, rules.localStrengthRatio);
        const accepted = selectStrongestSpaced(candidates, rules.minGapS);
        fromOnsets = accepted.length;

        // (4) Rellenos en beats, anclados localmente.
        const filled = fillGapsOnBeats(accepted, {
            beatPeriodS, minGapS: rules.minGapS, maxGapS: rules.maxGapS, tMin, tMax,
        });
        fillers = filled.length - accepted.length;
        times = filled;
    }

    // Kinds con la seed: una llamada al PRNG por evento en todas las ramas,
    // en orden temporal. Misma seed ⇒ mismos kinds.
    let events = times.map((t) => ({ t: round3(t), type: 'obstacle', kind: pickKind(prng, t) }));

    // (6) Validación jugando el nivel. Elimina lo imposible y reintenta.
    let repaired = 0;
    for (;;) {
        const verdict = validatePlayability(toSimObstacles(events), speedPxS, { toleranceS: rules.toleranceS });
        if (verdict.ok || repaired >= rules.maxRepairs) break;
        const idx = events.findIndex((e) => e.t === verdict.t);
        if (idx < 0) break;
        events.splice(idx, 1);
        repaired++;
    }

    const chart = compactChart({
        formatVersion: CHART_FORMAT_VERSION,
        charter: { name: CHARTER_NAME, version: CHARTER_VERSION },
        seed: prng.seed,
        audio: { sha256, durationSec, sampleRate: analysis.sampleRate },
        music: { bpm: analysis.bpm, bpmConfidence: analysis.bpmConfidence, beatPeriodS },
        world: { speedPxS },
        events,
    });

    return {
        chart,
        report: { onsetsIn: analysis.onsets.length, fromOnsets, fillers, repaired },
    };
}

// --------------------------- Pasos ---------------------------

/**
 * Descarta onsets débiles respecto a su entorno: se queda con los que tienen
 * al menos `ratio` × (fuerza máxima en [t - windowS, t + windowS]).
 *
 * O(n) con una cola monótona de máximos deslizante: cada onset entra y sale
 * de la cola una sola vez. Las entradas deben venir ordenadas por `t`.
 *
 * @param {Array<{ t: number, strength: number }>} onsets  ordenados por t
 * @param {number} windowS
 * @param {number} ratio
 * @returns {Array<{ t: number, strength: number }>}
 */
export function dropWeakOnsets(onsets, windowS, ratio) {
    const n = onsets.length;
    if (n === 0) return [];
    const out = [];
    const deque = [];   // índices con fuerza decreciente
    let right = 0;      // siguiente índice por entrar en la ventana
    let head = 0;       // inicio lógico de la cola (evita shift() O(n))

    for (let i = 0; i < n; i++) {
        const t = onsets[i].t;
        while (right < n && onsets[right].t <= t + windowS) {
            while (deque.length > head && onsets[deque[deque.length - 1]].strength <= onsets[right].strength) {
                deque.pop();
            }
            deque.push(right);
            right++;
        }
        while (head < deque.length && onsets[deque[head]].t < t - windowS) head++;
        const localMax = onsets[deque[head]].strength;
        if (onsets[i].strength > 0 && onsets[i].strength >= ratio * localMax) out.push(onsets[i]);
    }
    return out;
}

/**
 * Selecciona onsets respetando un hueco mínimo, priorizando los más fuertes.
 *
 * Voraz por fuerza descendente: cada onset entra si no tiene un aceptado a
 * menos de `minGapS`. Así un golpe fuerte nunca pierde contra un
 * pre-transitorio débil que casualmente llegó 50 ms antes. Empates por
 * instante más temprano, para que el resultado sea determinista.
 *
 * @param {Array<{ t: number, strength: number }>} candidates
 * @param {number} minGapS
 * @returns {number[]} tiempos aceptados, ordenados
 */
export function selectStrongestSpaced(candidates, minGapS) {
    const byStrength = [...candidates].sort((a, b) => (b.strength - a.strength) || (a.t - b.t));
    const accepted = [];   // ordenado por t
    for (const { t } of byStrength) {
        const i = lowerBound(accepted, t);
        const prevOk = i === 0 || t - accepted[i - 1] >= minGapS - EPS;
        const nextOk = i === accepted.length || accepted[i] - t >= minGapS - EPS;
        if (prevOk && nextOk) accepted.splice(i, 0, t);
    }
    return accepted;
}

/**
 * Rellena huecos mayores que `maxGapS` con eventos en múltiplos de beat,
 * anclados al evento real anterior (o al siguiente, en la intro).
 *
 * @param {number[]} accepted  ordenados
 * @param {{ beatPeriodS: number, minGapS: number, maxGapS: number, tMin: number, tMax: number }} p
 * @returns {number[]} ordenados, con los rellenos intercalados
 */
export function fillGapsOnBeats(accepted, p) {
    // Paso de relleno: el mayor número entero de beats que no supera el hueco
    // máximo, pero nunca por debajo del mínimo (canciones muy rápidas).
    let beats = Math.max(1, Math.floor((p.maxGapS + EPS) / p.beatPeriodS));
    while (beats * p.beatPeriodS < p.minGapS - EPS) beats++;
    const step = beats * p.beatPeriodS;

    if (accepted.length === 0) {
        // Sin un solo golpe utilizable (drone, silencio): rejilla desde el inicio.
        const out = [];
        for (let t = p.tMin; t <= p.tMax + EPS; t += step) out.push(t);
        return out;
    }

    const out = [];

    // Intro: hacia atrás desde el primer golpe real, sin pasar de tMin.
    const first = accepted[0];
    if (first - p.tMin > p.maxGapS) {
        const intro = [];
        for (let t = first - step; t >= p.tMin - EPS; t -= step) intro.push(t);
        out.push(...intro.reverse());
    }

    for (let i = 0; i < accepted.length; i++) {
        const a = accepted[i];
        out.push(a);
        const b = i + 1 < accepted.length ? accepted[i + 1] : null;
        if (b !== null) {
            if (b - a > p.maxGapS) {
                // Nunca a menos del hueco mínimo del siguiente golpe real (D17).
                for (let t = a + step; t <= b - p.minGapS + EPS; t += step) out.push(t);
            }
        } else if (p.tMax - a > p.maxGapS) {
            for (let t = a + step; t <= p.tMax + EPS; t += step) out.push(t);
        }
    }
    return out;
}

/**
 * Elige el kind de un evento con ruleta sobre el REGISTRO OBSTACLE_KIND,
 * filtrando por `availableFromS`. Añadir un kind al registro basta para que
 * entre en rotación.
 *
 * Determinismo: exactamente UNA llamada al PRNG por evento en todas las ramas,
 * y el orden de iteración del registro es el de inserción.
 *
 * @param {Seeded} prng
 * @param {number} t
 * @returns {string}
 */
export function pickKind(prng, t) {
    const r = prng.next();
    const available = Object.entries(OBSTACLE_KIND).filter(([, def]) => t >= (def.availableFromS ?? 0));
    if (available.length === 0) return Object.keys(OBSTACLE_KIND)[0];

    let total = 0;
    for (const [, def] of available) total += def.weight ?? 1;

    let acc = 0;
    for (const [key, def] of available) {
        acc += def.weight ?? 1;
        if (r < acc / total) return key;
    }
    return available[available.length - 1][0];
}

// --------------------------- Utilidades ---------------------------

const EPS = 1e-6;

function lowerBound(sorted, value) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
