// Jugar con la cara dentro del portal de Vout: qué hace Daino con cada gesto.
//
// La primera prueba real (Oct 2026) falló entera: el portal detectaba los gestos
// y Daino no reaccionaba a nada. Cada usuario de Vout trae su mapeo —el de aquella
// prueba: cejas = Espacio mantenido, boca = clic, cabeza = cursor, ceño = Escape— y
// Daino solo entendía las dos acciones de un preset que el usuario no había
// aceptado. Ahora el portal dice qué tecla, qué clic o qué acción corresponde al
// gesto y Daino lo hace en su página (iframe/remote.js):
//
//   - una tecla llega al juego y a los paneles como la de un teclado;
//   - un clic cae donde apunta el cursor: jugando, mitad izquierda salta y mitad
//     derecha agacha; en la interfaz, pulsa lo que haya debajo;
//   - las acciones JUMP y DUCK saltan y agachan jugando, y en los menús son un
//     mando de dos botones (agacharse = siguiente, saltar = pulsar).
//
// Y dos reglas que salen de cómo llegan los gestos:
//   - un gesto no cuenta dos veces (dos gestos pueden mantener la misma acción, y
//     una tecla que ya está abajo no vuelve a pulsarse);
//   - el "soltar" de un gesto de la cara llega medio segundo tarde: corriendo, un
//     gesto es un toque (el salto del nivel); solo el propulsor atiende a cuánto dura.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------- Navegador simulado ---------------------------

mock.timers.enable({ apis: ['setTimeout'] });

const win = new EventTarget();
win.innerWidth = 1000;
win.innerHeight = 500;
globalThis.window = win;

/** Lo que hay en pantalla: se cambia en cada caso. */
const screen = { dialog: false, focused: null, under: null };
const doc = new EventTarget();
doc.body = new EventTarget();
doc.hidden = false;
doc.querySelector = (selector) => (selector === 'dialog[open]' && screen.dialog ? {} : null);
doc.elementFromPoint = () => screen.under;
Object.defineProperty(doc, 'activeElement', { get: () => screen.focused ?? win });
globalThis.document = doc;

globalThis.KeyboardEvent = class extends Event {
    constructor(type, init = {}) {
        super(type, init);
        this.code = init.code;
        this.key = init.key;
        this.repeat = false;
    }
};
// Lo señalado se refresca "en el siguiente fotograma": aquí, al momento.
globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };

/** Algo de la pantalla: dice dentro de qué está. */
const node = (...inside) => ({ closest: (selector) => (inside.includes(selector) ? {} : null) });
const CANVAS = node('#app');

const { Input } = await import('../../resources/js/game/systems/input.js');
const { createRemote } = await import('../../resources/js/iframe/remote.js');
const { pickInDirection } = await import('../../resources/js/ui/focusNav.js');
const { applyInput, bodyState, integrateBody } = await import('../../resources/js/game/systems/physics.js');
const { PHYSICS_STEP_S } = await import('../../resources/js/game/config.js');

// --------------------------- Una partida de mentira que escucha ---------------------------

const heard = [];
const listeners = {
    jump: (p) => heard.push(['jump', p]),
    jumpEnd: (p) => heard.push(['jumpEnd', p]),
    duckStart: (p) => heard.push(['duckStart', p]),
    duckEnd: (p) => heard.push(['duckEnd', p]),
    pause: () => heard.push(['pause']),
};
function startPlaying() {
    Input.setup();
    for (const [name, fn] of Object.entries(listeners)) Input.on(name, fn);
    screen.dialog = false;
    screen.under = CANVAS;
    heard.length = 0;
}
function stopPlaying() {
    for (const [name, fn] of Object.entries(listeners)) Input.off(name, fn);
    heard.length = 0;
}
const names = () => heard.map(([name]) => name);

/** La interfaz, de mentira: apunta qué se le pide. */
function fakeNav() {
    const log = [];
    const control = (name) => ({ name, removeAttribute() {}, setAttribute() {} });
    const items = ['Jugar', 'Subir', 'Ajustes'].map(control);
    const nav = {
        log,
        focused: null,
        current: () => nav.focused,
        first: () => { log.push('first'); nav.focused = items[0]; return nav.focused; },
        step: (delta) => {
            log.push(`step ${delta}`);
            nav.focused = items[(items.indexOf(nav.focused) + delta + items.length) % items.length];
            return nav.focused;
        },
        move: (dir) => { log.push(`move ${dir}`); nav.focused = items[1]; return nav.focused; },
        pressable: () => true,
        activate: (el) => { log.push(`activate ${el.name}`); },
        adjust: () => false,
        dismiss: () => { log.push('dismiss'); return 'closed'; },
        labelOf: (el) => el.name,
        controlAt: () => null,
        clickAt: (target, x, y) => { log.push(`click ${Math.round(x)},${Math.round(y)}`); return items[2]; },
    };
    return nav;
}

