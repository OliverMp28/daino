// La isla de One Day (T02.6): la costa donde ella espera, más cerca que el barco.
//
// Una costa entera y no una roca suelta: tierra baja con lomas y palmeras que
// sigue fuera de la pantalla, la subida al cabo, la loma del faro, la casa con su
// chimenea y la meseta que acaba en la pared del mar. Su pie está en el agua
// cerca de la orilla (ISLAND_LIFT sobre el suelo), muy por debajo del horizonte:
// por eso todo en ella se ve más grande que el barco, que está en el horizonte.
//
// Pixel art a media celda hecho con código (un perfil, vetas, hierba y unas
// pocas piezas dibujadas por filas), determinista: el mismo dibujo siempre.
// Cada carácter es un material de storyArt.js (la hora lo tiñe). Puro y sin Pixi:
// la capa (StoryCliff.js) lo pinta y el guardián (scenes/backdrops.js) lo mide.

import { CHILD_ROWS, STORY_CELL, WOMAN_LAMP, WOMAN_ROWS } from './storyArt.js';

/** Altura (unidades de mundo) de la línea del agua de la isla sobre el suelo. */
export const ISLAND_LIFT = 26;

/**
 * Forma de la isla, en píxeles del arte (media celda).
 *   width, height  Tamaño del dibujo (la última fila es la del agua).
 *   wall           Columna de la pared del mar: la que se coloca en la pista `x`.
 *   lowLand        Hasta dónde llega la tierra baja; `rise` la subida al cabo;
 *                  `knoll` la loma del faro; `plateau` el alto de la meseta.
 */
export const ISLAND_SHAPE = Object.freeze({
    width: 470,
    height: 136,
    wall: 446,
    lowLand: 220,
    rise: 318,
    knoll: 352,
    plateau: 70,
});

const hash = (i, s) => {
    let x = (i * 374761393 + s * 668265263) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
};
const smooth = (i, s, step) => {
    const a = Math.floor(i / step);
    const t = i / step - a;
    const u = t * t * (3 - 2 * t);
    return hash(a, s) * (1 - u) + hash(a + 1, s) * u;
};
const sm = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Alto de la tierra sobre el agua (píxeles) en cada columna. */
function heightAt(x) {
    const S = ISLAND_SHAPE;
    const low = (v) => 13 + 9 * sm(0, S.lowLand, v) + 4 * Math.sin(v / 23) + 2.5 * Math.sin(v / 9.5 + 1);
    let h;
    if (x < S.lowLand) h = low(x);
    else if (x < S.rise) {
        const from = low(S.lowLand);
        h = from + (S.plateau - from) * sm(S.lowLand, S.rise, x);
    } else if (x < S.knoll) h = S.plateau + 5 * Math.sin(((x - S.rise) / (S.knoll - S.rise)) * Math.PI);
    else h = S.plateau + 2 * Math.sin(((x - S.knoll) / (S.wall - S.knoll)) * Math.PI);
    return Math.round(h + (smooth(x, 7, 4) - 0.5) * 1.4);
}

/** Columna de la pared del mar a una fila: saliente arriba, un entrante y el talud. */
function wallAt(y, wl) {
    const up = wl - y;
    let x = ISLAND_SHAPE.wall + (smooth(y, 11, 3) - 0.5) * 2;
    if (up > 62) x += 1.5;
    if (up > 30 && up < 46) x -= 2 * Math.sin(((up - 30) / 16) * Math.PI);
    if (up < 14) x += (14 - up) * 0.7;
    return Math.round(x);
}

/** El faro: remate, linterna, galería y una torre que se ensancha, a franjas. */
function lighthouseRows() {
    const w0 = 18;
    const row = (w, fill, mid = null) => {
        const pad = Math.floor((w0 - w) / 2);
        const line = '.'.repeat(pad) + fill.repeat(w) + '.'.repeat(w0 - w - pad);
        return mid ? [...line].map((c, i) => mid(i) ?? c).join('') : line;
    };
    const r = [row(2, 'g'), row(4, 'g'), row(6, 'g'), row(8, 'g')];
    for (let k = 0; k < 5; k++) r.push(row(6, 'g', (i) => (i >= 7 && i <= 10 ? 'L' : null)));
    r.push(row(12, 'g'), row(10, 'g'));
    const body = 36;
    for (let j = 0; j < body; j++) {
        const w = 8 + Math.round((6 * j) / (body - 1));
        const band = Math.floor(j / 6) % 2 === 1;
        r.push(row(w + (w % 2), band ? 'b' : 't', (i) => {
            if ((j === 8 || j === 20) && i === 9) return 'g';
            if (j >= body - 6 && (i === 8 || i === 9)) return 'g';
            return null;
        }));
    }
    r.push(row(18, 'g'));
    return r;
}

