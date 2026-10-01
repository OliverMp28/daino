// Capa `storyCliff` del escenario (T02.6): la isla de una historia de autor, con
// ella en el borde del cabo mirando al mar.
//
// Una costa cercana (storyIsland.js): su pie está en el agua junto a la orilla,
// muy por debajo del horizonte, así que queda delante del mar y todo en ella se
// ve más grande que el barco, que está lejos. Tierra baja con palmeras, la subida
// al cabo, el faro en su loma, la casa con su chimenea y, en el borde, su silueta
// con el viento del mar en el pelo y la falda y el farol en la mano; desde "Diez
// años después", el hijo a su lado. Al anochecer se encienden las ventanas, sale
// humo de la chimenea, el faro gira y su farol arde (y se aviva al volver el barco).
//
// Su pista en la historia (scenes/stories/) dice dónde está el borde del cabo (se
// aleja muy despacio), cuándo aparece el hijo y cuánto arden las luces, por la
// HORA del cielo. Cada material se tiñe con la luz de la hora (storyArt.js) y
// lleva el filo del sol bajo o de la luna. Se carga bajo demanda con la escena.

import { Container, Sprite, Texture } from 'pixi.js';
import { artTexture } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { trackAt } from '../../scenes/stories/index.js';
import { hash01 } from './ridgeShape.js';
import {
    CHILD_ROWS, STORY_CELL, WOMAN_ROWS,
    createStoryColors, materialRows, rimRows, storyColors,
} from './storyArt.js';
import { ISLAND_LIFT, islandArt, islandSurfRows } from './storyIsland.js';
import { createStoryLamp } from './storyLamp.js';

const S = STORY_CELL;
/** El viento: cada cuánto cambian el pelo y la falda, y las hojas de las palmeras. */
const WIND = Object.freeze({
    womanS: 0.38, childS: 0.5, palmS: 0.8,
    order: Object.freeze([0, 1, 2, 1]), pair: Object.freeze([0, 1]),
});
/** La espuma al pie: cada cuánto rompe (cambia de fotograma). */
const SURF_FRAME_S = 0.7;
/** El reflejo del farol en el agua: filas, cada cuánto titila y su brillo. */
const REFLECT = Object.freeze({ rows: 4, frameS: 0.16, alpha: 0.5, color: 0xffc070 });
/** El farol de ella: el diámetro de su aura y la luz que pone en el filo de las figuras. */
const LANTERN = Object.freeze({ aura: 70, rimColor: [1, 0.78, 0.45], rimAlpha: 0.9 });
/** Las ventanas de la casa y la linterna del faro (luz cálida, sumada). */
const WINDOWS = Object.freeze({ color: 0xffc870, alpha: 0.95 });
/**
 * El faro: gira despacio. De lado, un haz que gira se ve alargarse a un lado,
 * encogerse y salir por el otro; cuando apunta a quien mira, la lámpara brilla más.
 */
const BEACON = Object.freeze({ periodS: 7, aura: 80, beamLen: 150, beamH: 10, beamAlpha: 0.2, color: 0xffe2a8 });
/** El humo de la chimenea: bocanadas que suben y se van hacia tierra con el viento. */
const SMOKE = Object.freeze({ count: 7, everyS: 0.9, lifeS: 6, risePxS: 9, driftPxS: -6, alpha: 0.32 });

/** Ancho (píxeles del arte) de cada trozo en que se parte la isla para pintarla. */
const STRIP = 32;

/**
 * Sprites de un material, recortados a lo que pintan. La isla mide 940 × 272 de
 * mundo y casi todo es aire: con un sprite del tamaño entero por material la GPU
 * mezclaba unos 10 megapíxeles transparentes por fotograma (medido: 60 → 50 FPS
 * en una gráfica integrada). Partida en trozos recortados a su contenido pinta
 * solo lo que se ve.
 *
 * @param {string} key
 * @param {ReadonlyArray<string>} rows
 * @param {Record<string, string>} map   Carácter del arte → gris del material.
 * @returns {Sprite[]}
 */