const at = (ms) => ({ timeStamp: ms });
const key = (code, state, timeStamp = 100) => ({ kind: 'key', code, key: code === 'Space' ? ' ' : code, state, timeStamp });
const action = (event, phase, timeStamp = 100) => ({ kind: 'action', event, phase, timeStamp });

// --------------------------- El centro de pulsaciones ---------------------------

test('cada pulsación tiene una fuente: no pulsa dos veces sin soltar, y solo suelta lo que pulsó', () => {
    startPlaying();
    assert.equal(Input.press('key:Space', 'jump', at(1)), true);
    assert.equal(Input.press('key:Space', 'jump', at(2)), false, 'la misma tecla, otra vez abajo: no es otro salto');
    assert.equal(Input.press('touch:1', 'jump', at(3)), true, 'otra fuente sí es otra pulsación (dos dedos)');
    assert.equal(Input.release('key:KeyQ', at(4)), false, 'lo que no estaba pulsado no suelta nada');
    assert.equal(Input.release('key:Space', at(5)), true);
    assert.equal(Input.release('key:Space', at(6)), false);
    Input.release('touch:1', at(7));
    assert.deepEqual(names(), ['jump', 'jump', 'jumpEnd', 'jumpEnd']);
    stopPlaying();
});

test('un clic llega entero, sin su "soltar": se suelta solo', () => {
    startPlaying();
    Input.tap('duck', at(10));
    assert.deepEqual(names(), ['duckStart']);
    mock.timers.tick(90);
    assert.deepEqual(names(), ['duckStart', 'duckEnd']);
    stopPlaying();
});

test('al perder el foco se suelta lo de este equipo; lo que mantiene el portal lo suelta el portal', () => {
    startPlaying();
    Input.press('key:ArrowDown', 'duck', at(1));
    Input.press('action:JUMP', 'jump', { timeStamp: 2, remote: true });
    win.dispatchEvent(new Event('blur'));     // clic en el panel del portal: el iframe pierde el foco
    assert.deepEqual(names(), ['duckStart', 'jump', 'duckEnd'], 'la tecla de verdad se suelta; el gesto sigue');
    assert.equal(Input.release('action:JUMP'), true);
    stopPlaying();
});

// --------------------------- Jugando ---------------------------

test('acciones del preset runner: saltar, agacharse y pausar, con la hora del gesto', () => {
    startPlaying();
    const remote = createRemote({ nav: fakeNav(), notify: () => {} });

    assert.equal(remote.handle(action('JUMP', 'start', 740)), 'salto');
    assert.deepEqual(heard[0], ['jump', { timeStamp: 740, remote: true }], 'fechado cuando la cámara vio el gesto, no cuando llegó');
    remote.handle(action('DUCK', 'start'));
    remote.handle(action('JUMP', 'end'));
    remote.handle(action('DUCK', 'end'));
    remote.handle(action('PAUSE', 'start'));
    assert.deepEqual(names(), ['jump', 'duckStart', 'jumpEnd', 'duckEnd', 'pause']);

    // El usuario puede mapear un gesto a cualquier nombre: lo que Daino no tiene, se descarta.
    heard.length = 0;
    assert.match(remote.handle(action('DISPARAR', 'start')), /ignorado/);
    assert.match(remote.handle(action('jump', 'start')), /ignorado/);
    assert.deepEqual(names(), []);
    stopPlaying();
});

test('un mismo salto no se cuenta dos veces: dos gestos mantienen la acción y termina una vez', () => {
    startPlaying();
    const remote = createRemote({ nav: fakeNav(), notify: () => {} });

    remote.handle(action('JUMP', 'start'));       // cejas
    remote.handle(action('JUMP', 'start'));       // y además la cabeza arriba: sigue siendo el mismo salto
    assert.deepEqual(names(), ['jump']);
    remote.handle(action('JUMP', 'end'));         // el portal avisa una vez, al soltar el último
    remote.handle(action('JUMP', 'end'));         // un fin de más no suelta nada
    assert.deepEqual(names(), ['jump', 'jumpEnd']);

    remote.handle(action('JUMP', 'start'));
    assert.deepEqual(names(), ['jump', 'jumpEnd', 'jump'], 'soltada, la siguiente sí es otro salto');
    remote.handle(action('JUMP', 'end'));
    stopPlaying();
});

