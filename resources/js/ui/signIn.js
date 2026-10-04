// Cómo se ofrece "iniciar sesión" dentro de una frase de la interfaz.
//
// En una pestaña propia es un enlace a /auth/login (el flujo OAuth con Vout).
// Dentro del portal de Vout no hay enlace: la sesión la lleva el portal, y su
// página de login no se puede abrir dentro del iframe del juego. Ahí solo se
// dice de dónde viene la sesión.

import { isBridgeEmbedded } from '../iframe/bridge.js';
import { el } from './kit.js';

/**
 * "Inicia sesión" seguido de `tail` (p. ej. " para que tus partidas cuenten.").
 * Lo que devuelve se pasa tal cual a `replaceChildren` / `append`.
 *
 * @param {string} tail
 * @returns {Array<Node | string>}
 */
export function signInNote(tail) {
    if (isBridgeEmbedded()) return [`Entra en Vout con tu cuenta${tail}`];
    const link = el('a', 'daino-link', 'Inicia sesión');
    link.href = '/auth/login';
    link.dataset.interactive = 'true';
    return [link, tail];
}
