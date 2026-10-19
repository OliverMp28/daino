// Modelo de vista del catálogo de niveles (Ola 2).
//
// Todo lo que decide QUÉ enseña una tarjeta o una ficha, sin DOM: textos,
// estrellas, qué acción está disponible, la marca combinada. La vista
// (`catalog.js`) solo lo pinta. Así las reglas se prueban en Node y la vista no
// acumula condiciones sueltas.
//
// Tras el playtest de la Ola 5: una sola vista con todos los niveles jugables
// (oficiales y de la comunidad juntos) y "Míos" aparte, y pulsar una tarjeta
// JUEGA. La ficha (ranking, publicar) se abre con su botón de detalles.

import { mergeBest } from '../storage/localBests.js';
import { DIFFICULTY_NAMES } from '../game/levels/difficulty.js';
import { DEFAULT_SCENE, SELECTABLE_SCENES, autoSceneId, playSceneId, resolveScene } from '../game/scenes/registry.js';
import { coverSpec, sceneCoverSpec } from './coverModel.js';
import { publishView, PUBLISH_STATE } from './publishModel.js';

// Los nombres viven con los perfiles del charter (Ola 5); se reexportan para
// quien ya los importaba desde aquí.
export { DIFFICULTY_NAMES };

/** Qué pasa al pulsar un nivel en el catálogo. */
export const PLAY_MODE = Object.freeze({
    /** Audio en el servidor: se juega directamente. */
    CATALOG: 'catalog',
    /** Nivel privado propio: el audio está en el equipo del jugador (D11). */
    NEEDS_FILE: 'needs-file',
    /** Todavía no se puede jugar (analizándose) o no es tuyo ni público: se abre la ficha. */
    UNAVAILABLE: 'unavailable',
});

/** @typedef {'public' | 'mine'} CatalogTab */

/**
 * @param {boolean} authenticated
 * @returns {Array<{ id: CatalogTab, label: string }>}
 */
export function tabsFor(authenticated) {
    const tabs = [{ id: 'public', label: 'Todos' }];
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
 * @param {object} level
 * @returns {PLAY_MODE[keyof PLAY_MODE]}
 */
export function playModeFor(level) {
    if (level.is_public === true && level.has_audio === true) return PLAY_MODE.CATALOG;
    if (level.is_mine !== true) return PLAY_MODE.UNAVAILABLE;
    // Se está analizando: su chart va a cambiar. Se juega cuando esté listo.
    if (level.pending_public === true) return PLAY_MODE.UNAVAILABLE;
    // Audio subido (listo para publicar, o con el análisis fallido): su autor lo
    // juega desde el servidor, sin volver a elegir el archivo.
    if (level.has_audio === true) return PLAY_MODE.CATALOG;
    return PLAY_MODE.NEEDS_FILE;
}

/** Texto de la acción principal de cada modo (tarjeta y ficha). */
const PLAY_LABELS = Object.freeze({
    [PLAY_MODE.CATALOG]: 'Jugar',
    [PLAY_MODE.NEEDS_FILE]: 'Elegir MP3 y jugar',
    [PLAY_MODE.UNAVAILABLE]: 'Ver detalles',
});

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

    const title = level.title;
    const difficulty = difficultyView(level.difficulty);
    const duration = formatDuration(level.duration_ms ? level.duration_ms / 1000 : level.duration_sec);
    let actionLabel;
    if (playMode === PLAY_MODE.CATALOG) actionLabel = `Jugar «${title}»`;
    else if (playMode === PLAY_MODE.NEEDS_FILE) actionLabel = `Elegir el MP3 de «${title}» y jugar`;
    else actionLabel = `«${title}»: ${publish.state === PUBLISH_STATE.ANALYZING ? 'analizándose, ver progreso' : 'ver detalles'}`;

    return {
        id: level.id,
        title,
        byline,
        badge: level.is_official ? 'Oficial' : (level.is_mine ? publish.badge : null),
        /** T02: el escenario con el que se juega (nombre para la ficha). */
        scene: resolveScene(playSceneId(level)).label,
        difficulty,
        bpm: Number.isFinite(level.bpm) && level.bpm > 0 ? `${level.bpm} BPM` : null,
        duration,
        best: best === null ? null : { points: formatPoints(best.points), percentage: `${best.percentage} %`, completed: best.percentage >= 100, ratio: Math.min(1, Math.max(0, best.percentage / 100)) },
        // Solo en lo publicado: en un nivel privado el único jugador es su autor.
        players: level.is_public === true && level.players > 0 ? `${level.players} ${level.players === 1 ? 'jugador' : 'jugadores'}` : null,
        /** T04: la portada es el escenario del nivel a una hora del cielo (coverModel.js). */
        cover: coverSpec(level),
        /** Lo de la línea de datos, ya junto: "Aurora · 82 BPM · 2:44". */
        meta: [byline, Number.isFinite(level.bpm) && level.bpm > 0 ? `${level.bpm} BPM` : null, duration].filter(Boolean).join(' · '),
        playMode,
        canPublish: publish.canPublish,
        /** Ola 4: estado de publicación y del análisis del servidor. */
        publish,
        playLabel: PLAY_LABELS[playMode],
        /** Lo que anuncia la tarjeta a un lector de pantalla: qué hace pulsarla. */
        actionLabel: `${actionLabel}. ${difficulty.label}. ${duration}.`,
    };
}