test('teclas del mapeo del usuario: llegan al juego como las de un teclado', () => {
    startPlaying();
    const remote = createRemote({ nav: fakeNav(), notify: () => {} });

    assert.equal(remote.handle(key('Space', 'down', 300)), 'la atiende el juego');
    assert.deepEqual(heard[0], ['jump', { timeStamp: 300, remote: true }]);
    remote.handle(key('Space', 'down'));          // la misma tecla, sin haberla soltado
    assert.deepEqual(names(), ['jump']);
    remote.handle(key('Space', 'up', 900));
    assert.deepEqual(heard[1], ['jumpEnd', { timeStamp: 900, remote: true }]);

    remote.handle(key('ArrowDown', 'down'));
    remote.handle(key('ArrowDown', 'up'));
    remote.handle(key('Escape', 'down'));
    assert.deepEqual(names(), ['jump', 'jumpEnd', 'duckStart', 'duckEnd', 'pause']);

    // Una tecla que el juego no usa (el guiño mapeado a la Q) no hace nada, ni mueve la interfaz.
    const nav = fakeNav();
    const other = createRemote({ nav, notify: () => {} });
    heard.length = 0;
    assert.match(other.handle(key('KeyQ', 'down')), /no hace nada/);
    assert.match(other.handle(key('ArrowLeft', 'down')), /no hace nada/);
    assert.deepEqual([names(), nav.log], [[], []]);
    stopPlaying();
});

test('el clic cae donde apunta la cabeza: mitad izquierda salta y mitad derecha agacha, como el táctil', () => {
    startPlaying();
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });
    const click = { kind: 'click', button: 'left', timeStamp: 50 };

    // Sin cursor todavía, el clic no tiene sitio: es "el botón", y jugando es saltar.
    assert.match(remote.handle(click), /salto/);
    remote.handle({ kind: 'cursor', x: 0.2, y: 0.5 });
    assert.match(remote.handle(click), /izquierda: salto/);
    remote.handle({ kind: 'cursor', x: 0.8, y: 0.5 });
    assert.match(remote.handle(click), /derecha: agacharse/);
    assert.deepEqual(names(), ['jump', 'jump', 'duckStart']);
    assert.deepEqual(heard[2][1], { timeStamp: 50, remote: true });
    mock.timers.tick(90);
    assert.deepEqual(names().slice(3).sort(), ['duckEnd', 'jumpEnd', 'jumpEnd']);

    // Sobre un botón (el de pausa del HUD) el clic es del botón, no un salto.
    heard.length = 0;
    screen.under = node('button', '#hud-root');
    assert.match(remote.handle(click), /clic en «Ajustes»/);
    assert.deepEqual([names(), nav.log], [[], ['click 800,250']]);

    assert.match(remote.handle({ kind: 'click', button: 'right', timeStamp: 50 }), /ignorado/);
    assert.deepEqual(names(), []);
    stopPlaying();
});

// --------------------------- En los menús ---------------------------

test('en los menús las dos acciones son un mando: agacharse pasa al siguiente y saltar lo pulsa', () => {
    stopPlaying();                                 // nadie juega: el menú, o un panel
    const nav = fakeNav();
    const said = [];
    const remote = createRemote({ nav, notify: (message) => said.push(message) });

    // Nada señalado todavía: el primer gesto señala, no pulsa (se ve antes de pulsar).
    assert.match(remote.handle(action('JUMP', 'start')), /señala «Jugar»/);
    remote.handle(action('JUMP', 'end'));
    assert.match(remote.handle(action('DUCK', 'start')), /señala «Subir»/);
    remote.handle(action('DUCK', 'end'));
    assert.match(remote.handle(action('JUMP', 'start')), /pulsa «Subir»/);
    // El gesto sigue mantenido (su fin llega medio segundo después): no vuelve a pulsar.
    remote.handle(action('JUMP', 'start'));
    remote.handle(action('JUMP', 'end'));
    assert.match(remote.handle(action('PAUSE', 'start')), /cierra el panel/);

    assert.deepEqual(nav.log, ['first', 'step 1', 'activate Subir', 'dismiss']);
    assert.equal(said.length, 1, 'cómo funciona se explica una vez');
    assert.deepEqual(names(), [], 'y nada de esto es una pulsación del juego');
});

test('en los menús las teclas hacen lo que haría un teclado: flechas, Enter, Espacio, Esc', () => {
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });
    screen.dialog = true;                          // el catálogo abierto

    assert.match(remote.handle(key('ArrowDown', 'down')), /señala «Jugar»|señala «Subir»/);
    assert.match(remote.handle(key('Enter', 'down')), /pulsa/);
    remote.handle(key('Enter', 'up'));
    assert.match(remote.handle(key('Space', 'down')), /pulsa/);
    assert.match(remote.handle(key('Escape', 'down')), /cierra el panel/);
    assert.match(remote.handle(key('KeyQ', 'down')), /nadie usa esta tecla/);
    assert.deepEqual(nav.log, ['move down', 'activate Subir', 'activate Subir', 'dismiss']);

    // Si un panel atiende la tecla (Espacio = Reintentar en los resultados), no se pulsa nada más.
    const taken = (ev) => { if (ev.code === 'Space') ev.preventDefault(); };
    win.addEventListener('keydown', taken);
    nav.log.length = 0;
    assert.equal(remote.handle(key('Space', 'down')), 'la atiende la interfaz');
    assert.deepEqual(nav.log, []);
    win.removeEventListener('keydown', taken);
    screen.dialog = false;
});

