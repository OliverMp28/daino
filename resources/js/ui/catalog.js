// Catálogo de niveles — pantalla de JUGAR (Ola 2).
//
// Sustituye al panel lateral "NIVELES" del Bloque 7, que era una lista de
// archivos en un cajón estrecho. Aquí los niveles tienen la presencia de un
// juego: rejilla a pantalla casi completa, tarjetas grandes con dificultad,
// tempo, duración, tu mejor marca y jugadores, y una ficha por nivel con su
// propio ranking.
//
// Doc 06 §4.1 queda modificado (doc 10, Ola 2): JUGAR abre ESTO. Jugar con
// música propia es una acción aparte y explícita ("Subir mi canción").
//
// Tras el playtest de la Ola 5:
//   - Una sola vista con todos los niveles jugables, oficiales y de la comunidad
//     (la insignia "Oficial" o el autor los distinguen), y "Míos" aparte.
//   - Pulsar una tarjeta JUEGA. La ficha (ranking, publicar, dificultad) se abre
//     con el botón de detalles de la tarjeta: jugar no pasa por ella.
//   - La dificultad solo se elige en un nivel propio listo para publicar.
//   - El escenario (T02) se elige en cualquier nivel propio, también publicado:
//     no cambia el nivel que se juega, solo lo que se ve.
//
// Su aspecto (T04, doc 12): la portada de cada nivel es una miniatura de su
// escenario a una hora del cielo (coverModel.js, pixel/cover.js), y bajo ella una
// línea dice hasta dónde has llegado. Las piezas (botones, etiquetas, estrellas)
// son las de toda la interfaz (kit.js).
//
// Arquitectura:
//   - Qué se enseña lo decide `catalogModel.js` / `publishModel.js` (puros,
//     testeados en Node).
//   - Los datos vienen de `levelsCache.js` (memoria, stale-while-revalidate).
//   - Jugar solo PIDE (`playRequests.js`); AppController carga y arranca.
//   - Es un `<dialog>` en #modal-root: foco atrapado y Esc nativos, y el
//     engine baja el presupuesto de render mientras está abierto (Ola 1).
//   - Tiene dirección (T06): `/niveles`, `/niveles/mios` y `/niveles/12-titulo`
//     para la ficha. El catálogo no toca el historial: dice qué enseña
//     (`catalogView`, `onCatalogView`) y el router pone la dirección; y abre la
//     ficha de un nivel por su número cuando alguien llega con un enlace.

import { isAuthenticated, request as apiRequest, upload as apiUpload, getUser } from '../api/client.js';
import {
    getLevels, invalidateLevels, loadMoreLevels, peekLevels, patchCachedLevel,
} from '../api/levelsCache.js';
import { requestCatalogPlay, requestPrefetch } from './playRequests.js';
import { pickFileViaInput, uploadMaxMb } from './upload.js';
import { createLocalBests } from '../storage/localBests.js';
import { cardView, emptyView, sceneChoiceView, tabsFor, PLAY_MODE, formatPoints } from './catalogModel.js';
import { button, closeButton, el, labelOf, px, pxWords, setLabel, setTag, stars, tag } from './kit.js';
import { paintCover } from './pixel/coverImage.js';
import { pixelText, setPixelText } from './pixel/text.js';
import { rankingGhosts, rankingRow } from './rankingRow.js';
import { DIFFICULTY_NAMES } from '../game/levels/difficulty.js';
import { createModal } from './modals.js';
import { showToast } from './toast.js';
import { routePath } from './routeModel.js';
import { shareLink } from './share.js';
import { analysisView, difficultyChoiceView, PUBLISH_STATE } from './publishModel.js';
import {
    LEVEL_UPDATED_EVENT, changeDifficulty, changeScene, confirmPublish, retryAnalysis, subscribeAnalysis, trackPending,
    trackPublish, withdrawPublish,
} from './publishTracker.js';

const DIALOG_ID = 'modal-catalog';
const SKELETON_CARDS = 8;

const localBests = createLocalBests();

/** Estado de la pantalla. Una sola instancia: el diálogo se reutiliza. */
const ui = {
    /** @type {HTMLDialogElement | null} */
    dialog: null,
    /** @type {'public' | 'mine'} */
    tab: 'public',
    /** @type {object | null} nivel abierto en la ficha */
    detail: null,
    /** Contador para descartar respuestas de una vista que ya no está. */
    renderSeq: 0,
    /** Botón que abrió la ficha (selector), para devolverle el foco al volver. */
    returnFocus: null,
    /** Suscripciones al progreso del análisis de lo que hay pintado (Ola 4). */
    unsubscribers: [],
    /** Nivel cuya tarjeta debe recibir el foco en cuanto se pinte. */
    focusLevelId: null,
    /** Nivel recién jugado: su tarjeta se resalta mientras el catálogo siga abierto. */
    recentLevelId: null,
    /** Nivel cuya ficha se está abriendo por su número (un enlace) y aún no ha llegado. */
    pendingLevelId: null,
};

/** Quien quiere saber cuándo cambia lo que enseña el catálogo (el router, T06). */
const viewListeners = new Set();

/**
 * Qué enseña el catálogo ahora: cerrado, la rejilla de una pestaña o la ficha de
 * un nivel (`level`; solo con su número mientras llega de un enlace).
 *
 * @returns {{ open: boolean, tab: 'public' | 'mine', level: { id: number, title: string | null } | null }}
 */
export function catalogView() {
    const open = ui.dialog?.open === true;
    const level = ui.detail ?? (ui.pendingLevelId !== null ? { id: ui.pendingLevelId, title: null } : null);
    return { open, tab: ui.tab, level: open ? level : null };
}

/**
 * @param {() => void} fn  Se llama cada vez que cambia `catalogView()`.
 * @returns {() => void}   Deja de avisar.
 */
export function onCatalogView(fn) {
    viewListeners.add(fn);
    return () => viewListeners.delete(fn);
}

