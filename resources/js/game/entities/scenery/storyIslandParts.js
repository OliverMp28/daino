// Las piezas de la isla de One Day (T02.6): el faro, la casa, los árboles, las
// palmeras, los arbustos y el bote. Cada una es un dibujo pequeño hecho con
// código (determinista) que storyIsland.js coloca sobre el terreno.
//
// Cada carácter es una TINTA: un material de storyArt.js (la hora lo tiñe) y uno
// de sus tres tonos. La luz viene de la derecha (del mar, donde está el sol): lo
// que mira a la derecha va en el tono claro y lo de la izquierda en el oscuro.
// 'L' es una luz (ventana, linterna) que se enciende al anochecer. Puro y sin Pixi.

/**
 * Tintas del dibujo: carácter → [material, tono]. Los tonos son los grises con
 * que se pinta el sprite del material (O entero, o medio, q oscuro: assets/palette.js).
 */
export const ISLAND_INKS = Object.freeze({
    R: ['rock', 'O'], r: ['rock', 'o'], x: ['rock', 'q'],
    E: ['earth', 'O'], e: ['earth', 'o'], y: ['earth', 'q'],
    G: ['grass', 'O'], g: ['grass', 'o'], h: ['grass', 'q'],
    P: ['leaf', 'O'], p: ['leaf', 'o'], j: ['leaf', 'q'],
    T: ['wood', 'O'], t: ['wood', 'o'], u: ['wood', 'q'],
    W: ['wall', 'O'], w: ['wall', 'o'], v: ['wall', 'q'],
    F: ['roof', 'O'], f: ['roof', 'o'], z: ['roof', 'q'],
    A: ['tower', 'O'], a: ['tower', 'o'],
    B: ['band', 'O'], b: ['band', 'o'],
    D: ['dark', 'O'], d: ['dark', 'o'],
});

/** Por material, qué carácter del dibujo va con qué tono (para pintar su sprite). */
export const ISLAND_MATERIAL_MAPS = Object.freeze(Object.entries(ISLAND_INKS).reduce((out, [ch, [material, tone]]) => {
    (out[material] ?? (out[material] = {}))[ch] = tone;
    return out;
}, {}));

export const hash = (i, s) => {
    let x = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
};
export const hash2 = (x, y, s) => hash(Math.imul(x | 0, 7919) + Math.imul(y | 0, 104729), s);
export const smooth = (i, s, step) => {
    const a = Math.floor(i / step);
    const t = i / step - a;
    const u = t * t * (3 - 2 * t);
    return hash(a, s) * (1 - u) + hash(a + 1, s) * u;
};
/** Ruido de valor en dos dimensiones, [0,1): manchas de hierba, sombras de la roca. */
export const noise2 = (x, y, s, stepX, stepY = stepX) => {
    const xi = Math.floor(x / stepX);
    const yi = Math.floor(y / stepY);
    const tx = x / stepX - xi;
    const ty = y / stepY - yi;
    const u = tx * tx * (3 - 2 * tx);
    const v = ty * ty * (3 - 2 * ty);
    return (hash2(xi, yi, s) * (1 - u) + hash2(xi + 1, yi, s) * u) * (1 - v) + (hash2(xi, yi + 1, s) * (1 - u) + hash2(xi + 1, yi + 1, s) * u) * v;
};
export const sm = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Hoja de dibujo: `up` cuenta filas desde la de abajo (la que apoya en el suelo). */
export function sheet(w, h) {
    const g = Array.from({ length: h }, () => new Array(w).fill('.'));
    const api = {
        w, h,
        put(x, up, c) {
            const y = h - 1 - up;
            if (x >= 0 && x < w && y >= 0 && y < h) g[y][x] = c;
            return api;
        },
        get(x, up) {
            const y = h - 1 - up;
            return x >= 0 && x < w && y >= 0 && y < h ? g[y][x] : '.';
        },
        box(x0, up0, x1, up1, c) {
            for (let u = up0; u <= up1; u++) for (let x = x0; x <= x1; x++) api.put(x, u, c);
            return api;
        },
        rows() {
            return Object.freeze(g.map((r) => r.join('')));
        },
    };
    return api;
}

/**
 * El faro: remate, linterna, galería y una torre que se ensancha, a franjas, sobre
 * un zócalo de piedra. El lado de tierra va en sombra (es redondo).
 *
 * @returns {{ rows: ReadonlyArray<string>, light: ReadonlyArray<string>, lamp: [number, number] }}
 *          `lamp`: el centro de la linterna (x, filas desde abajo).
 */
