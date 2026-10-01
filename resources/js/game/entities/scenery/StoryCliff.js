// Capa `storyCliff` del escenario (T02.6): el cabo de una historia de autor, con
// ella en lo alto mirando al mar.
//
// Una cumbre redondeada con hierba y la pared hacia el mar, un poco más cerca que
// el horizonte (su pie está en el agua, con la espuma de las olas). Encima, su
// silueta con el viento del mar en el pelo y la falda y el farol en la mano;
// desde "Diez años después", el hijo a su lado. De noche el farol arde (y se
// refleja en el agua) y se aviva cuando vuelve el barco.
//
// Su pista en la historia (scenes/stories/) dice dónde está (se aleja muy
// despacio: está lejos), cuándo aparece el hijo y cuánto arde el farol, por la
// HORA del cielo. A media celda (storyArt.js): la roca y la hierba se tiñen con
// la luz de la hora y llevan el filo del sol bajo o de la luna en la pared del
// mar y en la cima; las figuras son siluetas con ese mismo filo. Se carga bajo
// demanda con la escena.

import { Container, Sprite, Texture } from 'pixi.js';
import { artTexture } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { trackAt } from '../../scenes/stories/index.js';
import { hash01 } from './ridgeShape.js';
import {
    CHILD_ROWS, CLIFF_GRASS_ROWS, CLIFF_ROWS, CLIFF_SINK, CLIFF_SPOTS, CLIFF_WATERLINE, STORY_CELL, WOMAN_ROWS,
    createStoryColors, materialRows, rimRows, storyColors, surfRows,
} from './storyArt.js';
import { createStoryLamp } from './storyLamp.js';

const S = STORY_CELL;
/** El viento: cada cuánto cambia el fotograma del pelo y la falda (ella y el hijo). */
const WIND = Object.freeze({ womanS: 0.38, childS: 0.5, order: Object.freeze([0, 1, 2, 1]), childOrder: Object.freeze([0, 1]) });
/** La espuma al pie: cada cuánto rompe (cambia de fotograma). */
const SURF_FRAME_S = 0.7;
/** El reflejo del farol en el agua: filas, cada cuánto titila y su brillo. */
const REFLECT = Object.freeze({ rows: 7, frameS: 0.16, alpha: 0.55, color: 0xffc070 });
/** El farol: el diámetro de su aura y la luz que pone en el filo de las figuras. */
const LANTERN = Object.freeze({ aura: 64, rimColor: [1, 0.78, 0.45], rimAlpha: 0.9 });

/**
 * @param {{ id: string, params: { tracks: Record<string, Array<[number, number]>> } }} def
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number, still?: boolean }} view
 */
