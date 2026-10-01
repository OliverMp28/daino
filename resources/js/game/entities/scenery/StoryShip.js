// Capa `storyShip` del escenario (T02.6): el barco de una historia de autor.
//
// Vive siempre en el horizonte: está lejos, así que no crece ni encoge. Se va
// hundiéndose tras la línea del mar (primero el casco, al final la punta del
// palo mayor) y vuelve emergiendo de ella con el agua cayendo de sus velas. La
// capa del mar va delante (registry.js): lo que queda bajo el horizonte no se ve.
//
// Todo lo que hace sale de su pista en la historia (scenes/stories/): dónde está,
// cuánto se ha hundido, hacia dónde mira, el agua y las luces de popa, por la
// HORA del cielo. Nada del audio: el panel dev lo enseña moviendo la hora.
//
// A media celda (storyArt.js), en materiales que tiñe la luz de la hora: velas,
// casco y jarcia, y el filo de luz del sol bajo o de la luna en el costado que da
// a la luz, como las crestas. Cuando navega deja estela. Se carga bajo demanda
// con la escena.

import { Container, Sprite } from 'pixi.js';
import { artTexture } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { trackAt } from '../../scenes/stories/index.js';
import { hash01 } from './ridgeShape.js';
import {
    SHIP_LAMP, SHIP_ROWS, SHIP_WATERLINE, STORY_CELL,
    createStoryColors, materialRows, rimRows, storyColors,
} from './storyArt.js';
import { createStoryLamp } from './storyLamp.js';

const S = STORY_CELL;
/** Agua que cae del barco al emerger: cuántas gotas a la vez y su caída. */
const SPRAY = Object.freeze({ count: 96, perS: 220, gravity: 300, alpha: 0.9 });
/** El agua (espuma, estela y gotas) es la cresta de las olas aclarada: coge la luz. */
const WATER_LIGHT = 0.45;
/** Cabeceo del barco a flote: amplitud en unidades de mundo y periodo. */
const BOB = Object.freeze({ amp: 1.5, periodS: 3.4 });
/** Estela: a qué velocidad (unidades/s) se ve entera, y cada cuánto cambia su espuma. */
const WAKE = Object.freeze({ fullSpeed: 6, frameS: 0.5, alpha: 0.7 });

/** Espuma alrededor del casco al emerger (en píxeles del arte, centrada). */
const FOAM_ROWS = Object.freeze([
    'Q.QQ.Q..QQQ.Q.QQ..Q.QQQ.QQ.Q..QQ.QQQ.Q.QQ..QQ.Q.QQQ.QQ.Q..QQ',
    '.QQQ.QQ.QQ.QQQQ.QQQ.Q.QQQQ.QQ.QQQQ.Q.QQQQ.QQ.QQQQQ.Q.QQQ.QQQ',
]);
/** Estela tras la popa (de la popa hacia atrás, se abre y se apaga). Dos fotogramas. */
const WAKE_ROWS = Object.freeze([
    Object.freeze(['..Q.QQ.QQQ.QQQQQQ', '.....Q..Q.QQ.QQQQ']),
    Object.freeze(['.Q..Q.QQ.QQQ.QQQQ', '...Q...Q..QQ.QQQQ']),
]);

/** Celdas de donde cae el agua al emerger: el borde de abajo de cada vela y la regala. */
function spraySpots() {
    const spots = [];
    const sail = (c) => c === 'O' || c === 'o';
    for (let y = 0; y < SHIP_WATERLINE; y++) {
        for (let x = 0; x < SHIP_ROWS[y].length; x++) {
            const c = SHIP_ROWS[y][x];
            const below = SHIP_ROWS[y + 1]?.[x] ?? '.';
            if ((sail(c) && !sail(below)) || (c === 'q' && y > 0 && SHIP_ROWS[y - 1][x] === '.' && y >= 24)) spots.push([x, y]);
        }
    }
    return spots;
}

/**
 * @param {{ id: string, params: { tracks: Record<string, Array<[number, number]>> } }} def
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number, still?: boolean }} view
 */
