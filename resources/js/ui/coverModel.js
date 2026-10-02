// Qué enseña la portada de un nivel (T04, doc 12). Puro.
//
// La portada es el escenario del nivel a una hora del cielo (la dibuja
// pixel/cover.js). Aquí se decide cuál:
//   - El ESCENARIO, el mismo con el que se juega (registry.playSceneId).
//   - La HORA, por la dificultad: cuanto más difícil, más tarde. Relajado es
//     pleno día, Normal el atardecer, Extremo la noche cerrada. Con los oficiales
//     ordenados de fácil a difícil, el catálogo se lee como un día que pasa, y la
//     hora de una portada dice de un vistazo lo que las estrellas dicen al mirarlas.
//     Cualquier hora es verdad: todo nivel recorre el día entero.
//   - Una historia de autor enseña su hora (la del destello verde de One Day): es
//     su imagen, no una entre cinco.
//   - Dos niveles con el mismo escenario y la misma dificultad no salen iguales:
//     el paisaje se desplaza según el nivel.

import { playSceneId, resolveScene } from '../game/scenes/registry.js';

/**
 * Hora del cielo de la portada por dificultad (1-5), según el ciclo de la escena.
 * `nocturne` (la Ciudad) es de noche de principio a fin: de la hora azul a la
 * medianoche con todas sus ventanas.
 */
export const COVER_HOURS = Object.freeze({
    journey: Object.freeze([13, 17.9, 18.3, 19, 23.5]),
    nocturne: Object.freeze([19.3, 20.2, 21.5, 23, 24.5]),
});

/** Cuántos encuadres distintos del paisaje hay, y cuántas celdas separan uno de otro. */
export const COVER_PANS = Object.freeze({ count: 16, stepCells: 29 });

/**
 * @typedef {{ scene: string, hour: number, pan: number }} CoverSpec
 * `pan`: desplazamiento del paisaje en celdas de la portada.
 */

/**
 * @param {{ id?: number, audio_sha256?: string | null, difficulty?: number, scene?: string | null, scene_auto?: string | null }} level
 * @returns {CoverSpec}
 */
export function coverSpec(level) {
    const scene = resolveScene(playSceneId(level));
    return { scene: scene.id, hour: coverHour(scene, level.difficulty), pan: coverPan(level) };
}

/** La portada de una escena en su hora de siempre (el selector de escenario). */
export function sceneCoverSpec(scene) {
    return { scene: scene.id, hour: scene.menuHour, pan: 0 };
}

/**
 * @param {import('../game/scenes/registry.js').SceneDef} scene
 * @param {number | undefined} difficulty
 */
export function coverHour(scene, difficulty) {
    const hours = COVER_HOURS[scene.cycle];
    if (!hours) return scene.menuHour;
    const d = Math.min(5, Math.max(1, Math.round(Number(difficulty) || 3)));
    return hours[d - 1];
}

/** Encuadre estable por nivel: el mismo nivel tiene siempre la misma portada. */
export function coverPan(level) {
    const sha = typeof level.audio_sha256 === 'string' ? level.audio_sha256 : '';
    const seed = /^[0-9a-f]{4}/.test(sha) ? Number.parseInt(sha.slice(0, 4), 16) : Math.abs(Math.imul(Number(level.id) || 0, 2654435761));
    return (seed % COVER_PANS.count) * COVER_PANS.stepCells;
}

/** Clave de una portada: dos niveles con la misma comparten imagen. */
export function coverKey(spec) {
    return `${spec.scene}|${spec.hour}|${spec.pan}`;
}

