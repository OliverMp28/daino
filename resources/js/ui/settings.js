// Configuración local persistida en localStorage. Bloque 6 Lote D.
//
// Keys con prefijo `daino:` para no colisionar con otras apps en el mismo
// dominio. El "borrar datos locales" del modal de Settings limpia todo lo
// que empiece por ese prefijo (ver `clearAll`).
//
// Source of truth: localStorage. Los consumidores (AudioEngine, modal
// Settings) leen/escriben aquí — no hay variable global cacheada.

const KEY_VOLUME = 'daino:volume';
/**
 * Antes de la T03.1, un interruptor "Reducir efectos visuales" ('true') que solo
 * apagaba los relámpagos. Ya no se lee: quien lo tenía marcado se quedaba sin
 * ningún efecto de la música sin haberlo pedido (playtest). Se borra al elegir.
 */
const KEY_REDUCE_EFFECTS = 'daino:reduce_effects';
const KEY_FX_LEVEL = 'daino:fx_level';
const KEY_SKIN = 'daino:skin';
const KEY_QUALITY = 'daino:quality';
const KEY_AUTO_RETRY = 'daino:auto_retry';
const KEY_RUNS_STARTED = 'daino:runs_started';
/** Prefijo por modo de movimiento: `daino:mode_seen:flip` (Ola 6a). */
const KEY_MODE_SEEN = 'daino:mode_seen:';
/** Prefijo por mecánica que no es un modo: `daino:mechanic_seen:RING_JUMP` (Ola 6c). */
const KEY_MECHANIC_SEEN = 'daino:mechanic_seen:';
const PREFIX = 'daino:';

/** Partidas en las que se enseñan los controles al empezar. */
export const CONTROL_HINT_RUNS = 3;

/** Valores aceptados para la calidad gráfica. 'auto' = degradado adaptativo. */
export const QUALITY_VALUES = Object.freeze(['auto', 'high', 'medium', 'low']);

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

/**
 * "Efectos visuales" (T03.1): cuánto de los efectos de la música quiere el jugador.
 * Las claves son las de FX_PREFS (game/fx/registry.js; un test vigila que
 * coincidan: este módulo no importa código del juego).
 *   full  Completos.
 *   soft  Suaves: a media fuerza y sin nada que cambie la pantalla entera.
 *   min   Mínimos: solo el pulso del suelo y las líneas de velocidad; tampoco los
 *         relámpagos del escenario.
 */
export const FX_LEVEL_VALUES = Object.freeze(['full', 'soft', 'min']);

/** Evento en window cuando cambia: `detail: { level }`. */
export const FX_LEVEL_EVENT = 'daino:fxlevelchange';

/**
 * Por defecto, Completos: los efectos son parte del juego. Solo cuenta lo que el
 * jugador elija en este ajuste.
 * @returns {'full'|'soft'|'min'}
 */
export function getFxLevel() {
    const raw = safeGet(KEY_FX_LEVEL);
    return FX_LEVEL_VALUES.includes(raw) ? raw : 'full';
}

/** @param {'full'|'soft'|'min'} level */
export function setFxLevel(level) {
    const safe = FX_LEVEL_VALUES.includes(level) ? level : 'full';
    safeSet(KEY_FX_LEVEL, safe);
    safeRemove(KEY_REDUCE_EFFECTS);
    window.dispatchEvent(new CustomEvent(FX_LEVEL_EVENT, { detail: { level: safe } }));
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
 * Calidad gráfica (Ola 1). Default 'auto': el engine arranca en el tier alto y
 * baja solo si mide frames lentos sostenidos durante la partida.
 *
 * Se valida contra {@link QUALITY_VALUES} al leer, no al escribir: localStorage
 * es editable por el usuario y un valor basura no debe dejar el juego sin
 * render. Ante algo desconocido, 'auto'.
 *
 * @returns {'auto'|'high'|'medium'|'low'}
 */
export function getQuality() {
    const raw = localStorage.getItem(KEY_QUALITY);
    return QUALITY_VALUES.includes(raw) ? raw : 'auto';
}

/**
 * Persiste la calidad y avisa al engine en vivo — el cambio se ve en el mismo
 * frame, sin recargar ni reiniciar la partida.
 *
 * @param {'auto'|'high'|'medium'|'low'} quality
 */
export function setQuality(quality) {
    const safe = QUALITY_VALUES.includes(quality) ? quality : 'auto';
    localStorage.setItem(KEY_QUALITY, safe);
    window.dispatchEvent(new CustomEvent('daino:qualitychange', { detail: { quality: safe } }));
}

/**
 * Reintentar al instante al chocar, sin panel de resultados (como Geometry
 * Dash). Default false: un nivel de Daino es una canción entera y el panel deja
 * ver lo lejos que llegaste y salir; quien prefiere repetir sin pausa lo activa.
 */
export function getAutoRetry() {
    return safeGet(KEY_AUTO_RETRY) === 'true';
}

export function setAutoRetry(enabled) {
    if (enabled) safeSet(KEY_AUTO_RETRY, 'true');
    else safeRemove(KEY_AUTO_RETRY);
}

/**
 * Cuenta una partida empezada y dice si toca enseñar los controles (las
 * primeras CONTROL_HINT_RUNS). "Borrar datos locales" la vuelve a poner a cero.
 *
 * @returns {boolean}
 */
export function countRunAndShouldHint() {
    const n = Number.parseInt(safeGet(KEY_RUNS_STARTED) ?? '0', 10);
    const runs = Number.isFinite(n) && n >= 0 ? n : 0;
    safeSet(KEY_RUNS_STARTED, String(runs + 1));
    return runs < CONTROL_HINT_RUNS;
}

/**
 * Cuenta una partida con cierto modo de movimiento y devuelve cuántas van
 * (incluida esta). GameSession lo usa para explicar los controles de un modo las
 * primeras veces que alguien se lo encuentra (Ola 6a).
 *
 * @param {string} modeId
 * @returns {number}
 */
export function countModeSeen(modeId) {
    const key = `${KEY_MODE_SEEN}${modeId}`;
    const n = Number.parseInt(safeGet(key) ?? '0', 10);
    const seen = (Number.isFinite(n) && n >= 0 ? n : 0) + 1;
    safeSet(key, String(seen));
    return seen;
}

/**
 * Cuenta una partida en la que aparece una mecánica que no es un modo (el anillo
 * de salto, Ola 6c) y devuelve cuántas van, incluida esta. Mismo uso que
 * `countModeSeen`: explicarla las primeras veces.
 *
 * @param {string} mechanicId  Kind del registro (p. ej. 'RING_JUMP').
 * @returns {number}
 */
export function countMechanicSeen(mechanicId) {
    const key = `${KEY_MECHANIC_SEEN}${mechanicId}`;
    const n = Number.parseInt(safeGet(key) ?? '0', 10);
    const seen = (Number.isFinite(n) && n >= 0 ? n : 0) + 1;
    safeSet(key, String(seen));
    return seen;
}

function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* modo privado o cuota: es una comodidad */ }
}

function safeRemove(key) {
    try { localStorage.removeItem(key); } catch { /* idem */ }
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
