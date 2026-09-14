// Estado de publicación de un nivel propio y del análisis del servidor (Ola 4).
//
// Con el analizador activo, publicar ya no es instantáneo: el MP3 se sube, el
// nivel queda "pendiente" y el servidor lo analiza antes de hacerlo público
// (PublishService.php). Aquí se decide, sin DOM, qué enseña la UI en cada
// momento: la insignia, el progreso con palabras que entienda un jugador, qué
// hacer si falla y cuándo se puede reintentar. `catalog.js` solo lo pinta.
//
// Ola 5: también la dificultad que elige el autor (`difficultyChoiceView`).

import { DIFFICULTY_NAMES, autoDifficulty } from '../game/levels/difficulty.js';

/** En qué punto está un nivel respecto al catálogo público. */
export const PUBLISH_STATE = Object.freeze({
    /** Solo lo ve su autor; se puede publicar. */
    PRIVATE: 'private',
    /** Subido: el servidor lo está analizando (o lo tiene en cola). */
    ANALYZING: 'analyzing',
    /** El análisis falló: sigue privado, con su audio en el servidor. */
    FAILED: 'failed',
    /** En el catálogo. */
    PUBLIC: 'public',
});

/**
 * Qué hace el servidor en cada etapa, dicho para quien espera. Las claves son
 * las etapas que escribe el worker (analyzer/daino_analyzer/worker.py y
 * analysis.py); una etapa desconocida (worker más nuevo) usa la genérica.
 */
export const STAGE_LABELS = Object.freeze({
    starting: 'Preparando el análisis',
    analyzing: 'Leyendo el audio',
    spectral: 'Escuchando la canción',
    beats: 'Buscando el pulso',
    onsets: 'Detectando cada golpe',
    energy: 'Midiendo la intensidad',
    sections: 'Reconociendo estrofas y estribillos',
    features: 'Calculando la dificultad',
    done: 'Análisis terminado',
    charting: 'Colocando los obstáculos',
});

/**
 * Fallos que conoce la UI. `retryable`: volver a analizar el MISMO audio puede
 * salir bien (un corte, un tiempo agotado). Si el problema es el archivo, lo
 * que hay que hacer es publicarlo de nuevo con otro, no reintentar.
 */
const FAILURES = Object.freeze({
    decode_failed: { message: 'El archivo no se pudo leer como audio. Publícalo de nuevo con un MP3 válido.', retryable: false },
    audio_missing: { message: 'El audio ya no está en el servidor. Vuelve a publicarlo.', retryable: false },
    audio_mismatch: { message: 'El audio del servidor no es el del nivel. Vuelve a publicarlo con el MP3 original.', retryable: false },
    timeout: { message: 'La canción tardó demasiado en analizarse.', retryable: true },
    analyzer_crashed: { message: 'El analizador tuvo un problema.', retryable: true },
    lease_expired: { message: 'El analizador tuvo un problema.', retryable: true },
    worker_stopped: { message: 'El analizador se detuvo antes de terminar.', retryable: true },
    analysis_invalid: { message: 'No se pudo generar un nivel con esta canción.', retryable: true },
    charter_failed: { message: 'No se pudo generar un nivel con esta canción.', retryable: true },
});
const UNKNOWN_FAILURE = Object.freeze({ message: 'El analizador falló por un motivo inesperado.', retryable: true });

/**
 * @param {object} level  Fila de GET /api/levels (con `pending_public` y `analysis`).
 * @returns {PUBLISH_STATE[keyof PUBLISH_STATE]}
 */
export function publishStateFor(level) {
    if (level?.is_public === true) return PUBLISH_STATE.PUBLIC;
    if (level?.pending_public === true) return PUBLISH_STATE.ANALYZING;
    // Un fallo solo cuenta mientras el audio sigue subido: si después lo retiró
    // (pasó a privado y se borró el MP3), vuelve a ser un privado normal.
    if (level?.has_audio === true && level.analysis?.status === 'failed') return PUBLISH_STATE.FAILED;
    return PUBLISH_STATE.PRIVATE;
}

/**
 * @param {string | null | undefined} code
 * @returns {{ message: string, retryable: boolean }}
 */
export function failureView(code) {
    return (typeof code === 'string' && Object.hasOwn(FAILURES, code)) ? FAILURES[code] : UNKNOWN_FAILURE;
}

/**
 * @param {string | null | undefined} stage
 * @returns {string}
 */
export function stageLabel(stage) {
    return (typeof stage === 'string' && Object.hasOwn(STAGE_LABELS, stage)) ? STAGE_LABELS[stage] : 'Analizando';
}

/**
 * Vista del último trabajo de análisis (`analysis` de la API). null si no hay
 * nada que enseñar (terminado o cancelado).
 *
 * @param {object | null | undefined} summary
 * @returns {{ tone: 'waiting' | 'working' | 'error', title: string, detail: string,
 *             progress: number | null, active: boolean, canRetry: boolean } | null}
 */
