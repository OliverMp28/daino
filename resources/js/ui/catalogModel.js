// Modelo de vista del catálogo de niveles (Ola 2).
//
// Todo lo que decide QUÉ enseña una tarjeta o una ficha, sin DOM: textos,
// estrellas, qué acción está disponible, la marca combinada. La vista
// (`catalog.js`) solo lo pinta. Así las reglas se prueban en Node y la vista no
// acumula condiciones sueltas.

import { mergeBest } from '../storage/localBests.js';
import { DIFFICULTY_NAMES } from '../game/levels/difficulty.js';
import { publishView } from './publishModel.js';

// Los nombres viven con los perfiles del charter (Ola 5); se reexportan para
// quien ya los importaba desde aquí.
export { DIFFICULTY_NAMES };

/** Qué puede hacer el jugador con un nivel desde el catálogo. */
export const PLAY_MODE = Object.freeze({
    /** Audio en el servidor: se juega directamente. */
    CATALOG: 'catalog',
    /** Nivel privado propio: el audio está en el equipo del jugador (D11). */
    NEEDS_FILE: 'needs-file',
    /** Ni audio publicado ni es tuyo: no se puede jugar. */
    UNAVAILABLE: 'unavailable',
});

/** @typedef {'official' | 'community' | 'mine'} CatalogTab */

/**
 * @param {boolean} authenticated
 * @returns {Array<{ id: CatalogTab, label: string }>}
 */
export function tabsFor(authenticated) {
    const tabs = [
        { id: 'official', label: 'Oficiales' },
        { id: 'community', label: 'De la comunidad' },
    ];
    if (authenticated) tabs.push({ id: 'mine', label: 'Míos' });
    return tabs;
}

/**
 * @param {number} seconds
 * @returns {string}  "3:07"
 */
export function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * @param {number} n
 * @returns {string}  "12.345"
 */
export function formatPoints(n) {
    return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('es-ES');
}

/**
 * @param {number} difficulty
 * @returns {{ value: number, filled: number, name: string, label: string }}
 */
export function difficultyView(difficulty) {
    const value = Math.min(5, Math.max(1, Math.round(Number(difficulty) || 3)));
    return { value, filled: value, name: DIFFICULTY_NAMES[value], label: `Dificultad ${value} de 5: ${DIFFICULTY_NAMES[value]}` };
}

/**
 * Tono (0-359) estable por nivel para la portada generada: el mismo nivel
 * tiene siempre el mismo color, en cualquier dispositivo.
 *
 * @param {{ id: number, audio_sha256?: string | null }} level
 * @returns {number}
 */
export function coverHue(level) {
    const sha = typeof level.audio_sha256 === 'string' ? level.audio_sha256 : '';
    const seed = /^[0-9a-f]{4}/.test(sha) ? Number.parseInt(sha.slice(0, 4), 16) : (Number(level.id) || 0) * 2654435761;
    return Math.abs(seed) % 360;
}

/**
 * @param {object} level
 * @returns {PLAY_MODE[keyof PLAY_MODE]}
 */
export function playModeFor(level) {
    if (level.is_public === true && level.has_audio === true) return PLAY_MODE.CATALOG;
    if (level.is_mine === true) return PLAY_MODE.NEEDS_FILE;
    return PLAY_MODE.UNAVAILABLE;
}

/**
 * @param {object} level  Fila de GET /api/levels.
 * @param {{ points: number, percentage: number } | null} [localBest]
 */
export function cardView(level, localBest = null) {
    const best = mergeBest(level.my_best, localBest);
    const playMode = playModeFor(level);
    const publish = publishView(level);
    // La insignia ya dice "Oficial": un oficial sin artista no repite nada.
    let byline;
    if (level.artist) byline = level.artist;
    else if (level.is_official) byline = '';
    else if (level.is_mine) byline = 'Tu nivel';
    else if (level.author?.username) byline = `por ${level.author.username}`;
    else byline = '';

    return {
        id: level.id,
        title: level.title,
        byline,
        badge: level.is_official ? 'Oficial' : (level.is_mine ? publish.badge : null),
        difficulty: difficultyView(level.difficulty),
        bpm: Number.isFinite(level.bpm) && level.bpm > 0 ? `${level.bpm} BPM` : null,
        duration: formatDuration(level.duration_ms ? level.duration_ms / 1000 : level.duration_sec),
        best: best === null ? null : { points: formatPoints(best.points), percentage: `${best.percentage} %`, completed: best.percentage >= 100 },
        players: level.players > 0 ? `${level.players} ${level.players === 1 ? 'jugador' : 'jugadores'}` : null,
        hue: coverHue(level),
        playMode,
        canPublish: publish.canPublish,
        /** Ola 4: estado de publicación y del análisis del servidor. */
        publish,
        playLabel: playMode === PLAY_MODE.NEEDS_FILE ? 'Elegir MP3 y jugar' : 'Jugar',
    };
}

/**
 * Texto de una pestaña vacía.
 *
 * @param {CatalogTab} tab
 * @returns {{ title: string, body: string, action: 'upload' | null }}
 */
export function emptyView(tab) {
    switch (tab) {
        case 'official':
            return { title: 'Aún no hay niveles oficiales', body: 'Mientras tanto, prueba con tu propia música.', action: 'upload' };
        case 'community':
            return { title: 'Nadie ha publicado todavía', body: 'Juega con tu canción y publícala desde "Míos" para estrenar esta sección.', action: 'upload' };
        default:
            return { title: 'Aún no tienes niveles', body: 'Cada canción que juegues con la sesión iniciada aparece aquí, lista para publicarla.', action: 'upload' };
    }
}
