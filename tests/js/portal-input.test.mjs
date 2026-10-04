// Jugar con la cara dentro del portal de Vout: qué hace Daino con cada gesto.
//
// La primera prueba real (Oct 2026) falló entera: el portal detectaba los gestos
// y Daino no reaccionaba a nada. Cada usuario de Vout trae su mapeo —el de aquella
// prueba: cejas = Espacio mantenido, boca = botón del ratón, cabeza = cursor, ceño
// = Escape— y Daino solo entendía las dos acciones de un preset que el usuario no
// había aceptado. Ahora el portal dice qué tecla, qué botón o qué acción
// corresponde al gesto y Daino lo hace en su página (iframe/remote.js):
//
//   - una tecla llega al juego y a los paneles como la de un teclado;
//   - el botón del ratón se pulsa donde apunta el cursor: jugando, mitad izquierda
//     salta y mitad derecha agacha; en la interfaz, hace clic al soltar;
//   - las acciones JUMP y DUCK saltan y agachan jugando, y en los menús son un
//     mando de dos botones (agacharse = siguiente, saltar = pulsar).
//
// La segunda prueba (con la cámara ya funcionando) dejó tres quejas: no se podía
// quedar agachado, no se podía hacer el salto alto y se notaba retraso. Las dos
// primeras venían de tratar todo gesto como un toque, porque su final llegaba
// 0,6-0,75 s tarde. Vout lo arregló (el final llega en una o dos décimas, y todo
// gesto tiene principio y final), así que:
//
//   - un gesto mantenido es una pulsación mantenida (agachado mientras dure, el
//     propulsor encendido);
//   - el salto alto de un gesto tiene su propia regla, porque un gesto es más
//     lento que un dedo: el salto del nivel hasta arriba y, si el gesto sigue,
//     otro impulso;
//   - un gesto no cuenta dos veces, y nada se queda pulsado.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --------------------------- Navegador simulado ---------------------------

const win = new EventTarget();
win.innerWidth = 1000;
win.innerHeight = 500;
globalThis.window = win;

/** Lo que hay en pantalla: se cambia en cada caso. */
const screen = { dialog: false, focused: null, under: null, control: null };
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
const { createGestureStats } = await import('../../resources/js/ui/voutStats.js');
const { applyInput, bodyState, integrateBody, settlePosture } = await import('../../resources/js/game/systems/physics.js');
const { GESTURE_JUMP, PHYSICS_STEP_S } = await import('../../resources/js/game/config.js');

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
    screen.control = null;
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
        items,
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
        /** El control que hay bajo el cursor: el que diga `screen.control`. */
        controlAt: () => screen.control,
        clickAt: (target, x, y) => { log.push(`click ${Math.round(x)},${Math.round(y)}`); return screen.control; },
    };
    return nav;
}

const at = (ms) => ({ timeStamp: ms });
const key = (code, state, timeStamp = 100) => ({ kind: 'key', code, key: code === 'Space' ? ' ' : code, state, timeStamp });
const action = (event, phase, timeStamp = 100) => ({ kind: 'action', event, phase, timeStamp });
const pointer = (state, timeStamp = 100, button = 'left') => ({ kind: 'pointer', button, state, timeStamp });
const cursor = (x, y = 0.5) => ({ kind: 'cursor', x, y });

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

test('al perder el foco se suelta lo de este equipo; lo del portal lo suelta el portal, salvo que la pestaña se oculte', () => {
    startPlaying();
    Input.press('key:ArrowDown', 'duck', at(1));
    Input.press('action:JUMP', 'jump', { timeStamp: 2, remote: true });
    win.dispatchEvent(new Event('blur'));     // clic en el panel del portal: el iframe pierde el foco
    assert.deepEqual(names(), ['duckStart', 'jump', 'duckEnd'], 'la tecla de verdad se suelta; el gesto sigue');

    doc.hidden = true;                        // la pestaña deja de verse: nada puede quedarse pulsado
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.hidden = false;
    assert.deepEqual(names(), ['duckStart', 'jump', 'duckEnd', 'jumpEnd']);
    assert.equal(Input.release('action:JUMP'), false, 'el final que mande el portal después ya no suelta nada');
    stopPlaying();
});

