// Dificultad de primera clase (Ola 5, doc 10 §2.3, defecto D6).
//
// La dificultad no es un multiplicador aplicado a un chart único. Cambia:
//
//   - CUÁNTO se llena cada nivel del arco (acciones por minuto en reposo,
//     calma, groove, empuje y clímax), siempre sobre golpes que suenan.
//   - CUÁNTO EXIGEN los acentos (accents.js): cuántos golpes fuertes llevan una
//     variante con menos margen, cuánto margen como mínimo y cuánta exigencia
//     por minuto deben sumar para el jugador de referencia (challenge.js).
//   - CON QUÉ TOLERANCIA debe poder superarse: un nivel Relajado se supera
//     pulsando con ±80 ms de error; uno Extremo exige ±40 ms. El validador
//     juega el chart con ese margen y elimina lo que no cabe.
//   - QUÉ se juega y DESDE CUÁNDO: agacharse, acentos, contratiempos,
//     semicorcheas y combinaciones rápidas salto→agachado se desbloquean en
//     momentos del arco (primer groove, primer empuje, clímax). Más difícil =
//     antes y más.
//   - A QUÉ VELOCIDAD se juega: la base (más difícil, más rápido desde el
//     principio), cuánto acelera en las marchas y el clímax, y hasta dónde.
//   - QUÉ MODOS de movimiento existen y cuántos momentos caben (Ola 6); dónde
//     van lo decide la canción (modePlan.js).
//   - Si hay ANILLOS de salto (Ola 6c): un segundo salto en el aire sobre el golpe
//     que sigue a un salto, donde dos saltos desde el suelo no caben.
//   - Cómo se VUELA (Ola 6c): cuántos compases seguidos se encadenan notas sin
//     volver al suelo.
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
 * @property {number} maxRestS      Silencio de juego máximo mientras la música suena (en un tramo de reposo, × CHARTER_RULES.restLevelFactor).
 * @property {{ duck: number, accent: number, offbeat: number, sixteenth?: number, combo: number, ring?: number }} unlock
 *           Etapa (STAGE) desde la que existe cada mecánica: agacharse, obstáculos
 *           de acento, contratiempos, semicorcheas, combinaciones rápidas y anillos.
 * @property {number} speedAmp      Cuánto de la aceleración por marchas e intensidad se aplica.
 * @property {number} baseSpeed     Multiplica la velocidad base que sale del tempo.
 * @property {number} maxSpeedPxS   Techo de velocidad de la dificultad (nunca por encima de SPEED_RULES.maxSpeedPxS).
 * @property {{ strength: number, ratio: number }} offbeat
 *           Un contratiempo con acción necesita un golpe de al menos `strength` y
 *           `ratio` veces el de sus vecinos del pulso (una síncopa de verdad).
 * @property {number} calmBeatStrength  En calma, un tiempo débil (2 y 4) necesita al menos este golpe.
 * @property {{ strength: number } | null} climaxOffbeat
 *           En el clímax, un contratiempo también se juega con un golpe de al menos
 *           `strength` aunque no sea una síncopa (nunca sin golpe: tras el segundo
 *           playtest, un contratiempo callado no se siente acorde a la canción).
 * @property {{ strength: number, ratio: number } | null} sixteenth
 *           Una semicorchea ("e" o "a") se juega con un golpe de al menos
 *           `strength` y `ratio` veces el del pulso y el contratiempo que tiene al
 *           lado: el bombo sincopado, no el charles. null: nunca.
 * @property {{ share: number, marginS: number, hazard: number } | null} accent
 *           Acciones sobre los golpes más fuertes que llevan una variante de acento
 *           (accents.js): `share` de las que la admiten en cada tramo (por el
 *           factor de su nivel del arco); `marginS`, el margen de error mínimo (del
 *           lado más estrecho, con sus vecinas) que puede dejar uno; y `hazard`,
 *           cuánto deben exigir entre todos al jugador de referencia
 *           (levels/challenge.js) en la canción entera, en muertes esperadas (Ola 6c:
 *           antes por minuto de juego).
 * @property {number} airShare      Cuota máxima de obstáculos voladores por tramo.
 * @property {{ share: number, strength: number } | null} ring
 *           Anillos de salto (Ola 6c, patterns.js): como mucho `share` de las
 *           acciones de correr de cada tramo, y solo sobre un golpe de al menos
 *           `strength` que sigue a un salto demasiado cerca para saltar otra vez desde
 *           el suelo. null: nunca.
 * @property {{ chainBars: number, comfortPx: number }} fly
 *           Vuelo (Ola 6c, flightCharter.js): compases seguidos en los que las notas
 *           se encadenan por el aire antes de volver al suelo (0: vuelta al suelo
 *           tras cada nota, como en la 6b) y holgura del túnel por encima de la
 *           justa (flightCourse.flightMargin).
 * @property {Record<string, { climax: boolean }>} modes
 *           Modos de movimiento que existen en esta dificultad y si el clímax
 *           puede ser uno de sus momentos (levels/modePlan.js).
 * @property {number[]} moments
 *           Duración mínima de la canción para 1, 2… momentos de modo. Cada modo
 *           aparece como mucho una vez; el reparto decide cuáles y dónde.
 */

