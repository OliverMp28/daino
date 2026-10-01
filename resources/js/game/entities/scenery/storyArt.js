// Arte de la primera historia de autor, One Day (T02.6): el barco, el cabo y las
// dos figuras. Aparte de las capas (StoryShip.js, StoryCliff.js) para que el
// guardián de legibilidad (scenes/backdrops.js) sepa sus tamaños y sus colores
// sin Pixi.
//
// A MEDIA celda del arte (como la luna, la lluvia y la nieve): son cosas lejanas y
// finas, y con la celda entera un galeón no tiene jarcia ni una figura, pelo.
// Evoca sin copiar: un galeón cualquiera y dos siluetas, sin logos ni caras.
//
// Cada carácter es un MATERIAL que la capa tiñe con la luz de la hora
// (`storyColors`): el casco y la jarcia, las velas, la roca y la hierba; las
// figuras son siluetas (K). El filo de luz del sol bajo o de la luna lo pone una
// capa aparte (`rimRows`), como en las crestas.

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
 * El cabo: una cumbre redondeada con hierba, la pared vertical hacia el mar (a la
 * derecha) con un saliente y un entrante, rocas al pie y la ladera hacia tierra.
 * 104 × 46 → 208 × 92 de mundo. La última fila es la del agua.
 *   o O q   roca, vetas más claras y grietas
 */
export const CLIFF_ROWS = Object.freeze([
    '........................................................................................................',
    '........................................................................................................',
    '................................................................................ooooooo.................',
    '.............................................................................oooooooooooooo.............',
    '..........................................................................oooooooooooooooooo............',
    '......................................................................oooooooooooooooooooooo............',
    '.................................................................oooooooooooooooooooqoooooo.............',
    '............................................................oooooooooooooooooooooooqooooooo.............',
    '..........................................................oooooooooooooooooooooooooqoooooo..............',
    '.......................................................ooooooooooooooooooooooooooooqoooooo..............',
    '.....................................................oooooooooooooooooooooooooooooooqoooooo.............',
    '...................................................ooooooooooooooooooooooooooooooooooqooooo.............',
    '..................................................ooooooooOOooooooooooooooooooooooooqoooooo.............',
    '................................................oOoOoOOooooooooooooooooooooooooooooqooooooo.............',
    '...............................................Oooooooooooooooooooooooooooooooooooooooooooo.............',
    '..............................................ooooooooooooooooooooooooooooooqooooooooooqqq..............',
    '.............................................ooooooooooooOoOOOOOOoooooooooooqooooooooooqqq..............',
    '............................................oooooooOOOoOOoooooooooooooooooooqooooooooooqqq..............',
    '..........................................ooooOOOOOoooooooooooooooooooooooooqooooooooooqqq..............',
    '.........................................oooooooooooooooooooooooooooooooooooqoooooooooqqq...............',
    '........................................oooooooooooooooooooooooooOoOOOOOooooqoooooooooqqq...............',
    '.......................................oooooooooooooooooooooOOOOOoqooooooooqooooooooooqqq...............',
    '......................................ooooooooOoOoOOOOOOOoOOooooooqooooooooooooooooooooqqq..............',
    '......................................oOOOOOOOoooooooooooooooooooooqoooooooooooooooooooqqq..............',
    '.....................................oOooooooooooooooooooooooooooooqooooooooooooooooooooooo.............',
    '....................................ooooooooooooooooooooooooooooooqoooooooooooooooooooooooo.............',
    '...................................oooooooOOooooooooooooooooooooooqoooooooooooooooooooooooo.............',
    '.................................oooOoOOoOooooooooooooooqoooooooooqoooooooooooooqoooooooooo.............',
    '................................OOOOooooooooooooooooooooqoooooooooqoooooooooooooqoooooooooo.............',
    '..............................ooooooooooooooooooooooooooqooooooooqooooooooooooooqoooooooooo.............',
    '.............................oooooooooooooOOOOOoooooooooqoooooooooooooooooooooooqoooooooooo.............',
    '.............................ooooooooooOOOooooooooooooooqoooooooooooooooooooooooqoooooooooo.............',
    '............................OOOOOOOOOOOoooooooooooooooooqoooooooooooooooooooooooqoooooooooo.............',
    '..........................oOoooooooooooooooooooOOOoOoooooooooooooooooooooooooooqooooooooooo.............',
    '........................oooooooooooooOooooooOOqoooooOoOOooooooooooooooqooooooooqooooooooqoo.............',
    '.......................oooooooOOOooOOoOOOOOOoqoooooooooooOOOoOOOooooooqooooooooooooooooqoooo............',
    '.....................ooooOOOOOoooooooooooooooqooooooOOOOooooooooooooooqooooooooooooooooqoooo............',
    '....................oooOOooooooooooooooooOOOoOqoooOOooooooooooooooooooqooooooooooooooooqooooo...........',
    '...................oooooooooooooooooooooooooooqOOOooooooooooooooooooooqooooooooooooooooqooooo...........',
    '..................ooooooooooooooooooooooooooooooooooooooooooooooooooooqooooooooooooooooqooooo...........',
    '................oooooooooooooooooooooooooooooooooooooooooOoOOOOooooooooooooooooooooooooqoooooo..........',
    '........oooooooooooooooooooooooooooooooooOOOOOOOOooOOOOOOoooooooooooooooooooooooooooooooooooooo.........',
    '......ooooooooooooooooooooooooooooooooOOOooooooooooooooooooooooooooooooooooooooooooooooooooooooo...o....',
    '....oooooooooooooooooooooooooooooooooOoooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo..',
    '..oooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooOoooooooooooooooooooooooooooooooo.o',
    'ooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooOOOOOooooooooooooooooooooooooooooooooooo',
]);