function viewChanged() {
    for (const fn of viewListeners) fn();
}

/** Suelta las suscripciones de la vista anterior antes de pintar otra. */
function releaseSubscriptions() {
    for (const off of ui.unsubscribers) off();
    ui.unsubscribers = [];
}

// --------------------------- API pública ---------------------------

/**
 * Abre el catálogo, en la rejilla o directamente en la ficha de un nivel.
 *
 * @param {{ tab?: 'public' | 'mine', level?: object, levelId?: number, focusLevelId?: number | null }} [opts]
 *        `focusLevelId`: tarjeta que recibe el foco y se trae a la vista (al
 *        volver de una partida con "Niveles", el nivel que se acaba de jugar).
 *        `levelId`: abre la ficha de ese nivel sin tenerlo aún (un enlace).
 */
export function openCatalog(opts = {}) {
    const dialog = ensureDialog();
    const wanted = opts.tab ?? ui.tab;
    ui.tab = tabsFor(isAuthenticated()).some((t) => t.id === wanted) ? wanted : 'public';
    ui.detail = null;
    ui.pendingLevelId = null;
    ui.focusLevelId = opts.focusLevelId ?? null;
    ui.recentLevelId = opts.focusLevelId ?? null;
    renderShell();
    if (!dialog.open) dialog.showModal();
    if (opts.level) {
        ui.returnFocus = `.daino-card__open[data-level-id="${CSS.escape(String(opts.level.id))}"]`;
        openDetail(opts.level, null);
    } else if (opts.levelId != null) {
        void openDetailById(opts.levelId);
    } else {
        void renderGrid();
    }
    viewChanged();
}

/**
 * La ficha de un nivel del que solo se sabe el número: alguien abrió su enlace.
 * Si no existe (o es privado y no es de quien mira), se dice y queda el catálogo.
 *
 * @param {number} id
 * @param {{ fresh?: boolean }} [opts]  `fresh`: pedirlo siempre (cambió la sesión).
 */
async function openDetailById(id, opts = {}) {
    const show = (level) => {
        // Un nivel propio sin publicar vive en «Míos»: "Volver" lleva ahí.
        const tab = level.is_mine === true && level.is_public !== true ? 'mine' : 'public';
        if (tab !== ui.tab && tabsFor(isAuthenticated()).some((t) => t.id === tab)) {
            ui.tab = tab;
            renderShell();
        }
        ui.returnFocus = `.daino-card__open[data-level-id="${CSS.escape(String(level.id))}"]`;
        openDetail(level, null);
    };

    // ¿Está ya entre lo que se ha cargado? (volver con "adelante" a una ficha).
    for (const tab of opts.fresh ? [] : ['public', 'mine']) {
        const known = peekLevels(tab)?.items.find((l) => l.id === id);
        if (known) {
            show(known);
            return;
        }
    }

    ui.detail = null;
    ui.pendingLevelId = id;
    const seq = ++ui.renderSeq;
    releaseSubscriptions();
    paintSkeleton(mainEl());
    const res = await apiRequest('GET', `/api/levels/${id}`);
    if (seq !== ui.renderSeq || ui.dialog?.open !== true) return;   // ya se está en otra cosa
    ui.pendingLevelId = null;
    if (res.ok && res.data && typeof res.data.id === 'number') {
        show(res.data);
    } else {
        void renderGrid();
        // Mismo aviso si no existe que si es privado: no se dice cuál de los dos.
        showToast(res.status === 404 ? 'Ese nivel no existe o no está publicado.' : 'No se pudo abrir ese nivel.');
    }
    viewChanged();
}

/**
 * Diálogo "Subir mi canción": explica qué pasa con el archivo ANTES de abrir
 * el selector, para que nadie se encuentre un diálogo de archivos por sorpresa.
 */
export function openUploadSong() {
    const body = document.createElement('div');
    body.className = 'daino-upload';

    const lead = el('p', 'daino-upload__lead', 'Juega un nivel creado al momento a partir de tu propio MP3.');
    const points = document.createElement('ul');
    points.className = 'daino-upload__points';
    for (const text of [
        'Se analiza en tu navegador: el archivo no sale de tu equipo.',
        isAuthenticated()
            ? 'Queda guardado en «Míos», y desde ahí puedes publicarlo para que lo juegue cualquiera.'
            : 'Inicia sesión si quieres guardarlo en «Míos» y publicarlo después.',
        `MP3 de hasta ${uploadMaxMb()} MB.`,
    ]) {
        points.appendChild(el('li', null, text));
    }

    // Un botón, no una zona donde soltar: el MP3 se puede soltar en cualquier parte
    // de la ventana, y una zona marcada haría creer que solo vale ahí.
    const pick = button('Elegir MP3', 'daino-btn daino-btn--primary daino-btn--lg daino-upload__pick', { before: '♪' });
    pick.addEventListener('click', () => {
        // El selector se abre DENTRO del clic: gesto de usuario para el audio.
        pickFileViaInput();
    });

    body.append(lead, points, pick, el('p', 'daino-upload__drop-hint', 'o suelta el archivo sobre la ventana'));

    const dialog = createModal('upload-song', { title: 'Subir mi canción', body });
    dialog.classList.add('daino-modal--center');
    if (!dialog.open) dialog.showModal();
    queueMicrotask(() => pick.focus());
}

// --------------------------- Estructura ---------------------------