export function createStoryCliffLayer(def, view) {
    const { tracks } = def.params;
    const rise = view.horizonRise ?? 0;
    const still = view.still === true;
    const container = new Container({ label: def.id });

    const artW = CLIFF_ROWS[0].length * S;
    // La roca (cuerpo, vetas y grietas), la hierba y sus filos de luz.
    const rock = new Sprite(artTexture('story:cliffRock', materialRows(CLIFF_ROWS, { o: 'o', O: 'O', q: 'q' })));
    const grass = new Sprite(artTexture('story:cliffGrass', materialRows(CLIFF_GRASS_ROWS, { G: 'O' })));
    const solid = CLIFF_ROWS.map((r, y) => [...r].map((c, x) => (c !== '.' || CLIFF_GRASS_ROWS[y][x] !== '.' ? 'Q' : '.')).join(''));
    const rimSide = new Sprite(artTexture('story:cliffRimSide', rimRows(solid, 1)));
    const rimTop = new Sprite(artTexture('story:cliffRimTop', rimRows(solid, 1, { top: true })));
    // La espuma al pie, dos fotogramas, y el agua (en la fila de debajo de la base).
    const surfTex = [0, 1].map((f) => artTexture(`story:cliffSurf${f}`, surfRows(f)));
    const surf = new Sprite(surfTex[0]);
    for (const sp of [rock, grass, rimSide, rimTop, surf]) sp.scale.set(S);
    surf.y = (CLIFF_WATERLINE - 1) * S;

    // Las figuras (con los pies en la cumbre), con su filo de luz.
    const figures = new Container({ label: 'storyFigures' });
    const figure = (key, frames, spot) => {
        const tex = frames.map((rows, i) => artTexture(`story:${key}${i}`, rows));
        const rimTex = frames.map((rows, i) => artTexture(`story:${key}Rim${i}`, rimRows(rows, 1)));
        const body = new Sprite(tex[0]);
        const rim = new Sprite(rimTex[0]);
        for (const sp of [body, rim]) {
            sp.scale.set(S);
            sp.position.set(spot[0] * S, spot[1] * S);
        }
        figures.addChild(body, rim);
        return { body, rim, tex, rimTex, frame: 0, t: 0 };
    };
    const child = figure('child', CHILD_ROWS, CLIFF_SPOTS.child);
    const woman = figure('woman', WOMAN_ROWS, CLIFF_SPOTS.woman);

    const lantern = createStoryLamp({ still, flickerHz: 2.3, cell: S, aura: LANTERN.aura });
    lantern.container.position.set(CLIFF_SPOTS.lamp[0] * S, CLIFF_SPOTS.lamp[1] * S);

    // El farol en el agua: filas de luz bajo él que titilan (en coordenadas del cabo).
    const reflection = new Container({ label: 'storyLanternReflection' });
    const reflectRows = [];
    for (let n = 0; n < REFLECT.rows; n++) {
        const sp = new Sprite(Texture.WHITE);
        sp.tint = REFLECT.color;
        sp.blendMode = 'add';
        sp.height = S;
        reflectRows.push(sp);
        reflection.addChild(sp);
    }
    container.addChild(rock, grass, rimSide, rimTop, surf, reflection, figures, lantern.container);

    let W = view.width;
    let horizonY = view.groundY - rise;
    let hour = null;
    let lamp = 0;
    let flare = 0;
    let lanternOn = true;
    let surfT = 0;
    let surfFrame = 0;
    let reflectT = 0;
    let reflectFrame = 0;
    const tints = { rock: -1, grass: -1, rim: -1, figRim: -1, surf: -1 };
    const colors = createStoryColors();
    const figRim = [0, 0, 0];

    function place() {
        if (hour === null) return;
        container.x = Math.round(trackAt(tracks.x, hour) * W - artW / 2);
        container.y = Math.round(horizonY + CLIFF_SINK - (CLIFF_WATERLINE + 1) * S);
        const withChild = trackAt(tracks.child, hour) >= 0.5;
        child.body.visible = child.rim.visible = withChild;
    }

    /** El reflejo del farol: guiones bajo él, más anchos y separados cuanto más cerca. */
    function placeReflection() {
        const k = lanternOn ? lamp : 0;
        reflection.visible = k > 0.02 && !still;
        if (!reflection.visible) return;
        const cx = CLIFF_SPOTS.lamp[0] * S;
        const y0 = (CLIFF_WATERLINE + 1.5) * S;
        for (let n = 0; n < reflectRows.length; n++) {
            const sp = reflectRows[n];
            const h = hash01(n * 31 + reflectFrame, 71);
            const depth = (n + 1) / reflectRows.length;
            const w = Math.max(S, Math.round((1 + 3 * depth) * (0.6 + 0.7 * hash01(n + reflectFrame * 5, 72))) * S);
            sp.visible = h < 0.85;
            sp.width = w;
            sp.x = Math.round((cx - w / 2 + (hash01(n * 7 + reflectFrame, 73) - 0.5) * 2 * S) / S) * S;
            sp.y = y0 + n * S * (1 + depth);
            sp.alpha = REFLECT.alpha * k * (1 - 0.5 * depth) * (1 + 0.6 * flare);
        }
    }

    function tickFigure(f, dt, frameS, order) {
        f.t += dt;
        if (f.t < frameS) return;
        f.t -= frameS;
        f.frame = (f.frame + 1) % order.length;
        const i = order[f.frame] % f.tex.length;
        f.body.texture = f.tex[i];
        f.rim.texture = f.rimTex[i];
    }

    function setTint(key, sprites, rgb) {
        const n = rgbToNumber(rgb);
        if (n === tints[key]) return;
        tints[key] = n;
        for (const sp of sprites) sp.tint = n;
    }

    return {
        container,
        tick(dt) {
            if (!still) {
                tickFigure(woman, dt, WIND.womanS, WIND.order);
                tickFigure(child, dt, WIND.childS, WIND.childOrder);
                surfT += dt;
                if (surfT >= SURF_FRAME_S) {
                    surfT -= SURF_FRAME_S;
                    surfFrame = 1 - surfFrame;
                    surf.texture = surfTex[surfFrame];
                }
                reflectT += dt;
                if (reflectT >= REFLECT.frameS) {
                    reflectT -= REFLECT.frameS;
                    reflectFrame = (reflectFrame + 1) % 997;
                    placeReflection();
                }
            }
            lantern.tick(dt);
        },
        resize(width, height, groundY) {
            W = width;
            horizonY = groundY - rise;
            place();
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            hour = state.hour;
            storyColors(state, colors);
            setTint('rock', [rock], colors.rock);
            setTint('grass', [grass], colors.grass);
            setTint('rim', [rimSide, rimTop], state.mountains.rim);
            setTint('surf', [surf], state.sea.crest);
            const ra = Math.round(state.mountains.rimAmt * 100) / 100;
            rimSide.alpha = ra;
            rimTop.alpha = Math.round(ra * 0.45 * 100) / 100;
            // El filo de las figuras: la luz del cielo o, de noche, la del farol.
            const lit = lanternOn ? trackAt(tracks.lantern, hour) : 0;
            for (let i = 0; i < 3; i++) figRim[i] = state.mountains.rim[i] + (LANTERN.rimColor[i] - state.mountains.rim[i]) * lit;
            setTint('figRim', [woman.rim, child.rim], figRim);
            woman.rim.alpha = child.rim.alpha = Math.round(Math.max(ra * 0.8, lit * LANTERN.rimAlpha) * 100) / 100;
            surf.alpha = Math.round((0.3 + 0.6 * state.sea.crestAmt) * 100) / 100;
            const nextLamp = trackAt(tracks.lantern, hour);
            const nextFlare = trackAt(tracks.flare, hour);
            const changed = nextLamp !== lamp || nextFlare !== flare;
            lamp = nextLamp;
            flare = nextFlare;
            place();
            lantern.set(lanternOn ? lamp : 0, flare);
            if (changed) placeReflection();
        },
        setVisible(id, on) {
            if (id === def.id) container.renderable = on;
            else if (id === 'storyFigures') figures.visible = on;
            else if (id === 'storyLantern') {
                lanternOn = on;
                lantern.set(lanternOn ? lamp : 0, flare);
                placeReflection();
            }
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