/** La hierba de la cima (G), aparte para teñirla con su propio color. */
export const CLIFF_GRASS_ROWS = Object.freeze([
    '...........................................................................................G............',
    '................................................................................G..GG......G............',
    '................................................................................GGGGGGGG..GG............',
    '..........................................................................G.GGGGGG.GG.GGGGGG............',
    '.........................................................................GGGGGGG........GGGG............',
    '............................................................G..G..G...GGGGG.G..............G............',
    '............................................................G.GG.GGGGGG.GG................G.............',
    '..........................................................G.GGGGGG......................................',
    '..........................................................GG.GGGG.......................................',
    '.....................................................G.GGGGG............................................',
    '...................................................G.GGGGG..............................................',
    '..................................................GGG...................................................',
    '...............................................GG.GGG...................................................',
    '...............................................GGGG.....................................................',
    '..............................................GGGG......................................................',
    '............................................G.GG........................................................',
    '.............................................GG.........................................................',
    '............................................GG..........................................................',
    '..........................................GGG...........................................................',
    '........................................GGGG............................................................',
    '........................................GG..............................................................',
    '.......................................GG...............................................................',
    '......................................GG................................................................',
    '........................................................................................................',
    '...................................G.G..................................................................',
    '....................................GG..................................................................',
    '.................................GGGG...................................................................',
    '...............................G.GGG....................................................................',
    '................................G.G.....................................................................',
    '..............................GGG.......................................................................',
    '.............................GG.........................................................................',
    '...........................GG...........................................................................',
    '............................G...........................................................................',
    '........................GGGG............................................................................',
    '.......................GGG.G............................................................................',
    '.....................GGGGG..............................................................................',
    '....................GGG.................................................................................',
    '....................GG..................................................................................',
    '..................GGG...................................................................................',
    '.................GGG....................................................................................',
    '................GGG.....................................................................................',
    '.................G......................................................................................',
    '........................................................................................................',
    '........................................................................................................',
    '........................................................................................................',
    '........................................................................................................',
]);

/** Fila de la línea del agua del cabo (la última). */
export const CLIFF_WATERLINE = 45;

/** El cabo está un poco más cerca que el horizonte: su pie, estas unidades por debajo. */
export const CLIFF_SINK = 8;

