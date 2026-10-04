// La sesión con Vout en el navegador, fuera del portal (pestaña propia).
//
// El access token vale 60 minutos y la sesión 30 días: lo que mantiene la sesión
// viva es pedir un token nuevo a /auth/refresh. Lo que falló jugando: al volver
// al día siguiente el cliente trataba "token caducado" como "sin sesión" y había
// que iniciar sesión otra vez; y con la pestaña abierta más de una hora, las
// marcas dejaban de guardarse sin avisar.
//
// Módulo con estado de navegador (window, fetch), probado contra un servidor de
// mentira. El estado es del módulo: los tests van en orden y cada uno parte de
// donde lo dejó el anterior, como una sesión real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------- Navegador simulado (pestaña propia) ---------------------------

const win = new EventTarget();
win.self = win;
win.top = win;                        // misma ventana ⇒ no embebido
win.location = { href: '' };
globalThis.window = win;
globalThis.document = { querySelector: () => null };

const events = [];
for (const name of ['daino:auth:login', 'daino:auth:logout', 'daino:auth:expired']) {
    win.addEventListener(name, () => events.push(name.replace('daino:auth:', '')));
}

// --------------------------- Servidor de mentira ---------------------------

const USER = { vout_id: 'u-1', username: 'ana', avatar_url: null };

const server = {
    /** 'none' sin sesión · 'expired' sesión viva con el token caducado · 'live'. */
    session: 'none',
    /** El access token que el servidor acepta ahora mismo. */
    token: 't1',
    /** Qué pasa al renovar: 'ok' · 'down' (Vout no contesta) · 'network' · 'gone' (sesión acabada). */
    refresh: 'ok',
    /** Segundos de vida del próximo token que se entregue. */
    expiresIn: 3600,
    issued: 1,
    /** Si no es null, /auth/refresh no contesta hasta que se resuelva. */
    gate: null,
};

const calls = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const session = () => ({ access_token: server.token, expires_in: server.expiresIn, expires_at: 0, csrf_token: 'csrf-1', user: USER });

globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const auth = init.headers?.Authorization ?? null;
    calls.push({ url: String(url), method, auth, csrf: init.headers?.['X-CSRF-Token'] ?? null });

    if (url === '/api/me/token') {
        if (server.session === 'live') return json(200, session());
        if (server.session === 'expired') return json(401, { error: 'token_expired', must_refresh: true, csrf_token: 'csrf-1' });
        return json(401, { error: 'unauthenticated' });
    }
    if (url === '/auth/refresh') {
        if (server.gate !== null) await server.gate;
        if (server.refresh === 'network') throw new TypeError('Failed to fetch');
        if (server.refresh === 'down') return json(503, { error: 'idp_unavailable' });
        if (server.refresh === 'gone') return json(401, { error: 'session_expired' });
        server.token = `t${++server.issued}`;
        return json(200, session());
    }
    if (url === '/api/siempre-401') return json(401, { error: 'invalid_token', must_refresh: true });
    if (auth === `Bearer ${server.token}`) return json(200, { ok: true });
    if (auth !== null) return json(401, { error: 'invalid_token', must_refresh: true });
    return json(401, { error: 'unauthorized' });
};

const client = await import('../../resources/js/api/client.js');

const since = (n) => calls.slice(n).map((c) => `${c.method} ${c.url}`);
const refreshes = (n = 0) => calls.slice(n).filter((c) => c.url === '/auth/refresh').length;

// --------------------------- Volver al día siguiente ---------------------------

test('al arrancar con el token caducado, la sesión se renueva (antes: había que iniciar sesión otra vez)', async () => {
    server.session = 'expired';
    server.expiresIn = 30;            // el token nuevo nace ya cerca de caducar (lo usa el test siguiente)

    await client.init();

    assert.deepEqual(since(0), ['GET /api/me/token', 'POST /auth/refresh'], 'la identidad viene con la renovación: sin más peticiones');
    assert.equal(calls[1].csrf, 'csrf-1', 'con el CSRF que dio /api/me/token');
    assert.equal(client.getUser()?.username, 'ana');
    assert.equal(client.isAuthenticated(), true);
    assert.deepEqual(events, ['login']);
    assert.equal(client.getCsrfToken(), 'csrf-1', 'cerrar sesión sigue pudiéndose');
});

// --------------------------- Con la pestaña abierta más de una hora ---------------------------

test('un token a punto de caducar se renueva ANTES de la petición, no tras un 401', async () => {
    const n = calls.length;
    server.expiresIn = 30;

    const res = await client.request('POST', '/api/progress', { body: { points: 10 } });

    assert.equal(res.ok, true, 'antes: 401 y la marca no se guardaba, sin avisar');
    assert.deepEqual(since(n), ['POST /auth/refresh', 'POST /api/progress']);
    assert.equal(calls.at(-1).auth, `Bearer ${server.token}`, 'la petición ya va con el token nuevo');
});

