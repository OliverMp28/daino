// Lo que cada capa del escenario pone DETRÁS del juego (T02.2), para el guardián
// de legibilidad (readability.js, doc 11 §2.3).
//
// Antes el guardián solo conocía la cordillera. Con escenas nuevas, cada tipo de
// capa declara aquí qué franja de alturas sobre el suelo (unidades de mundo)
// puede tapar y de qué color, a cada hora. Un tipo de capa sin entrada hace
// fallar la prueba: una capa nueva no puede escapar del guardián.
//
// Puro y sin Pixi (el faro trae su arte en un módulo de datos).
//
//   from, to   Franja que la capa puede tener detrás de lo que se juega.
//   solid      Hasta qué altura la cubre SIEMPRE: por debajo no asoma el cielo.
//              -Infinity si deja huecos (islas sueltas, un faro).
//   colorAt(state, h, out)  Su color a la altura h.

import { PIXEL_SCALE, WORLD_VIEW } from '../config.js';
import { lighthouseVisibleRows } from '../entities/scenery/lighthouseArt.js';
import { ridgeHeights, ridgePoints } from '../entities/scenery/ridgeShape.js';
import { skylineBuildings, skylineCells, skylineGapless } from '../entities/scenery/skylineShape.js';
import { seaColorAt } from './skyModel.js';

/** Base de una capa: la línea del suelo o la del horizonte del cielo. */
function anchorBase(def, scene) {
    return def.params?.anchor === 'horizon' ? scene.horizonRise : 0;
}

/**
 * @type {Record<string, ((def: object, scene: import('./registry.js').SceneDef) => ({ from: number, to: number, solid: number, colorAt: (state: object, h: number, out: number[]) => ArrayLike<number> } | null))>}
 */
export const LAYER_BACKDROPS = Object.freeze({
    /**
     * Montañas o islas: su color de la hora, de la cresta más baja a la más alta
     * de su forma REAL (la de la vista más ancha, que contiene a las demás: los
     * puntos de una vista estrecha son los primeros de la ancha). Por debajo de
     * la más baja la capa tapa siempre; por sus valles asoma el cielo.
     */
    ridge: (def, scene) => {
        const base = anchorBase(def, scene);
        const heights = ridgeHeights(ridgePoints(WORLD_VIEW.maxWidth, def.params.step), def.params);
        return {
            from: base,
            to: base + Math.max(...heights),
            solid: base + Math.min(...heights),
            colorAt: (state) => state.mountains[def.color],
        };
    },
    /** El mar: del suelo al horizonte, siempre; más claro cuanto más lejos. */
    sea: (def, scene) => ({
        from: 0,
        to: scene.horizonRise,
        solid: scene.horizonRise,
        colorAt: (state, h, out) => seaColorAt(state, 1 - h / scene.horizonRise, out),
    }),
    /**
     * El faro: silueta teñida con el color de lo lejano (su franja clara es ese
     * color y el resto, más oscuro: contra lo que se juega, que es claro, este es
     * el caso peor). La lámpara y su haz no se miden: son locales, como el sol.
     */
    lighthouse: (def, scene) => ({
        from: scene.horizonRise,
        to: scene.horizonRise + lighthouseVisibleRows() * PIXEL_SCALE,
        solid: -Infinity,
        colorAt: (state) => state.mountains.far,
    }),
    /**
     * La ciudad (T02.4): los edificios, con el color de lo lejano o lo cercano de
     * la hora, hasta el remate más alto (antenas incluidas). Entre edificios asoma
     * el cielo hasta el suelo. Las ventanas encendidas no se miden: son puntos de
     * luz de una celda, como las estrellas.
     */
    skyline: (def) => {
        const cells = skylineCells(WORLD_VIEW.maxWidth, PIXEL_SCALE);
        const buildings = skylineBuildings(cells, def.params);
        return {
            from: 0,
            to: Math.max(...buildings.map((b) => b.top)) * PIXEL_SCALE,
            // Una fila sin huecos tapa el cielo hasta su edificio más bajo.
            solid: skylineGapless(buildings, cells) ? Math.min(...buildings.map((b) => b.h)) * PIXEL_SCALE : -Infinity,
            colorAt: (state) => state.mountains[def.color],
        };
    },
    /** Siempre por encima de lo que se juega (`clearancePx`, con su propio test). */
    clouds: () => null,
    /** Bajo la línea del suelo. */
    ground: () => null,
    /**
     * El clima (T02.3) no tapa: gotas y copos finos que caen, como las estrellas
     * que titilan. Su color sale del cielo aclarado (weatherColorsAt en skyModel).
     * Los relámpagos aclaran el cielo unas décimas de segundo: tampoco se miden.
     */
    rain: () => null,
    snow: () => null,
    lightning: () => null,
});

/**
 * Fondos de una escena, en orden de capas.
 *
 * @param {import('./registry.js').SceneDef} scene
 * @returns {Array<{ id: string, from: number, to: number, solid: number, colorAt: Function }>}
 */
export function sceneBackdrops(scene) {
    const out = [];
    for (const def of scene.layers) {
        const describe = LAYER_BACKDROPS[def.type];
        if (describe === undefined) {
            throw new Error(`backdrops: la capa "${def.type}" (escena "${scene.id}") no dice qué pone detrás del juego`);
        }
        const span = describe(def, scene);
        if (span !== null) out.push({ id: def.id, ...span });
    }
    return out;
}
