// Capa `ground` del escenario: la tira de suelo pixel art que scrollea 1:1 con
// el mundo (los obstáculos van pegados a ella) y su filo de luz, que late con
// el beat (efecto de la Ola 5: lo apaga el panel dev junto a los demás).
//
// La hora le da un tinte sutil: el suelo es oscuro a propósito, es el fondo de
// contraste de todo lo que se juega.

import { Container, Graphics, TilingSprite } from 'pixi.js';
import { getTexture, spriteSize, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';

/** Color del filo de luz del suelo: el cian de la paleta (COLOR_HIGH del shader). */
const GROUND_GLOW_COLOR = 0x8fe0ff;

/**
 * @param {{ id: string }} def
 * @param {{ width: number, height: number, groundY: number }} view
 */
export function createGroundLayer(def, view) {
    const container = new Container({ label: def.id });
    const strip = new TilingSprite({
        texture: getTexture('ground'),
        width: view.width,
        height: spriteSize('ground').h,
    });
    strip.tileScale.set(PIXEL_SCALE);
    const glow = new Graphics();
    glow.blendMode = 'add';
    glow.alpha = 0;
    container.addChild(strip, glow);

    let lastTint = -1;

    function layout(width, groundY) {
        strip.width = width;
        // La fila 1 del tile (la línea E) cae exactamente en groundY; la fila 0
        // son los bultos que asoman por encima.
        strip.y = groundY - PIXEL_SCALE;
        glow.clear().rect(0, groundY - 2, width, 3).fill(GROUND_GLOW_COLOR);
    }

    layout(view.width, view.groundY);

    return {
        container,
        tick(dt, worldSpeed) {
            strip.tilePosition.x -= worldSpeed * dt;
        },
        resize(width, height, groundY) {
            layout(width, groundY);
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            const c = rgbToNumber(state.ground);
            if (c !== lastTint) {
                strip.tint = c;
                lastTint = c;
            }
        },
        /**
         * (efecto, Ola 5) Pulso del beat sobre la línea del suelo.
         * @param {number} pulse      [0,1], 1 en el golpe.
         * @param {number} intensity  [0,1] intensidad del tramo.
         */
        setPulse(pulse, intensity) {
            glow.alpha = pulse * (0.12 + 0.38 * intensity);
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
