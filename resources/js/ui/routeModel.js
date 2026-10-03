// Las direcciones de Daino (T06): qué pantalla es cada URL, y al revés.
//
//   /                     el menú
//   /niveles              el catálogo
//   /niveles/mios         el catálogo, en «Míos»
//   /niveles/12-one-day   la ficha de un nivel (lo que se comparte). El número es
//                         el nivel; lo que sigue al guion es solo para leerlo y no
//                         cuenta: /niveles/12 y /niveles/12-lo-que-sea son lo mismo.
//
// Las tres primeras son un sitio donde estar. Jugar no tiene dirección propia: se
// juega "encima" de la del nivel (o de la del menú, con una canción propia), en una
// entrada del historial aparte. Por eso un LUGAR es una ruta más "¿se está jugando?".
//
// El historial del navegador es una pila, y los lugares forman un árbol:
//
//   menú ─ catálogo ─ ficha ─ jugando ese nivel
//      └─ jugando una canción propia
//
// `planMove` decide qué hacer con la pila al pasar de un lugar a otro: apilar si se
// baja por el árbol, VOLVER a una entrada que ya está en la pila si se sube (así
// "atrás" no la encuentra dos veces), y sustituir en lo demás (cambiar de pestaña,
// subir desde un enlace abierto directamente). Para saber qué hay en la pila, cada
// entrada guarda las claves de las que tiene debajo (`trail`).
//
// Pura, sin DOM: se prueba en Node.

export const LEVELS_PATH = '/niveles';
const MINE = 'mios';
/** Marca, en la clave de una entrada, de que es la de una partida. */
const PLAY_MARK = '#play';
/** Lo más largo que se deja el trozo legible de la dirección de un nivel. */
const SLUG_MAX = 48;

/**
 * @typedef {{ name: 'menu' }
 *   | { name: 'levels', tab: 'public' | 'mine' }
 *   | { name: 'level', id: number, tab?: 'public' | 'mine', title?: string | null }} Route
 *          `tab` de un nivel: la pestaña del catálogo que tiene detrás.
 * @typedef {{ route: Route, playing: boolean }} Place
 */

/** @type {Route} */
export const MENU = Object.freeze({ name: 'menu' });

/**
 * La ruta de una dirección, o `null` si no es ninguna de Daino.
 *
 * @param {string} pathname
 * @returns {Route | null}
 */
export function parsePath(pathname) {
    let path;
    try {
        path = decodeURIComponent(String(pathname ?? ''));
    } catch {
        return null;
    }
    const parts = path.split('/').filter((p) => p !== '');
    if (parts.length === 0) return MENU;
    if (`/${parts[0]}` !== LEVELS_PATH || parts.length > 2) return null;
    if (parts.length === 1) return { name: 'levels', tab: 'public' };
    if (parts[1] === MINE) return { name: 'levels', tab: 'mine' };
    const m = /^([1-9]\d{0,9})(?:-.*)?$/.exec(parts[1]);
    return m ? { name: 'level', id: Number(m[1]) } : null;
}

/**
 * El título de un nivel como trozo de dirección: «What's Up Danger» → `what-s-up-danger`.
 * Vacío si no queda nada escribible (un título en japonés): la dirección se queda en el número.
 *
 * @param {string | null | undefined} title
 */
export function slugify(title) {
    return String(title ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAX)
        .replace(/-+$/, '');
}

/**
 * La dirección de una ruta (la canónica: con el título del nivel si se conoce).
 *
 * @param {Route} route
 */
export function routePath(route) {
    if (route.name === 'levels') return route.tab === 'mine' ? `${LEVELS_PATH}/${MINE}` : LEVELS_PATH;
    if (route.name === 'level') {
        const slug = slugify(route.title);
        return `${LEVELS_PATH}/${route.id}${slug ? `-${slug}` : ''}`;
    }
    return '/';
}

/** La clave de una ruta: su dirección sin el trozo legible. */
function routeKey(route) {
    return route.name === 'level' ? `${LEVELS_PATH}/${route.id}` : routePath(route);
}

/**
 * La clave de un lugar: lo que identifica su entrada en el historial.
 *
 * @param {Place} place
 */
export function placeKey(place) {
    return routeKey(place.route) + (place.playing ? PLAY_MARK : '');
}

/**
 * El lugar de una clave (lo contrario de `placeKey`).
 *
 * @param {string} key
 * @returns {Place}
 */
export function placeOfKey(key) {
    const playing = String(key).endsWith(PLAY_MARK);
    const route = parsePath(playing ? String(key).slice(0, -PLAY_MARK.length) : key);
    return { route: route ?? MENU, playing };
}

/**
 * Las claves desde el menú hasta un lugar: su camino en el árbol.
 *
 * @param {Place} place
 */
export function placeChain(place) {
    const { route } = place;
    const chain = ['/'];
    if (route.name === 'levels') chain.push(routeKey(route));
    if (route.name === 'level') chain.push(routeKey({ name: 'levels', tab: route.tab ?? 'public' }), routeKey(route));
    if (place.playing) chain.push(placeKey(place));
    return chain;
}

/**
 * Qué hacer con el historial para pasar de la entrada actual a un lugar.
 *
 *   none     ya se está ahí.
 *   back     está en la pila: se vuelve `delta` entradas (negativo).
 *   push     se baja por el árbol: entrada nueva.
 *   replace  lo demás: la entrada actual pasa a ser la del lugar.
 *
 * @param {string} currentKey     Clave de la entrada actual.
 * @param {readonly string[]} trail  Claves de las entradas de Daino que tiene debajo, de la más vieja a la más nueva.
 * @param {Place} target
 * @returns {{ type: 'none' } | { type: 'back', delta: number, trail: string[] } | { type: 'push', trail: string[] } | { type: 'replace', trail: string[] }}
 */
export function planMove(currentKey, trail, target) {
    const key = placeKey(target);
    if (key === currentKey) return { type: 'none' };
    const at = trail.lastIndexOf(key);
    if (at >= 0) return { type: 'back', delta: at - trail.length, trail: trail.slice(0, at) };
    const above = placeChain(target).slice(0, -1);
    if (above.includes(currentKey)) return { type: 'push', trail: [...trail, currentKey] };
    return { type: 'replace', trail: [...trail] };
}

/**
 * El título de la pestaña del navegador en un lugar.
 *
 * @param {Place} place
 */
export function placeTitle(place) {
    const { route } = place;
    if (route.name === 'level' && route.title) return `${route.title} · Daino`;
    if (route.name === 'levels' || route.name === 'level') return 'Niveles · Daino';
    return 'Daino';
}
