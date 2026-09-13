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
// Arquitectura:
//   - Qué se enseña lo decide `catalogModel.js` (puro, testeado en Node).
//   - Los datos vienen de `levelsCache.js` (memoria, stale-while-revalidate).
//   - Jugar solo PIDE (`playRequests.js`); AppController carga y arranca.
//   - Es un `<dialog>` en #modal-root: foco atrapado y Esc nativos, y el
//     engine baja el presupuesto de render mientras está abierto (Ola 1).

import { isAuthenticated, request as apiRequest, upload as apiUpload, getUser } from '../api/client.js';
import {
    getLevels, loadMoreLevels, peekLevels, invalidateLevels, patchCachedLevel,
} from '../api/levelsCache.js';
import { requestCatalogPlay, requestPrefetch } from './playRequests.js';
import { pickFileViaInput, uploadMaxMb } from './upload.js';
import { createLocalBests } from '../storage/localBests.js';
import { renderAvatar } from './avatar.js';
import { cardView, emptyView, tabsFor, PLAY_MODE, formatPoints } from './catalogModel.js';
import { createModal } from './modals.js';
import { showToast } from './toast.js';

const DIALOG_ID = 'modal-catalog';
const SKELETON_CARDS = 8;

const localBests = createLocalBests();

/** Estado de la pantalla. Una sola instancia: el diálogo se reutiliza. */
const ui = {
    /** @type {HTMLDialogElement | null} */
    dialog: null,
    /** @type {'official' | 'community' | 'mine'} */
    tab: 'official',
    /** @type {object | null} nivel abierto en la ficha */
    detail: null,
    /** Contador para descartar respuestas de una vista que ya no está. */
    renderSeq: 0,
    /** Tarjeta que abrió la ficha, para devolverle el foco al volver. */
    returnFocusId: null,
};

// --------------------------- API pública ---------------------------

/**
 * Abre el catálogo, en la rejilla o directamente en la ficha de un nivel.
 *
 * @param {{ tab?: 'official' | 'community' | 'mine', level?: object }} [opts]
 */
export function openCatalog(opts = {}) {
    const dialog = ensureDialog();
    const wanted = opts.tab ?? ui.tab;
    ui.tab = tabsFor(isAuthenticated()).some((t) => t.id === wanted) ? wanted : 'official';
    ui.detail = null;
    renderShell();
    if (!dialog.open) dialog.showModal();
    if (opts.level) {
        ui.returnFocusId = String(opts.level.id);
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
    });

    root.appendChild(dialog);
    ui.dialog = dialog;

    // Una sesión que llega tarde (iframe: el token de Vout puede tardar) o que
    // se cierra cambia las pestañas disponibles.
    const onAuthChange = () => {
        if (!dialog.open) return;
        if (ui.tab === 'mine' && !isAuthenticated()) ui.tab = 'official';
        renderShell();
        if (ui.detail === null) void renderGrid();
    };
    window.addEventListener('daino:auth:login', onAuthChange);
    window.addEventListener('daino:auth:logout', onAuthChange);
    return dialog;
}