/** La casa: tejado a dos aguas con chimenea, muros, dos ventanas y la puerta. */
function houseRows() {
    const w = 36;
    const roofH = 12;
    const r = ['.'.repeat(27) + 'cc' + '.'.repeat(w + 2 - 29)];
    for (let j = 0; j < roofH; j++) {
        const half = Math.round(2 + (j * (w / 2 - 1)) / (roofH - 1));
        let line = '';
        for (let i = 0; i < w + 2; i++) {
            const d = Math.abs(i - (w + 1) / 2);
            line += d <= half ? (d >= half - 1.2 || j === roofH - 1 ? 'R' : 'r') : '.';
        }
        if (j < 9) line = line.slice(0, 27) + 'cc' + line.slice(29);
        r.push(line);
    }
    for (let j = 0; j < 14; j++) {
        r.push([...('.' + 'w'.repeat(w) + '.')].map((c, i) => {
            if (c === '.') return c;
            if ((i === 2 || i === w - 1) && j > 0) return 'W';
            if (j >= 4 && j <= 7 && ((i >= 6 && i <= 10) || (i >= w - 9 && i <= w - 5))) return 'L';
            if (j >= 6 && i >= 16 && i <= 20) return 'd';
            return 'w';
        }).join(''));
    }
    return r;
}

/** Una palmera: tronco curvo hacia tierra y hojas que cuelgan. `sway` las mece. */
function palmRows(height, sway) {
    const w = 30;
    const g = Array.from({ length: height }, () => new Array(w).fill('.'));
    const top = 6;
    const trunkX = (j) => 15 + Math.round(4 * ((j - top) / (height - top)) ** 2 - 2 * (1 - (j - top) / (height - top)));
    for (let j = top; j < height; j++) {
        const x = trunkX(j);
        g[j][x] = 'k';
        if (j > height - 6) g[j][x + 1] = 'k';
    }
    const cx = trunkX(top);
    for (const [dx, droop] of [[-13, 4], [-9, 6], [-5, 3], [6, 3], [10, 6], [14, 4], [-1, -1]]) {
        const n = Math.abs(dx) + 2;
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const x = Math.round(cx + dx * t + (dx < 0 ? -sway : sway) * t * t * 0.6);
            const y = Math.round(top - 2.5 * Math.sin(t * Math.PI) + droop * t * t + (dx === -1 ? -3 * t : 0));
            if (y >= 0 && y < height && x >= 0 && x < w) g[y][x] = 'p';
            if (y + 1 < height && x >= 0 && x < w && t > 0.2 && t < 0.85 && Math.abs(dx) > 4) g[y + 1][x] = 'p';
        }
    }
    g[top][cx] = 'k';
    g[top + 1][cx] = 'p';
    return Object.freeze(g.map((r) => r.join('')));
}

let cached = null;

/**
 * El dibujo de la isla (se calcula una vez).
 *   rock, grass, house, houseLight, tower, towerLight  Filas de cada capa.
 *   palms        Dónde va cada palmera (esquina de arriba a la izquierda) y si es baja.
 *   palmFrames   Los dos fotogramas de las palmeras altas y de las bajas.
 *   spots        Ella, el hijo (esquina de arriba a la izquierda), el farol de su
 *                mano, la lámpara del faro y la chimenea, en píxeles del arte.
 *   top          La fila más alta que pinta (el remate del faro o la cabeza de ella).
 */