export function lighthouseRows() {
    const w = 20;
    const body = 36;
    const h = body + 14;
    const s = sheet(w, h);
    const light = sheet(w, h);
    const span = (up, width, ink) => {
        const x0 = Math.floor((w - width) / 2);
        for (let x = x0; x < x0 + width; x++) s.put(x, up, typeof ink === 'function' ? ink(x - x0, width) : ink);
    };
    span(0, 20, 'a');
    span(1, 18, 'a');
    for (let j = 0; j < body; j++) {
        const up = 2 + j;
        const width = 14 - Math.round((6 * j) / (body - 1));
        const band = Math.floor((body - 1 - j) / 6) % 2 === 1;
        span(up, width + (width % 2), (i, n) => {
            const shade = i < Math.max(2, Math.round(n * 0.3));
            return band ? (shade ? 'b' : 'B') : (shade ? 'a' : 'A');
        });
    }
    // La puerta y dos ventanucos.
    s.box(9, 2, 10, 6, 'D');
    s.put(10, 17, 'D').put(9, 29, 'D');
    // Galería, linterna y remate.
    span(body + 2, 10, 'D');
    span(body + 3, 12, 'D');
    for (let k = 0; k < 5; k++) {
        span(body + 4 + k, 8, 'D');
        for (let x = 7; x <= 12; x++) light.put(x, body + 4 + k, 'L');
    }
    span(body + 9, 10, 'D');
    span(body + 10, 8, 'D');
    span(body + 11, 4, 'D');
    span(body + 12, 2, 'D');
    return { rows: s.rows(), light: light.rows(), lamp: [10, body + 6.5] };
}

/**
 * La casa: no una caja con tejado. Un cuerpo principal de piedra encalada con
 * tejado a cuatro aguas, chimenea de piedra y una buhardilla; un cobertizo
 * adosado a la izquierda con su leñera; y un porche a la derecha, mirando al mar,
 * con su farol. Ventanas con contraventanas y cruceta.
 *
 * @returns {{ rows: ReadonlyArray<string>, light: ReadonlyArray<string>, chimney: [number, number] }}
 *          `chimney`: la boca de la chimenea (x, filas desde abajo).
 */
export function cottageRows() {
    const w = 62;
    const h = 33;
    const s = sheet(w, h);
    const light = sheet(w, h);
    /** Ventana con cruceta: los cuatro cristales se encienden. */
    const window = (x0, up0, cols, rows) => {
        s.box(x0, up0, x0 + cols - 1, up0 + rows - 1, 'D');
        const mx = x0 + (cols >> 1);
        const my = up0 + (rows >> 1);
        for (let u = up0; u < up0 + rows; u++) {
            for (let x = x0; x < x0 + cols; x++) if ((cols < 3 || x !== mx) && (rows < 3 || u !== my)) light.put(x, u, 'L');
        }
    };

    // La leñera: troncos apilados contra el cobertizo.
    for (let u = 0; u <= 3; u++) {
        for (let x = 1 + (u === 3 ? 1 : 0); x <= 5; x++) s.put(x, u, (x + u) % 2 === 0 ? 'T' : 'u');
    }

    // El cobertizo: tejado a un agua que sube hacia la casa.
    for (let x = 6; x <= 18; x++) {
        const roof = 8 + Math.round(((x - 6) * 5) / 12);
        if (x >= 7) for (let u = 0; u < roof; u++) s.put(x, u, u <= 1 ? 'v' : 'w');
        s.put(x, roof, 'f').put(x, roof + 1, 'F');
    }
    s.box(10, 2, 12, 7, 't').box(10, 7, 12, 7, 'u').put(12, 4, 'T');
    window(15, 5, 2, 2);

    // El cuerpo principal: zócalo de piedra, muro encalado y esquinas de madera.
    s.box(19, 0, 48, 1, 'v').box(19, 2, 48, 13, 'W').box(19, 13, 48, 13, 'w');
    s.box(19, 2, 19, 12, 'w').box(48, 2, 48, 12, 'T').box(20, 2, 20, 12, 't');
    for (const x0 of [23, 32]) {
        s.box(x0 - 1, 4, x0 + 5, 4, 'v');
        s.box(x0 - 1, 5, x0 - 1, 9, 't').box(x0 + 5, 5, x0 + 5, 9, 't');
        window(x0, 5, 5, 5);
    }
    s.box(40, 2, 44, 10, 't').box(40, 2, 40, 10, 'u').box(40, 10, 44, 10, 'u').put(43, 5, 'T');
    window(42, 8, 2, 2);

    // El tejado, a cuatro aguas: hileras de teja, el faldón de tierra en sombra.
    for (let u = 14; u <= 25; u++) {
        const k = (u - 14) / 11;
        const x0 = Math.round(17 + 8 * k);
        const x1 = Math.round(50 - 8 * k);
        for (let x = x0; x <= x1; x++) {
            let ink = (u - 14) % 3 === 0 ? 'f' : 'F';
            if (u === 14) ink = 'z';
            else if (x - x0 < 4 - Math.round(2 * k)) ink = 'f';
            else if (x === x1) ink = 'F';
            s.put(x, u, ink);
        }
    }
    // La chimenea, de piedra.
    s.box(21, 21, 24, 29, 'W').box(21, 21, 21, 29, 'w').box(20, 30, 25, 30, 'v').box(21, 31, 24, 31, 'w');
    // La buhardilla.
    s.box(37, 16, 42, 20, 'W').box(37, 16, 37, 20, 'w');
    s.box(36, 21, 43, 21, 'z').box(37, 22, 42, 22, 'F').box(39, 23, 40, 23, 'F');
    window(39, 17, 2, 3);

    // El porche: tarima, postes, barandilla, tejadillo y un farol colgado.
    s.box(49, 0, 60, 1, 't').box(49, 0, 60, 0, 'u');
    for (let x = 49; x <= 60; x += 2) s.box(x, 2, x, 3, 't');
    s.box(49, 4, 60, 4, 'T');
    s.box(54, 5, 54, 9, 'T').box(60, 2, 60, 9, 'T');
    for (let x = 49; x <= 61; x++) {
        const roof = 12 - Math.round(((x - 49) * 3) / 12);
        s.put(x, roof, 'f').put(x, roof + 1, 'F');
    }
    s.put(57, 9, 'u').put(57, 8, 'D');
    light.put(57, 8, 'L');
    return { rows: s.rows(), light: light.rows(), chimney: [23, 32] };
}

