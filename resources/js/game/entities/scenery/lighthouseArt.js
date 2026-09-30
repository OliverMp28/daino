// Arte del faro de la Costa (T02.2), aparte de Lighthouse.js para que el guardián
// de legibilidad (scenes/backdrops.js) sepa su tamaño sin Pixi.
//
// En grises, como el portal: la hora lo tiñe con el color de lo lejano (el de las
// islas), así que O es ese color (las franjas de la torre y el filo del cabo), o
// un poco más oscuro (la roca) y q lo oscuro (las franjas de entre medias, la
// linterna). La lámpara es un sprite aparte (se enciende al anochecer y gira).

/** Torre a rayas sobre un cabo de roca. Grid 22×28 → 88×112 de mundo. */
export const LIGHTHOUSE_ROWS = Object.freeze([
    '..........qq..........',
    '.........qqqq.........',
    '.........oqqo.........',
    '.........oqqo.........',
    '.........oooo.........',
    '........OOOOOO........',
    '.........OOOO.........',
    '.........OOOO.........',
    '.........OOOO.........',
    '.........qqqq.........',
    '.........qqqq.........',
    '.........qqqq.........',
    '........OOOOOO........',
    '........OOOOOO........',
    '........OOOOOO........',
    '........qqqqqq........',
    '........qqqqqq........',
    '........qqqqqq........',
    '........OOqqOO........',
    '........OOqqOO........',
    '.......OOooooooo......',
    '.....OOoooooooooo.....',
    '....Oooooooooooooo....',
    '..OOoooooooooooooooo..',
    '.Ooooooooooooooooooooo',
    'Oooooooooooooooooooooo',
    'oooooooooooooooooooooo',
    'oooooooooooooooooooooo',
]);

/** Filas del arte que quedan bajo la línea del mar (la roca entra en el agua). */
export const LIGHTHOUSE_SUNK_ROWS = 2;

/** Centro de la lámpara dentro del arte, en celdas (columna, fila). */
export const LIGHTHOUSE_LAMP_CELL = Object.freeze([11, 3]);

/** Alto que asoma sobre el mar, en celdas del arte. */
export function lighthouseVisibleRows() {
    return LIGHTHOUSE_ROWS.length - LIGHTHOUSE_SUNK_ROWS;
}
