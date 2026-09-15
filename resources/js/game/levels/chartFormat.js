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
// (`mode` en la Ola 6). Se CONSERVAN y el runtime ignora lo que no sabe
// interpretar: así un chart nuevo no rompe un cliente viejo. Lo que sí se
// descarta son obstáculos de un `kind` desconocido, porque instanciarlos haría
// que Obstacle leyera medidas de `undefined` a mitad de partida.
//
// Formato 2 (Ola 5)
// -----------------
// Añade lo que el charter musical decide además de los obstáculos:
//   - `world.speedChanges`  la velocidad cambia con la estructura de la canción.
//     Es un cambio de SEMÁNTICA (un cliente de formato 1 colocaría los
//     obstáculos a velocidad constante), por eso sube la versión mayor.
//   - `music.beats` / `music.downbeats`  el pulso real, para que el mundo
//     entero lata con la canción y no solo con los obstáculos.
//   - `difficulty`  la dificultad efectiva, la pedida y el techo de la canción.
//   - eventos `section` (nivel e intensidad de cada tramo) y `fx` (drops).
// Un chart de formato 1 se sigue leyendo igual: sin cambios de velocidad ni
// pulso propio.

import { OBSTACLE_KIND } from '../config.js';

/** Versión mayor del formato que este cliente sabe interpretar (y la que genera). */
export const CHART_FORMAT_VERSION = 2;

/**
 * Versión del algoritmo de charting de este cliente. Súbela cuando cambie
 * cualquier cosa que altere los eventos generados para la misma entrada:
 * así los charts cacheados o persistidos con una versión anterior se detectan
 * como obsoletos en lugar de mezclarse con los nuevos.
 *
 * 3: charter musical (Ola 5). 4: marchas de velocidad hacia el clímax, en la
 * anacrusa, y validación también para quien juega con la vista (afinado de
 * velocidad). El formato no cambia: solo los eventos y la velocidad generados.
 */
export const CHARTER_VERSION = 4;
export const CHARTER_NAME = 'daino-charter';

/** Techo defensivo de eventos: ~20 min de canción a 16 eventos/s. */
export const MAX_EVENTS = 20_000;

/** Techo de beats (~20 min a 250 BPM) y de cambios de velocidad. */
export const MAX_BEATS = 30_000;
export const MAX_SPEED_CHANGES = 400;

/** Rango sensato de velocidad de mundo. Fuera de esto no es un chart jugable. */
const SPEED_RANGE = Object.freeze({ min: 50, max: 2000 });

/** Rampa máxima de un cambio de velocidad. */
const MAX_RAMP_S = 10;

/** Precisión de serialización del tiempo: 1 ms es inferior a un frame. */
const TIME_DECIMALS = 3;

/**
 * @typedef {Object} ChartEvent
 * @property {number} t     Segundos de canción en los que el jugador actúa.
 * @property {string} type  'obstacle', 'section', 'fx'; otros se conservan sin interpretar.
 * @property {string} [kind] Clave de OBSTACLE_KIND cuando `type === 'obstacle'`.
 */

/**
 * @typedef {Object} Chart
 * @property {number} formatVersion
 * @property {{ name: string, version: number }} charter
 * @property {number} seed
 * @property {{ sha256: string|null, durationSec: number, sampleRate: number }} audio
 * @property {{ bpm: number, bpmConfidence: number, beatPeriodS: number, beats: number[], downbeats: number[] }} music
 * @property {{ level: number, requested: 'auto'|number, ceiling: number|null } | null} difficulty
 * @property {{ speedPxS: number, speedChanges: Array<{ t: number, speedPxS: number, rampS: number }> }} world
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

    // Formato 2. Todo opcional: un chart sin estos campos se juega como uno de
    // formato 1. Lo mal formado se descarta entero con aviso (un pulso o un
    // perfil de velocidad a medias es peor que ninguno).
    const beats = timeList(raw.music?.beats, durationSec, 'music.beats', warnings);
    const downbeats = timeList(raw.music?.downbeats, durationSec, 'music.downbeats', warnings);
    const speedChanges = speedChangeList(raw.world?.speedChanges, durationSec, warnings);
    const difficulty = difficultyInfo(raw.difficulty);

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
            beats,
            downbeats,
        },
        difficulty,
        world: { speedPxS, speedChanges },
        events,
    };

    return { chart, warnings };
}

/** Lista de instantes estrictamente creciente dentro de la canción, o [] con aviso. */
function timeList(raw, durationSec, name, warnings) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > MAX_BEATS) {
        warnings.push(`${name} descartado: no es una lista acotada.`);
        return [];
    }
    let prev = -Infinity;
    for (const t of raw) {
        if (!isFiniteNumber(t) || t < 0 || t > durationSec + 0.001 || t <= prev) {
            warnings.push(`${name} descartado: instantes fuera de la canción o desordenados.`);
            return [];
        }
        prev = t;
    }
    return raw.slice();
}

function speedChangeList(raw, durationSec, warnings) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > MAX_SPEED_CHANGES) {
        warnings.push('world.speedChanges descartado: no es una lista acotada.');
        return [];
    }
    const out = [];
    let prev = -Infinity;
    for (const c of raw) {
        const ok = c !== null && typeof c === 'object'
            && isFiniteNumber(c.t) && c.t >= 0 && c.t <= durationSec && c.t >= prev
            && isFiniteNumber(c.speedPxS) && c.speedPxS >= SPEED_RANGE.min && c.speedPxS <= SPEED_RANGE.max
            && (c.rampS === undefined || (isFiniteNumber(c.rampS) && c.rampS >= 0 && c.rampS <= MAX_RAMP_S));
        if (!ok) {
            // A velocidad equivocada los obstáculos siguen cruzando en su
            // instante, pero el nivel validado era otro: mejor ninguno.
            warnings.push('world.speedChanges descartado: cambio de velocidad inválido.');
            return [];
        }
        out.push({ t: c.t, speedPxS: c.speedPxS, rampS: c.rampS ?? 0 });
        prev = c.t;
    }
    return out;
}

function difficultyInfo(raw) {
    if (raw === null || typeof raw !== 'object') return null;
    const level = Number.isInteger(raw.level) && raw.level >= 1 && raw.level <= 5 ? raw.level : null;
    if (level === null) return null;
    const requested = raw.requested === 'auto' || (Number.isInteger(raw.requested) && raw.requested >= 1 && raw.requested <= 5)
        ? raw.requested
        : 'auto';
    const ceiling = Number.isInteger(raw.ceiling) && raw.ceiling >= 1 && raw.ceiling <= 5 ? raw.ceiling : null;
    return { level, requested, ceiling };
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
    const out = {
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
    if (chart.music.beats?.length > 0) out.music.beats = chart.music.beats.map((t) => round(t, TIME_DECIMALS));
    if (chart.music.downbeats?.length > 0) out.music.downbeats = chart.music.downbeats.map((t) => round(t, TIME_DECIMALS));
    if (chart.world.speedChanges?.length > 0) {
        out.world.speedChanges = chart.world.speedChanges.map((c) => ({
            t: round(c.t, TIME_DECIMALS),
            speedPxS: round(c.speedPxS, 2),
            rampS: round(c.rampS ?? 0, TIME_DECIMALS),
        }));
    }
    if (chart.difficulty === null || chart.difficulty === undefined) delete out.difficulty;
    return out;
}

/** Eventos de estructura del chart (`section`), en orden. */
export function sectionEvents(chart) {
    return chart.events.filter((e) => e.type === 'section' && isFiniteNumber(e.level));
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
