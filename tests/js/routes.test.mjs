// Direcciones (T06): qué pantalla es cada URL, qué se hace con el historial al
// cambiar de pantalla, y el router con un navegador de mentira.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MENU, parsePath, placeChain, placeKey, placeOfKey, placeTitle, planMove, routePath, slugify,
} from '../../resources/js/ui/routeModel.js';
import { createRouter } from '../../resources/js/ui/router.js';
import { shareLink } from '../../resources/js/ui/share.js';

const menu = { route: MENU, playing: false };
const levels = (tab = 'public') => ({ route: { name: 'levels', tab }, playing: false });
const level = (id, title = 'One Day', tab = 'public') => ({ route: { name: 'level', id, title, tab }, playing: false });
const playing = (place) => ({ ...place, playing: true });

// --------------------------- El modelo ---------------------------

test('cada dirección es una pantalla, y lo que no es de Daino no es ninguna', () => {
    assert.deepEqual(parsePath('/'), { name: 'menu' });
    assert.deepEqual(parsePath(''), { name: 'menu' });
    assert.deepEqual(parsePath('/niveles'), { name: 'levels', tab: 'public' });
    assert.deepEqual(parsePath('/niveles/'), { name: 'levels', tab: 'public' });
    assert.deepEqual(parsePath('/niveles/mios'), { name: 'levels', tab: 'mine' });
    assert.deepEqual(parsePath('/niveles/12'), { name: 'level', id: 12 });
    assert.deepEqual(parsePath('/niveles/12-one-day'), { name: 'level', id: 12 });
    assert.deepEqual(parsePath('/niveles/12-cualquier-cosa-que-ponga'), { name: 'level', id: 12 }, 'lo que sigue al número no cuenta');
    for (const bad of ['/otra', '/niveles/abc', '/niveles/0', '/niveles/-3', '/niveles/12/extra', '/niveles/1e3', '/niveles/%E0%A4%A']) {
        assert.equal(parsePath(bad), null, bad);
    }
});

test('el trozo legible de la dirección de un nivel sale de su título', () => {
    assert.equal(slugify("What's Up Danger"), 'what-s-up-danger');
    assert.equal(slugify('Mi Fiesta (Canción Ñoña)'), 'mi-fiesta-cancion-nona');
    assert.equal(slugify('   ---  '), '');
    assert.equal(slugify('夜に駆ける'), '', 'sin letras escribibles la dirección se queda en el número');
    assert.equal(slugify(null), '');
    assert.ok(slugify('a'.repeat(200)).length <= 48);
    assert.ok(!slugify(`${'palabra '.repeat(12)}`).endsWith('-'));

    assert.equal(routePath(MENU), '/');
    assert.equal(routePath({ name: 'levels', tab: 'public' }), '/niveles');
    assert.equal(routePath({ name: 'levels', tab: 'mine' }), '/niveles/mios');
    assert.equal(routePath({ name: 'level', id: 12, title: 'One Day' }), '/niveles/12-one-day');
    assert.equal(routePath({ name: 'level', id: 12, title: '夜に駆ける' }), '/niveles/12');
    assert.equal(routePath({ name: 'level', id: 12 }), '/niveles/12');
});

test('una dirección construida se vuelve a leer como la misma pantalla', () => {
    for (const route of [MENU, { name: 'levels', tab: 'public' }, { name: 'levels', tab: 'mine' }]) {
        assert.deepEqual(parsePath(routePath(route)), route);
    }
    assert.deepEqual(parsePath(routePath({ name: 'level', id: 4506, title: 'One Day' })), { name: 'level', id: 4506 });
    // La clave de una entrada no lleva el título: es la misma con o sin él.
    assert.equal(placeKey(level(12, 'One Day')), placeKey(level(12, null)));
    assert.equal(placeKey(playing(level(12))), '/niveles/12#play');
    assert.deepEqual(placeOfKey('/niveles/12#play'), { route: { name: 'level', id: 12 }, playing: true });
    assert.deepEqual(placeOfKey('/#play'), { route: MENU, playing: true });
    assert.deepEqual(placeOfKey('/niveles/mios'), { route: { name: 'levels', tab: 'mine' }, playing: false });
});

test('los lugares forman un árbol: menú, catálogo, ficha y la partida encima', () => {
    assert.deepEqual(placeChain(menu), ['/']);
    assert.deepEqual(placeChain(levels('mine')), ['/', '/niveles/mios']);
    assert.deepEqual(placeChain(level(12)), ['/', '/niveles', '/niveles/12']);
    assert.deepEqual(placeChain(playing(level(12, 'x', 'mine'))), ['/', '/niveles/mios', '/niveles/12', '/niveles/12#play']);
    assert.deepEqual(placeChain(playing(menu)), ['/', '/#play'], 'una canción propia se juega sobre el menú');
});

