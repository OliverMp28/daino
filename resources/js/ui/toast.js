// Aviso breve en pantalla, autodescartable. Compartido por toda la UI.
//
// `role="alert"` para errores (los lectores de pantalla los anuncian al
// momento) y `role="status"` para información (se anuncia sin interrumpir).
//
// Se muestra como popover (Ola 2): un `<dialog>` abierto con showModal() vive en
// la "top layer" del navegador, por encima de cualquier z-index, así que un
// toast normal quedaba TAPADO por el catálogo. Un popover abierto después entra
// en la misma capa, encima del diálogo. Sin soporte de popover se degrada al
// comportamiento anterior.

/**
 * @param {string} message
 * @param {'error' | 'info'} [severity]
 * @param {number} [durationMs]
 */
export function showToast(message, severity = 'error', durationMs = 4000) {
    const el = document.createElement('div');
    el.className = 'daino-toast daino-cut';
    el.dataset.severity = severity;
    el.setAttribute('role', severity === 'error' ? 'alert' : 'status');
    el.textContent = message;
    const usePopover = typeof el.showPopover === 'function';
    if (usePopover) el.popover = 'manual';
    document.body.appendChild(el);
    if (usePopover) {
        try { el.showPopover(); } catch { /* sin top layer: queda como antes */ }
    }
    setTimeout(() => { el.remove(); }, durationMs);
}
