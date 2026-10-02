// Capa `ground` del escenario: la tira de suelo pixel art que scrollea 1:1 con
// el mundo (los obstáculos van pegados a ella) y la luz que la música pone en él.
//
// La hora le da un tinte sutil: el suelo es oscuro a propósito, es el fondo de
// contraste de todo lo que se juega.
//
// `params.sprite` elige la tira (T02.2: la arena de la Costa); la de siempre si
// no se dice.
//
// Efecto 'groundPulse' (T03.1): la línea del suelo late con el beat. Es un filo de
// luz sobre la línea y, bajo ella (donde no se juega nada), un resplandor de dos
// celdas que lo hace leerse como luz y no como una raya.
//
// (En la T03.2 hubo aquí un "espectro del suelo": la línea partida en tramos que
// crecían hacia abajo con cada banda. En el playtest se leyó como un error —
// "las barras se ven debajo del suelo"— y se quitó. De día el espectro son las
// barras tras la silueta, en el color de las montañas.)

import { Container, Graphics, TilingSprite } from 'pixi.js';
import { getTexture, spriteSize, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';

/**
 * El pulso del suelo: opacidad del filo en el golpe con el tramo más tranquilo y
 * cuánto sube con el más intenso; alto y fuerza del resplandor de debajo.
 */
const GROUND_PULSE = Object.freeze({ base: 0.22, intensity: 0.5, glowPx: 2 * PIXEL_SCALE, glow: 0.4 });

/**
 * @param {{ id: string, params?: { sprite?: string } }} def
 * @param {{ width: number, height: number, groundY: number }} view
 */
export function createGroundLayer(def, view) {
    const sprite = def.params?.sprite ?? 'ground';
    const container = new Container({ label: def.id });
    const strip = new TilingSprite({
        texture: getTexture(sprite),
        width: view.width,
        height: spriteSize(sprite).h,
    });
    strip.tileScale.set(PIXEL_SCALE);
    const glow = new Graphics();
    glow.blendMode = 'add';
    glow.alpha = 0;
    container.addChild(strip, glow);

    let lastTint = -1;
    let lastGlowTint = -1;

    function layout(width, groundY) {
        strip.width = width;
        // La fila 1 del tile (la línea E) cae exactamente en groundY; la fila 0
        // son los bultos que asoman por encima.
        strip.y = groundY - PIXEL_SCALE;
        glow.clear()
            .rect(0, groundY - 2, width, 3).fill(0xffffff)
            .rect(0, groundY + 1, width, GROUND_PULSE.glowPx).fill({ color: 0xffffff, alpha: GROUND_PULSE.glow });
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
         * (efecto 'groundPulse') El pulso del beat en la línea del suelo, en el color
         * frío de los efectos.
         * @param {{ levels: Record<string, number>, colors: { cool: number[] }, signals: import('../../fx/signals.js').FxSignals }} fx
         */
        setFx(fx) {
            const cool = rgbToNumber(fx.colors.cool);
            if (cool !== lastGlowTint) {
                glow.tint = cool;
                lastGlowTint = cool;
            }
            glow.alpha = Math.min(1, fx.levels.groundPulse * fx.signals.beat.world * (GROUND_PULSE.base + GROUND_PULSE.intensity * fx.signals.song.intensity));
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
