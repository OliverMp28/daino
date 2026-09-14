// Caché en memoria del catálogo de niveles (Olas 0 y 2).
//
// Ola 0 (defecto D9): el listado se precalienta al montar el menú y se
// reutiliza entre aperturas mientras siga fresco; así el catálogo pinta al
// instante en vez de mostrar "Cargando…" 1-1.5 s en cada apertura.
//
// Ola 2: una entrada por pestaña del catálogo con paginación. La primera página
// se cachea; "cargar más" amplía la misma entrada, de modo que reabrir el
// catálogo conserva lo que ya se había visto. Tras el playtest de la Ola 5 las
// pestañas son dos: `public` (oficiales y comunidad juntos) y `mine`.
//
// Deliberadamente EN MEMORIA, no localStorage: el listado incluye niveles
// privados y la mejor marca del usuario, y cambia al publicar, al jugar o al
// cambiar de sesión. Persistirlo entre recargas daría datos obsoletos a cambio
// de muy poco. La invalidación vive aquí, en el dueño de la caché, para que
// ningún consumidor pueda olvidarse de hacerla.

import { request as apiRequest } from './client.js';

/** Frescura de una pestaña. Cubre abrir, mirar, cerrar y volver a abrir. */
const TTL_MS = 30_000;

/** Tamaño de página: una rejilla de 4 columnas × 6 filas en escritorio. */
export const PAGE_SIZE = 24;

/** @typedef {'public' | 'mine'} CatalogTab */
export const CATALOG_TABS = Object.freeze(['public', 'mine']);

/**
 * @typedef {Object} CatalogPage
 * @property {object[]} items  Todos los niveles cargados hasta ahora, en orden.
 * @property {number}   total  Total en el servidor.
 */

/**
 * @typedef {Object} CacheEntry
 * @property {number}                  fetchedAt
 * @property {CatalogPage|null}        page
 * @property {Promise<Result>|null}    inFlight
 */

/** @typedef {{ ok: boolean, status: number, data: CatalogPage | null, error?: string }} Result */

/** @type {Map<CatalogTab, CacheEntry>} */
const cache = new Map();

/**
 * Página inicial de una pestaña, desde caché si sigue fresca.
 *
 * Deduplica peticiones concurrentes: si el precalentamiento sigue en vuelo
 * cuando el usuario abre el catálogo, ambos esperan a la MISMA promesa.
 *
 * @param {CatalogTab} tab
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<Result>}
 */
export function getLevels(tab, opts = {}) {
    assertTab(tab);
    const entry = cache.get(tab);
    if (!opts.force && entry) {
        if (entry.inFlight) return entry.inFlight;
        if (entry.page !== null && performance.now() - entry.fetchedAt < TTL_MS) {
            return Promise.resolve({ ok: true, status: 200, data: entry.page });
        }
    }

    const inFlight = fetchPage(tab, 0).then((res) => {
        const current = cache.get(tab);
        if (current?.inFlight !== inFlight) return res;   // invalidada mientras tanto
        if (res.ok) {
            cache.set(tab, { fetchedAt: performance.now(), page: res.data, inFlight: null });
        } else {
            // Un fallo no tira lo que ya se tenía: se sigue pudiendo enseñar.
            current.inFlight = null;
        }
        return res;
    });
    cache.set(tab, { fetchedAt: entry?.fetchedAt ?? -Infinity, page: entry?.page ?? null, inFlight });
    return inFlight;
}

/**
 * Carga la siguiente página y la añade a la entrada cacheada.
 *
 * @param {CatalogTab} tab
 * @returns {Promise<Result>}  `data` es la página ACUMULADA.
 */