// --------------------------- Jugando ---------------------------

test('acciones del preset runner: saltar, agacharse y pausar, con la hora del gesto', () => {
    startPlaying();
    const remote = createRemote({ nav: fakeNav(), notify: () => {} });

    assert.match(remote.handle(action('JUMP', 'start', 740)), /salto/);
    assert.deepEqual(heard[0], ['jump', { timeStamp: 740, remote: true }], 'fechado cuando la cámara vio el gesto, no cuando llegó');
    remote.handle(action('DUCK', 'start'));
    remote.handle(action('JUMP', 'end', 900));
    remote.handle(action('DUCK', 'end'));
    remote.handle(action('PAUSE', 'start'));
    remote.handle(action('PAUSE', 'end'));
    assert.deepEqual(names(), ['jump', 'duckStart', 'jumpEnd', 'duckEnd', 'pause']);
    assert.deepEqual(heard[2], ['jumpEnd', { timeStamp: 900, remote: true }], 'el final también lleva su hora');

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

    // Dos gestos seguidos son dos saltos: soltado, el siguiente empieza de cero.
    remote.handle(action('JUMP', 'start'));
    remote.handle(action('JUMP', 'end'));
    assert.deepEqual(names(), ['jump', 'jumpEnd', 'jump', 'jumpEnd']);
    stopPlaying();
});

test('teclas del mapeo del usuario: llegan al juego como las de un teclado, y se mantienen lo que dura el gesto', () => {
    startPlaying();
    const remote = createRemote({ nav: fakeNav(), notify: () => {} });

    assert.equal(remote.handle(key('Space', 'down', 300)), 'la atiende el juego');
    assert.deepEqual(heard[0], ['jump', { timeStamp: 300, remote: true }]);
    remote.handle(key('Space', 'down'));          // la misma tecla, sin haberla soltado
    assert.deepEqual(names(), ['jump']);
    remote.handle(key('Space', 'up', 900));
    assert.deepEqual(heard[1], ['jumpEnd', { timeStamp: 900, remote: true }]);

    remote.handle(key('ArrowDown', 'down'));
    assert.deepEqual(names(), ['jump', 'jumpEnd', 'duckStart'], 'agachado mientras dure el gesto…');
    remote.handle(key('ArrowDown', 'up'));
    remote.handle(key('ArrowDown', 'up'));        // un "soltar" sin su "pulsar" no hace nada
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

test('el botón del ratón se pulsa donde apunta la cabeza: izquierda salta y derecha agacha, mientras dure, como un dedo', () => {
    startPlaying();
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });

    // Sin cursor todavía, el botón no tiene sitio: es "el botón", y jugando es saltar.
    assert.match(remote.handle(pointer('down', 50)), /salto/);
    remote.handle(pointer('up', 60));
    remote.handle(cursor(0.2));
    assert.match(remote.handle(pointer('down')), /izquierda: salto/);
    remote.handle(pointer('up'));
    assert.deepEqual(names(), ['jump', 'jumpEnd', 'jump', 'jumpEnd']);
    assert.deepEqual(heard[0][1], { timeStamp: 50, remote: true });

    // A la derecha: agachado hasta que se suelta (antes, un clic lo levantaba solo).
    heard.length = 0;
    remote.handle(cursor(0.8));
    assert.match(remote.handle(pointer('down')), /derecha: agacharse/);
    remote.handle(pointer('down'));               // sigue pulsado: no es otra pulsación
    remote.handle(cursor(0.1));                   // la cabeza se mueve con el botón abajo: sigue agachado
    assert.deepEqual(names(), ['duckStart']);
    remote.handle(pointer('up'));
    remote.handle(pointer('up'));                 // un "soltar" de más no hace nada
    assert.deepEqual(names(), ['duckStart', 'duckEnd']);

    // El botón derecho no se usa.
    assert.match(remote.handle(pointer('down', 1, 'right')), /ignorado/);
    assert.deepEqual(names(), ['duckStart', 'duckEnd']);
    assert.deepEqual(nav.log, []);
    stopPlaying();
});

