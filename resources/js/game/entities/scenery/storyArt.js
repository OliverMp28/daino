// Arte de la primera historia de autor, One Day (T02.6): el barco, las figuras y
// los materiales con que la hora lo tiñe todo. La isla (tierra, faro, casa,
// árboles y palmeras) se dibuja con código en storyIsland.js. Aparte de las capas
// (StoryShip.js, StoryCliff.js) para que el guardián de legibilidad
// (scenes/backdrops.js) sepa tamaños y colores sin Pixi.
//
// A MEDIA celda del arte (como la luna, la lluvia y la nieve): con la celda entera
// un galeón no tiene jarcia ni una figura, pelo. Evoca sin copiar: un galeón
// cualquiera y siluetas sin caras ni logos.
//
// Cada carácter es un MATERIAL que la capa tiñe con la luz de la hora
// (`storyColors`); las figuras son siluetas (K). El filo de luz del sol bajo o de
// la luna lo pone una capa aparte (`rimRows`), como en las crestas.

import { PIXEL_SCALE } from '../../config.js';
import { hexToRgb } from '../../scenes/color.js';

/** Unidades de mundo por píxel del arte de las historias: media celda. */
export const STORY_CELL = PIXEL_SCALE / 2;

/**
 * El galeón, con la proa a la derecha. 52 × 40 → 104 × 80 de mundo (72 sobre el
 * agua): cabe en el disco del sol del ocaso (≈ 131 de diámetro), la silueta que
 * se va. Tres palos con velas cuadradas hinchadas (juanete, gavia y mayor), la
 * latina de mesana, los foques, el bauprés, la bandera de popa y los gallardetes.
 *   O o   velas (luz y sombra)
 *   q     casco, palos, vergas y jarcia
 *   k     portas de los cañones
 *   w     ventanas de la popa (se encienden de noche)
 */
export const SHIP_ROWS = Object.freeze([
    '........................qqqq........................',
    '........................qqqqq.......................',
    '....................qqqqqqqqq.......................',
    '.....................oOOOOOO.........qqq............',
    '.....................oOOOOOO.........q..............',
    '.....................oOOOOOO......qqqqqqq...........',
    '......................ooOoo........oOOOO............',
    '...........qq...........q..........oOOOO............',
    '...........q............q...........ooooq...........',
    '...........q....q..qqqqqqqqqqq.......q...q..........',
    '...........q...q....oOOOOOOOO........q.O.q..........',
    '...........qOOq.....oOOOOOOOO....qqqqqqqqqq.........',
    '..........oqOOq.....oOOOOOOOO.....oOOOOOOO.q........',
    '.........oOqOq......oOOOOOOOO.....oOOOOOOOO.q.......',
    '.........oOqqO......oOOOOOOOO.....oOOOOOOOOO.q......',
    '........oOOqOO.......ooOOOoo......oOOOOOOOOOO.q.....',
    '........oOOqOO..........q..........ooOooOOOOOO.q....',
    '.......oOOqqOO..........q............q.oooooooo.q...',
    '.......oOqOqOO....qqqqqqqqqqqqq......q...OOO....q...',
    '......oOqOOqOO.....oOOOOOOOOOO..qqqqqqqqqqqOO....q..',
    '......oqOOOqOO.....oOOOOOOOOOO...oOOOOOOOOoooo....q.',
    '.q.....qoooqooq....oOOOOOOOOOO...oOOOOOOOO.........q',
    'qqq...q....q..q....oOOOOOOOOOO...oOOOOOOOO........q.',
    'qqq..q.....q...q...oOOOOOOOOOO...oOOOOOOOO.......q..',
    '.qqqqqqqqqqqqq.q...oOOOOOOOOOO....ooOOOoo........q..',
    '..qoqoqoqoqoqqq.....ooOOOOOoo.....q..q...q.....qq...',
    '..qwqwqwqqqqqqqq....q...q...q....qqqqqqqqqqqq.qqq...',
    '...qqqqqqqqqqqqqq..q....q....q...qqoqoqoqoqqqqqq....',
    '...qwqwqwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq.....',
    '...qqqqqqqqqqqqqqoqoqoqoqoqoqoqoqoqqqqqqqqqqqqqq....',
    '....qqqqqqqkqqkqqkqqkqqkqqkqqkqqkqqkqqkqqqqqqqqq....',
    '....qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq....',
    '.....ooooooooooooooooooooooooooooooooooooooooooo....',
    '.....qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq....',
    '......qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq.....',
    '.......qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq......',
    '........qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq.......',
    '.........qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq........',
    '...........qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq.........',
    '..............qqqqqqqqqqqqqqqqqqqqqqqqqqq...........',
]);

