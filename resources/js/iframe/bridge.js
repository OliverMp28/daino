// resources/js/iframe/bridge.js
//
// Puente postMessage entre Daino (en iframe) y el portal Vout (parent).
// Stub del Bloque 3: handshake READY/AUTH_TOKEN funcional, recepción de
// GAME_ACTION solo loguea (el wiring real con el motor del juego ocurre en
// Bloque 5, cuando exista una API de input que reciba acciones).
//
// Restricciones (CLAUDE.md invariantes):
//   - Validar event.origin contra una allowlist explícita. NUNCA "*".
//   - Tokens NUNCA en localStorage / sessionStorage / URL params.
//   - El access_token vive solo en memoria del módulo (variable JS local).
//
// La allowlist del origen Vout llega por <meta name="daino:vout-origin"> que
// el shell HTML del Bloque 4 inyectará desde Env::string('VOUT_ORIGIN'). Si
// el meta no está, el bridge NO arranca (modo standalone).

const META_VOUT_ORIGIN = 'daino:vout-origin';

let accessToken = null;       // se hidrata desde AUTH_TOKEN; vive solo aquí
let onGameAction = null;      // setter público (Bloque 5 lo conectará al motor)
const tokenListeners = new Set();
let allowedOrigin = null;
let isEmbedded = false;

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

function handleMessage(event) {
    if (!allowedOrigin || event.origin !== allowedOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
        case 'AUTH_TOKEN': {
            if (typeof data.token === 'string' && data.token.length > 0) {
                accessToken = data.token;
                console.info('[bridge] AUTH_TOKEN recibido');
                // Vout reenvía AUTH_TOKEN al renovar el access token: cada
                // entrega se notifica, no solo la primera.
                for (const fn of tokenListeners) {
                    try { fn(accessToken); } catch (err) { console.error('[bridge] listener AUTH_TOKEN:', err); }
                }
            }
            return;
        }
        case 'GAME_ACTION': {
            // Stub: solo log. Bloque 5 reemplaza onGameAction con el handler real.
            const payload = typeof data.payload === 'string' ? data.payload : null;
            console.info('[bridge] GAME_ACTION:', payload);
            if (typeof onGameAction === 'function' && payload !== null) {
                onGameAction(payload);
            }
            return;
        }
        default:
            // Mensajes desconocidos se ignoran silenciosamente.
            return;
    }
}

export function startBridge() {
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
    window.addEventListener('message', handleMessage);

    // Avisamos al parent que el iframe está listo. El parent debe responder
    // con AUTH_TOKEN. NUNCA usar "*" como targetOrigin.
    window.parent.postMessage({ type: 'READY' }, allowedOrigin);

    return { embedded: true };
}

/** Devuelve el access_token recibido, o null si aún no llegó. */
export function getAccessToken() {
    return accessToken;
}

/**
 * Suscribe a cada AUTH_TOKEN recibido (el primero y las renovaciones). Si ya
 * había token al suscribirse, se entrega en la siguiente microtarea para que
 * nadie tenga que sondear. Devuelve la función para desuscribirse.
 *
 * @param {(token: string) => void} fn
 * @returns {() => void}
 */
export function onAuthToken(fn) {
    tokenListeners.add(fn);
    if (accessToken !== null) {
        const current = accessToken;
        queueMicrotask(() => { if (tokenListeners.has(fn)) fn(current); });
    }
    return () => tokenListeners.delete(fn);
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
    return true;
}

/**
 * Registra el handler que recibirá las acciones de juego (`JUMP`, `DUCK`, etc.).
 * Bloque 5 conectará esto al sistema de input del motor.
 */
export function setOnGameAction(fn) {
    onGameAction = typeof fn === 'function' ? fn : null;
}

/** Solo para tests/debug. */
export function _resetForTests() {
    accessToken = null;
    onGameAction = null;
    allowedOrigin = null;
    isEmbedded = false;
    tokenListeners.clear();
}
