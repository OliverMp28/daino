// Paneles de la interfaz. <dialog> nativo + CSS (resources/css/ui/dialogs.css).
//
// Doc 06 §5 + §10: paneles que entran desde la derecha, no páginas nuevas. La
// escena de detrás sigue viva y nítida: solo se oscurece (T04: sin desenfoque).
//
// API:
//   - createModal(id, { title, body, footer })  → instancia un <dialog> y lo
//     monta en #modal-root. Idempotente: si ya existe el id, lo reutiliza.
//   - openProfileModal()      — quién eres, o cómo iniciar sesión.
//   - openRankingModal()      — ranking global.
//   - openSettingsModal()     — ajustes, guardados en este navegador.
//   - closeAllModals()        — cierra cualquier <dialog> abierto.
//
// El catálogo de niveles vive en `catalog.js` (pantalla casi completa) y la pausa
// y los resultados de una partida, en `runPanel.js`.

import { getUser, logout, isAuthenticated, request as apiRequest } from '../api/client.js';
import { isBridgeEmbedded } from '../iframe/bridge.js';
import { renderAvatar } from './avatar.js';
import {
    getVolume, setVolume,
    getFxLevel, setFxLevel,
    getSkin, setSkin,
    getQuality, setQuality,
    getAutoRetry, setAutoRetry,
    listKeys, clearAll,
} from './settings.js';
import { DINO_SKINS, normalizeSkinId } from '../game/assets/pixelart.js';
import { button, closeButton, el, linkButton, px, range, segmented, setLabel } from './kit.js';
import { pixelText, setPixelText } from './pixel/text.js';
import { spriteEl } from './pixel/sprite.js';
import { formatPoints } from './catalogModel.js';
import { rankingGhosts, rankingRow } from './rankingRow.js';

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
    // Clic en el velo cierra: el `::backdrop` no es clicable, pero un clic cuyo
    // destino es el propio <dialog> (no un hijo) cayó fuera del panel.
    dialog.addEventListener('click', (ev) => {
        if (ev.target === dialog) dialog.close();
    });

    rebuildModalContent(dialog, opts);
    root.appendChild(dialog);
    return dialog;
}

function rebuildModalContent(dialog, opts) {
    const { title, body, footer } = opts;

    const shell = el('div', 'modal-shell');

    const header = el('header', 'modal-header');
    const h2 = pixelText(title, { tag: 'h2' });
    h2.id = `${dialog.id}-title`;
    const close = closeButton(() => dialog.close());
    close.classList.add('modal-close');
    header.append(h2, close);

    const bodyEl = el('section', 'modal-body daino-scroll');
    if (typeof body === 'string') bodyEl.textContent = body;
    else if (body instanceof HTMLElement) bodyEl.appendChild(body);

    shell.append(header, bodyEl);
    if (footer) {
        const footerEl = el('footer', 'modal-footer');
        footerEl.appendChild(footer);
        shell.appendChild(footerEl);
    }
    dialog.replaceChildren(shell);
}

/** Cierra cualquier <dialog> abierto dentro de #modal-root. */
export function closeAllModals() {
    const root = document.getElementById(MODAL_ROOT_ID);
    if (root === null) return;
    for (const d of root.querySelectorAll('dialog[open]')) {
        if (d instanceof HTMLDialogElement) d.close();
    }
}

// --------------------------- PERFIL ---------------------------

export function openProfileModal() {
    const user = getUser();
    const body = el('div', 'daino-profile');

    if (user !== null) {
        const who = el('div', 'daino-profile__who');
        const meta = el('div');
        meta.append(el('strong', 'daino-profile__name', user.username), el('span', 'daino-profile__id', `vout_id: ${user.vout_id}`));
        who.append(renderAvatar(user.avatar_url, user.username, 56, { tag: 'div' }), meta);
        body.append(who, el('p', null, 'Has iniciado sesión con Vout. Tus marcas se guardan y cuentan para el ranking.'));
    } else {
        body.appendChild(el('p', null, 'Daino se juega sin cuenta. Con tu sesión de Vout, tus marcas entran en el ranking y puedes guardar y publicar tus niveles.'));
    }

    let footer;
    if (user === null) {
        footer = linkButton('Iniciar sesión con Vout', '/auth/login', 'daino-btn daino-btn--strong');
    } else if (isBridgeEmbedded()) {
        // En iframe cerrar sesión no aplica: la sesión la lleva Vout. Este botón
        // pide al portal que cierre el juego.
        footer = button('Volver al portal');
        footer.addEventListener('click', () => {
            window.parent?.postMessage({ type: 'EXIT' }, '*');  // OJO: parent valida origin de su lado
        });
    } else {
        footer = button('Cerrar sesión', 'daino-btn daino-btn--danger');
        footer.addEventListener('click', async () => {
            footer.disabled = true;
            setLabel(footer, 'Cerrando…');
            await logout();
            // auth.js repinta el chip al recibir daino:auth:logout.
            const modal = document.getElementById('modal-profile');
            if (modal instanceof HTMLDialogElement) modal.close();
        });
    }

    const dialog = createModal('profile', {
        title: isAuthenticated() ? 'Tu perfil' : 'Iniciar sesión',
        body,
        footer,
    });
    dialog.showModal();
}