export function analysisView(summary) {
    if (summary === null || typeof summary !== 'object') return null;
    switch (summary.status) {
        case 'queued': {
            // Un trabajo en cola con intentos ya hechos es un reintento tras un
            // fallo pasajero (el worker espera un poco antes de volver a cogerlo).
            const retrying = Number(summary.attempts) > 0;
            const pos = Number.isInteger(summary.queue_position) ? summary.queue_position : null;
            let detail = '';
            if (retrying) detail = 'Hubo un problema pasajero; se reintentará en breve.';
            else if (pos === 0) detail = 'Eres el siguiente.';
            else if (pos !== null) detail = `${pos} ${pos === 1 ? 'canción' : 'canciones'} por delante.`;
            return { tone: 'waiting', title: 'En cola para analizar', detail, progress: null, active: true, canRetry: false };
        }
        case 'running':
            return {
                tone: 'working',
                title: 'Analizando la canción',
                detail: stageLabel(summary.stage),
                progress: clamp01(summary.progress),
                active: true,
                canRetry: false,
            };
        case 'failed': {
            const failure = failureView(summary.error?.code);
            return { tone: 'error', title: 'No se pudo analizar', detail: failure.message, progress: null, active: false, canRetry: failure.retryable };
        }
        default:
            return null;
    }
}

/**
 * Todo lo que la tarjeta y la ficha necesitan sobre publicar.
 *
 * @param {object} level
 * @returns {{ state: string, badge: string | null, canPublish: boolean, canRetry: boolean,
 *             analysis: ReturnType<typeof analysisView> }}
 */
export function publishView(level) {
    const state = publishStateFor(level);
    const own = level?.is_mine === true && level?.is_official !== true;
    const analysis = state === PUBLISH_STATE.ANALYZING || state === PUBLISH_STATE.FAILED ? analysisView(level.analysis) : null;
    switch (state) {
        case PUBLISH_STATE.PUBLIC:
            return { state, badge: null, canPublish: false, canRetry: false, analysis: null };
        case PUBLISH_STATE.ANALYZING:
            // Sin resumen todavía (la lista llegó justo antes del trabajo): en cola.
            return { state, badge: 'Analizando', canPublish: false, canRetry: false, analysis: analysis ?? analysisView({ status: 'queued', attempts: 0 }) };
        case PUBLISH_STATE.FAILED:
            return { state, badge: 'Sin publicar', canPublish: own, canRetry: own && (analysis?.canRetry ?? false), analysis };
        default:
            return { state, badge: own ? 'Privado' : null, canPublish: own, canRetry: false, analysis: null };
    }
}

/**
 * ¿Ha terminado el trabajo que se sigue? Devuelve el desenlace, o null si sigue
 * en curso. Se decide con la respuesta de GET /api/levels/{id}/analysis.
 *
 * Un nivel ya público puede tener trabajo en marcha: aplicar otra dificultad
 * (re-chart, Ola 5). Mientras esté en cola o corriendo no ha terminado; si
 * falla, el nivel sigue publicado con su chart anterior y el desenlace es un
 * fallo, no una publicación.
 *
 * @param {{ is_public?: boolean, pending_public?: boolean, analysis?: object | null }} status
 * @returns {'published' | 'failed' | 'cancelled' | null}
 */
export function publishOutcome(status) {
    const job = status?.analysis;
    const active = job?.status === 'queued' || job?.status === 'running';
    if (status?.is_public === true) {
        if (active) return null;
        return job?.purpose === 'rechart' && job.status === 'failed' ? 'failed' : 'published';
    }
    if (status?.pending_public === true) return null;
    return job?.status === 'failed' ? 'failed' : 'cancelled';
}

/**
 * Lo que enseña el selector de dificultad de un nivel propio (Ola 5).
 *
 * Solo aparece cuando el servidor ya analizó la canción: antes no se sabe hasta
 * qué dificultad admite, y ofrecer opciones que luego no se podrían aplicar
 * sería la etiqueta "con calzador" que el doc 10 §2.3 prohíbe.
 *
 * @param {object} level  Fila de la API con `difficulty_choice` (solo la recibe su autor).
 * @returns {{ current: 'auto' | number, effective: number,
 *             options: Array<{ value: 'auto' | number, label: string, hint: string }>,
 *             locked: boolean, busy: boolean, note: string } | null}
 */
export function difficultyChoiceView(level) {
    const choice = level?.difficulty_choice;
    if (choice === null || typeof choice !== 'object' || !Array.isArray(choice.options) || choice.options.length === 0) return null;
    const ceiling = Math.max(...choice.options);
    const auto = autoDifficulty(ceiling);
    const job = level.analysis;
    const busy = level.pending_public === true || (job?.purpose === 'rechart' && (job.status === 'queued' || job.status === 'running'));
    const locked = choice.locked === true;
    let note;
    if (locked) note = 'Otros jugadores ya tienen marca en este nivel: su dificultad queda fija.';
    else if (busy) note = level.pending_public === true ? 'Se aplicará al terminar el análisis.' : 'Aplicando la dificultad…';
    else note = `La canción admite hasta ${DIFFICULTY_NAMES[ceiling]}.`;
    return {
        current: choice.requested === 'auto' || !choice.options.includes(choice.requested) ? 'auto' : choice.requested,
        effective: Number.isInteger(level.difficulty) ? level.difficulty : auto,
        options: [
            { value: 'auto', label: 'Automática', hint: DIFFICULTY_NAMES[auto] },
            ...choice.options.map((d) => ({ value: d, label: DIFFICULTY_NAMES[d], hint: '★'.repeat(d) })),
        ],
        locked,
        busy,
        note,
    };
}

function clamp01(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
