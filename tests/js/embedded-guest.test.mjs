// Daino dentro del portal de Vout, jugando sin cuenta (VOUT_GUEST).
//
// Con Daino en "cuenta opcional", el portal contesta a READY con VOUT_GUEST cuando
// no tiene identidad que dar: quien juega no ha entrado, no ha confirmado su
// correo o no quiso compartirla. No trae datos del jugador, no hay token ni
// renovaciones ni VOUT_SESSION_END; los gestos llegan igual. Dentro de una misma
// carga no se pasa de invitado a jugador con cuenta (el portal recarga el iframe).
//
// Archivo propio: el estado de bridge.js y client.js es del módulo, y aquí la
// carga empieza como invitado (embedded-bridge.test.mjs empieza con cuenta).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const START = Date.UTC(2026, 10, 25, 12, 0, 0);
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });

const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

const VOUT = 'https://vout.test';
const posted = [];

const win = new EventTarget();
win.self = win;
win.top = {};                         // distinto de self ⇒ embebido
win.parent = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
win.location = { href: '' };
globalThis.window = win;
globalThis.document = {
    querySelector: (sel) => (sel.includes('daino:vout-origin') ? { getAttribute: () => VOUT } : null),
};

const events = [];
for (const name of ['daino:auth:login', 'daino:auth:logout', 'daino:auth:expired']) {
    win.addEventListener(name, () => events.push(name.replace('daino:auth:', '')));
}

function receive(data, { origin = VOUT, source = win.parent } = {}) {
    win.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }));
}

const calls = [];
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null });
    return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
};

const bridge = await import('../../resources/js/iframe/bridge.js');
const client = await import('../../resources/js/api/client.js');

const readies = () => posted.filter((p) => p.msg.type === 'READY').length;

let init;
let initDone = false;
let guestCalls = 0;

test('VOUT_GUEST de otro origen o de otra ventana no cuenta: se sigue llamando', async () => {
    assert.equal(bridge.startBridge().embedded, true);
    bridge.onGuest(() => { guestCalls++; });
    init = client.init().then(() => { initDone = true; });

    receive({ type: 'VOUT_GUEST' }, { origin: 'https://evil.test' });
    receive({ type: 'VOUT_GUEST' }, { source: { postMessage() {} } });
    await settle();

    assert.equal(bridge.isBridgeGuest(), false);
    assert.equal(guestCalls, 0);
    const before = readies();
    mock.timers.tick(500);
    assert.equal(readies(), before + 1);
});

test('VOUT_GUEST: READY deja de repetirse y la interfaz arranca ya, sin esperar un token', async () => {
    receive({ type: 'VOUT_GUEST' });
    await settle();

    assert.equal(bridge.isBridgeGuest(), true);
    assert.equal(guestCalls, 1);
    assert.equal(initDone, true, 'sin los 5 s de espera al primer VOUT_AUTH');
    await init;

    const before = readies();
    mock.timers.tick(10_000);
    assert.equal(readies(), before, 'el portal ya contestó');
});

test('sin cuenta no se pregunta nada al servidor con token, ni se intenta renovar', async () => {
    assert.equal(client.isAuthenticated(), false);
    assert.equal(calls.length, 0, 'ni /api/me ni /auth/refresh');
    assert.deepEqual(events, []);
    assert.equal(client.takeSessionLost(), false, 'a un invitado no se le acaba ninguna sesión');

    const res = await client.request('POST', '/api/progress', { body: {} });
    assert.equal(res.status, 401);
    assert.equal(calls.at(-1).auth, null, 'sin Authorization');
    assert.equal(calls.some((c) => c.url === '/auth/refresh'), false);
});

test('VOUT_GUEST repetido (contesta a cada READY) no avisa dos veces; quien se suscribe tarde se entera', async () => {
    receive({ type: 'VOUT_GUEST' });
    receive({ type: 'VOUT_GUEST' });
    await settle();
    assert.equal(guestCalls, 1);

    let late = 0;
    bridge.onGuest(() => { late++; });
    await settle();
    assert.equal(late, 1);
});

test('los gestos llegan igual al invitado', () => {
    const got = [];
    bridge.setPortalInput((input) => { got.push(input.kind); return null; });
    receive({ type: 'VOUT_ACTION', event: 'JUMP', at: Date.now() });
    receive({ type: 'VOUT_ACTION_END', event: 'JUMP', at: Date.now() });
    receive({ type: 'VOUT_KEY', code: 'Space', key: ' ', state: 'down', at: Date.now() });
    assert.deepEqual(got, ['action', 'action', 'key']);
    bridge.setPortalInput(null);
});

test('VOUT_GUEST con debug: true enciende la depuración', () => {
    assert.equal(bridge.getTrace(), null);
    receive({ type: 'VOUT_GUEST', debug: true });
    const trace = bridge.getTrace();
    assert.notEqual(trace, null);
    assert.equal(trace.entries.at(-1).type, 'VOUT_GUEST');
});
