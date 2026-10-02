// Texto en la letra del juego (T04, doc 12): pinta en el DOM lo que dibuja font.js.
//
// Cada texto es un <svg> de un solo trazo (un rectángulo por racha de celdas), del
// color del texto (`currentColor`) y del tamaño que diga el CSS con `--cell` (lo que
// mide una celda; por defecto, `--u2`). Va acompañado del texto de verdad, oculto a
// la vista: un botón sigue teniendo nombre para un lector de pantalla y
// `textContent` sigue devolviendo lo que dice.
//
// Un texto con algún carácter sin dibujar (el título de una canción en japonés) no
// sale a medias: se pinta entero en la letra del sistema (`.px--plain`).

import { FONT, normalizeText, supportsText, textPath } from './font.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} text
 * @param {{ className?: string, shadow?: boolean, tag?: string }} [opts]
 *        `shadow`: sombra dura de una celda, abajo a la derecha (rótulos sobre la escena).
 * @returns {HTMLElement}
 */
export function pixelText(text, opts = {}) {
    const node = document.createElement(opts.tag ?? 'span');
    node.className = opts.className ? `px ${opts.className}` : 'px';
    if (opts.shadow) node.dataset.shadow = 'true';
    setPixelText(node, text);
    return node;
}

/**
 * Cambia el texto de un nodo creado con `pixelText`. Si no cambia, no toca nada
 * (el marcador llama esto muchas veces por segundo).
 *
 * @param {HTMLElement} node
 * @param {string} text
 */
export function setPixelText(node, text) {
    const value = String(text ?? '');
    if (node.dataset.t === value && node.firstChild !== null) return;
    node.dataset.t = value;

    if (!supportsText(value)) {
        node.classList.add('px--plain');
        node.replaceChildren(document.createTextNode(value));
        return;
    }
    node.classList.remove('px--plain');

    let svg = node.querySelector(':scope > svg');
    let label = node.querySelector(':scope > .px__sr');
    if (svg === null || label === null) {
        svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        if (node.dataset.shadow === 'true') {
            const shadow = document.createElementNS(SVG_NS, 'path');
            shadow.setAttribute('class', 'px__shadow');
            shadow.setAttribute('transform', 'translate(1 1)');
            svg.appendChild(shadow);
        }
        const ink = document.createElementNS(SVG_NS, 'path');
        ink.setAttribute('class', 'px__ink');
        svg.appendChild(ink);
        label = document.createElement('span');
        label.className = 'px__sr';
        node.replaceChildren(svg, label);
    }

    const { d, width } = textPath(value);
    // Un texto vacío sigue ocupando su alto: nada salta al llenarse.
    const w = Math.max(width, 0);
    svg.setAttribute('viewBox', `0 0 ${Math.max(w, 1)} ${FONT.capHeight}`);
    svg.style.setProperty('--w', String(w));
    for (const path of svg.children) path.setAttribute('d', d);
    label.textContent = value;
}

/** Lo que dice un nodo de `pixelText` (para comparar sin leer el DOM). */
export function pixelTextValue(node) {
    return node.dataset.t ?? '';
}

export { normalizeText };
