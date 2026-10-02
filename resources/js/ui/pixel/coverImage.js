// La portada de un nivel, como imagen (T04, doc 12): convierte lo que dibuja
// cover.js en una imagen de una celda por píxel y la pone de fondo de un elemento.
// El CSS (`.px-cover`) la amplía por celdas enteras y enseña la parte que cabe.
//
// Se guardan por clave: los niveles con el mismo escenario, dificultad y encuadre
// comparten imagen, y volver a abrir el catálogo no dibuja nada.
//
// La primera vez, cada portada cuesta unos milisegundos (dibujarla es 1 ms; lo
// demás es codificarla como imagen): una docena seguidas serían un parón al abrir
// el catálogo. Por eso las que faltan se hacen en tandas cortas, una tarea del
// navegador cada una (los clics y el dibujo pasan entre medias); mientras llega,
// la tarjeta enseña el color de lo alto de su cielo.

import { rgbToHex } from '../../game/scenes/color.js';
import { resolveScene } from '../../game/scenes/registry.js';
import { createSkyState, skyColorAt, skyStateAt } from '../../game/scenes/skyModel.js';
import { coverKey } from '../coverModel.js';
import { renderCover } from './cover.js';

/** @type {Map<string, { url: string, cols: number, rows: number, top: string }>} */
const cache = new Map();

/** Portadas pendientes de dibujar, en el orden en que se pidieron. */
const pending = [];
let scheduled = false;

/** Tiempo que se dedica a dibujar portadas en cada rato libre (ms). */
const SLICE_MS = 8;

const skyState = createSkyState();

/**
 * La imagen de una portada, dibujándola ahora si hace falta.
 *
 * @param {import('../coverModel.js').CoverSpec} spec
 */
export function coverImage(spec) {
    const key = coverKey(spec);
    let img = cache.get(key);
    if (img) return img;
    const drawn = renderCover({ scene: resolveScene(spec.scene), hour: spec.hour, pan: spec.pan });
    const canvas = document.createElement('canvas');
    canvas.width = drawn.cols;
    canvas.height = drawn.rows;
    canvas.getContext('2d').putImageData(new ImageData(drawn.data, drawn.cols, drawn.rows), 0, 0);
    img = { url: canvas.toDataURL('image/png'), cols: drawn.cols, rows: drawn.rows, top: rgbToHex(drawn.top) };
    cache.set(key, img);
    return img;
}

function apply(el, img) {
    el.style.setProperty('--cover-cols', String(img.cols));
    el.style.setProperty('--cover-rows', String(img.rows));
    el.style.setProperty('--cover-top', img.top);
    el.style.backgroundImage = `url(${img.url})`;
}

function schedule() {
    if (scheduled) return;
    scheduled = true;
    // Una tarea por tanda, sin esperar a un rato "libre": con el escenario
    // animándose detrás casi no los hay (medido en 4K: una portada cada 160 ms).
    setTimeout(drain, 0);
}

function drain() {
    scheduled = false;
    const t0 = performance.now();
    while (pending.length > 0 && performance.now() - t0 < SLICE_MS) {
        const { el, spec } = pending.shift();
        // Un elemento que ya no está (se cerró el catálogo) no se dibuja: la portada
        // se hará cuando alguien la vuelva a pedir.
        if (el.isConnected) apply(el, coverImage(spec));
    }
    if (pending.length > 0) schedule();
}

/**
 * Pone la portada de fondo de un elemento: al momento si ya está dibujada; si no,
 * en cuanto el navegador tenga un rato, con el color de su cielo mientras tanto.
 *
 * @param {HTMLElement} el
 * @param {import('../coverModel.js').CoverSpec} spec
 */
export function paintCover(el, spec) {
    el.classList.add('px-cover');
    const cached = cache.get(coverKey(spec));
    if (cached) {
        apply(el, cached);
        return el;
    }
    const top = skyColorAt(skyStateAt(spec.hour, resolveScene(spec.scene), skyState), 0, [0, 0, 0]);
    el.style.setProperty('--cover-top', rgbToHex(top));
    pending.push({ el, spec });
    schedule();
    return el;
}
