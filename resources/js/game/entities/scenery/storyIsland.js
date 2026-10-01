// La isla de One Day (T02.6): la costa donde ella espera, más cerca que el barco.
//
// Una costa entera y no una roca suelta: tierra baja con su palmeral que sigue
// fuera de la pantalla, la ladera verde que sube al cabo (con su sendero hasta el
// bote varado en la orilla), el faro en su loma, la casa arropada por árboles y
// la meseta que acaba en la pared del mar, donde la hierba está gastada de tanto
// esperar. Su pie está en el agua cerca de la orilla (ISLAND_LIFT sobre el suelo),
// muy por debajo del horizonte: por eso todo en ella se ve más grande que el
// barco, que está en el horizonte.
//
// La tierra es sobre todo verde: la ladera entera es hierba, bajo el césped de la
// meseta asoma una franja de tierra y la roca (parda, a estratos, con musgo) solo
// queda en la pared del cabo. Tras el playtest: toda de roca gris "se sentía a
// muy rocoso" y "desértica".
//
// Pixel art a media celda hecho con código (un perfil, capas de terreno y unas
// piezas: storyIslandParts.js), determinista: el mismo dibujo siempre. Cada
// carácter es una tinta (material + tono) que la hora tiñe (storyArt.js). Puro y
// sin Pixi: la capa (StoryCliff.js) lo pinta y el guardián (scenes/backdrops.js)
// lo mide.

import { CHILD_ROWS, STORY_CELL, STORY_SOLID_MATERIALS, WOMAN_LAMP, WOMAN_ROWS } from './storyArt.js';
import {
    ISLAND_INKS, PALM_KINDS,
    boatRows, bushRows, cottageRows, fenceRows, hash, hash2, lighthouseRows, noise2, palmRows, sm, smooth, treeRows,
} from './storyIslandParts.js';

/** Altura (unidades de mundo) de la línea del agua de la isla sobre el suelo. */
export const ISLAND_LIFT = 26;

/**
 * Forma de la isla, en píxeles del arte (media celda).
 *   width, height  Tamaño del dibujo (la última fila es la del agua).
 *   wall           Columna de la pared del mar: la que se coloca en la pista `x`.
 *   lowLand        Hasta dónde llega la tierra baja; `rise`, donde acaba la subida
 *                  al cabo; `plateau`, el alto de la meseta.
 *   knoll          La loma del faro: de dónde a dónde y cuánto sube.
 *   face           Entre qué columnas la ladera verde se retira y deja ver la roca.
 *   worn           Entre qué columnas la hierba del borde se va gastando hasta la
 *                  tierra (donde ella espera).
 */
export const ISLAND_SHAPE = Object.freeze({
    width: 470,
    height: 136,
    wall: 446,
    lowLand: 200,
    rise: 300,
    plateau: 70,
    knoll: Object.freeze([312, 350, 5]),
    face: Object.freeze([268, 396]),
    worn: Object.freeze([400, 424]),
});

/**
 * Dónde va cada cosa (columna de su esquina izquierda, en píxeles del arte).
 * `depth`: filas por debajo del perfil, para lo que crece en la cara de la
 * ladera (más cerca de quien mira) y no en su cresta.
 */
export const ISLAND_LAYOUT = Object.freeze({
    lighthouse: 322,
    cottage: 347,
    /** Árboles detrás de lo construido: arropan la casa por los dos lados. */
    trees: Object.freeze([
        Object.freeze({ x: 298, size: 'mid' }),
        Object.freeze({ x: 336, size: 'big' }),
        Object.freeze({ x: 384, size: 'mid' }),
        Object.freeze({ x: 284, size: 'small' }),
    ]),
    /** Arbustos: en la cresta, al pie de la casa y por la cara de la ladera. */
    bushes: Object.freeze([
        Object.freeze({ x: 341, kind: 0, depth: -1 }),
        Object.freeze({ x: 402, kind: 1, depth: -1 }),
        Object.freeze({ x: 272, kind: 2, depth: 9 }),
        Object.freeze({ x: 246, kind: 0, depth: 14 }),
        Object.freeze({ x: 297, kind: 1, depth: 17 }),
        Object.freeze({ x: 228, kind: 1, depth: 5 }),
        Object.freeze({ x: 312, kind: 0, depth: 25 }),
        Object.freeze({ x: 262, kind: 1, depth: 26 }),
        Object.freeze({ x: 180, kind: 2, depth: 3 }),
        Object.freeze({ x: 96, kind: 0, depth: 4 }),
    ]),
    /** El palmeral, en la tierra baja y al pie de la ladera: alturas y caídas distintas. */
    palms: Object.freeze([
        Object.freeze({ x: 208, kind: 'tall', depth: 0 }),
        Object.freeze({ x: 219, kind: 'short', depth: 7 }),
        Object.freeze({ x: 233, kind: 'mid', depth: 2 }),
        Object.freeze({ x: 160, kind: 'mid', depth: 0 }),
        Object.freeze({ x: 146, kind: 'tall', depth: 5 }),
        Object.freeze({ x: 64, kind: 'short', depth: 0 }),
    ]),
    fence: Object.freeze({ x: 278, length: 21 }),
    boat: 221,
    woman: -19,   // desde la pared
    child: -30,
});

