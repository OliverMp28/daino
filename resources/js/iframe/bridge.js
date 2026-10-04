// resources/js/iframe/bridge.js
//
// Puente postMessage entre Daino (dentro de un iframe) y el portal de Vout (la
// ventana que lo contiene). El contrato es el de Vout: guía de integración,
// "Identidad dentro del iFrame".
//
//   Daino → portal   { type: 'READY', suggestedPreset: 'runner' }
//   Daino → portal   { type: 'EXIT' }                           volver al catálogo
//   portal → Daino   { type: 'VOUT_AUTH', token, expiresAt, voutId, username, debug? }
//   portal → Daino   { type: 'VOUT_SESSION_END', reason }       no habrá más renovaciones
//
//   Control facial (lo que el jugador hace con la cara, según SU mapeo de gestos):
//   portal → Daino   { type: 'VOUT_KEY', code, key, state, at } pulsa o suelta una tecla
//   portal → Daino   { type: 'VOUT_POINTER', button, state, at } pulsa o suelta un botón del ratón,
//                                                               donde esté el cursor
//   portal → Daino   { type: 'VOUT_CURSOR', x, y }              cursor con la cabeza (0 a 1)
//   portal → Daino   { type: 'VOUT_ACTION', event, at }         empieza una acción de juego
//   portal → Daino   { type: 'VOUT_ACTION_END', event, at }     termina
//
// Aquí vive el PROTOCOLO: quién puede hablar, qué forma tiene cada mensaje y a
// quién se le entrega. Qué hace Daino con una tecla, un clic o un gesto lo decide
// iframe/remote.js; qué hace con la identidad, api/client.js.
//
// Cómo va:
//   - `READY` se repite hasta que llega el primer `VOUT_AUTH`: si el iframe carga
//     antes de que el portal escuche, uno solo se perdería. El portal contesta a
//     cada `READY`, y enseña "El juego no responde" si no le llega ninguno. Se
//     envía en cuanto arranca el script, antes de montar el motor: significa
//     "puedo recibir la identidad", no "ya lo cargué todo".
//   - `VOUT_AUTH` llega otra vez cada vez que el portal renueva el token (unos
//     minutos antes de que caduque). Siempre vale el último. Aquí no se renueva
//     nada: dentro del iframe las cookies de Daino son de terceros.
//   - El navegador no deja que el portal pulse teclas ni haga clic dentro de un
//     iframe de otro origen: el portal dice QUÉ tecla o QUÉ clic y es Daino quien
//     lo hace en su página. Cada usuario trae su mapeo de gestos; el preset
//     `runner` que se sugiere en `READY` (acciones JUMP y DUCK) es opcional.
//   - Un gesto mantenido es una pulsación mantenida: todo tiene su principio
//     (tecla o botón `down`, `VOUT_ACTION`) y su final (`up`, `VOUT_ACTION_END`),
//     que llega una o dos décimas después de relajar el gesto. El portal suelta
//     siempre lo que pulsa.
//   - `at` (milisegundos Unix) dice cuándo ocurrió el gesto: entre la imagen de la
//     cámara y el mensaje pasa el tiempo de analizarla.
//   - `debug: true` en `VOUT_AUTH` (el usuario abrió el portal con `?voutdebug=1`)
//     enciende la depuración: el portal carga el juego sin parámetros.
//
// Restricciones (CLAUDE.md invariantes):
//   - Solo se escucha al portal: `event.origin` exacto y `event.source` igual a
//     la ventana que nos contiene. Solo se le escribe a su origen, NUNCA a "*".
//   - Tokens NUNCA en localStorage / sessionStorage / URL params: viven solo en
//     memoria de este módulo y de client.js. Tampoco en la depuración.
//   - `voutId` y `username` del mensaje sirven para pintar, no para decidir nada:
//     la identidad es la del token, una vez validado en el servidor.
//
// El origen del portal llega por <meta name="daino:vout-origin"> (de
// `VOUT_ORIGIN` en el .env). Sin él, el bridge NO arranca (modo standalone).

