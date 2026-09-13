// Aviso breve en pantalla, autodescartable. Compartido por toda la UI.
//
// `role="alert"` para errores (los lectores de pantalla los anuncian al
// momento) y `role="status"` para información (se anuncia sin interrumpir).

/**
 * @param {string} message
 * @param {'error' | 'info'} [severity]
 * @param {number} [durationMs]
 */
export function showToast(message, severity = 'error', durationMs = 4000) {
    const el = document.createElement('div');
    el.className = 'daino-toast';
    el.dataset.severity = severity;
    el.setAttribute('role', severity === 'error' ? 'alert' : 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, durationMs);
}
