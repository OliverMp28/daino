// Capa `skyline` del escenario (T02.4): una fila de edificios de la Ciudad de noche.
//
// Los edificios (skylineShape.js) se rasterizan una vez por tamaño de vista en
// texturas de una celda por píxel y se dibujan como tiras que se repiten
// (TilingSprite), en parallax como la cordillera:
//   - los edificios, en blanco y teñidos con la hora (el color de lo lejano o de lo
//     cercano, como las montañas: el guardián ya los conoce);
//   - las ventanas, en WINDOW_STEPS capas según el umbral de cada una: el arco de
//     la ciudad (`state.arc.windows`) las va encendiendo al caer la noche, las
//     tiene casi todas a medianoche (el clímax) y las apaga de madrugada. Luz
//     propia: no se tiñen;
//   - las luces rojas de las antenas, que parpadean de noche.
//
// Efecto 'spectrum' (T03.2): las ventanas bailan con la música. Cada escalón de
// ventanas sigue una banda de lo que suena (de graves a agudos): se atenúan y
// vuelven a su luz con cada golpe de su banda. Nunca brillan más que en el
// escenario: la música las apaga y las enciende.
//
// Se carga bajo demanda con la escena.

import { Container, Texture, TilingSprite } from 'pixi.js';
import { PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { WINDOW_STEPS, buildingWindows, skylineBuildings, skylineCells } from './skylineShape.js';

const BEACON_COLOR = '#ff4a5e';
/** Parpadeo de las luces de las antenas (Hz) y cuánto se quedan encendidas. */
const BEACON_HZ = 0.8;
const BEACON_DUTY = 0.35;
/** Cuánto se atenúan las ventanas de una banda en silencio, con el efecto a tope. */
const WINDOW_FX_DEPTH = 0.65;

/** Canvas de `w`×`h` píxeles (una celda cada uno) y lo que se dibuja en él. */
function paint(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    draw(ctx);
    const tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    return tex;
}

/**
 * @param {{ id: string, color: 'far' | 'near', params: { seed: number, minW: number, maxW: number, minH: number, maxH: number, gapMax: number, antennaChance: number, stepChance: number, parallax: number, windowAlpha: number } }} def
 * @param {{ width: number, height: number, groundY: number }} view
 */
export function createSkylineLayer(def, view) {
    const p = def.params;
    const container = new Container({ label: def.id });
    const windowsBox = new Container({ label: 'cityWindows' });

    /** @type {TilingSprite | null} */
    let body = null;
    /** @type {TilingSprite[]} */
    let windows = [];
    /** @type {TilingSprite | null} */
    let beacons = null;
    /** @type {Texture[]} */
    let textures = [];
    let periodW = 0;
    /** Altura del tejado en cada celda del periodo (para quien se apoya en la silueta: heightAt). */
    let roof = new Uint16Array(1);
    let lit = 0;
    let night = 0;
    let lastTint = -1;
    let windowsOn = true;
    let beaconsOn = true;
    let t = 0;
    /** Las ventanas con la música: nivel del efecto y el de la banda de cada escalón. */
    let fxLevel = 0;
    const fxBands = new Float32Array(WINDOW_STEPS);

    function release() {
        container.removeChildren();
        windowsBox.removeChildren();
        body?.destroy();
        for (const w of windows) w.destroy();
        beacons?.destroy();
        for (const tex of textures) tex.destroy(true);
        body = null;
        windows = [];
        beacons = null;
        textures = [];
    }

    function build(width, groundY) {
        const scrollX = body ? body.tilePosition.x : 0;
        release();
        const cells = skylineCells(width, PIXEL_SCALE);
        const buildings = skylineBuildings(cells, p);
        const rows = Math.max(...buildings.map((b) => b.top)) + 1;
        periodW = cells * PIXEL_SCALE;
        roof = new Uint16Array(cells);
        for (const b of buildings) roof.fill(b.h + (b.roof === 'step' ? 2 : 0), b.x, b.x + b.w);
        const top = (b) => rows - b.h;

        // Los edificios, en blanco (los tiñe la hora), con su remate.
        const bodyTex = paint(cells, rows, (ctx) => {
            ctx.fillStyle = '#ffffff';
            for (const b of buildings) {
                ctx.fillRect(b.x, top(b), b.w, b.h);
                if (b.roof === 'step') ctx.fillRect(b.x + 1, top(b) - 2, Math.max(1, b.w - 2), 2);
                if (b.roof === 'antenna') ctx.fillRect(b.x + Math.floor(b.w / 2), top(b) - b.antennaH, 1, b.antennaH);
            }
        });
        // Las ventanas, una capa por escalón de encendido.
        const lights = buildings.flatMap((b, i) => buildingWindows(b, i, p.seed));
        const windowTex = [];
        for (let s = 0; s < WINDOW_STEPS; s++) {
            windowTex.push(paint(cells, rows, (ctx) => {
                for (const w of lights) {
                    if (w.step !== s) continue;
                    ctx.fillStyle = w.color;
                    ctx.fillRect(w.x, rows - 1 - w.y, 1, 1);
                }
            }));
        }
        const hasBeacons = buildings.some((b) => b.roof === 'antenna');
        const beaconTex = hasBeacons ? paint(cells, rows, (ctx) => {
            ctx.fillStyle = BEACON_COLOR;
            for (const b of buildings) if (b.roof === 'antenna') ctx.fillRect(b.x + Math.floor(b.w / 2), top(b) - b.antennaH, 1, 1);
        }) : null;
        textures = [bodyTex, ...windowTex, ...(beaconTex ? [beaconTex] : [])];

        const strip = (tex) => {
            const s = new TilingSprite({ texture: tex, width, height: rows * PIXEL_SCALE });
            s.tileScale.set(PIXEL_SCALE);
            // El pie de los edificios, bajo la línea del suelo (la calle lo tapa).
            s.y = groundY - rows * PIXEL_SCALE + PIXEL_SCALE;
            s.tilePosition.x = scrollX % periodW;
            return s;
        };
        body = strip(bodyTex);
        windows = windowTex.map((tex) => strip(tex));
        for (const w of windows) windowsBox.addChild(w);
        beacons = beaconTex ? strip(beaconTex) : null;
        container.addChild(body, windowsBox);
        if (beacons) container.addChild(beacons);
        lastTint = -1;
        applyLights();
    }

    /** Qué capas de ventanas se ven con la ciudad encendida en `lit` ([0,1]). */
    function applyLights() {
        windowsBox.visible = windowsOn && lit > 0.005;
        for (let s = 0; s < windows.length; s++) {
            // Cada escalón se enciende en su tramo: con `lit` 0.5, la mitad de las capas.
            const a = Math.max(0, Math.min(1, lit * WINDOW_STEPS - s));
            windows[s].visible = a > 0.01;
            windows[s].alpha = a * p.windowAlpha * (1 - WINDOW_FX_DEPTH * fxLevel * (1 - fxBands[s]));
        }
    }

    function applyBeacons() {
        if (!beacons) return;
        const blink = (t * BEACON_HZ) % 1 < BEACON_DUTY ? 1 : 0.15;
        beacons.visible = beaconsOn && night > 0.05;
        beacons.alpha = night * blink;
    }

    build(view.width, view.groundY);

    return {
        container,
        tick(dt, worldSpeed) {
            const dx = worldSpeed * p.parallax * dt;
            for (const s of [body, ...windows, beacons]) {
                if (!s) continue;
                s.tilePosition.x -= dx;
                if (s.tilePosition.x <= -periodW) s.tilePosition.x += periodW;
            }
            t += dt;
            applyBeacons();
        },
        resize(width, height, groundY) {
            build(width, groundY);
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            const c = rgbToNumber(state.mountains[def.color]);
            if (c !== lastTint && body) {
                body.tint = c;
                lastTint = c;
            }
            const l = Math.round(state.arc.windows * 100) / 100;
            if (l !== lit) {
                lit = l;
                applyLights();
            }
            // Las luces de las antenas, de noche: del crepúsculo a la primera luz.
            night = Math.max(0, Math.min(1, (1 - state.elev) / 7));
            applyBeacons();
        },
        /**
         * Altura del tejado sobre el suelo en la x de pantalla `x` (unidades de
         * mundo), con el scroll vigente. La usan las barras del espectro (T03.2).
         */
        heightAt(x) {
            if (!body) return 0;
            let local = (x - body.tilePosition.x) % periodW;
            if (local < 0) local += periodW;
            // El pie del edificio queda una celda bajo la línea del suelo.
            return Math.max(0, roof[Math.floor(local / PIXEL_SCALE) % roof.length] - 1) * PIXEL_SCALE;
        },
        /** El tejado más bajo y el más alto, sobre el suelo. */
        heightRange() {
            let min = Infinity;
            let max = 0;
            for (let i = 0; i < roof.length; i++) {
                if (roof[i] < min) min = roof[i];
                if (roof[i] > max) max = roof[i];
            }
            return { min: Math.max(0, min - 1) * PIXEL_SCALE, max: Math.max(0, max - 1) * PIXEL_SCALE };
        },
        /**
         * (efecto 'spectrum') Las ventanas con las bandas de lo que suena.
         * @param {{ levels: Record<string, number>, spectrum: ReturnType<import('../../fx/spectrum.js').createSpectrum> }} fx
         */
        setFx(fx) {
            const level = Math.min(1, fx.levels.spectrum);
            if (level <= 0.004 && fxLevel === 0) return;
            fxLevel = level <= 0.004 ? 0 : level;
            if (fxLevel > 0) fx.spectrum.groups(WINDOW_STEPS, fxBands);
            if (lit > 0.005) applyLights();
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
            else if (id === 'cityWindows') {
                windowsOn = on;
                applyLights();
            } else if (id === 'cityBeacons') {
                beaconsOn = on;
                applyBeacons();
            }
        },
        dispose() {
            release();
            container.destroy({ children: true });
        },
    };
}
