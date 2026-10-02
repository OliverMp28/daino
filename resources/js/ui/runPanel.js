// Panel de partida: pausa y resultados (reintentos, Sep 2026).
//
// Un único `<dialog>` centrado sobre la escena, con dos modos:
//   - results: al chocar o superar el nivel. REINTENTAR delante (Espacio, Enter
//     o R; un toque en táctil), Niveles (Esc) y Menú. La escena de detrás es la
//     partida tal cual terminó: el Dino caído junto al obstáculo.
//   - pause:   Reanudar delante (Esc), Reintentar (R), Niveles, Menú y volumen.
//
// Su aspecto (T04, doc 12): el panel de la interfaz, con el camino de la canción y
// el Dino donde llegaste; sin iconos (las acciones se leen) salvo ▶ en Reanudar.
//
// Qué se enseña lo decide `runPanelModel.js`. Este módulo pinta, gestiona el
// teclado y protege de pulsaciones accidentales: durante unas décimas tras
// abrirse no acepta nada, porque quien choca suele estar machacando saltar y
// ese toque no debe decidir por él (y menos "Menú").

import { RUN_ACTION, keyAction } from './runPanelModel.js';
import { button, el, range } from './kit.js';
import { getSkin } from './settings.js';
import { runningDinoEl, spriteEl } from './pixel/sprite.js';
import { pixelText } from './pixel/text.js';

const DIALOG_ID = 'modal-run';

/** Tiempo tras abrir en el que el panel ignora teclas y toques. */
export const ARM_DELAY_MS = 420;


/** @type {{ dialog: HTMLDialogElement | null, onKey: ((ev: KeyboardEvent) => void) | null, armTimer: number }} */
const ui = { dialog: null, onKey: null, armTimer: 0 };

/**
 * @typedef {Object} RunPanelHandlers
 * @property {(action: string) => void} onAction
 * @property {{ checked: boolean, onChange: (checked: boolean) => void }} [autoRetry]
 * @property {{ value: number, onInput: (value: number) => void }} [volume]
 */

/**
 * @param {ReturnType<import('./runPanelModel.js').runPanelView>} view
 * @param {RunPanelHandlers} handlers
 */
export function openRunPanel(view, handlers) {
    const dialog = ensureDialog();
    if (dialog.open) teardown();

    let done = false;
    const fire = (action) => {
        if (done || dialog.dataset.armed !== 'true') return;
        done = true;
        closeRunPanel();
        handlers.onAction(action);
    };

    dialog.dataset.mode = view.mode;
    dialog.dataset.tone = view.tone;
    dialog.dataset.armed = 'false';
    dialog.replaceChildren(renderCard(view, handlers, fire));

    // Esc: acción del modo (Niveles / Reanudar), nunca un cierre "a secas".
    dialog.oncancel = (ev) => {
        ev.preventDefault();
        const action = keyAction(view.mode, { key: 'Escape' });
        if (action) fire(action);
    };
    // Fuera de la tarjeta: en pausa equivale a Reanudar; en resultados, nada
    // (un toque perdido no debe sacarte del nivel).
    dialog.onclick = (ev) => {
        if (ev.target === dialog && view.mode === 'pause') fire(RUN_ACTION.RESUME);
    };

    ui.onKey = (ev) => {
        if (!dialog.open || ev.key === 'Escape') return;   // Esc lo lleva `cancel`
        const target = /** @type {HTMLElement | null} */ (ev.target instanceof HTMLElement ? ev.target : null);
        // Escribiendo o moviendo el volumen: las teclas son del control.
        if (target?.matches('input, select, textarea')) return;
        const focusedSecondary = target !== null && target.matches('button') && !target.matches('.daino-run__primary');
        const action = keyAction(view.mode, ev, { focusedSecondary });
        if (action === null) return;
        ev.preventDefault();
        fire(action);
    };
    document.addEventListener('keydown', ui.onKey);

    dialog.showModal();
    dialog.querySelector('.daino-run__primary')?.focus({ preventScroll: true });
    // La pausa se pide a propósito: responde al momento (Esc, Esc = pausar y
    // seguir). Los resultados llegan solos, en plena ráfaga de pulsaciones.
    if (view.mode === 'pause') dialog.dataset.armed = 'true';
    else ui.armTimer = window.setTimeout(() => { dialog.dataset.armed = 'true'; }, ARM_DELAY_MS);
}

export function closeRunPanel() {
    if (ui.dialog === null) return;
    teardown();
    if (ui.dialog.open) ui.dialog.close();
}

export function isRunPanelOpen() {
    return ui.dialog?.open === true;
}

function teardown() {
    window.clearTimeout(ui.armTimer);
    if (ui.onKey) document.removeEventListener('keydown', ui.onKey);
    ui.onKey = null;
}

