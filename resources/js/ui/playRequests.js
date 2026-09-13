// Peticiones de partida — el único punto por el que la UI pide jugar (Ola 3).
//
// Cualquier botón o gesto que lance una partida (JUGAR, un nivel del catálogo,
// soltar un MP3) llama aquí. Esto hace dos cosas y nada más:
//   1. Desbloquea el audio DENTRO del gesto (política de autoplay).
//   2. Emite `daino:play-request`, que AppController orquesta.
//
// Antes cada origen descargaba, decodificaba y hasta empezaba a reproducir el
// audio por su cuenta (para que AppController lo parara dos líneas después).
// Ahora ninguna vista toca el audio: piden y AppController decide.

import { unlockAudio } from '../game/audio/sharedEngine.js';

export const PLAY_REQUEST_EVENT = 'daino:play-request';

/**
 * @param {File} file  MP3 elegido o soltado por el usuario.
 */
export function requestLocalPlay(file) {
    unlockAudio();
    window.dispatchEvent(new CustomEvent(PLAY_REQUEST_EVENT, { detail: { source: 'local', file } }));
}

/**
 * @param {object} level  Fila del catálogo tal como la devuelve GET /api/levels.
 */
export function requestCatalogPlay(level) {
    unlockAudio();
    window.dispatchEvent(new CustomEvent(PLAY_REQUEST_EVENT, { detail: { source: 'catalog', level } }));
}
