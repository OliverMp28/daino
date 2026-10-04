// API client — wrapper sobre fetch con manejo de Bearer + refresh + bridge.
//
// Responsabilidades:
//   - Hidratar identidad al boot: standalone → GET /api/me/token; iframe →
//     escucha AUTH_TOKEN del bridge.
//   - Inyectar Authorization Bearer y X-CSRF-Token en cada request salvo GET.
//   - Mantener la sesión viva: el access token de Vout vale 60 minutos y la
//     sesión 30 días. El token se renueva con POST /auth/refresh al arrancar si
//     ya caducó, antes de una petición si está a punto de caducar y, como red,
//     cuando el servidor contesta 401 con `must_refresh`.
//   - Notificar cambios de identidad vía eventos `daino:auth:login` /
//     `daino:auth:logout` en window — ui/auth.js los escucha.
//
// Qué significa cada respuesta de /auth/refresh:
//   - 200: token nuevo.
//   - 401: la sesión se acabó de verdad (Vout ya no la acepta). Se pasa a
//     anónimo y se avisa (`daino:auth:expired`); nunca se saca a nadie de la
//     página: Daino se juega sin cuenta.
//   - Cualquier otra cosa (503, red caída): Vout no contesta. No se toca nada;
//     la sesión sigue ahí para el siguiente intento.
//
// Restricciones (CLAUDE.md invariantes):
//   - El access_token vive SOLO en la variable de módulo. Nunca localStorage.
//   - El csrf_token también — viene en el mismo response que el access_token.
//   - postMessage targetOrigin nunca "*" — eso lo cubre bridge.js, no aquí.

import { isBridgeEmbedded, onAuthToken as onBridgeToken } from '../iframe/bridge.js';

/** Espera máxima al primer AUTH_TOKEN antes de dejar arrancar la UI en anónimo. */
const BRIDGE_TOKEN_WAIT_MS = 5000;

/**
 * Con menos de esto por delante, el token se renueva ANTES de la petición en
 * vez de esperar al 401. Va a juego con `REUSE_MARGIN_S` de AuthController: por
 * encima de ese margen el servidor devuelve el token que ya tiene.
 */
const REFRESH_MARGIN_MS = 60_000;

let accessToken = null;
let csrfToken = null;
/** Cuándo caduca el access token, en el reloj de ESTE equipo (ms). 0 = no se sabe (embebido). */
let expiresAtMs = 0;
let user = null;
let initialized = false;
let initPromise = null;
/** Renovación en curso: todo el que la necesite espera a la misma. */
let refreshing = null;
/** La sesión se acabó sin que nadie la cerrase. La interfaz lo recoge una vez. */
let sessionLost = false;
const authChangeHandlers = new Set();

function emitAuthChange(kind /* 'login' | 'logout' | 'token-refreshed' */) {
    for (const fn of authChangeHandlers) {
        try { fn({ kind, user }); } catch (err) { console.error('[client] onAuthChange handler:', err); }
    }
    if (kind === 'login') {
        window.dispatchEvent(new CustomEvent('daino:auth:login', { detail: { user } }));
    } else if (kind === 'logout') {
        window.dispatchEvent(new CustomEvent('daino:auth:logout'));
    }
}

function setAuth({ access, csrf, expiresMs, userPayload }) {
    const wasLoggedIn = user !== null;
    accessToken = access;
    csrfToken = csrf;
    expiresAtMs = expiresMs;
    user = userPayload;
    if (wasLoggedIn !== (user !== null)) {
        emitAuthChange(user !== null ? 'login' : 'logout');
    } else if (user !== null) {
        emitAuthChange('token-refreshed');
    }
}

function clearAuth() {
    const wasLoggedIn = user !== null;
    accessToken = null;
    csrfToken = null;
    expiresAtMs = 0;
    user = null;
    if (wasLoggedIn) emitAuthChange('logout');
}

/**
 * Adopta lo que devuelven `/api/me/token` y `/auth/refresh` con un token válido.
 * La caducidad se cuenta con `expires_in` (segundos que le quedan) y el reloj de
 * este equipo: comparar una hora del servidor con la del navegador falla en
 * cuanto uno de los dos va adelantado.
 */
function adoptSession(data) {
    let expiresMs = 0;
    if (typeof data.expires_in === 'number') expiresMs = Date.now() + data.expires_in * 1000;
    else if (typeof data.expires_at === 'number') expiresMs = data.expires_at * 1000;
    setAuth({
        access: data.access_token,
        csrf: data.csrf_token ?? csrfToken,
        expiresMs,
        userPayload: data.user ?? user,
    });
}

async function readJson(response) {
    try { return await response.json(); } catch { return null; }
}

/**
 * Hidrata identidad. Llamar UNA vez al boot. Idempotente: segunda llamada
 * devuelve la promesa de la primera.
 */