export function createStoryShipLayer(def, view) {
    const { tracks } = def.params;
    const rise = view.horizonRise ?? 0;
    const still = view.still === true;
    const container = new Container({ label: def.id });

    const artW = SHIP_ROWS[0].length * S;
    const afloat = SHIP_WATERLINE * S;

    // El barco se voltea entero (proa a la izquierda al volver); dentro, con el
    // origen en la línea de flotación y en el centro.
    const rig = new Container({ label: `${def.id}:rig` });
    const hull = new Sprite(artTexture('story:shipHull', materialRows(SHIP_ROWS, { q: 'O', k: 'q', w: 'q' })));
    const sails = new Sprite(artTexture('story:shipSails', materialRows(SHIP_ROWS, { O: 'O', o: 'o' })));
    const windows = new Sprite(artTexture('story:shipWindows', materialRows(SHIP_ROWS, { w: 'Q' })));
    const silhouette = materialRows(SHIP_ROWS, { O: 'Q', o: 'Q', q: 'Q', k: 'Q', w: 'Q' });
    const rimR = new Sprite(artTexture('story:shipRimR', rimRows(silhouette, 1)));
    const rimL = new Sprite(artTexture('story:shipRimL', rimRows(silhouette, -1)));
    windows.tint = 0xffc870;
    windows.blendMode = 'add';
    for (const sp of [hull, sails, rimR, rimL, windows]) {
        sp.scale.set(S);
        sp.position.set(-artW / 2, -afloat);
    }
    const lamp = createStoryLamp({ still, flickerHz: 3.1, cell: S, aura: 36 });
    lamp.container.position.set(-artW / 2 + SHIP_LAMP[0] * S, -afloat + SHIP_LAMP[1] * S);
    rig.addChild(hull, sails, rimR, rimL, windows, lamp.container);

    // Agua (en coordenadas de la capa): estela, espuma al emerger y gotas.
    const water = new Container({ label: 'storySpray' });
    const wakeTex = WAKE_ROWS.map((rows, i) => artTexture(`story:wake${i}`, rows));
    const wake = new Sprite(wakeTex[0]);
    wake.scale.set(S);
    const foam = new Sprite(artTexture('story:foam', FOAM_ROWS));
    foam.scale.set(S);
    const drops = [];
    const dropTex = artTexture('story:drop', ['Q', 'Q']);
    for (let i = 0; i < SPRAY.count; i++) {
        const sp = new Sprite(dropTex);
        sp.scale.set(S);
        sp.alpha = SPRAY.alpha;
        sp.visible = false;
        water.addChild(sp);
        drops.push({ sp, vy: 0, vx: 0, alive: false });
    }
    water.addChildAt(foam, 0);
    water.addChildAt(wake, 0);
    container.addChild(rig, water);
    const spots = spraySpots();
    const waterSprites = [foam, wake, ...drops.map((d) => d.sp)];

    let W = view.width;
    let horizonY = view.groundY - rise;
    let hour = null;
    let spray = 0;
    let lampLevel = 0;
    let lampOn = true;
    let sprayOn = true;
    let t = 0;
    let spawnAcc = 0;
    let spawnSeq = 0;
    let lastX = null;
    let speed = 0;
    let wakeT = 0;
    let wakeFrame = 0;
    const tints = { hull: -1, sail: -1, rim: -1, water: -1 };
    const colors = createStoryColors();
    const waterRgb = [0, 0, 0];

    /** Coloca el barco según su pista a la hora del cielo. */
    function place() {
        if (hour === null) return;
        const sink = Math.max(0, Math.min(1, trackAt(tracks.sink, hour)));
        const dir = trackAt(tracks.dir, hour) >= 0 ? 1 : -1;
        const bob = still ? 0 : Math.sin((t / BOB.periodS) * Math.PI * 2) * BOB.amp * (1 - sink);
        rig.scale.x = dir;
        rig.x = Math.round(trackAt(tracks.x, hour) * W);
        rig.y = Math.round(horizonY + sink * afloat + bob);
        rig.visible = sink < 0.999;
        container.visible = rig.visible || spray > 0.01;
        // El filo de luz, en el costado que da a la derecha en pantalla.
        rimR.visible = dir === 1;
        rimL.visible = dir === -1;
        // La espuma, en la línea del mar alrededor del casco.
        foam.visible = sprayOn && spray > 0.01;
        foam.alpha = Math.min(1, spray * 1.2);
        foam.position.set(rig.x - (FOAM_ROWS[0].length * S) / 2, horizonY - S);
        // La estela, detrás de la popa mientras navega a flote.
        const wakeAmt = sprayOn && sink < 0.05 ? Math.min(1, speed / WAKE.fullSpeed) : 0;
        wake.visible = wakeAmt > 0.02;
        if (wake.visible) {
            const len = WAKE_ROWS[0][0].length * S;
            wake.alpha = WAKE.alpha * wakeAmt;
            wake.scale.x = S * dir;
            wake.position.set(dir === 1 ? rig.x - artW * 0.42 - len : rig.x + artW * 0.42 + len, horizonY - S);
        }
    }

    /** Gotas: nacen en lo que asoma del barco (bajo las velas, en la regala) y caen al mar. */
    function tickSpray(dt) {
        const emergedTop = rig.y - afloat;   // la fila 0 del arte, en la capa
        if (sprayOn && spray > 0.01 && rig.visible && !still) {
            spawnAcc += SPRAY.perS * spray * dt;
            while (spawnAcc >= 1) {
                spawnAcc -= 1;
                const d = drops.find((x) => !x.alive);
                if (!d) break;
                const k = spawnSeq++;
                const [cx, cy] = spots[Math.floor(hash01(k, 41) * spots.length)];
                const y = emergedTop + (cy + 1) * S;
                if (y >= horizonY - S) continue;   // aún bajo el agua
                const x = rig.x + (rig.scale.x === 1 ? cx * S - artW / 2 : artW / 2 - cx * S);
                d.alive = true;
                d.sp.visible = true;
                d.sp.position.set(x, y);
                d.vx = (hash01(k, 43) - 0.5) * 14;
                d.vy = hash01(k, 44) * 30;
            }
        }
        for (const d of drops) {
            if (!d.alive) continue;
            d.vy += SPRAY.gravity * dt;
            d.sp.x += d.vx * dt;
            d.sp.y += d.vy * dt;
            if (d.sp.y >= horizonY) {
                d.alive = false;
                d.sp.visible = false;
            }
        }
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
            t += dt;
            if (hour !== null) {
                // Velocidad en pantalla (unidades/s), suavizada: la estela.
                const x = trackAt(tracks.x, hour) * W;
                if (lastX !== null && dt > 0) speed += (Math.abs(x - lastX) / dt - speed) * Math.min(1, dt * 2);
                lastX = x;
                place();
            }
            if (wake.visible) {
                wakeT += dt;
                if (wakeT >= WAKE.frameS) {
                    wakeT -= WAKE.frameS;
                    wakeFrame = 1 - wakeFrame;
                    wake.texture = wakeTex[wakeFrame];
                }
            }
            lamp.tick(dt);
            tickSpray(dt);
        },
        resize(width, height, groundY) {
            W = width;
            horizonY = groundY - rise;
            lastX = null;
            place();
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            hour = state.hour;
            storyColors(state, colors);
            setTint('hull', [hull], colors.hull);
            setTint('sail', [sails], colors.sail);
            setTint('rim', [rimR, rimL], state.mountains.rim);
            rimR.alpha = rimL.alpha = Math.round(state.mountains.rimAmt * 0.9 * 100) / 100;
            for (let i = 0; i < 3; i++) waterRgb[i] = state.sea.crest[i] + (1 - state.sea.crest[i]) * WATER_LIGHT;
            setTint('water', waterSprites, waterRgb);
            spray = Math.max(0, trackAt(tracks.spray, hour));
            lampLevel = trackAt(tracks.lamp, hour);
            lamp.set(lampOn ? lampLevel : 0);
            windows.alpha = lampOn ? Math.round(lampLevel * 0.9 * 100) / 100 : 0;
            windows.visible = windows.alpha > 0.01;
            place();
        },
        setVisible(id, on) {
            if (id === def.id) container.renderable = on;
            else if (id === 'storySpray') sprayOn = on;
            else if (id === 'storyShipLamp') {
                lampOn = on;
                lamp.set(lampOn ? lampLevel : 0);
                windows.visible = lampOn && lampLevel > 0.01;
            }
            place();
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