function ensureDialog() {
    if (ui.dialog !== null && ui.dialog.isConnected) return ui.dialog;
    const root = document.getElementById('modal-root');
    if (root === null) throw new Error('catalog: #modal-root no existe');

    const dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'daino-catalog';
    dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);

    // Esc dentro de la ficha vuelve a la rejilla en vez de cerrar todo.
    dialog.addEventListener('cancel', (ev) => {
        if (ui.detail !== null) {
            ev.preventDefault();
            closeDetail();
        }
    });
    dialog.addEventListener('click', (ev) => {
        if (ev.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
        ui.detail = null;
        ui.pendingLevelId = null;
        ui.renderSeq++;
        // El seguimiento del análisis continúa (publishTracker); solo se deja de pintar.
        releaseSubscriptions();
        viewChanged();
    });

    root.appendChild(dialog);
    ui.dialog = dialog;

    // Una sesión que llega tarde (iframe: el token de Vout puede tardar) o que
    // se cierra cambia las pestañas disponibles.
    const onAuthChange = () => {
        if (!dialog.open) return;
        if (ui.tab === 'mine' && !isAuthenticated()) ui.tab = 'public';
        const levelId = ui.detail?.id ?? ui.pendingLevelId;
        renderShell();
        // Con una ficha abierta se vuelve a pedir el nivel: con otra sesión cambia lo
        // que es tuyo (tu marca, si el nivel es tuyo), o deja de poder verse.
        if (levelId != null) void openDetailById(levelId, { fresh: true });
        else void renderGrid();
    };
    window.addEventListener('daino:auth:login', onAuthChange);
    window.addEventListener('daino:auth:logout', onAuthChange);

    // Un nivel terminó de analizarse (listo, publicado o fallido): la vista
    // abierta se repinta con el nivel nuevo. La caché ya viene actualizada.
    window.addEventListener(LEVEL_UPDATED_EVENT, (ev) => {
        if (!dialog.open) return;
        const { levelId, level, status } = ev.detail;
        if (ui.detail !== null) {
            if (ui.detail.id !== levelId) return;
            const fresh = level ?? {
                is_public: status?.is_public === true,
                publish_ready: status?.publish_ready === true,
                analysis: status?.analysis ?? null,
            };
            openDetail({ ...ui.detail, ...fresh, pending_public: false }, null);
            return;
        }
        void renderGrid();
    });
    return dialog;
}

function renderShell() {
    const dialog = ui.dialog;

    const shell = el('div', 'daino-panel daino-catalog__shell');
    const header = el('header', 'daino-catalog__header');

    const title = pixelText('Niveles', { tag: 'h2', className: 'daino-catalog__title' });
    title.id = `${DIALOG_ID}-title`;

    // Sin sesión hay una sola colección: sin pestañas que no llevan a ningún sitio.
    const available = tabsFor(isAuthenticated());
    const tabs = el('div', 'daino-catalog__tabs');
    if (available.length > 1) {
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Colecciones de niveles');
        for (const tab of available) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'daino-catalog__tab';
            btn.dataset.interactive = 'true';
            btn.appendChild(pixelText(tab.label));
            btn.setAttribute('role', 'tab');
            btn.dataset.tab = tab.id;
            btn.setAttribute('aria-selected', String(tab.id === ui.tab));
            btn.addEventListener('click', () => {
                if (ui.tab === tab.id && ui.detail === null) return;
                ui.tab = tab.id;
                ui.detail = null;
                ui.pendingLevelId = null;
                for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab.id));
                void renderGrid();
                viewChanged();
            });
            tabs.appendChild(btn);
        }
    } else {
        tabs.hidden = true;
    }

    const actions = el('div', 'daino-catalog__header-actions');
    // En una pantalla estrecha queda solo su "+": el nombre lo lleva la etiqueta.
    const uploadBtn = button('Subir mi canción', 'daino-btn daino-btn--sm daino-catalog__upload', { before: '+' });
    uploadBtn.setAttribute('aria-label', 'Subir mi canción');
    uploadBtn.title = 'Subir mi canción';
    uploadBtn.addEventListener('click', () => openUploadSong());
    const close = closeButton(() => ui.dialog.close());
    close.classList.add('daino-catalog__close');
    actions.append(uploadBtn, close);

    header.append(title, tabs, actions);

    const main = el('main', 'daino-catalog__main daino-scroll');
    main.id = `${DIALOG_ID}-main`;
    if (available.length > 1) main.setAttribute('role', 'tabpanel');

    shell.append(header, main);
    dialog.replaceChildren(shell);
}

function mainEl() {
    return ui.dialog.querySelector(`#${DIALOG_ID}-main`);
}

// --------------------------- Rejilla ---------------------------

async function renderGrid() {
    const seq = ++ui.renderSeq;
    const tab = ui.tab;
    const main = mainEl();

    // Lo cacheado se pinta YA (aunque esté pasado); la red solo lo refresca.
    const stale = peekLevels(tab);
    if (stale !== null) paintGrid(main, tab, stale);
    else paintSkeleton(main);

    const res = await getLevels(tab);
    if (seq !== ui.renderSeq) return;
    if (res.ok) {
        paintGrid(main, tab, res.data);
    } else if (stale === null) {
        paintError(main, res.error ?? 'No se pudo cargar el catálogo.', () => { void renderGrid(); });
    }
}

function paintSkeleton(main) {
    main.innerHTML = '';
    main.setAttribute('aria-busy', 'true');
    const grid = el('ul', 'daino-catalog__grid');
    grid.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < SKELETON_CARDS; i++) {
        const li = el('li', 'daino-card daino-card--skeleton');
        li.append(el('div', 'daino-card__cover'), el('div', 'daino-card__mark'), el('div', 'daino-card__body'));
        grid.appendChild(li);
    }
    main.appendChild(grid);
}

function paintError(main, message, retry) {
    main.removeAttribute('aria-busy');
    main.innerHTML = '';
    const box = el('div', 'daino-catalog__state');
    box.setAttribute('role', 'alert');
    const again = button('Reintentar');
    again.addEventListener('click', retry);
    box.append(el('p', null, message), again);
    main.appendChild(box);
}

/**
 * @param {HTMLElement} main
 * @param {string} tab
 * @param {{ items: object[], total: number }} page
 */
