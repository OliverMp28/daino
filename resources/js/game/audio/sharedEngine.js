// AudioEngine compartido por toda la app (Ola 3).
//
// Antes vivía como variable suelta dentro de ui/upload.js y el modal de
// niveles lo importaba de ahí. Es una pieza de juego, no de la UI de subida:
// aquí tiene un dueño claro y cualquiera la obtiene igual.

import { AudioEngine } from './AudioEngine.js';

let engine = null;

/** @returns {AudioEngine} */
export function getAudioEngine() {
    if (engine === null) engine = new AudioEngine();
    return engine;
}

/**
 * Crea o reanuda el AudioContext. DEBE llamarse de forma síncrona dentro del
 * handler de un gesto del usuario (clic, tecla, drop): la política de autoplay
 * de los navegadores solo deja arrancar audio desde ahí. Todo lo que venga
 * después (descargar, analizar) puede ser asíncrono: una vez arrancado, el
 * contexto sigue disponible.
 *
 * No se espera la promesa a propósito: el cuerpo de `start()` crea el contexto
 * antes de su primer `await`, que es lo que la política exige.
 */
export function unlockAudio() {
    void getAudioEngine().start();
}