// --------------------------- RANKING ---------------------------

/** Filas vacías que se enseñan mientras llega el ranking (mismo alto: nada salta). */
const RANKING_GHOSTS = 6;

/**
 * Ranking: top 10 global desde GET /api/ranking. Sin sesión también se ve; quien
 * la tiene y no aparece recibe una nota al final.
 */
export function openRankingModal() {
    const body = el('div', 'daino-ranking');
    const list = el('ol', 'daino-ranking__list');
    const note = el('p', 'daino-ranking__note');
    note.hidden = true;
    body.append(list, note);

    const dialog = createModal('ranking', { title: 'Ranking global', body });
    dialog.showModal();

    void loadRanking(list, note);
}

async function loadRanking(list, note) {
    list.setAttribute('aria-busy', 'true');
    list.replaceChildren(...rankingGhosts(RANKING_GHOSTS));

    const res = await apiRequest('GET', '/api/ranking?limit=10');
    list.removeAttribute('aria-busy');
    list.replaceChildren();
    const say = (text, tone) => {
        note.textContent = text;
        note.hidden = false;
        if (tone) note.dataset.tone = tone;
    };

    if (!res.ok) {
        say('No se pudo cargar el ranking. Inténtalo de nuevo en un momento.', 'error');
        return;
    }

    const items = res.data?.items ?? [];
    if (items.length === 0) {
        say('Nadie ha dejado marca todavía. La primera puede ser la tuya.');
        return;
    }

    const me = getUser();
    let foundMe = false;
    for (const entry of items) {
        const isMine = me !== null && entry.user?.vout_id === me.vout_id;
        if (isMine) foundMe = true;
        list.appendChild(renderRankingRow(entry, isMine));
    }

    if (me !== null && !foundMe) {
        say('Aún no estás entre los diez primeros.');
    } else if (me === null) {
        note.hidden = false;
        const link = el('a', 'daino-link', 'Inicia sesión');
        link.href = '/auth/login';
        link.dataset.interactive = 'true';
        note.replaceChildren(link, document.createTextNode(' para que tus partidas cuenten.'));
    }
}

function renderRankingRow(entry, isMine) {
    const levels = entry.levels_played === 1 ? '1 nivel' : `${entry.levels_played} niveles`;
    return rankingRow({
        rank: entry.rank,
        user: entry.user,
        score: formatPoints(entry.total_points),
        detail: `${levels} · ${entry.avg_percentage} % de media`,
        isMe: isMine,
    });
}

// --------------------------- AJUSTES ---------------------------

/**
 * Un campo de AJUSTES: su nombre (en la letra del juego), a su derecha un valor o
 * un control pequeño, debajo el control ancho y una línea que lo explica.
 *
 * @param {{ label: string, labelFor?: string, aside?: HTMLElement, control?: HTMLElement, hint?: string | HTMLElement }} cfg
 */
function field({ label, labelFor, aside, control, hint }) {
    const box = el('section', 'daino-field');
    const head = el('div', 'daino-field__head');
    const name = pixelText(label, { tag: labelFor ? 'label' : 'span', className: 'daino-field__label' });
    if (labelFor) name.htmlFor = labelFor;
    head.appendChild(name);
    if (aside) head.appendChild(aside);
    box.appendChild(head);
    if (control) box.appendChild(control);
    if (hint instanceof HTMLElement) box.appendChild(hint);
    else if (hint) box.appendChild(el('p', 'daino-field__hint', hint));
    return box;
}

/**
 * @param {{ getActiveAudioEngine?: () => any | null }} [opts]
 *   getActiveAudioEngine: para aplicar el volumen en vivo sin que la UI importe
 *   al AppController (import circular).
 */
