// Configuración local persistida en localStorage. Bloque 6 Lote D.
//
// Keys con prefijo `daino:` para no colisionar con otras apps en el mismo
// dominio. El "borrar datos locales" del modal de Settings limpia todo lo
// que empiece por ese prefijo (ver `clearAll`).
//
// Source of truth: localStorage. Los consumidores (AudioEngine, modal
// Settings) leen/escriben aquí — no hay variable global cacheada.

const KEY_VOLUME = 'daino:volume';
const KEY_REDUCE_EFFECTS = 'daino:reduce_effects';
const KEY_SKIN = 'daino:skin';
const PREFIX = 'daino:';

/** Devuelve volumen guardado [0,1]. Default 1.0. */
export function getVolume() {
    const raw = localStorage.getItem(KEY_VOLUME);
    if (raw === null) return 1.0;
    const v = Number.parseFloat(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1.0;
}

/**
 * Guarda volumen y, si se pasa un AudioEngine en marcha, aplica al gainNode
 * inmediatamente — feedback en vivo al mover el slider.
 *
 * @param {number} v
 * @param {{ gainNode?: { gain: { value: number } } } | null} [audioEngine]
 */
export function setVolume(v, audioEngine) {
    const clamped = Math.max(0, Math.min(1, v));
    localStorage.setItem(KEY_VOLUME, String(clamped));
    if (audioEngine?.gainNode?.gain) {
        audioEngine.gainNode.gain.value = clamped;
    }
}

/** Toggle "Reducir efectos visuales". Default false. */
export function getReduceEffects() {
    return localStorage.getItem(KEY_REDUCE_EFFECTS) === 'true';
}

export function setReduceEffects(enabled) {
    if (enabled) {
        localStorage.setItem(KEY_REDUCE_EFFECTS, 'true');
    } else {
        localStorage.removeItem(KEY_REDUCE_EFFECTS);
    }
}

/**
 * Skin del dino (id del registro DINO_SKINS de game/assets/pixelart.js).
 * Default 'classic'. Este módulo guarda el string tal cual — la validación
 * contra el registro la hacen los consumidores con `normalizeSkinId` (así
 * settings.js no importa código del juego y no crea dependencia circular).
 */
export function getSkin() {
    return localStorage.getItem(KEY_SKIN) ?? 'classic';
}

/**
 * Persiste el skin y avisa a los interesados (el dino ambiente del menú se
 * actualiza en vivo vía AppController; la próxima partida lo usa al montar
 * el Dino real).
 */
export function setSkin(skinId) {
    localStorage.setItem(KEY_SKIN, skinId);
    window.dispatchEvent(new CustomEvent('daino:skinchange', { detail: { skinId } }));
}

/**
 * Lista todas las keys daino:* en localStorage. Útil para mostrar al user
 * qué se va a borrar en "Borrar datos locales".
 */
export function listKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null && key.startsWith(PREFIX)) out.push(key);
    }
    return out;
}

/** Limpia todos los keys daino:* de localStorage. */
export function clearAll() {
    const keys = listKeys();
    for (const key of keys) localStorage.removeItem(key);
    return keys.length;
}