export function islandArt() {
    if (cached !== null) return cached;
    const S = ISLAND_SHAPE;
    const W = S.width;
    const H = S.height;
    const WL = H - 1;
    const grid = () => Array.from({ length: H }, () => new Array(W).fill('.'));
    const rock = grid();
    const grass = grid();
    const house = grid();
    const houseLight = grid();
    const tower = grid();
    const towerLight = grid();

    const topRow = [];
    for (let x = 0; x < W; x++) {
        topRow[x] = WL - heightAt(x);
        for (let y = topRow[x]; y <= WL; y++) if (x <= wallAt(y, WL)) rock[y][x] = 'o';
    }
    // Rocas sueltas al pie de la pared.
    for (const [dx, up, rx, ry] of [[14, 2, 3.4, 2.6], [19, 1, 2, 1.5], [9, 3, 2.6, 2.2]]) {
        const cx = S.wall + dx;
        const cy = WL - up;
        for (let y = Math.floor(cy - ry); y <= WL; y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && x < W) rock[y][x] = 'o';
            }
        }
    }
    // Vetas claras y grietas en la roca del cabo.
    for (let k = 0; k < 16; k++) {
        const x0 = 230 + Math.floor(hash(k, 2) * 200);
        const up0 = 8 + Math.floor(hash(k, 1) * 55);
        const len = 8 + Math.floor(hash(k, 3) * 24);
        for (let i = 0; i < len; i++) {
            const x = x0 + i;
            const y = WL - up0 + Math.round((smooth(x, 30 + k, 6) - 0.5) * 1.6 - i * 0.08);
            if (y < 0 || y > WL || x >= W || rock[y][x] !== 'o' || y - topRow[x] < 3) continue;
            if (hash(x, 60 + k) < 0.85) rock[y][x] = 'O';
        }
    }
    for (const [x0, up0, n] of [[436, 64, 10], [428, 50, 9], [440, 36, 8], [420, 30, 9], [404, 52, 7], [380, 40, 8], [350, 34, 7], [300, 30, 6], [270, 18, 5]]) {
        let x = x0;
        for (let j = 0; j < n; j++) {
            const y = WL - up0 + j;
            if (y >= 0 && y <= WL && rock[y][x] !== '.' && y - topRow[x] > 2) rock[y][x] = 'q';
            if (hash(j, x0) < 0.35) x += hash(j, up0) < 0.5 ? -1 : 1;
        }
    }
    for (let y = 0; y <= WL; y++) {
        const up = WL - y;
        if (up <= 30 || up >= 46) continue;
        const xw = wallAt(y, WL);
        for (let x = xw - 2; x <= xw; x++) if (rock[y][x] === 'o') rock[y][x] = 'q';
    }
    // Hierba: más gruesa en la tierra baja, matas que asoman y la que cuelga del borde.
    for (let x = 0; x <= S.wall; x++) {
        const y0 = topRow[x];
        const thick = x < 300 ? 3 : 2;
        for (let k = 0; k < thick; k++) if (rock[y0 + k]?.[x] !== '.') grass[y0 + k][x] = 'G';
        if (hash(x, 4) < 0.4) grass[y0 - 1][x] = 'G';
        if (hash(x, 5) < 0.14) grass[y0 - 2][x] = 'G';
    }
    for (let up = 60; up < S.plateau; up++) {
        const y = WL - up;
        if (hash(up, 9) < 0.7) grass[y][wallAt(y, WL)] = 'G';
    }

    const groundAt = (x0, w) => {
        let y = H;
        for (let x = x0; x < x0 + w; x++) y = Math.min(y, topRow[x]);
        return y;
    };
    const stamp = (target, rows, x0, baseY, light, lightTarget) => {
        const top = baseY - rows.length + 1;
        rows.forEach((r, j) => [...r].forEach((c, i) => {
            if (c === '.') return;
            const X = x0 + i;
            const Y = top + j;
            if (X < 0 || Y < 0 || X >= W || Y >= H) return;
            if (c === 'L') {
                target[Y][X] = light;
                lightTarget[Y][X] = 'L';
            } else target[Y][X] = c === 'c' ? 'w' : c;
        }));
        return top;
    };
    // El faro, en su loma; la casa, en la meseta.
    const lh = lighthouseRows();
    const lhX = 329;
    const lhTop = stamp(tower, lh, lhX, groundAt(lhX + 2, 14) + 1, 'g', towerLight);
    const hs = houseRows();
    const hsX = 362;
    const hsTop = stamp(house, hs, hsX, groundAt(hsX + 2, 34) + 1, 'd', houseLight);

    const high = [palmRows(30, 0), palmRows(30, 1.6)];
    const low = [palmRows(24, 0), palmRows(24, 1.6)];
    const palms = [[348, false], [400, false], [140, true], [232, true]].map(([x, isLow]) => {
        const rows = isLow ? low[0] : high[0];
        return Object.freeze({ x, y: groundAt(x + 15, 3) + 1 - rows.length + 1, low: isLow });
    });

    // Ella en el borde, el hijo a su lado (los pies en la hierba).
    const wX = S.wall - 19;
    const wY = groundAt(wX + 4, 6) - WOMAN_ROWS[0].length + 1;
    const cX = S.wall - 30;
    const cY = groundAt(cX + 2, 5) - CHILD_ROWS[0].length + 1;

    const rows = (g) => Object.freeze(g.map((r) => r.join('')));
    cached = Object.freeze({
        width: W,
        height: H,
        waterline: WL,
        wall: S.wall,
        rock: rows(rock),
        grass: rows(grass),
        house: rows(house),
        houseLight: rows(houseLight),
        tower: rows(tower),
        towerLight: rows(towerLight),
        palms: Object.freeze(palms),
        palmFrames: Object.freeze({ high: Object.freeze(high), low: Object.freeze(low) }),
        spots: Object.freeze({
            woman: Object.freeze([wX, wY]),
            child: Object.freeze([cX, cY]),
            lamp: Object.freeze([wX + WOMAN_LAMP[0], wY + WOMAN_LAMP[1]]),
            beacon: Object.freeze([lhX + 9, lhTop + 6.5]),
            chimney: Object.freeze([hsX + 28, hsTop]),
        }),
        top: Math.min(lhTop, wY, hsTop, ...palms.map((p) => p.y)),
    });
    return cached;
}

