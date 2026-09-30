// Capa `lighthouse` del escenario (T02.2): un faro en un cabo lejano de la Costa.
//
// Su arco con la canción: se enciende al anochecer (con la elevación del sol, que
// sale de la hora del cielo y, esa, de la estructura de la canción) y gira toda
// la noche; al amanecer se apaga. El haz se ve de lado como una cuña que se
// estira y se encoge al girar, y cuando apunta hacia quien mira, la lámpara
// destella. Todo tenue: pasa por detrás de lo que se juega.
//
// La torre se tiñe con el color de lo lejano (el de las islas): de día es una
// silueta azulada con sus franjas y de noche solo se ve su luz. Tan lejos que
// cruza la pantalla en unos minutos: casi siempre está, y reaparece cada `every`
// unidades de recorrido. Se carga bajo demanda con la escena.

import { Container, Graphics, Sprite } from 'pixi.js';
import { artTexture, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { LIGHTHOUSE_LAMP_CELL, LIGHTHOUSE_ROWS, LIGHTHOUSE_SUNK_ROWS } from './lighthouseArt.js';

/** Lámpara (2×2 celdas) y su resplandor, en blanco: se tiñen con la luz del faro. */
const LAMP_ROWS = Object.freeze(['QQ', 'QQ']);
const GLOW_ROWS = Object.freeze(['..QQ..', '.QQQQ.', 'QQQQQQ', 'QQQQQQ', '.QQQQ.', '..QQ..']);

const LIGHT = Object.freeze({
    color: 0xffe2a0,
    /** Segundos por vuelta del haz. */
    turnS: 6,
    /** Largo del haz y cuánto se abre, en celdas. */
    beamCells: 26,
    spreadCells: 3,
    beamAlpha: 0.2,
    /** Se enciende con el sol a 1.5° y del todo a −3.5° (y al revés al amanecer). */
    onAtElev: 1.5,
    fullAtElev: -3.5,
});

/**
 * @param {{ id: string, parts?: Array<{ id: string }>, params: { parallax: number, every: number, startX: number } }} def
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number }} view
 */
export function createLighthouseLayer(def, view) {
    const { parallax, every, startX } = def.params;
    const rise = view.horizonRise ?? 0;
    const container = new Container({ label: def.id });

    const tower = new Sprite(artTexture('scene:lighthouse', LIGHTHOUSE_ROWS));
    tower.scale.set(PIXEL_SCALE);
    const artW = LIGHTHOUSE_ROWS[0].length * PIXEL_SCALE;

    // La luz: haz, resplandor y lámpara, sumados al cielo (brillan, no tapan).
    const lightBox = new Container({ label: 'lighthouseLight' });
    const beam = new Graphics()
        .poly([0, -PIXEL_SCALE / 2, 1, -LIGHT.spreadCells * PIXEL_SCALE, 1, LIGHT.spreadCells * PIXEL_SCALE, 0, PIXEL_SCALE / 2])
        .fill(0xffffff);
    const glow = new Sprite(artTexture('scene:lighthouseGlow', GLOW_ROWS));
    glow.anchor.set(0.5);
    glow.scale.set(PIXEL_SCALE);
    const lamp = new Sprite(artTexture('scene:lighthouseLamp', LAMP_ROWS));
    lamp.anchor.set(0.5);
    lamp.scale.set(PIXEL_SCALE);
    for (const node of [beam, glow, lamp]) {
        node.tint = LIGHT.color;
        node.blendMode = 'add';
    }
    lightBox.addChild(beam, glow, lamp);
    container.addChild(tower, lightBox);

    let W = view.width;
    let scroll = 0;
    let angle = 0;
    let on = 0;
    let lightOn = true;
    let lastTint = -1;

    function layout(width, groundY) {
        W = width;
        // La roca entra en el agua: sus últimas filas quedan bajo la línea del mar.
        tower.y = groundY - rise - (LIGHTHOUSE_ROWS.length - LIGHTHOUSE_SUNK_ROWS) * PIXEL_SCALE;
        tower.x = 0;
        const lx = LIGHTHOUSE_LAMP_CELL[0] * PIXEL_SCALE;
        const ly = tower.y + LIGHTHOUSE_LAMP_CELL[1] * PIXEL_SCALE;
        for (const node of [beam, glow, lamp]) node.position.set(lx, ly);
        place();
    }

    /** Posición en el recorrido: reaparece por la derecha cada `every` unidades. */
    function place() {
        const p = startX * W - scroll;
        const x = (((p + artW) % every) + every) % every - artW;
        container.x = Math.round(x);
        container.visible = x < W;
    }

    function applyLight() {
        const k = lightOn ? on : 0;
        lightBox.visible = k > 0.01;
        if (!lightBox.visible) return;
        const c = Math.cos(angle);
        // Hacia quien mira (seno positivo) la lámpara destella.
        const toward = Math.pow(Math.max(0, Math.sin(angle)), 6);
        beam.scale.x = c * LIGHT.beamCells * PIXEL_SCALE;
        beam.alpha = k * LIGHT.beamAlpha * (0.35 + 0.65 * Math.abs(c));
        glow.alpha = k * (0.28 + 0.6 * toward);
        lamp.alpha = k * (0.75 + 0.25 * toward);
    }

    layout(view.width, view.groundY);

    return {
        container,
        tick(dt, worldSpeed) {
            scroll += worldSpeed * parallax * dt;
            if (scroll > every * 1000) scroll -= every * 1000;
            place();
            angle = (angle + (dt * 2 * Math.PI) / LIGHT.turnS) % (2 * Math.PI);
            applyLight();
        },
        resize(width, height, groundY) {
            layout(width, groundY);
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            const tint = rgbToNumber(state.mountains.far);
            if (tint !== lastTint) {
                tower.tint = tint;
                lastTint = tint;
            }
            on = Math.max(0, Math.min(1, (LIGHT.onAtElev - state.elev) / (LIGHT.onAtElev - LIGHT.fullAtElev)));
            applyLight();
        },
        setVisible(id, visibleOn) {
            if (id === def.id) container.renderable = visibleOn;
            else if (id === 'lighthouseLight') {
                lightOn = visibleOn;
                applyLight();
            }
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
