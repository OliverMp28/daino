// Capa `ridge` del escenario (T01): una cordillera en parallax.
//
// Cresta poligonal generada una vez por tamaño de vista y dibujada dos veces
// seguidas (patrón periódico): el scroll da la vuelta sin que se note. Las
// alturas salen de un hash por índice (no de Math.random): al redimensionar (en
// un móvil, cada vez que se esconde la barra del navegador) la cordillera
// conserva su forma.
//
// Se dibuja en blanco y el color lo pone la hora (`tint`, scenes/skyModel.js).
// Encima, el FILO de la cresta: la luz del sol bajo al atardecer y la de la luna
// de noche (elemento 'ridgeRim' del panel dev).

import { Container, Graphics } from 'pixi.js';
import { rgbToNumber } from '../../scenes/color.js';

/** [0,1) estable para (índice, semilla). */
export function hash01(i, seed) {
    let x = (Math.imul(i + 1, 2654435761) ^ Math.imul(seed, 1597334677)) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822519) >>> 0;
    x ^= x >>> 13;
    return x / 4294967296;
}

/**
 * @param {{ id: string, color: 'far' | 'near', rim?: number, params: { baseRise: number, jag: number, step: number, seed: number, parallax: number } }} def
 * @param {{ width: number, height: number, groundY: number }} view
 */
export function createRidgeLayer(def, view) {
    const { baseRise, jag, step, seed, parallax } = def.params;
    const rimFactor = def.rim ?? 0;
    const container = new Container({ label: def.id });
    const body = new Graphics();
    const rim = new Graphics();
    rim.alpha = 0;
    rim.visible = false;
    container.addChild(body, rim);

    let period = 0;
    let rimOn = true;
    let lastBody = -1;
    let lastRim = -1;
    let lastRimAlpha = -1;

    function build(width, groundY) {
        body.clear();
        rim.clear();
        // Periodo múltiplo del paso: la cresta cierra exactamente donde empieza la
        // copia siguiente.
        period = Math.ceil(Math.max(width, 640) / step) * step;
        const n = period / step;
        const heights = [];
        for (let i = 0; i < n; i++) heights.push(baseRise + hash01(i, seed) * jag);
        for (let copy = 0; copy < 2; copy++) {
            const x0 = copy * period;
            body.moveTo(x0, 0);
            for (let i = 0; i <= n; i++) body.lineTo(x0 + i * step, -heights[i % n]);
            body.lineTo(x0 + period, 0);
            body.closePath();
            rim.moveTo(x0, -heights[0]);
            for (let i = 1; i <= n; i++) rim.lineTo(x0 + i * step, -heights[i % n]);
        }
        body.fill(0xffffff);
        rim.stroke({ width: 3, color: 0xffffff });
        // +4: la falda queda bajo la línea del suelo.
        container.y = groundY + 4;
        // El scroll se conserva dentro del periodo nuevo: redimensionar no hace saltar el paisaje.
        container.x %= period;
    }

    build(view.width, view.groundY);

    return {
        container,
        tick(dt, worldSpeed) {
            container.x -= worldSpeed * parallax * dt;
            if (container.x <= -period) container.x += period;
        },
        resize(width, height, groundY) {
            build(width, groundY);
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            const c = rgbToNumber(state.mountains[def.color]);
            if (c !== lastBody) {
                body.tint = c;
                lastBody = c;
            }
            const rc = rgbToNumber(state.mountains.rim);
            if (rc !== lastRim) {
                rim.tint = rc;
                lastRim = rc;
            }
            const ra = rimOn ? Math.round(state.mountains.rimAmt * rimFactor * 100) / 100 : 0;
            if (ra !== lastRimAlpha) {
                rim.alpha = ra;
                rim.visible = ra > 0;
                lastRimAlpha = ra;
            }
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
            else if (id === 'ridgeRim') {
                rimOn = on;
                lastRimAlpha = -1;
            }
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
