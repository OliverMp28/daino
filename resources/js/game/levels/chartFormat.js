// Formato de chart — el contrato entre quien genera un nivel y quien lo juega.
//
// Ola 3. Hasta aquí el "nivel" era un objeto efímero que LevelGenerator
// devolvía y la GameSession consumía en la misma pestaña. A partir de ahora
// un chart es un ARTEFACTO: se persiste en el servidor, se cachea en el
// navegador, lo pueden producir generadores distintos (el JS de hoy, el
// analizador Python de la Ola 4, un editor manual en la Ola 7) y lo juegan
// clientes de versiones distintas. Por eso su forma está versionada y se
// valida al entrar, venga de donde venga.
//
// Semántica del tiempo — la decisión central de la Ola 3
// ------------------------------------------------------
// `event.t` es el instante MUSICAL, en segundos de canción, en el que el
// jugador debe ACTUAR (saltar, agacharse). No es cuándo aparece el obstáculo
// ni cuándo toca al Dino: el runtime coloca cada obstáculo para que su centro
// cruce al Dino `actionLeadS(kind)` después de `t`.
//
// Por qué así y no "tHit": medido con el simulador de física, el momento
// óptimo para pulsar ante un cactus está 0.355-0.36 s antes de que su centro
// cruce al Dino, a cualquier velocidad — exactamente el tiempo al ápice del
// salto. Si el chart guardara el cruce, el jugador tendría que adelantarse al
// beat. Guardando la acción, pulsar SOBRE el beat es lo correcto. Y como el
// adelanto se deriva de la física en runtime, retocar el salto no invalida
// ningún chart publicado: todos siguen cayendo en su beat.
//
// Tolerancia hacia delante
// ------------------------
// Un cliente viejo puede recibir un chart con tipos de evento que no conoce
// (`section`, `mode`, `fx` en olas futuras). Se CONSERVAN y el runtime ignora
// lo que no sabe interpretar: así un chart nuevo no rompe un cliente viejo.
// Lo que sí se descarta son obstáculos de un `kind` desconocido, porque
// instanciarlos haría que Obstacle leyera medidas de `undefined` a mitad de
// partida.

import { OBSTACLE_KIND } from '../config.js';

/** Versión mayor del formato que este cliente sabe interpretar. */
export const CHART_FORMAT_VERSION = 1;

/**
 * Versión del algoritmo de charting de este cliente. Súbela cuando cambie
 * cualquier cosa que altere los eventos generados para la misma entrada:
 * así los charts cacheados o persistidos con una versión anterior se detectan
 * como obsoletos en lugar de mezclarse con los nuevos.
 */
export const CHARTER_VERSION = 1;
export const CHARTER_NAME = 'daino-charter';

/** Techo defensivo de eventos: ~20 min de canción a 16 eventos/s. */
export const MAX_EVENTS = 20_000;

/** Rango sensato de velocidad de mundo. Fuera de esto no es un chart jugable. */
const SPEED_RANGE = Object.freeze({ min: 50, max: 2000 });

/** Precisión de serialización del tiempo: 1 ms es inferior a un frame. */
const TIME_DECIMALS = 3;

/**
 * @typedef {Object} ChartEvent
 * @property {number} t     Segundos de canción en los que el jugador actúa.
 * @property {string} type  'obstacle' hoy; otros tipos reservados a olas futuras.
 * @property {string} [kind] Clave de OBSTACLE_KIND cuando `type === 'obstacle'`.
 */

/**
 * @typedef {Object} Chart
 * @property {number} formatVersion
 * @property {{ name: string, version: number }} charter
 * @property {number} seed
 * @property {{ sha256: string|null, durationSec: number, sampleRate: number }} audio
 * @property {{ bpm: number, bpmConfidence: number, beatPeriodS: number }} music
 * @property {{ speedPxS: number }} world
 * @property {ChartEvent[]} events  Ordenados por `t` ascendente.
 */

export class ChartError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ChartError';
    }
}

/**
 * Valida y normaliza un chart de origen no confiable (red, caché, otro
 * generador). Nunca muta la entrada.
 *
 * Los errores estructurales (versión desconocida, duración inválida, nada que
 * jugar) lanzan `ChartError`: no hay forma segura de jugar ese chart. Los
 * problemas recuperables (un evento con `kind` desconocido) se reportan en
 * `warnings` y el evento se descarta.
 *
 * @param {unknown} raw
 * @returns {{ chart: Chart, warnings: string[] }}
 */