/** Fila de la línea de flotación: lo de debajo va bajo el agua con el barco a flote. */
export const SHIP_WATERLINE = 36;

/** El farol de popa (centro, en píxeles del arte, con la proa a la derecha). */
export const SHIP_LAMP = Object.freeze([2.5, 23.5]);

/**
 * Ella, mirando al mar desde el borde del cabo, con el viento que sube del agua
 * (el pelo y la falda se van hacia tierra) y el farol colgando de la mano
 * adelantada. 14 × 24 (48 de mundo: la isla está más cerca que el barco). Tres
 * fotogramas del viento.
 */
export const WOMAN_ROWS = Object.freeze([
    Object.freeze([
        '.......KKK....',
        '......KKKKK...',
        '.....KKKKKKK..',
        '....KKKKKKKK..',
        '..KKKKKKKKK...',
        '.KKK..KKKK....',
        'KK.....KK.....',
        '......KKKK....',
        '.....KKKKKK...',
        '.....KKKKKKK..',
        '.....KKKKK.KK.',
        '.....KKKKK..KK',
        '......KKKK....',
        '.....KKKKKK...',
        '....KKKKKKK...',
        '...KKKKKKKK...',
        '.KKKKKKKKKKK..',
        'KKKKKKKKKKKK..',
        '.KKKKKKKKKKKK.',
        '..KKKKKKKKKKK.',
        '..KKKKKKKKKKKK',
        '...KKKKKKKKKKK',
        '...KKKKKKKKKKK',
        '....KKKKKKKKK.',
    ]),
    Object.freeze([
        '.......KKK....',
        '......KKKKK...',
        '.....KKKKKKK..',
        '...KKKKKKKKK..',
        '.KKKKKKKKKK...',
        'KKK...KKKK....',
        'K......KK.....',
        '......KKKK....',
        '.....KKKKKK...',
        '.....KKKKKKK..',
        '.....KKKKK.KK.',
        '.....KKKKK..KK',
        '......KKKK....',
        '.....KKKKKK...',
        '....KKKKKKK...',
        '...KKKKKKKK...',
        '..KKKKKKKKKK..',
        '.KKKKKKKKKKKK.',
        'KKKKKKKKKKKKK.',
        '.KKKKKKKKKKKK.',
        '..KKKKKKKKKKKK',
        '..KKKKKKKKKKKK',
        '...KKKKKKKKKKK',
        '....KKKKKKKKK.',
    ]),
    Object.freeze([
        '.......KKK....',
        '......KKKKK...',
        '.....KKKKKKK..',
        '....KKKKKKKK..',
        '.KKKKKKKKKK...',
        'KK....KKKK....',
        '.K.....KK.....',
        '......KKKK....',
        '.....KKKKKK...',
        '.....KKKKKKK..',
        '.....KKKKK.KK.',
        '.....KKKKK..KK',
        '......KKKK....',
        '.....KKKKKK...',
        '....KKKKKKK...',
        '...KKKKKKKK...',
        'KKKKKKKKKKKK..',
        '.KKKKKKKKKKK..',
        '..KKKKKKKKKKK.',
        '.KKKKKKKKKKKK.',
        '..KKKKKKKKKKKK',
        '..KKKKKKKKKKKK',
        '...KKKKKKKKKKK',
        '....KKKKKKKKK.',
    ]),
]);

