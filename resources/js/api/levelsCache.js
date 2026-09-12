// Caché en memoria del listado de niveles (Ola 0, defecto D9).
//
// Problema que resuelve: `openLevelsModal()` abría el <dialog> y SOLO ENTONCES
// lanzaba el fetch, así que el panel aparecía vacío con un "Cargando…" durante
// 1-1.5 s en cada apertura, y cada cambio de pestaña volvía a pedir lo mismo.
//
// Aquí el listado se precalienta al montar el menú — mientras el jugador lee el
// título y decide, la petición ya está en vuelo — y se reutiliza entre
// aperturas mientras siga fresco.
//
// Por qué un módulo propio y no estado suelto dentro de `modals.js`: la Ola 2
// reescribe la UI del catálogo por completo y la Ola 3 añade caché persistente
// de charts y audio. Este módulo es el punto único donde vivirá esa política,
// así que la UI no tiene que saber nada de cachés ni de invalidación.
//
// Deliberadamente EN MEMORIA, no localStorage: el listado incluye niveles
// privados del usuario y cambia al publicar o al cambiar de sesión. Persistirlo
// entre recargas daría datos obsoletos a cambio de muy poco.

import { request as apiRequest } from './client.js';

/**
 * Cuánto se considera fresco un listado. 30 s cubre de sobra el patrón real
 * (abrir el modal, mirar, cerrar, volver a abrir) sin arriesgar que el usuario
 * deje de ver un nivel que acaba de publicar otra persona.
 */
const TTL_MS = 30_000;

/** @typedef {'public' | 'mine'} LevelsTab */

/**
 * @typedef {Object} CacheEntry
 * @property {number}            fetchedAt  `performance.now()` de la respuesta.
 * @property {object|null}       payload    Cuerpo de la respuesta si fue 2xx.
 * @property {object|null}       error      `{ status, message }` si falló.
 * @property {Promise<any>|null} inFlight   Petición en curso, para deduplicar.
 */

/** @type {Map<LevelsTab, CacheEntry>} */
const cache = new Map();

const PATHS = {
    public: '/api/levels?limit=20',
    mine: '/api/levels?mine=1&limit=20',
};

/**
 * Devuelve el listado de una pestaña, desde caché si sigue fresco.
 *
 * Deduplica peticiones concurrentes: si el precalentamiento sigue en vuelo
 * cuando el usuario abre el modal, ambos esperan a la MISMA promesa en vez de
 * disparar dos peticiones iguales.
 *
 * @param {LevelsTab} tab
 * @param {{ force?: boolean }} [opts]  `force` salta la caché (tras publicar).
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function getLevels(tab, opts = {}) {
    const entry = cache.get(tab);

    if (!opts.force && entry) {
        if (entry.inFlight) return entry.inFlight;
        const fresh = performance.now() - entry.fetchedAt < TTL_MS;
        if (fresh && entry.error === null) {
            return { ok: true, status: 200, data: entry.payload };
        }
    }

    const inFlight = apiRequest('GET', PATHS[tab]).then((res) => {
        cache.set(tab, {
            fetchedAt: performance.now(),
            payload: res.ok ? res.data : null,
            error: res.ok ? null : { status: res.status, message: res.data?.message },
            inFlight: null,
        });
        return res;
    }).catch((err) => {
        // Un fallo no debe dejar una promesa colgada en la caché para siempre.
        cache.delete(tab);
        throw err;
    });

    cache.set(tab, { fetchedAt: performance.now(), payload: null, error: null, inFlight });
    return inFlight;
}

/**
 * Lanza la petición sin esperarla, para tenerla lista antes de que el usuario
 * abra el catálogo. Los errores se tragan a propósito: esto es especulativo y
 * no debe producir ruido ni rechazos sin capturar. Si falló, la apertura real
 * del modal reintentará y ahí sí se mostrará el error.
 *
 * @param {LevelsTab} [tab]
 */
export function prefetchLevels(tab = 'public') {
    void getLevels(tab).catch(() => {});
}

/**
 * Invalida la caché. Sin argumento, la vacía entera.
 * Llamar tras publicar un nivel o al cambiar la sesión.
 *
 * @param {LevelsTab} [tab]
 */
export function invalidateLevels(tab) {
    if (tab === undefined) cache.clear();
    else cache.delete(tab);
}

// Un cambio de identidad invalida ambos listados: "mine" pasa a ser de otra
// persona (o deja de existir) y los públicos pueden mostrar acciones distintas
// según haya sesión. Se registra aquí, en el dueño de la caché, y no en la UI:
// así ningún consumidor futuro puede olvidarse de hacerlo.
if (typeof window !== 'undefined') {
    window.addEventListener('daino:auth:login', () => invalidateLevels());
    window.addEventListener('daino:auth:logout', () => invalidateLevels());
}