function paintGrid(main, tab, page) {
    main.removeAttribute('aria-busy');
    const scroll = main.scrollTop;
    const active = document.activeElement;
    const focusedId = active instanceof HTMLElement && main.contains(active) && active.matches('.daino-card__open')
        ? active.dataset.levelId
        : null;
    main.innerHTML = '';
    releaseSubscriptions();
    // Pendientes de una sesión anterior (recarga a mitad de análisis): se retoman.
    trackPending(page.items);

    if (page.items.length === 0) {
        const view = emptyView(tab);
        const box = el('div', 'daino-catalog__state');
        box.append(pixelText(view.title, { tag: 'h3' }), el('p', null, view.body));
        if (view.action === 'upload') {
            const cta = button('Subir mi canción', 'daino-btn daino-btn--primary');
            cta.addEventListener('click', () => openUploadSong());
            box.appendChild(cta);
        }
        main.appendChild(box);
        return;
    }

    const grid = el('ul', 'daino-catalog__grid');
    for (const level of page.items) {
        grid.appendChild(renderCard(level));
    }
    main.appendChild(grid);

    if (page.items.length < page.total) {
        const more = button(`Cargar más (${page.total - page.items.length})`, 'daino-btn daino-catalog__more');
        more.addEventListener('click', async () => {
            more.disabled = true;
            setLabel(more, 'Cargando…');
            const seq = ui.renderSeq;
            const res = await loadMoreLevels(tab);
            if (seq !== ui.renderSeq) return;
            if (res.ok) {
                paintGrid(main, tab, res.data);
            } else {
                more.disabled = false;
                setLabel(more, 'Reintentar');
            }
        });
        main.appendChild(more);
    }
    main.scrollTop = scroll;

    // Se ve cuál acabas de jugar aunque el foco no pinte anillo (ratón/táctil).
    if (ui.recentLevelId !== null) {
        grid.querySelector(`.daino-card__open[data-level-id="${CSS.escape(String(ui.recentLevelId))}"]`)
            ?.closest('.daino-card')?.setAttribute('data-recent', 'true');
    }
    // Foco: la tarjeta pedida al abrir o, si esto es un repintado (la red
    // refresca lo cacheado), la que lo tenía antes. Sin esto el repintado dejaba
    // el foco en <body> y el teclado perdía su sitio.
    const focusId = ui.focusLevelId ?? focusedId;
    if (focusId !== null) {
        const card = grid.querySelector(`.daino-card__open[data-level-id="${CSS.escape(String(focusId))}"]`);
        if (card instanceof HTMLElement) {
            if (ui.focusLevelId !== null) card.scrollIntoView({ block: 'nearest' });
            ui.focusLevelId = null;
            card.focus({ preventScroll: true });
        }
    }
}

/**
 * Una tarjeta son dos botones hermanos (nunca uno dentro de otro): la tarjeta
 * entera, que JUEGA, y el de detalles, que abre la ficha.
 */
function renderCard(level) {
    const view = cardView(level, localBests.get(level.id));
    const li = el('li', 'daino-card');
    li.dataset.mode = view.playMode;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'daino-card__open daino-cut';
    play.dataset.interactive = 'true';
    play.dataset.levelId = String(level.id);
    play.setAttribute('aria-label', view.actionLabel);
    play.addEventListener('click', () => playFromCatalog(level, view.playMode, play));

    // La portada: el escenario del nivel, a la hora de su dificultad.
    const cover = paintCover(el('div', 'daino-card__cover'), view.cover);
    if (view.badge) {
        const badge = tag(view.badge, view.publish.state);
        badge.classList.add('daino-card__badge');
        cover.appendChild(badge);
        if (view.publish.state === PUBLISH_STATE.ANALYZING) {
            // Porcentaje en la etiqueta mientras se analiza. Solo texto: el
            // progreso detallado (y anunciado) está en la ficha.
            ui.unsubscribers.push(subscribeAnalysis(level.id, (status) => {
                const v = analysisView(status.analysis);
                setTag(badge, v?.progress != null ? `Analizando ${Math.round(v.progress * 100)} %` : 'En cola');
            }));
        }
    }
    // Tu marca: la línea bajo la portada, llena hasta donde llegaste.
    const mark = el('div', 'daino-card__mark');
    const needsFile = view.playMode === PLAY_MODE.NEEDS_FILE;
    if (view.best && !needsFile) {
        mark.style.setProperty('--best', String(view.best.ratio));
        if (view.best.completed) mark.dataset.done = 'true';
    }

    const body = el('div', 'daino-card__body');
    body.append(el('strong', 'daino-card__title', view.title));
    // Siempre presente (aunque vacía) para que todas las tarjetas alineen.
    body.append(el('span', 'daino-card__meta', view.meta || ' '));

    const rank = el('div', 'daino-card__rank');
    rank.append(stars(view.difficulty), px(view.difficulty.name));
    if (view.players) rank.append(el('span', 'daino-card__players', view.players));
    body.append(rank);

    const foot = el('div', 'daino-card__foot');
    if (needsFile) {
        foot.append(px('Juega con tu MP3', 'daino-card__best is-empty'));
    } else if (view.best) {
        const pct = px(view.best.percentage, 'daino-card__best');
        if (view.best.completed) pct.dataset.done = 'true';
        foot.append(pct, px(view.best.points, 'daino-card__points'));
    } else {
        foot.append(px('Sin jugar', 'daino-card__best is-empty'));
    }
    body.append(foot);

    play.append(cover, mark, body);
    if (view.playMode !== PLAY_MODE.UNAVAILABLE) {
        // Qué hace pulsar la tarjeta, sin leer nada: ▶ juega, ♪ pide tu MP3. En el
        // pie, junto al botón de detalles: las dos cosas que se pueden hacer.
        const glyph = el('span', 'daino-card__play daino-cut');
        glyph.setAttribute('aria-hidden', 'true');
        glyph.appendChild(pixelText(view.playMode === PLAY_MODE.NEEDS_FILE ? '♪' : '▶'));
        play.appendChild(glyph);
    }

    const details = button('ℹ', 'daino-btn daino-btn--icon daino-card__details');
    details.dataset.levelId = String(level.id);
    details.setAttribute('aria-label', `Detalles de «${view.title}»`);
    details.title = 'Detalles y ranking';
    details.addEventListener('click', () => openDetail(level, details));

    li.append(play, details);
    return li;
}

