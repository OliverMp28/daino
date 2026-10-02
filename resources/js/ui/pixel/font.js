// La letra de la interfaz, como código (T04, doc 12).
//
// La interfaz está hecha de lo mismo que el juego: celdas. Lo que DICE EL JUEGO
// (rótulos, botones, números, el marcador) va en esta letra de 6×7 celdas y astas de dos, dibujada
// aquí como los sprites de assets/sprites.js: rejillas de texto que se revisan en
// un diff y no pesan un archivo binario. Lo que es CONTENIDO (el título de una
// canción, un nombre de usuario, una explicación) va en la letra del sistema: puede
// traer cualquier carácter y se lee mejor en frases largas.
//
// Solo mayúsculas: `textPath` pasa el texto a mayúsculas. Un texto con un carácter
// que no está dibujado no se pinta a medias: `supportsText` lo dice y quien lo usa
// cae a la letra del sistema (pixel/text.js).
//
// Puro (sin DOM): lo pinta pixel/text.js como un <svg> de un solo trazo y lo
// prueban los tests.

/** Alto de una mayúscula y separaciones, en celdas. */
export const FONT = Object.freeze({
    capHeight: 7,
    /** Hueco entre dos letras. */
    gap: 1,
    /** Ancho del espacio entre palabras. */
    space: 3,
    /** Filas que una tilde ocupa por encima de la mayúscula (con una de aire). */
    ascent: 3,
    /** Filas que la coma baja de la línea. */
    descent: 1,
});

// Cada bloque: el carácter (y, si no empieza arriba, la fila en la que empieza) y
// sus filas. `#` = celda encendida.
const RAW = `
A
.####.
##..##
##..##
######
##..##
##..##
##..##

B
#####.
##..##
##..##
#####.
##..##
##..##
#####.

C
.####.
##..##
##....
##....
##....
##..##
.####.

D
####..
##.##.
##..##
##..##
##..##
##.##.
####..

E
######
##....
##....
#####.
##....
##....
######

F
######
##....
##....
#####.
##....
##....
##....

G
.####.
##..##
##....
##.###
##..##
##..##
.####.

H
##..##
##..##
##..##
######
##..##
##..##
##..##

I
####
.##.
.##.
.##.
.##.
.##.
####

J
....##
....##
....##
....##
##..##
##..##
.####.

K
##..##
##.##.
####..
###...
####..
##.##.
##..##

L
##....
##....
##....
##....
##....
##....
######

M
##...##
###.###
#######
##.#.##
##...##
##...##
##...##

N
##..##
###.##
###.##
######
##.###
##.###
##..##

O
.####.
##..##
##..##
##..##
##..##
##..##
.####.

P
#####.
##..##
##..##
#####.
##....
##....
##....

Q
.####.
##..##
##..##
##..##
##.#.#
##..#.
.###.#

R
#####.
##..##
##..##
#####.
####..
##.##.
##..##

S
.#####
##....
##....
.####.
....##
....##
#####.

T
######
..##..
..##..
..##..
..##..
..##..
..##..

U
##..##
##..##
##..##
##..##
##..##
##..##
.####.

V
##..##
##..##
##..##
##..##
##..##
.####.
..##..

W
##...##
##...##
##...##
##.#.##
#######
###.###
##...##

X
##..##
##..##
.####.
..##..
.####.
##..##
##..##

Y
##..##
##..##
.####.
..##..
..##..
..##..
..##..

Z
######
....##
...##.
..##..
.##...
##....
######

0
.####.
##..##
##..##
##..##
##..##
##..##
.####.

1
..##..
.###..
..##..
..##..
..##..
..##..
######

2
.####.
##..##
....##
..###.
.##...
##....
######

3
.####.
##..##
....##
..###.
....##
##..##
.####.

4
...###
..####
.##.##
##..##
######
....##
....##

5
######
##....
#####.
....##
....##
##..##
.####.

6
.####.
##....
##....
#####.
##..##
##..##
.####.

7
######
....##
...##.
..##..
..##..
..##..
..##..

8
.####.
##..##
##..##
.####.
##..##
##..##
.####.

9
.####.
##..##
##..##
.#####
....##
....##
.####.

. 5
##
##

, 5
##
##
.#

: 1
##
##
..
..
##
##

; 1
##
##
..
..
##
##
.#

!
##
##
##
##
##
..
##

¡
##
..
##
##
##
##
##

?
.####.
##..##
....##
...##.
..##..
......
..##..

¿
..##..
......
..##..
.##...
##....
##..##
.####.

%
##...#
##..##
...##.
..##..
.##...
##..##
#...##

/
....##
...##.
...##.
..##..
.##...
.##...
##....

· 2
##
##

+ 1
..##..
..##..
######
..##..
..##..

- 3
####

– 3
#####

— 3
######

_ 6
######

= 2
#####
.....
#####

(
.##
##.
##.
##.
##.
##.
.##

)
##.
.##
.##
.##
.##
.##
##.

'
##
##
#.

"
##.##
##.##
#..#.

« 1
..##.##
.##.##.
##.##..
.##.##.
..##.##

» 1
##.##..
.##.##.
..##.##
.##.##.
##.##..

< 1
..##
.##.
##..
.##.
..##

> 1
##..
.##.
..##
.##.
##..

#
.#..#.
######
.#..#.
.#..#.
######
.#..#.

±
..##..
..##..
######
..##..
..##..
......
######

× 1
##..##
.####.
..##..
.####.
##..##

… 5
##.##.##
##.##.##

★
...#...
...#...
#######
.#####.
..###..
.##.##.
.#...#.

▶
##....
###...
####..
#####.
####..
###...
##....

◀
....##
...###
..####
.#####
..####
...###
....##

▲ 1
...#...
..###..
.#####.
#######

▼ 2
#######
.#####.
..###..
...#...

↑
..##..
.####.
######
..##..
..##..
..##..
..##..

↓
..##..
..##..
..##..
..##..
######
.####.
..##..

← 1
..##...
.##....
#######
.##....
..##...

→ 1
...##..
....##.
#######
....##.
...##..

♪
..####
..##.#
..##..
..##..
.###..
####..
.##...

✓ 1
.....##
....##.
##.##..
.###...
..#....

ℹ
.##.
....
###.
.##.
.##.
.##.
####
`;

