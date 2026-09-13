// Sistema de modales slide-in (PS5-style). <dialog> nativo + Tailwind/CSS.
//
// Doc 06 §5 + §10: paneles deslizantes desde la derecha, no páginas nuevas.
// El shader del fondo nunca se oculta — solo se desatura un poco vía backdrop.
//
// API:
//   - createModal(id, { title, body, footer })  → instancia un <dialog> y lo
//     monta en #modal-root. Idempotente: si ya existe el id, devuelve el viejo.
//   - openProfileModal()      — hidrata desde client.getUser(). Si null, CTA login.
//   - openRankingModal()      — ranking global.
//   - openSettingsModal()     — funcional con localStorage.
//   - openPauseModal()        — pausa centrada.
//   - closeAllModals()        — cierra cualquier <dialog> abierto.
//
// El catálogo de niveles vive en `catalog.js` desde la Ola 2 (pantalla casi
// completa, no un panel lateral).

import { getUser, logout, isAuthenticated, request as apiRequest } from '../api/client.js';
import { isBridgeEmbedded } from '../iframe/bridge.js';
import { renderAvatar } from './avatar.js';
import {
    getVolume, setVolume,
    getReduceEffects, setReduceEffects,
    getSkin, setSkin,
    getQuality, setQuality,
    listKeys, clearAll,
} from './settings.js';
import { DINO_SKINS, normalizeSkinId } from '../game/assets/pixelart.js';

const MODAL_ROOT_ID = 'modal-root';

/**
 * @param {string} id
 * @param {{ title: string, body: HTMLElement | string, footer?: HTMLElement }} opts
 * @returns {HTMLDialogElement}
 */
export function createModal(id, opts) {
    const root = document.getElementById(MODAL_ROOT_ID);
    if (root === null) {
        throw new Error(`createModal: #${MODAL_ROOT_ID} no existe en el DOM`);
    }

    const existing = document.getElementById(`modal-${id}`);
    if (existing instanceof HTMLDialogElement) {
        // Reusar: actualizar body/footer si los pasaron de nuevo.
        rebuildModalContent(existing, opts);
        return existing;
    }

    const dialog = document.createElement('dialog');
    dialog.id = `modal-${id}`;
    dialog.className = 'daino-modal';
    dialog.setAttribute('aria-labelledby', `modal-${id}-title`);

    rebuildModalContent(dialog, opts);
    root.appendChild(dialog);
    return dialog;
}

function rebuildModalContent(dialog, opts) {
    const { title, body, footer } = opts;
    dialog.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'modal-shell';

    const header = document.createElement('header');
    header.className = 'modal-header';
    const h2 = document.createElement('h2');
    h2.id = `${dialog.id}-title`;
    h2.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.dataset.interactive = 'true';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dialog.close());
    header.appendChild(h2);
    header.appendChild(closeBtn);
    shell.appendChild(header);

    const bodyEl = document.createElement('section');
    bodyEl.className = 'modal-body';
    if (typeof body === 'string') {
        bodyEl.textContent = body;
    } else if (body instanceof HTMLElement) {
        bodyEl.appendChild(body);
    }
    shell.appendChild(bodyEl);

    if (footer) {
        const footerEl = document.createElement('footer');
        footerEl.className = 'modal-footer';
        footerEl.appendChild(footer);
        shell.appendChild(footerEl);
    }

    dialog.appendChild(shell);

    // Click en backdrop cierra el modal. <dialog>::backdrop no es clicable
    // directamente, pero el click en el dialog cuando el target es el dialog
    // mismo (no un hijo) implica click sobre el área negra.
    dialog.addEventListener('click', (ev) => {
        if (ev.target === dialog) dialog.close();
    });
}

/** Cierra cualquier <dialog> abierto dentro de #modal-root. */
export function closeAllModals() {
    const root = document.getElementById(MODAL_ROOT_ID);
    if (root === null) return;
    for (const d of root.querySelectorAll('dialog[open]')) {
        if (d instanceof HTMLDialogElement) d.close();
    }
}