test('al bajar se apila, al subir se vuelve a lo que ya está en la pila, y lo demás se sustituye', () => {
    assert.deepEqual(planMove('/', [], menu), { type: 'none' });
    assert.deepEqual(planMove('/', [], levels()), { type: 'push', trail: ['/'] });
    assert.deepEqual(planMove('/niveles', ['/'], level(12)), { type: 'push', trail: ['/', '/niveles'] });
    // Jugar desde la rejilla, sin pasar por la ficha: también es bajar.
    assert.deepEqual(planMove('/niveles', ['/'], playing(level(12))), { type: 'push', trail: ['/', '/niveles'] });
    // "Niveles" tras la partida: el catálogo está dos entradas más abajo si se jugó desde la ficha.
    assert.deepEqual(planMove('/niveles/12#play', ['/', '/niveles', '/niveles/12'], levels()), { type: 'back', delta: -2, trail: ['/'] });
    assert.deepEqual(planMove('/niveles/12#play', ['/', '/niveles'], menu), { type: 'back', delta: -2, trail: [] });
    // Cambiar de pestaña no deja rastro.
    assert.deepEqual(planMove('/niveles', ['/'], levels('mine')), { type: 'replace', trail: ['/'] });
    // Un enlace abierto directamente: subir no puede volver a nada (debajo no hay entradas de Daino).
    assert.deepEqual(planMove('/niveles/12', [], levels()), { type: 'replace', trail: [] });
    // Soltar un MP3 con el catálogo abierto: no es bajar desde el catálogo.
    assert.deepEqual(planMove('/niveles', ['/'], playing(menu)), { type: 'replace', trail: ['/'] });
});

test('el título de la pestaña dice dónde se está', () => {
    assert.equal(placeTitle(menu), 'Daino');
    assert.equal(placeTitle(levels('mine')), 'Niveles · Daino');
    assert.equal(placeTitle(level(12, 'One Day')), 'One Day · Daino');
    assert.equal(placeTitle(level(12, null)), 'Niveles · Daino');
});

// --------------------------- El router ---------------------------

/** Un navegador de mentira: su historial, su dirección y sus tareas pendientes. */
function fakeBrowser(url = '/', state = null) {
    const entries = [{ url, state }];
    let index = 0;
    const listeners = new Set();
    const micro = [];
    const tasks = [];
    const timers = [];
    const log = [];
    const pathOf = (u) => u.split('?')[0];
    const env = {
        history: {
            get state() { return entries[index].state; },
            pushState(s, _t, u) { log.push(`push ${u}`); entries.length = index + 1; entries.push({ url: u, state: s }); index++; },
            replaceState(s, _t, u) { log.push(`replace ${u}`); entries[index] = { url: u, state: s }; },
            go(delta) {
                log.push(`go ${delta}`);
                tasks.push(() => {
                    const next = index + delta;
                    if (next < 0 || next >= entries.length) return;
                    index = next;
                    for (const fn of [...listeners]) fn({ state: entries[index].state });
                });
            },
        },
        location: {
            get pathname() { return pathOf(entries[index].url); },
            get search() { const q = entries[index].url.split('?')[1]; return q ? `?${q}` : ''; },
        },
        document: { title: '' },
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout: (id) => { timers[id - 1] = null; },
        queueMicrotask: (fn) => micro.push(fn),
    };
    /** Corre lo pendiente hasta que no queda nada (microtareas antes que tareas). */
    const settle = () => {
        for (let guard = 0; guard < 200; guard++) {
            if (micro.length) micro.shift()();
            else if (tasks.length) tasks.shift()();
            else return;
        }
        throw new Error('el router no se asienta');
    };
    return {
        env, log, settle,
        /** Solo las microtareas: lo que el router decide al acabar la tarea en curso, sin que llegue ningún popstate. */
        microtasks() { while (micro.length) micro.shift()(); },
        urls: () => entries.map((e) => e.url),
        get url() { return entries[index].url; },
        get index() { return index; },
        get size() { return entries.length; },
        /** El jugador pulsa "atrás" o "adelante". */
        user(delta) { env.history.go(delta); log.pop(); settle(); },
        /** Dispara los temporizadores pendientes (el de una vuelta atrás que no llega). */
        fireTimers() { for (const fn of timers.splice(0)) fn?.(); settle(); },
        dropTasks() { tasks.length = 0; },
    };
}

