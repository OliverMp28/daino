// Depuración del portal de Vout, en pantalla. Solo se carga cuando se pide: desde
// el portal (`/play/daino?voutdebug=1`: el VOUT_AUTH trae `debug: true`) o, en
// local, abriendo Daino con `?voutdebug=1` (se recuerda en el navegador). Va en su
// propio chunk y también en el build de producción: es lo que quien prueba el
// control facial necesita ver y poder pasar sin abrir la consola.
//
//   - Qué mensajes llegan del portal, cuántos de cada tipo y qué hace Daino con
//     cada uno (lo apunta iframe/bridge.js; el token no aparece nunca).
//   - Las medidas de los gestos (ui/voutStats.js): cuánto tardan en llegar su
//     inicio y su final, cuánto duran y si alguno se corta.
//   - Un botón "Copiar" con las medidas y el registro, para pegarlo en un informe.
//
// Va arriba a la izquierda y en la capa de arriba (popover): se ve también sobre
// el catálogo o el panel de resultados, y no tapa donde se juega. Mientras hay un
// panel abierto no se puede pulsar (el navegador desactiva todo lo que queda fuera
// de un diálogo): se copia desde el menú o jugando. `window.__daino.voutLog()`
// devuelve el mismo texto.

import { GESTURE_JUMP } from '../game/config.js';
import { getTrace } from '../iframe/bridge.js';
import { createGestureStats } from './voutStats.js';

const ID = 'daino-voutdebug';
/** Líneas del registro que se ven; el resto va en "Copiar". */
const SHOWN = 5;
const REFRESH_MS = 250;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * Lo que traía un mensaje, en pocas palabras. El token no está en lo apuntado
 * (bridge.js lo quita): solo cuánto medía.
 *
 * @param {import('../iframe/bridge.js').TraceEntry} entry
 */
function describe({ type, data }) {
    switch (type) {
        case 'READY': return `suggestedPreset ${String(data.suggestedPreset)}`;
        case 'VOUT_AUTH': {
            const left = Number.isFinite(data.expiresAt) ? Math.round((data.expiresAt * 1000 - Date.now()) / 60_000) : null;
            return [
                data.tokenLength ? `token de ${data.tokenLength} caracteres` : 'sin token',
                left === null ? null : `caduca en ${left} min`,
                data.username ? `usuario ${String(data.username)}` : null,
            ].filter(Boolean).join(' · ');
        }
        case 'VOUT_SESSION_END': return `motivo ${String(data.reason)}`;
        case 'VOUT_KEY': return `${String(data.code)} ${data.state === 'down' ? '↓' : data.state === 'up' ? '↑' : String(data.state)}`;
        case 'VOUT_POINTER': return `botón ${String(data.button)} ${data.state === 'down' ? '↓' : data.state === 'up' ? '↑' : String(data.state)}`;
        case 'VOUT_CURSOR': return `x ${Number(data.x).toFixed(2)} · y ${Number(data.y).toFixed(2)}`;
        case 'VOUT_ACTION':
        case 'VOUT_ACTION_END': return String(data.event);
        default: return '';
    }
}

/**
 * Una línea del registro: hora, sentido (← llega, → sale), qué traía, cuánto
 * tardó desde el gesto y qué hizo Daino.
 *
 * @param {import('../iframe/bridge.js').TraceEntry} entry
 */
function formatTrace(entry) {
    const time = new Date(entry.at).toISOString().slice(11, 23);
    const arrow = entry.dir === 'in' ? '←' : entry.dir === 'out' ? '→' : '·';
    const detail = describe(entry);
    const lag = entry.lagMs === null ? '' : ` (hace ${Math.round(entry.lagMs)} ms)`;
    const outcome = entry.outcome ? `  ⇒ ${entry.outcome}` : '';
    return `${time} ${arrow} ${entry.type}${detail ? ` ${detail}` : ''}${lag}${outcome}`;
}

