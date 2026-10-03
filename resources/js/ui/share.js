// Compartir un enlace (T06): la hoja de compartir del sistema donde la hay (un
// móvil), y si no, copiarlo al portapapeles.
//
// En un móvil apaisado la barra de direcciones ni se ve: sin un botón, la dirección
// de un nivel existiría y nadie podría pasarla.
//
// Las dos API modernas (`navigator.share`, `navigator.clipboard`) solo existen en
// contextos seguros (HTTPS o localhost); abierto por la IP de la red local queda el
// camino antiguo de copiar desde un campo de texto.

/**
 * @typedef {{ navigator?: { share?: Function, clipboard?: { writeText?: Function } } | null, copyLegacy?: (text: string) => boolean }} ShareEnv
 */

/** Copia con un campo de texto y `execCommand`: lo que queda sin `navigator.clipboard`. */
function copyWithField(text) {
    if (typeof document === 'undefined') return false;
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    // Dentro del diálogo abierto, si lo hay: fuera de él no se puede enfocar nada.
    const host = document.querySelector('dialog[open]') ?? document.body;
    host.appendChild(field);
    field.select();
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch {
        ok = false;
    }
    field.remove();
    return ok;
}

/** @returns {ShareEnv} */
function browserEnv() {
    return { navigator: typeof navigator !== 'undefined' ? navigator : null, copyLegacy: copyWithField };
}

/**
 * Comparte un enlace. Hay que llamarlo dentro de un toque o un clic.
 *
 *   'shared'     salió por la hoja de compartir del sistema.
 *   'cancelled'  se abrió la hoja y se cerró sin elegir nada.
 *   'copied'     quedó en el portapapeles.
 *   'failed'     nada de lo anterior fue posible (quien llama enseña el enlace).
 *
 * @param {{ title: string, text?: string, url: string }} data
 * @param {ShareEnv} [env]
 * @returns {Promise<'shared' | 'cancelled' | 'copied' | 'failed'>}
 */
export async function shareLink(data, env = browserEnv()) {
    const nav = env.navigator;
    if (typeof nav?.share === 'function') {
        try {
            await nav.share(data);
            return 'shared';
        } catch (err) {
            // Cerrar la hoja sin elegir no es un fallo: no se copia nada por su cuenta.
            if (err?.name === 'AbortError') return 'cancelled';
        }
    }
    if (typeof nav?.clipboard?.writeText === 'function') {
        try {
            await nav.clipboard.writeText(data.url);
            return 'copied';
        } catch { /* sin permiso: queda el camino antiguo */ }
    }
    return env.copyLegacy?.(data.url) === true ? 'copied' : 'failed';
}
