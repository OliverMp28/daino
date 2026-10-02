// sprites.js — los dibujos del juego, como datos puros. Cada sprite es una
// rejilla de strings donde cada carácter es un color de PALETTE ('.' = transparente).
//
// Sin Pixi ni DOM: lo rasteriza pixelart.js y lo leen también las pruebas, que
// comparan la silueta de cada dibujo con su caja de colisión (tests/js/hitboxes.test.mjs:
// nadie debe morir sin que se vea el choque).

import { CACTUS_ROW_CELLS, CORRIDOR_HEIGHT_PX, GATE, PINCH, PIXEL_SCALE } from '../config.js';

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

// Muerto en el aire: el mismo ojo, con las patas recogidas del salto (la imagen
// congelada del choque no debe estirarle las patas hacia lo que tenía debajo).
const dinoJumpDead = [...dinoDead.slice(0, 17), ...dinoJump.slice(17)];

/**
 * Capa de 21×21 (la rejilla del dino de pie) con dibujo solo en las filas dadas:
 * se pinta ENCIMA del dino con el mismo ancla, así que no hay desfases que cuadrar.
 * @param {Record<number, string>} rows  fila → 21 caracteres
 */
function dinoOverlay(rows) {
    return Array.from({ length: 21 }, (_, y) => rows[y] ?? '.....................');
}

// Mochila propulsora (modo vuelo): a la espalda, con la correa cruzando el pecho
// y la tobera inclinada hacia atrás y abajo, para que la llama salga por detrás del
// cuerpo (debajo de la mochila está el lomo). Sin ella el Dino "subía y caía" sin
// que nada lo explicara.
const jetpack = dinoOverlay({
    3: '......MMM............',
    4: '.....MmmmM...........',
    5: '.....MmFmM...........',
    6: '.....MmFmM...........',
    7: '.....MmmmM...........',
    8: '.....MmFmMmmmmmm.....',
    9: '.....MmmmM...........',
    10: '......MMM............',
    11: '.....kk..............',
});

// Llama de la tobera, en diagonal hacia atrás: dos frames mientras se mantiene
// (parpadea) y una brasa sin empuje.
const jetFlameA = dinoOverlay({
    12: '....QF...............',
    13: '...FR................',
    14: '..Rr.................',
    15: '..r..................',
});
const jetFlameB = dinoOverlay({
    12: '....QQ...............',
    13: '...FQF...............',
    14: '..RFR................',
    15: '.Rr..................',
    16: '.r...................',
});
const jetFlameIdle = dinoOverlay({
    12: '....r................',
});

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

