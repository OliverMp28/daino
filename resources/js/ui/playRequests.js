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
 * @param {{ level?: object }} [opts]  `level`: nivel privado propio al que
 *        corresponde el archivo (Ola 2, D11). Se juega con su chart guardado.
 */
export function requestLocalPlay(file, opts = {}) {
    unlockAudio();
    window.dispatchEvent(new CustomEvent(PLAY_REQUEST_EVENT, {
        detail: { source: 'local', file, level: opts.level ?? null },
    }));
}

export const PREFETCH_REQUEST_EVENT = 'daino:prefetch-request';

/**
 * Señal de intención (Ola 2): el jugador abrió la ficha de un nivel. Quien
 * orquesta la carga puede ir descargando su audio y su chart para que JUGAR
 * arranque sin esperar a la red. No desbloquea audio: no es un gesto de jugar.
 *
 * @param {object} level
 */
export function requestPrefetch(level) {
    window.dispatchEvent(new CustomEvent(PREFETCH_REQUEST_EVENT, { detail: { level } }));
}

/**
 * @param {object} level  Fila del catálogo tal como la devuelve GET /api/levels.
 */
export function requestCatalogPlay(level) {
    unlockAudio();
    window.dispatchEvent(new CustomEvent(PLAY_REQUEST_EVENT, { detail: { source: 'catalog', level } }));
}
