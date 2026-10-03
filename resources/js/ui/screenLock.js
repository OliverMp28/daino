// Poner la pantalla en horizontal desde el juego (móviles, Oct 2026).
//
// "Gira el móvil" no basta: quien tiene el giro del teléfono bloqueado lo gira y no
// pasa nada, y un botón que promete ponerlo en horizontal tiene que hacerlo. Un
// navegador solo deja fijar la orientación a una página que está en pantalla
// completa, así que son las dos cosas juntas: pantalla completa y, dentro de ella,
// orientación apaisada. Así gira aunque el teléfono tenga el giro bloqueado, y de
// paso desaparece la barra del navegador. Al salir de la pantalla completa (el
// gesto de atrás), el navegador suelta la orientación por su cuenta.
//
// Donde no se puede (Safari en un iPhone no deja ni lo uno ni lo otro) no se ofrece
// el botón: se dice cómo girarlo a mano. Y si se ofrece y falla, se deshace la
// pantalla completa: a medias no sirve de nada.
//
// Sin DOM propio: recibe `document` y `screen` (o unos de mentira en los tests).

/**
 * @typedef {{ doc: Document | null | undefined, screen: Screen | null | undefined }} ScreenEnv
 */

/** @returns {ScreenEnv} */
function browserEnv() {
    return {
        doc: typeof document !== 'undefined' ? document : null,
        screen: typeof window !== 'undefined' ? window.screen : null,
    };
}

/**
 * ¿Puede este navegador poner la pantalla en horizontal por sí mismo?
 *
 * @param {ScreenEnv} [env]
 */
export function canLockLandscape(env = browserEnv()) {
    const root = env.doc?.documentElement;
    return typeof env.screen?.orientation?.lock === 'function'
        && typeof root?.requestFullscreen === 'function'
        && env.doc?.fullscreenEnabled !== false;
}

/**
 * Pantalla completa y orientación apaisada. Hay que llamarlo dentro de un toque
 * (la pantalla completa lo exige).
 *
 *   'locked'       está en horizontal (o lo estará en cuanto gire la pantalla).
 *   'failed'       el navegador tenía con qué, pero se negó: todo queda como estaba.
 *   'unsupported'  este navegador no puede.
 *
 * @param {ScreenEnv} [env]
 * @returns {Promise<'locked' | 'failed' | 'unsupported'>}
 */
export async function lockLandscape(env = browserEnv()) {
    if (!canLockLandscape(env)) return 'unsupported';
    const { doc, screen } = env;
    const wasFullscreen = doc.fullscreenElement != null;
    try {
        if (!wasFullscreen) await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await screen.orientation.lock('landscape');
        return 'locked';
    } catch {
        if (!wasFullscreen && doc.fullscreenElement != null) {
            try { await doc.exitFullscreen(); } catch { /* ya no lo estaba */ }
        }
        return 'failed';
    }
}

/** Lo que se le dice a quien tiene que girarlo a mano. */
export const ROTATE_BY_HAND = 'Gíralo a mano. Si la pantalla no gira, desactiva el bloqueo de rotación del teléfono.';