// Muerto agachado: el mismo ojo en X. La imagen que se queda congelada al chocar
// tiene que ser la postura con la que se chocó (de pie parecería otro choque).
const dinoDuckDead = [
    '..................WKKKWWW.',
    '.................WWKWKWWWW',
    '...CC.....WWWWWWWWWKKKWWWW',
    ...DINO_DUCK_BODY.slice(3),
    ...dinoDuckA.slice(8),
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

/** El saguaro con los brazos más abajo: una hilera no parece un sello repetido. */
const cactusSmallLow = [
    ...cactusSmall.slice(0, 3),
    '....GGGG....',
    '....GGGG....',
    '....GLGG....',
    ...cactusSmall.slice(3, 11),
    ...cactusSmall.slice(14),
];

/**
 * Hilera de saguaros que se tocan (config.js, CACTUS_ROW_*), de `width` celdas:
 * los justos para no separarse más de 10 celdas, repartidos por igual y
 * alternando la altura de los brazos. Se genera: trece hileras escritas a mano
 * serían ilegibles en un diff.
 *
 * @param {number} width  Celdas de largo (≥ 22).
 */
function cactusRow(width) {
    const n = Math.max(2, Math.ceil((width - 12) / 10) + 1);
    const rows = Array.from({ length: 24 }, () => Array(width).fill('.'));
    for (let k = 0; k < n; k++) {
        const x0 = Math.round((k * (width - 12)) / (n - 1));
        const sprite = k % 2 === 0 ? cactusSmall : cactusSmallLow;
        for (let y = 0; y < 24; y++) {
            for (let x = 0; x < 12; x++) {
                if (sprite[y][x] !== '.') rows[y][x0 + x] = sprite[y][x];
            }
        }
    }
    return rows.map((r) => r.join(''));
}

const cactusRows = {};
for (const cells of CACTUS_ROW_CELLS) cactusRows[`cactusRow${cells}`] = cactusRow(cells);

// --------------------------- Paso de medusa (charter 15) ---------------------------

// Medusa: campana y cuatro tentáculos que ondulan. Grid 14×34 → 56×136 px. En el
// rosa del peligro (algo más claro que el del ptero: palette.js). Flota con las puntas a la altura de la
// cabeza del Dino: se pasa por debajo corriendo, no saltando.
const JELLY_BELL = [
    '....ZZZZZZ....',
    '..ZZZZZZZZZZ..',
    '.ZZHHZZZZZZZZ.',
    'ZZHHZZZZZZZZZZ',
    'ZZHZZZZZZZZZZZ',
    'ZZZZZZZZZZZZZZ',
    'ZZZZZZZZZZZZZz',
    'zZZZzZZZZzZZZz',
    '.zZz.zZZz.zZz.',
];

/** @param {0 | 1} phase  Los dos fotogramas: los tentáculos ondulan a contrapié. */
function jelly(phase) {
    const f = GATE.floater;
    const rows = JELLY_BELL.slice();
    const lengthOf = (strand) => f.hCells - JELLY_BELL.length - (strand % 2 === 0 ? 0 : 2);
    for (let y = 0; y < f.hCells - JELLY_BELL.length; y++) {
        const cells = Array(f.wCells).fill('.');
        [2, 5, 8, 11].forEach((base, strand) => {
            const len = lengthOf(strand);
            if (y >= len) return;
            // Ondas largas (tres celdas rectas por tramo): a la velocidad del juego un
            // zigzag de celda en celda se ve como una línea de puntos.
            const wave = [0, 0, 0, 1, 1, 1, 0, 0, 0, -1, -1, -1][(y + phase * 6 + strand * 3) % 12];
            cells[base + wave] = y >= len - 2 ? 'H' : (y % 6 === 5 ? 'z' : 'Z');
        });
        rows.push(cells.join(''));
    }
    return rows;
}

const jellyA = jelly(0);
const jellyB = jelly(1);

/**
 * El paso entero en una rejilla del tamaño de su caja (config.js, `gates`): la
 * medusa arriba a la izquierda, el hueco y el saguaro abajo a la derecha.
 */
function gateRows(gapCells, jellyRows) {
    const f = GATE.floater;
    const x0 = GATE.leftPadCells;
    const cactusX = x0 + f.wCells + gapCells;
    const rows = Array.from({ length: f.altitudeCells + f.hCells }, () => Array(cactusX + 12).fill('.'));
    jellyRows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] !== '.') rows[y][x0 + x] = row[x];
    });
    cactusSmall.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] !== '.') rows[rows.length - cactusSmall.length + y][cactusX + x] = row[x];
    });
    return rows.map((r) => r.join(''));
}

/** Dibujos que se generan la primera vez que se piden (los pasos: 84 rejillas grandes). */
const lazySprites = {};
for (const cells of GATE.gapCells) {
    lazySprites[`gate${cells}A`] = () => gateRows(cells, jellyA);
    lazySprites[`gate${cells}B`] = () => gateRows(cells, jellyB);
}