function ensureDialog() {
    if (ui.dialog !== null && ui.dialog.isConnected) return ui.dialog;
    const root = document.getElementById('modal-root');
    if (root === null) throw new Error('runPanel: #modal-root no existe');
    const dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'daino-run';
    dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-heading`);
    dialog.setAttribute('aria-describedby', `${DIALOG_ID}-summary`);
    // Otra vía de cierre (closeAllModals al cargar otra partida): soltar teclado.
    dialog.addEventListener('close', teardown);
    root.appendChild(dialog);
    ui.dialog = dialog;
    return dialog;
}

function renderCard(view, handlers, fire) {
    const card = el('div', 'daino-panel daino-run__card');

    const head = el('header', 'daino-run__head');
    if (view.title) head.appendChild(el('p', 'daino-run__title', view.title));
    const heading = pixelText(view.heading, { tag: 'h2', className: 'daino-run__heading' });
    heading.id = `${DIALOG_ID}-heading`;
    head.appendChild(heading);
    if (view.mode === 'results') head.appendChild(pixelText(view.percentLabel, { tag: 'p', className: 'daino-run__pct' }));
    card.appendChild(head);

    card.appendChild(renderTrack(view));

    const summary = el('p', 'daino-run__note', view.note ?? '');
    summary.id = `${DIALOG_ID}-summary`;
    if (!view.note) summary.hidden = true;
    card.appendChild(summary);

    const stats = el('dl', 'daino-run__stats');
    for (const s of view.stats) {
        const item = el('div', 'daino-run__stat');
        item.append(pixelText(s.label, { tag: 'dt' }), pixelText(s.value, { tag: 'dd' }));
        stats.appendChild(item);
    }
    card.appendChild(stats);

    const actions = el('div', 'daino-run__actions');
    actions.appendChild(actionButton(view.primary, 'daino-btn daino-btn--primary daino-btn--lg daino-run__primary', fire));
    const secondary = el('div', 'daino-run__secondary');
    for (const a of view.secondary) secondary.appendChild(actionButton(a, 'daino-btn daino-run__secondary-btn', fire));
    actions.appendChild(secondary);
    card.appendChild(actions);

    const foot = el('div', 'daino-run__foot');
    if (view.offerAutoRetry && handlers.autoRetry) foot.appendChild(autoRetrySwitch(handlers.autoRetry));
    if (view.mode === 'pause' && handlers.volume) foot.appendChild(volumeRow(handlers.volume));
    if (foot.childElementCount > 0) card.appendChild(foot);

    return card;
}

/**
 * El camino de la canción: la barra con sus tramos, lo alcanzado relleno, el Dino
 * (con el personaje elegido) de pie donde llegaste y un banderín en tu mejor marca.
 * El Dino dice cómo fue: caído si chocaste, trotando si superaste el nivel.
 */
function renderTrack(view) {
    const track = el('div', 'daino-run__track');
    track.setAttribute('role', 'img');
    const best = view.bar.best;
    track.setAttribute('aria-label', best !== null
        ? `${view.percentLabel} de la canción. Tu mejor marca: ${Math.round(best * 100)} %.`
        : `${view.percentLabel} de la canción.`);
    track.style.setProperty('--at', String(view.bar.fill));

    const skin = getSkin();
    let dino;
    if (view.tone === 'win') dino = runningDinoEl({ skin, className: 'daino-run__dino' });
    else dino = spriteEl(view.mode === 'pause' ? 'dinoRunA' : 'dinoDead', { skin, className: 'daino-run__dino' });

    const bar = el('div', 'daino-run__bar');
    const road = el('div', 'daino-run__road');
    for (const s of view.bar.segments) {
        const seg = el('i', 'daino-run__seg');
        seg.dataset.level = String(s.level);
        if (s.climax) seg.dataset.climax = 'true';
        seg.style.left = `${(s.from * 100).toFixed(2)}%`;
        seg.style.width = `${((s.to - s.from) * 100).toFixed(2)}%`;
        road.appendChild(seg);
    }
    const fill = el('span', 'daino-run__fill');
    fill.style.setProperty('--amount', String(view.bar.fill));
    road.appendChild(fill);
    bar.appendChild(road);
    if (best !== null) {
        const mark = el('b', 'daino-run__best');
        mark.style.left = `${(best * 100).toFixed(2)}%`;
        mark.appendChild(pixelText('Mejor'));
        bar.appendChild(mark);
    }
    track.append(dino, bar);
    return track;
}

function actionButton(action, className, fire) {
    const b = button(action.label, className, {
        key: action.key ?? undefined,
        before: action.action === RUN_ACTION.RESUME ? '▶' : undefined,
    });
    b.dataset.action = action.action;
    if (action.key) {
        b.setAttribute('aria-keyshortcuts', action.key === 'Espacio' ? 'Space' : action.key === 'Esc' ? 'Escape' : action.key);
    }
    b.addEventListener('click', () => fire(action.action));
    return b;
}

function autoRetrySwitch({ checked, onChange }) {
    const label = el('label', 'daino-run__switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'daino-check';
    input.checked = checked;
    input.dataset.interactive = 'true';
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, el('span', null, 'Reintentar al instante al chocar'));
    return label;
}

function volumeRow({ value, onInput }) {
    const row = el('label', 'daino-run__volume');
    row.appendChild(pixelText('Volumen'));
    row.appendChild(range({ value, onInput }));
    return row;
}