test('si el Dino choca con el botón pulsado, soltarlo no pulsa nada del panel de resultados', () => {
    startPlaying();
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });
    remote.handle(cursor(0.2, 0.6));
    remote.handle(pointer('down'));               // saltando…
    screen.dialog = true;                         // …choca: aparece el panel, con "Reintentar" bajo el cursor
    screen.control = nav.items[0];
    remote.handle(pointer('up'));
    assert.deepEqual(names(), ['jump', 'jumpEnd'], 'solo suelta lo del juego');
    assert.deepEqual(nav.log, [], 'y no hace clic en lo que haya aparecido debajo');
    stopPlaying();
});

test('cuando la sesión termina se suelta todo lo que un gesto mantenía: nada se queda pulsado', () => {
    startPlaying();
    const remote = createRemote({ nav: fakeNav(), notify: () => {} });
    remote.handle(action('JUMP', 'start'));
    remote.handle(key('ArrowDown', 'down'));
    remote.handle(cursor(0.2));
    remote.handle(pointer('down'));
    Input.press('key:KeyS', 'duck', at(1));       // una tecla de verdad: no es del portal
    heard.length = 0;

    remote.releaseAll();
    assert.deepEqual(names().sort(), ['duckEnd', 'jumpEnd', 'jumpEnd']);
    // Los finales que lleguen después no hacen nada, y el siguiente gesto empieza de cero.
    heard.length = 0;
    remote.handle(action('JUMP', 'end'));
    remote.handle(key('ArrowDown', 'up'));
    remote.handle(pointer('up'));
    assert.deepEqual(names(), []);
    remote.handle(action('JUMP', 'start'));
    assert.deepEqual(names(), ['jump']);
    remote.handle(action('JUMP', 'end'));
    Input.release('key:KeyS');
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
    // El gesto sigue mantenido: no vuelve a pulsar.
    remote.handle(action('JUMP', 'start'));
    remote.handle(action('JUMP', 'end'));
    assert.match(remote.handle(action('PAUSE', 'start')), /cierra el panel/);
    remote.handle(action('PAUSE', 'end'));

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

test('en la interfaz el clic se hace al soltar el botón, y solo si sigue sobre lo mismo', () => {
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });
    screen.dialog = true;
    screen.under = node('button', 'dialog');
    screen.control = nav.items[0];

    remote.handle(cursor(0.3, 0.4));
    assert.match(remote.handle(pointer('down')), /sobre «Jugar»: el clic, al soltar/);
    assert.deepEqual(nav.log, [], 'pulsar todavía no es hacer clic');
    assert.match(remote.handle(pointer('up')), /clic en «Jugar»/);
    assert.deepEqual(nav.log, ['click 300,200']);

    // Pulsa sobre un botón, la cabeza se va a otro, suelta: no hay clic (como con un ratón).
    nav.log.length = 0;
    remote.handle(pointer('down'));
    screen.control = nav.items[2];
    remote.handle(cursor(0.6, 0.4));
    assert.match(remote.handle(pointer('up')), /clic anulado/);
    assert.deepEqual(nav.log, []);

    // Fuera de cualquier botón (el velo de un panel): el clic también llega, y lo cierra.
    screen.control = null;
    remote.handle(pointer('down'));
    assert.match(remote.handle(pointer('up')), /donde no hay ningún botón/);
    assert.deepEqual(nav.log, ['click 600,200']);

    // Sin cursor: el botón pulsa lo que tiene el foco, al soltar.
    const blind = fakeNav();
    const other = createRemote({ nav: blind, notify: () => {} });
    blind.focused = blind.items[1];
    other.handle(pointer('down'));
    assert.deepEqual(blind.log, []);
    assert.match(other.handle(pointer('up')), /pulsa «Subir»/);
    screen.dialog = false;
    screen.control = null;
    assert.deepEqual(names(), []);
});

test('con un panel encima de la partida, el gesto es del panel y no un salto', () => {
    startPlaying();
    screen.dialog = true;                          // pausa o resultados
    const nav = fakeNav();
    const remote = createRemote({ nav, notify: () => {} });

    remote.handle(cursor(0.3, 0.4));
    remote.handle(pointer('down'));
    remote.handle(pointer('up'));
    remote.handle(action('JUMP', 'start'));
    remote.handle(key('Space', 'down'));
    assert.deepEqual(names(), []);
    assert.deepEqual(nav.log, ['click 300,200', 'first', 'activate Jugar']);
    stopPlaying();
});