/** Donde cuelga el farol de su mano (centro, en píxeles de su arte). */
export const WOMAN_LAMP = Object.freeze([13.5, 12.5]);

/** El hijo (unos nueve años), a su lado desde "Diez años después". Dos fotogramas. */
export const CHILD_ROWS = Object.freeze([
    Object.freeze([
        '....KKK...',
        '...KKKKK..',
        '..KKKKKK..',
        '.KK.KKKK..',
        '.....KK...',
        '....KKKK..',
        '...KKKKKK.',
        '..K.KKKK.K',
        '..K.KKKK.K',
        '....KKKK..',
        '....KKKK..',
        '....KK.KK.',
        '....KK.KK.',
        '....K...K.',
        '....K...K.',
        '...KK..KK.',
    ]),
    Object.freeze([
        '....KKK...',
        '...KKKKK..',
        '.KKKKKKK..',
        'KK..KKKK..',
        '.....KK...',
        '....KKKK..',
        '...KKKKKK.',
        '..K.KKKK.K',
        '..K.KKKK.K',
        '....KKKK..',
        '....KKKK..',
        '....KK.KK.',
        '....KK.KK.',
        '....K...K.',
        '....K...K.',
        '...KK..KK.',
    ]),
]);

/** Resplandor de un farol, en blanco (se tiñe de luz cálida). */
export const LAMP_GLOW_ROWS = Object.freeze(['..QQ..', '.QQQQ.', 'QQQQQQ', 'QQQQQQ', '.QQQQ.', '..QQ..']);

/**
 * Los materiales a cada hora: de qué color salen de la luz del cielo. Cada uno
 * tiene su color a pleno sol y cuánto conserva de él (`…Mix`); con el sol bajo se
 * funde con lo cercano de la hora, que lo vuelve silueta.
 *   hull              El casco del barco: lo lejano, oscurecido.
 *   sailCanvas/Shade/Haze  Las velas: lona con la luz de las nubes (el mismo
 *                     blanco que el sol tiñe), en sombra y con la bruma de lo lejano.
 *   rock, earth, grass  La isla: roca parda (no gris), tierra y hierba. No pueden
 *                     ser más claras: lo que se juega pasa por delante y el
 *                     guardián mide su contraste; el verde gana en saturación.
 *   wall, roof        La casa (piedra encalada y teja).
 *   tower, band       El faro (blanco y franjas rojas). Gris claro y no blanco: el
 *                     Dino es blanco y pasa por delante (lo mide el guardián).
 *   leaf, wood        Hojas (palmeras, árboles, arbustos) y madera (troncos,
 *                     puertas, la cerca, el bote).
 *   dark              Puertas, ventanas apagadas y la linterna del faro: lo
 *                     cercano, muy oscuro.
 */
export const STORY_MATERIALS = Object.freeze({
    hullShade: 0.5,
    sailCanvas: '#f0d29e',
    sailShade: 0.42,
    sailHaze: 0.18,
    rockDay: '#6e5540', rockDayMix: 0.85,
    earthDay: '#73492a', earthDayMix: 0.85,
    grassDay: '#2f6628', grassDayMix: 0.9,
    wallDay: '#6e6458', wallDayMix: 0.6,
    roofDay: '#7a3428', roofDayMix: 0.6,
    towerDay: '#84847f', towerDayMix: 0.45,
    bandDay: '#86302a', bandDayMix: 0.6,
    leafDay: '#2a6630', leafDayMix: 0.85,
    woodDay: '#5a4028', woodDayMix: 0.7,
    darkShade: 0.55,
    /** Elevación del sol (grados) a la que la luz es ya de pleno día. */
    daylightElev: 10,
});