// --------------------------- Modal: PERFIL ---------------------------

export function openProfileModal() {
    const user = getUser();
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-4';

    if (user !== null) {
        // Usuario logueado — mostrar info + LOGOUT.
        const avatarRow = document.createElement('div');
        avatarRow.className = 'flex items-center gap-3';

        const avatar = renderAvatar(user.avatar_url, user.username, 56, { tag: 'div' });
        avatarRow.appendChild(avatar);

        const meta = document.createElement('div');
        meta.className = 'flex flex-col';
        const username = document.createElement('strong');
        username.textContent = user.username;
        username.style.fontSize = '1.1rem';
        const voutId = document.createElement('span');
        voutId.textContent = `vout_id: ${user.vout_id}`;
        voutId.style.fontSize = '0.75rem';
        voutId.style.opacity = '0.6';
        voutId.style.fontFamily = 'monospace';
        meta.appendChild(username);
        meta.appendChild(voutId);
        avatarRow.appendChild(meta);

        body.appendChild(avatarRow);

        const note = document.createElement('p');
        note.style.fontSize = '0.9rem';
        note.style.opacity = '0.75';
        note.textContent = 'Has iniciado sesión con Vout. Tus marcas se guardan y cuentan para el ranking.';
        body.appendChild(note);
    } else {
        // Anónimo — CTA login.
        const note = document.createElement('p');
        note.textContent = 'No has iniciado sesión. Daino es jugable sin cuenta, pero el ranking global y los niveles compartidos requieren login con Vout.';
        body.appendChild(note);
    }

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '0.5rem';
    footer.style.width = '100%';
    footer.style.justifyContent = 'flex-end';

    if (user !== null) {
        if (isBridgeEmbedded()) {
            // En iframe el LOGOUT no aplica — la sesión la maneja Vout.
            // Botón "Volver al portal" cierra el iframe via postMessage.
            const exitBtn = button('Volver al portal', 'daino-btn');
            exitBtn.addEventListener('click', () => {
                window.parent?.postMessage({ type: 'EXIT' }, '*');  // OJO: parent valida origin de su lado
            });
            footer.appendChild(exitBtn);
        } else {
            const logoutBtn = button('Cerrar sesión', 'daino-btn daino-btn--danger');
            logoutBtn.addEventListener('click', async () => {
                logoutBtn.disabled = true;
                logoutBtn.textContent = 'Cerrando…';
                await logout();
                // El handler de daino:auth:logout en auth.js repintará el chip.
                // Cerramos el modal y rehacemos contenido para reflejar estado.
                const modal = document.getElementById('modal-profile');
                if (modal instanceof HTMLDialogElement) modal.close();
            });
            footer.appendChild(logoutBtn);
        }
    } else {
        const loginLink = document.createElement('a');
        loginLink.href = '/auth/login';
        loginLink.className = 'daino-btn daino-btn--primary';
        loginLink.dataset.interactive = 'true';
        loginLink.textContent = 'Iniciar sesión con Vout';
        footer.appendChild(loginLink);
    }

    const dialog = createModal('profile', {
        title: isAuthenticated() ? 'Tu perfil' : 'Iniciar sesión',
        body,
        footer,
    });
    dialog.showModal();
}

// --------------------------- Modal: RANKING ---------------------------

/**
 * Ranking: top 10 global desde GET /api/ranking. Sin sesión también es
 * accesible — el user ve el leaderboard pero no figura en él. Si está
 * logueado y no aparece, mostramos un hint discreto al final.
 */
export function openRankingModal() {
    const body = document.createElement('div');
    body.className = 'daino-ranking';

    const list = document.createElement('div');
    list.className = 'daino-ranking__list';
    body.appendChild(list);

    const dialog = createModal('ranking', { title: 'Ranking global', body });
    dialog.showModal();

    void loadRanking(list);
}