export function init() {
    if (initialized) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = (async () => {
        if (isBridgeEmbedded()) {
            // En iframe el AUTH_TOKEN llega por postMessage del parent, en el
            // arranque o más tarde, y otra vez en cada renovación. Cada token
            // se traduce a identidad con GET /api/me (defecto D12: antes el
            // usuario quedaba a null y embebido no existían "Mis niveles" ni el
            // guardado de progreso). `init()` espera al primero hasta 5 s para
            // que la UI arranque ya con sesión si llega a tiempo; uno tardío se
            // procesa igual y emite `daino:auth:login` cuando llegue.
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, BRIDGE_TOKEN_WAIT_MS);
                onBridgeToken((token) => {
                    void adoptBridgeToken(token).finally(() => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
            });
        } else {
            try {
                const r = await fetch('/api/me/token', {
                    method: 'GET',
                    credentials: 'same-origin',
                });
                const data = await readJson(r);
                if (r.ok && data) {
                    adoptSession(data);
                } else if (data?.must_refresh) {
                    // NO es "anónimo": la sesión sigue viva y solo le falta un
                    // token nuevo (el anterior vale 60 min). Antes esto se
                    // trataba como sin sesión, y al volver al día siguiente
                    // había que iniciar sesión otra vez.
                    csrfToken = data.csrf_token ?? null;
                    await refreshSession();
                }
                // Cualquier otro 401 = anónimo, no error.
            } catch (err) {
                // Red caída o backend muerto — no bloquea boot. El user
                // jugará en modo anónimo.
                console.warn('[client] init falló, sigo en modo anónimo:', err);
            }
        }
        initialized = true;
    })();

    return initPromise;
}

/**
 * Adopta un access token entregado por Vout. La primera vez resuelve la
 * identidad; en una renovación solo cambia el token.
 *
 * @param {string} token
 */
async function adoptBridgeToken(token) {
    accessToken = token;
    if (user !== null) {
        emitAuthChange('token-refreshed');
        return;
    }
    const res = await doRequest('GET', '/api/me', {});
    if (accessToken !== token) return;   // llegó otro token mientras tanto
    if (res.ok && res.data?.user) {
        setAuth({ access: token, csrf: csrfToken, expiresMs: 0, userPayload: res.data.user });
    } else {
        // Token rechazado (caducado, otra audiencia, usuario borrado): se sigue
        // jugando en anónimo hasta que Vout envíe uno válido.
        console.warn('[client] el token de Vout no se aceptó:', res.status, res.data?.error);
        accessToken = null;
    }
}

/**
 * Request HTTP con auth. Path debe empezar con `/`. Si el token está a punto de
 * caducar se renueva antes; si aun así el servidor lo rechaza, se renueva y se
 * reintenta UNA vez.
 *
 * @param {string} method
 * @param {string} path
 * @param {{ body?: object, headers?: object }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function request(method, path, opts = {}) {
    await renewIfDue();
    const res = await doRequest(method, path, opts);
    if (wantsRenewal(res) && await refreshSession()) {
        return doRequest(method, path, opts);
    }
    return res;
}

/**
 * ¿Puede este cliente renovar su token? Solo con sesión propia. Embebido no hay
 * cookie de refresco (SameSite): el token nuevo lo manda Vout por postMessage, y
 * pedir /auth/refresh no serviría de nada.
 */
function canRenew() {
    return accessToken !== null && !isBridgeEmbedded();
}

function wantsRenewal(res) {
    return res.status === 401 && res.data?.must_refresh === true && canRenew();
}

/** Renueva el token ANTES de usarlo si ya caducó o le queda menos del margen. */
async function renewIfDue() {
    if (canRenew() && expiresAtMs > 0 && Date.now() >= expiresAtMs - REFRESH_MARGIN_MS) {
        await refreshSession();
    }
}

async function doRequest(method, path, opts) {
    const headers = { 'Accept': 'application/json', ...(opts.headers ?? {}) };
    if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
    if (method !== 'GET' && method !== 'HEAD' && csrfToken !== null) {
        headers['X-CSRF-Token'] = csrfToken;
    }
    const init = {
        method,
        headers,
        credentials: 'same-origin',
    };
    if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
    }
    let r;
    try {
        r = await fetch(path, init);
    } catch (err) {
        return { ok: false, status: 0, data: { error: 'network', detail: String(err) } };
    }
    let data = null;
    const ctype = r.headers.get('Content-Type') ?? '';
    if (ctype.includes('application/json')) {
        try { data = await r.json(); } catch { data = null; }
    }
    return { ok: r.ok, status: r.status, data };
}

/**
 * Pide un access token nuevo. Devuelve true si lo hay.
 *
 * Una sola renovación a la vez: Vout da un refresh token nuevo en cada uso e
 * invalida el anterior, así que dos peticiones simultáneas se pisarían. Las que
 * lleguen mientras tanto esperan a la que está en curso.
 */
function refreshSession() {
    if (refreshing === null) {
        refreshing = doRefresh().finally(() => { refreshing = null; });
    }
    return refreshing;
}