/** Los grupos del dibujo, en el orden en que se pintan. */
export const ISLAND_GROUPS = Object.freeze(['land', 'back', 'lighthouse', 'home', 'front']);

/** Alto de la tierra sobre el agua (píxeles) en cada columna. */
function terrain() {
    const S = ISLAND_SHAPE;
    const low = (v) => 12 + 8 * sm(0, S.lowLand, v) + 3.5 * Math.sin(v / 23) + 2 * Math.sin(v / 9.5 + 1);
    const out = new Array(S.width);
    for (let x = 0; x < S.width; x++) {
        let v;
        if (x < S.lowLand) v = low(x);
        else if (x < S.rise) {
            const from = low(S.lowLand);
            const t = (x - S.lowLand) / (S.rise - S.lowLand);
            // Un rellano a media ladera: no es una rampa.
            v = from + (S.plateau - from) * sm(0, 1, t) + 2.4 * Math.sin(t * Math.PI * 3) * (1 - t);
        } else {
            const [k0, k1, up] = S.knoll;
            const bump = x > k0 && x < k1 ? Math.min(up, up * 1.7 * Math.sin(((x - k0) / (k1 - k0)) * Math.PI)) : 0;
            v = S.plateau + bump;
        }
        out[x] = Math.round(v + (x < S.rise ? (smooth(x, 7, 4) - 0.5) * 1.4 : 0));
    }
    return out;
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

/**
 * El terreno: hierba, tierra y roca.
 *   - La ladera y la tierra baja son hierba hasta la franja de la orilla.
 *   - Entre `face` la ladera se retira en diagonal y asoma la roca del cabo.
 *   - En la meseta, un césped grueso que cuelga, una franja de tierra debajo y
 *     la roca: a estratos, con facetas, grietas, musgo y enredaderas.
 */
function paintLand(g, top, WL) {
    const S = ISLAND_SHAPE;
    const W = S.width;
    const shore = (x) => 4 + Math.round(3 * smooth(x, 31, 9));
    const turf = (x) => 5 + Math.round(3 * smooth(x, 21, 7)) + (hash(x, 23) < 0.14 ? 2 : 0);
    const soil = (x) => 6 + Math.round(6 * smooth(x, 22, 11));
    const greenBottom = (x) => {
        const flank = WL - shore(x);
        const cap = top[x] + turf(x) - 1;
        const t = sm(S.face[0], S.face[1], x) ** 0.8;
        return Math.round(flank + (cap - flank) * t + (t > 0 && t < 1 ? (smooth(x, 24, 6) - 0.5) * 5 : 0));
    };
    /** ¿Está pelada la hierba ahí? Cada vez más hacia el borde, y sobre todo arriba. */
    const worn = (x, depth) => hash2(x >> 1, depth, 27) < sm(S.worn[0], S.worn[1], x) * [1, 0.75, 0.3][depth];

    for (let x = 0; x < W; x++) {
        const gb = greenBottom(x);
        const earthTo = gb + soil(x);
        const onShore = x < S.face[0] || earthTo >= WL - 1;
        for (let y = top[x]; y <= WL; y++) {
            if (x > wallAt(y, WL)) continue;
            const depth = y - top[x];
            let ink;
            if (y <= gb) {
                // Hierba: clara arriba, con manchas más oscuras y alguna mata.
                const n = noise2(x, y, 51, 9, 5);
                ink = depth <= 1 ? 'G' : hash2(x, y, 52) < 0.006 ? 'h' : n < 0.4 || y === gb ? 'g' : 'G';
                if (depth <= 2 && worn(x, depth)) ink = hash2(x, y, 28) < 0.25 ? 'e' : 'E';
            } else if (y <= earthTo || onShore) {
                // Tierra (o la arena y los guijarros de la orilla).
                const k = hash2(x, y, 53);
                ink = y === gb + 1 ? 'e' : k < 0.04 ? 'y' : k < 0.2 ? 'e' : 'E';
            } else {
                // Roca: estratos que ondulan y sombras anchas entre ellos.
                const lift = Math.round(3 * smooth(x, 40, 17));
                const strata = (WL - y + lift) % 8 === 0 && hash2(x >> 2, y, 55) < 0.8;
                const shade = noise2(x, y + lift, 54, 13, 4) < 0.42 || (WL - y + lift) % 8 === 7;
                ink = strata ? 'x' : shade ? 'r' : 'R';
                if (y === earthTo + 1) ink = 'r';
            }
            g[y][x] = ink;
        }
    }
    // Rocas sueltas al pie de la pared.
    for (const [dx, up, rx, ry] of [[14, 2, 3.4, 2.6], [19, 1, 2, 1.5], [9, 3, 2.6, 2.2]]) {
        const cx = S.wall + dx;
        const cy = WL - up;
        for (let y = Math.floor(cy - ry); y <= WL; y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && x < W) g[y][x] = y > cy ? 'r' : 'R';
            }
        }
    }
    const isRock = (x, y) => 'Rrx'.includes(g[y]?.[x] ?? '.');
    // Grietas que bajan por la roca.
    for (const [x0, up0, n] of [[436, 54, 10], [428, 44, 9], [440, 36, 8], [420, 30, 9], [404, 46, 7], [382, 36, 8], [356, 28, 7], [398, 20, 6]]) {
        let x = x0;
        for (let j = 0; j < n; j++) {
            const y = WL - up0 + j;
            if (isRock(x, y)) g[y][x] = 'x';
            if (hash(j, x0) < 0.35) x += hash(j, up0) < 0.5 ? -1 : 1;
        }
    }
    // El entrante de la pared, en sombra.
    for (let y = 0; y <= WL; y++) {
        const up = WL - y;
        if (up <= 30 || up >= 46) continue;
        const xw = wallAt(y, WL);
        for (let x = xw - 2; x <= xw; x++) if (isRock(x, y)) g[y][x] = 'x';
    }
    // Musgo en las repisas de la roca.
    for (const [cx, up, rx, ry] of [[392, 42, 6, 2.6], [421, 27, 4.5, 2.2], [366, 24, 6, 2.4], [407, 13, 5.5, 2.2], [436, 47, 3.2, 2], [378, 9, 5, 2], [431, 12, 5, 2.4], [346, 12, 6, 2.2], [411, 37, 4, 2]]) {
        const cy = WL - up;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                if (!isRock(x, y) || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1 + (hash2(x, y, 56) - 0.5) * 0.5) continue;
                g[y][x] = y < cy ? 'G' : 'g';
            }
        }
    }
    // Hiedra que cuelga del césped sobre la tierra y la roca, a cortinas.
    for (const [x0, x1, len] of [[428, 446, 15], [398, 409, 11], [372, 383, 13], [350, 357, 8]]) {
        for (let x = x0; x <= x1; x++) {
            const edge = Math.sin(((x - x0 + 0.5) / (x1 - x0 + 1)) * Math.PI);
            const n = Math.round(len * edge * (0.45 + 0.55 * hash(x, 57)));
            let y = top[x];
            while (y <= WL && 'Ggh'.includes(g[y][x])) y++;
            for (let k = 0; k < n && y + k <= WL && g[y + k][x] !== '.'; k++) g[y + k][x] = k === n - 1 ? 'h' : hash2(x, k, 58) < 0.35 ? 'G' : 'g';
        }
    }
    // Matas que asoman sobre el perfil y enredaderas que cuelgan del borde.
    for (let x = 0; x <= S.wall; x++) {
        if (worn(x, 0)) continue;
        if (hash(x, 4) < 0.42) g[top[x] - 1][x] = 'G';
        if (hash(x, 5) < 0.15) g[top[x] - 2][x] = 'G';
    }
    for (let up = 52; up < S.plateau; up++) {
        const y = WL - up;
        const xw = wallAt(y, WL);
        if (hash(up, 9) < 0.75 - (S.plateau - up) * 0.02) g[y][xw] = up % 3 === 0 ? 'g' : 'G';
        if (up > 60 && hash(up, 10) < 0.5) g[y][xw - 1] = 'g';
    }
    // El sendero: de la meseta a la orilla, cruzando la cara de la ladera.
    const [px0, px1] = [226, 302];
    for (let x = px0; x <= px1; x++) {
        const t = (x - px0) / (px1 - px0);
        const from = WL - shore(px0) - 1;
        const y = Math.round(from + (top[px1] + 2 - from) * t ** 1.25 + 2.2 * Math.sin(t * Math.PI * 2.5));
        for (let k = 0; k < 2; k++) {
            const c = g[y + k]?.[x];
            if (c === 'G' || c === 'g' || c === 'h') g[y + k][x] = k === 0 ? 'E' : 'e';
        }
    }
}