async function loadRanking(container) {
    container.innerHTML = '';
    container.setAttribute('aria-busy', 'true');
    const loading = document.createElement('p');
    loading.className = 'daino-ranking__loading';
    loading.textContent = 'Cargando ranking…';
    container.appendChild(loading);

    const res = await apiRequest('GET', '/api/ranking?limit=10');
    container.removeAttribute('aria-busy');
    container.innerHTML = '';

    if (!res.ok) {
        const err = document.createElement('p');
        err.className = 'daino-ranking__error';
        err.textContent = `Error ${res.status}: no se pudo cargar el ranking.`;
        container.appendChild(err);
        return;
    }

    const items = res.data?.items ?? [];
    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'daino-ranking__empty';
        empty.textContent = 'Nadie ha jugado todavía. Sé el primero.';
        container.appendChild(empty);
        return;
    }

    const me = getUser();
    let foundMe = false;
    for (const entry of items) {
        const isMine = me !== null && entry.user?.vout_id === me.vout_id;
        if (isMine) foundMe = true;
        container.appendChild(renderRankingRow(entry, isMine));
    }

    if (me !== null && !foundMe) {
        const hint = document.createElement('p');
        hint.className = 'daino-ranking__hint';
        hint.textContent = 'Aún no estás en el top 10. ¡Sigue jugando!';
        container.appendChild(hint);
    } else if (me === null) {
        const cta = document.createElement('p');
        cta.className = 'daino-ranking__hint';
        cta.innerHTML = '<a href="/auth/login" class="daino-btn daino-btn--primary" data-interactive="true">Inicia sesión</a> para que tus partidas cuenten.';
        container.appendChild(cta);
    }
}

function renderRankingRow(entry, isMine) {
    const row = document.createElement('article');
    row.className = 'daino-ranking__row' + (isMine ? ' is-me' : '');

    const rank = document.createElement('span');
    rank.className = 'daino-ranking__rank';
    rank.textContent = `#${entry.rank}`;

    const userBlock = document.createElement('div');
    userBlock.className = 'daino-ranking__user';
    if (entry.user) {
        const avatar = renderAvatar(entry.user.avatar_url, entry.user.username, 32, { tag: 'span' });
        userBlock.appendChild(avatar);
        const name = document.createElement('span');
        name.className = 'daino-ranking__username';
        name.textContent = entry.user.username;
        userBlock.appendChild(name);
    }

    const stats = document.createElement('div');
    stats.className = 'daino-ranking__stats';
    const points = document.createElement('strong');
    points.textContent = entry.total_points.toLocaleString();
    points.title = 'Puntos totales';
    const detail = document.createElement('span');
    detail.className = 'daino-ranking__detail';
    detail.textContent = `${entry.levels_played} niveles · ${entry.avg_percentage}% promedio`;
    stats.appendChild(points);
    stats.appendChild(detail);

    row.appendChild(rank);
    row.appendChild(userBlock);
    row.appendChild(stats);
    return row;
}

// --------------------------- Modal: PAUSA ---------------------------

/**
 * Abre el modal de pausa. Centrado sobre el viewport (no slide-in lateral
 * — la pausa es un break "fuerte", no un panel secundario).
 *
 * @param {{ onResume: () => void, onExit: () => void }} cfg
 */