function summaryLine(trace, stats) {
    const counts = Object.entries(trace.counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, n]) => `${type.replace('VOUT_', '')} ${n}`)
        .join(' · ');
    const brief = stats.brief();
    return `${counts || 'todavía no ha llegado nada'}${brief ? ` — ${brief}` : ''}`;
}

/** Las medidas y el registro, listos para pegar. */
function report(trace, stats) {
    return [
        'Daino dentro del portal de Vout: medidas y registro de mensajes',
        `Fecha: ${new Date().toISOString()}`,
        `Navegador: ${navigator.userAgent}`,
        `Ventana del juego: ${window.innerWidth} × ${window.innerHeight}`,
        `Recuento: ${summaryLine(trace, stats)}`,
        '',
        ...stats.lines(),
        '',
        `REGISTRO (los últimos ${trace.entries.length} mensajes)`,
        '← lo que llega del portal · → lo que envía Daino · ⇒ lo que hizo Daino',
        ...trace.entries.map(formatTrace),
    ].join('\n');
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch { /* sin permiso o sin API: queda el camino antiguo */ }
    const field = el('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    field.remove();
    return ok;
}

export function mountVoutDebug() {
    const trace = getTrace();
    if (trace === null || document.getElementById(ID) !== null) return;
    const stats = createGestureStats({ holdThresholdMs: Math.round(GESTURE_JUMP.afterS * 1000) });

    const root = el('aside', 'daino-voutdebug');
    root.id = ID;
    root.setAttribute('aria-label', 'Depuración del portal de Vout');

    const head = el('div', 'daino-voutdebug__head');
    const copy = el('button', 'daino-voutdebug__btn', 'Copiar');
    copy.type = 'button';
    const fold = el('button', 'daino-voutdebug__btn', 'Plegar');
    fold.type = 'button';
    head.append(el('strong', null, 'Vout · depuración'), copy, fold);

    const summary = el('p', 'daino-voutdebug__summary');
    const log = el('ol', 'daino-voutdebug__log');
    root.append(head, summary, log);

    copy.addEventListener('click', async () => {
        const ok = await copyText(report(trace, stats));
        copy.textContent = ok ? 'Copiado' : 'No se pudo';
        setTimeout(() => { copy.textContent = 'Copiar'; }, 2000);
    });
    fold.addEventListener('click', () => {
        const folded = root.dataset.folded !== 'true';
        root.dataset.folded = String(folded);
        fold.textContent = folded ? 'Abrir' : 'Plegar';
    });

    const usePopover = typeof root.showPopover === 'function';
    if (usePopover) root.popover = 'manual';
    document.body.appendChild(root);
    // Un diálogo abierto después taparía el recuadro: se vuelve a poner encima.
    const raise = () => {
        if (!usePopover) return;
        try {
            if (root.matches(':popover-open')) root.hidePopover();
            root.showPopover();
        } catch { /* sin capa de arriba: se queda donde está */ }
    };
    raise();

    // A las medidas y a la consola: lo que llegó antes de montar esto y lo que vaya llegando.
    const take = (entry) => {
        stats.add(entry);
        console.info('[vout]', formatTrace(entry));
    };
    for (const entry of trace.entries) take(entry);
    let dirty = true;
    let dialogs = 0;
    trace.subscribe((entry) => {
        dirty = true;
        take(entry);
    });
    setInterval(() => {
        const open = document.querySelectorAll('dialog[open]').length;
        if (open !== dialogs) {
            dialogs = open;
            raise();
        }
        if (!dirty) return;
        dirty = false;
        summary.textContent = summaryLine(trace, stats);
        log.replaceChildren(...trace.entries.slice(-SHOWN).map((entry) => {
            const item = el('li', null, formatTrace(entry));
            if (entry.outcome?.startsWith('descartado') || entry.outcome?.startsWith('error')) item.dataset.bad = 'true';
            return item;
        }));
    }, REFRESH_MS);

    window.__daino = window.__daino ?? {};
    window.__daino.voutLog = () => report(trace, stats);
}
