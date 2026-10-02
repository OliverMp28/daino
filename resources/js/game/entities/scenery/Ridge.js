// Capa `ridge` del escenario (T01): una cordillera en parallax.
//
// Cresta poligonal generada una vez por tamaño de vista y dibujada dos veces
// seguidas (patrón periódico): el scroll da la vuelta sin que se note. Las
// alturas salen de un hash por índice (ridgeShape.js, no de Math.random): al
// redimensionar (en un móvil, cada vez que se esconde la barra del navegador) la
// cordillera conserva su forma.
//
// Se dibuja en blanco y el color lo pone la hora (`tint`, scenes/skyModel.js).
// Encima, el FILO de la cresta: la luz del sol bajo al atardecer y la de la luna
// de noche (elemento 'ridgeRim' del panel dev).
//
// Efecto 'ridgePulse' (T03.2): ese filo se enciende con los graves y el pulso de
// la canción. Las montañas laten, de día y de noche.
//
// T02.2: la misma capa hace las islas de la Costa. `anchor: 'horizon'` la apoya
// en el horizonte del cielo de la escena (la línea del mar) en vez de en el
// suelo, y `gaps` deja tramos hundidos bajo esa línea: montañas sueltas en vez de
// una cordillera.

import { Container, Graphics } from 'pixi.js';
import { rgbToNumber } from '../../scenes/color.js';
import { ridgeHeights, ridgePoints } from './ridgeShape.js';

/** El filo con la música: cuánto lo encienden los graves y el pulso (más con el tramo intenso). */
const RIDGE_PULSE = Object.freeze({ bass: 0.45, pulse: 0.45 });

/**
 * @param {{ id: string, color: 'far' | 'near', rim?: number, snowRim?: number, params: { anchor?: 'ground' | 'horizon', baseRise: number, jag: number, step: number, seed: number, parallax: number, gaps?: number, gapRun?: number } }} def
 *   `snowRim` (T02.3, la Nieve): la cresta nevada, un filo de nieve de una celda
 *   con esa fuerza a cualquier hora (color: `state.arc.snowColor`). Es una línea,
 *   como el filo de luz: la montaña sigue siendo oscura detrás del juego.
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number }} view
 */
export function createRidgeLayer(def, view) {
    const { step, parallax } = def.params;
    const lift = def.params.anchor === 'horizon' ? (view.horizonRise ?? 0) : 0;
    const rimFactor = def.rim ?? 0;
    const snowAmt = def.snowRim ?? 0;
    const container = new Container({ label: def.id });
    const body = new Graphics();
    const snow = new Graphics();
    snow.visible = snowAmt > 0;
    snow.alpha = snowAmt;
    const rim = new Graphics();
    rim.alpha = 0;
    rim.visible = false;
    container.addChild(body, snow, rim);

    let period = 0;
    /** Alturas del periodo vigente (para quien se apoya en la silueta: heightAt). */
    let heights = [0];
    let rimOn = true;
    let lastBody = -1;
    let lastRim = -1;
    let lastRimAlpha = -1;
    let lastSnow = -1;
    /** El filo de la hora (escenario) y lo que le suma la música (efecto). */
    let rimBase = 0;
    let rimFx = 0;
    let rimFxOn = false;

    function applyRim() {
        const a = rimOn ? Math.min(1, Math.round((rimBase + rimFx) * 100) / 100) : 0;
        if (a !== lastRimAlpha) {
            rim.alpha = a;
            lastRimAlpha = a;
        }
        // Con la música sonando el filo no se oculta entre golpes: en Pixi v8
        // cambiar `visible` rehace las instrucciones de dibujo (SilhouetteSpectrum.js).
        const visible = rimOn && (rimBase > 0 || rimFxOn);
        if (visible !== rim.visible) rim.visible = visible;
    }

    function build(width, groundY) {
        body.clear();
        rim.clear();
        snow.clear();
        // Periodo múltiplo del paso: la cresta cierra exactamente donde empieza la
        // copia siguiente.
        const n = ridgePoints(width, step);
        period = n * step;
        heights = ridgeHeights(n, def.params);
        for (let copy = 0; copy < 2; copy++) {
            const x0 = copy * period;
            body.moveTo(x0, 0);
            for (let i = 0; i <= n; i++) body.lineTo(x0 + i * step, -heights[i % n]);
            body.lineTo(x0 + period, 0);
            body.closePath();
            rim.moveTo(x0, -heights[0]);
            for (let i = 1; i <= n; i++) rim.lineTo(x0 + i * step, -heights[i % n]);
            if (snowAmt > 0) {
                snow.moveTo(x0, -heights[0]);
                for (let i = 1; i <= n; i++) snow.lineTo(x0 + i * step, -heights[i % n]);
            }
        }
        body.fill(0xffffff);
        rim.stroke({ width: 3, color: 0xffffff });
        // La nieve, dos celdas de grueso: asoma a los dos lados de la cresta y se
        // lee como nieve, no como un contorno.
        if (snowAmt > 0) snow.stroke({ width: 8, color: 0xffffff });
        // +4: la falda queda bajo su línea de apoyo (el suelo o el mar la tapan).
        container.y = groundY - lift + 4;
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
            rimBase = state.mountains.rimAmt * rimFactor;
            applyRim();
            if (snowAmt > 0) {
                const sc = rgbToNumber(state.arc.snowColor);
                if (sc !== lastSnow) {
                    snow.tint = sc;
                    lastSnow = sc;
                }
            }
        },
        /**
         * Altura de la cresta sobre el suelo en la x de pantalla `x` (unidades de
         * mundo), con el scroll vigente. La usan las barras del espectro (T03.2).
         */
        heightAt(x) {
            let local = (x - container.x) % period;
            if (local < 0) local += period;
            const i = Math.floor(local / step);
            const t = local / step - i;
            const a = heights[i % heights.length];
            const b = heights[(i + 1) % heights.length];
            return lift - 4 + a + (b - a) * t;
        },
        /** La cresta más baja y la más alta, sobre el suelo. */
        heightRange() {
            return { min: lift - 4 + Math.min(...heights), max: lift - 4 + Math.max(...heights) };
        },
        /**
         * (efecto 'ridgePulse') El filo de la cresta con los graves y el pulso.
         * @param {{ levels: Record<string, number>, signals: import('../../fx/signals.js').FxSignals }} fx
         */
        setFx(fx) {
            const level = rimFactor > 0 ? fx.levels.ridgePulse : 0;
            rimFxOn = level > 0.004;
            const s = fx.signals;
            rimFx = level * rimFactor * (RIDGE_PULSE.bass * s.live.bass + RIDGE_PULSE.pulse * s.beat.world) * (0.5 + 0.5 * s.song.intensity);
            applyRim();
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
            else if (id === 'ridgeRim') {
                rimOn = on;
                applyRim();
            } else if (id === 'ridgeSnow' && snowAmt > 0) {
                snow.visible = on;
            }
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