/**
 * Copa de un árbol o un arbusto: lóbulos de hojas (elipses) pintados de atrás
 * adelante, cada uno con su lado de luz y su lado de sombra, y el borde roto.
 *
 * @param {ReturnType<typeof sheet>} s
 * @param {ReadonlyArray<[number, number, number, number]>} lobes  [cx, up, rx, ry]
 * @param {number} seed
 */
function foliage(s, lobes, seed) {
    lobes.forEach(([cx, cu, rx, ry], k) => {
        for (let u = Math.floor(cu - ry - 1); u <= Math.ceil(cu + ry + 1); u++) {
            for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
                const dx = (x - cx) / rx;
                const dy = (u - cu) / ry;
                if (dx * dx + dy * dy > 1 + (hash2(x, u, seed + k) - 0.5) * 0.3) continue;
                const lit = dx * 0.6 + dy * 0.8 + (hash2(x, u, seed + 40) - 0.5) * 0.35;
                s.put(x, u, lit > 0.3 ? 'P' : lit < -0.4 ? 'j' : 'p');
            }
        }
    });
}

/**
 * Un árbol de copa redonda (los que arropan la casa).
 *
 * @param {'big' | 'mid' | 'small'} size
 * @returns {ReadonlyArray<string>}
 */
export function treeRows(size) {
    if (size === 'big') {
        const s = sheet(28, 36);
        s.box(13, 0, 14, 17, 't').box(14, 0, 14, 17, 'T').put(12, 0, 't').put(15, 0, 't');
        for (let k = 0; k < 5; k++) s.put(12 - k, 13 + k, 't').put(15 + k, 14 + k, 'T');
        foliage(s, [[7, 20, 6.5, 5.5], [20, 21, 6.5, 5.5], [13.5, 27, 8, 7], [10, 23, 6, 5], [18, 25, 6, 5.5], [5, 17, 4, 3], [22.5, 17, 4, 3]], 3);
        return s.rows();
    }
    if (size === 'mid') {
        const s = sheet(22, 30);
        s.box(10, 0, 11, 14, 't').box(11, 0, 11, 14, 'T').put(9, 0, 't');
        for (let k = 0; k < 4; k++) s.put(9 - k, 11 + k, 't').put(12 + k, 12 + k, 'T');
        foliage(s, [[6, 17, 5.5, 4.5], [15.5, 18, 5.5, 4.5], [10.5, 23, 6.5, 5.5], [11, 19, 5, 4]], 11);
        return s.rows();
    }
    const s = sheet(16, 22);
    s.box(7, 0, 8, 10, 't').box(8, 0, 8, 10, 'T');
    foliage(s, [[5, 12, 4.5, 3.5], [11, 13, 4.5, 3.5], [8, 17, 5, 4], [8, 13, 4, 3]], 19);
    return s.rows();
}

/**
 * Un arbusto: copa baja, sin tronco.
 *
 * @param {0 | 1 | 2} kind
 * @returns {ReadonlyArray<string>}
 */