test('con un panel encima de la partida, el gesto es del panel y no un salto', () => {
    startPlaying();
    screen.dialog = true;                          // pausa o resultados
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });

    remote.handle({ kind: 'cursor', x: 0.3, y: 0.4 });
    remote.handle({ kind: 'click', button: 'left', timeStamp: 1 });
    remote.handle(action('JUMP', 'start'));
    remote.handle(key('Space', 'down'));
    assert.deepEqual(names(), []);
    assert.deepEqual(nav.log, ['click 300,200', 'first', 'activate Jugar']);
    stopPlaying();
});

// --------------------------- Un gesto es un toque ---------------------------

/** Altura máxima de un salto con estas entradas ([paso, entrada]). */
function apex(inputs) {
    const GROUND = 1000;
    const body = bodyState(GROUND);
    const rest = body.y;
    let top = rest;
    for (let i = 0; i < 400; i++) {
        for (const [step, input] of inputs) if (step === i) applyInput(body, input);
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        top = Math.min(top, body.y);
        if (i > 2 && body.grounded) break;
    }
    return rest - top;
}

test('corriendo, un gesto da el salto del nivel dure lo que dure; mantener una tecla de verdad sí lo alarga', () => {
    const tap = apex([[0, 'jump'], [1, 'jumpEnd']]);
    const held = apex([[0, 'jump']]);
    // El "soltar" de un gesto de la cara llega 0,6-0,75 s después de relajarlo.
    const gesture = apex([[0, 'jumpTap'], [80, 'jumpEnd']]);
    const gestureNeverReleased = apex([[0, 'jumpTap']]);

    assert.ok(held > tap + 20, `mantener sube más (${held.toFixed(0)} frente a ${tap.toFixed(0)})`);
    assert.equal(gesture, tap, 'el gesto: exactamente el arco con el que se colocó el nivel');
    assert.equal(gestureNeverReleased, tap);
});

test('con el propulsor el gesto sí se mantiene: sube hasta que el portal avisa del final', () => {
    const body = bodyState(1000);
    body.mode = 'fly';
    applyInput(body, 'jumpTap');
    assert.equal(body.flyHeld, 1);
    applyInput(body, 'jumpEnd');
    assert.equal(body.flyHeld, 0);

    body.mode = 'flip';
    body.grounded = true;
    assert.equal(applyInput(body, 'jumpTap'), 'flip', 'y en antigravedad invierte, como cualquier pulsación');
});

// --------------------------- Moverse con flechas ---------------------------

test('moverse con flechas: el control más cercano hacia allí, y antes lo que está en la misma fila o columna', () => {
    // El menú: JUGAR y SUBIR anchos, y debajo una fila de tres.
    const rect = (x, y, w, h) => ({ x, y, w, h });
    const play = rect(300, 100, 400, 60);
    const upload = rect(300, 180, 400, 60);
    const ranking = rect(300, 260, 120, 40);
    const profile = rect(440, 260, 120, 40);
    const settings = rect(580, 260, 120, 40);
    const all = [play, upload, ranking, profile, settings];
    const from = (r, dir) => {
        const others = all.filter((o) => o !== r);
        const i = pickInDirection(r, others, dir);
        return i === -1 ? null : others[i];
    };

    assert.equal(from(play, 'down'), upload);
    assert.equal(from(upload, 'down'), profile, 'de los tres de abajo, el que queda justo debajo');
    assert.equal(from(ranking, 'right'), profile);
    assert.equal(from(profile, 'right'), settings);
    assert.equal(from(settings, 'right'), null, 'a la derecha del último no hay nada');
    assert.equal(from(settings, 'up'), upload);
    assert.equal(from(play, 'up'), null);

    // Una rejilla de tarjetas: abajo es la de debajo, no la de al lado de abajo.
    const grid = [rect(0, 0, 200, 150), rect(220, 0, 200, 150), rect(0, 170, 200, 150), rect(220, 170, 200, 150)];
    assert.equal(pickInDirection(grid[1], [grid[0], grid[2], grid[3]], 'down'), 2);
    assert.equal(pickInDirection(grid[2], [grid[0], grid[1], grid[3]], 'right'), 2);
});