// --------------------------- Escenario (T02.1) ---------------------------

/**
 * Selector del escenario de un nivel propio (T02.1). Cualquier nivel tuyo, en
 * cualquier estado: el escenario no toca ni el chart ni las marcas, así que se
 * puede cambiar también publicado. Ajeno: null (la ficha enseña solo el nombre).
 *
 * `auto` = que lo decida el juego (T02.5): el ambiente que pega con cómo suena
 * la canción (`scene_auto`, lo propone el servidor al analizarla), o la
 * Cordillera si ninguno encaja claramente. La opción enseña la propuesta.
 *
 * @param {object} level  Fila de GET /api/levels.
 * @param {{ serverAnalysis?: boolean }} [opts]  `serverAnalysis`: si el servidor
 *        analiza lo que se publica (`<meta name="daino:server-analysis">`).
 * @returns {{ current: string, options: Array<{ value: string, label: string, hint: string, cover: import('./coverModel.js').CoverSpec }> } | null}
 *          `cover`: la muestra del ambiente es su portada, a su hora de siempre.
 */
export function sceneChoiceView(level, { serverAnalysis = true } = {}) {
    if (level?.is_mine !== true) return null;
    const chosen = SELECTABLE_SCENES.find((s) => s.id === level.scene);
    const proposed = autoSceneId(level);
    const auto = resolveScene(proposed ?? DEFAULT_SCENE);
    return {
        current: chosen ? chosen.id : 'auto',
        options: [
            { value: 'auto', label: `Automático: ${auto.label}`, hint: autoSceneHint(level, proposed !== null, serverAnalysis), cover: sceneCoverSpec(auto) },
            ...SELECTABLE_SCENES.map((s) => ({ value: s.id, label: s.label, hint: s.blurb, cover: sceneCoverSpec(s) })),
        ],
    };
}

/** Por qué Automático es lo que es: propuesta, ningún encaje, o aún sin escuchar. */
function autoSceneHint(level, proposed, serverAnalysis) {
    if (proposed) return 'Elegido por cómo suena tu canción.';
    const job = level.analysis?.status;
    if (job === 'queued' || job === 'running') return 'Se decidirá cuando termine de analizarse tu canción.';
    // El techo de dificultad solo existe con el análisis del servidor.
    if (level.difficulty_ceiling !== null && level.difficulty_ceiling !== undefined) {
        return 'Tu canción no encaja claramente con ningún otro ambiente.';
    }
    if (!serverAnalysis) {
        return 'El ambiente automático sale del análisis en el servidor, que ahora no está activo: se juega en la Cordillera.';
    }
    return 'Al publicarla, el servidor escuchará tu canción y propondrá el ambiente que mejor le pegue.';
}

/**
 * Texto de una pestaña vacía.
 *
 * @param {CatalogTab} tab
 * @returns {{ title: string, body: string, action: 'upload' | null }}
 */
export function emptyView(tab) {
    if (tab === 'mine') {
        return { title: 'Aún no tienes niveles', body: 'Cada canción que juegues con la sesión iniciada aparece aquí, lista para publicarla.', action: 'upload' };
    }
    return { title: 'Aún no hay niveles', body: 'Mientras tanto, prueba con tu propia música.', action: 'upload' };
}
