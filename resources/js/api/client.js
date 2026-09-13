// API client — wrapper sobre fetch con manejo de Bearer + refresh + bridge.
//
// Responsabilidades:
//   - Hidratar identidad al boot: standalone → GET /api/me/token; iframe →
//     escucha AUTH_TOKEN del bridge.
//   - Inyectar Authorization Bearer y X-CSRF-Token en cada request salvo GET.
//   - Refresh transparente en 401: reintenta UNA vez tras POST /auth/refresh.
//     Si el refresh también falla → redirige a /auth/login (sesión muerta).
//   - Notificar cambios de identidad vía eventos `daino:auth:login` /
//     `daino:auth:logout` en window — ui/auth.js los escucha.
//
// Restricciones (CLAUDE.md invariantes):
//   - El access_token vive SOLO en la variable de módulo. Nunca localStorage.
//   - El csrf_token también — viene en el mismo response que el access_token.
//   - postMessage targetOrigin nunca "*" — eso lo cubre bridge.js, no aquí.

import { isBridgeEmbedded, onAuthToken as onBridgeToken } from '../iframe/bridge.js';

/** Espera máxima al primer AUTH_TOKEN antes de dejar arrancar la UI en anónimo. */
const BRIDGE_TOKEN_WAIT_MS = 5000;

let accessToken = null;
let csrfToken = null;
let expiresAt = 0;
let user = null;
let initialized = false;
let initPromise = null;
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

function setAuth({ access, csrf, exp, userPayload }) {
    const wasLoggedIn = user !== null;
    accessToken = access;
    csrfToken = csrf;
    expiresAt = exp;
    user = userPayload;
    if (wasLoggedIn !== (user !== null)) {
        emitAuthChange(user !== null ? 'login' : 'logout');
    } else if (user !== null) {
        emitAuthChange('token-refreshed');
    }
}

function clearAuth() {
    if (user === null) return;
    accessToken = null;
    csrfToken = null;
    expiresAt = 0;
    user = null;
    emitAuthChange('logout');
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
                if (r.ok) {
                    const data = await r.json();
                    setAuth({
                        access: data.access_token,
                        csrf: data.csrf_token,
                        exp: data.expires_at,
                        userPayload: data.user ?? null,
                    });
                } else {
                    // 401 = anónimo, no error. csrfToken puede venir aún.
                    try {
                        const data = await r.json();
                        if (data.csrf_token) csrfToken = data.csrf_token;
                    } catch { /* sin body, OK */ }
                }
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
        setAuth({ access: token, csrf: csrfToken, exp: 0, userPayload: res.data.user });
    } else {
        // Token rechazado (caducado, otra audiencia, usuario borrado): se sigue
        // jugando en anónimo hasta que Vout envíe uno válido.
        console.warn('[client] el token de Vout no se aceptó:', res.status, res.data?.error);
        accessToken = null;
    }
}

/**
 * Request HTTP con auth + retry transparente en 401. Path debe empezar con `/`.
 *
 * @param {string} method
 * @param {string} path
 * @param {{ body?: object, headers?: object }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function request(method, path, opts = {}) {
    const res = await doRequest(method, path, opts);
    // Embebido no hay cookie de refresco (SameSite): el token nuevo lo manda
    // Vout por postMessage. Intentar /auth/refresh fallaría y cerraría la sesión.
    if (res.status === 401 && res.data?.must_refresh && !opts._retried && !isBridgeEmbedded()) {
        const refreshed = await tryRefresh();
        if (refreshed) {
            return request(method, path, { ...opts, _retried: true });
        }
        // Refresh falló → si Vout dijo invalid_grant, redirigir.
        if (res.data?.redirect_to) {
            window.location.href = res.data.redirect_to;
        }
    }
    return res;
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

/** Llama POST /auth/refresh. Si OK, actualiza tokens y devuelve true. */
async function tryRefresh() {
    if (csrfToken === null) return false;
    try {
        const r = await fetch('/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': csrfToken, 'Accept': 'application/json' },
        });
        if (!r.ok) {
            // Si Vout dijo invalid_grant, el server destruyó la sesión.
            // Limpiamos local + invitamos a re-loguear.
            try {
                const data = await r.json();
                if (data.redirect_to) {
                    clearAuth();
                    window.location.href = data.redirect_to;
                    return false;
                }
            } catch { /* sin body */ }
            clearAuth();
            return false;
        }
        const data = await r.json();
        accessToken = data.access_token;
        expiresAt = data.expires_at;
        emitAuthChange('token-refreshed');
        return true;
    } catch (err) {
        console.warn('[client] refresh falló:', err);
        clearAuth();
        return false;
    }
}

/**
 * Upload multipart con Bearer (sin Content-Type explícito — el browser lo
 * setea con el boundary correcto). Same retry-on-401 behavior que `request()`.
 * `formData` debe ser una instancia de FormData.
 *
 * @param {string} path
 * @param {FormData} formData
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function upload(path, formData) {
    const res = await doUpload(path, formData);
    if (res.status === 401 && res.data?.must_refresh && !isBridgeEmbedded()) {
        const refreshed = await tryRefresh();
        if (refreshed) {
            // FormData es reusable según spec — el reintento crea un nuevo
            // Request con la misma instancia. Si en el futuro encontramos
            // un browser que la consume, clonar manualmente.
            return doUpload(path, formData);
        }
        if (res.data?.redirect_to) {
            window.location.href = res.data.redirect_to;
        }
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
    expiresAt = 0;
    accessToken = 'EXPIRED_FOR_DEBUG';
}

// HMR — al recargar este módulo, transferimos el estado al nuevo módulo si
// existe. Si no, limpiamos los handlers para evitar memory leak.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        authChangeHandlers.clear();
    });
}
