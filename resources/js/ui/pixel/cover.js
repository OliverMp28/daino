// La portada de un nivel: una miniatura del sitio donde se juega (T04, doc 12).
//
// Antes, todas las portadas eran el mismo adorno (un sol con rendijas y unas barras)
// con otro color. Ahora cada una enseña lo que hay: el ESCENARIO del nivel (la
// Cordillera, la Costa, la Ciudad…) a una hora del cielo, dibujado con las mismas
// piezas que pinta el juego —el modelo del cielo, la forma real de las crestas y de
// los edificios, la paleta del suelo—, en celdas grandes, como una postal.
//
// Puro: devuelve un búfer RGBA de una celda por píxel. En el navegador lo convierte
// en imagen pixel/coverImage.js; los tests lo miran sin DOM.
//
// Un tipo de capa nuevo en una escena no rompe nada: si no tiene pintor aquí, la
// portada sale sin esa capa. Para que salga, una entrada en COVER_PAINTERS.

import { GROUND_OFFSET_PX, PIXEL_SCALE, WORLD_VIEW } from '../../game/config.js';
import { PALETTE } from '../../game/assets/palette.js';
import { SPRITES } from '../../game/assets/sprites.js';
import { hexToRgb } from '../../game/scenes/color.js';
import { createSkyState, seaColorAt, skyColorAt, skyStateAt } from '../../game/scenes/skyModel.js';
import { hash01, ridgeHeights } from '../../game/entities/scenery/ridgeShape.js';
import { WINDOW_STEPS, buildingWindows, skylineBuildings } from '../../game/entities/scenery/skylineShape.js';

/** Medidas de la portada, en celdas. */
export const COVER = Object.freeze({
    /** Ancho del dibujo: más que cualquier tarjeta, que enseña la parte que le cabe. */
    cols: 240,
    /** Alto: la pantalla entera del juego, del cielo de arriba al suelo. */
    rows: 72,
    /** Ancho de la vista del juego dentro del dibujo: ahí caen el sol y la luna. */
    viewCols: 128,
    /** Filas del suelo (la línea y la tierra). */
    groundRows: 3,
    /** Alto de cada franja del cielo; las dos últimas filas se tramán con la siguiente. */
    bandRows: 6,
    /** El paisaje, más alto que a escala: en una miniatura, a escala no se vería. */
    landScale: 1.6,
});

/** Unidades de mundo por celda de la portada. */
const K = WORLD_VIEW.targetHeight / COVER.rows;

const tmp = [0, 0, 0];

/**
 * @typedef {object} CoverCtx
 * @property {Uint8ClampedArray} data
 * @property {number} cols
 * @property {number} rows
 * @property {number} groundRow   Primera fila del suelo.
 * @property {number} horizonRow  Fila del horizonte del cielo (el mar empieza aquí).
 * @property {number} viewX       Columna donde empieza la vista del juego.
 * @property {number} pan         Desplazamiento del paisaje, en celdas (variedad entre niveles).
 * @property {ReturnType<typeof createSkyState>} state
 * @property {import('../../game/scenes/registry.js').SceneDef} scene
 */

/**
 * @param {{ scene: import('../../game/scenes/registry.js').SceneDef, hour: number, pan?: number }} spec
 * @returns {{ cols: number, rows: number, data: Uint8ClampedArray, top: number[] }}
 *          `top`: el color de lo alto del cielo (lo que se ve si la caja es más alta).
 */
export function renderCover({ scene, hour, pan = 0 }) {
    const { cols, rows } = COVER;
    const state = skyStateAt(hour, scene, createSkyState());
    const groundRow = rows - COVER.groundRows;
    const horizonRow = groundRow - Math.round(((scene.horizonRise ?? 0) / K) * COVER.landScale);
    /** @type {CoverCtx} */
    const ctx = {
        data: new Uint8ClampedArray(cols * rows * 4),
        cols,
        rows,
        groundRow,
        horizonRow,
        viewX: Math.round((cols - COVER.viewCols) / 2),
        pan: Math.round(pan),
        state,
        scene,
    };
    paintSky(ctx);
    paintStars(ctx);
    paintMoon(ctx);
    paintSun(ctx);
    for (const layer of scene.layers) COVER_PAINTERS[layer.type]?.(ctx, layer);
    return { cols, rows, data: ctx.data, top: Array.from(skyColorAt(state, 0, [0, 0, 0])) };
}

// ---------------------------------------------------------------------------
// Píxeles