async function doRefresh() {
    if (csrfToken === null) return false;
    let r;
    try {
        r = await fetch('/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': csrfToken, 'Accept': 'application/json' },
        });
    } catch (err) {
        console.warn('[client] no se pudo renovar la sesión (sin red):', err);
        return false;
    }
    const data = await readJson(r);
    if (r.ok && data?.access_token) {
        adoptSession(data);
        return true;
    }
    if (r.status === 401) {
        // Se acabó de verdad: Vout ya no acepta esta sesión (30 días sin
        // entrar, o acceso revocado desde Vout).
        sessionLost = true;
        clearAuth();
        window.dispatchEvent(new CustomEvent('daino:auth:expired'));
    } else {
        // Vout no contesta. La sesión no se toca: valdrá en el próximo intento.
        console.warn('[client] no se pudo renovar la sesión:', r.status, data?.error);
    }
    return false;
}

/**
 * ¿Se acabó la sesión sin que el usuario la cerrase? Devuelve true UNA vez por
 * sesión perdida, para avisar. Puede haber ocurrido antes de que la interfaz
 * exista (al arrancar), por eso además del evento `daino:auth:expired` se puede
 * preguntar.
 */
export function takeSessionLost() {
    const lost = sessionLost;
    sessionLost = false;
    return lost;
}

/**
 * GET de un recurso binario (audio de un nivel) con el Bearer de la sesión si
 * la hay. Devuelve la `Response` tal cual: quien llama lee el cuerpo en streaming.
 * Con sesión, el autor recibe también el audio de su nivel sin publicar (listo
 * para publicar); sin ella, solo lo público.
 *
 * @param {string} path
 * @returns {Promise<Response>}
 */
export async function fetchBinary(path) {
    await renewIfDue();
    const headers = {};
    if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
    return fetch(path, { credentials: 'same-origin', headers });
}

/**
 * Upload multipart con Bearer (sin Content-Type explícito — el browser lo
 * setea con el boundary correcto). Misma renovación del token que `request()`.
 * `formData` debe ser una instancia de FormData.
 *
 * @param {string} path
 * @param {FormData} formData
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function upload(path, formData) {
    await renewIfDue();
    const res = await doUpload(path, formData);
    if (wantsRenewal(res) && await refreshSession()) {
        // FormData es reusable según spec — el reintento crea un nuevo
        // Request con la misma instancia. Si en el futuro encontramos
        // un browser que la consume, clonar manualmente.
        return doUpload(path, formData);
    }
    return res;
}

async function doUpload(path, formData) {
    const headers = { 'Accept': 'application/json' };
    if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
    // Ojo: NO setear `Content-Type: multipart/form-data` manualmente — el
    // browser inyecta el boundary correcto solo cuando lo deja calcular.
    let r;
    try {
        r = await fetch(path, {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: formData,
        });
    } catch (err) {
        return { ok: false, status: 0, data: { error: 'network', detail: String(err) } };
    }
    let data = null;
    const ctype = r.headers.get('Content-Type') ?? '';
    if (ctype.includes('application/json')) {
        try { data = await r.json(); } catch { data = null; }
    }
    return { ok: r.ok, status: r.status, data };
}

/** Devuelve el user hidratado, o null si anónimo. */
export function getUser() {
    return user;
}

/** Token CSRF para forms POST (logout principalmente). */
export function getCsrfToken() {
    return csrfToken;
}

/** Solo para debug: expone el access_token. NO usar en código de producción. */
export function _getAccessTokenForDebug() {
    return accessToken;
}

/** True si hay sesión válida. */
export function isAuthenticated() {
    return user !== null;
}

/**
 * Registra un handler que se llama cada vez que el estado de auth cambia.
 * El handler recibe `{ kind: 'login'|'logout'|'token-refreshed', user }`.
 * Devuelve un disposer.
 */
export function onAuthChange(handler) {
    authChangeHandlers.add(handler);
    return () => authChangeHandlers.delete(handler);
}

/**
 * Logout local + server. Limpia estado + llama POST /auth/logout. Tras
 * resolver, el chip de identidad pasará a "LOGIN".
 */
export async function logout() {
    if (csrfToken === null) {
        // Sin CSRF no podemos hacer logout server-side. Limpiamos local.
        clearAuth();
        return;
    }
    try {
        await fetch('/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': csrfToken },
        });
    } catch (err) {
        console.warn('[client] logout server falló, limpiando local:', err);
    }
    clearAuth();
}

/** Debug-only: marca el access_token como expirado para forzar el path de refresh. */
export function _forceExpireToken() {
    expiresAtMs = 0;
    accessToken = 'EXPIRED_FOR_DEBUG';
}

// HMR — al recargar este módulo, transferimos el estado al nuevo módulo si
// existe. Si no, limpiamos los handlers para evitar memory leak.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        authChangeHandlers.clear();
    });
}