export async function loadMoreLevels(tab) {
    assertTab(tab);
    const entry = cache.get(tab);
    if (!entry?.page) return getLevels(tab);
    if (entry.inFlight) return entry.inFlight;

    const offset = entry.page.items.length;
    const inFlight = fetchPage(tab, offset).then((res) => {
        const current = cache.get(tab);
        if (current?.inFlight !== inFlight) return res;
        if (!res.ok) {
            current.inFlight = null;
            return res;
        }
        // Un nivel nuevo publicado entre páginas desplaza el offset: se
        // descartan los repetidos en vez de pintarlos dos veces.
        const seen = new Set(current.page.items.map((l) => l.id));
        const page = {
            items: [...current.page.items, ...res.data.items.filter((l) => !seen.has(l.id))],
            total: res.data.total,
        };
        cache.set(tab, { fetchedAt: current.fetchedAt, page, inFlight: null });
        return { ok: true, status: res.status, data: page };
    });
    entry.inFlight = inFlight;
    return inFlight;
}

/**
 * Lanza la petición sin esperarla, para tenerla lista antes de que el usuario
 * abra el catálogo. Especulativo y silencioso.
 *
 * @param {CatalogTab} [tab]
 */
export function prefetchLevels(tab = 'public') {
    void getLevels(tab);
}

/**
 * Lo que haya cacheado para una pestaña, aunque ya no esté fresco. La UI lo
 * pinta al instante mientras `getLevels` revalida (stale-while-revalidate): tras
 * una partida el catálogo no vuelve a pasar por el esqueleto.
 *
 * @param {CatalogTab} tab
 * @returns {CatalogPage|null}
 */
export function peekLevels(tab) {
    return cache.get(tab)?.page ?? null;
}

/**
 * Marca todas las pestañas como no frescas SIN borrarlas: la próxima lectura
 * revalida, pero `peekLevels` sigue teniendo algo que enseñar.
 */
export function markLevelsStale() {
    // -Infinity y no 0: `performance.now()` cuenta desde que cargó la página, así
    // que durante sus primeros 30 s un 0 seguiría pareciendo fresco.
    for (const entry of cache.values()) entry.fetchedAt = -Infinity;
}

/**
 * Invalida la caché. Sin argumento, la vacía entera.
 *
 * @param {CatalogTab} [tab]
 */
export function invalidateLevels(tab) {
    if (tab === undefined) cache.clear();
    else cache.delete(tab);
}

/**
 * Sustituye un nivel en las pestañas cacheadas que lo contengan (p. ej. tras
 * publicarlo), sin volver a pedir nada.
 *
 * @param {object} level
 */
export function patchCachedLevel(level) {
    for (const entry of cache.values()) {
        if (!entry.page) continue;
        const i = entry.page.items.findIndex((l) => l.id === level.id);
        if (i >= 0) entry.page.items[i] = { ...entry.page.items[i], ...level };
    }
}

async function fetchPage(tab, offset) {
    const res = await apiRequest('GET', `/api/levels?scope=${tab}&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!res.ok || !Array.isArray(res.data?.items)) {
        return {
            ok: false,
            status: res.status,
            data: null,
            error: res.data?.message ?? (res.status === 0 ? 'Sin conexión con el servidor.' : `Error ${res.status}.`),
        };
    }
    return { ok: true, status: res.status, data: { items: res.data.items, total: Number(res.data.total) || 0 } };
}

function assertTab(tab) {
    if (!CATALOG_TABS.includes(tab)) throw new Error(`levelsCache: pestaña desconocida "${tab}"`);
}

// Un cambio de identidad BORRA todo: "mine" pasa a ser de otra persona y las
// marcas de las tarjetas son de quien mira; enseñar lo anterior ni un instante
// filtraría datos de la sesión previa. Tras guardar un progreso basta con
// revalidar: lo cacheado sigue siendo del mismo usuario.
if (typeof window !== 'undefined') {
    window.addEventListener('daino:auth:login', () => invalidateLevels());
    window.addEventListener('daino:auth:logout', () => invalidateLevels());
    window.addEventListener('daino:progress-saved', () => markLevelsStale());
}
