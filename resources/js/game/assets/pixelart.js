// pixelart.js — arte del juego como código. Cada sprite es una rejilla de
// strings donde cada carácter mapea a un color de PALETTE ('.' = transparente).
// Un rasterizador los convierte en canvas 1px-por-celda y de ahí a Texture de
// Pixi con scaleMode 'nearest' — el escalado x4 lo hace la GPU y queda crujiente.
//
// Por qué así y no PNGs:
//   - Cero assets binarios en el repo; los sprites se revisan en diff como texto.
//   - Iterables con HMR: tocas una fila, guardas, y el sprite cambia en caliente.
//   - La paleta vive en UN sitio y está sincronizada con los tokens de main.css
//     y las constantes del shader (COLOR_BEAT/COLOR_HIGH).
//
// El ADN visual viene del legacy (../daino-legacy/img/): dino corredor con
// ciclo de 2 poses, cactus saguaro, suelo-tira con motas, nubes. Redibujado
// aquí en paleta "retro-pixel neón" para brillar sobre el shader oscuro
// (decisión del rediseño visual, Jul 2026). NO se copian los PNGs del legacy.

import { Texture } from 'pixi.js';

/** Factor de escala de celda→px en pantalla. 4 ⇒ un dino de 21 celdas = 84px. */
export const PIXEL_SCALE = 4;

// --------------------------- Paleta global ---------------------------
// Sincronía: BEAT/HIGH espejan COLOR_BEAT/COLOR_HIGH de background.frag.
const PALETTE = {
    // Dino
    W: '#f2f5ff', // cuerpo — blanco frío que destaca sobre el fondo oscuro
    w: '#b9c6ea', // panza/sombra — periwinkle suave
    K: '#0d0f1c', // ojo / detalles oscuros
    C: '#7fe6ff', // púas del lomo — cian (COLOR_HIGH)
    // Cactus
    G: '#3ddc84', // cuerpo cactus — verde neón (guiño al verde del legacy)
    g: '#1f9e58', // sombra cactus
    L: '#b6ffd9', // brillo/espina
    // Ptero
    P: '#ff5d7e', // cuerpo ptero — rosa beat (COLOR_BEAT): peligro aéreo
    p: '#c73a5c', // sombra ptero
    // Suelo
    E: '#8b9aff', // línea de borde superior — periwinkle brillante
    D: '#12152e', // relleno tierra
    s: '#333b66', // motas
    // Nube
    c: '#262c4e', // silueta nube
    l: '#39416e', // luz superior nube
};

// --------------------------- Sprites ---------------------------
// Convención: el dino mira a la DERECHA (el mundo scrollea hacia la izquierda).
// Grids del dino de pie: 21×21 celdas → 84×84 px (= DINO_SIZE actual).

const DINO_HEAD = [
    '...........WWWWWWWWW.',
    '...........WWKKWWWWW.',
    '...........WWWWWWWWW.',
    '...........WWWWWWWWW.',
    '...........WWWWwwwww.',
    '...........WWWW......',
    '..........CWWWW......',
    '..........CWWWWW.....',
    '.WWW.....WWWWWWWW....',
    '.CWWWW..WWWWWWWWWW...',
    '..CWWWWWWWWWWWWWW....',
    '..WWWWWWWWWWWWWw.....',
    '...WWWWWWWWWWWWw.....',
    '....WWWWWWWWWWww.....',
    '.....WWWWWWWWWw......',
    '......WWWWWWWW.......',
    '.......WWWWWWW.......',
];

const dinoRunA = [
    ...DINO_HEAD,
    '........WW..WW.......',
    '........W...WW.......',
    '............WW.......',
    '............WWW......',
];

const dinoRunB = [
    ...DINO_HEAD,
    '........WW..WW.......',
    '........WW...W.......',
    '........WW...........',
    '........WWW..........',
];

const dinoJump = [
    ...DINO_HEAD,
    '........WW..WW.......',
    '........W....W.......',
    '.....................',
    '.....................',
];

// Muerto: ojo en X (hueco) y las dos patas plantadas.
const dinoDead = [
    '...........WWWWWWWWW.',
    '...........WKKKWWWWW.',
    '...........WKWKWWWWW.',
    '...........WKKKWWWWW.',
    '...........WWWWwwwww.',
    ...DINO_HEAD.slice(5),
    '........WW..WW.......',
    '........WW..WW.......',
    '........WW..WW.......',
    '........WWW.WWW......',
];

// Agachado: cuerpo alargado y bajo. Grid 26×12 → 104×48 px.
const DINO_DUCK_BODY = [
    '..................WWWWWWW.',
    '.................WWKKWWWWW',
    '...CC.....WWWWWWWWWWWWWWWW',
    '.WWWWWWWWWWWWWWWWWWWWWWWW.',
    'WWWWWWWWWWWWWWWWWWWWwwwww.',
    '.WWWWWWWWWWWWWWWWWWWwww...',
    '..WWWWWWWWWWWWWWWWWW......',
    '....WWWWWWWWWWWWWW........',
];

const dinoDuckA = [
    ...DINO_DUCK_BODY,
    '......WWW....WWW..........',
    '......WW.....WW...........',
    '......WW.....WW...........',
    '......WWW....WWW..........',
];

const dinoDuckB = [
    ...DINO_DUCK_BODY,
    '......WWW....WWW..........',
    '......WW.....WW...........',
    '......W......WW...........',
    '.............WWW..........',
];

