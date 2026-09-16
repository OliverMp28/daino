// Dificultad de primera clase (Ola 5, doc 10 §2.3, defecto D6).
//
// La dificultad no es un multiplicador aplicado a un chart único. Cambia:
//
//   - CUÁNTO se llena cada nivel del arco (acciones por minuto en reposo,
//     calma, groove, empuje y clímax).
//   - CON QUÉ TOLERANCIA debe poder superarse: un nivel Relajado se supera
//     pulsando con ±80 ms de error; uno Extremo exige ±40 ms. El validador
//     juega el chart con ese margen y elimina lo que no cabe.
//   - QUÉ se juega y DESDE CUÁNDO: agacharse, cactus anchos, contratiempos y
//     combinaciones rápidas salto→agachado se desbloquean en momentos del arco
//     (primer groove, primer empuje, clímax). Más difícil = antes y más.
//   - CUÁNTO acelera el mundo en los tramos intensos.
//   - QUÉ MODOS de movimiento existen y cuántos momentos caben (Ola 6); dónde
//     van lo decide la canción (modePlan.js).
//
// El techo (difficultyCeiling.js) dice hasta dónde admite la MÚSICA: una balada
// no ofrece Extremo porque no hay golpes que lo justifiquen.

import { difficultyCeiling } from './difficultyCeiling.js';

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 5;

/** Nombre de cada dificultad para el jugador (tarjetas, ficha, selector). */
export const DIFFICULTY_NAMES = Object.freeze({
    1: 'Relajado',
    2: 'Fácil',
    3: 'Normal',
    4: 'Difícil',
    5: 'Extremo',
});

/** Etapas del arco en las que se desbloquea una mecánica (ver `charter.js::unlockSchedule`). */
export const STAGE = Object.freeze({ START: 0, FIRST_GROOVE: 1, FIRST_DRIVE: 2, CLIMAX: 3, NEVER: 99 });

/**
 * @typedef {Object} DifficultyProfile
 * @property {number} level
 * @property {number[]} apm         Acciones por minuto por nivel del arco (0 reposo … 4 clímax).
 * @property {number} toleranceS    Error humano con el que el chart debe superarse.
 * @property {number} minGapS       Hueco mínimo entre dos acciones cualesquiera.
 * @property {number} maxRestS      Silencio de juego máximo mientras la música suena.
 * @property {{ duck: number, wide: number, offbeat: number, combo: number }} unlock  Etapa (STAGE).
 * @property {number} speedAmp      Cuánto de la aceleración por intensidad se aplica.
 * @property {number} airShare      Cuota máxima de obstáculos voladores por tramo.
 * @property {Record<string, { climax: boolean }>} modes
 *           Modos de movimiento que existen en esta dificultad y si el clímax
 *           puede ser uno de sus momentos (levels/modePlan.js).
 * @property {number[]} moments
 *           Duración mínima de la canción para 1, 2… momentos de modo. Cada modo
 *           aparece como mucho una vez; el reparto decide cuáles y dónde.
 */