/** Pinta una celda (rgb en [0,1]) con opacidad `a`. Fuera del dibujo, nada. */
function put(ctx, x, y, rgb, a = 1) {
    if (x < 0 || y < 0 || x >= ctx.cols || y >= ctx.rows || a <= 0) return;
    const i = (y * ctx.cols + x) * 4;
    const d = ctx.data;
    if (a >= 1 || d[i + 3] === 0) {
        d[i] = rgb[0] * 255;
        d[i + 1] = rgb[1] * 255;
        d[i + 2] = rgb[2] * 255;
    } else {
        d[i] += (rgb[0] * 255 - d[i]) * a;
        d[i + 1] += (rgb[1] * 255 - d[i + 1]) * a;
        d[i + 2] += (rgb[2] * 255 - d[i + 2]) * a;
    }
    d[i + 3] = 255;
}

function mix(a, b, t, out = [0, 0, 0]) {
    for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * t;
    return out;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** [0,1) estable por celda. */
const cellHash = (x, y, seed) => hash01(x * 7919 + y * 104729, seed);

// ---------------------------------------------------------------------------
// El cielo

function paintSky(ctx) {
    const { cols, horizonRow } = ctx;
    const band = COVER.bandRows;
    const count = Math.ceil(horizonRow / band);
    const colors = [];
    for (let b = 0; b <= count; b++) {
        colors.push(Array.from(skyColorAt(ctx.state, Math.min(1, ((b + 0.5) * band) / horizonRow), [0, 0, 0])));
    }
    for (let y = 0; y < horizonRow; y++) {
        const b = Math.floor(y / band);
        const r = y % band;
        for (let x = 0; x < cols; x++) {
            // Trama de la franja con la siguiente: una de cada cuatro celdas en la
            // penúltima fila y una de cada dos en la última.
            let next = false;
            if (r === band - 2) next = (x + b * 2) % 4 === 0;
            else if (r === band - 1) next = (x + b) % 2 === 0;
            put(ctx, x, y, next ? colors[b + 1] : colors[b]);
        }
    }
}

function paintStars(ctx) {
    const vis = ctx.state.stars.vis;
    if (vis < 0.05) return;
    const limit = Math.round(ctx.horizonRow * 0.82);
    for (let y = 0; y < limit; y++) {
        for (let x = 0; x < ctx.cols; x++) {
            const h = cellHash(x, y, 5);
            if (h > 0.016) continue;
            // Las de abajo, más tenues: la neblina del horizonte.
            const fade = 1 - (y / limit) * 0.7;
            put(ctx, x, y, [0.86, 0.9, 1], clamp01(vis * fade * (0.45 + (h / 0.016) * 0.55)));
        }
    }
}

function disc(ctx, cx, cy, r, paint) {
    const r2 = (r + 0.25) * (r + 0.25);
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            if (dx * dx + dy * dy <= r2) paint(x, y, (y + 0.5 - (cy - r)) / (2 * r));
        }
    }
}

function paintSun(ctx) {
    const { sun } = ctx.state;
    const cx = ctx.viewX + sun.pos[0] * COVER.viewCols;
    const cy = sun.pos[1] * ctx.horizonRow;
    const r = Math.max(2.5, sun.radius * COVER.rows);
    if (cy - r > ctx.horizonRow) return;
    // Resplandor: una corona tramada, solo si la hora lo pide.
    const glow = sun.glow[3];
    if (glow > 0.05) {
        disc(ctx, cx, cy, r + 3, (x, y) => {
            if (y < ctx.horizonRow && (x + y) % 2 === 0) put(ctx, x, y, sun.glow, clamp01(glow * 1.4));
        });
    }
    // Del centro claro al borde, en tres franjas.
    disc(ctx, cx, cy, r, (x, y, t) => {
        if (y >= ctx.horizonRow) return;
        put(ctx, x, y, mix(sun.core, sun.edge, t < 0.4 ? 0 : t < 0.7 ? 0.5 : 1, tmp));
    });
}