/**
 * Ella, mirando al mar con el viento que sube del agua (el pelo y la falda se van
 * hacia tierra) y el farol en la mano. Tres fotogramas del viento.
 */
export const WOMAN_ROWS = Object.freeze([
    Object.freeze([
        '....KKKK....',
        '...KKKKKK...',
        '..KKKKKKKK..',
        '.KKKKKKKK...',
        'KK.KKKKK....',
        'K....KKK....',
        '.....KKKK...',
        '....KKKKKK..',
        '....KKKKK.K.',
        '....KKKKK..K',
        '.....KKKK...',
        '.....KKKK...',
        '....KKKKK...',
        '...KKKKKK...',
        '..KKKKKKKK..',
        '.KKKKKKKKK..',
        'KKKKKKKKKK..',
        '.KKKKKKKKKK.',
        '..KKKKKKKKK.',
        '..KKKKKKKKKK',
        '...KKKKKKKKK',
        '...KKKKKKKKK',
    ]),
    Object.freeze([
        '....KKKK....',
        '...KKKKKK...',
        '.KKKKKKKKK..',
        'KKKKKKKKK...',
        'K...KKKK....',
        '.....KKK....',
        '.....KKKK...',
        '....KKKKKK..',
        '....KKKKK.K.',
        '....KKKKK..K',
        '.....KKKK...',
        '.....KKKK...',
        '....KKKKK...',
        '...KKKKKK...',
        '..KKKKKKK...',
        '.KKKKKKKKK..',
        '.KKKKKKKKKK.',
        'KKKKKKKKKKK.',
        '.KKKKKKKKKK.',
        '..KKKKKKKKKK',
        '...KKKKKKKKK',
        '...KKKKKKKKK',
    ]),
    Object.freeze([
        '....KKKK....',
        '...KKKKKK...',
        '..KKKKKKKK..',
        'KKKKKKKKK...',
        '...KKKKK....',
        '.....KKK....',
        '.....KKKK...',
        '....KKKKKK..',
        '....KKKKK.K.',
        '....KKKKK..K',
        '.....KKKK...',
        '.....KKKK...',
        '....KKKKK...',
        '...KKKKKKK..',
        '..KKKKKKKK..',
        'KKKKKKKKKK..',
        '.KKKKKKKKKK.',
        '..KKKKKKKKK.',
        '..KKKKKKKKKK',
        '..KKKKKKKKKK',
        '...KKKKKKKKK',
        '...KKKKKKKKK',
    ]),
]);

/** El hijo, a su lado desde "Diez años después". Dos fotogramas del viento. */
export const CHILD_ROWS = Object.freeze([
    Object.freeze([
        '...KKK..',
        '..KKKKK.',
        '.KKKKKK.',
        'K..KKK..',
        '..KKKK..',
        '.KKKKKK.',
        '.KKKKKK.',
        '.K.KK.K.',
        '...KK...',
        '..KKKK..',
        '..KK.K..',
        '..KK.K..',
        '..K..K..',
        '..K..K..',
        '.KK..KK.',
    ]),
    Object.freeze([
        '...KKK..',
        '..KKKKK.',
        'KKKKKKK.',
        '...KKK..',
        '..KKKK..',
        '.KKKKKK.',
        '.KKKKKK.',
        '.K.KK.K.',
        '...KK...',
        '..KKKK..',
        '..KK.K..',
        '..KK.K..',
        '..K..K..',
        '..K..K..',
        '.KK..KK.',
    ]),
]);

/**
 * Dónde está cada cosa sobre el cabo, en píxeles de su arte: la esquina de arriba
 * a la izquierda de cada figura (con los pies en la cumbre) y el farol, colgado de
 * la mano de ella.
 */
export const CLIFF_SPOTS = Object.freeze({
    woman: Object.freeze([76, -19]),
    child: Object.freeze([67, -8]),
    lamp: Object.freeze([87.5, -8.5]),
});