export function normalizeChart(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ChartError('El chart no es un objeto.');
    }
    const warnings = [];

    const formatVersion = raw.formatVersion;
    if (!Number.isInteger(formatVersion) || formatVersion < 1) {
        throw new ChartError(`formatVersion inválido: ${String(formatVersion)}.`);
    }
    if (formatVersion > CHART_FORMAT_VERSION) {
        // Una versión MAYOR cambia la semántica: interpretarla a ciegas podría
        // desincronizar el nivel sin que nadie lo note. Mejor fallar claro.
        throw new ChartError(`Chart de formato ${formatVersion}; este cliente solo entiende hasta ${CHART_FORMAT_VERSION}.`);
    }

    const durationSec = raw.audio?.durationSec;
    if (!isFiniteNumber(durationSec) || durationSec <= 0) {
        throw new ChartError('audio.durationSec debe ser un número positivo.');
    }

    const speedPxS = raw.world?.speedPxS;
    if (!isFiniteNumber(speedPxS) || speedPxS < SPEED_RANGE.min || speedPxS > SPEED_RANGE.max) {
        throw new ChartError(`world.speedPxS fuera de rango: ${String(speedPxS)}.`);
    }

    if (!Array.isArray(raw.events)) {
        throw new ChartError('events debe ser un array.');
    }
    if (raw.events.length > MAX_EVENTS) {
        throw new ChartError(`Demasiados eventos (${raw.events.length} > ${MAX_EVENTS}).`);
    }

    const events = [];
    let droppedKinds = 0;
    let droppedMalformed = 0;
    for (const e of raw.events) {
        if (e === null || typeof e !== 'object' || !isFiniteNumber(e.t) || typeof e.type !== 'string') {
            droppedMalformed++;
            continue;
        }
        if (e.t < 0 || e.t > durationSec) {
            droppedMalformed++;
            continue;
        }
        if (e.type === 'obstacle') {
            if (typeof e.kind !== 'string' || OBSTACLE_KIND[e.kind] === undefined) {
                droppedKinds++;
                continue;
            }
            events.push({ t: e.t, type: 'obstacle', kind: e.kind });
        } else {
            // Tipo futuro: se conserva tal cual (copia superficial) para no
            // perder información si este chart se reenvía o se reguarda.
            events.push({ ...e });
        }
    }
    if (droppedKinds > 0) warnings.push(`${droppedKinds} obstáculo(s) de tipo desconocido descartados.`);
    if (droppedMalformed > 0) warnings.push(`${droppedMalformed} evento(s) mal formados descartados.`);

    // Orden estable por t: `Array.prototype.sort` es estable desde ES2019,
    // así que eventos simultáneos conservan su orden relativo.
    events.sort((a, b) => a.t - b.t);

    const bpm = isFiniteNumber(raw.music?.bpm) && raw.music.bpm > 0 ? raw.music.bpm : 120;
    const beatPeriodS = isFiniteNumber(raw.music?.beatPeriodS) && raw.music.beatPeriodS > 0
        ? raw.music.beatPeriodS
        : 60 / bpm;

    const sha = raw.audio?.sha256;
    const chart = {
        formatVersion,
        charter: {
            name: typeof raw.charter?.name === 'string' ? raw.charter.name : 'unknown',
            version: Number.isInteger(raw.charter?.version) ? raw.charter.version : 0,
        },
        seed: Number.isInteger(raw.seed) ? raw.seed : 0,
        audio: {
            sha256: typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) ? sha : null,
            durationSec,
            sampleRate: isFiniteNumber(raw.audio?.sampleRate) ? raw.audio.sampleRate : 44100,
        },
        music: {
            bpm,
            bpmConfidence: isFiniteNumber(raw.music?.bpmConfidence) ? raw.music.bpmConfidence : 0,
            beatPeriodS,
        },
        world: { speedPxS },
        events,
    };

    return { chart, warnings };
}

/**
 * Forma serializable y compacta de un chart: tiempos redondeados a 1 ms.
 *
 * Los tiempos crudos son fracciones del hop del análisis (`i / 86.13…`) y se
 * serializan con 17 dígitos significativos — casi un tercio del payload era
 * ruido por debajo de la resolución de un frame.
 *
 * @param {Chart} chart
 * @returns {Chart}
 */
export function compactChart(chart) {
    return {
        ...chart,
        audio: { ...chart.audio, durationSec: round(chart.audio.durationSec, TIME_DECIMALS) },
        music: {
            bpm: round(chart.music.bpm, 3),
            bpmConfidence: round(chart.music.bpmConfidence, 3),
            beatPeriodS: round(chart.music.beatPeriodS, 5),
        },
        world: { speedPxS: round(chart.world.speedPxS, 2) },
        events: chart.events.map((e) => ({ ...e, t: round(e.t, TIME_DECIMALS) })),
    };
}

/** Solo los eventos jugables de obstáculo, en orden. */
export function obstacleEvents(chart) {
    return chart.events.filter((e) => e.type === 'obstacle');
}

/**
 * Deriva una seed de 32 bits estable a partir del hash del audio.
 *
 * Un mismo archivo produce siempre el mismo nivel — en cualquier navegador, al
 * rejugarlo y al publicarlo. Así un "probar mi canción" que se publica después
 * conserva exactamente el chart con el que se probó, y reintentar un nivel
 * permite aprenderlo en vez de enfrentarse a otro distinto cada vez.
 *
 * @param {string} sha256Hex
 * @returns {number} int32
 */
export function seedFromSha256(sha256Hex) {
    return Number.parseInt(sha256Hex.slice(0, 8), 16) | 0;
}

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function round(v, decimals) {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
}