/**
 * Lo que hace pulsar un nivel. Dentro del clic: el audio se desbloquea con el
 * gesto (playRequests) y el selector de archivos también lo necesita.
 */
function playFromCatalog(level, mode, fromButton) {
    if (mode === PLAY_MODE.CATALOG) requestCatalogPlay(level);
    else if (mode === PLAY_MODE.NEEDS_FILE) pickFileViaInput({ level });
    else openDetail(level, fromButton);
}

// --------------------------- Ficha ---------------------------

/**
 * @param {object} level
 * @param {HTMLElement | null} fromButton  Lo que la abrió (el foco vuelve ahí).
 * @param {{ focus?: string }} [opts]  `focus`: selector a enfocar al pintarla.
 */
function openDetail(level, fromButton, opts = {}) {
    ui.detail = level;
    ui.pendingLevelId = null;
    viewChanged();
    if (fromButton?.dataset.levelId) {
        // Volver deja el foco en el MISMO botón (el de detalles o la tarjeta).
        const kind = fromButton.classList.contains('daino-card__details') ? '.daino-card__details' : '.daino-card__open';
        ui.returnFocus = `${kind}[data-level-id="${CSS.escape(fromButton.dataset.levelId)}"]`;
    }
    const seq = ++ui.renderSeq;
    const view = cardView(level, localBests.get(level.id));
    const publish = view.publish;
    const main = mainEl();
    main.innerHTML = '';
    main.scrollTop = 0;
    releaseSubscriptions();

    // Intención clara de jugar: se adelanta la descarga de audio y chart.
    if (view.playMode === PLAY_MODE.CATALOG) requestPrefetch(level);

    const detail = el('section', 'daino-detail');

    const back = button('Volver', 'daino-btn daino-btn--ghost daino-btn--sm daino-detail__back', { before: '←' });
    back.addEventListener('click', () => closeDetail());

    const hero = el('div', 'daino-detail__hero');
    const cover = paintCover(el('div', 'daino-detail__cover daino-cut'), view.cover);
    if (view.badge) {
        const badge = tag(view.badge, view.publish.state);
        badge.classList.add('daino-card__badge');
        cover.appendChild(badge);
    }

    const info = el('div', 'daino-detail__info');
    info.append(el('h3', 'daino-detail__title', view.title));
    if (view.byline) info.append(el('p', 'daino-detail__byline', view.byline));

    const stats = el('dl', 'daino-detail__stats');
    addStat(stats, 'Dificultad', [stars(view.difficulty), px(view.difficulty.name)]);
    if (view.bpm) addStat(stats, 'Tempo', view.bpm);
    addStat(stats, 'Duración', view.duration);
    // Un nivel tuyo lo enseña (y lo cambia) en su selector, más abajo.
    if (level.is_mine !== true) addStat(stats, 'Escenario', view.scene);
    if (level.is_public === true) addStat(stats, 'Jugadores', level.players > 0 ? String(level.players) : '—');
    info.appendChild(stats);

    // Tu marca, en el color de lo tuyo (verde si lo superaste).
    let bestBox;
    if (view.best) {
        bestBox = el('p', 'daino-detail__best');
        if (view.best.completed) bestBox.dataset.done = 'true';
        bestBox.append(px('Tu marca', 'daino-detail__best-label'), px(view.best.percentage), px(`${view.best.points} puntos`));
    } else {
        bestBox = el('p', 'daino-detail__best is-empty', 'Aún no lo has jugado.');
    }
    info.appendChild(bestBox);

    const actions = el('div', 'daino-detail__actions');
    const status = el('p', 'daino-detail__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    /** Botones que no se pueden pulsar mientras se aplica una dificultad. */
    const guarded = [];

    if (view.playMode !== PLAY_MODE.UNAVAILABLE) {
        const play = button(view.playLabel, 'daino-btn daino-btn--primary daino-btn--lg daino-detail__play', {
            before: view.playMode === PLAY_MODE.NEEDS_FILE ? '♪' : '▶',
        });
        play.addEventListener('click', () => playFromCatalog(level, view.playMode, play));
        actions.appendChild(play);
        guarded.push(play);
    } else if (publish.state !== PUBLISH_STATE.ANALYZING) {
        status.textContent = 'Este nivel no tiene audio publicado.';
    }
    if (view.playMode === PLAY_MODE.NEEDS_FILE) {
        status.textContent = 'Es privado: su audio está en tu equipo. Para jugarlo, elige el MP3 con el que lo creaste.';
    }

    // Un nivel publicado tiene una dirección que cualquiera puede abrir (T06).
    if (level.is_public === true) {
        const share = button('Compartir', 'daino-btn daino-detail__share');
        share.addEventListener('click', () => { void shareLevel(level, status); });
        actions.appendChild(share);
    }

    if (publish.canRetry) {
        const retry = button('Reintentar análisis');
        retry.addEventListener('click', () => { void retryLevelAnalysis(level, retry, status); });
        actions.appendChild(retry);
    }
    if (publish.canPublish) {
        const failed = publish.state === PUBLISH_STATE.FAILED;
        const start = button(failed ? 'Publicar de nuevo…' : 'Publicar…');
        start.addEventListener('click', () => { void publishLevel(level, start, status); });
        actions.appendChild(start);
    }

    let choice = null;
    if (publish.canConfirm) {
        const name = DIFFICULTY_NAMES[view.difficulty.value];
        const confirm = button(`Publicar en ${name}`, 'daino-btn daino-btn--strong daino-detail__confirm');
        confirm.addEventListener('click', () => { void confirmLevelPublish(level, confirm, status, guarded); });
        actions.appendChild(confirm);
        guarded.push(confirm);

        const withdraw = el('button', 'daino-detail__withdraw', 'No publicar');
        withdraw.type = 'button';
        withdraw.dataset.interactive = 'true';
        withdraw.title = 'Vuelve a ser privado y su audio se borra del servidor';
        withdraw.addEventListener('click', () => { void withdrawLevel(level, withdraw, status); });
        actions.appendChild(withdraw);
        guarded.push(withdraw);

        choice = renderDifficultyChoice(level, guarded, status);
    }

    // Orden de lectura: primero la dificultad (se elige antes de jugar o publicar).
    if (choice !== null) info.appendChild(choice);
    info.append(actions, status);
    if (publish.canPublish && publish.state === PUBLISH_STATE.PRIVATE) {
        info.appendChild(el('p', 'daino-detail__hint',
            'Publicar sube tu MP3 y lo analizamos a fondo. Después eliges su dificultad —solo las que admita la canción— y lo publicas.'));
    }
    if (publish.canConfirm) {
        info.appendChild(el('p', 'daino-detail__hint',
            'Pruébalo con Jugar si quieres. Una vez publicado, su dificultad queda fija para todos.'));
    }
    // El progreso del análisis va antes que el escenario: es lo que se viene a mirar.
    if (publish.analysis !== null) {
        info.appendChild(renderAnalysisPanel(level, publish));
    }
    const sceneChoice = renderSceneChoice(level, status);
    if (sceneChoice !== null) info.appendChild(sceneChoice);

    hero.append(cover, info);
    detail.append(back, hero);

    // El ranking solo existe para lo publicado: lo privado solo lo juega su autor.
    if (level.is_public === true) {
        const rankingBox = el('section', 'daino-detail__ranking');
        rankingBox.setAttribute('aria-labelledby', `${DIALOG_ID}-ranking`);
        const rankingTitle = pixelText('Ranking del nivel', { tag: 'h4' });
        rankingTitle.id = `${DIALOG_ID}-ranking`;
        const rankingList = el('ol', 'daino-ranking__list');
        rankingList.setAttribute('aria-busy', 'true');
        rankingList.append(...rankingGhosts(3));
        const rankingNote = el('p', 'daino-ranking__note');
        rankingNote.hidden = true;
        rankingBox.append(rankingTitle, rankingList, rankingNote);
        detail.appendChild(rankingBox);
        void loadLevelRanking(level, rankingList, rankingNote, seq);
    }

    main.appendChild(detail);
    queueMicrotask(() => {
        const target = (opts.focus && detail.querySelector(opts.focus)) || detail.querySelector('.daino-detail__play, button:not(.daino-detail__back)');
        target?.focus();
    });
}

/**
 * Comparte la dirección de un nivel: por la hoja de compartir del sistema si la
 * hay (un móvil) o copiándola. Si no se puede ni eso, se enseña para copiarla a mano.
 */
async function shareLevel(level, status) {
    const url = new URL(routePath({ name: 'level', id: level.id, title: level.title }), window.location.origin).href;
    const result = await shareLink({ title: `${level.title} · Daino`, text: `Juega «${level.title}» en Daino`, url });
    if (result === 'copied') showToast('Enlace copiado.');
    else if (result === 'failed') status.textContent = url;
}

function closeDetail() {
    ui.detail = null;
    ui.pendingLevelId = null;
    viewChanged();
    void renderGrid().then(() => {
        if (ui.returnFocus !== null) mainEl()?.querySelector(ui.returnFocus)?.focus();
    });
}

/**
 * Un dato de la ficha: su nombre y su valor, los dos en la letra del juego.
 *
 * @param {HTMLElement} dl
 * @param {string} label
 * @param {string | Node[]} value  Texto, o los nodos ya montados (las estrellas).
 */
function addStat(dl, label, value) {
    const wrap = el('div', 'daino-detail__stat');
    const dd = el('dd', null);
    if (Array.isArray(value)) dd.append(...value);
    else dd.appendChild(pixelText(value));
    wrap.append(pixelText(label, { tag: 'dt' }), dd);
    dl.appendChild(wrap);
}

async function loadLevelRanking(level, list, note, seq) {
    const res = await apiRequest('GET', `/api/levels/${level.id}/ranking?limit=10`);
    if (seq !== ui.renderSeq) return;
    list.removeAttribute('aria-busy');
    list.replaceChildren();
    const say = (...nodes) => {
        note.replaceChildren(...nodes);
        note.hidden = false;
    };

    if (!res.ok) {
        say('No se pudo cargar el ranking.');
        return;
    }
    const { items = [], me = null } = res.data ?? {};
    const myVoutId = getUser()?.vout_id ?? null;
    const row = (entry, isMe) => rankingRow({
        rank: entry.rank,
        user: entry.user,
        score: formatPoints(entry.points),
        detail: `${entry.percentage} %`,
        isMe,
    });

    for (const entry of items) {
        list.appendChild(row(entry, entry.user?.vout_id === myVoutId && myVoutId !== null));
    }
    if (me !== null && !items.some((e) => e.user?.vout_id === myVoutId)) {
        list.appendChild(row({ rank: me.rank, user: getUser(), points: me.points, percentage: me.percentage }, true));
    }
    if (!isAuthenticated()) {
        const link = el('a', 'daino-link', 'Inicia sesión');
        link.href = '/auth/login';
        link.dataset.interactive = 'true';
        say(...(items.length === 0 ? ['Nadie ha dejado marca todavía. '] : []), link, ' para que tus partidas entren en el ranking.');
    } else if (items.length === 0) {
        say('Nadie ha dejado marca todavía. La primera puede ser la tuya.');
    }
}

// --------------------------- Publicar ---------------------------

/** Paso 1: sube el MP3 del nivel privado para que el servidor lo analice. */
async function publishLevel(level, btn, status) {
    // El nivel es privado: su MP3 está en el equipo del autor. El servidor
    // comprueba que el archivo es exactamente el del chart.
    const file = await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/mpeg,.mp3';
        input.onchange = (e) => resolve(e.target.files[0] ?? null);
        input.oncancel = () => resolve(null);
        input.click();
    });
    if (file === null) return;

    btn.disabled = true;
    const original = labelOf(btn);
    setLabel(btn, 'Subiendo…');
    status.textContent = '';

    const fd = new FormData();
    fd.append('file', file);
    const res = await apiUpload(`/api/levels/${level.id}/upload`, fd);

    if (res.status === 202 && res.data?.id === level.id) {
        // Subido; el servidor lo analiza. La ficha pasa a enseñar el progreso y
        // el tracker sigue aunque se cierre: al terminar, se elige la dificultad.
        patchCachedLevel(res.data);
        trackPublish(res.data);
        if (ui.detail?.id === level.id) openDetail(res.data, null);
        showToast('Subido. Lo estamos analizando: cuando termine, eliges su dificultad y lo publicas.', 'info');
        return;
    }
    if (res.ok && res.data?.id === level.id) {
        // Sin analizador en el servidor: publicado al instante con el chart local.
        patchCachedLevel(res.data);
        invalidateLevels('public');
        if (ui.detail?.id === level.id) openDetail(res.data, null);
        showToast('¡Publicado! Ya aparece en el catálogo.', 'info');
        return;
    }
    btn.disabled = false;
    setLabel(btn, original);
    status.textContent = res.status === 409 ? 'Ya tienes un nivel público con ese título.'
        : res.status === 413 ? 'Archivo demasiado grande.'
            : res.status === 422 ? (res.data?.fields?.file ?? 'El archivo no es válido.')
                : `No se pudo publicar (error ${res.status}).`;
}