// Cluster de 3 cactus. Grid 25×17 → 100×68 px. Los tres llegan casi al alto de
// la caja y la llenan de lado a lado: lo que choca es lo que se ve. (Hasta Oct
// 2026 los de los lados medían 48 y 40 con la caja a 62: caer justo detrás del
// pequeño era chocar con 20 unidades de aire.)
const cactusWide = [
    '...........GGG...........',
    '..........GGGGG....GGG...',
    '...GGG....GLGGG...GGGGG..',
    '..GGGGG...GGGGG...GGGGG..',
    '..GGGGG...GGGGG...GGLGG..',
    '..GLGGG...GGGGG...GGGGG..',
    '..GGGGG...GGGGG...GGGGG..',
    '..GGGGG...GGGGG...GGGGG..',
    '..GGGGG...GGGGG...GGGGG..',
    '..GGGGg...GGGGg...GGGGg..',
    '..GGGGg...GGGGg...GGGGg..',
    '..GLGGg...GGGGg...GGGGg..',
    '..GGGGg...GGGGg...GLGGg..',
    '..GGGGg...GGGGg...GGGGg..',
    '..GGGGg...GGGGg...GGGGg..',
    '..GGGGg...GGGGg...GGGGg..',
    '.gGGGGg..gGGGGGg..gGGGGg.',
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

// Arena de la Costa (T02.2): la misma tira, con la línea de la orilla y conchas.
// Fila 0: montoncitos de arena sobre la línea; fila 1: la orilla.
const groundSand = [
    '.....AA.............AAA.........',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aabaaaaaaaaaaaaaaabaaaaaaaaaaaaa',
    'aaaaaaaaabaaaaaaaaaaaaaaaaabaaaa',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'aaaaabaaaaaaaaaaaaaaaabaaaaaaaaa',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaba',
    'aaaaaaaaaaaaabaaaaaaaaaaaaaaaaaa',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'abaaaaaaaaaaaaaaaaaaaaabaaaaaaaa',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
];

// Suelo nevado (T02.3): montoncitos de nieve sobre la línea y escarcha debajo.
const groundSnow = [
    '...SSS..........SS.......SSSS...',
    'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
    'SJSSjjSSjjjjSSjjjjjjSSjjjjSSSjjj',
    'jjjJjjjjjjjjjjjjJjjjjjjjjjjjjjjj',
    'jjjjjjjjjJjjjjjjjjjjjjjjjjJjjjjj',
    'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj',
    'jjjjjJjjjjjjjjjjjjjjjjJjjjjjjjjj',
    'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjJj',
    'jjjjjjjjjjjjjJjjjjjjjjjjjjjjjjjj',
    'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj',
    'jJjjjjjjjjjjjjjjjjjjjjjJjjjjjjjj',
    'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj',
];

// Calle de la ciudad (T02.4): el bordillo en la línea, asfalto con marcas.
const groundCity = [
    '................................',
    'cccccccccccccccccccccccccccccccc',
    'dddddddddddddddddddddddddddddddd',
    'ddddeddddddddddddddeddddddddddde',
    'dddddddddddddddddddddddddddddddd',
    'dddeeeeeedddddddddddeeeeeedddddd',
    'dddddddddddddddddddddddddddddddd',
    'ddddddddeddddddddddddddddddedddd',
    'dddddddddddddddddddddddddddddddd',
    'dddddddddddddddeddddddddddddddde',
    'dddddddddddddddddddddddddddddddd',
    'dddddddddddddddddddddddddddddddd',
];

// Nubes (T01): en claros, porque la hora del cielo las tiñe. Cuerpo
// blanco con la sombra abajo; el color lo pone `Sprite.tint` (entities/scenery/
// Clouds.js). Grid 20×8 → 80×32 y 28×10 → 112×40.
const cloud = [
    '......nnnn..........',
    '.....nnnnnn....n....',
    '..nnnnnnnnnn..nnn...',
    '.nnnnnnnnnnnnnnnnn..',
    'nnnnnnnnnnnnnnnnnn..',
    'nnnnnnnnnnnnnnnnnnnn',
    '.NNNnnnnnnnnnnnnNNN.',
    '..NNNN...NNNNNN.....',
];

const cloudB = [
    '..........nnnnn.............',
    '.......nnnnnnnnnn...nnnn....',
    '....nnnnnnnnnnnnnnnnnnnnnn..',
    '..nnnnnnnnnnnnnnnnnnnnnnnnn.',
    '.nnnnnnnnnnnnnnnnnnnnnnnnnnn',
    'nnnnnnnnnnnnnnnnnnnnnnnnnnnn',
    'nnnnnnnnnnnnnnnnnnnnnnnnnnnn',
    '.NNnnnnnnnnnnnnnnnnnnnnnnNN.',
    '..NNNNNnnnnnnnnnnnnnNNNNN...',
    '.....NNNNNNNN..NNNNNNN......',
];

/**
 * Filo de luz de un sprite: las celdas opacas cuya vecina de arriba (o de abajo)
 * está vacía, en blanco. Se dibuja encima del cuerpo con el color y la fuerza de
 * la luz de cada hora: el sol alto ilumina el borde de arriba; el sol bajo del
 * atardecer, el de abajo; la luna, el de arriba en plata.
 *
 * @param {string[]} rows
 * @param {'top' | 'bottom'} side
 */
function edgeRows(rows, side) {
    const dy = side === 'top' ? -1 : 1;
    const empty = (x, y) => y < 0 || y >= rows.length || rows[y][x] === undefined || rows[y][x] === '.';
    return rows.map((row, y) => [...row].map((ch, x) => (ch !== '.' && empty(x, y + dy) ? 'Q' : '.')).join(''));
}

const cloudRimTop = edgeRows(cloud, 'top');
const cloudRimBottom = edgeRows(cloud, 'bottom');
const cloudBRimTop = edgeRows(cloudB, 'top');
const cloudBRimBottom = edgeRows(cloudB, 'bottom');

// Punto 2×2 blanco — textura compartida de partículas (se tinta por instancia).
const dot = [
    'WW',
    'WW',
];

// --------------------------- Antigravedad (Ola 6a) ---------------------------

// Grupo de cristales de neón, apoyado en su base. Grid 13×16 → 52×64 px. El del
// techo es el mismo sprite reflejado (Obstacle.js): otra forma, otras reglas.
const crystal = [
    '......Y......',
    '.....YV......',
    '.....VVv.....',
    '....YVVv.....',
    '....VVVv..Y..',
    '....VVVv.YVv.',
    '.Y..VVVv.VVv.',
    'YV..VVVv.VVv.',
    'VVv.VVVVvVVv.',
    'VVvYVVVVvVVv.',
    'VVvVVVVVvVVVv',
    'VVVVVVVVVVVVv',
    '.VVVVVVVVVVv.',
    '.vVVVVVVVVVv.',
    '..vvVVVVVvv..',
    '...vvvvvvv...',
];

// Cristal afilado (acento de la antigravedad, config.js `sharpCrystals`): el mismo
// grupo en el rosa del ptero, para que se lea como peligro.
const crystalSharp = crystal.map((row) => row.replaceAll('V', 'P').replaceAll('v', 'p').replaceAll('Y', 'H'));

/**
 * Pinza (config.js, `pinches`): el pasillo entero, con el cristal de guarda
 * colgando arriba a la izquierda y el del golpe apoyado abajo a la derecha.
 */
function pinchRows(sepCells) {
    const H = CORRIDOR_HEIGHT_PX / PIXEL_SCALE;
    const guardX = PINCH.padCells;
    const targetX = guardX + 13 + sepCells;
    const rows = Array.from({ length: H }, () => Array(Math.max(guardX, targetX) + 13).fill('.'));
    crystalSharp.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] === '.') continue;
            rows[crystalSharp.length - 1 - y][guardX + x] = row[x];
            rows[H - crystalSharp.length + y][targetX + x] = row[x];
        }
    });
    return rows.map((r) => r.join(''));
}
for (const cells of PINCH.sepCells) lazySprites[`pinch${cells + 9}`] = () => pinchRows(cells);

