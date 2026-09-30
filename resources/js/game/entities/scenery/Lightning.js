// Capa `lightning` del escenario (T02.3): los relámpagos de la Tormenta.
//
// Va DETRÁS de las montañas y las nubes: el destello aclara el cielo y las
// crestas y las nubes quedan en silueta; el rayo baja desde lo alto y se pierde
// tras la cordillera. Cuándo cae uno lo decide el reloj de relámpagos
// (scenes/weather.js) con la frecuencia del arco (`state.arc.lightning`): nada de
// día, desde el ocaso y del todo con la noche (el clímax). No sigue al beat: es
// escenario, no efecto (doc 11 §2.4).
//
// Seguridad (WCAG 2.3.1): un rayo son como mucho dos destellos y entre dos rayos
// pasan al menos 1.4 s (LIGHTNING en weather.js; lo prueba un test). Apagados con
// reduced motion (`view.still`) y con "Reducir efectos visuales" (`setFlashes`).
// Se carga bajo demanda con la escena.

import { Container, Graphics } from 'pixi.js';
import { PIXEL_SCALE } from '../../assets/pixelart.js';
import { LIGHTNING, createLightningClock, flashAt } from '../../scenes/weather.js';
import { hash01 } from './ridgeShape.js';

const SKY_FLASH_COLOR = 0xcfd0ff;
const BOLT_COLOR = 0xf4f2ff;

/**
 * @param {{ id: string, params: { seed: number } }} def
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number, still?: boolean }} view
 */
export function createLightningLayer(def, view) {
    const rise = view.horizonRise ?? 0;
    const container = new Container({ label: def.id });
    const flash = new Graphics();
    const bolt = new Graphics();
    for (const g of [flash, bolt]) {
        g.blendMode = 'add';
        g.alpha = 0;
    }
    container.addChild(flash, bolt);
    container.visible = false;

    const clock = createLightningClock(def.params.seed ?? 1);
    let W = view.width;
    let H = view.height;
    let groundY = view.groundY;
    let intensity = 0;
    let since = Infinity;
    let allowed = view.still !== true;
    let shown = true;

    function layout() {
        // Todo el cielo hasta el horizonte: lo que queda delante (montañas, nubes) lo tapa.
        flash.clear().rect(0, 0, W, groundY - rise + 6).fill(SKY_FLASH_COLOR);
    }

    /** Un rayo en zigzag de celdas, con alguna rama, de lo alto hasta detrás de las crestas. */
    function drawBolt(strike) {
        const cell = PIXEL_SCALE;
        const snap = (v) => Math.round(v / cell) * cell;
        let x = snap(W * (0.3 + 0.65 * strike.x));
        let y = snap(H * (0.05 + 0.12 * strike.top));
        const end = groundY - rise - 30;
        bolt.clear();
        let k = 0;
        const segment = (x0, y0, x1, y1, width) => bolt.moveTo(x0, y0).lineTo(x1, y1).stroke({ width, color: BOLT_COLOR });
        while (y < end) {
            const ny = Math.min(end, y + cell * (3 + Math.floor(hash01(strike.shape + k, 91) * 4)));
            const nx = x + cell * (Math.floor(hash01(strike.shape + k, 92) * 5) - 2);
            segment(x, y, nx, ny, cell);
            // Una rama corta de vez en cuando.
            if (hash01(strike.shape + k, 93) < 0.18) {
                const dir = hash01(strike.shape + k, 94) < 0.5 ? -1 : 1;
                segment(nx, ny, nx + dir * cell * 4, ny + cell * 5, cell / 2);
            }
            x = nx;
            y = ny;
            k++;
        }
    }

    layout();

    return {
        container,
        tick(dt) {
            const strike = clock.tick(dt, allowed && shown ? intensity : 0);
            if (strike) {
                drawBolt(strike);
                since = 0;
            } else {
                since += dt;
            }
            const a = allowed && shown ? flashAt(since) : 0;
            container.visible = a > 0.001;
            if (container.visible) {
                flash.alpha = a * LIGHTNING.skyAlpha;
                bolt.alpha = a;
            }
        },
        resize(width, height, gY) {
            W = width;
            H = height;
            groundY = gY;
            layout();
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            intensity = state.arc.lightning;
        },
        /** "Reducir efectos visuales": sin destellos. */
        setFlashes(on) {
            allowed = on && view.still !== true;
            if (!allowed) container.visible = false;
        },
        setVisible(id, on) {
            if (id !== def.id) return;
            shown = on;
            if (!on) container.visible = false;
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