/** Paso 2: publica ya, con la dificultad elegida. */
async function confirmLevelPublish(level, btn, status, guarded) {
    for (const b of guarded) b.disabled = true;
    status.textContent = 'Publicando…';
    const res = await confirmPublish(level);
    if (!res.ok) {
        for (const b of guarded) b.disabled = false;
        status.textContent = res.message;
        return;
    }
    if (ui.detail?.id === level.id) openDetail({ ...level, ...res.level }, null);
    const name = DIFFICULTY_NAMES[res.level.difficulty] ?? '';
    showToast(`¡Publicado${name ? ` en ${name}` : ''}! Ya aparece en el catálogo.`, 'info');
}

async function withdrawLevel(level, btn, status) {
    btn.disabled = true;
    status.textContent = '';
    const res = await withdrawPublish(level);
    if (!res.ok) {
        btn.disabled = false;
        status.textContent = res.message;
        return;
    }
    if (ui.detail?.id === level.id) openDetail({ ...level, ...res.level, analysis: null }, null);
    showToast('No se publicará: vuelve a ser privado y su audio se ha borrado del servidor.', 'info');
}

async function retryLevelAnalysis(level, btn, status) {
    btn.disabled = true;
    status.textContent = '';
    const res = await retryAnalysis(level);
    if (!res.ok) {
        btn.disabled = false;
        status.textContent = res.message;
        return;
    }
    if (ui.detail?.id === level.id) {
        openDetail({ ...level, pending_public: true, publish_ready: false, analysis: { status: 'queued', attempts: 0, queue_position: null } }, null);
    }
}