// --------------------------- El salto de un gesto ---------------------------

/** Un salto con estas entradas ([segundos, entrada]): altura, tiempo en el aire y su recorrido. */
function jumpArc(inputs) {
    const GROUND = 1000;
    const body = bodyState(GROUND);
    const rest = body.y;
    const heights = [];
    for (let i = 0; i < 400; i++) {
        for (const [t, input] of inputs) if (Math.round(t / PHYSICS_STEP_S) === i) applyInput(body, input);
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        heights.push(rest - body.y);
        if (i > 2 && body.grounded) break;
    }
    return { apex: Math.max(...heights), airS: heights.length * PHYSICS_STEP_S, heights };
}

test('un gesto corto da el salto del nivel; mantenido, el salto alto (un gesto es más lento que un dedo)', () => {
    const tap = jumpArc([[0, 'jump'], [0.05, 'jumpEnd']]);
    const keyHeld = jumpArc([[0, 'jump']]);

    // Un gesto rápido de cejas o de boca dura 0,2-0,4 s y su final llega una o dos décimas
    // después: con la regla del teclado (mantenido desde 0,12 s) TODOS saldrían altos.
    for (const releasedAt of [0.2, 0.3, 0.35]) {
        const quick = jumpArc([[0, 'jumpGesture'], [releasedAt, 'jumpEnd']]);
        assert.equal(quick.apex, tap.apex, `gesto soltado a los ${releasedAt} s: el arco con el que se colocó el nivel`);
        assert.equal(quick.airS, tap.airS);
    }
    const sameWithKey = jumpArc([[0, 'jump'], [0.3, 'jumpEnd']]);
    assert.ok(sameWithKey.apex > tap.apex + 15, 'esa misma duración, con una tecla, ya es un salto alto');

    // Mantenido: llega tan alto como el salto mantenido del teclado, y aterriza algo más tarde.
    const held = jumpArc([[0, 'jumpGesture']]);
    assert.ok(Math.abs(held.apex - keyHeld.apex) <= 4, `alto de gesto ${held.apex.toFixed(0)} frente a ${keyHeld.apex.toFixed(0)} del teclado`);
    assert.ok(held.apex > tap.apex + 25);
    assert.ok(held.airS > keyHeld.airS && held.airS < keyHeld.airS + 0.15, `en el aire ${held.airS.toFixed(2)} s frente a ${keyHeld.airS.toFixed(2)}`);
    // Siempre por encima del salto del nivel: mantener nunca quita margen sobre un obstáculo.
    tap.heights.forEach((h, i) => assert.ok(held.heights[i] >= h - 1e-9, `paso ${i}`));

    // Soltar durante el impulso lo deja a medias; después, ya no cambia nada.
    const half = jumpArc([[0, 'jumpGesture'], [GESTURE_JUMP.afterS + GESTURE_JUMP.boostS / 2, 'jumpEnd']]);
    assert.ok(half.apex > tap.apex && half.apex < held.apex);
    assert.equal(jumpArc([[0, 'jumpGesture'], [0.6, 'jumpEnd']]).apex, held.apex);
});