const META_VOUT_ORIGIN = 'daino:vout-origin';

/** El control facial hecho para un juego como Daino: el que emite JUMP y DUCK. */
const SUGGESTED_PRESET = 'runner';

const READY_EVERY_MS = 500;
/** Sin respuesta en este tiempo, nadie escucha: se deja de insistir. */
const READY_GIVE_UP_MS = 60_000;

/** Por qué el portal deja de renovar la sesión. */
const SESSION_END_REASONS = new Set(['signed_out', 'revoked', 'unavailable']);

/** Un `at` más viejo que esto (o en el futuro) no es de fiar: se usa la hora de llegada. */
const MAX_GESTURE_AGE_MS = 2000;

/** El nombre de una acción es texto que elige el usuario en Vout: se acota. */
const MAX_NAME_LENGTH = 40;

/** Depuración: `?voutdebug=1` la enciende y se recuerda; `?voutdebug=0` la apaga. */
const DEBUG_PARAM = 'voutdebug';
const DEBUG_KEY = 'daino:voutdebug';
const TRACE_LIMIT = 400;

/**
 * @typedef {{ token: string, expiresAt: number, voutId: string | null, username: string | null }} BridgeAuth
 *   `expiresAt` en segundos Unix (el `exp` del token); 0 si el portal no lo dijo.
 */

/**
 * Lo que el jugador hace con la cara, ya comprobado. `timeStamp` es cuándo ocurrió
 * el gesto en el reloj de `performance.now()` (el de las pulsaciones del juego).
 *
 * @typedef {{ kind: 'key', code: string, key: string, state: 'down' | 'up', timeStamp: number }
 *         | { kind: 'pointer', button: 'left' | 'right', state: 'down' | 'up', timeStamp: number }
 *         | { kind: 'cursor', x: number, y: number }
 *         | { kind: 'action', event: string, phase: 'start' | 'end', timeStamp: number }} PortalInput
 */

/**
 * @typedef {{ at: number, dir: 'in' | 'out' | 'note', type: string, data: Record<string, unknown>, outcome: string | null, lagMs: number | null }} TraceEntry
 *   `data`: lo que traía el mensaje, sin el token. `lagMs`: lo que tardó desde su
 *   gesto (`at`) hasta llegar. Cómo se enseña lo decide ui/voutDebug.js.
 */

/** @type {BridgeAuth | null}  La última identidad recibida; vive solo aquí. */
let auth = null;
/** @type {((input: PortalInput) => string | null | void) | null} */
let portalInput = null;
const authListeners = new Set();
const sessionEndListeners = new Set();
let allowedOrigin = null;
let isEmbedded = false;
let readyTimer = null;
let readySent = 0;

/**
 * La depuración: qué llega del portal y qué hace Daino con ello. null = apagada
 * (lo normal): no se guarda ni se escribe nada.
 *
 * @type {{ entries: TraceEntry[], counts: Record<string, number>, listeners: Set<(entry: TraceEntry) => void> } | null}
 */
let trace = null;
const traceStartListeners = new Set();

function isInIframe() {
    try {
        return window.self !== window.top;
    } catch {
        // Acceso a window.top puede lanzar SecurityError en cross-origin;
        // si lanza, definitivamente estamos embebidos.
        return true;
    }
}

function readAllowedOriginFromMeta() {
    const meta = document.querySelector(`meta[name="${META_VOUT_ORIGIN}"]`);
    if (!meta) return null;
    const value = meta.getAttribute('content');
    if (!value || value === '*') return null;
    try {
        // Validamos que sea una URL válida — rechaza valores tipo "vout".
        const url = new URL(value);
        return url.origin;
    } catch {
        return null;
    }
}