/** Una app de mentira: está en un lugar y, si el navegador se mueve, va adonde le digan. */
function fakeApp(browser, { stay = false, passive = false } = {}) {
    const app = { place: menu, navigated: [] };
    app.router = createRouter({
        place: () => app.place,
        navigate: (place) => {
            app.navigated.push(placeKey(place));
            if (!stay) app.place = place;
        },
        passive,
    }, browser.env);
    app.go = (place) => { app.place = place; app.router.sync(); browser.settle(); };
    return app;
}

test('router: menú → catálogo → ficha → jugar apila; "Niveles" y cerrar vuelven por la misma pila', () => {
    const b = fakeBrowser('/');
    const app = fakeApp(b);
    assert.deepEqual(app.router.start(), menu);

    app.go(levels());
    app.go(level(12));
    app.go(playing(level(12)));
    assert.deepEqual(b.urls(), ['/', '/niveles', '/niveles/12-one-day', '/niveles/12-one-day']);
    assert.equal(b.index, 3);
    assert.equal(b.env.document.title, 'One Day · Daino');

    app.go(levels());            // "Niveles" tras la partida
    assert.equal(b.index, 1);
    assert.equal(b.url, '/niveles');
    app.go(menu);                // cerrar el catálogo
    assert.equal(b.index, 0);
    assert.equal(b.size, 4, 'no se ha apilado nada al volver');
    assert.deepEqual(app.navigated, [], 'las vueltas del propio router no se le cuentan a la app como navegación');
});

test('router: varios cambios en la misma tarea se resuelven una vez, con el lugar final', () => {
    const b = fakeBrowser('/');
    const app = fakeApp(b);
    app.router.start();
    b.log.length = 0;
    // Salir de una partida: cerrar el panel, pasar al menú y abrir el catálogo, todo seguido.
    app.place = levels();
    app.router.sync();
    app.place = menu;
    app.router.sync();
    app.place = levels('mine');
    app.router.sync();
    b.settle();
    assert.deepEqual(b.log, ['push /niveles/mios']);
});

test('router: mientras llega una vuelta atrás no se pide otra (dos seguidas sacarían de la página)', () => {
    const b = fakeBrowser('/');
    const app = fakeApp(b);
    app.router.start();
    app.go(levels());
    app.go(playing(level(12)));
    b.log.length = 0;

    // Sale al menú (vuelta de 2 entradas) y, antes de que llegue su popstate, se abre el catálogo.
    app.place = menu;
    app.router.sync();
    b.microtasks();
    assert.deepEqual(b.log, ['go -2']);
    app.place = levels();
    app.router.sync();
    b.microtasks();
    assert.deepEqual(b.log, ['go -2'], 'con una vuelta en curso no se toca el historial');
    // Llega el popstate: ahora sí, desde la entrada donde de verdad se está.
    b.settle();
    assert.deepEqual(b.log, ['go -2', 'push /niveles']);
    assert.equal(b.url, '/niveles');
    assert.equal(b.index, 1);
    assert.deepEqual(app.navigated, []);
});

test('router: jugando, "atrás" no saca de la partida: la app pausa y la entrada se repone', () => {
    const b = fakeBrowser('/');
    const app = fakeApp(b, { stay: true });
    app.router.start();
    app.go(levels());
    app.go(playing(level(12)));
    assert.equal(b.index, 2);

    b.user(-1);   // el botón de atrás del móvil
    assert.deepEqual(app.navigated, ['/niveles'], 'la app se entera (y pausa)');
    assert.equal(b.url, '/niveles/12-one-day', 'sigue en la dirección de la partida');
    assert.equal(b.index, 2);
    assert.equal(b.size, 3, 'sin entradas de más');

    b.user(-1);   // otra vez: lo mismo, las veces que haga falta
    assert.equal(b.index, 2);
    assert.equal(b.size, 3);
});

test('router: en el menú, "atrás" y "adelante" llevan a la pantalla de esa entrada', () => {
    const b = fakeBrowser('/');
    const app = fakeApp(b);
    app.router.start();
    app.go(levels());
    app.go(level(12));

    b.user(-1);
    assert.deepEqual(app.place, levels());
    b.user(-1);
    assert.deepEqual(app.place, menu);
    b.user(1);
    b.user(1);
    assert.deepEqual(app.place.route, { name: 'level', id: 12 });
    assert.deepEqual(app.navigated, ['/niveles', '/', '/niveles', '/niveles/12']);
    assert.equal(b.size, 3);
});

