// Modo "no jugando" — menú principal.
//
// Doc 06 §4.1, modificado por el doc 10 (Ola 2):
//   - JUGAR abre el catálogo de niveles. Un jugador nuevo entra, elige un
//     nivel oficial y juega sin tocar ningún archivo.
//   - SUBIR MI CANCIÓN es una acción propia, separada visualmente del bloque
//     de juego y con su propia explicación: nadie pulsa JUGAR y se encuentra un
//     selector de archivos por sorpresa.
//   - NIVELES desaparece como botón: era la misma lista que ahora abre JUGAR.
//
// Esquina sup-der: chip de identidad (auth.js → #auth-anchor), no se toca aquí.
//
// API:
//   - mount({ root, onPlay, onUpload, onRanking, onProfile, onSettings })
//     Monta el menú en `root` y registra los callbacks. Idempotente.
//   - setVisible(boolean)  Muestra/oculta con CSS, sin recrear el DOM.
//   - dispose()            Quita el menú + listeners.

import { openRankingModal, openProfileModal, openSettingsModal } from './modals.js';
import { openCatalog, openUploadSong } from './catalog.js';
import { prefetchLevels } from '../api/levelsCache.js';

let rootEl = null;
let callbacks = {};

export function mount(opts = {}) {
    if (rootEl !== null) return rootEl;
    const root = opts.root ?? document.getElementById('menu-root');
    if (root === null) {
        throw new Error('menu.mount: necesita root o #menu-root en DOM');
    }
    callbacks = {
        onPlay: opts.onPlay ?? (() => openCatalog()),
        onUpload: opts.onUpload ?? openUploadSong,
        onRanking: opts.onRanking ?? openRankingModal,
        onProfile: opts.onProfile ?? openProfileModal,
        onSettings: opts.onSettings ?? (() => openSettingsModal()),
    };

    // Precalentar la pestaña que abre JUGAR (defecto D9): mientras el jugador
    // mira el menú la petición ya está en vuelo, así que el catálogo pinta al
    // instante. Especulativo y silencioso: si falla, la apertura reintenta.
    prefetchLevels('official');

    rootEl = document.createElement('div');
    rootEl.className = 'daino-menu';
    rootEl.dataset.visible = 'true';

    const main = document.createElement('main');
    main.className = 'daino-menu__main';

    const title = document.createElement('h1');
    title.className = 'daino-menu__title';
    title.textContent = 'DAINO';
    main.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'daino-menu__subtitle';
    subtitle.textContent = 'Cada nivel es una canción';
    main.appendChild(subtitle);

    const nav = document.createElement('nav');
    nav.className = 'daino-menu__actions';
    nav.setAttribute('aria-label', 'Acciones principales');

    nav.appendChild(actionButton({ label: 'JUGAR', key: 'play', className: 'daino-menu__action--primary' }));

    // Bloque aparte: música propia. Botón con explicación de una línea para
    // que se entienda qué hace ANTES de pulsarlo.
    const upload = actionButton({ label: 'SUBIR MI CANCIÓN', key: 'upload', className: 'daino-menu__action--upload' });
    const uploadHint = document.createElement('span');
    uploadHint.className = 'daino-menu__action-hint';
    uploadHint.textContent = 'Juega un nivel creado con tu MP3';
    upload.appendChild(uploadHint);
    nav.appendChild(upload);

    const secondary = document.createElement('div');
    secondary.className = 'daino-menu__secondary';
    for (const action of [
        { label: 'RANKING', key: 'ranking' },
        { label: 'PERFIL', key: 'profile' },
        { label: 'AJUSTES', key: 'settings' },
    ]) {
        secondary.appendChild(actionButton(action));
    }
    nav.appendChild(secondary);

    main.appendChild(nav);
    rootEl.appendChild(main);
    root.appendChild(rootEl);

    return rootEl;
}

function actionButton({ label, key, className }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'daino-menu__action';
    if (className) btn.classList.add(className);
    btn.dataset.interactive = 'true';
    btn.dataset.action = key;
    const text = document.createElement('span');
    text.className = 'daino-menu__action-label';
    text.textContent = label;
    btn.appendChild(text);
    btn.addEventListener('click', () => handleAction(key));
    return btn;
}

function handleAction(key) {
    switch (key) {
        case 'play':     callbacks.onPlay(); return;
        case 'upload':   callbacks.onUpload(); return;
        case 'ranking':  callbacks.onRanking(); return;
        case 'profile':  callbacks.onProfile(); return;
        case 'settings': callbacks.onSettings(); return;
    }
}

/** Muestra/oculta el menú con clase CSS. NO desmonta — vuelve rápido. */
export function setVisible(visible) {
    if (rootEl === null) return;
    rootEl.dataset.visible = visible ? 'true' : 'false';
}

export function isMounted() {
    return rootEl !== null;
}

export function dispose() {
    if (rootEl === null) return;
    rootEl.remove();
    rootEl = null;
    callbacks = {};
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => dispose());
}