export function openPauseModal(cfg) {
    let exited = false;

    const body = document.createElement('div');
    body.className = 'daino-pause__body';
    const note = document.createElement('p');
    note.textContent = 'La canción está suspendida. Reanuda para continuar exactamente donde lo dejaste.';
    note.style.opacity = '0.85';
    body.appendChild(note);

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '0.5rem';
    footer.style.justifyContent = 'flex-end';
    footer.style.width = '100%';

    const exitBtn = button('Salir al menú', 'daino-btn daino-btn--danger');
    exitBtn.addEventListener('click', () => {
        exited = true;
        dialog.close();
        cfg.onExit();
    });
    const resumeBtn = button('Reanudar', 'daino-btn daino-btn--primary');
    resumeBtn.addEventListener('click', () => dialog.close());

    footer.appendChild(exitBtn);
    footer.appendChild(resumeBtn);

    const dialog = createModal('pause', { title: 'Pausa', body, footer });
    // El `daino-modal--center` cambia el layout: en lugar de slide-in lateral,
    // queda centrado sobre el viewport. Doc 06 §4.2 lo pinta así.
    dialog.classList.add('daino-modal--center');

    // Cualquier vía de cierre (botón ×, click backdrop, ESC nativo, click
    // Reanudar) que NO haya pasado por "Salir al menú" → equivale a Resume.
    dialog.addEventListener('close', () => {
        if (!exited) cfg.onResume();
    }, { once: true });

    dialog.showModal();
    // Foco inicial al botón Reanudar — Enter accept-cierra.
    queueMicrotask(() => resumeBtn.focus());
}

// --------------------------- Modal: AJUSTES (funcional con localStorage) ---------------------------

/**
 * @param {{ getActiveAudioEngine?: () => any | null }} [opts]
 *   getActiveAudioEngine: callback para obtener el AudioEngine activo y
 *   aplicar volumen en vivo. Lo inyecta el menú al wirear (evita import
 *   circular UI ↔ AppController).
 */