function paintMoon(ctx) {
    const { moon } = ctx.state;
    const alpha = moon.color[3];
    if (alpha < 0.05) return;
    const cx = ctx.viewX + moon.pos[0] * COVER.viewCols;
    const cy = moon.pos[1] * ctx.horizonRow;
    const r = Math.max(2.5, moon.radius * COVER.rows);
    const mare = [moon.color[0] * 0.72, moon.color[1] * 0.76, moon.color[2] * 0.9];
    disc(ctx, cx, cy, r, (x, y) => {
        if (y >= ctx.horizonRow) return;
        // Los mares: un par de celdas más oscuras, arriba a la izquierda.
        const dark = (x === Math.floor(cx - 1) && y === Math.floor(cy - 1)) || (x === Math.floor(cx) && y === Math.floor(cy + 1));
        put(ctx, x, y, dark ? mare : moon.color, alpha);
    });
}

// ---------------------------------------------------------------------------
// Las capas del paisaje, por tipo (el mismo `type` que en scenes/registry.js)

/** Puntos del periodo de una cresta en la portada. */
const RIDGE_POINTS = 96;

function paintRidge(ctx, layer) {
    const p = layer.params;
    const base = p.anchor === 'horizon' ? ctx.horizonRow : ctx.groundRow;
    const heights = ridgeHeights(RIDGE_POINTS, p);
    const m = ctx.state.mountains;
    const tone = layer.color === 'near' ? m.near : m.far;
    // Nevada, la montaña entera aclara un poco y su filo es nieve.
    const color = layer.snowRim ? mix(tone, ctx.state.arc.snowColor, layer.snowRim * 0.2, [0, 0, 0]) : tone;
    const rim = mix(color, m.rim, clamp01(m.rimAmt * (layer.rim ?? 0)), [0, 0, 0]);
    const snow = layer.snowRim ? mix(tone, ctx.state.arc.snowColor, layer.snowRim, [0, 0, 0]) : null;
    // Cada capa se desplaza distinto: dos niveles no comparten silueta.
    const shift = ctx.pan * (layer.color === 'near' ? 1.7 : 1);
    for (let x = 0; x < ctx.cols; x++) {
        const u = ((x + shift) * K) / p.step;
        const i = ((Math.floor(u) % RIDGE_POINTS) + RIDGE_POINTS) % RIDGE_POINTS;
        const f = u - Math.floor(u);
        const h = heights[i] + (heights[(i + 1) % RIDGE_POINTS] - heights[i]) * f;
        const cells = Math.round((h / K) * COVER.landScale);
        if (cells <= 0) continue;
        for (let k = 0; k < cells; k++) {
            const y = base - cells + k;
            if (y >= ctx.groundRow) break;
            // Arriba, el filo: la nieve (dos celdas en las cumbres) o la luz de la hora.
            let c = color;
            if (snow && k < (cells > 6 ? 2 : 1)) c = snow;
            else if (k === 0) c = rim;
            put(ctx, x, y, c);
        }
    }
}

function paintSea(ctx) {
    const { horizonRow, groundRow, state } = ctx;
    const n = groundRow - horizonRow;
    if (n <= 0 || !ctx.scene.sea) return;
    const sunX = ctx.viewX + state.sun.pos[0] * COVER.viewCols;
    const moonX = ctx.viewX + state.moon.pos[0] * COVER.viewCols;
    for (let y = horizonRow; y < groundRow; y++) {
        const depth = y - horizonRow;
        const color = Array.from(seaColorAt(state, (depth + 0.5) / n, [0, 0, 0]));
        for (let x = 0; x < ctx.cols; x++) {
            put(ctx, x, y, color);
            // Crestas: rayas cortas, más largas cerca de la orilla.
            const run = 2 + Math.floor((depth / n) * 3);
            if (depth % 2 === 1 && cellHash(Math.floor((x + ctx.pan) / run), y, 31) < 0.16) {
                put(ctx, x, y, state.sea.crest, clamp01(state.sea.crestAmt * 0.7));
            }
            // El reflejo del sol y de la luna: rayas sueltas bajo el astro, en filas
            // alternas, que se abren un poco hacia la orilla.
            if (depth % 2 === 0) {
                const spread = 2 + depth * 0.16;
                const broken = cellHash(x, y, 67) < 0.72;
                if (broken && Math.abs(x + 0.5 - sunX) <= spread) put(ctx, x, y, state.sea.sunGlint, clamp01(state.sea.sunGlint[3] * 0.9));
                if (broken && Math.abs(x + 0.5 - moonX) <= spread * 0.7) put(ctx, x, y, state.sea.moonGlint, clamp01(state.sea.moonGlint[3] * 0.9));
            }
        }
    }
}

/** Celdas del arte de un periodo de la ciudad. */
const CITY_PERIOD = 360;

