// Las piezas de la interfaz (T04, doc 12), en un sitio: botón, tecla, etiqueta,
// estrellas, opciones en fila. Su aspecto está en resources/css/ui/components.css;
// aquí se montan, siempre igual, para que cada pantalla no fabrique las suyas.
//
// Lo que dice el juego va en su letra de celdas (pixel/text.js): los rótulos de los
// botones, las etiquetas, las teclas. El contenido (títulos de canciones, nombres,
// explicaciones) sigue siendo texto normal.

import { pixelText, setPixelText } from './pixel/text.js';

/**
 * @param {string} tagName
 * @param {string | null} [className]
 * @param {string} [text]
 */
export function el(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Texto en la letra del juego. */
export function px(text, className) {
    return pixelText(text, { className });
}

/**
 * Texto en la letra del juego que puede partirse en líneas: una pieza por palabra
 * (un `pixelText` es una sola línea). Para rótulos largos en sitios estrechos.
 */
export function pxWords(text, className) {
    const box = el('span', className ? `px-words ${className}` : 'px-words');
    for (const word of String(text).split(/\s+/).filter(Boolean)) box.appendChild(pixelText(word));
    return box;
}

/**
 * Botón con su rótulo en la letra del juego.
 *
 * @param {string} label
 * @param {string} [className]  Clases, además de la base (`daino-btn` si no se pasa ninguna).
 * @param {{ key?: string, before?: string }} [opts]
 *        `key`: la tecla que lo pulsa, dibujada al final. `before`: un signo delante (▶).
 */
export function button(label, className = 'daino-btn', opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.dataset.interactive = 'true';
    if (opts.before) b.appendChild(pixelText(opts.before, { className: 'daino-btn__sign' }));
    b.appendChild(pixelText(label, { className: 'daino-btn__label' }));
    if (opts.key) b.appendChild(keycap(opts.key, { optional: true }));
    return b;
}

/** Enlace con aspecto de botón (navega: iniciar sesión). */
export function linkButton(label, href, className = 'daino-btn') {
    const a = document.createElement('a');
    a.href = href;
    a.className = className;
    a.dataset.interactive = 'true';
    a.appendChild(pixelText(label, { className: 'daino-btn__label' }));
    return a;
}

/** Cambia el rótulo de un botón creado con `button` (p. ej. "Subiendo…"). */
export function setLabel(btn, label) {
    const node = btn.querySelector(':scope > .daino-btn__label');
    if (node instanceof HTMLElement) setPixelText(node, label);
    else btn.appendChild(pixelText(label, { className: 'daino-btn__label' }));
}

/** Lo que dice un botón creado con `button`. */
export function labelOf(btn) {
    return btn.querySelector(':scope > .daino-btn__label')?.dataset.t ?? btn.textContent ?? '';
}

/**
 * Una tecla. `optional`: sobra donde no hay teclado (táctil) y se oculta.
 *
 * @param {string} text
 * @param {{ optional?: boolean }} [opts]
 */
export function keycap(text, opts = {}) {
    const k = document.createElement('kbd');
    k.className = 'daino-key';
    if (opts.optional) k.dataset.optional = 'true';
    k.setAttribute('aria-hidden', 'true');
    k.appendChild(pixelText(text));
    return k;
}

/** Etiqueta corta ("Oficial", "Listo"). `state` la colorea desde el CSS. */
export function tag(text, state) {
    const t = el('span', 'daino-tag');
    if (state) t.dataset.state = state;
    t.appendChild(pixelText(text, { className: 'daino-tag__label' }));
    return t;
}

/** Cambia el texto de una etiqueta. */
export function setTag(node, text) {
    const label = node.querySelector(':scope > .daino-tag__label');
    if (label instanceof HTMLElement) setPixelText(label, text);
}

/** Botón cuadrado de cerrar. */
export function closeButton(onClick, label = 'Cerrar') {
    const b = button('×', 'daino-btn daino-btn--ghost daino-btn--icon');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
}

/**
 * Las cinco estrellas de una dificultad.
 *
 * @param {{ filled: number, label: string, name: string }} difficulty  `catalogModel.difficultyView`.
 */
export function stars(difficulty) {
    const box = el('span', 'daino-stars');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', difficulty.label);
    box.title = difficulty.name;
    for (let i = 1; i <= 5; i++) {
        const star = pixelText('★', { className: i <= difficulty.filled ? 'is-on' : undefined });
        star.setAttribute('aria-hidden', 'true');
        box.appendChild(star);
    }
    return box;
}

/**
 * Deslizador de 0 a 1 (volumen). Lo recorrido se pinta en el color de lo tuyo: el
 * CSS lo saca de `--val`, que se mantiene aquí.
 *
 * @param {{ value: number, onInput: (value: number) => void, id?: string, label?: string }} cfg
 */
export function range({ value, onInput, id, label }) {
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'daino-range';
    if (id) input.id = id;
    if (label) input.setAttribute('aria-label', label);
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(value);
    input.dataset.interactive = 'true';
    input.style.setProperty('--val', String(value));
    input.addEventListener('input', () => {
        const v = Number.parseFloat(input.value);
        input.style.setProperty('--val', String(v));
        onInput(v);
    });
    return input;
}

/**
 * Opciones en fila, una elegida (un grupo de radio): las flechas cambian de opción.
 *
 * @template T
 * @param {{ label: string, options: Array<{ value: T, label: string, className?: string, node?: Node }>, value: T, onChange: (value: T) => void }} cfg
 *        Cada opción puede traer un dibujo (`node`, encima de su nombre) y una clase propia.
 */
export function segmented({ label, options, value, onChange }) {
    const group = el('div', 'daino-seg');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);
    const buttons = options.map((option) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = option.className ? `daino-seg__option ${option.className}` : 'daino-seg__option';
        b.dataset.interactive = 'true';
        b.setAttribute('role', 'radio');
        if (option.node) b.appendChild(option.node);
        b.appendChild(pixelText(option.label));
        b.addEventListener('click', () => choose(option.value));
        return b;
    });
    const paint = (current) => {
        buttons.forEach((b, i) => {
            const on = options[i].value === current;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
        });
    };
    const choose = (next) => {
        if (next === value) return;
        value = next;
        paint(value);
        onChange(value);
    };
    group.addEventListener('keydown', (ev) => {
        const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
        if (step === 0) return;
        ev.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const next = (i + step + options.length) % options.length;
        choose(options[next].value);
        buttons[next].focus();
    });
    paint(value);
    group.append(...buttons);
    return group;
}