const M = STORY_MATERIALS;
const SAIL_CANVAS = hexToRgb(M.sailCanvas);
/** [clave de salida, color de día, cuánto conserva]: lo que la isla tiñe igual. */
const LAND = Object.freeze([
    ['rock', hexToRgb(M.rockDay), M.rockDayMix],
    ['earth', hexToRgb(M.earthDay), M.earthDayMix],
    ['grass', hexToRgb(M.grassDay), M.grassDayMix],
    ['wall', hexToRgb(M.wallDay), M.wallDayMix],
    ['roof', hexToRgb(M.roofDay), M.roofDayMix],
    ['tower', hexToRgb(M.towerDay), M.towerDayMix],
    ['band', hexToRgb(M.bandDay), M.bandDayMix],
    ['leaf', hexToRgb(M.leafDay), M.leafDayMix],
    ['wood', hexToRgb(M.woodDay), M.woodDayMix],
]);

/** Materiales que se ven delante del cielo (el guardián mide el más claro). */
export const STORY_SOLID_MATERIALS = Object.freeze(['rock', 'earth', 'grass', 'wall', 'roof', 'tower', 'band', 'leaf', 'wood']);

/** Contenedor reutilizable de los colores de la historia. */
export function createStoryColors() {
    const out = { hull: [0, 0, 0], sail: [0, 0, 0], dark: [0, 0, 0] };
    for (const [k] of LAND) out[k] = [0, 0, 0];
    return out;
}

/**
 * Colores de los materiales con el cielo de una hora.
 *
 * @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state
 * @param {ReturnType<typeof createStoryColors>} out
 */
export function storyColors(state, out) {
    const day = Math.max(0, Math.min(1, state.elev / M.daylightElev));
    const { far, near } = state.mountains;
    const cloud = state.clouds.body;
    for (let i = 0; i < 3; i++) {
        out.hull[i] = far[i] * M.hullShade;
        const canvas = cloud[i] * SAIL_CANVAS[i] * M.sailShade;
        out.sail[i] = canvas + (far[i] - canvas) * M.sailHaze;
        out.dark[i] = near[i] * M.darkShade;
    }
    for (let k = 0; k < LAND.length; k++) {
        const [key, rgb, mix] = LAND[k];
        const o = out[key];
        for (let i = 0; i < 3; i++) o[i] = near[i] + (rgb[i] - near[i]) * mix * day;
    }
    return out;
}

/**
 * Las filas de un material: sus caracteres pasan a los de `map` (los grises que
 * tiñe el material) y el resto, a transparente.
 *
 * @param {ReadonlyArray<string>} rows
 * @param {Record<string, string>} map
 */
export function materialRows(rows, map) {
    return Object.freeze(rows.map((r) => [...r].map((c) => map[c] ?? '.').join('')));
}

/**
 * Filo de luz de un arte: las celdas cuyo vecino hacia la luz está vacío.
 * `side` 1: la luz viene de la derecha; −1: de la izquierda (el arte volteado
 * la pone a la derecha en pantalla). Con `top`, también las de arriba.
 *
 * @param {ReadonlyArray<string>} rows
 * @param {1 | -1} side
 * @param {{ top?: boolean }} [opts]
 */
export function rimRows(rows, side, opts = {}) {
    const empty = (y, x) => y < 0 || x < 0 || x >= rows[y].length || rows[y][x] === '.';
    return Object.freeze(rows.map((r, y) => [...r].map((c, x) => {
        if (c === '.') return '.';
        if (empty(y, x + side)) return 'Q';
        if (opts.top && empty(y - 1, x)) return 'Q';
        return '.';
    }).join('')));
}

/** Alto sobre el horizonte de lo que asoma del barco a flote, en unidades de mundo. */
export function shipVisibleHeight() {
    return SHIP_WATERLINE * STORY_CELL;
}