function paintSkyline(ctx, layer) {
    const p = layer.params;
    // De celdas del arte del juego a celdas de la portada.
    const s = PIXEL_SCALE / K;
    const tall = s * COVER.landScale;
    const buildings = skylineBuildings(CITY_PERIOD, p);
    const m = ctx.state.mountains;
    const color = layer.color === 'near' ? m.near : m.far;
    const lit = ctx.state.arc.windows * WINDOW_STEPS;
    const period = CITY_PERIOD * s;
    const shift = ctx.pan * (layer.color === 'near' ? 1.7 : 1);
    for (let off = -Math.ceil(shift / period) * period; off - shift < ctx.cols; off += period) {
        buildings.forEach((b, index) => {
            const x0 = Math.floor(b.x * s + off - shift);
            const x1 = Math.max(x0 + 1, Math.floor((b.x + b.w) * s + off - shift));
            if (x1 < 0 || x0 >= ctx.cols) return;
            const h = Math.max(2, Math.round(b.h * tall));
            for (let x = x0; x < x1; x++) {
                // Remate en escalón: la mitad del edificio, una celda más alta.
                const top = h + (b.roof === 'step' && x - x0 < (x1 - x0) / 2 ? 1 : 0);
                for (let k = 0; k < top; k++) put(ctx, x, ctx.groundRow - 1 - k, color);
            }
            if (b.roof === 'antenna') {
                const ax = Math.floor((x0 + x1) / 2);
                const ah = Math.max(2, Math.round(b.antennaH * tall));
                for (let k = 0; k < ah; k++) put(ctx, ax, ctx.groundRow - 1 - h - k, color);
                if (ctx.state.night > 0.3) put(ctx, ax, ctx.groundRow - 1 - h - ah, [1, 0.3, 0.32]);
            }
            if (lit <= 0) return;
            // Las ventanas: las del juego (su color y el escalón en el que se encienden),
            // una de cada tres columnas y de cada dos filas: a este tamaño, todas
            // juntas serían una mancha.
            for (const w of buildingWindows(b, index, p.seed)) {
                if (w.step >= lit || (w.x - b.x - 1) % 6 !== 0 || (w.y - 2) % 6 !== 0) continue;
                const wx = x0 + Math.floor((w.x - b.x) * s);
                const wy = ctx.groundRow - 1 - Math.floor(w.y * tall);
                if (wx >= x0 && wx < x1 && wy > ctx.groundRow - h) put(ctx, wx, wy, hexToRgb(w.color), p.windowAlpha ?? 1);
            }
        });
    }
}

function paintClouds(ctx, layer) {
    const c = ctx.state.clouds;
    const count = Math.round((layer.params?.count ?? 6) * c.cover);
    if (count <= 0 || c.alpha <= 0.05) return;
    const shapes = [SPRITES.cloud, SPRITES.cloudB];
    const [b0, b1] = layer.params?.band ?? [0.04, 0.24];
    const shade = mix(c.body, c.rimBottom, clamp01(c.rimBottomAmt), [0, 0, 0]);
    const light = mix(c.body, c.rimTop, clamp01(c.rimTopAmt), [0, 0, 0]);
    for (let i = 0; i < count; i++) {
        const rowsArt = shapes[i % shapes.length];
        // A media resolución: una celda de la portada por cada dos del dibujo.
        const w = Math.ceil(rowsArt[0].length / 2);
        const h = Math.ceil(rowsArt.length / 2);
        const x0 = Math.floor(hash01(i, 77 + ctx.pan) * (ctx.cols + w)) - w;
        const y0 = Math.round((b0 + hash01(i, 191) * (b1 - b0)) * ctx.rows);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const ch = rowsArt[y * 2]?.[x * 2] ?? '.';
                if (ch === '.') continue;
                put(ctx, x0 + x, y0 + y, ch === 'N' ? shade : y === 0 ? light : c.body, c.alpha);
            }
        }
    }
}

function paintGround(ctx, layer) {
    const art = SPRITES[layer.params?.sprite ?? 'ground'] ?? SPRITES.ground;
    const tint = ctx.state.ground;
    // La línea del suelo y, debajo, la tierra con sus motas (una fila sí y otra no).
    const rowsArt = [art[1], art[3], art[5]];
    for (let r = 0; r < COVER.groundRows; r++) {
        const row = rowsArt[Math.min(r, rowsArt.length - 1)];
        for (let x = 0; x < ctx.cols; x++) {
            const hex = PALETTE[row[((x + ctx.pan) * 2) % row.length]];
            if (!hex) continue;
            const rgb = hexToRgb(hex);
            put(ctx, x, ctx.groundRow + r, [rgb[0] * tint[0], rgb[1] * tint[1], rgb[2] * tint[2]]);
        }
    }
}