/** Tildes y diéresis: se dibujan encima de su mayúscula, con una fila de aire. */
const MARKS = Object.freeze({
    acute: ['...##.', '..##..'],
    dieresis: ['##..##'],
    tilde: ['.##.##', '##.##.'],
});

const COMPOSED = Object.freeze({
    'Á': ['A', 'acute'], 'É': ['E', 'acute'], 'Í': ['I', 'acute'], 'Ó': ['O', 'acute'], 'Ú': ['U', 'acute'],
    'Ü': ['U', 'dieresis'], 'Ñ': ['N', 'tilde'],
});

/** Lo que se escribe distinto pero se dibuja igual. */
const ALIASES = Object.freeze({
    '’': "'", '‘': "'", '“': '"', '”': '"', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '✕': '×', '☆': '★',
});

/**
 * @typedef {{ w: number, y0: number, rows: string[] }} Glyph
 * `y0`: la fila (0 = lo alto de una mayúscula) en la que empieza `rows`.
 */

/** @type {Map<string, Glyph>} */
const GLYPHS = buildGlyphs();

function buildGlyphs() {
    const map = new Map();
    for (const block of RAW.trim().split(/\n\s*\n/)) {
        const lines = block.split('\n');
        const [ch, start] = lines[0].split(' ');
        const rows = lines.slice(1);
        const w = Math.max(...rows.map((r) => r.length));
        map.set(ch, { w, y0: start === undefined ? 0 : Number(start), rows: rows.map((r) => r.padEnd(w, '.')) });
    }
    for (const [ch, [base, mark]] of Object.entries(COMPOSED)) {
        const g = map.get(base);
        const m = MARKS[mark];
        // La tilde, centrada sobre la letra (la Í es más estrecha que su tilde).
        const mw = m[0].length;
        const w = Math.max(g.w, mw);
        const padL = Math.floor((w - g.w) / 2);
        const center = (row) => '.'.repeat(Math.floor((w - mw) / 2)) + row;
        const rows = [
            ...m.map((r) => center(r).padEnd(w, '.')),
            '.'.repeat(w),
            ...g.rows.map((r) => ('.'.repeat(padL) + r).padEnd(w, '.')),
        ];
        map.set(ch, { w, y0: -(m.length + 1), rows });
    }
    return map;
}

/** El texto tal como se dibuja: en mayúsculas y con los caracteres equivalentes. */
export function normalizeText(text) {
    let out = '';
    for (const ch of String(text).toLocaleUpperCase('es')) out += ALIASES[ch] ?? ch;
    return out;
}

/** Si todos los caracteres de un texto están dibujados. */
export function supportsText(text) {
    for (const ch of normalizeText(text)) {
        if (ch !== ' ' && !GLYPHS.has(ch)) return false;
    }
    return true;
}

/** Caracteres dibujados (para los tests y la hoja de muestra). */
export function glyphChars() {
    return [...GLYPHS.keys()];
}

/** @param {string} ch  Ya normalizado. */
export function glyphOf(ch) {
    return GLYPHS.get(ch) ?? null;
}

/** Ancho de un texto en celdas. */
export function measureText(text) {
    let w = 0;
    let first = true;
    for (const ch of normalizeText(text)) {
        if (!first) w += FONT.gap;
        first = false;
        w += ch === ' ' ? FONT.space : (GLYPHS.get(ch)?.w ?? 0);
    }
    return w;
}

/**
 * El trazo SVG de un texto: un rectángulo por cada racha de celdas encendidas de
 * cada fila, en unidades de celda (la mayúscula ocupa de y = 0 a y = 7).
 *
 * @param {string} text
 * @returns {{ d: string, width: number }}  `width` en celdas.
 */
export function textPath(text) {
    let d = '';
    let x = 0;
    let first = true;
    for (const ch of normalizeText(text)) {
        if (!first) x += FONT.gap;
        first = false;
        if (ch === ' ') {
            x += FONT.space;
            continue;
        }
        const g = GLYPHS.get(ch);
        if (!g) continue;
        for (let r = 0; r < g.rows.length; r++) {
            const row = g.rows[r];
            let c = 0;
            while (c < row.length) {
                if (row[c] !== '#') {
                    c++;
                    continue;
                }
                let end = c;
                while (end < row.length && row[end] === '#') end++;
                d += `M${x + c} ${g.y0 + r}h${end - c}v1h${c - end}z`;
                c = end;
            }
        }
        x += g.w;
    }
    return { d, width: x };
}