test('varias peticiones a la vez renuevan una sola vez (el refresh token de Vout es de un solo uso)', async () => {
    const n = calls.length;
    server.expiresIn = 3600;
    let open;
    server.gate = new Promise((resolve) => { open = resolve; });

    const pending = Promise.all([
        client.request('GET', '/api/levels?scope=mine'),
        client.request('POST', '/api/progress', { body: {} }),
        client.fetchBinary('/api/levels/7/file'),
    ]);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(since(n), ['POST /auth/refresh'], 'las tres esperan a la misma renovación');
    open();
    server.gate = null;
    const [a, b, audio] = await pending;

    assert.equal(refreshes(n), 1, 'dos renovaciones a la vez: la segunda llevaría un refresh token ya gastado');
    assert.equal(a.ok && b.ok && audio.ok, true);
    assert.equal(calls.slice(n + 1).every((c) => c.auth === `Bearer ${server.token}`), true);
});

test('con el token recién renovado no se vuelve a renovar en cada petición', async () => {
    const n = calls.length;
    await client.request('GET', '/api/levels?scope=mine');
    await client.upload('/api/levels/7/upload', new FormData());
    assert.equal(refreshes(n), 0);
});

test('si el servidor rechaza el token, se renueva y se reintenta una vez; nunca en bucle', async () => {
    let n = calls.length;
    server.token = 'cambiado-en-el-servidor';   // el del cliente ya no vale, y él no lo sabe

    const res = await client.request('GET', '/api/levels?scope=mine');
    assert.equal(res.ok, true);
    assert.deepEqual(since(n), ['GET /api/levels?scope=mine', 'POST /auth/refresh', 'GET /api/levels?scope=mine']);

    n = calls.length;
    const stuck = await client.request('GET', '/api/siempre-401');
    assert.equal(stuck.status, 401);
    assert.deepEqual(since(n), ['GET /api/siempre-401', 'POST /auth/refresh', 'GET /api/siempre-401']);
    assert.equal(client.isAuthenticated(), true, 'un endpoint que falla no cierra la sesión');
});

// --------------------------- Lo que NO cierra la sesión ---------------------------

test('Vout apagado o sin red: la sesión no se cierra y se recupera sola', async () => {
    events.length = 0;
    for (const failure of ['down', 'network']) {
        server.refresh = failure;
        server.token = `otro-${failure}`;
        const res = await client.request('POST', '/api/progress', { body: {} });
        assert.equal(res.status, 401, failure);
        assert.equal(client.isAuthenticated(), true, `${failure}: antes se cerraba la sesión`);
        assert.equal(client.getUser()?.username, 'ana');
    }
    assert.deepEqual(events, [], 'ni se cierra sesión ni se avisa de nada');
    assert.equal(client.takeSessionLost(), false);

    server.refresh = 'ok';
    assert.equal((await client.request('POST', '/api/progress', { body: {} })).ok, true, 'cuando Vout vuelve, funciona sin hacer nada');
});

// --------------------------- Lo que sí la cierra ---------------------------

test('sesión acabada de verdad: se pasa a anónimo y se avisa, sin sacar a nadie de la página', async () => {
    events.length = 0;
    server.refresh = 'gone';
    server.token = 'revocado';

    const res = await client.request('POST', '/api/progress', { body: {} });

    assert.equal(res.status, 401);
    assert.equal(client.isAuthenticated(), false);
    assert.equal(client.getUser(), null);
    assert.deepEqual(events, ['logout', 'expired']);
    assert.equal(client.takeSessionLost(), true, 'la interfaz lo dice…');
    assert.equal(client.takeSessionLost(), false, '…una vez');
    assert.equal(win.location.href, '', 'antes se redirigía a /auth/login: Daino se juega sin cuenta');

    const n = calls.length;
    await client.request('GET', '/api/levels?scope=mine');
    assert.equal(refreshes(n), 0, 'sin sesión no hay nada que renovar');
});

// --------------------------- Quien nunca inició sesión ---------------------------

test('un visitante sin sesión no pide renovar nada al arrancar', async () => {
    // Otra pestaña: una instancia nueva del módulo.
    const fresh = await import('../../resources/js/api/client.js?visitante');
    server.session = 'none';
    server.refresh = 'ok';
    const n = calls.length;

    await fresh.init();

    assert.deepEqual(since(n), ['GET /api/me/token']);
    assert.equal(fresh.isAuthenticated(), false);
    assert.equal(fresh.takeSessionLost(), false, 'ni aviso de sesión caducada');
});

test('una sesión con el token vigente arranca sin renovar', async () => {
    const fresh = await import('../../resources/js/api/client.js?vigente');
    server.session = 'live';
    server.token = 'vigente';
    server.expiresIn = 1800;
    const n = calls.length;

    await fresh.init();
    await fresh.request('GET', '/api/levels?scope=mine');

    assert.deepEqual(since(n), ['GET /api/me/token', 'GET /api/levels?scope=mine']);
    assert.equal(fresh.getUser()?.username, 'ana');
});
