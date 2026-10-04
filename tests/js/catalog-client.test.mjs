// Ola 2 — cliente del catálogo: identidad embebida en Vout (D12) y caché del
// catálogo por pestañas. Módulos con estado de navegador (window, fetch,
// postMessage), probados con dobles mínimos de esas APIs: Node 22 ya trae
// EventTarget, MessageEvent, CustomEvent, Response y performance.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------- Navegador simulado (iframe dentro de Vout) ---------------------------

const VOUT = 'https://vout.test';
const posted = [];
const calls = [];
let levelPages = {};

const win = new EventTarget();
win.self = win;
win.top = {};                         // distinto de self ⇒ embebido
win.parent = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
win.location = { href: '' };
globalThis.window = win;
globalThis.document = {
    querySelector: (sel) => (sel.includes('daino:vout-origin') ? { getAttribute: () => VOUT } : null),
};

globalThis.fetch = async (url, init = {}) => {
    const auth = init.headers?.Authorization ?? null;
    calls.push({ url: String(url), method: init.method ?? 'GET', auth });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url === '/api/me') {
        if (auth === 'Bearer good') return json(200, { user: { vout_id: 'u-1', username: 'embebida', avatar_url: null } });
        return json(401, { error: 'invalid_token', must_refresh: true });
    }
    if (url === '/api/progress') return json(401, { error: 'expired', must_refresh: true });
    const m = /^\/api\/levels\?scope=(\w+)&limit=(\d+)&offset=(\d+)$/.exec(url);
    if (m) {
        const all = levelPages[m[1]] ?? [];
        const offset = Number(m[3]);
        return json(200, { items: all.slice(offset, offset + Number(m[2])), total: all.length });
    }
    return json(404, { error: 'not_found' });
};

const bridge = await import('../../resources/js/iframe/bridge.js');
const client = await import('../../resources/js/api/client.js');
const catalog = await import('../../resources/js/api/levelsCache.js');

// Un mensaje del portal: de su origen y de la ventana que contiene al juego.
function sendFromParent(data, origin = VOUT) {
    win.dispatchEvent(Object.assign(new Event('message'), { data, origin, source: win.parent }));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// --------------------------- D12: identidad embebida ---------------------------

test('D12: embebido, el VOUT_AUTH de Vout se traduce a usuario con GET /api/me', async () => {
    assert.equal(bridge.startBridge().embedded, true);
    assert.deepEqual(posted[0], { msg: { type: 'READY', suggestedPreset: 'runner' }, origin: VOUT }, 'READY al origen de Vout, nunca "*"');

    let loginEvent = null;
    win.addEventListener('daino:auth:login', (ev) => { loginEvent = ev.detail; }, { once: true });

    const init = client.init();
    sendFromParent({ type: 'VOUT_AUTH', token: 'intruso' }, 'https://evil.test');   // origen ajeno: ignorado
    await tick();
    assert.equal(calls.filter((c) => c.url === '/api/me').length, 0, 'un mensaje de otro origen no hace nada');

    sendFromParent({ type: 'VOUT_AUTH', token: 'good' });
    await init;

    assert.equal(client.getUser()?.username, 'embebida', 'antes quedaba a null y "Míos" no existía embebido');
    assert.equal(client.isAuthenticated(), true);
    assert.deepEqual(calls.find((c) => c.url === '/api/me'), { url: '/api/me', method: 'GET', auth: 'Bearer good' });
    assert.equal(loginEvent?.user?.vout_id, 'u-1');
});

test('D12: una renovación del token no vuelve a pedir identidad y se usa en adelante', async () => {
    const before = calls.filter((c) => c.url === '/api/me').length;
    sendFromParent({ type: 'VOUT_AUTH', token: 'renovado' });
    await tick();
    assert.equal(calls.filter((c) => c.url === '/api/me').length, before);

    await client.request('GET', '/api/levels?scope=mine&limit=1&offset=0');
    assert.equal(calls.at(-1).auth, 'Bearer renovado');
});

test('D12: embebido, un 401 no intenta /auth/refresh (no hay cookie): espera al token de Vout', async () => {
    const res = await client.request('POST', '/api/progress', { body: {} });
    assert.equal(res.status, 401);
    assert.equal(calls.some((c) => c.url === '/auth/refresh'), false);
    assert.equal(client.isAuthenticated(), true, 'la sesión no se cierra por un token caducado');
});

// --------------------------- Caché del catálogo ---------------------------

const level = (id) => ({ id, title: `Nivel ${id}` });

test('catálogo: peticiones simultáneas de la misma pestaña se deduplican y se cachean', async () => {
    levelPages = { public: [level(1), level(2)] };
    catalog.invalidateLevels();
    const n = calls.length;

    const [a, b] = await Promise.all([catalog.getLevels('public'), catalog.getLevels('public')]);
    assert.equal(calls.length - n, 1, 'una sola petición');
    assert.deepEqual(a.data.items.map((l) => l.id), [1, 2]);
    assert.equal(a.data, b.data);

    await catalog.getLevels('public');
    assert.equal(calls.length - n, 1, 'fresco: sin red');
    await catalog.getLevels('public', { force: true });
    assert.equal(calls.length - n, 2, 'force revalida');
    assert.match(calls.at(-1).url, /scope=public&limit=24&offset=0$/, 'oficiales y comunidad en una sola vista');
});

test('catálogo: "cargar más" acumula páginas sin duplicar si se publicó algo entre medias', async () => {
    const many = Array.from({ length: 30 }, (_, i) => level(100 + i));
    levelPages = { public: many };
    catalog.invalidateLevels();

    const first = await catalog.getLevels('public');
    assert.equal(first.data.items.length, 24);
    assert.equal(first.data.total, 30);

    // Se publica uno nuevo al principio: la página 2 empieza un puesto antes.
    levelPages = { public: [level(999), ...many] };
    const more = await catalog.loadMoreLevels('public');
    const ids = more.data.items.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, 'sin repetidos');
    assert.equal(ids.length, 30);
    assert.equal(catalog.peekLevels('public').items.length, 30, 'reabrir conserva lo cargado');
});

test('catálogo: guardar progreso revalida sin vaciar; cambiar de sesión sí vacía', async () => {
    levelPages = { public: [level(1)] };
    catalog.invalidateLevels();
    await catalog.getLevels('public');
    const n = calls.length;

    win.dispatchEvent(new CustomEvent('daino:progress-saved', { detail: { levelId: 1 } }));
    assert.ok(catalog.peekLevels('public') !== null, 'se sigue pudiendo enseñar lo anterior al instante');
    await catalog.getLevels('public');
    assert.equal(calls.length - n, 1, 'pero la siguiente lectura revalida');

    win.dispatchEvent(new CustomEvent('daino:auth:logout'));
    assert.equal(catalog.peekLevels('public'), null, 'nada de la sesión anterior queda visible');
});

test('catálogo: una respuesta que llega tras invalidar no resucita datos viejos', async () => {
    levelPages = { mine: [level(7)] };
    catalog.invalidateLevels();
    const pending = catalog.getLevels('mine');
    catalog.invalidateLevels();          // p. ej. logout mientras cargaba
    await pending;
    assert.equal(catalog.peekLevels('mine'), null);
});

test('catálogo: una pestaña desconocida es un error de programación, no una petición', () => {
    // Las pestañas separadas de oficiales y comunidad ya no existen.
    for (const gone of ['official', 'community']) {
        assert.throws(() => catalog.getLevels(gone), /pestaña desconocida/);
    }
});
