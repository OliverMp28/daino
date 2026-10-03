// El router (T06): mantiene la dirección del navegador al día con lo que se ve, y
// lo que se ve al día con la dirección cuando la mueve el navegador (atrás,
// adelante, recargar, abrir un enlace).
//
// No decide nada de la aplicación. Se le dan dos cosas:
//   - `place()`: dónde está la app AHORA (routeModel.js). La dirección es una
//     proyección de eso: nadie "navega", la app cambia y el router la sigue.
//   - `navigate(place)`: el navegador ha ido a otra entrada; la app hace lo que
//     toque (abrir el catálogo, o pausar la partida y quedarse donde está).
//
// Tras `navigate` se vuelve a mirar `place()`: si la app decidió no moverse
// (jugando, "atrás" pausa), la entrada que el navegador dejó atrás se repone sola.
//
// Dos cuidados con el historial:
//   - Varios cambios seguidos en la misma tarea (cerrar un panel, cambiar de
//     estado, abrir el catálogo) se resuelven una sola vez, al final, con el lugar
//     definitivo.
//   - Volver atrás (`history.go`) no es inmediato: hasta que llega su `popstate`
//     no se toca nada más (dos `go` seguidos calculados con la misma entrada se
//     sumarían y sacarían al jugador de la página). Si no llega, se sustituye.
//
// Incrustado en Vout (un iframe) no se toca el historial: es el de la página que
// lo incrusta. Se sigue leyendo la dirección al arrancar.
//
// Sin `window` propio: recibe el entorno (el del navegador, o uno de mentira en
// los tests).

import { MENU, parsePath, placeKey, placeOfKey, placeTitle, planMove, routePath } from './routeModel.js';

/** Lo que se espera el `popstate` de una vuelta atrás antes de darla por perdida. */
const TRAVERSE_TIMEOUT_MS = 800;

/**
 * @typedef {import('./routeModel.js').Place} Place
 * @typedef {{ history: History, location: Location, document: { title: string }, addEventListener: Function, removeEventListener: Function, setTimeout: Function, clearTimeout: Function, queueMicrotask: Function }} RouterEnv
 */

/** @returns {RouterEnv} */
function browserEnv() {
    return {
        history: window.history,
        location: window.location,
        document,
        addEventListener: (type, fn) => window.addEventListener(type, fn),
        removeEventListener: (type, fn) => window.removeEventListener(type, fn),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id),
        queueMicrotask: (fn) => queueMicrotask(fn),
    };
}

const isOurs = (state) => state !== null && typeof state === 'object' && state.daino === 1
    && typeof state.key === 'string' && Array.isArray(state.trail);

/**
 * @param {object} hooks
 * @param {() => Place} hooks.place                 Dónde está la app ahora.
 * @param {(place: Place) => void} hooks.navigate   El navegador fue a otra entrada.
 * @param {boolean} [hooks.passive]                 No tocar el historial (incrustado).
 * @param {RouterEnv} [env]
 */
export function createRouter(hooks, env = browserEnv()) {
    const passive = hooks.passive === true;
    /** Vuelta atrás en curso: la clave donde debe acabar y su temporizador. */
    let traversing = null;
    let queued = false;
    let started = false;

    /** La entrada actual: su clave y lo que tiene debajo. */
    const entry = () => {
        const s = env.history.state;
        return isOurs(s) ? { key: s.key, trail: s.trail } : { key: placeKey({ route: parsePath(env.location.pathname) ?? MENU, playing: false }), trail: [] };
    };

    /** La dirección de un lugar, con lo que la URL lleve detrás (`?perf=1`). */
    const urlOf = (place) => routePath(place.route) + (env.location.search ?? '');

    const stateOf = (place, trail) => ({ daino: 1, key: placeKey(place), trail });

    function flush() {
        queued = false;
        if (!started || passive || traversing !== null) return;
        const target = hooks.place();
        const here = entry();
        const plan = planMove(here.key, here.trail, target);
        if (plan.type === 'back') {
            traversing = {
                key: placeKey(target),
                timer: env.setTimeout(() => {
                    // No llegó: la entrada actual pasa a ser la del lugar.
                    traversing = null;
                    const now = hooks.place();
                    env.history.replaceState(stateOf(now, entry().trail), '', urlOf(now));
                    env.document.title = placeTitle(now);
                }, TRAVERSE_TIMEOUT_MS),
            };
            env.history.go(plan.delta);
            return;
        }
        if (plan.type === 'push') {
            env.history.pushState(stateOf(target, plan.trail), '', urlOf(target));
        } else if (plan.type === 'replace') {
            env.history.replaceState(stateOf(target, plan.trail), '', urlOf(target));
        } else if (target.route.name !== 'level' || target.route.title) {
            // Mismo lugar: solo se retoca la dirección si le falta el título del nivel.
            const url = urlOf(target);
            if (url !== env.location.pathname + (env.location.search ?? '')) env.history.replaceState(stateOf(target, here.trail), '', url);
        }
        env.document.title = placeTitle(target);
    }

    function onPop(ev) {
        if (passive) return;
        const state = ev.state;
        if (traversing !== null) {
            const expected = traversing.key;
            env.clearTimeout(traversing.timer);
            traversing = null;
            if (isOurs(state) && state.key === expected) {
                // Era la vuelta atrás que pidió el propio router: la app ya está ahí.
                sync();
                return;
            }
        }
        // Lo movió el navegador: una entrada de Daino dice qué lugar es; una que no
        // (alguien llegó aquí por otro camino), su dirección.
        const place = isOurs(state) ? placeOfKey(state.key) : { route: parsePath(env.location.pathname) ?? MENU, playing: false };
        if (!isOurs(state)) env.history.replaceState(stateOf(place, []), '', urlOf(place));
        hooks.navigate(place);
        sync();
    }

    /** La app ha cambiado (o puede haberlo hecho): poner la dirección al día. */
    function sync() {
        if (!started || passive || queued) return;
        queued = true;
        env.queueMicrotask(flush);
    }

    return {
        sync,

        /**
         * Adopta la entrada en la que se ha abierto la página y devuelve su lugar
         * (a quien llama le toca enseñarlo). Tras recargar, la entrada conserva lo
         * que tenía debajo: "atrás" sigue funcionando.
         *
         * @returns {Place}
         */
        start() {
            const route = parsePath(env.location.pathname) ?? MENU;
            const place = { route, playing: false };
            started = true;
            if (passive) return place;
            const s = env.history.state;
            // Recargar en plena partida deja la entrada de la partida sin partida:
            // pasa a ser la del nivel.
            const trail = isOurs(s) && placeKey(placeOfKey(s.key).playing ? { ...placeOfKey(s.key), playing: false } : placeOfKey(s.key)) === placeKey(place)
                ? s.trail
                : [];
            // Una dirección que no es de Daino no llega aquí (el servidor responde
            // 404), pero por si acaso se deja la del menú; la del nivel, como vino
            // (su título se añade cuando se conozca).
            const url = (parsePath(env.location.pathname) === null ? '/' : env.location.pathname) + (env.location.search ?? '');
            env.history.replaceState(stateOf(place, trail), '', url);
            env.addEventListener('popstate', onPop);
            return place;
        },

        dispose() {
            if (traversing !== null) env.clearTimeout(traversing.timer);
            traversing = null;
            started = false;
            env.removeEventListener('popstate', onPop);
        },
    };
}