export function bushRows(kind) {
    const shapes = [
        { w: 13, h: 7, lobes: [[3.5, 2, 3, 2.4], [9, 2, 3.5, 2.4], [6.5, 3.6, 3.5, 2.6]] },
        { w: 9, h: 5, lobes: [[2.5, 1.4, 2.4, 1.8], [6, 1.8, 2.6, 2.2]] },
        { w: 17, h: 8, lobes: [[4, 2, 3.6, 2.5], [12.5, 2, 3.8, 2.5], [8.5, 3.2, 4.2, 3.2], [8, 1.2, 4, 1.6]] },
    ];
    const { w, h, lobes } = shapes[kind];
    const s = sheet(w, h);
    foliage(s, lobes, 50 + kind * 7);
    return s.rows();
}

/** Formas de palmera: alto del tronco y cuánto se inclina (negativo, hacia tierra). */
export const PALM_KINDS = Object.freeze({
    tall: Object.freeze({ trunk: 30, lean: -6 }),
    mid: Object.freeze({ trunk: 25, lean: 5 }),
    short: Object.freeze({ trunk: 19, lean: -3 }),
});

/** Ancho del dibujo de una palmera y columna donde apoya su tronco. */
export const PALM_SHEET = Object.freeze({ width: 44, margin: 12 });

/**
 * Una palmera: tronco curvo de dos píxeles con anillos, cocos y hojas que se
 * arquean y cuelgan, con sus foliolos. `sway` las mece (el viento del mar).
 *
 * @param {keyof typeof PALM_KINDS} kind
 * @param {number} sway
 * @returns {{ rows: ReadonlyArray<string>, foot: number }}  `foot`: columna del pie del tronco.
 */
export function palmRows(kind, sway) {
    const { trunk, lean } = PALM_KINDS[kind];
    const w = PALM_SHEET.width;
    const h = trunk + PALM_SHEET.margin;
    const s = sheet(w, h);
    const foot = Math.round(w / 2 - lean / 2);
    const trunkX = (up) => foot + Math.round(lean * (up / trunk) ** 1.7);
    for (let up = 0; up <= trunk; up++) {
        const x = trunkX(up);
        const ring = up % 3 === 2;
        s.put(x, up, ring ? 'u' : 't').put(x + 1, up, ring ? 't' : 'T');
        if (up < 2) s.put(x - 1, up, 't').put(x + 2, up, 't');
    }
    const cx = trunkX(trunk);
    const cu = trunk;
    // Hojas: [hasta dónde llega la punta en x, cuánto sube o baja, cuánto se arquea].
    // Cada una sale del cogollo, sube y cae (una curva de Bézier), con sus foliolos.
    const fronds = [[-15, -6, 6], [-13, 2, 5], [-7, 7, 3], [1, 9, 1], [8, 7, 3], [14, 1, 5], [15, -7, 6], [-8, -9, 3], [9, -10, 3]];
    for (const [dx, du, lift] of fronds) {
        const ex = dx + Math.sign(dx) * sway;
        const eu = du - Math.abs(sway) * 0.5;
        const kx = ex * 0.4;
        const ku = Math.max(eu, 0) + lift;
        const steps = Math.ceil((Math.abs(ex) + Math.abs(eu) + lift) * 1.5);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Math.round(cx + 0.5 + 2 * t * (1 - t) * kx + t * t * ex);
            const u = Math.round(cu + 2 * t * (1 - t) * ku + t * t * eu);
            s.put(x, u, 'P');
            // Foliolos colgando del nervio: más largos a media hoja.
            const len = Math.round(2.6 * Math.sin(Math.min(1, t * 1.15) * Math.PI));
            for (let k = 1; k <= len; k++) if (s.get(x, u - k) === '.') s.put(x, u - k, k === len && len > 1 ? 'j' : 'p');
        }
    }
    // El cogollo y los cocos.
    s.put(cx, cu, 'j').put(cx + 1, cu, 'p').put(cx - 1, cu - 1, 'u').put(cx + 2, cu - 2, 'u').put(cx, cu - 2, 'u');
    return { rows: s.rows(), foot };
}

/** El bote, varado en la orilla, con un remo apoyado. */
export function boatRows() {
    return Object.freeze([
        '............T..',
        'T..........T..T',
        'tTTTTTTTTTTTTTt',
        '.tttttttttttt..',
        '..uuuuuuuuuu...',
    ]);
}

/** Un tramo de cerca rústica: postes y dos travesaños. */
export function fenceRows(length) {
    const s = sheet(length, 5);
    for (let x = 0; x < length; x++) {
        s.put(x, 1, 't').put(x, 3, 't');
        if (x % 5 === 0) s.box(x, 0, x, 4, 'T');
    }
    return s.rows();
}
