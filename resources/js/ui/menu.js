// Modo "no jugando" — menú principal del Bloque 6.
//
// Doc 06 §4.1: título DAINO + lista vertical de 4 acciones. Esquina sup-der
// ya tiene el chip de identidad (auth.js → #auth-anchor); el menú no lo
// toca. Esquina inf-der queda libre — el indicador de volumen idle queda
// diferido (ver § "Lo que NO entra" del plan).
//
// API:
//   - mount({ root, onPlay, onLevels, onRanking, onProfile })  Monta el menú
//     en `root` y registra los callbacks. Idempotente.
//   - dispose()  Quita el menú + listeners.
//
// El mount NO arranca animación — el AppController decide cuándo aparecer
// (al boot inicial, tras game over, etc.). Animación de entrada controlada
// con clase `.is-visible` para que el AppController pueda activar/desactivar
// con CSS sin recrear el DOM.

import { pickFileViaInput } from './upload.js';
import { openLevelsModal, openRankingModal, openProfileModal, openSettingsModal } from './modals.js';
import { prefetchLevels } from '../api/levelsCache.js';

let rootEl = null;
let callbacks = {};

export function mount(opts) {
    if (rootEl !== null) return rootEl;
    const root = opts?.root ?? document.getElementById('menu-root');
    if (root === null) {
        throw new Error('menu.mount: necesita root o #menu-root en DOM');
    }
    callbacks = {
        onPlay: opts.onPlay ?? pickFileViaInput,
        onLevels: opts.onLevels ?? openLevelsModal,
        onRanking: opts.onRanking ?? openRankingModal,
        onProfile: opts.onProfile ?? openProfileModal,
        onSettings: opts.onSettings ?? (() => openSettingsModal()),
    };

    // Precalentar el catálogo (defecto D9). El listado tardaba 1-1.5 s en
    // aparecer porque el fetch no arrancaba hasta que el modal ya estaba
    // abierto. Lanzarlo aquí aprovecha el tiempo que el jugador pasa mirando
    // el menú, así que al pulsar NIVELES la lista suele estar ya en memoria.
    // Es especulativo y silencioso: si falla, la apertura real reintenta.
    prefetchLevels('public');

    rootEl = document.createElement('div');
    rootEl.className = 'daino-menu';
    rootEl.dataset.visible = 'true';   // visible por defecto al mount

    const main = document.createElement('main');
    main.className = 'daino-menu__main';

    const title = document.createElement('h1');
    title.className = 'daino-menu__title';
    title.textContent = 'DAINO';
    main.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'daino-menu__subtitle';
    subtitle.textContent = 'Suelta un MP3 o pulsa JUGAR';
    main.appendChild(subtitle);

    const list = document.createElement('nav');
    list.className = 'daino-menu__actions';
    list.setAttribute('aria-label', 'Acciones principales');

    const actions = [
        { label: 'JUGAR',   key: 'play',    primary: true },
        { label: 'NIVELES', key: 'levels' },
        { label: 'RANKING', key: 'ranking' },
        { label: 'PERFIL',  key: 'profile' },
        { label: 'AJUSTES', key: 'settings' },
    ];

    for (const action of actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'daino-menu__action';
        if (action.primary) btn.classList.add('daino-menu__action--primary');
        btn.dataset.interactive = 'true';
        btn.dataset.action = action.key;
        btn.textContent = action.label;
        btn.addEventListener('click', () => handleAction(action.key));
        list.appendChild(btn);
    }
    main.appendChild(list);

    rootEl.appendChild(main);
    root.appendChild(rootEl);

    return rootEl;
}

function handleAction(key) {
    switch (key) {
        case 'play':     callbacks.onPlay(); return;
        case 'levels':   callbacks.onLevels(); return;
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