// Franja del techo: la tira del suelo reflejada, con su línea en el violeta del
// modo. La fila 10 es la línea; la 11, los bultos que cuelgan hacia el pasillo.
const ceiling = ground.slice().reverse().map((row) => row.replaceAll('E', 'U'));
// El del vuelo, igual con la línea en oro.
const ceilingFly = ground.slice().reverse().map((row) => row.replaceAll('E', 'F'));

/**
 * Portal: un óvalo alto de doble aro con destellos dentro, en grises (se tiñe
 * con el color del modo). Se genera en vez de dibujarse a mano: 81 filas de
 * elipse escritas a mano serían ilegibles en un diff y cualquier retoque de
 * tamaño obligaría a redibujarlo.
 *
 * @param {number} w  Celdas de ancho.
 * @param {number} h  Celdas de alto.
 * @param {number} phase  0/1: los destellos interiores alternan entre dos frames.
 */
function portalRows(w, h, phase) {
    const rows = [];
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
            const dx = (x + 0.5 - cx) / (w / 2);
            const dy = (y + 0.5 - cy) / (h / 2);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 1) row += '.';
            else if (d > 0.86) row += 'O';
            else if (d > 0.72) row += 'o';
            else row += (x + y * 3 + phase * 2) % 7 === 0 && (y + phase) % 4 === 0 ? 'q' : '.';
        }
        rows.push(row);
    }
    return rows;
}