function paintRain(ctx) {
    const { rain, rainColor } = ctx.state.arc;
    if (rain < 0.1) return;
    for (let y = 0; y < ctx.groundRow - 1; y++) {
        for (let x = 0; x < ctx.cols; x++) {
            if (cellHash(x, y, 43) > 0.014 * rain) continue;
            put(ctx, x, y, rainColor, 0.5);
            put(ctx, x - 1, y + 1, rainColor, 0.5);
        }
    }
}

function paintSnow(ctx) {
    const { snow, snowColor } = ctx.state.arc;
    if (snow < 0.05) return;
    for (let y = 0; y < ctx.groundRow; y++) {
        for (let x = 0; x < ctx.cols; x++) {
            if (cellHash(x, y, 59) < 0.009 * snow) put(ctx, x, y, snowColor, 0.85);
        }
    }
}

function paintLighthouse(ctx) {
    const x = ctx.viewX + Math.round(COVER.viewCols * 0.3);
    const base = ctx.horizonRow;
    const body = mix(ctx.state.mountains.far, [1, 1, 1], 0.28, [0, 0, 0]);
    // El cabo y la torre.
    for (let k = -4; k <= 5; k++) put(ctx, x + k, base - 1, ctx.state.mountains.far);
    for (let k = -2; k <= 3; k++) put(ctx, x + k, base - 2, ctx.state.mountains.far);
    for (let k = 0; k < 6; k++) {
        put(ctx, x, base - 3 - k, body);
        put(ctx, x + 1, base - 3 - k, body);
    }
    if (ctx.state.night > 0.25) {
        const lamp = [1, 0.9, 0.62];
        put(ctx, x, base - 9, lamp);
        put(ctx, x + 1, base - 9, lamp);
        // El haz: una raya que se apaga.
        for (let k = 1; k <= 9; k++) put(ctx, x - k, base - 9, lamp, 0.6 - k * 0.06);
    } else {
        put(ctx, x, base - 9, body);
        put(ctx, x + 1, base - 9, body);
    }
}

/** El barco de One Day: una silueta en el horizonte, bajo el sol. */
const SHIP = Object.freeze([
    '....#.....',
    '...##..#..',
    '..###.##..',
    '.####.###.',
    '..###.##..',
    '....#..#..',
    '##########',
    '.########.',
]);

function paintStoryShip(ctx) {
    const sunX = ctx.viewX + ctx.state.sun.pos[0] * COVER.viewCols;
    const x0 = Math.round(sunX - 14);
    const y0 = ctx.horizonRow - SHIP.length + 1;
    const ink = mix(ctx.state.mountains.near, [0, 0, 0], 0.55, [0, 0, 0]);
    SHIP.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === '#') put(ctx, x0 + x, y0 + y, ink);
    });
}

/** La isla de One Day: un cabo a la izquierda, con el farol de quien espera. */
function paintStoryCliff(ctx) {
    const x0 = ctx.viewX + 4;
    const land = mix(ctx.state.mountains.near, [0.05, 0.2, 0.1], 0.35, [0, 0, 0]);
    const width = 40;
    for (let x = 0; x < width; x++) {
        // Sube deprisa desde el mar y cae en pared hacia la derecha.
        const t = x / (width - 1);
        const h = Math.round(4 + 12 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.55));
        for (let k = 0; k < h; k++) put(ctx, x0 + x, ctx.groundRow - 1 - k, land);
        if (x === width - 5) put(ctx, x0 + x, ctx.groundRow - 1 - h, [1, 0.82, 0.45]);
    }
}

/**
 * Qué pinta cada tipo de capa en la portada. Las capas que solo son efecto
 * (`spectrum`, `lightning`) no salen.
 *
 * @type {Record<string, (ctx: CoverCtx, layer: object) => void>}
 */
export const COVER_PAINTERS = Object.freeze({
    ridge: paintRidge,
    sea: paintSea,
    skyline: paintSkyline,
    clouds: paintClouds,
    ground: paintGround,
    rain: paintRain,
    snow: paintSnow,
    lighthouse: paintLighthouse,
    storyShip: paintStoryShip,
    storyCliff: paintStoryCliff,
});
