// Recorrer la interfaz sin ratón, sin dedo y sin Tab.
//
// Es lo que necesita quien juega con la cara dentro del portal de Vout
// (iframe/remote.js): sus gestos llegan como flechas, como "siguiente" y "pulsar",
// o como un clic donde apunta la cabeza. Un teclado de verdad no pasa por aquí: el
// navegador ya mueve su foco con Tab y pulsa con Enter.
//
// Qué resuelve:
//   - Qué se puede señalar ahora (`controls`): lo visible y activo del diálogo que
//     está encima, o de la página si no hay ninguno. Un menú oculto es inerte y no
//     cuenta.
//   - Moverse: en una dirección (`move`, el control más cercano hacia allí) o al
//     siguiente (`step`, en el orden de la página, dando la vuelta).
//   - Pulsar (`activate`), volver (`dismiss`: lo que haría Esc) y ajustar un
//     deslizador (`adjust`).
//
// Lo señalado es el control que tiene el foco: así Enter, Espacio y los paneles
// que miran dónde está el foco se comportan igual que con un teclado.

/** Lo que se puede señalar. Un botón cuenta aunque su `tabindex` sea -1 (las opciones de un grupo). */
const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Lo que se pulsa con Enter o Espacio. */
const PRESSABLE = 'button, a[href], input[type="checkbox"], input[type="radio"], summary, [role="button"]';

/** Cuánto mueve un deslizador cada pulsación, sobre su recorrido. */
const RANGE_STEP = 0.05;

/**
 * Reglas para elegir "el más cercano hacia allí": lo que pisa la misma fila (o
 * columna) va delante de lo que queda en diagonal.
 */
const PICK = Object.freeze({ minAlong: 1, crossWeight: 0.3, gapWeight: 3 });

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {'up' | 'down' | 'left' | 'right'} Direction
 */

// --------------------------- Geometría (pura) ---------------------------

/** Distancia entre dos tramos de un eje (0 si se pisan). */
function gapBetween(a0, aLen, b0, bLen) {
    return Math.max(0, Math.max(a0, b0) - Math.min(a0 + aLen, b0 + bLen));
}

/**
 * El rectángulo más cercano a `from` en una dirección.
 *
 * @param {Rect} from
 * @param {Rect[]} rects
 * @param {Direction} dir
 * @returns {number}  Índice en `rects`, o -1 si no hay nada hacia allí.
 */
export function pickInDirection(from, rects, dir) {
    const horizontal = dir === 'left' || dir === 'right';
    const sign = dir === 'right' || dir === 'down' ? 1 : -1;
    const fx = from.x + from.w / 2;
    const fy = from.y + from.h / 2;
    let best = -1;
    let bestScore = Infinity;
    rects.forEach((r, i) => {
        const dx = r.x + r.w / 2 - fx;
        const dy = r.y + r.h / 2 - fy;
        const along = (horizontal ? dx : dy) * sign;
        if (along < PICK.minAlong) return;
        const gap = horizontal ? gapBetween(from.y, from.h, r.y, r.h) : gapBetween(from.x, from.w, r.x, r.w);
        const score = along + Math.abs(horizontal ? dy : dx) * PICK.crossWeight + gap * PICK.gapWeight;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    });
    return best;
}

// --------------------------- Qué hay en pantalla ---------------------------

/**
 * El `<dialog>` que está encima de todo, o null. Con dos abiertos (el catálogo y
 * "Subir mi canción" sobre él) manda el último que se abrió, que no tiene por qué
 * ser el último de la página: es el que tiene el foco o, si no lo tiene nadie, el
 * que se toca en el centro de la ventana (su velo la cubre entera).
 */
export function topDialog() {
    const open = document.querySelectorAll('dialog[open]');
    if (open.length <= 1) return open[0] ?? null;
    const focused = document.activeElement?.closest?.('dialog[open]');
    if (focused) return focused;
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest?.('dialog[open]');
    return hit ?? open[open.length - 1];
}

/** ¿Se ve y se puede usar? */
function usable(el) {
    if (el.matches(':disabled') || el.closest('[inert]') !== null) return false;
    if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    }
    return el.getClientRects().length > 0;
}

/** Lo que se puede señalar ahora mismo, en el orden de la página. */
export function controls() {
    const root = topDialog() ?? document.body;
    return [...root.querySelectorAll(CONTROLS)].filter(usable);
}

/** El control que tiene el foco, o null si no lo tiene ninguno que se pueda usar. */
export function current() {
    const el = document.activeElement;
    if (el === null || el === document.body || typeof el.matches !== 'function') return null;
    return el.matches(CONTROLS) && usable(el) ? el : null;
}

