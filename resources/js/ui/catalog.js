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
// Arquitectura:
//   - Qué se enseña lo decide `catalogModel.js` / `publishModel.js` (puros,
//     testeados en Node).
//   - Los datos vienen de `levelsCache.js` (memoria, stale-while-revalidate).
//   - Jugar solo PIDE (`playRequests.js`); AppController carga y arranca.
//   - Es un `<dialog>` en #modal-root: foco atrapado y Esc nativos, y el
//     engine baja el presupuesto de render mientras está abierto (Ola 1).

import { isAuthenticated, request as apiRequest, upload as apiUpload, getUser } from '../api/client.js';
import {
    getLevels, invalidateLevels, loadMoreLevels, peekLevels, patchCachedLevel,
} from '../api/levelsCache.js';
import { requestCatalogPlay, requestPrefetch } from './playRequests.js';
import { pickFileViaInput, uploadMaxMb } from './upload.js';
import { createLocalBests } from '../storage/localBests.js';
import { renderAvatar } from './avatar.js';
import { cardView, emptyView, sceneChoiceView, tabsFor, PLAY_MODE, formatPoints } from './catalogModel.js';
import { DIFFICULTY_NAMES } from '../game/levels/difficulty.js';
import { createModal } from './modals.js';
import { showToast } from './toast.js';
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
};

/** Suelta las suscripciones de la vista anterior antes de pintar otra. */
function releaseSubscriptions() {
    for (const off of ui.unsubscribers) off();
    ui.unsubscribers = [];
}

// --------------------------- API pública ---------------------------

/**
 * Abre el catálogo, en la rejilla o directamente en la ficha de un nivel.
 *
 * @param {{ tab?: 'public' | 'mine', level?: object, focusLevelId?: number | null }} [opts]
 *        `focusLevelId`: tarjeta que recibe el foco y se trae a la vista (al
 *        volver de una partida con "Niveles", el nivel que se acaba de jugar).
 */
export function openCatalog(opts = {}) {
    const dialog = ensureDialog();
    const wanted = opts.tab ?? ui.tab;
    ui.tab = tabsFor(isAuthenticated()).some((t) => t.id === wanted) ? wanted : 'public';
    ui.detail = null;
    ui.focusLevelId = opts.focusLevelId ?? null;
    ui.recentLevelId = opts.focusLevelId ?? null;
    renderShell();
    if (!dialog.open) dialog.showModal();
    if (opts.level) {
        ui.returnFocus = `.daino-card__open[data-level-id="${CSS.escape(String(opts.level.id))}"]`;
        openDetail(opts.level, null);
    } else {
        void renderGrid();
    }
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
        `MP3 de hasta ${uploadMaxMb()} MB. También puedes soltarlo sobre la ventana en cualquier momento.`,
    ]) {
        points.appendChild(el('li', null, text));
    }

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'daino-upload__drop';
    drop.dataset.interactive = 'true';
    drop.append(el('span', 'daino-upload__drop-icon', '♪'), el('strong', null, 'Elegir MP3'), el('span', 'daino-upload__drop-hint', 'o arrástralo aquí'));
    drop.addEventListener('click', () => {
        // El selector se abre DENTRO del clic: gesto de usuario para el audio.
        pickFileViaInput();
    });

    body.append(lead, points, drop);

    const dialog = createModal('upload-song', { title: 'Subir mi canción', body });
    dialog.classList.add('daino-modal--center');
    if (!dialog.open) dialog.showModal();
    queueMicrotask(() => drop.focus());
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
        ui.renderSeq++;
        // El seguimiento del análisis continúa (publishTracker); solo se deja de pintar.
        releaseSubscriptions();
    });

    root.appendChild(dialog);
    ui.dialog = dialog;

    // Una sesión que llega tarde (iframe: el token de Vout puede tardar) o que
    // se cierra cambia las pestañas disponibles.
    const onAuthChange = () => {
        if (!dialog.open) return;
        if (ui.tab === 'mine' && !isAuthenticated()) ui.tab = 'public';
        renderShell();
        if (ui.detail === null) void renderGrid();
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
    dialog.innerHTML = '';

    const shell = el('div', 'daino-catalog__shell');
    const header = el('header', 'daino-catalog__header');

    const title = el('h2', 'daino-catalog__title', 'Niveles');
    title.id = `${DIALOG_ID}-title`;

    // Sin sesión hay una sola colección: sin pestañas que no llevan a ningún sitio.
    const available = tabsFor(isAuthenticated());
    const tabs = el('div', 'daino-catalog__tabs');
    if (available.length > 1) {
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Colecciones de niveles');
        for (const tab of available) {
            const btn = button(tab.label, 'daino-catalog__tab');
            btn.setAttribute('role', 'tab');
            btn.dataset.tab = tab.id;
            btn.setAttribute('aria-selected', String(tab.id === ui.tab));
            btn.addEventListener('click', () => {
                if (ui.tab === tab.id && ui.detail === null) return;
                ui.tab = tab.id;
                ui.detail = null;
                for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab.id));
                void renderGrid();
            });
            tabs.appendChild(btn);
        }
    } else {
        tabs.hidden = true;
    }

    const actions = el('div', 'daino-catalog__header-actions');
    const uploadBtn = button('+ Subir mi canción', 'daino-btn daino-catalog__upload');
    uploadBtn.addEventListener('click', () => openUploadSong());
    const close = button('×', 'daino-catalog__close');
    close.setAttribute('aria-label', 'Cerrar');
    close.addEventListener('click', () => ui.dialog.close());
    actions.append(uploadBtn, close);

    header.append(title, tabs, actions);

    const main = el('main', 'daino-catalog__main');
    main.id = `${DIALOG_ID}-main`;
    if (available.length > 1) main.setAttribute('role', 'tabpanel');

    shell.append(header, main);
    dialog.appendChild(shell);
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
        li.append(el('div', 'daino-card__cover'), el('div', 'daino-card__body'));
        grid.appendChild(li);
    }
    main.appendChild(grid);
}

