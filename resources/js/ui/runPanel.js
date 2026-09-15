// Panel de partida: pausa y resultados (reintentos, Sep 2026).
//
// Un único `<dialog>` centrado sobre la escena, con dos modos:
//   - results: al chocar o superar el nivel. REINTENTAR delante (Espacio, Enter
//     o R; un toque en táctil), Niveles (Esc) y Menú. La escena de detrás es la
//     partida tal cual terminó: el Dino caído junto al obstáculo.
//   - pause:   Reanudar delante (Esc), Reintentar (R), Niveles, Menú y volumen.
//
// Qué se enseña lo decide `runPanelModel.js`. Este módulo pinta, gestiona el
// teclado y protege de pulsaciones accidentales: durante unas décimas tras
// abrirse no acepta nada, porque quien choca suele estar machacando saltar y
// ese toque no debe decidir por él (y menos "Menú").

import { RUN_ACTION, keyAction } from './runPanelModel.js';

const DIALOG_ID = 'modal-run';

/** Tiempo tras abrir en el que el panel ignora teclas y toques. */
export const ARM_DELAY_MS = 420;

const ICONS = {
    [RUN_ACTION.RESUME]: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
    [RUN_ACTION.RETRY]: '<path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20.5 3.5v5.2h-5.2z" fill="currentColor"/>',
    [RUN_ACTION.LEVELS]: '<g fill="currentColor"><rect x="4" y="5" width="4" height="4" rx="1"/><rect x="10" y="5.5" width="10" height="3" rx="1.2"/><rect x="4" y="10.5" width="4" height="4" rx="1"/><rect x="10" y="11" width="10" height="3" rx="1.2"/><rect x="4" y="16" width="4" height="4" rx="1"/><rect x="10" y="16.5" width="10" height="3" rx="1.2"/></g>',
    [RUN_ACTION.MENU]: '<path d="M4 11.2 12 4.5l8 6.7V20h-5.5v-5h-5v5H4z" fill="currentColor"/>',
};

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
    const card = el('div', 'daino-run__card');

    const head = el('header', 'daino-run__head');
    if (view.title) head.appendChild(el('p', 'daino-run__title', view.title));
    const heading = el('h2', 'daino-run__heading', view.heading);
    heading.id = `${DIALOG_ID}-heading`;
    head.appendChild(heading);
    if (view.mode === 'results') head.appendChild(el('p', 'daino-run__pct', view.percentLabel));
    card.appendChild(head);

    card.appendChild(renderBar(view));

    const summary = el('p', 'daino-run__note', view.note ?? '');
    summary.id = `${DIALOG_ID}-summary`;
    if (!view.note) summary.hidden = true;
    card.appendChild(summary);

    const stats = el('dl', 'daino-run__stats');
    for (const s of view.stats) {
        const item = el('div', 'daino-run__stat');
        item.append(el('dt', null, s.label), el('dd', null, s.value));
        stats.appendChild(item);
    }
    card.appendChild(stats);

    const actions = el('div', 'daino-run__actions');
    actions.appendChild(actionButton(view.primary, 'daino-run__primary', fire));
    const secondary = el('div', 'daino-run__secondary');
    for (const a of view.secondary) secondary.appendChild(actionButton(a, 'daino-run__secondary-btn', fire));
    actions.appendChild(secondary);
    card.appendChild(actions);

    const foot = el('div', 'daino-run__foot');
    if (view.offerAutoRetry && handlers.autoRetry) foot.appendChild(autoRetrySwitch(handlers.autoRetry));
    if (view.mode === 'pause' && handlers.volume) foot.appendChild(volumeRow(handlers.volume));
    if (foot.childElementCount > 0) card.appendChild(foot);

    return card;
}

function renderBar(view) {
    const bar = el('div', 'daino-run__bar');
    bar.setAttribute('role', 'img');
    const best = view.bar.best;
    bar.setAttribute('aria-label', best !== null
        ? `${view.percentLabel} de la canción. Tu mejor marca: ${Math.round(best * 100)} %.`
        : `${view.percentLabel} de la canción.`);
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
    fill.style.setProperty('--fill', String(view.bar.fill));
    bar.append(road, fill);
    if (best !== null) {
        const mark = el('b', 'daino-run__best');
        mark.style.left = `${(best * 100).toFixed(2)}%`;
        mark.appendChild(el('span', null, 'Mejor'));
        bar.appendChild(mark);
    }
    return bar;
}

function actionButton(action, className, fire) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.dataset.interactive = 'true';
    b.dataset.action = action.action;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('daino-run__icon');
    icon.innerHTML = ICONS[action.action] ?? '';
    b.appendChild(icon);
    b.appendChild(el('span', 'daino-run__label', action.label));
    if (action.key) {
        const kbd = el('kbd', 'daino-run__key', action.key);
        kbd.setAttribute('aria-hidden', 'true');
        b.appendChild(kbd);
        b.setAttribute('aria-keyshortcuts', action.key === 'Espacio' ? 'Space' : action.key === 'Esc' ? 'Escape' : action.key);
    }
    b.addEventListener('click', () => fire(action.action));
    return b;
}

function autoRetrySwitch({ checked, onChange }) {
    const label = el('label', 'daino-run__switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.dataset.interactive = 'true';
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, el('span', null, 'Reintentar al instante al chocar'));
    return label;
}

function volumeRow({ value, onInput }) {
    const row = el('label', 'daino-run__volume');
    row.appendChild(el('span', null, 'Volumen'));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(value);
    input.dataset.interactive = 'true';
    input.addEventListener('input', () => onInput(Number.parseFloat(input.value)));
    row.appendChild(input);
    return row;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
