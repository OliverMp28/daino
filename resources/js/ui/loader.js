// "Preparando nivel" (T04, doc 12): el aviso que se ve mientras se lee, se descarga
// o se analiza una canción.
//
// Durante el análisis el escenario de detrás está parado (el render cede la CPU al
// analizador, Ola 1): aquí el Dino trota sobre un trozo de suelo, con el personaje
// elegido, y debajo va la fase con su progreso real. Vive en `#hint`, por encima
// del menú y por debajo del HUD.

import { getSkin } from './settings.js';
import { runningDinoEl } from './pixel/sprite.js';
import { pixelText, setPixelText } from './pixel/text.js';

/** @type {{ host: HTMLElement, text: HTMLElement, skin: string } | null} */
let ui = null;

function ensure() {
    const host = document.getElementById('hint');
    if (!host) return null;
    const skin = getSkin();
    // Se rehace si el contenedor es otro (HMR) o si se cambió de personaje.
    if (ui !== null && ui.host === host && ui.skin === skin && host.contains(ui.text)) return ui;
    const ground = document.createElement('span');
    ground.className = 'daino-loader__ground';
    ground.setAttribute('aria-hidden', 'true');
    const text = pixelText('', { className: 'daino-loader__text' });
    host.replaceChildren(runningDinoEl({ skin, className: 'daino-loader__dino' }), ground, text);
    ui = { host, text, skin };
    return ui;
}

/** Enseña el aviso con un texto (la fase de la carga y, si lo hay, su porcentaje). */
export function showLoader(text) {
    const view = ensure();
    if (view === null) return;
    setPixelText(view.text, text);
    view.host.classList.remove('is-hidden');
}

export function hideLoader() {
    document.getElementById('hint')?.classList.add('is-hidden');
}