/**
 * Tras el playtest de la 6b ("en lo difícil no se siente emoción", "los niveles
 * están demasiado fáciles") se midió What's Up Danger en Extremo: 52 acciones/min
 * de media, 85 en el clímax, 31 silencios de juego de 1.5 s o más (16 de 2 s o
 * más: compases enteros con un solo salto) y el clímax a 665 px/s, 1.4 s para ver
 * venir cada obstáculo. Todas las densidades suben, la base de la velocidad
 * depende de la dificultad, las marchas y el clímax aceleran más y cada
 * dificultad tiene su techo. Relajado sigue siendo para empezar.
 *
 * Sep 2026 ("aumenta la velocidad o la progresión, solo eso"): `baseSpeed` y
 * `maxSpeedPxS` suben en Normal (860→940), Difícil (940→980) y Extremo
 * (1.24→1.32; el techo 1000 no sube más — es donde toda pantalla apaisada
 * todavía lee cada obstáculo ≥ 0.85 s antes, ver world-view.test.mjs). Relajado
 * y Fácil no se tocan.
 *
 * @type {Record<number, DifficultyProfile>}
 */
export const DIFFICULTY_PROFILES = Object.freeze({
    1: Object.freeze({
        level: 1,
        apm: [0, 16, 26, 34, 42],
        toleranceS: 0.08,
        minGapS: 1,
        maxRestS: 3.2,
        unlock: { duck: STAGE.FIRST_DRIVE, accent: STAGE.NEVER, offbeat: STAGE.NEVER, combo: STAGE.NEVER, ring: STAGE.NEVER },
        speedAmp: 0.6,
        baseSpeed: 0.9,
        maxSpeedPxS: 660,
        offbeat: Object.freeze({ strength: 0.4, ratio: 0.85 }),
        calmBeatStrength: 0.5,
        climaxOffbeat: null,
        accent: Object.freeze({ share: 0.12, marginS: 0.18, hazard: 0.02 }),
        airShare: 0.25,
        ring: null,
        fly: Object.freeze({ chainBars: 0, comfortPx: 42 }),
        modes: Object.freeze({}),
        moments: Object.freeze([]),
    }),
    2: Object.freeze({
        level: 2,
        apm: [8, 26, 42, 54, 66],
        toleranceS: 0.065,
        minGapS: 0.72,
        maxRestS: 2.6,
        unlock: { duck: STAGE.FIRST_GROOVE, accent: STAGE.FIRST_DRIVE, offbeat: STAGE.CLIMAX, combo: STAGE.NEVER, ring: STAGE.NEVER },
        speedAmp: 0.9,
        baseSpeed: 0.97,
        maxSpeedPxS: 760,
        offbeat: Object.freeze({ strength: 0.4, ratio: 0.85 }),
        calmBeatStrength: 0.5,
        climaxOffbeat: null,
        accent: Object.freeze({ share: 0.18, marginS: 0.14, hazard: 0.1 }),
        airShare: 0.34,
        ring: null,
        fly: Object.freeze({ chainBars: 0, comfortPx: 38 }),
        // Fácil: una sola mecánica nueva, la de pulsar (el vuelo pide mantener).
        modes: Object.freeze({ flip: Object.freeze({ climax: false }) }),
        moments: Object.freeze([75]),
    }),
    3: Object.freeze({
        level: 3,
        apm: [12, 38, 60, 78, 96],
        toleranceS: 0.055,
        minGapS: 0,
        maxRestS: 2,
        unlock: { duck: STAGE.FIRST_GROOVE, accent: STAGE.FIRST_GROOVE, offbeat: STAGE.FIRST_DRIVE, sixteenth: STAGE.FIRST_DRIVE, combo: STAGE.FIRST_DRIVE, ring: STAGE.FIRST_DRIVE },
        speedAmp: 1.1,
        baseSpeed: 1.14,
        maxSpeedPxS: 940,
        offbeat: Object.freeze({ strength: 0.35, ratio: 0.75 }),
        calmBeatStrength: 0.45,
        climaxOffbeat: null,
        sixteenth: Object.freeze({ strength: 0.6, ratio: 0.9 }),
        accent: Object.freeze({ share: 0.4, marginS: 0.085, hazard: 0.7 }),
        airShare: 0.5,
        ring: Object.freeze({ share: 0.1, strength: 0.4 }),
        fly: Object.freeze({ chainBars: 2, comfortPx: 34 }),
        // Normal: los dos modos, pero el clímax se corre a toda velocidad.
        modes: Object.freeze({ flip: Object.freeze({ climax: false }), fly: Object.freeze({ climax: false }) }),
        moments: Object.freeze([75, 150]),
    }),
    4: Object.freeze({
        level: 4,
        apm: [18, 54, 80, 104, 130],
        toleranceS: 0.047,
        minGapS: 0,
        maxRestS: 1.8,
        unlock: { duck: STAGE.START, accent: STAGE.FIRST_GROOVE, offbeat: STAGE.FIRST_GROOVE, sixteenth: STAGE.FIRST_GROOVE, combo: STAGE.FIRST_GROOVE, ring: STAGE.FIRST_GROOVE },
        speedAmp: 1.3,
        baseSpeed: 1.22,
        maxSpeedPxS: 980,
        offbeat: Object.freeze({ strength: 0.3, ratio: 0.65 }),
        calmBeatStrength: 0.35,
        climaxOffbeat: Object.freeze({ strength: 0.25 }),
        sixteenth: Object.freeze({ strength: 0.5, ratio: 0.8 }),
        accent: Object.freeze({ share: 0.55, marginS: 0.07, hazard: 1.6 }),
        airShare: 0.55,
        ring: Object.freeze({ share: 0.16, strength: 0.35 }),
        fly: Object.freeze({ chainBars: 4, comfortPx: 30 }),
        modes: Object.freeze({ flip: Object.freeze({ climax: true }), fly: Object.freeze({ climax: true }) }),
        moments: Object.freeze([60, 120]),
    }),
    5: Object.freeze({
        level: 5,
        apm: [24, 66, 98, 126, 160],
        toleranceS: 0.04,
        minGapS: 0,
        maxRestS: 1.4,
        unlock: { duck: STAGE.START, accent: STAGE.START, offbeat: STAGE.FIRST_GROOVE, sixteenth: STAGE.FIRST_GROOVE, combo: STAGE.START, ring: STAGE.FIRST_GROOVE },
        speedAmp: 1.5,
        baseSpeed: 1.32,
        maxSpeedPxS: 1000,
        offbeat: Object.freeze({ strength: 0.25, ratio: 0.55 }),
        calmBeatStrength: 0.3,
        climaxOffbeat: Object.freeze({ strength: 0.2 }),
        sixteenth: Object.freeze({ strength: 0.45, ratio: 0.7 }),
        accent: Object.freeze({ share: 0.7, marginS: 0.058, hazard: 3.0 }),
        airShare: 0.6,
        ring: Object.freeze({ share: 0.22, strength: 0.3 }),
        fly: Object.freeze({ chainBars: 8, comfortPx: 24 }),
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
