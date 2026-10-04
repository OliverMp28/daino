// Daino dentro del portal de Vout: el protocolo postMessage (guía de integración
// de Vout, "Identidad dentro del iFrame").
//
//   Daino → portal   READY (repetido hasta que contesten), EXIT
//   portal → Daino   VOUT_AUTH (identidad; otra vez en cada renovación),
//                    VOUT_SESSION_END (ya no renovará),
//                    VOUT_KEY, VOUT_POINTER, VOUT_CURSOR, VOUT_ACTION y
//                    VOUT_ACTION_END (lo que el jugador hace con la cara)
//
// Dentro del portal Daino no renueva nada: el portal manda un token nuevo antes
// de que caduque el anterior. La sesión termina cuando el portal lo avisa o, como
// red, cuando llega la hora sin un token nuevo.
//
// Aquí se prueba el protocolo: qué se acepta y a quién se entrega. Lo que Daino
// hace con una tecla, un clic o un gesto está en portal-input.test.mjs.
//
// El tiempo es de mentira (mock.timers): una hora de sesión pasa en un instante.
// El estado es del módulo: los tests van en orden, como una sesión real.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const START = Date.UTC(2026, 9, 4, 12, 0, 0);
mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });

/** Deja correr lo que quedó pendiente tras un mensaje o un temporizador. */
const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};
const nowS = () => Math.floor(Date.now() / 1000);
const HOUR_S = 3600;
const MIN = 60_000;

// --------------------------- Navegador simulado (iframe dentro de Vout) ---------------------------

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

/** Un mensaje que llega al iframe. Por defecto, del portal: su origen y su ventana. */
function receive(data, { origin = VOUT, source = win.parent } = {}) {
    win.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }));
}

// --------------------------- Servidor de Daino de mentira ---------------------------

const ANA = { vout_id: 'u-1', username: 'ana', avatar_url: null };
const BEA = { vout_id: 'u-2', username: 'bea', avatar_url: null };
/** Tokens que el servidor acepta ahora mismo, y de quién son. */
const accepted = new Map();
const calls = [];

globalThis.fetch = async (url, init = {}) => {
    const auth = init.headers?.Authorization ?? null;
    calls.push({ url: String(url), method: init.method ?? 'GET', auth });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const owner = auth === null ? undefined : accepted.get(auth.replace('Bearer ', ''));
    if (url === '/api/me') {
        return owner ? json(200, { user: owner }) : json(401, { error: 'invalid_token', must_refresh: true });
    }
    return owner ? json(200, { ok: true }) : json(401, { error: 'invalid_token', must_refresh: true });
};

const bridge = await import('../../resources/js/iframe/bridge.js');
const client = await import('../../resources/js/api/client.js');

const readies = () => posted.filter((p) => p.msg.type === 'READY').length;
const identityChecks = () => calls.filter((c) => c.url === '/api/me').length;

// --------------------------- El saludo ---------------------------

let init;

test('READY se repite hasta que el portal contesta, y pide el control facial que Daino entiende', () => {
    assert.equal(bridge.startBridge().embedded, true);
    assert.deepEqual(posted, [{ msg: { type: 'READY', suggestedPreset: 'runner' }, origin: VOUT }], 'al origen del portal, nunca a "*"');

    // El portal aún no escuchaba: uno solo se habría perdido ("El juego no responde").
    mock.timers.tick(500);
    assert.equal(readies(), 2);
    mock.timers.tick(1000);
    assert.equal(readies(), 4);

    init = client.init();
});