test('agacharse y el propulsor duran lo que dura el gesto; en antigravedad un gesto invierte como cualquier pulsación', () => {
    const body = bodyState(1000);
    const nothingAbove = () => false;
    const run = (steps) => {
        for (let i = 0; i < steps; i++) {
            integrateBody(body, PHYSICS_STEP_S, 1000);
            settlePosture(body, nothingAbove);
        }
    };
    applyInput(body, 'duckStart');
    run(240);                                      // dos segundos con el gesto mantenido
    assert.equal(body.ducking, true, 'sigue agachado: antes se levantaba solo a los 0,4 s');
    applyInput(body, 'duckEnd');
    run(2);
    assert.equal(body.ducking, false, 'y se levanta al soltar');

    const flyer = bodyState(1000);
    flyer.mode = 'fly';
    applyInput(flyer, 'jumpGesture');
    assert.equal(flyer.flyHeld, 1);
    applyInput(flyer, 'jumpEnd');
    assert.equal(flyer.flyHeld, 0);

    flyer.mode = 'flip';
    flyer.grounded = true;
    assert.equal(applyInput(flyer, 'jumpGesture'), 'flip');
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

// --------------------------- Las medidas de la depuración ---------------------------

test('la depuración mide los gestos: retraso del inicio y del final, cuánto duran y lo que se corta', () => {
    const stats = createGestureStats({ holdThresholdMs: 360 });
    let clock = 10_000;
    /** Un mensaje del portal: el gesto ocurrió en `at` y llegó `lag` ms después. */
    const message = (type, data, gestureAt, lag) => {
        clock = gestureAt + lag;
        stats.add({ at: clock, dir: 'in', type, data: { ...data, at: gestureAt }, outcome: null, lagMs: lag });
    };

    // Cejas = Espacio: tres gestos de 250, 300 y 500 ms; el inicio tarda 80-120 ms y el final 150-170.
    message('VOUT_KEY', { code: 'Space', state: 'down' }, 1000, 80);
    message('VOUT_KEY', { code: 'Space', state: 'up' }, 1250, 150);
    message('VOUT_KEY', { code: 'Space', state: 'down' }, 2000, 120);
    message('VOUT_KEY', { code: 'Space', state: 'up' }, 2300, 170);
    message('VOUT_KEY', { code: 'Space', state: 'down' }, 3000, 100);
    message('VOUT_KEY', { code: 'Space', state: 'up' }, 3500, 160);
    // Boca = botón: uno que se corta solo (final y, 40 ms después, otro inicio) y un final que nadie empezó.
    message('VOUT_POINTER', { button: 'left', state: 'down' }, 4000, 90);
    message('VOUT_POINTER', { button: 'left', state: 'up' }, 4400, 100);
    message('VOUT_POINTER', { button: 'left', state: 'down' }, 4440, 90);
    message('VOUT_POINTER', { button: 'left', state: 'up' }, 4900, 100);
    message('VOUT_POINTER', { button: 'left', state: 'up' }, 5000, 100);
    // Preset runner: dos gestos mantienen JUMP, y uno que sigue sin terminar.
    message('VOUT_ACTION', { event: 'JUMP' }, 6000, 70);
    message('VOUT_ACTION', { event: 'JUMP' }, 6100, 70);
    message('VOUT_ACTION_END', { event: 'JUMP' }, 6400, 60);
    message('VOUT_ACTION', { event: 'DUCK' }, 7000, 70);
    // Lo que no es un gesto no cuenta.
    stats.add({ at: clock, dir: 'in', type: 'VOUT_CURSOR', data: { x: 0.5, y: 0.5 }, outcome: null, lagMs: null });
    stats.add({ at: clock, dir: 'out', type: 'READY', data: {}, outcome: null, lagMs: null });

    const text = stats.lines().join('\n');
    assert.match(text, /VOUT_KEY down: media 100 ms, peor 120 ms \(3 mensajes\)/);
    assert.match(text, /VOUT_KEY up: media 160 ms, peor 170 ms \(3 mensajes\)/);
    assert.match(text, /key:Space: 3 gestos · duración mín 250, mediana 300, máx 500 ms/);
    // En el juego se ven algo más largos (el final tarda más que el inicio): 320, 350 y 560 ms.
    assert.match(text, /key:Space: .* en el juego: mediana 350 ms, 1 de 3 de 360 ms o más/);
    assert.match(text, /duraciones: 250 300 500/);
    assert.match(text, /pointer:left: 1 veces un final y, menos de 150 ms después, otro inicio/);
    assert.match(text, /pointer:left: 1 finales sin inicio/);
    assert.match(text, /action:JUMP: 1 inicios con el gesto ya empezado/);
    assert.match(text, /action:DUCK: sigue mantenido/);
    assert.match(text, /Mapeo usado: teclas y ratón.*\(3 teclas, 2 pulsaciones del botón\) y acciones.*\(3\)/);
    assert.match(stats.brief(), /inicio \d+ ms · final \d+ ms · gesto \d+ ms/);

    assert.match(createGestureStats().lines().join('\n'), /no ha llegado ningún gesto/);
});
