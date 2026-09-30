// Capa `sea` del escenario (T02.2): el mar de la Costa, del horizonte a la orilla.
//
// Pixel art en BANDAS horizontales, cada una con el color del agua a su distancia
// (scenes/skyModel.js, `seaColorAt`: refleja el cielo, más claro a lo lejos y más
// oscuro en la orilla) y más finas cuanto más lejos, como la perspectiva. Encima:
//   - CRESTAS de las olas ('seaCrests'): filas de guiones de una celda que corren
//     con el mundo, más despacio cuanto más lejos, y cabecean en dos fotogramas.
//   - REFLEJO del sol y de la luna ('seaGlint'): una columna de guiones bajo el
//     astro que titilan, cortos en el horizonte y anchos cerca de la orilla. El
//     del sol se alarga y se enciende con el sol bajo y se apaga cuando se pone.
//
// Es una capa Pixi y no parte del shader: el mar se sigue viendo con
// prefers-reduced-motion (sin shader) y su color es el que mide el guardián de
// legibilidad (scenes/backdrops.js). Se carga bajo demanda con la escena.

import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { artTexture, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { seaColorAt } from '../../scenes/skyModel.js';
import { hash01 } from './ridgeShape.js';

/** Ancho del patrón de crestas, en celdas (se repite). */
const CREST_TILE_CELLS = 96;
/** Cada cuánto cabecean las crestas (alternan su fotograma). */
const CREST_FRAME_S = 0.75;
/** Filas del reflejo de cada astro, cada cuánto titilan y qué parte se ve a la vez. */
const GLINT_ROWS = 18;
const GLINT_FRAME_S = 0.14;
const GLINT_SHOWN = 0.8;

/** Distancia (0 horizonte … 1 orilla) de lo que ocupa la fracción `f` del mar en pantalla. */
const depthAt = (f, k) => Math.pow(f, k);

/**
 * Patrón de crestas de una fila: guiones más largos y más juntos cerca de la
 * orilla. `shift` desplaza el patrón y aclara algún guion: el segundo fotograma.
 */
function crestPattern(depth, seed, shift) {
    const cells = new Array(CREST_TILE_CELLS).fill('.');
    const minLen = 1 + Math.round(depth * 2);
    const maxLen = 2 + Math.round(depth * 5);
    const gap = 7 - Math.round(depth * 3);
    let x = Math.floor(hash01(0, seed) * gap);
    for (let i = 1; x < CREST_TILE_CELLS; i++) {
        const len = minLen + Math.floor(hash01(i, seed) * (maxLen - minLen + 1));
        const skip = shift > 0 && hash01(i + 900, seed) < 0.3;
        if (!skip) {
            for (let k = 0; k < len; k++) cells[(x + k + shift) % CREST_TILE_CELLS] = 'Q';
        }
        x += len + gap + Math.floor(hash01(i + 500, seed) * (gap + 4));
    }
    return [cells.join('')];
}

/**
 * @param {{ id: string, params: { bands: number, crestRows: number, parallax: [number, number] } }} def
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number, still?: boolean }} view
 *   `still` (reduced motion): sin sol ni luna en el cielo, tampoco su reflejo.
 */
export function createSeaLayer(def, view) {
    const { bands: bandCount, crestRows, parallax } = def.params;
    const rise = view.horizonRise ?? 0;
    const container = new Container({ label: def.id });

    const bandsBox = new Container({ label: `${def.id}:bands` });
    const crestsBox = new Container({ label: 'seaCrests' });
    const glintBox = new Container({ label: 'seaGlint' });
    container.addChild(bandsBox, crestsBox, glintBox);

    /** @type {Array<{ g: Graphics, depth: number, tint: number }>} */
    const bands = [];
    for (let i = 0; i < bandCount; i++) {
        const g = new Graphics();
        bands.push({ g, depth: 0, tint: -1 });
        bandsBox.addChild(g);
    }

    /** @type {Array<{ s: TilingSprite, depth: number, parallax: number, textures: Texture[] }>} */
    const crests = [];
    for (let j = 0; j < crestRows; j++) {
        const depth = depthAt((j + 0.6) / crestRows, 1.35);
        const seed = 311 + j * 17;
        const textures = [
            artTexture(`scene:seaCrest:${j}:a`, crestPattern(depth, seed, 0)),
            artTexture(`scene:seaCrest:${j}:b`, crestPattern(depth, seed, 1)),
        ];
        const s = new TilingSprite({ texture: textures[0], width: view.width, height: PIXEL_SCALE });
        s.tileScale.set(PIXEL_SCALE);
        s.tilePosition.x = -Math.floor(hash01(j, 77) * CREST_TILE_CELLS) * PIXEL_SCALE;
        crests.push({ s, depth, parallax: parallax[0] + (parallax[1] - parallax[0]) * Math.pow(depth, 1.2), textures });
        crestsBox.addChild(s);
    }

    /** Reflejo de un astro: filas de guiones que titilan bajo él. */
    function makeGlint(seed) {
        const box = new Container();
        const rows = [];
        for (let n = 0; n < GLINT_ROWS; n++) {
            const s = new Sprite(Texture.WHITE);
            // Luz sobre el agua: suma al color del mar en vez de taparlo.
            s.blendMode = 'add';
            s.visible = false;
            rows.push({ s, depth: depthAt((n + 0.5) / GLINT_ROWS, 1.25), y: 0 });
            box.addChild(s);
        }
        glintBox.addChild(box);
        return { box, rows, seed, x: 0, amount: 0, tint: -1 };
    }
    const sunGlint = makeGlint(19);
    const moonGlint = makeGlint(43);

    let W = view.width;
    let horizonY = 0;
    let seaH = 0;
    let crestFrame = 0;
    let crestT = 0;
    let glintFrame = 0;
    let glintT = 0;
    /** Crestas de la hora (sin contar el interruptor) y lo último aplicado. */
    let crestAmt = 0;
    let crestTint = -1;
    let crestApplied = -1;
    let crestsOn = true;
    let glintOn = view.still !== true;
    const tmp = [0, 0, 0];

    function applyCrests() {
        const amt = crestsOn ? crestAmt : 0;
        crestsBox.visible = amt > 0;
        if (amt === crestApplied) return;
        for (const c of crests) c.s.alpha = amt * (0.45 + 0.55 * c.depth);
        crestApplied = amt;
    }

    /** Múltiplo de celda más cercano: el mar también es pixel art. */
    const snap = (v) => Math.round(v / PIXEL_SCALE) * PIXEL_SCALE;

    function layout(width, groundY) {
        W = width;
        horizonY = groundY - rise;
        // Hasta un poco por debajo del suelo: la tira de arena lo tapa.
        seaH = rise + 8;
        let top = 0;
        for (let i = 0; i < bands.length; i++) {
            const next = i === bands.length - 1 ? seaH : snap(depthAt((i + 1) / bands.length, 1.5) * seaH);
            const b = bands[i];
            b.depth = depthAt((i + 0.5) / bands.length, 1.5);
            b.g.clear().rect(0, horizonY + top, width, Math.max(PIXEL_SCALE, next - top)).fill(0xffffff);
            top = next;
        }
        for (const c of crests) {
            c.s.width = width;
            c.s.y = horizonY + snap(c.depth * rise);
        }
        for (const glint of [sunGlint, moonGlint]) {
            for (const r of glint.rows) r.y = horizonY + snap(r.depth * rise);
            placeGlint(glint);
        }
    }

    /** Coloca el reflejo de un astro para el fotograma vigente. */
    function placeGlint(glint) {
        const on = glintOn && glint.amount > 0.01;
        glint.box.visible = on;
        if (!on) return;
        const cx = glint.x * W;
        for (let n = 0; n < glint.rows.length; n++) {
            const r = glint.rows[n];
            const h = hash01(n * 31 + glintFrame, glint.seed);
            if (h > GLINT_SHOWN) {
                r.s.visible = false;
                continue;
            }
            // Cortos en el horizonte, anchos en la orilla: la estela se abre hacia quien mira.
            const w = snap(PIXEL_SCALE * (2 + 11 * r.depth) * (0.6 + 0.6 * hash01(n + glintFrame * 7, glint.seed + 1)));
            const wobble = (hash01(n * 13 + glintFrame * 3, glint.seed + 2) - 0.5) * (1 + 6 * r.depth) * PIXEL_SCALE;
            r.s.visible = true;
            r.s.x = snap(cx - w / 2 + wobble);
            r.s.y = r.y;
            r.s.width = Math.max(PIXEL_SCALE, w);
            r.s.height = PIXEL_SCALE;
            r.s.alpha = glint.amount * (1 - 0.25 * r.depth) * (0.6 + 0.4 * h / GLINT_SHOWN);
        }
    }

    function setGlint(glint, rgba, x) {
        const tint = rgbToNumber(rgba);
        if (tint !== glint.tint) {
            for (const r of glint.rows) r.s.tint = tint;
            glint.tint = tint;
        }
        const amount = Math.round(rgba[3] * 100) / 100;
        const moved = Math.abs(x - glint.x) * W >= 1;
        if (amount !== glint.amount || moved) {
            glint.amount = amount;
            glint.x = x;
            placeGlint(glint);
        }
    }

    layout(view.width, view.groundY);

    return {
        container,
        tick(dt, worldSpeed) {
            for (const c of crests) {
                c.s.tilePosition.x -= worldSpeed * c.parallax * dt;
                if (c.s.tilePosition.x < -CREST_TILE_CELLS * PIXEL_SCALE) c.s.tilePosition.x += CREST_TILE_CELLS * PIXEL_SCALE;
            }
            crestT += dt;
            if (crestT >= CREST_FRAME_S) {
                crestT -= CREST_FRAME_S;
                crestFrame = 1 - crestFrame;
                for (const c of crests) c.s.texture = c.textures[crestFrame];
            }
            glintT += dt;
            if (glintT >= GLINT_FRAME_S) {
                glintT -= GLINT_FRAME_S;
                glintFrame = (glintFrame + 1) % 997;
                placeGlint(sunGlint);
                placeGlint(moonGlint);
            }
        },
        resize(width, height, groundY) {
            layout(width, groundY);
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            for (const b of bands) {
                const tint = rgbToNumber(seaColorAt(state, b.depth, tmp));
                if (tint !== b.tint) {
                    b.g.tint = tint;
                    b.tint = tint;
                }
            }
            const ct = rgbToNumber(state.sea.crest);
            if (ct !== crestTint) {
                for (const c of crests) c.s.tint = ct;
                crestTint = ct;
            }
            crestAmt = Math.round(state.sea.crestAmt * 100) / 100;
            applyCrests();
            setGlint(sunGlint, state.sea.sunGlint, state.sun.pos[0]);
            setGlint(moonGlint, state.sea.moonGlint, state.moon.pos[0]);
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
            else if (id === 'seaCrests') {
                crestsOn = on;
                applyCrests();
            } else if (id === 'seaGlint') {
                glintOn = on;
                placeGlint(sunGlint);
                placeGlint(moonGlint);
            }
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