/**
 * La espuma al pie de la isla (tres filas: la última de la tierra y el agua de
 * debajo). Rompe más contra las rocas de la pared. El fotograma (0 o 1) mueve los
 * huecos: las olas.
 *
 * @param {0 | 1} frame
 */
export function islandSurfRows(frame) {
    const art = islandArt();
    const w = art.width;
    const rows = [[], [], []];
    for (let x = 0; x < w; x++) {
        const base = art.rock[art.waterline][x] !== '.';
        const wall = x >= art.wall - 6;
        const k = hash(x + frame * 7, 3);
        rows[0].push(wall && base && k < 0.35 ? 'Q' : '.');
        rows[1].push(base && (wall ? k < 0.7 : k < 0.12) ? 'Q' : '.');
        rows[2].push(base && (wall ? k < 0.85 : k < 0.4) ? 'Q' : '.');
    }
    return Object.freeze(rows.map((r) => r.join('')));
}

/** Alto (unidades de mundo) de lo más alto de la isla sobre su línea del agua. */
export function islandVisibleHeight() {
    const art = islandArt();
    return (art.waterline + 1 - art.top) * STORY_CELL;
}

let spans = null;

/**
 * A qué alturas (unidades de mundo sobre la línea del agua) llega cada material
 * de la isla: el guardián compara lo que se juega con lo que de verdad tiene
 * detrás a cada altura (el faro solo está arriba; la tierra baja, solo abajo).
 *
 * @returns {Record<string, [number, number]>}
 */
export function islandMaterialSpans() {
    if (spans !== null) return spans;
    const art = islandArt();
    const rowsOf = (grid, chars) => {
        let top = Infinity;
        let bottom = -Infinity;
        grid.forEach((r, y) => {
            if ([...chars].some((c) => r.includes(c))) {
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
            }
        });
        return [(art.waterline - bottom) * STORY_CELL, (art.waterline + 1 - top) * STORY_CELL];
    };
    const palm = (ch) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of art.palms) {
            const rows = art.palmFrames[p.low ? 'low' : 'high'][0];
            rows.forEach((r, j) => {
                if (!r.includes(ch)) return;
                lo = Math.min(lo, (art.waterline - (p.y + j)) * STORY_CELL);
                hi = Math.max(hi, (art.waterline + 1 - (p.y + j)) * STORY_CELL);
            });
        }
        return [lo, hi];
    };
    spans = Object.freeze({
        rock: rowsOf(art.rock, 'oOq'),
        grass: rowsOf(art.grass, 'G'),
        wall: rowsOf(art.house, 'wW'),
        roof: rowsOf(art.house, 'rR'),
        tower: rowsOf(art.tower, 't'),
        band: rowsOf(art.tower, 'b'),
        palm: palm('p'),
        trunk: palm('k'),
    });
    return spans;
}