let cached = null;

/**
 * El dibujo de la isla (se calcula una vez).
 *   groups       Filas de cada grupo (ISLAND_GROUPS), en tintas (ISLAND_INKS):
 *                `land` la tierra, `back` los árboles de detrás, `lighthouse`,
 *                `home` la casa y `front` los arbustos, la cerca y el bote.
 *   lights       Las luces ('L') del faro y de la casa, en su misma cuadrícula.
 *   palms        Cada palmera: esquina de arriba a la izquierda y su forma.
 *   palmFrames   Por forma, sus dos fotogramas (el viento).
 *   spots        Ella, el hijo (esquina de arriba a la izquierda), el farol de su
 *                mano, la lámpara del faro y la boca de la chimenea, en píxeles del arte.
 *   top          La fila más alta que pinta.
 */
export function islandArt() {
    if (cached !== null) return cached;
    const S = ISLAND_SHAPE;
    const L = ISLAND_LAYOUT;
    const W = S.width;
    const H = S.height;
    const WL = H - 1;
    const grid = () => Array.from({ length: H }, () => new Array(W).fill('.'));
    const groups = Object.fromEntries(ISLAND_GROUPS.map((id) => [id, grid()]));
    const lights = { lighthouse: grid(), home: grid() };

    const top = terrain().map((h) => WL - h);
    paintLand(groups.land, top, WL);

    /** Fila del suelo más alto bajo [x0, x0 + w). */
    const groundAt = (x0, w) => {
        let y = H;
        for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) y = Math.min(y, top[x]);
        return y;
    };
    /** Estampa unas filas con su última fila en `baseY`; `only`: solo sobre esas tintas de la tierra. */
    const stamp = (target, rows, x0, baseY, only = null) => {
        const y0 = baseY - rows.length + 1;
        rows.forEach((r, j) => [...r].forEach((c, i) => {
            const X = x0 + i;
            const Y = y0 + j;
            if (c === '.' || X < 0 || Y < 0 || X >= W || Y >= H) return;
            if (only !== null && !only.includes(groups.land[Y][X])) return;
            target[Y][X] = c;
        }));
        return y0;
    };

    // Los árboles, detrás; el faro en su loma y la casa en la meseta, hundidos una
    // fila en la hierba.
    let highest = H;
    for (const t of L.trees) {
        const rows = treeRows(t.size);
        highest = Math.min(highest, stamp(groups.back, rows, t.x, groundAt(t.x + (rows[0].length >> 1) - 2, 4) + 1));
    }
    const lh = lighthouseRows();
    const lhBase = groundAt(L.lighthouse + 2, 16) + 1;
    highest = Math.min(highest, stamp(groups.lighthouse, lh.rows, L.lighthouse, lhBase));
    stamp(lights.lighthouse, lh.light, L.lighthouse, lhBase);
    const home = cottageRows();
    const homeBase = groundAt(L.cottage, home.rows[0].length) + 1;
    highest = Math.min(highest, stamp(groups.home, home.rows, L.cottage, homeBase));
    stamp(lights.home, home.light, L.cottage, homeBase);

    // Delante: arbustos (los de la ladera, solo sobre hierba), la cerca que sube
    // por el hombro de la ladera y el bote en la orilla.
    for (const b of L.bushes) {
        const rows = bushRows(b.kind);
        const base = groundAt(b.x + 2, rows[0].length - 4) + b.depth;
        stamp(groups.front, rows, b.x, base, b.depth > 0 ? 'Ggh' : null);
    }
    const fence = fenceRows(L.fence.length);
    for (let i = 0; i < L.fence.length; i++) {
        const x = L.fence.x + i;
        stamp(groups.front, fence.map((r) => r[i]), x, top[x]);
    }
    stamp(groups.front, boatRows(), L.boat, WL - 2);

    // Las palmeras (se mecen: van aparte, con sus dos fotogramas).
    const palmFrames = {};
    const foot = {};
    for (const kind of Object.keys(PALM_KINDS)) {
        const still = palmRows(kind, 0);
        palmFrames[kind] = Object.freeze([still.rows, palmRows(kind, 1.5).rows]);
        foot[kind] = still.foot;
    }
    const palms = L.palms.map((p) => {
        const rows = palmFrames[p.kind][0];
        const base = top[p.x] + p.depth;
        const y = base - rows.length + 1;
        highest = Math.min(highest, y);
        return Object.freeze({ x: p.x - foot[p.kind], y, kind: p.kind });
    });

    // Ella en el borde, el hijo a su lado (los pies en la tierra).
    const wX = S.wall + L.woman;
    const wY = groundAt(wX + 4, 6) - WOMAN_ROWS[0].length + 1;
    const cX = S.wall + L.child;
    const cY = groundAt(cX + 2, 5) - CHILD_ROWS[0].length + 1;
    highest = Math.min(highest, wY, cY);

    const rows = (g) => Object.freeze(g.map((r) => r.join('')));
    cached = Object.freeze({
        width: W,
        height: H,
        waterline: WL,
        wall: S.wall,
        groups: Object.freeze(Object.fromEntries(ISLAND_GROUPS.map((id) => [id, rows(groups[id])]))),
        lights: Object.freeze({ lighthouse: rows(lights.lighthouse), home: rows(lights.home) }),
        palms: Object.freeze(palms),
        palmFrames: Object.freeze(palmFrames),
        spots: Object.freeze({
            woman: Object.freeze([wX, wY]),
            child: Object.freeze([cX, cY]),
            lamp: Object.freeze([wX + WOMAN_LAMP[0], wY + WOMAN_LAMP[1]]),
            beacon: Object.freeze([L.lighthouse + lh.lamp[0], lhBase + 1 - lh.lamp[1]]),
            chimney: Object.freeze([L.cottage + home.chimney[0], homeBase + 1 - home.chimney[1]]),
        }),
        top: highest,
    });
    return cached;
}

/** ¿Hay tierra (hierba, tierra o roca) en esa celda? */
export function islandLandAt(x, y) {
    const c = islandArt().groups.land[y]?.[x] ?? '.';
    return c !== '.';
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
        const base = art.groups.land[art.waterline][x] !== '.';
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
    const range = {};
    const mark = (ch, y) => {
        const material = ISLAND_INKS[ch]?.[0];
        if (material === undefined) return;
        const r = range[material] ?? (range[material] = [Infinity, -Infinity]);
        r[0] = Math.min(r[0], y);
        r[1] = Math.max(r[1], y);
    };
    for (const id of ISLAND_GROUPS) art.groups[id].forEach((r, y) => { for (const ch of new Set(r)) mark(ch, y); });
    for (const p of art.palms) art.palmFrames[p.kind][0].forEach((r, j) => { for (const ch of new Set(r)) mark(ch, p.y + j); });
    spans = Object.freeze(Object.fromEntries(STORY_SOLID_MATERIALS.map((key) => {
        const [topRow, bottomRow] = range[key];
        return [key, Object.freeze([(art.waterline - bottomRow) * STORY_CELL, (art.waterline + 1 - topRow) * STORY_CELL])];
    })));
    return spans;
}