/** @type {Record<number, DifficultyProfile>} */
export const DIFFICULTY_PROFILES = Object.freeze({
    1: Object.freeze({
        level: 1,
        apm: [0, 12, 20, 27, 34],
        toleranceS: 0.08,
        minGapS: 1.15,
        maxRestS: 8,
        unlock: { duck: STAGE.FIRST_DRIVE, wide: STAGE.NEVER, offbeat: STAGE.NEVER, combo: STAGE.NEVER },
        speedAmp: 0.55,
        airShare: 0.25,
        modes: Object.freeze({}),
        moments: Object.freeze([]),
    }),
    2: Object.freeze({
        level: 2,
        apm: [6, 18, 30, 40, 50],
        toleranceS: 0.065,
        minGapS: 0.9,
        maxRestS: 7,
        unlock: { duck: STAGE.FIRST_GROOVE, wide: STAGE.CLIMAX, offbeat: STAGE.CLIMAX, combo: STAGE.NEVER },
        speedAmp: 0.8,
        airShare: 0.34,
        // Fácil: una sola mecánica nueva, la de pulsar (el vuelo pide mantener).
        modes: Object.freeze({ flip: Object.freeze({ climax: false }) }),
        moments: Object.freeze([75]),
    }),
    3: Object.freeze({
        level: 3,
        apm: [8, 24, 40, 54, 68],
        toleranceS: 0.055,
        minGapS: 0,
        maxRestS: 6,
        unlock: { duck: STAGE.FIRST_GROOVE, wide: STAGE.FIRST_DRIVE, offbeat: STAGE.FIRST_DRIVE, combo: STAGE.CLIMAX },
        speedAmp: 1,
        airShare: 0.5,
        // Normal: los dos modos, pero el clímax se corre a toda velocidad.
        modes: Object.freeze({ flip: Object.freeze({ climax: false }), fly: Object.freeze({ climax: false }) }),
        moments: Object.freeze([75, 150]),
    }),
    4: Object.freeze({
        level: 4,
        apm: [10, 30, 50, 68, 86],
        toleranceS: 0.047,
        minGapS: 0,
        maxRestS: 5,
        unlock: { duck: STAGE.START, wide: STAGE.FIRST_GROOVE, offbeat: STAGE.FIRST_GROOVE, combo: STAGE.FIRST_DRIVE },
        speedAmp: 1.2,
        airShare: 0.5,
        modes: Object.freeze({ flip: Object.freeze({ climax: true }), fly: Object.freeze({ climax: true }) }),
        moments: Object.freeze([60, 120]),
    }),
    5: Object.freeze({
        level: 5,
        apm: [14, 36, 60, 82, 104],
        toleranceS: 0.04,
        minGapS: 0,
        maxRestS: 4.5,
        unlock: { duck: STAGE.START, wide: STAGE.FIRST_GROOVE, offbeat: STAGE.FIRST_GROOVE, combo: STAGE.FIRST_GROOVE },
        speedAmp: 1.4,
        airShare: 0.5,
        modes: Object.freeze({ flip: Object.freeze({ climax: true }), fly: Object.freeze({ climax: true }) }),
        moments: Object.freeze([60, 120]),
    }),
});

/** Valor de "Automática". */
export const DIFFICULTY_AUTO = 'auto';

/**
 * Dificultad que se usa con "Automática": Normal, o el techo si la canción no
 * da para tanto. Normal y no el techo: la mayoría de canciones con golpes
 * densos tienen techo 5, y un catálogo de la comunidad lleno de niveles
 * Extremos por defecto espanta a quien empieza. Quien sube la canción puede
 * pedir más, hasta el techo.
 *
 * @param {number | null} ceiling
 */
export function autoDifficulty(ceiling) {
    return ceiling === null ? 3 : Math.max(DIFFICULTY_MIN, Math.min(3, ceiling));
}

/**
 * @param {unknown} requested  'auto', un entero 1..5, o cualquier otra cosa (= auto).
 * @returns {'auto' | number}
 */
export function normalizeRequestedDifficulty(requested) {
    const n = typeof requested === 'string' && /^[1-5]$/.test(requested) ? Number(requested) : requested;
    return Number.isInteger(n) && n >= DIFFICULTY_MIN && n <= DIFFICULTY_MAX ? n : DIFFICULTY_AUTO;
}

/**
 * Dificultad efectiva: la pedida si la música la admite, si no el techo.
 *
 * @param {'auto' | number} requested
 * @param {number | null} ceiling  null si el análisis no permite calcularlo (formato 1).
 * @returns {number}
 */
export function resolveDifficulty(requested, ceiling) {
    if (requested === DIFFICULTY_AUTO) return autoDifficulty(ceiling);
    return ceiling === null ? requested : Math.min(requested, ceiling);
}

/**
 * Dificultades que se pueden ofrecer para un análisis. Con análisis del
 * servidor, de 1 al techo; sin techo calculable, ninguna (solo "Automática").
 *
 * @param {object} analysis
 * @returns {{ ceiling: number | null, options: number[], auto: number }}
 */
export function difficultyOptions(analysis) {
    const c = difficultyCeiling(analysis);
    const ceiling = c?.ceiling ?? null;
    const options = [];
    if (ceiling !== null) for (let d = DIFFICULTY_MIN; d <= ceiling; d++) options.push(d);
    return { ceiling, options, auto: autoDifficulty(ceiling) };
}