/**
 * La espuma al pie del cabo (tres filas: las dos últimas de la roca y el agua de
 * debajo). Rompe más contra las rocas de la pared y apenas a lo largo de la
 * ladera. El fotograma (0 o 1) mueve los huecos: las olas.
 *
 * @param {0 | 1} frame
 */
export function surfRows(frame) {
    const w = CLIFF_ROWS[0].length;
    const rows = [[], [], []];
    const hash = (i, s) => {
        let x = (i * 374761393 + s * 668265263) | 0;
        x = Math.imul(x ^ (x >>> 13), 1274126177);
        return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
    };
    for (let x = 0; x < w; x++) {
        const base = CLIFF_ROWS[CLIFF_WATERLINE][x] !== '.';
        const wall = x >= w - 20;
        const k = hash(x + frame * 7, 3);
        rows[0].push(wall && base && k < 0.35 ? 'Q' : '.');
        rows[1].push(base && (wall ? k < 0.7 : k < 0.12) ? 'Q' : '.');
        rows[2].push(base && (wall ? k < 0.85 : k < 0.45) ? 'Q' : '.');
    }
    return Object.freeze(rows.map((r) => r.join('')));
}

/** Resplandor de un farol, en blanco (se tiñe de luz cálida). */
export const LAMP_GLOW_ROWS = Object.freeze(['..QQ..', '.QQQQ.', 'QQQQQQ', 'QQQQQQ', '.QQQQ.', '..QQ..']);

/**
 * Los materiales a cada hora: de qué color salen de la luz del cielo.
 *   hullShade         El casco: lo lejano, oscurecido (madera en sombra).
 *   sailCanvas/Shade/Haze  Las velas: lona con la luz de las nubes (el mismo
 *                     blanco que el sol tiñe), en sombra y con la bruma de lo lejano.
 *   rockDay/grassDay  La roca y la hierba a pleno sol; con el sol bajo se funden
 *                     con lo cercano de la hora, que las vuelve silueta.
 * El guardián mide los colores que salen de aquí (backdrops.js).
 */
export const STORY_MATERIALS = Object.freeze({
    hullShade: 0.5,
    sailCanvas: '#f0d29e',
    sailShade: 0.42,
    sailHaze: 0.18,
    rockDay: '#4a3c34',
    rockDayMix: 0.5,
    grassDay: '#3e5a2c',
    grassDayMix: 0.75,
    /** Elevación del sol (grados) a la que la luz es ya de pleno día. */
    daylightElev: 10,
});

const SAIL_CANVAS = hexToRgb(STORY_MATERIALS.sailCanvas);
const ROCK_DAY = hexToRgb(STORY_MATERIALS.rockDay);
const GRASS_DAY = hexToRgb(STORY_MATERIALS.grassDay);

/** Contenedor reutilizable de los colores de la historia. */
export function createStoryColors() {
    return { hull: [0, 0, 0], sail: [0, 0, 0], rock: [0, 0, 0], grass: [0, 0, 0] };
}

/**
 * Colores de los materiales con el cielo de una hora.
 *
 * @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state
 * @param {ReturnType<typeof createStoryColors>} out
 */
export function storyColors(state, out) {
    const M = STORY_MATERIALS;
    const day = Math.max(0, Math.min(1, state.elev / M.daylightElev));
    const { far, near } = state.mountains;
    const cloud = state.clouds.body;
    for (let i = 0; i < 3; i++) {
        out.hull[i] = far[i] * M.hullShade;
        const canvas = cloud[i] * SAIL_CANVAS[i] * M.sailShade;
        out.sail[i] = canvas + (far[i] - canvas) * M.sailHaze;
        out.rock[i] = near[i] + (ROCK_DAY[i] - near[i]) * M.rockDayMix * day;
        out.grass[i] = near[i] + (GRASS_DAY[i] - near[i]) * M.grassDayMix * day;
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

/** Alto sobre la línea de su agua del cabo con ella encima, en unidades de mundo. */
export function cliffVisibleHeight() {
    return (CLIFF_WATERLINE - CLIFF_SPOTS.woman[1]) * STORY_CELL;
}