function materialSprites(key, rows, map) {
    const mapped = materialRows(rows, map);
    const width = mapped[0].length;
    const out = [];
    for (let x0 = 0; x0 < width; x0 += STRIP) {
        const x1 = Math.min(width, x0 + STRIP);
        let top = -1;
        let bottom = -1;
        let left = x1;
        let right = x0 - 1;
        for (let y = 0; y < mapped.length; y++) {
            for (let x = x0; x < x1; x++) {
                if (mapped[y][x] === '.') continue;
                if (top < 0) top = y;
                bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
        if (top < 0) continue;
        const crop = mapped.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
        const sp = new Sprite(artTexture(`story:island:${key}:${x0}`, crop));
        sp.scale.set(S);
        sp.position.set(left * S, top * S);
        out.push(sp);
    }
    return out;
}

/** Haz del faro: un degradado horizontal (es luz, no un objeto). Uno para todos. */
let beamTex = null;
function beamTexture() {
    if (beamTex !== null) return beamTex;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 8;
    const g = canvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 8);
    beamTex = Texture.from(canvas);
    return beamTex;
}

/**
 * @param {{ id: string, params: { tracks: Record<string, Array<[number, number]>> } }} def
 * @param {{ width: number, height: number, groundY: number, still?: boolean }} view
 */
export function createStoryCliffLayer(def, view) {
    const { tracks } = def.params;
    const still = view.still === true;
    const container = new Container({ label: def.id });
    const art = islandArt();

    // La tierra y lo construido: sprites por material, recortados a lo que pintan.
    const rock = materialSprites('rock', art.rock, { o: 'O', O: 'o', q: 'q' });
    const grass = materialSprites('grass', art.grass, { G: 'O' });
    const wall = materialSprites('wall', art.house, { w: 'o', W: 'O' });
    const roof = materialSprites('roof', art.house, { r: 'O', R: 'o' });
    const houseDark = materialSprites('houseDark', art.house, { d: 'O' });
    const tower = materialSprites('tower', art.tower, { t: 'O' });
    const band = materialSprites('band', art.tower, { b: 'O' });
    const towerDark = materialSprites('towerDark', art.tower, { g: 'O' });
    const windows = materialSprites('windows', art.houseLight, { L: 'Q' });
    const lanternRoom = materialSprites('lanternRoom', art.towerLight, { L: 'Q' });
    for (const sp of [...windows, ...lanternRoom]) {
        sp.tint = WINDOWS.color;
        sp.blendMode = 'add';
    }
    // El filo de luz: entero en la pared del mar, más tenue en lo alto (un solo
    // material: el de arriba va en el gris oscuro del arte).
    const solid = art.rock.map((r, y) => [...r].map((c, x) => (
        c !== '.' || art.grass[y][x] !== '.' || art.house[y][x] !== '.' || art.tower[y][x] !== '.' ? 'Q' : '.'
    )).join(''));
    const side = rimRows(solid, 1);
    const both = rimRows(solid, 1, { top: true });
    const rim = materialSprites('rim', both.map((r, y) => [...r].map((c, x) => (c === '.' ? '.' : side[y][x] !== '.' ? 'S' : 'T')).join('')), { S: 'O', T: 'q' });
    const surfTex = [0, 1].map((f) => artTexture(`story:island:surf${f}`, islandSurfRows(f)));
    const surf = new Sprite(surfTex[0]);
    surf.scale.set(S);
    surf.y = (art.waterline - 1) * S;

    // Palmeras: tronco y hojas, dos fotogramas que se mecen a destiempo.
    const palmsBox = new Container({ label: 'storyPalms' });
    const palmTex = (kind, mat) => art.palmFrames[kind].map((rows, i) => artTexture(`story:palm:${kind}:${mat}:${i}`, materialRows(rows, mat === 'frond' ? { p: 'O' } : { k: 'O' })));
    const tex = {
        high: { frond: palmTex('high', 'frond'), trunk: palmTex('high', 'trunk') },
        low: { frond: palmTex('low', 'frond'), trunk: palmTex('low', 'trunk') },
    };
    const palms = art.palms.map((p, i) => {
        const kind = p.low ? 'low' : 'high';
        const trunk = new Sprite(tex[kind].trunk[0]);
        const frond = new Sprite(tex[kind].frond[0]);
        for (const sp of [trunk, frond]) {
            sp.scale.set(S);
            sp.position.set(p.x * S, p.y * S);
        }
        palmsBox.addChild(trunk, frond);
        return { trunk, frond, kind, frame: 0, t: i * 0.27 };
    });

    // Las figuras (con los pies en la hierba), con su filo de luz.
    const figures = new Container({ label: 'storyFigures' });
    const figure = (key, frames, spot) => {
        const texs = frames.map((rows, i) => artTexture(`story:${key}${i}`, rows));
        const rimTex = frames.map((rows, i) => artTexture(`story:${key}Rim${i}`, rimRows(rows, 1)));
        const body = new Sprite(texs[0]);
        const rim = new Sprite(rimTex[0]);
        for (const sp of [body, rim]) {
            sp.scale.set(S);
            sp.position.set(spot[0] * S, spot[1] * S);
        }
        figures.addChild(body, rim);
        return { body, rim, tex: texs, rimTex, frame: 0, t: 0 };
    };
    const child = figure('child', CHILD_ROWS, art.spots.child);
    const woman = figure('woman', WOMAN_ROWS, art.spots.woman);

    const lantern = createStoryLamp({ still, flickerHz: 2.3, cell: S, aura: LANTERN.aura });
    lantern.container.position.set(art.spots.lamp[0] * S, art.spots.lamp[1] * S);

    // El faro: la lámpara con su aura y el haz que gira.
    const lighthouse = new Container({ label: 'storyLighthouse' });
    const beacon = createStoryLamp({ still: true, cell: S * 2, aura: BEACON.aura });
    const beam = new Sprite(beamTexture());
    beam.anchor.set(0, 0.5);
    beam.height = BEACON.beamH;
    beam.tint = BEACON.color;
    beam.blendMode = 'add';
    beam.visible = false;
    const beaconPos = [art.spots.beacon[0] * S, art.spots.beacon[1] * S];
    beacon.container.position.set(beaconPos[0], beaconPos[1]);
    beam.position.set(beaconPos[0], beaconPos[1]);
    lighthouse.addChild(...tower, ...band, ...towerDark, ...lanternRoom, beam, beacon.container);

    // La casa, con sus ventanas y el humo de la chimenea.
    const home = new Container({ label: 'storyHouse' });
    const smoke = [];
    const puffTex = artTexture('story:smoke', ['.QQ.', 'QQQQ', 'QQQQ', '.QQ.']);
    for (let i = 0; i < SMOKE.count; i++) {
        const sp = new Sprite(puffTex);
        sp.anchor.set(0.5);
        sp.visible = false;
        smoke.push({ sp, age: -1 });
        home.addChild(sp);
    }
    home.addChild(...wall, ...roof, ...houseDark, ...windows);

    // El farol de ella en el agua: unas filas de luz bajo el cabo que titilan.
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
    const land = new Container({ label: 'storyLand' });
    land.addChild(...rock, ...grass);
    const rimBox = new Container({ label: 'storyRim' });
    rimBox.addChild(...rim);
    container.addChild(land, lighthouse, home, palmsBox, rimBox, surf, reflection, figures, lantern.container);

    let W = view.width;
    let groundY = view.groundY;
    let hour = null;
    let lamp = 0;
    let flare = 0;
    let lights = 0;
    let lanternOn = true;
    let houseOn = true;
    let lighthouseOn = true;
    let surfT = 0;
    let surfFrame = 0;
    let reflectT = 0;
    let reflectFrame = 0;
    let beaconT = 0;
    let smokeT = 0;
    let lastLights = -1;
    const tints = {};
    const colors = createStoryColors();
    const figRim = [0, 0, 0];
    const smokeRgb = [0, 0, 0];

    function place() {
        if (hour === null) return;
        container.x = Math.round(trackAt(tracks.x, hour) * W - art.wall * S);
        container.y = Math.round(groundY - ISLAND_LIFT - art.height * S);
        const withChild = trackAt(tracks.child, hour) >= 0.5;
        child.body.visible = child.rim.visible = withChild;
    }

    /** El reflejo del farol: guiones bajo él, más anchos cuanto más cerca. */
    function placeReflection() {
        const k = lanternOn ? lamp : 0;
        reflection.visible = k > 0.02 && !still;
        if (!reflection.visible) return;
        const cx = (art.wall + 8) * S;
        const y0 = (art.height + 1.5) * S;
        for (let n = 0; n < reflectRows.length; n++) {
            const sp = reflectRows[n];
            const depth = (n + 1) / reflectRows.length;
            const w = Math.max(S, Math.round((2 + 4 * depth) * (0.6 + 0.7 * hash01(n + reflectFrame * 5, 72))) * S);
            sp.visible = hash01(n * 31 + reflectFrame, 71) < 0.85;
            sp.width = w;
            sp.x = Math.round((cx - w / 2 + (hash01(n * 7 + reflectFrame, 73) - 0.5) * 3 * S) / S) * S;
            sp.y = y0 + n * S * 2.5;
            sp.alpha = REFLECT.alpha * k * (1 - 0.4 * depth) * (1 + 0.6 * flare);
        }
    }

    /** Las luces de la casa y del faro (cuánto están encendidas, [0,1]). */
    function applyLights() {
        const k = Math.round(lights * 100) / 100;
        if (k === lastLights) return;
        lastLights = k;
        for (const sp of windows) {
            sp.alpha = WINDOWS.alpha * k;
            sp.visible = k > 0.01;
        }
        for (const sp of lanternRoom) {
            sp.alpha = k;
            sp.visible = k > 0.01;
        }
        if (k <= 0.01) {
            beacon.set(0);
            beam.visible = false;
        }
    }

    /** El faro gira: el haz se alarga hacia un lado, se encoge y sale por el otro. */
    function tickBeacon(dt) {
        if (lights <= 0.01 || !lighthouseOn) return;
        beaconT += dt;
        const a = still ? 0.6 : (beaconT / BEACON.periodS) * Math.PI * 2;
        const side = Math.cos(a);
        const facing = Math.max(0, Math.sin(a));   // 1 cuando apunta a quien mira
        beacon.set(lights * (0.55 + 0.45 * facing));
        beam.visible = !still && Math.abs(side) > 0.08;
        if (beam.visible) {
            beam.scale.x = (side * BEACON.beamLen) / 64;
            beam.alpha = BEACON.beamAlpha * lights * Math.abs(side);
        }
    }

    /** Humo: una bocanada cada poco mientras hay luz en casa; sube, se abre y se apaga. */
    function tickSmoke(dt) {
        const on = houseOn && lights > 0.3 && !still;
        if (on) {
            smokeT += dt;
            if (smokeT >= SMOKE.everyS) {
                smokeT -= SMOKE.everyS;
                const p = smoke.find((x) => x.age < 0);
                if (p) {
                    p.age = 0;
                    p.sp.visible = true;
                    p.sp.position.set((art.spots.chimney[0] + 1) * S, art.spots.chimney[1] * S);
                }
            }
        }
        for (const p of smoke) {
            if (p.age < 0) continue;
            p.age += dt;
            const t = p.age / SMOKE.lifeS;
            if (t >= 1) {
                p.age = -1;
                p.sp.visible = false;
                continue;
            }
            p.sp.x += SMOKE.driftPxS * (0.4 + t) * dt;
            p.sp.y -= SMOKE.risePxS * dt;
            p.sp.scale.set(S * (0.8 + 1.6 * t));
            p.sp.alpha = SMOKE.alpha * Math.sin(Math.PI * Math.min(1, t * 1.1));
        }
    }

    function tickFrames(f, dt, frameS, order) {
        f.t += dt;
        if (f.t < frameS) return false;
        f.t -= frameS;
        f.frame = (f.frame + 1) % order.length;
        return true;
    }

    function setTint(key, sprites, rgb) {
        const n = rgbToNumber(rgb);
        if (n === tints[key]) return;
        tints[key] = n;
        for (const sp of sprites) sp.tint = n;
    }

    const palmFronds = palms.map((p) => p.frond);
    const palmTrunks = palms.map((p) => p.trunk);
    const smokeSprites = smoke.map((p) => p.sp);
    const darkSprites = [...houseDark, ...towerDark];
    const surfSprites = [surf];
    const figRimSprites = [woman.rim, child.rim];

    return {
        container,
        tick(dt) {
            if (!still) {
                if (tickFrames(woman, dt, WIND.womanS, WIND.order)) {
                    const i = WIND.order[woman.frame];
                    woman.body.texture = woman.tex[i];
                    woman.rim.texture = woman.rimTex[i];
                }
                if (tickFrames(child, dt, WIND.childS, WIND.pair)) {
                    child.body.texture = child.tex[child.frame];
                    child.rim.texture = child.rimTex[child.frame];
                }
                for (const p of palms) {
                    if (!tickFrames(p, dt, WIND.palmS, WIND.pair)) continue;
                    p.frond.texture = tex[p.kind].frond[p.frame];
                    p.trunk.texture = tex[p.kind].trunk[p.frame];
                }
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
            tickBeacon(dt);
            tickSmoke(dt);
        },
        resize(width, height, nextGroundY) {
            W = width;
            groundY = nextGroundY;
            place();
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            hour = state.hour;
            storyColors(state, colors);
            setTint('rock', rock, colors.rock);
            setTint('grass', grass, colors.grass);
            setTint('wall', wall, colors.wall);
            setTint('roof', roof, colors.roof);
            setTint('tower', tower, colors.tower);
            setTint('band', band, colors.band);
            setTint('dark', darkSprites, colors.dark);
            setTint('palm', palmFronds, colors.palm);
            setTint('trunk', palmTrunks, colors.trunk);
            setTint('rim', rim, state.mountains.rim);
            setTint('surf', surfSprites, state.sea.crest);
            for (let i = 0; i < 3; i++) smokeRgb[i] = state.clouds.body[i] + (1 - state.clouds.body[i]) * 0.35;
            setTint('smoke', smokeSprites, smokeRgb);
            const ra = Math.round(state.mountains.rimAmt * 100) / 100;
            rimBox.alpha = ra;
            surf.alpha = Math.round((0.3 + 0.6 * state.sea.crestAmt) * 100) / 100;
            const nextLamp = trackAt(tracks.lantern, hour);
            const nextFlare = trackAt(tracks.flare, hour);
            const changed = nextLamp !== lamp || nextFlare !== flare;
            lamp = nextLamp;
            flare = nextFlare;
            lights = Math.max(0, Math.min(1, trackAt(tracks.lights, hour)));
            // El filo de las figuras: la luz del cielo o, de noche, la del farol.
            const lit = lanternOn ? lamp : 0;
            for (let i = 0; i < 3; i++) figRim[i] = state.mountains.rim[i] + (LANTERN.rimColor[i] - state.mountains.rim[i]) * lit;
            setTint('figRim', figRimSprites, figRim);
            woman.rim.alpha = child.rim.alpha = Math.round(Math.max(ra * 0.8, lit * LANTERN.rimAlpha) * 100) / 100;
            place();
            lantern.set(lanternOn ? lamp : 0, flare);
            applyLights();
            if (changed) placeReflection();
        },
        setVisible(id, on) {
            if (id === def.id) container.renderable = on;
            else if (id === 'storyFigures') figures.visible = on;
            else if (id === 'storyPalms') palmsBox.visible = on;
            else if (id === 'storyHouse') {
                houseOn = on;
                home.visible = on;
            } else if (id === 'storyLighthouse') {
                lighthouseOn = on;
                lighthouse.visible = on;
            } else if (id === 'storyLantern') {
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