/**
 * Cuándo ocurrió un gesto, en el reloj de `performance.now()`.
 *
 * `at` viene en milisegundos Unix del reloj del navegador (el portal y Daino
 * corren en el mismo equipo). Es una pista: si queda en el futuro o más de un par
 * de segundos atrás, vale la hora de llegada.
 *
 * @param {unknown} at
 * @param {number} [nowUnixMs]
 * @param {number} [nowPerfMs]
 */
export function gestureTimeStamp(at, nowUnixMs = Date.now(), nowPerfMs = performance.now()) {
    if (typeof at !== 'number' || !Number.isFinite(at)) return nowPerfMs;
    const age = nowUnixMs - at;
    return age >= 0 && age <= MAX_GESTURE_AGE_MS ? nowPerfMs - age : nowPerfMs;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function handleMessage(event) {
    const data = event.data;
    if (!allowedOrigin || event.origin !== allowedOrigin || event.source !== window.parent) {
        // Con la depuración encendida, lo que tiene pinta de ser de Vout y llega de
        // otro sitio se apunta: un origen mal configurado se ve aquí y no hay que
        // adivinarlo.
        if (trace !== null && typeof data?.type === 'string' && data.type.startsWith('VOUT_')) {
            const why = event.origin !== allowedOrigin
                ? `descartado: viene de ${event.origin} y se espera ${allowedOrigin}`
                : 'descartado: no lo envía la ventana que contiene a Daino';
            record('in', data.type, {}, why, null);
        }
        return;
    }
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

    const outcome = dispatch(data);
    if (trace !== null) {
        const lagMs = typeof data.at === 'number' && Number.isFinite(data.at) ? Date.now() - data.at : null;
        record('in', data.type, data, outcome, lagMs);
    }
}

/**
 * Atiende un mensaje del portal.
 *
 * @returns {string | null}  Qué se hizo con él, en una línea (para la depuración).
 */
function dispatch(data) {
    switch (data.type) {
        case 'VOUT_AUTH': {
            if (typeof data.token !== 'string' || data.token.length === 0) return 'descartado: no trae token';
            const first = auth === null;
            auth = {
                token: data.token,
                expiresAt: Number.isFinite(data.expiresAt) && data.expiresAt > 0 ? data.expiresAt : 0,
                voutId: typeof data.voutId === 'string' ? data.voutId : null,
                username: typeof data.username === 'string' ? data.username : null,
            };
            stopAnnouncing();
            if (data.debug === true) startTrace();
            if (first) console.info('[bridge] identidad recibida del portal');
            for (const fn of authListeners) {
                try { fn(auth); } catch (err) { console.error('[bridge] listener VOUT_AUTH:', err); }
            }
            return first ? 'identidad recibida: se valida el token en el servidor' : 'token renovado';
        }
        case 'VOUT_SESSION_END': {
            const reason = SESSION_END_REASONS.has(data.reason) ? data.reason : 'unknown';
            auth = null;
            for (const fn of sessionEndListeners) {
                try { fn(reason); } catch (err) { console.error('[bridge] listener VOUT_SESSION_END:', err); }
            }
            return 'se suelta la identidad';
        }
        case 'VOUT_KEY': {
            const { code, key, state } = data;
            if (!isName(code) || typeof key !== 'string' || (state !== 'down' && state !== 'up')) return 'descartado: tecla mal formada';
            return deliver({ kind: 'key', code, key, state, timeStamp: gestureTimeStamp(data.at) });
        }
        case 'VOUT_POINTER': {
            const { button, state } = data;
            if ((button !== 'left' && button !== 'right') || (state !== 'down' && state !== 'up')) return 'descartado: botón mal formado';
            return deliver({ kind: 'pointer', button, state, timeStamp: gestureTimeStamp(data.at) });
        }
        case 'VOUT_CURSOR': {
            if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return 'descartado: cursor sin coordenadas';
            return deliver({ kind: 'cursor', x: clamp01(data.x), y: clamp01(data.y) });
        }
        case 'VOUT_ACTION':
        case 'VOUT_ACTION_END': {
            if (!isName(data.event)) return 'descartado: acción sin nombre';
            return deliver({
                kind: 'action',
                event: data.event,
                phase: data.type === 'VOUT_ACTION' ? 'start' : 'end',
                timeStamp: gestureTimeStamp(data.at),
            });
        }
        default:
            // Cualquier tipo que Vout añada: se ignora sin romper nada.
            return 'ignorado: Daino no conoce este mensaje';
    }
}

function isName(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

/** @param {PortalInput} input */
function deliver(input) {
    if (portalInput === null) return 'sin atender: el juego todavía está arrancando';
    try {
        return portalInput(input) ?? null;
    } catch (err) {
        console.error('[bridge] al atender', input.kind, err);
        return 'error al atenderlo (ver la consola)';
    }
}

/** `READY` ahora y cada medio segundo hasta el primer `VOUT_AUTH`. */
function announceReady() {
    const started = Date.now();
    const send = () => {
        const message = { type: 'READY', suggestedPreset: SUGGESTED_PRESET };
        window.parent.postMessage(message, allowedOrigin);
        readySent++;
        if (trace !== null) record('out', 'READY', message, null, null);
    };
    send();
    readyTimer = setInterval(() => {
        if (auth !== null || Date.now() - started >= READY_GIVE_UP_MS) {
            stopAnnouncing();
            return;
        }
        send();
    }, READY_EVERY_MS);
}

function stopAnnouncing() {
    if (readyTimer !== null) {
        clearInterval(readyTimer);
        readyTimer = null;
    }
}

/**
 * @param {{ debug?: boolean }} [opts]  `debug`: apunta cada mensaje (`getTrace`).
 */
export function startBridge({ debug = false } = {}) {
    if (!isInIframe()) {
        // Modo standalone: el access_token llega via fetch a /api/me/token.
        return { embedded: false };
    }
    allowedOrigin = readAllowedOriginFromMeta();
    if (!allowedOrigin) {
        console.warn('[bridge] meta daino:vout-origin ausente o inválido — bridge NO arranca');
        return { embedded: false };
    }

    isEmbedded = true;
    if (debug) startTrace();
    window.addEventListener('message', handleMessage);
    announceReady();

    return { embedded: true };
}

/**
 * Suscribe a cada `VOUT_AUTH` recibido (el primero y las renovaciones). Si ya
 * había uno al suscribirse, se entrega en la siguiente microtarea para que
 * nadie tenga que sondear. Devuelve la función para desuscribirse.
 *
 * @param {(auth: BridgeAuth) => void} fn
 * @returns {() => void}
 */
export function onAuth(fn) {
    authListeners.add(fn);
    if (auth !== null) {
        const current = auth;
        queueMicrotask(() => { if (authListeners.has(fn)) fn(current); });
    }
    return () => authListeners.delete(fn);
}

/**
 * Suscribe a `VOUT_SESSION_END`: el portal intentó renovar y ya no puede (se cerró
 * la sesión de Vout, se retiró el acceso a Daino o el juego dejó de estar en el
 * portal). El aviso puede llegar bastante después de que ocurra: el portal se
 * entera al renovar.
 *
 * @param {(reason: 'signed_out' | 'revoked' | 'unavailable' | 'unknown') => void} fn
 * @returns {() => void}
 */
export function onSessionEnd(fn) {
    sessionEndListeners.add(fn);
    return () => sessionEndListeners.delete(fn);
}

/** Indica si el bridge corre en modo embebido (postMessage activo). */
export function isBridgeEmbedded() {
    return isEmbedded;
}

/**
 * Envía un mensaje al portal (p. ej. `{ type: 'EXIT' }`), siempre a su origen y
 * nunca a "*". Fuera del portal no hace nada y devuelve false.
 *
 * @param {{ type: string }} message
 * @returns {boolean}
 */
export function postToParent(message) {
    if (!isEmbedded || !allowedOrigin) return false;
    window.parent.postMessage(message, allowedOrigin);
    if (trace !== null) record('out', message.type, message, null, null);
    return true;
}

/**
 * Registra quién atiende el control facial (iframe/remote.js). Devuelve, si
 * quiere, una línea con lo que hizo: es lo que enseña la depuración.
 *
 * @param {((input: PortalInput) => string | null | void) | null} fn
 */
export function setPortalInput(fn) {
    portalInput = typeof fn === 'function' ? fn : null;
}

// --------------------------- Depuración ---------------------------

/**
 * ¿Se pidió la depuración desde Daino? `?voutdebug=1` en la dirección del juego la
 * enciende y queda recordada en este navegador (el portal carga Daino sin
 * parámetros); `?voutdebug=0` la apaga. Es el camino local. El normal es el del
 * portal: `/play/daino?voutdebug=1` hace que `VOUT_AUTH` traiga `debug: true`.
 *
 * @param {string} [search]
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 */
export function readDebugFlag(search = window.location.search, storage = safeStorage()) {
    const param = new URLSearchParams(search).get(DEBUG_PARAM);
    try {
        if (param === '1') {
            storage?.setItem(DEBUG_KEY, '1');
            return true;
        }
        if (param === '0') {
            storage?.removeItem(DEBUG_KEY);
            return false;
        }
        return storage?.getItem(DEBUG_KEY) === '1';
    } catch {
        return param === '1';
    }
}

function safeStorage() {
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Enciende la depuración (una vez) y avisa a quien la enseña. */
function startTrace() {
    if (trace !== null) return;
    trace = { entries: [], counts: {}, listeners: new Set() };
    for (const fn of traceStartListeners) {
        try { fn(); } catch (err) { console.error('[bridge] depuración:', err); }
    }
}

/**
 * Avisa cuando la depuración se enciende: al arrancar (`startBridge({ debug })`)
 * o más tarde, si el portal la pide en `VOUT_AUTH`. Si ya lo está, avisa ahora.
 *
 * @param {() => void} fn
 */
export function onTraceStart(fn) {
    traceStartListeners.add(fn);
    if (trace !== null) fn();
}

/**
 * Lo apuntado hasta ahora y cómo enterarse de lo siguiente. null con la
 * depuración apagada.
 */
export function getTrace() {
    if (trace === null) return null;
    const live = trace;
    return {
        entries: live.entries,
        counts: live.counts,
        readySent: () => readySent,
        /** @param {(entry: TraceEntry) => void} fn */
        subscribe(fn) {
            live.listeners.add(fn);
            return () => live.listeners.delete(fn);
        },
    };
}

/**
 * Apunta en la depuración algo que no es un mensaje (qué contestó el servidor al
 * token, por ejemplo). Sin depuración no hace nada.
 *
 * @param {string} what
 * @param {string} outcome
 */
export function note(what, outcome) {
    if (trace !== null) record('note', what, {}, outcome, null);
}

function record(dir, type, data, outcome, lagMs) {
    trace.counts[type] = (trace.counts[type] ?? 0) + 1;
    // El cursor llega con cada imagen de la cámara: se cuenta, y solo se apunta
    // el primero (para saber que llega).
    if (type === 'VOUT_CURSOR' && trace.counts[type] > 1) return;
    // El token no se apunta nunca: solo cuánto mide.
    const { token, ...rest } = data;
    if (typeof token === 'string') rest.tokenLength = token.length;
    /** @type {TraceEntry} */
    const entry = { at: Date.now(), dir, type, data: rest, outcome, lagMs };
    trace.entries.push(entry);
    if (trace.entries.length > TRACE_LIMIT) trace.entries.shift();
    for (const fn of trace.listeners) {
        try { fn(entry); } catch (err) { console.error('[bridge] depuración:', err); }
    }
}

/** Solo para tests/debug. */
export function _resetForTests() {
    stopAnnouncing();
    auth = null;
    portalInput = null;
    allowedOrigin = null;
    isEmbedded = false;
    readySent = 0;
    trace = null;
    traceStartListeners.clear();
    authListeners.clear();
    sessionEndListeners.clear();
}