/**
 * Selector de dificultad de un nivel propio listo para publicar. Qué opciones
 * hay lo decide `difficultyChoiceView`; aquí solo se pinta y se envía. Aplicar
 * una es inmediato (el servidor ya tiene el chart de cada una), pero mientras
 * dura la petición nada que dependa del chart se puede pulsar.
 *
 * @param {object} level
 * @param {HTMLButtonElement[]} guarded  Jugar / Publicar / No publicar.
 * @param {HTMLElement} status
 * @returns {HTMLElement | null}
 */
function renderDifficultyChoice(level, guarded, status) {
    const view = difficultyChoiceView(level);
    if (view === null) return null;

    const box = el('fieldset', 'daino-choice daino-difficulty');
    const legend = pixelText('Dificultad al publicar', { tag: 'legend', className: 'daino-choice__legend' });
    const group = el('div', 'daino-seg daino-difficulty__options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Dificultad al publicar');
    const note = el('p', 'daino-choice__note', view.resetsBest
        ? `${view.note} Cambiarla borra tu marca de prueba.`
        : view.note);

    for (const option of view.options) {
        const selected = option.value === view.current;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'daino-seg__option daino-choice__option daino-difficulty__option';
        b.dataset.interactive = 'true';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(selected));
        b.dataset.value = String(option.value);
        b.append(px(option.label, 'daino-choice__label'), px(option.hint, 'daino-choice__hint'));
        b.addEventListener('click', () => {
            if (b.getAttribute('aria-checked') !== 'true') void applyDifficulty(level, option.value, box, guarded, status);
        });
        group.appendChild(b);
    }
    box.append(legend, group, note);
    return box;
}