test('solo se escucha al portal: otro origen, otra ventana y los mensajes del contrato viejo no cuentan', async () => {
    const good = { type: 'VOUT_AUTH', token: 't1', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana' };
    accepted.set('t1', ANA);

    receive(good, { origin: 'https://evil.test' });
    receive(good, { source: { postMessage() {} } });          // del origen del portal, pero no de la ventana que nos contiene
    receive({ type: 'AUTH_TOKEN', token: 't1' });              // el nombre de antes: Vout no lo usa
    receive({ type: 'VOUT_AUTH', token: '' });
    receive({ type: 'VOUT_AUTH' });
    receive('VOUT_AUTH');
    receive(null);
    receive({ type: 'VOUT_CURSOR', x: 0.5, y: 0.5 });          // el mando aún no ha arrancado: no rompe nada
    receive({ type: 'ALGO_QUE_VOUT_AÑADA_MAÑANA', data: 1 });
    await settle();

    assert.equal(identityChecks(), 0);
    assert.equal(client.isAuthenticated(), false);
    const before = readies();
    mock.timers.tick(500);
    assert.equal(readies(), before + 1, 'sigue llamando: nadie válido ha contestado');
});

test('VOUT_AUTH identifica a quien juega (validando el token en el servidor) y READY deja de repetirse', async () => {
    // El nombre del mensaje es de adorno: quien manda es el token.
    receive({ type: 'VOUT_AUTH', token: 't1', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'otro-nombre' });
    await settle();
    await init;

    assert.deepEqual(calls.at(-1), { url: '/api/me', method: 'GET', auth: 'Bearer t1' });
    assert.equal(client.getUser()?.username, 'ana', 'la identidad es la del token validado, no la del mensaje');
    assert.deepEqual(events, ['login']);

    const before = readies();
    mock.timers.tick(10_000);
    assert.equal(readies(), before, 'ya no hace falta');
});

// --------------------------- Renovación: la hace el portal ---------------------------

test('el portal renueva antes de que caduque: solo cambia el token, sin volver a preguntar quién es', async () => {
    mock.timers.tick(55 * MIN);
    accepted.set('t2', ANA);
    accepted.delete('t1');
    const checks = identityChecks();

    receive({ type: 'VOUT_AUTH', token: 't2', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana' });
    await settle();

    assert.equal(identityChecks(), checks);
    assert.equal((await client.request('POST', '/api/progress', { body: {} })).ok, true);
    assert.equal(calls.at(-1).auth, 'Bearer t2', 'siempre el último');

    // Pasa la hora del token anterior: no significa nada, ya hay otro.
    mock.timers.tick(10 * MIN);
    await settle();
    assert.equal(identityChecks(), checks);
    assert.equal(client.isAuthenticated(), true);
    assert.deepEqual(events, ['login']);
});

test('embebido nunca se intenta /auth/refresh: dentro del iframe no hay cookie con que renovar', async () => {
    accepted.delete('t2');
    const res = await client.request('POST', '/api/progress', { body: {} });
    accepted.set('t2', ANA);

    assert.equal(res.status, 401);
    assert.equal(calls.some((c) => c.url === '/auth/refresh'), false);
    assert.equal(client.isAuthenticated(), true, 'un 401 suelto no cierra la sesión: se espera al portal');
});

// --------------------------- Control facial ---------------------------

test('control facial: teclas, botón del ratón, cursor y acciones llegan comprobados y con la hora del gesto', () => {
    const got = [];
    bridge.setPortalInput((input) => { got.push(input); return null; });
    const at = Date.now() - 80;       // el portal vio el gesto hace 80 ms

    receive({ type: 'VOUT_KEY', code: 'Space', key: ' ', state: 'down', at });
    receive({ type: 'VOUT_KEY', code: 'Space', key: ' ', state: 'up', at });
    receive({ type: 'VOUT_POINTER', button: 'left', state: 'down', at });
    receive({ type: 'VOUT_POINTER', button: 'left', state: 'up', at });
    receive({ type: 'VOUT_CURSOR', x: 1.4, y: -0.2 });          // fuera de 0-1: se acota
    receive({ type: 'VOUT_ACTION', event: 'JUMP', at });
    receive({ type: 'VOUT_ACTION_END', event: 'JUMP', at });
    receive({ type: 'VOUT_ACTION', event: 'DISPARAR', at });     // el usuario puede mapear un gesto a cualquier nombre: decide el juego

    const shape = got.map(({ timeStamp, ...rest }) => rest);
    assert.deepEqual(shape, [
        { kind: 'key', code: 'Space', key: ' ', state: 'down' },
        { kind: 'key', code: 'Space', key: ' ', state: 'up' },
        { kind: 'pointer', button: 'left', state: 'down' },
        { kind: 'pointer', button: 'left', state: 'up' },
        { kind: 'cursor', x: 1, y: 0 },
        { kind: 'action', event: 'JUMP', phase: 'start' },
        { kind: 'action', event: 'JUMP', phase: 'end' },
        { kind: 'action', event: 'DISPARAR', phase: 'start' },
    ]);
    // La hora es la del gesto, no la de llegada: 80 ms antes, en el reloj de las pulsaciones.
    const age = performance.now() - got[0].timeStamp;
    assert.ok(age >= 80 && age < 130, `el salto se fecha hace ${age.toFixed(0)} ms`);
});

test('control facial: lo mal formado, lo del contrato viejo y lo que no viene del portal se descarta', () => {
    const got = [];
    bridge.setPortalInput((input) => { got.push(input); return null; });

    receive({ type: 'VOUT_KEY', key: ' ', state: 'down' });
    receive({ type: 'VOUT_KEY', code: 'Space', key: ' ', state: 'pressed' });
    receive({ type: 'VOUT_KEY', code: 42, key: ' ', state: 'down' });
    receive({ type: 'VOUT_POINTER', button: 'middle', state: 'down' });
    receive({ type: 'VOUT_POINTER', button: 'left', state: 'click' });
    receive({ type: 'VOUT_POINTER', button: 'left' });
    receive({ type: 'VOUT_CLICK', button: 'left' });               // lo sustituyó VOUT_POINTER: ya no existe
    receive({ type: 'VOUT_CURSOR', x: 'a', y: 0 });
    receive({ type: 'VOUT_ACTION', event: 42 });
    receive({ type: 'VOUT_ACTION' });
    receive({ type: 'VOUT_ACTION', event: 'X'.repeat(200) });
    receive({ type: 'GAME_ACTION', payload: 'JUMP' });           // el contrato viejo
    receive({ type: 'VOUT_ACTION', event: 'JUMP' }, { origin: 'https://evil.test' });
    receive({ type: 'VOUT_KEY', code: 'Space', key: ' ', state: 'down' }, { source: { postMessage() {} } });
    assert.deepEqual(got, []);

    // Un fallo de quien lo atiende no tumba el puente, y sin nadie que atienda no pasa nada.
    bridge.setPortalInput(() => { throw new Error('fallo del juego'); });
    const error = console.error;
    console.error = () => {};
    receive({ type: 'VOUT_ACTION', event: 'JUMP' });
    console.error = error;
    bridge.setPortalInput(null);
    receive({ type: 'VOUT_ACTION', event: 'JUMP' });
});

test('la hora de un gesto es una pista: en el futuro o demasiado vieja, vale la de llegada', () => {
    const now = 1_000_000;
    assert.equal(bridge.gestureTimeStamp(now - 80, now, 5000), 4920);
    assert.equal(bridge.gestureTimeStamp(now, now, 5000), 5000);
    assert.equal(bridge.gestureTimeStamp(now + 40, now, 5000), 5000, 'en el futuro: relojes que no cuadran');
    assert.equal(bridge.gestureTimeStamp(now - 2001, now, 5000), 5000, 'más de un par de segundos atrás');
    assert.equal(bridge.gestureTimeStamp(undefined, now, 5000), 5000);
    assert.equal(bridge.gestureTimeStamp('ayer', now, 5000), 5000);
    assert.equal(bridge.gestureTimeStamp(NaN, now, 5000), 5000);
});

// --------------------------- Cuando el portal deja de renovar ---------------------------

test('llega la hora sin token nuevo: se pregunta al servidor, y si aún lo acepta no se cierra nada', async () => {
    const checks = identityChecks();
    // t2 se entregó hace 10 minutos con una hora de vida; el servidor lo acepta 60 s más.
    mock.timers.tick(50 * MIN + 64_000);
    await settle();
    assert.equal(identityChecks(), checks, 'antes de la hora (más la holgura) no se pregunta nada');

    mock.timers.tick(1_000);
    await settle();
    assert.equal(identityChecks(), checks + 1);
    assert.equal(calls.at(-1).auth, 'Bearer t2');
    assert.equal(client.isAuthenticated(), true, 'reloj de este equipo adelantado: el servidor tiene la hora buena');
    assert.deepEqual(events, ['login']);
});

test('…y cuando el servidor dice que caducó, la sesión termina: anónimo y con aviso', async () => {
    accepted.delete('t2');          // cerró sesión en Vout o retiró el acceso a Daino: no hubo renovación
    mock.timers.tick(MIN);
    await settle();

    assert.equal(client.isAuthenticated(), false);
    assert.deepEqual(events, ['login', 'logout', 'expired']);
    assert.equal(client.takeSessionLost(), true, 'la interfaz lo dice…');
    assert.equal(client.takeSessionLost(), false, '…una vez');

    const checks = identityChecks();
    mock.timers.tick(30 * MIN);
    await settle();
    assert.equal(identityChecks(), checks, 'terminada la sesión no se sigue preguntando');
    assert.equal(calls.some((c) => c.url === '/auth/refresh'), false);
});

test('un VOUT_AUTH posterior vuelve a identificar (el portal recuperó la sesión)', async () => {
    accepted.set('t3', ANA);
    receive({ type: 'VOUT_AUTH', token: 't3', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana' });
    await settle();

    assert.equal(client.getUser()?.username, 'ana');
    assert.deepEqual(events.slice(-1), ['login']);
});

test('otra cuenta de Vout con el juego abierto: no se queda la identidad de la anterior', async () => {
    events.length = 0;
    accepted.set('t4', BEA);
    receive({ type: 'VOUT_AUTH', token: 't4', expiresAt: nowS() + HOUR_S, voutId: 'u-2', username: 'bea' });
    await settle();

    assert.equal(client.getUser()?.username, 'bea', 'antes: seguía siendo "ana" con el token de otra persona');
    assert.deepEqual(events, ['logout', 'login'], 'lo que se enseñaba de la anterior (sus niveles) se suelta');
});

// --------------------------- Cuando el portal avisa de que la sesión terminó ---------------------------

test('VOUT_SESSION_END: la identidad se suelta en el momento, sin esperar a que caduque el token', async () => {
    events.length = 0;
    const checks = identityChecks();

    receive({ type: 'VOUT_SESSION_END', reason: 'revoked' }, { origin: 'https://evil.test' });
    assert.equal(client.isAuthenticated(), true, 'solo el portal puede cerrar la sesión');

    receive({ type: 'VOUT_SESSION_END', reason: 'revoked' });
    await settle();
    assert.equal(client.isAuthenticated(), false);
    assert.deepEqual(events, ['logout', 'expired']);
    assert.equal(client.takeSessionLost(), true, 'se avisa a quien estaba identificado');

    // El token que quedaba ya no se usa ni se vigila: su hora llega y no se pregunta nada.
    const res = await client.request('POST', '/api/progress', { body: {} });
    assert.equal(calls.at(-1).auth, null);
    assert.equal(res.status, 401);
    mock.timers.tick(2 * HOUR_S * 1000);
    await settle();
    assert.equal(identityChecks(), checks);
    assert.deepEqual(events, ['logout', 'expired']);
});

test('VOUT_SESSION_END sin sesión no avisa de nada, y un motivo desconocido también la cierra', async () => {
    events.length = 0;
    receive({ type: 'VOUT_SESSION_END', reason: 'signed_out' });
    await settle();
    assert.deepEqual(events, [], 'a quien no estaba identificado no se le acaba nada');
    assert.equal(client.takeSessionLost(), false);

    accepted.set('t5', ANA);
    receive({ type: 'VOUT_AUTH', token: 't5', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana' });
    await settle();
    assert.equal(client.getUser()?.username, 'ana', 'tras el aviso, un VOUT_AUTH vuelve a identificar');

    receive({ type: 'VOUT_SESSION_END', reason: 'algo-que-vout-añada' });
    await settle();
    assert.equal(client.isAuthenticated(), false);
    assert.equal(client.takeSessionLost(), true);
});

// --------------------------- Depuración pedida desde el portal ---------------------------

test('VOUT_AUTH con debug: true enciende la depuración, y lo apuntado no lleva el token', async () => {
    let started = 0;
    bridge.onTraceStart(() => { started++; });
    assert.equal(bridge.getTrace(), null, 'apagada mientras nadie la pida');

    accepted.set('t6-secreto', ANA);
    receive({ type: 'VOUT_AUTH', token: 't6-secreto', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana', debug: 'sí' });
    assert.equal(bridge.getTrace(), null, 'solo con debug === true');
    receive({ type: 'VOUT_AUTH', token: 't6-secreto', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana', debug: true });
    receive({ type: 'VOUT_AUTH', token: 't6-secreto', expiresAt: nowS() + HOUR_S, voutId: 'u-1', username: 'ana', debug: true });
    await settle();

    assert.equal(started, 1, 'se enciende una vez');
    const trace = bridge.getTrace();
    receive({ type: 'VOUT_KEY', code: 'Space', key: ' ', state: 'down', at: Date.now() - 80 });
    assert.deepEqual(trace.entries.filter((e) => e.dir === 'in').map((e) => e.type), ['VOUT_AUTH', 'VOUT_AUTH', 'VOUT_KEY']);
    assert.equal(JSON.stringify(trace.entries).includes('t6-secreto'), false, 'el token no se apunta nunca');
    assert.equal(trace.entries[0].data.tokenLength, 10);
    const lag = trace.entries.at(-1).lagMs;
    assert.ok(lag >= 80 && lag < 130, 'y cada gesto lleva cuánto tardó en llegar');

    // Quien se apunta después de encendida se entera al momento.
    let late = 0;
    bridge.onTraceStart(() => { late++; });
    assert.equal(late, 1);
});

// --------------------------- Salir ---------------------------

test('EXIT va al origen del portal, y fuera del portal no se envía nada', () => {
    assert.equal(bridge.postToParent({ type: 'EXIT' }), true);
    assert.deepEqual(posted.at(-1), { msg: { type: 'EXIT' }, origin: VOUT });

    bridge._resetForTests();
    const n = posted.length;
    assert.equal(bridge.postToParent({ type: 'EXIT' }), false);
    assert.equal(posted.length, n);
});