// Alto: del suelo a un poco por encima del techo del pasillo (CORRIDOR_HEIGHT_PX).
const portalA = portalRows(14, 82, 0);
const portalB = portalRows(14, 82, 1);

/**
 * Orbe de doble salto (Ola 6c, config.js `RING_JUMP`). La primera versión era un
 * aro alto y hueco: la misma forma que un portal de modo, y en el playtest se leyó
 * como uno ("no lo entendí hasta leer que era para saltar doble"). Ahora es un
 * orbe MACIZO (los portales son huecos) con un doble chevrón encima que sube entre
 * frames: "otro salto hacia arriba". `lit`: el Dino está a su alcance en el aire y
 * pulsar lo activaría (se pinta en claro, ver Obstacle.setArmed).
 * Grid 12×26 → 48×104 de mundo (la caja del kind): chevrones arriba, orbe de 12
 * celdas centrado en la caja, aire debajo.
 *
 * @param {0 | 1} frame  Qué chevrón va encendido (0 el de abajo, 1 el de arriba).
 * @param {boolean} [lit]
 */
function orbRows(frame, lit = false) {
    const W = 12;
    const H = 26;
    const rows = Array.from({ length: H }, () => Array(W).fill('.'));
    // Doble chevrón: trazo doble de 3 filas, uno en las filas 0-2 y otro en las 3-5.
    const chevron = (top, on) => {
        const c = lit ? 'Q' : on ? 'R' : 'r';
        for (const [dy, xs] of [[0, [5, 6]], [1, [3, 4, 7, 8]], [2, [1, 2, 9, 10]]]) {
            for (const x of xs) rows[top + dy][x] = c;
        }
    };
    chevron(0, frame === 1);
    chevron(3, frame === 0);
    // Orbe de 12 celdas en las filas 7-18: borde claro, cuerpo, brillo arriba a la izquierda.
    const top = 7;
    for (let y = 0; y < 12; y++) {
        for (let x = 0; x < W; x++) {
            const dx = (x + 0.5 - 6) / 6;
            const dy = (y + 0.5 - 6) / 6;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 1) continue;
            const shine = Math.hypot(dx + 0.35, dy + 0.35) < 0.26;
            rows[top + y][x] = shine || (lit && d < 0.55) ? 'Q' : d > 0.74 || lit ? 'R' : 'r';
        }
    }
    return rows.map((r) => r.join(''));
}

const orbA = orbRows(0);
const orbB = orbRows(1);
const orbLit = orbRows(0, true);

// Flechas del portal (se tiñen): hacia arriba y hacia abajo. Grid 9×5 → 36×20 px.
const chevronUp = [
    '....O....',
    '...OOO...',
    '..OOoOO..',
    '.OOo.oOO.',
    'OOo...oOO',
];
const chevronDown = chevronUp.slice().reverse();

/**
 * Todos los dibujos por nombre. `getTexture` (pixelart.js) los rasteriza; las
 * pruebas de colisión los leen tal cual para comparar lo que se ve con lo que choca.
 */
export const SPRITES = Object.freeze(withLazy({
    dinoRunA, dinoRunB, dinoJump, dinoDead, dinoJumpDead, dinoDuckA, dinoDuckB, dinoDuckDead,
    jetpack, jetFlameA, jetFlameB, jetFlameIdle,
    cactusSmall, cactusWide, ...cactusRows,
    pteroA, pteroB, jellyA, jellyB,
    ground, groundSand, groundSnow, groundCity, dot,
    cloud, cloudB, cloudRimTop, cloudRimBottom, cloudBRimTop, cloudBRimBottom,
    crystal, crystalSharp, ceiling, ceilingFly, portalA, portalB, chevronUp, chevronDown,
    orbA, orbB, orbLit,
}, lazySprites));

/** Añade a `sprites` los dibujos perezosos: cada uno se genera al leerlo por primera vez. */
function withLazy(sprites, lazy) {
    for (const [name, make] of Object.entries(lazy)) {
        let rows = null;
        Object.defineProperty(sprites, name, { enumerable: true, get: () => (rows ??= make()) });
    }
    return sprites;
}