async function applyDifficulty(level, value, box, guarded, status) {
    const options = [...box.querySelectorAll('.daino-difficulty__option')];
    const previous = options.find((b) => b.getAttribute('aria-checked') === 'true') ?? null;
    // La elección se ve YA; jugar o publicar esperan a que el servidor la aplique.
    for (const b of options) {
        b.setAttribute('aria-checked', String(b.dataset.value === String(value)));
        b.disabled = true;
    }
    for (const b of guarded) b.disabled = true;
    box.setAttribute('aria-busy', 'true');
    box.dataset.busy = 'true';
    status.textContent = '';

    const res = await changeDifficulty(level, value);
    if (!res.ok) {
        for (const b of options) {
            b.setAttribute('aria-checked', String(b === previous));
            b.disabled = false;
        }
        for (const b of guarded) b.disabled = false;
        box.removeAttribute('aria-busy');
        box.dataset.busy = 'false';
        status.textContent = res.message;
        return;
    }
    if (ui.detail?.id === level.id) {
        // Ficha con el nivel nuevo (estrellas, "Publicar en…", marca), con el
        // foco donde estaba: en la opción elegida.
        openDetail({ ...level, ...res.level, my_best: res.level.my_best ?? null }, null, {
            focus: `.daino-difficulty__option[data-value="${CSS.escape(String(value))}"]`,
        });
    }
}

/**
 * Selector del escenario de un nivel propio (T02.1). Qué opciones hay lo decide
 * `sceneChoiceView`; aquí se pinta (con una muestra del cielo de cada ambiente)
 * y se envía. No toca el chart: jugar y publicar siguen disponibles mientras se
 * aplica.
 *
 * @param {object} level
 * @param {HTMLElement} status
 * @returns {HTMLElement | null}
 */
function renderSceneChoice(level, status) {
    const view = sceneChoiceView(level);
    if (view === null) return null;

    const box = el('fieldset', 'daino-choice daino-scene');
    const legend = pixelText('Escenario', { tag: 'legend', className: 'daino-choice__legend' });
    const group = el('div', 'daino-choice__scenes daino-scene__options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Escenario del nivel');

    for (const option of view.options) {
        const selected = option.value === view.current;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'daino-seg__option daino-scene__option';
        b.dataset.interactive = 'true';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(selected));
        b.dataset.value = option.value;
        // La muestra de cada ambiente es su portada: lo que se va a ver al jugar.
        const thumb = paintCover(el('span', 'daino-scene__thumb'), option.cover);
        thumb.setAttribute('aria-hidden', 'true');
        const text = el('span', 'daino-scene__text');
        text.append(pxWords(option.label, 'daino-scene__label'), el('span', 'daino-scene__hint', option.hint));
        b.append(thumb, text);
        b.addEventListener('click', () => {
            if (b.getAttribute('aria-checked') !== 'true') void applyScene(level, option.value, box, status);
        });
        group.appendChild(b);
    }
    box.append(legend, group, el('p', 'daino-choice__note', 'Solo cambia lo que se ve: el nivel y las marcas son los mismos.'));
    return box;
}

async function applyScene(level, value, box, status) {
    const options = [...box.querySelectorAll('.daino-scene__option')];
    const previous = options.find((b) => b.getAttribute('aria-checked') === 'true') ?? null;
    for (const b of options) {
        b.setAttribute('aria-checked', String(b.dataset.value === value));
        b.disabled = true;
    }
    box.setAttribute('aria-busy', 'true');
    box.dataset.busy = 'true';
    status.textContent = '';

    const res = await changeScene(level, value === 'auto' ? null : value);
    if (!res.ok) {
        for (const b of options) {
            b.setAttribute('aria-checked', String(b === previous));
            b.disabled = false;
        }
        box.removeAttribute('aria-busy');
        box.dataset.busy = 'false';
        status.textContent = res.message;
        return;
    }
    if (ui.detail?.id === level.id) {
        openDetail({ ...level, ...res.level }, null, {
            focus: `.daino-scene__option[data-value="${CSS.escape(value)}"]`,
        });
    }
}

/**
 * Progreso del análisis en la ficha, en vivo. El título y la etapa se anuncian
 * (cambian pocas veces); el porcentaje no, que cambia cada segundo.
 *
 * @param {object} level
 * @param {{ state: string, analysis: object | null }} publish  `publishView(level)`
 */
function renderAnalysisPanel(level, publish) {
    const panel = el('div', 'daino-analysis');
    const head = el('div', 'daino-analysis__head');
    const title = el('strong', 'daino-analysis__title');
    const pct = px('', 'daino-analysis__pct');
    pct.setAttribute('aria-hidden', 'true');
    head.append(title, pct);

    const bar = el('div', 'daino-analysis__bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.appendChild(el('span', 'daino-analysis__fill'));

    const detail = el('p', 'daino-analysis__detail');
    detail.setAttribute('role', 'status');
    detail.setAttribute('aria-live', 'polite');
    const note = el('p', 'daino-analysis__note');

    panel.append(head, bar, detail, note);

    const paint = (view) => {
        if (view === null) return;
        panel.dataset.tone = view.tone;
        if (title.textContent !== view.title) title.textContent = view.title;
        if (detail.textContent !== view.detail) detail.textContent = view.detail;
        const working = view.progress !== null;
        bar.hidden = view.tone === 'error';
        bar.dataset.indeterminate = String(!working);
        setPixelText(pct, working ? `${Math.round(view.progress * 100)} %` : '');
        if (working) {
            bar.style.setProperty('--progress', String(view.progress));
            bar.setAttribute('aria-valuenow', String(Math.round(view.progress * 100)));
        } else {
            bar.removeAttribute('aria-valuenow');
        }
        note.textContent = view.tone === 'error'
            ? ''
            : 'Cuando termine, eliges su dificultad y lo publicas. Puedes cerrar esto y seguir jugando: te avisaremos.';
    };

    paint(publish.analysis);
    if (publish.state === PUBLISH_STATE.ANALYZING) {
        // Solo estados en curso: el desenlace (listo o fallido) lo pinta la
        // ficha entera al recibir LEVEL_UPDATED_EVENT, con sus acciones nuevas.
        ui.unsubscribers.push(subscribeAnalysis(level.id, (s) => {
            const view = analysisView(s.analysis);
            if (view?.active) paint(view);
        }));
    }
    return panel;
}

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        ui.dialog?.close();
        ui.dialog?.remove();
        ui.dialog = null;
    });
}