function renderShell() {
    const dialog = ui.dialog;
    dialog.innerHTML = '';

    const shell = el('div', 'daino-catalog__shell');
    const header = el('header', 'daino-catalog__header');

    const title = el('h2', 'daino-catalog__title', 'Niveles');
    title.id = `${DIALOG_ID}-title`;

    const tabs = el('div', 'daino-catalog__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Colecciones de niveles');
    for (const tab of tabsFor(isAuthenticated())) {
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
    main.setAttribute('role', 'tabpanel');

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
    main.innerHTML = '';

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
}

function renderCard(level) {
    const view = cardView(level, localBests.get(level.id));
    const li = el('li', 'daino-card');
    li.style.setProperty('--hue', String(view.hue));

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'daino-card__open';
    open.dataset.interactive = 'true';
    open.dataset.levelId = String(level.id);
    open.setAttribute('aria-label', `${view.title}. ${view.difficulty.label}. ${view.duration}.`);
    open.addEventListener('click', () => openDetail(level, open));

    const cover = el('div', 'daino-card__cover');
    cover.appendChild(renderEq(level.id));
    if (view.badge) cover.appendChild(el('span', 'daino-card__badge', view.badge));
    cover.appendChild(renderStars(view.difficulty));

    const body = el('div', 'daino-card__body');
    body.append(el('strong', 'daino-card__title', view.title));
    // Siempre presente (aunque vacía) para que todas las tarjetas alineen.
    body.append(el('span', 'daino-card__byline', view.byline || ' '));
    const meta = el('span', 'daino-card__meta', [view.bpm, view.duration].filter(Boolean).join(' · '));
    body.append(meta);

    const foot = el('div', 'daino-card__foot');
    foot.append(el('span', view.best ? 'daino-card__best' : 'daino-card__best is-empty',
        view.best ? `Mejor: ${view.best.points} · ${view.best.percentage}` : 'Sin jugar'));
    if (view.players) foot.append(el('span', 'daino-card__players', view.players));
    body.append(foot);

    open.append(cover, body);
    li.appendChild(open);
    return li;
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

function openDetail(level, fromButton) {
    ui.detail = level;
    if (fromButton) ui.returnFocusId = fromButton.dataset.levelId ?? null;
    const seq = ++ui.renderSeq;
    const view = cardView(level, localBests.get(level.id));
    const main = mainEl();
    main.innerHTML = '';
    main.scrollTop = 0;

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
    addStat(stats, 'Jugadores', level.players > 0 ? String(level.players) : '—');
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

    if (view.playMode !== PLAY_MODE.UNAVAILABLE) {
        const play = button(view.playLabel, 'daino-btn daino-btn--primary daino-detail__play');
        play.addEventListener('click', () => {
            if (view.playMode === PLAY_MODE.CATALOG) {
                requestCatalogPlay(level);
            } else {
                pickFileViaInput({ level });
            }
        });
        actions.appendChild(play);
        queueMicrotask(() => play.focus());
    } else {
        status.textContent = 'Este nivel no tiene audio publicado.';
    }
    if (view.playMode === PLAY_MODE.NEEDS_FILE) {
        status.textContent = 'Es privado: su audio está en tu equipo. Elige el MP3 con el que lo creaste.';
    }
    if (view.canPublish) {
        const publish = button('Publicar', 'daino-btn');
        publish.addEventListener('click', () => { void publishLevel(level, publish, status); });
        actions.appendChild(publish);
    }
    info.append(actions, status);

    hero.append(cover, info);

    const rankingBox = el('section', 'daino-detail__ranking');
    rankingBox.setAttribute('aria-labelledby', `${DIALOG_ID}-ranking`);
    const rankingTitle = el('h4', null, 'Ranking del nivel');
    rankingTitle.id = `${DIALOG_ID}-ranking`;
    const rankingList = el('ol', 'daino-detail__ranking-list');
    rankingList.setAttribute('aria-busy', 'true');
    rankingList.appendChild(el('li', 'daino-detail__ranking-empty', 'Cargando…'));
    rankingBox.append(rankingTitle, rankingList);

    detail.append(back, hero, rankingBox);
    main.appendChild(detail);

    void loadLevelRanking(level, rankingList, seq);
}

function closeDetail() {
    ui.detail = null;
    void renderGrid().then(() => {
        const id = ui.returnFocusId;
        if (id === null) return;
        mainEl()?.querySelector(`[data-level-id="${CSS.escape(id)}"]`)?.focus();
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

    if (res.ok && res.data?.id === level.id) {
        patchCachedLevel(res.data);
        invalidateLevels('community');
        // La ficha se repinta ya como pública; el aviso va aparte para que el
        // repintado no lo borre.
        if (ui.detail?.id === level.id) openDetail(res.data, null);
        showToast('¡Publicado! Ya aparece en «De la comunidad».', 'info');
        return;
    }
    btn.disabled = false;
    btn.textContent = original;
    status.textContent = res.status === 409 ? 'Ya tienes un nivel público con ese título.'
        : res.status === 413 ? 'Archivo demasiado grande.'
            : res.status === 422 ? (res.data?.fields?.file ?? 'El archivo no es válido.')
                : `No se pudo publicar (error ${res.status}).`;
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