function paintError(main, message, retry) {
    main.removeAttribute('aria-busy');
    main.innerHTML = '';
    const box = el('div', 'daino-catalog__state');
    box.setAttribute('role', 'alert');
    const again = button('Reintentar', 'daino-btn');
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
        box.append(el('h3', null, view.title), el('p', null, view.body));
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
            more.textContent = 'Cargando…';
            const seq = ui.renderSeq;
            const res = await loadMoreLevels(tab);
            if (seq !== ui.renderSeq) return;
            if (res.ok) {
                paintGrid(main, tab, res.data);
            } else {
                more.disabled = false;
                more.textContent = 'Reintentar';
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
    li.style.setProperty('--hue', String(view.hue));
    li.dataset.mode = view.playMode;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'daino-card__open';
    play.dataset.interactive = 'true';
    play.dataset.levelId = String(level.id);
    play.setAttribute('aria-label', view.actionLabel);
    play.addEventListener('click', () => playFromCatalog(level, view.playMode, play));

    const cover = el('div', 'daino-card__cover');
    cover.appendChild(renderEq(level.id));
    if (view.badge) {
        const badge = el('span', 'daino-card__badge', view.badge);
        badge.dataset.state = view.publish.state;
        cover.appendChild(badge);
        if (view.publish.state === PUBLISH_STATE.ANALYZING) {
            // Porcentaje en la insignia mientras se analiza. Solo texto: el
            // progreso detallado (y anunciado) está en la ficha.
            ui.unsubscribers.push(subscribeAnalysis(level.id, (status) => {
                const v = analysisView(status.analysis);
                const text = v?.progress != null ? `Analizando ${Math.round(v.progress * 100)} %` : 'En cola';
                if (badge.textContent !== text) badge.textContent = text;
            }));
        }
    }
    cover.appendChild(renderStars(view.difficulty));
    if (view.playMode !== PLAY_MODE.UNAVAILABLE) {
        // Qué hace pulsar la tarjeta, sin leer nada: ▶ juega, ♪ pide tu MP3.
        const glyph = el('span', 'daino-card__glyph', view.playMode === PLAY_MODE.NEEDS_FILE ? '♪' : '▶');
        glyph.setAttribute('aria-hidden', 'true');
        cover.appendChild(glyph);
    }

    const body = el('div', 'daino-card__body');
    body.append(el('strong', 'daino-card__title', view.title));
    // Siempre presente (aunque vacía) para que todas las tarjetas alineen.
    body.append(el('span', 'daino-card__byline', view.byline || ' '));
    const meta = el('span', 'daino-card__meta', [view.bpm, view.duration].filter(Boolean).join(' · '));
    body.append(meta);

    const foot = el('div', 'daino-card__foot');
    let footText = view.best ? `Mejor: ${view.best.points} · ${view.best.percentage}` : 'Sin jugar';
    if (view.playMode === PLAY_MODE.NEEDS_FILE) footText = 'Juega con tu MP3';
    foot.append(el('span', view.best && view.playMode !== PLAY_MODE.NEEDS_FILE ? 'daino-card__best' : 'daino-card__best is-empty', footText));
    if (view.players) foot.append(el('span', 'daino-card__players', view.players));
    body.append(foot);

    play.append(cover, body);

    const details = button('', 'daino-card__details');
    details.dataset.levelId = String(level.id);
    details.setAttribute('aria-label', `Detalles de «${view.title}»`);
    details.title = 'Detalles y ranking';
    details.appendChild(el('span', null, 'i'));
    details.firstChild.setAttribute('aria-hidden', 'true');
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

/** Barras de "ecualizador" decorativas, estables por nivel (sin animación JS). */
function renderEq(seed) {
    const eq = el('span', 'daino-card__eq');
    eq.setAttribute('aria-hidden', 'true');
    let x = (Number(seed) * 2654435761) >>> 0;
    for (let i = 0; i < 12; i++) {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        const bar = el('span', null);
        bar.style.setProperty('--h', `${25 + (x % 70)}%`);
        eq.appendChild(bar);
    }
    return eq;
}

function renderStars(difficulty) {
    const stars = el('span', 'daino-stars');
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', difficulty.label);
    stars.title = difficulty.name;
    for (let i = 1; i <= 5; i++) {
        stars.appendChild(el('span', i <= difficulty.filled ? 'is-on' : null, '★'));
    }
    return stars;
}

// --------------------------- Ficha ---------------------------

/**
 * @param {object} level
 * @param {HTMLElement | null} fromButton  Lo que la abrió (el foco vuelve ahí).
 * @param {{ focus?: string }} [opts]  `focus`: selector a enfocar al pintarla.
 */
function openDetail(level, fromButton, opts = {}) {
    ui.detail = level;
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
    detail.style.setProperty('--hue', String(view.hue));

    const back = button('← Volver', 'daino-detail__back');
    back.addEventListener('click', () => closeDetail());

    const hero = el('div', 'daino-detail__hero');
    const cover = el('div', 'daino-card__cover daino-detail__cover');
    cover.appendChild(renderEq(level.id));
    if (view.badge) cover.appendChild(el('span', 'daino-card__badge', view.badge));

    const info = el('div', 'daino-detail__info');
    info.append(el('h3', 'daino-detail__title', view.title));
    if (view.byline) info.append(el('p', 'daino-detail__byline', view.byline));

    const stats = el('dl', 'daino-detail__stats');
    addStat(stats, 'Dificultad', renderStars(view.difficulty), view.difficulty.name);
    if (view.bpm) addStat(stats, 'Tempo', view.bpm);
    addStat(stats, 'Duración', view.duration);
    // Un nivel tuyo lo enseña (y lo cambia) en su selector, más abajo.
    if (level.is_mine !== true) addStat(stats, 'Escenario', view.scene);
    if (level.is_public === true) addStat(stats, 'Jugadores', level.players > 0 ? String(level.players) : '—');
    info.appendChild(stats);

    const bestBox = el('p', view.best ? 'daino-detail__best' : 'daino-detail__best is-empty');
    bestBox.textContent = view.best
        ? `Tu mejor marca: ${view.best.points} puntos · ${view.best.percentage}${view.best.completed ? ' · completado' : ''}`
        : 'Aún no lo has jugado.';
    info.appendChild(bestBox);

    const actions = el('div', 'daino-detail__actions');
    const status = el('p', 'daino-detail__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    /** Botones que no se pueden pulsar mientras se aplica una dificultad. */
    const guarded = [];

    if (view.playMode !== PLAY_MODE.UNAVAILABLE) {
        const play = button(view.playLabel, 'daino-btn daino-btn--primary daino-detail__play');
        play.addEventListener('click', () => playFromCatalog(level, view.playMode, play));
        actions.appendChild(play);
        guarded.push(play);
    } else if (publish.state !== PUBLISH_STATE.ANALYZING) {
        status.textContent = 'Este nivel no tiene audio publicado.';
    }
    if (view.playMode === PLAY_MODE.NEEDS_FILE) {
        status.textContent = 'Es privado: su audio está en tu equipo. Para jugarlo, elige el MP3 con el que lo creaste.';
    }

    if (publish.canRetry) {
        const retry = button('Reintentar análisis', 'daino-btn');
        retry.addEventListener('click', () => { void retryLevelAnalysis(level, retry, status); });
        actions.appendChild(retry);
    }
    if (publish.canPublish) {
        const failed = publish.state === PUBLISH_STATE.FAILED;
        const start = button(failed ? 'Publicar de nuevo…' : 'Publicar…', 'daino-btn');
        start.addEventListener('click', () => { void publishLevel(level, start, status); });
        actions.appendChild(start);
    }

    let choice = null;
    if (publish.canConfirm) {
        const name = DIFFICULTY_NAMES[view.difficulty.value];
        const confirm = button(`Publicar en ${name}`, 'daino-btn daino-detail__confirm');
        confirm.addEventListener('click', () => { void confirmLevelPublish(level, confirm, status, guarded); });
        actions.appendChild(confirm);
        guarded.push(confirm);

        const withdraw = button('No publicar', 'daino-detail__withdraw');
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
    const sceneChoice = renderSceneChoice(level, status);
    if (sceneChoice !== null) info.appendChild(sceneChoice);
    if (publish.analysis !== null) {
        info.appendChild(renderAnalysisPanel(level, publish));
    }

    hero.append(cover, info);
    detail.append(back, hero);

    // El ranking solo existe para lo publicado: lo privado solo lo juega su autor.
    if (level.is_public === true) {
        const rankingBox = el('section', 'daino-detail__ranking');
        rankingBox.setAttribute('aria-labelledby', `${DIALOG_ID}-ranking`);
        const rankingTitle = el('h4', null, 'Ranking del nivel');
        rankingTitle.id = `${DIALOG_ID}-ranking`;
        const rankingList = el('ol', 'daino-detail__ranking-list');
        rankingList.setAttribute('aria-busy', 'true');
        rankingList.appendChild(el('li', 'daino-detail__ranking-empty', 'Cargando…'));
        rankingBox.append(rankingTitle, rankingList);
        detail.appendChild(rankingBox);
        void loadLevelRanking(level, rankingList, seq);
    }

    main.appendChild(detail);
    queueMicrotask(() => {
        const target = (opts.focus && detail.querySelector(opts.focus)) || detail.querySelector('.daino-detail__play, button:not(.daino-detail__back)');
        target?.focus();
    });
}

function closeDetail() {
    ui.detail = null;
    void renderGrid().then(() => {
        if (ui.returnFocus !== null) mainEl()?.querySelector(ui.returnFocus)?.focus();
    });
}

function addStat(dl, label, value, title) {
    const wrap = el('div', 'daino-detail__stat');
    const dd = el('dd', null);
    if (value instanceof HTMLElement) dd.appendChild(value);
    else dd.textContent = value;
    if (title) dd.title = title;
    wrap.append(el('dt', null, label), dd);
    dl.appendChild(wrap);
}

async function loadLevelRanking(level, list, seq) {
    const res = await apiRequest('GET', `/api/levels/${level.id}/ranking?limit=10`);
    if (seq !== ui.renderSeq) return;
    list.removeAttribute('aria-busy');
    list.innerHTML = '';

    if (!res.ok) {
        list.appendChild(el('li', 'daino-detail__ranking-empty', 'No se pudo cargar el ranking.'));
        return;
    }
    const { items = [], me = null } = res.data ?? {};
    const myVoutId = getUser()?.vout_id ?? null;

    if (items.length === 0) {
        list.appendChild(el('li', 'daino-detail__ranking-empty', 'Nadie ha dejado marca todavía. La primera puede ser la tuya.'));
    }
    for (const entry of items) {
        list.appendChild(rankingRow(entry, entry.user?.vout_id === myVoutId && myVoutId !== null));
    }
    if (me !== null && !items.some((e) => e.user?.vout_id === myVoutId)) {
        list.appendChild(rankingRow({ rank: me.rank, user: getUser(), points: me.points, percentage: me.percentage }, true));
    }
    if (!isAuthenticated()) {
        const hint = el('li', 'daino-detail__ranking-hint');
        const link = document.createElement('a');
        link.href = '/auth/login';
        link.textContent = 'Inicia sesión';
        link.dataset.interactive = 'true';
        hint.append(link, document.createTextNode(' para que tus partidas entren en el ranking.'));
        list.appendChild(hint);
    }
}

function rankingRow(entry, isMe) {
    const li = el('li', isMe ? 'daino-detail__ranking-row is-me' : 'daino-detail__ranking-row');
    li.append(el('span', 'daino-detail__rank', `#${entry.rank}`));
    const who = el('span', 'daino-detail__who');
    if (entry.user) {
        who.append(renderAvatar(entry.user.avatar_url, entry.user.username, 28, { tag: 'span' }), el('span', null, entry.user.username));
    }
    li.append(who, el('span', 'daino-detail__score', `${formatPoints(entry.points)} · ${entry.percentage} %`));
    return li;
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
    const original = btn.textContent;
    btn.textContent = 'Subiendo…';
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
    btn.textContent = original;
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

    const box = el('fieldset', 'daino-difficulty');
    const legend = el('legend', 'daino-difficulty__legend', 'Dificultad al publicar');
    const group = el('div', 'daino-difficulty__options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Dificultad al publicar');
    const note = el('p', 'daino-difficulty__note', view.resetsBest
        ? `${view.note} Cambiarla borra tu marca de prueba.`
        : view.note);

    for (const option of view.options) {
        const selected = option.value === view.current;
        const b = button('', 'daino-difficulty__option');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(selected));
        b.dataset.value = String(option.value);
        b.append(el('span', 'daino-difficulty__label', option.label), el('span', 'daino-difficulty__hint', option.hint));
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

    const box = el('fieldset', 'daino-scene');
    const legend = el('legend', 'daino-scene__legend', 'Escenario');
    const group = el('div', 'daino-scene__options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Escenario del nivel');

    for (const option of view.options) {
        const selected = option.value === view.current;
        const b = button('', 'daino-scene__option');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(selected));
        b.dataset.value = option.value;
        const swatch = el('span', 'daino-scene__swatch');
        swatch.setAttribute('aria-hidden', 'true');
        const s = option.swatch;
        swatch.style.background = `linear-gradient(to bottom, ${s.top} 0%, ${s.mid} 38%, ${s.horizon} 64%, ${s.land} 64%, ${s.land} 100%)`;
        const text = el('span', 'daino-scene__text');
        text.append(el('span', 'daino-scene__label', option.label), el('span', 'daino-scene__hint', option.hint));
        b.append(swatch, text);
        b.addEventListener('click', () => {
            if (b.getAttribute('aria-checked') !== 'true') void applyScene(level, option.value, box, status);
        });
        group.appendChild(b);
    }
    box.append(legend, group, el('p', 'daino-scene__note', 'Solo cambia lo que se ve: el nivel y las marcas son los mismos.'));
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
    const pct = el('span', 'daino-analysis__pct');
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
        pct.textContent = working ? `${Math.round(view.progress * 100)} %` : '';
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

// --------------------------- Helpers ---------------------------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(label, className) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.dataset.interactive = 'true';
    b.textContent = label;
    return b;
}

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        ui.dialog?.close();
        ui.dialog?.remove();
        ui.dialog = null;
    });
}