/**
 * El control que hay bajo un punto de la pantalla (donde apunta el cursor), o null.
 * La etiqueta de una casilla cuenta como la casilla.
 *
 * @param {Element | null} target  Lo que devuelve `document.elementFromPoint`.
 */
export function controlAt(target) {
    if (target === null || typeof target.closest !== 'function') return null;
    const el = target.closest(CONTROLS) ?? target.closest('label')?.control ?? null;
    return el !== null && usable(el) ? el : null;
}

/** Cómo se llama un control, para contarlo ("pulsa «Reintentar»"). */
export function labelOf(el) {
    // Un campo no tiene texto dentro: se llama como su etiqueta.
    const text = (el.getAttribute('aria-label') ?? (el.textContent || el.labels?.[0]?.textContent) ?? '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 60) || el.tagName.toLowerCase();
}

// --------------------------- Moverse ---------------------------

function focus(el) {
    el.focus();
    return el;
}

function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Señala el primer control. null si no hay ninguno. */
export function first() {
    const list = controls();
    return list.length > 0 ? focus(list[0]) : null;
}

/**
 * Señala el control más cercano en una dirección. Sin nada señalado, el primero.
 *
 * @param {Direction} dir
 * @returns {Element | null}  El control señalado, o null si no hay nada hacia allí.
 */
export function move(dir) {
    const from = current();
    if (from === null) return first();
    const others = controls().filter((el) => el !== from);
    const i = pickInDirection(rectOf(from), others.map(rectOf), dir);
    return i === -1 ? null : focus(others[i]);
}

/**
 * Señala el control siguiente (o el anterior) en el orden de la página, dando la
 * vuelta al llegar al final.
 *
 * @param {1 | -1} delta
 */
export function step(delta) {
    const list = controls();
    if (list.length === 0) return null;
    const i = list.indexOf(current());
    const next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
    return focus(list[next]);
}

// --------------------------- Actuar ---------------------------

/** ¿Se pulsa con Enter o Espacio? */
export function pressable(el) {
    return el !== null && el.matches(PRESSABLE);
}

/** Pulsa un control: lo mismo que un clic. */
export function activate(el) {
    el.click();
}

/**
 * Un clic en un punto de la pantalla (el clic del control facial cae donde apunta
 * el cursor). Sobre un deslizador lo lleva a ese punto: un clic creado por código
 * no mueve su tirador.
 *
 * @param {Element | null} target  Lo que hay en ese punto.
 * @param {number} x
 * @param {number} y
 * @returns {Element | null}  El control pulsado; null si el clic cayó donde no hay
 *          ninguno (aun así se entrega: fuera de un panel lo cierra).
 */
export function clickAt(target, x, y) {
    if (target === null) return null;
    const control = controlAt(target);
    if (control !== null && control.matches('input[type="range"]')) {
        const r = control.getBoundingClientRect();
        setRange(control, r.width > 0 ? (x - r.left) / r.width : 0);
        return control;
    }
    // Un botón desactivado no recibe clics de verdad: tampoco estos.
    if (target.closest(':disabled') !== null) return null;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y }));
    return control;
}

/**
 * Mueve un deslizador con las flechas de su eje. false si `el` no es un
 * deslizador o la flecha va hacia arriba o abajo (esas sirven para salir de él).
 *
 * @param {Element | null} el
 * @param {Direction} dir
 */
export function adjust(el, dir) {
    if (el === null || !el.matches('input[type="range"]') || dir === 'up' || dir === 'down') return false;
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 1;
    const at = max > min ? (Number(el.value) - min) / (max - min) : 0;
    setRange(el, at + (dir === 'right' ? RANGE_STEP : -RANGE_STEP));
    return true;
}

/** Lleva un deslizador a un punto de su recorrido (0 a 1) y avisa como si lo moviera alguien. */
function setRange(el, ratio) {
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 1;
    el.value = String(min + Math.min(1, Math.max(0, ratio)) * (max - min));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Lo que haría Esc: avisar al diálogo de encima y, si no hace otra cosa, cerrarlo.
 *
 * @returns {'handled' | 'closed' | null}  `handled`: el diálogo hizo lo suyo (la
 *          ficha vuelve a la rejilla, la pausa reanuda). null: no hay diálogo.
 */
export function dismiss() {
    const dialog = topDialog();
    if (dialog === null) return null;
    if (!dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) return 'handled';
    dialog.close();
    return 'closed';
}