test('router: un enlace abierto directamente a un nivel; subir no vuelve a ninguna parte', () => {
    const b = fakeBrowser('/niveles/12-lo-que-pusiera-el-enlace');
    const app = fakeApp(b);
    const initial = app.router.start();
    assert.deepEqual(initial, { route: { name: 'level', id: 12 }, playing: false });
    assert.equal(b.url, '/niveles/12-lo-que-pusiera-el-enlace', 'la dirección no se toca hasta conocer el nivel');

    app.go(level(12, null));              // la ficha, cargando: aún sin título
    assert.equal(b.url, '/niveles/12-lo-que-pusiera-el-enlace');
    app.go(level(12, 'One Day'));         // llegó: la dirección pasa a la canónica
    assert.equal(b.url, '/niveles/12-one-day');
    assert.equal(b.size, 1);

    app.go(levels());                     // "Volver"
    assert.equal(b.url, '/niveles');
    assert.equal(b.size, 1, 'se sustituye: "atrás" sigue sacando de Daino, como al llegar');
    assert.ok(!b.log.some((l) => l.startsWith('go')));
});

test('router: recargar conserva lo que hay debajo, y la entrada de una partida pasa a ser la del nivel', () => {
    const b = fakeBrowser('/niveles/12-one-day', { daino: 1, key: '/niveles/12#play', trail: ['/', '/niveles'] });
    const app = fakeApp(b);
    assert.deepEqual(app.router.start(), { route: { name: 'level', id: 12 }, playing: false });
    assert.deepEqual(b.env.history.state, { daino: 1, key: '/niveles/12', trail: ['/', '/niveles'] });

    // Un estado que no casa con la dirección no se hereda.
    const odd = fakeBrowser('/niveles', { daino: 1, key: '/niveles/99', trail: ['/', '/x'] });
    fakeApp(odd).router.start();
    assert.deepEqual(odd.env.history.state, { daino: 1, key: '/niveles', trail: [] });
});

test('router: lo que la dirección lleve detrás (?perf=1) se conserva', () => {
    const b = fakeBrowser('/?perf=1');
    const app = fakeApp(b);
    app.router.start();
    app.go(levels());
    app.go(level(12));
    assert.deepEqual(b.urls(), ['/?perf=1', '/niveles?perf=1', '/niveles/12-one-day?perf=1']);
});

test('router: si una vuelta atrás no llega, la entrada actual pasa a ser la del lugar', () => {
    const b = fakeBrowser('/');
    const app = fakeApp(b);
    app.router.start();
    app.go(levels());
    b.log.length = 0;
    app.place = menu;
    app.router.sync();
    b.microtasks();
    assert.deepEqual(b.log, ['go -1']);
    b.dropTasks();        // la vuelta se pierde: su popstate no llega nunca
    b.fireTimers();
    assert.deepEqual(b.log, ['go -1', 'replace /']);
    assert.equal(b.env.history.state.key, '/');
    // Y el router no se queda atascado esperándola.
    app.go(levels());
    assert.equal(b.log.at(-1), 'push /niveles');
});

test('router: incrustado en Vout no toca el historial, pero lee la dirección al arrancar', () => {
    const b = fakeBrowser('/niveles/12');
    const app = fakeApp(b, { passive: true });
    assert.deepEqual(app.router.start(), { route: { name: 'level', id: 12 }, playing: false });
    app.go(levels());
    app.go(menu);
    assert.deepEqual(b.log, []);
    assert.equal(b.env.history.state, null);
});

// --------------------------- Compartir ---------------------------

test('compartir: la hoja del sistema si la hay; si no, al portapapeles; y si no, se dice', async () => {
    const data = { title: 'One Day · Daino', url: 'https://daino.test/niveles/12-one-day' };
    const calls = [];
    const withShare = { navigator: { share: async (d) => { calls.push(['share', d.url]); } } };
    assert.equal(await shareLink(data, withShare), 'shared');

    const cancelled = { navigator: { share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }, clipboard: { writeText: async () => { calls.push(['clip']); } } } };
    assert.equal(await shareLink(data, cancelled), 'cancelled', 'cerrar la hoja sin elegir no copia nada por su cuenta');

    const broken = { navigator: { share: async () => { throw new Error('no'); }, clipboard: { writeText: async (t) => { calls.push(['clip', t]); } } } };
    assert.equal(await shareLink(data, broken), 'copied');

    // Por la IP de la red local no hay ni lo uno ni lo otro: queda el camino antiguo.
    assert.equal(await shareLink(data, { navigator: {}, copyLegacy: (t) => { calls.push(['legacy', t]); return true; } }), 'copied');
    assert.equal(await shareLink(data, { navigator: {}, copyLegacy: () => false }), 'failed');
    assert.equal(await shareLink(data, { navigator: null }), 'failed');
    assert.deepEqual(calls, [['share', data.url], ['clip', data.url], ['legacy', data.url]]);
});