// Cactus saguaro. Grid 12×24 → 48×96 px.
const cactusSmall = [
    '....GGGG....',
    '....GLGG....',
    '....GGGG....',
    'G...GGGG...G',
    'G...GGGG...G',
    'GG..GGGG..GG',
    'GG..GGGG..GG',
    'GG..GLGG..GG',
    'GGG.GGGG.GGG',
    '.GGGGGGGGGG.',
    'GGGGGGGGGGGG',
    '....GGGg....',
    '....GGGg....',
    '....GLGg....',
    '....GGGg....',
    '....GGGg....',
    '....GGGg....',
    '....GLGg....',
    '....GGGg....',
    '....GGGg....',
    '....GGGg....',
    '....GGGg....',
    '....GGGg....',
    '...gGGGGg...',
];

// Cluster de 3 cactus. Grid 25×17 → 100×68 px.
const cactusWide = [
    '...........GGG...........',
    '..........GGGGG..........',
    '..........GLGGG..........',
    '..........GGGGG..........',
    '..........GGGGG..........',
    '...GGG....GGGGG..........',
    '..GGGGG...GGGGG..........',
    '..GGGGG...GGGGG...GGG....',
    '..GGGGG...GGGGG..GGGGG...',
    '..GLGGg...GGGGg..GGGGg...',
    '..GGGGg...GGGGg..GGGGg...',
    '..GGGGg...GGGGg..GGGGg...',
    '..GGGGg...GGGGg..GLGGg...',
    '..GGGGg...GGGGg..GGGGg...',
    '..GGGGg...GGGGg..GGGGg...',
    '..GGGGg...GGGGg..GGGGg...',
    '.gGGGGg..gGGGGGg.gGGGGg..',
];

// Pterodáctilo — mira a la IZQUIERDA (vuela hacia el jugador).
// Grid 24×14 → 96×56 px. Dos frames de aleteo.
const PTERO_BODY = [
    'WW.....PPPPPPPPP........',
    'WWWKPPPPPPPPPPPPPPP.....',
    '.WWPPPPPPPPPPPPPPPPPP...',
    '....PPPPPPPPPPPPPP......',
    '......PPPPPPPPPP........',
];

const pteroA = [
    '..........PP............',
    '.........PPPP...........',
    '.........PPPP...........',
    '..........PPPP..........',
    '..........PPPPP.........',
    ...PTERO_BODY,
    '........pppp............',
    '........................',
    '........................',
    '........................',
];

const pteroB = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    ...PTERO_BODY,
    '..........PPPP..........',
    '..........PPPP..........',
    '...........PPPP.........',
    '............PP..........',
];

// Tira de suelo, tileable horizontal. Grid 32×12 → 128×48 px.
// Fila 0: bumps sueltos sobre la línea. Fila 1: la línea de horizonte.
const ground = [
    '....EE................EEE.......',
    'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'DDsDDDDDDDDsDDDDDDDDDsDDDDDDDsDD',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'DDDDDDsDDDDDDDDDDCsDDDDDDDDDDDsD',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'DsDDDDDDDDDDDsDDDDDDDDDDDsDDDDDD',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'DDDDDDDDDsDDDDDDDDDDDDDDDDDDDDDs',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
];

// Nube silueta. Grid 20×8 → 80×32 px.
const cloud = [
    '......llll..........',
    '.....llllll....l....',
    '..lllcccccll..lll...',
    '.ccccccccccccccccc..',
    'cccccccccccccccccc..',
    'cccccccccccccccccccc',
    '.cccccccccccccccccc.',
    '..cccc...cccccc.....',
];

// Punto 2×2 blanco — textura compartida de partículas (se tinta por instancia).
const dot = [
    'WW',
    'WW',
];

const DEFS = {
    dinoRunA, dinoRunB, dinoJump, dinoDead, dinoDuckA, dinoDuckB,
    cactusSmall, cactusWide,
    pteroA, pteroB,
    ground, cloud, dot,
};

// --------------------------- Rasterizador ---------------------------

/** @type {Map<string, Texture>} */
const cache = new Map();

/**
 * Rasteriza una def de sprite a canvas 1px-por-celda. Las filas se normalizan
 * al ancho máximo (pad con transparente) — así un pixel de más o de menos al
 * editar el arte a mano no rompe el render, solo se nota y se corrige.
 */
function rasterize(rows) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    for (let y = 0; y < h; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
            const ch = row[x];
            if (ch === '.' || ch === ' ') continue;
            const color = PALETTE[ch];
            if (!color) continue; // carácter desconocido = transparente
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    return canvas;
}

/**
 * Devuelve la Texture de un sprite por nombre, rasterizando y cacheando la
 * primera vez. scaleMode 'nearest' — el x4 en pantalla lo hace el sprite via
 * scale, y la GPU no interpola (pixel art crujiente).
 *
 * @param {keyof typeof DEFS} name
 * @returns {Texture}
 */
export function getTexture(name) {
    let tex = cache.get(name);
    if (tex) return tex;

    const def = DEFS[name];
    if (!def) throw new Error(`pixelart: sprite desconocido "${name}"`);

    tex = Texture.from(rasterize(def));
    tex.source.scaleMode = 'nearest';
    cache.set(name, tex);
    return tex;
}

/** Tamaño en px de pantalla de un sprite (celdas × PIXEL_SCALE). */
export function spriteSize(name) {
    const def = DEFS[name];
    if (!def) throw new Error(`pixelart: sprite desconocido "${name}"`);
    const w = Math.max(...def.map((r) => r.length));
    return { w: w * PIXEL_SCALE, h: def.length * PIXEL_SCALE };
}
