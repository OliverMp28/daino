// Depuración del portal de Vout, en pantalla. Solo se carga con `?voutdebug=1`
// (main.js; se recuerda en el navegador), en su propio chunk y también en el build
// de producción: lo que quien prueba el control facial necesita ver y poder pasar
// sin abrir la consola.
//
//   - Qué mensajes llegan del portal, cuántos de cada tipo y qué hace Daino con
//     cada uno (lo apunta iframe/bridge.js; el token no aparece nunca).
//   - Cuánto tarda un gesto en llegar: la hora del mensaje menos su `at`.
//   - Un botón "Copiar" con el registro entero, para pegarlo en un informe.
//
// Va arriba a la izquierda y en la capa de arriba (popover): se ve también sobre
// el catálogo o el panel de resultados, y no tapa donde se juega. Mientras hay un panel abierto no se puede pulsar (el
// navegador desactiva todo lo que queda fuera de un diálogo): se copia desde el
// menú o jugando. `window.__daino.voutLog()` devuelve el mismo texto.

import { getTrace } from '../iframe/bridge.js';

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
        case 'VOUT_CLICK': return `botón ${String(data.button)}`;
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

/** Media y máximo de lo que tardaron en llegar los gestos (los mensajes con `at`). */
function lagStats(entries) {
    const lags = entries.map((e) => e.lagMs).filter((v) => v !== null && v >= 0 && v < 5000);
    if (lags.length === 0) return null;
    return {
        mean: lags.reduce((a, b) => a + b, 0) / lags.length,
        max: Math.max(...lags),
        count: lags.length,
    };
}

function summaryLine(trace) {
    const counts = Object.entries(trace.counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, n]) => `${type.replace('VOUT_', '')} ${n}`)
        .join(' · ');
    const lag = lagStats(trace.entries);
    const lagText = lag === null ? '' : ` — retraso de los gestos: ${Math.round(lag.mean)} ms de media, ${Math.round(lag.max)} de máximo`;
    return `${counts || 'todavía no ha llegado nada'}${lagText}`;
}

/** El registro entero, listo para pegar. */
function report(trace) {
    const lag = lagStats(trace.entries);
    return [
        'Daino dentro del portal de Vout: registro de mensajes',
        `Fecha: ${new Date().toISOString()}`,
        `Navegador: ${navigator.userAgent}`,
        `Ventana del juego: ${window.innerWidth} × ${window.innerHeight}`,
        `Recuento: ${summaryLine(trace)}`,
        lag === null ? 'Sin gestos con hora (at).' : `Retraso de los gestos (llegada menos at): media ${Math.round(lag.mean)} ms, máximo ${Math.round(lag.max)} ms, sobre ${lag.count} mensajes.`,
        '',
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
        const ok = await copyText(report(trace));
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

    // También a la consola: lo que llegó antes de montar esto y lo que vaya llegando.
    for (const entry of trace.entries) console.info('[vout]', formatTrace(entry));
    let dirty = true;
    let dialogs = 0;
    trace.subscribe((entry) => {
        dirty = true;
        console.info('[vout]', formatTrace(entry));
    });
    setInterval(() => {
        const open = document.querySelectorAll('dialog[open]').length;
        if (open !== dialogs) {
            dialogs = open;
            raise();
        }
        if (!dirty) return;
        dirty = false;
        summary.textContent = summaryLine(trace);
        log.replaceChildren(...trace.entries.slice(-SHOWN).map((entry) => {
            const item = el('li', null, formatTrace(entry));
            if (entry.outcome?.startsWith('descartado') || entry.outcome?.startsWith('error')) item.dataset.bad = 'true';
            return item;
        }));
    }, REFRESH_MS);

    window.__daino = window.__daino ?? {};
    window.__daino.voutLog = () => report(trace);
}