export function openSettingsModal(opts = {}) {
    const getEngine = opts.getActiveAudioEngine ?? (() => null);

    const body = document.createElement('div');
    body.className = 'daino-settings';

    // ----- Volumen master -----
    const volRow = document.createElement('section');
    volRow.className = 'daino-settings__row';
    const volLabel = document.createElement('label');
    volLabel.className = 'daino-settings__label';
    volLabel.textContent = 'Volumen';
    const volValue = document.createElement('span');
    volValue.className = 'daino-settings__value';
    const initialVol = getVolume();
    volValue.textContent = `${Math.round(initialVol * 100)}%`;
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '1';
    volSlider.step = '0.01';
    volSlider.value = String(initialVol);
    volSlider.dataset.interactive = 'true';
    volSlider.setAttribute('aria-label', 'Volumen master');
    volSlider.addEventListener('input', () => {
        const v = Number.parseFloat(volSlider.value);
        setVolume(v, getEngine());
        volValue.textContent = `${Math.round(v * 100)}%`;
    });
    volLabel.setAttribute('for', 'daino-settings-vol');
    volSlider.id = 'daino-settings-vol';
    volRow.appendChild(volLabel);
    volRow.appendChild(volSlider);
    volRow.appendChild(volValue);
    body.appendChild(volRow);

    // ----- Personaje (skin del dino) -----
    const skinRow = document.createElement('section');
    skinRow.className = 'daino-settings__row';
    const skinLabel = document.createElement('label');
    skinLabel.className = 'daino-settings__label';
    skinLabel.htmlFor = 'daino-settings-skin';
    skinLabel.textContent = 'Personaje';
    const skinSelect = document.createElement('select');
    skinSelect.id = 'daino-settings-skin';
    skinSelect.dataset.interactive = 'true';
    skinSelect.className = 'daino-settings__select';
    for (const [id, def] of Object.entries(DINO_SKINS)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = def.label;
        skinSelect.appendChild(opt);
    }
    skinSelect.value = normalizeSkinId(getSkin());
    skinSelect.addEventListener('change', () => {
        setSkin(normalizeSkinId(skinSelect.value));
    });
    const skinNote = document.createElement('p');
    skinNote.className = 'daino-settings__hint';
    skinNote.textContent = 'El dino del menú cambia al instante; la partida lo usa al empezar.';
    skinRow.appendChild(skinLabel);
    skinRow.appendChild(skinSelect);
    skinRow.appendChild(skinNote);
    body.appendChild(skinRow);

    // ----- Calidad gráfica (Ola 1) -----
    const qualityRow = document.createElement('section');
    qualityRow.className = 'daino-settings__row';
    const qualityLabel = document.createElement('label');
    qualityLabel.className = 'daino-settings__label';
    qualityLabel.htmlFor = 'daino-settings-quality';
    qualityLabel.textContent = 'Calidad gráfica';
    const qualitySelect = document.createElement('select');
    qualitySelect.id = 'daino-settings-quality';
    qualitySelect.dataset.interactive = 'true';
    qualitySelect.className = 'daino-settings__select';
    for (const [value, text] of [
        ['auto', 'Automática'],
        ['high', 'Alta'],
        ['medium', 'Media'],
        ['low', 'Baja'],
    ]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        qualitySelect.appendChild(opt);
    }
    qualitySelect.value = getQuality();
    qualitySelect.addEventListener('change', () => {
        setQuality(qualitySelect.value);
    });
    const qualityNote = document.createElement('p');
    qualityNote.className = 'daino-settings__hint';
    qualityNote.textContent = 'Automática baja la calidad sola si detecta tirones. Elegir una fija desactiva ese ajuste.';
    qualityRow.appendChild(qualityLabel);
    qualityRow.appendChild(qualitySelect);
    qualityRow.appendChild(qualityNote);
    body.appendChild(qualityRow);

    // ----- Reducir efectos visuales (placeholder funcional para Bloque 8) -----
    const fxRow = document.createElement('section');
    fxRow.className = 'daino-settings__row';
    const fxLabel = document.createElement('label');
    fxLabel.className = 'daino-settings__label';
    fxLabel.htmlFor = 'daino-settings-fx';
    fxLabel.textContent = 'Reducir efectos visuales';
    const fxToggle = document.createElement('input');
    fxToggle.type = 'checkbox';
    fxToggle.id = 'daino-settings-fx';
    fxToggle.dataset.interactive = 'true';
    fxToggle.checked = getReduceEffects();
    fxToggle.addEventListener('change', () => {
        setReduceEffects(fxToggle.checked);
    });
    const fxNote = document.createElement('p');
    fxNote.className = 'daino-settings__hint';
    fxNote.textContent = 'Se guardará para que partículas y shader extras se desactiven cuando Bloque 8 lo cablée.';
    fxRow.appendChild(fxLabel);
    fxRow.appendChild(fxToggle);
    fxRow.appendChild(fxNote);
    body.appendChild(fxRow);

    // ----- Borrar datos locales -----
    const clearRow = document.createElement('section');
    clearRow.className = 'daino-settings__row';
    const clearLabel = document.createElement('div');
    clearLabel.className = 'daino-settings__label';
    clearLabel.textContent = 'Borrar datos locales';
    const clearNote = document.createElement('p');
    clearNote.className = 'daino-settings__hint';
    const keys = listKeys();
    clearNote.textContent = keys.length === 0
        ? 'Aún no hay datos locales que borrar.'
        : `Borrará ${keys.length} entradas de localStorage (${keys.join(', ')}).`;
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'daino-btn daino-btn--danger';
    clearBtn.dataset.interactive = 'true';
    clearBtn.textContent = 'Borrar';
    clearBtn.disabled = keys.length === 0;
    clearBtn.addEventListener('click', () => {
        const sure = window.confirm('¿Borrar todos los datos locales de Daino? Esto incluye volumen, preferencias y las marcas guardadas sin sesión.');
        if (!sure) return;
        const removed = clearAll();
        clearNote.textContent = `Borradas ${removed} entradas. Recarga para aplicar valores por defecto.`;
        clearBtn.disabled = true;
    });
    clearRow.appendChild(clearLabel);
    clearRow.appendChild(clearNote);
    clearRow.appendChild(clearBtn);
    body.appendChild(clearRow);

    const dialog = createModal('settings', { title: 'Ajustes', body });
    dialog.showModal();
}

// --------------------------- Helpers internos ---------------------------

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
        // Al recargar este módulo, cerramos modales abiertos para evitar
        // estado huérfano entre versiones.
        closeAllModals();
    });
}