export function openSettingsModal(opts = {}) {
    const getEngine = opts.getActiveAudioEngine ?? (() => null);
    const body = el('div', 'daino-settings');

    // ----- Volumen -----
    const percent = (v) => `${Math.round(v * 100)} %`;
    const volValue = px(percent(getVolume()), 'daino-field__value');
    const volSlider = range({
        id: 'daino-settings-vol',
        value: getVolume(),
        onInput: (v) => {
            setVolume(v, getEngine());
            setPixelText(volValue, percent(v));
        },
    });
    body.appendChild(field({ label: 'Volumen', labelFor: volSlider.id, aside: volValue, control: volSlider }));

    // ----- Personaje: los Dinos, tal como se juegan -----
    body.appendChild(field({
        label: 'Personaje',
        control: segmented({
            label: 'Personaje',
            options: Object.entries(DINO_SKINS).map(([id, def]) => ({
                value: id,
                label: def.label,
                className: 'daino-skin',
                node: spriteEl('dinoRunA', { skin: id }),
            })),
            value: normalizeSkinId(getSkin()),
            onChange: (id) => setSkin(normalizeSkinId(id)),
        }),
        hint: 'El Dino del menú cambia al momento; la partida lo usa al empezar.',
    }));

    // ----- Calidad gráfica (Ola 1) -----
    body.appendChild(field({
        label: 'Calidad gráfica',
        control: segmented({
            label: 'Calidad gráfica',
            options: [
                { value: 'auto', label: 'Auto' },
                { value: 'high', label: 'Alta' },
                { value: 'medium', label: 'Media' },
                { value: 'low', label: 'Baja' },
            ],
            value: getQuality(),
            onChange: setQuality,
        }),
        hint: 'Auto baja la calidad sola si detecta tirones. Elegir una la deja fija.',
    }));

    // ----- Efectos visuales (T03.1): cuánto de lo que late con la música -----
    body.appendChild(field({
        label: 'Efectos visuales',
        control: segmented({
            label: 'Efectos visuales',
            options: [
                { value: 'full', label: 'Completos' },
                { value: 'soft', label: 'Suaves' },
                { value: 'min', label: 'Mínimos' },
            ],
            value: getFxLevel(),
            onChange: setFxLevel,
        }),
        hint: 'Suaves: los efectos de la música a media fuerza y sin destellos de pantalla. Mínimos: solo el pulso del suelo y las líneas de velocidad, sin relámpagos.',
    }));

    // ----- Reintento automático (reintentos, Sep 2026) -----
    const retryToggle = document.createElement('input');
    retryToggle.type = 'checkbox';
    retryToggle.className = 'daino-check';
    retryToggle.id = 'daino-settings-autoretry';
    retryToggle.dataset.interactive = 'true';
    retryToggle.checked = getAutoRetry();
    retryToggle.addEventListener('change', () => setAutoRetry(retryToggle.checked));
    body.appendChild(field({
        label: 'Reintentar al chocar',
        labelFor: retryToggle.id,
        aside: retryToggle,
        hint: 'Sin panel de resultados: el nivel vuelve a empezar solo. La pausa (Esc o el botón de arriba) sigue dejando salir.',
    }));

    // ----- Borrar datos locales -----
    const keys = listKeys();
    const clearNote = el('p', 'daino-field__hint', keys.length === 0
        ? 'No hay nada guardado en este navegador.'
        : 'Volumen, preferencias y las marcas que hiciste sin sesión, guardados en este navegador.');
    const clearBtn = button('Borrar', 'daino-btn daino-btn--sm daino-btn--danger');
    clearBtn.disabled = keys.length === 0;
    clearBtn.addEventListener('click', () => {
        const sure = window.confirm('¿Borrar todos los datos locales de Daino? Esto incluye volumen, preferencias y las marcas guardadas sin sesión.');
        if (!sure) return;
        clearAll();
        clearNote.textContent = 'Borrados. Recarga la página para volver a los valores de fábrica.';
        clearBtn.disabled = true;
    });
    body.appendChild(field({ label: 'Datos locales', aside: clearBtn, hint: clearNote }));

    const dialog = createModal('settings', { title: 'Ajustes', body });
    dialog.showModal();
}

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        // Al recargar este módulo, cerramos modales abiertos para evitar
        // estado huérfano entre versiones.
        closeAllModals();
    });
}
