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
import { STORY_SOLID_MATERIALS, createStoryColors, shipVisibleHeight, storyColors } from '../entities/scenery/storyArt.js';
import { ISLAND_LIFT, islandMaterialSpans, islandVisibleHeight } from '../entities/scenery/storyIsland.js';
import { SPECTRUM_BARS } from '../fx/spectrum.js';
import { TONE_RULES, spectrumLight } from '../fx/tones.js';
import { relativeLuminance } from './color.js';
import { seaColorAt } from './skyModel.js';

const storyTmp = createStoryColors();

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
    /**
     * Historias de autor (T02.6), con los colores de sus materiales a la hora
     * (storyArt.js): el barco, en el horizonte, con el de sus velas (el casco es
     * más oscuro); la isla, cerca (su pie en el agua junto a la orilla), con el
     * más claro de los materiales que llegan a cada altura (la roca y la hierba
     * abajo; la casa, las palmeras y el faro arriba), hasta el remate del faro. Las figuras son siluetas más
     * oscuras, y los faroles, las ventanas, el haz del faro, la espuma y el agua
     * que cae, luces locales como el faro de la Costa.
     */
    storyShip: (def, scene) => ({
        from: scene.horizonRise,
        to: scene.horizonRise + shipVisibleHeight(),
        solid: -Infinity,
        colorAt: (state) => storyColors(state, storyTmp).sail,
    }),
    storyCliff: () => ({
        from: ISLAND_LIFT,
        to: ISLAND_LIFT + islandVisibleHeight(),
        solid: -Infinity,
        colorAt: (state, h) => {
            const c = storyColors(state, storyTmp);
            const spans = islandMaterialSpans();
            let best = c.rock;
            let bestL = -1;
            for (const key of STORY_SOLID_MATERIALS) {
                const [from, to] = spans[key];
                if (h - ISLAND_LIFT < from - 8 || h - ISLAND_LIFT > to + 8) continue;
                const l = relativeLuminance(c[key]);
                if (l > bestL) {
                    bestL = l;
                    best = c[key];
                }
            }
            return best;
        },
    }),
    /**
     * Las barras del espectro (T03.2), detrás de la silueta de su anfitriona, hasta
     * `maxRise` por encima de su punto más alto. Su color es un tono del arco que brilla en oscuro (fx/tones.js), con la
     * luz que deja el cielo de la hora: de noche, la del techo de la franja jugable;
     * de día, menos (en sombra). Aquí se mide el caso peor a cualquier hora: el tono
     * MÁS CLARO de todo el arco, como luz y a plena opacidad. Cualquier paleta de
     * efectos, girada por la tonalidad o a juego con el cielo, cae dentro de ese arco.
     */
    spectrum: (def, scene) => {
        const host = scene.layers.find((l) => l.id === def.params.host);
        if (host === undefined) throw new Error(`backdrops: la capa "${def.id}" (escena "${scene.id}") se apoya en "${def.params.host}", que no existe`);
        const span = LAYER_BACKDROPS[host.type](host, scene);
        if (span === null) throw new Error(`backdrops: "${def.params.host}" no tiene silueta en la que apoyar el espectro`);
        const arc = ((TONE_RULES.arc[1] - TONE_RULES.arc[0]) % 360 + 360) % 360;
        let light = [0, 0, 0];
        for (let p = 0; p <= arc; p += 2) {
            const c = spectrumLight([p, p], 0, [0, 0, 0]);
            if (relativeLuminance(c) > relativeLuminance(light)) light = c;
        }
        return {
            from: Math.max(0, span.from),
            to: span.to + (def.params.maxRise ?? SPECTRUM_BARS.maxRise),
            solid: -Infinity,
            colorAt: () => light,
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
