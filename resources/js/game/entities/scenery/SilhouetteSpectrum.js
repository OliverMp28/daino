// Capa `spectrum` del escenario (T03.2): el espectro de la canción como barras
// que nacen de una silueta del paisaje (las crestas de la cordillera, los tejados
// de la ciudad).
//
// Hasta la T03.1 el ecualizador se pintaba en el shader, detrás de las montañas:
// solo asomaba por los valles ("a veces parece escondido", doc 11 §1.C). Ahora es
// del paisaje: esta capa va DETRÁS de su anfitriona (`params.host`) y la silueta
// la recorta, así que cada barra asoma justo por encima de la cresta que tiene
// delante. En silencio no asoma nada; con música, suben de detrás de las
// montañas. Las barras no se mueven de sitio: solo suben y bajan (nada en la
// franja jugable se mueve como un obstáculo).
//
// De día y de noche, con lo que el cielo deja:
//   - DE NOCHE son luz: los dos colores de los efectos, de cálido (graves) a azul
//     (agudos), bajados al techo de luminancia de la franja jugable
//     (fx/limiter.js, `capColor`).
//   - DE DÍA no cabe luz detrás de lo que se juega (el cielo ya está en ese
//     techo), así que son SILUETA: el color más oscuro del paisaje a esa hora (el
//     de las montañas cercanas), con un punto del color del efecto. Más oscuras
//     que el cielo y que las crestas que tienen delante, como un horizonte de
//     torres que baila. (Como luz del mismo brillo que el cielo solo lo
//     ensuciaban: columnas pardas sobre el azul.)
//   Entre las dos, el atardecer las va encendiendo.
// Las dos se pintan con mezcla normal y con colores que el guardián de legibilidad
// conoce (scenes/backdrops.js): lo que se juega se lee delante a cualquier hora.
//
// El extremo frío es azul, no cian: bajo un mismo techo de luminancia un azul se
// ve mucho más que un cian (el cian oscuro es un gris verdoso).
//
// Efecto 'spectrum' (lo gobierna el director, fx/director.js); elemento
// 'spectrumBars' del panel dev.
//
// Coste: un pool fijo de Sprites, sin crear ni destruir nada durante la partida.

import { Container, Sprite, Texture } from 'pixi.js';
import { GROUND_OFFSET_PX } from '../../config.js';
import { PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { skyColorAt } from '../../scenes/skyModel.js';
import { FX_LIMIT, capColor, proxyLuma } from '../../fx/limiter.js';
import { SPECTRUM_BARS } from '../../fx/spectrum.js';

/** Cuánto asoma la barra bajo la cresta más baja de su hueco (por los valles). */
const BELOW_PX = 24;

/**
 * Con qué claridad del cielo detrás de las barras (su luminancia, en techos del
 * limitador) son ya todo luz (noche) y con cuál son todo silueta (día).
 */
const NIGHT_BLEND = Object.freeze([0.3, 0.75]);

/** El extremo frío de las barras: el color frío de los efectos, llevado al azul. */
const DEEP_COOL = Object.freeze([0.45, 0.6, 1]);

/** Degradado vertical en escalones (pixel art): opaco abajo, transparente en la punta. */
let gradientTexture = null;
function gradient() {
    if (gradientTexture !== null) return gradientTexture;
    const steps = [0.3, 0.55, 0.8, 1, 1, 1, 1, 1];
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = steps.length;
    const ctx = canvas.getContext('2d');
    steps.forEach((a, y) => {
        ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
        ctx.fillRect(0, y, 1, 1);
    });
    gradientTexture = Texture.from(canvas);
    gradientTexture.source.scaleMode = 'nearest';
    return gradientTexture;
}

/**
 * @param {{ id: string, params: { host: string, dayColor?: 'far' | 'near', count?: number, maxRise?: number } }} def
 *   `dayColor`: qué color del paisaje de la hora llevan de día (scenes/skyModel.js, `mountains`).
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number, find: (id: string) => { heightAt?: (x: number) => number } | null }} view
 */
export function createSpectrumLayer(def, view) {
    const count = def.params.count ?? SPECTRUM_BARS.count;
    const maxRise = def.params.maxRise ?? SPECTRUM_BARS.maxRise;
    const dayColor = def.params.dayColor ?? 'near';
    const container = new Container({ label: def.id });
    container.visible = false;

    /** @type {Sprite[]} */
    const bars = [];
    for (let i = 0; i < count; i++) {
        const s = new Sprite(gradient());
        s.alpha = 0;
        bars.push(s);
        container.addChild(s);
    }

    let W = view.width;
    let groundY = view.groundY;
    let slot = W / count;
    let barW = Math.max(PIXEL_SCALE, Math.round((slot * SPECTRUM_BARS.fill) / PIXEL_SCALE) * PIXEL_SCALE);
    let on = true;
    /** [0,1] cuánto son luz (1 de noche) y cuánto silueta (0 a pleno día). */
    let night = 1;
    /** El color de silueta de esta hora. */
    const silhouette = [0, 0, 0];
    let viewH = view.height;
    /** Lo último con lo que se tiñeron: colores de los efectos, silueta y hora. */
    let tintKey = '';
    const mixTmp = [0, 0, 0];
    const capTmp = [0, 0, 0];
    const skyTmp = [0, 0, 0];

    function layout(width, ground) {
        W = width;
        groundY = ground;
        slot = W / count;
        barW = Math.max(PIXEL_SCALE, Math.round((slot * SPECTRUM_BARS.fill) / PIXEL_SCALE) * PIXEL_SCALE);
        for (let i = 0; i < count; i++) {
            bars[i].x = Math.round(i * slot + (slot - barW) / 2);
            bars[i].width = barW;
        }
    }
    layout(view.width, view.groundY);

    const snap = (v) => Math.round(v / PIXEL_SCALE) * PIXEL_SCALE;

    /** Tiñe las barras: de la silueta (día) a la luz de los efectos (noche). */
    function tint(colors) {
        const key = `${rgbToNumber(colors.warm)}:${rgbToNumber(colors.cool)}:${rgbToNumber(silhouette)}:${Math.round(night * 24)}`;
        if (key === tintKey) return;
        tintKey = key;
        const light = SPECTRUM_BARS.dayTint + (1 - SPECTRUM_BARS.dayTint) * night;
        for (let i = 0; i < count; i++) {
            const t = count > 1 ? i / (count - 1) : 0;
            for (let k = 0; k < 3; k++) mixTmp[k] = colors.warm[k] + (colors.cool[k] * DEEP_COOL[k] - colors.warm[k]) * t;
            capColor(mixTmp, capTmp);
            for (let k = 0; k < 3; k++) mixTmp[k] = silhouette[k] + (capTmp[k] - silhouette[k]) * light;
            bars[i].tint = rgbToNumber(mixTmp);
        }
    }

    return {
        container,
        tick() {},
        resize(width, height, ground) {
            viewH = height;
            layout(width, ground);
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            // El cielo que tienen detrás, a media altura de las barras.
            const rise = view.horizonRise ?? 0;
            const frac = 1 - (maxRise - rise) / Math.max(1, viewH - GROUND_OFFSET_PX - rise);
            const sky = proxyLuma(skyColorAt(state, Math.max(0, Math.min(1, frac)), skyTmp)) / FX_LIMIT.cap;
            const t = (sky - NIGHT_BLEND[0]) / (NIGHT_BLEND[1] - NIGHT_BLEND[0]);
            night = 1 - (t <= 0 ? 0 : t >= 1 ? 1 : t);
            const c = state.mountains[dayColor];
            silhouette[0] = c[0];
            silhouette[1] = c[1];
            silhouette[2] = c[2];
        },
        /**
         * @param {{ levels: Record<string, number>, colors: { warm: number[], cool: number[] }, signals: import('../../fx/signals.js').FxSignals, spectrum: ReturnType<import('../../fx/spectrum.js').createSpectrum> }} fx
         */
        setFx(fx) {
            const level = on ? fx.levels.spectrum : 0;
            const host = level > 0.004 ? view.find(def.params.host) : null;
            container.visible = host !== null && typeof host.heightAt === 'function';
            if (!container.visible) return;
            tint(fx.colors);

            // Más altas cuanto más empuja el tramo.
            const reach = maxRise * (0.6 + 0.4 * fx.signals.song.intensity);
            const [a0, a1] = SPECTRUM_BARS.alpha;
            for (let i = 0; i < count; i++) {
                const s = bars[i];
                const v = fx.spectrum.at(count > 1 ? i / (count - 1) : 0);
                // Una barra en silencio se queda transparente, no oculta: en Pixi v8
                // cambiar `visible` rehace las instrucciones de dibujo de toda la
                // escena, y aquí pasaría varias veces por segundo (medido: entre 0.5
                // y 1.5 ms por fotograma del hilo principal).
                if (v < 0.02) {
                    s.alpha = 0;
                    continue;
                }
                // La cresta más baja de su hueco: desde ahí asoma la barra.
                const x0 = s.x;
                const base = Math.min(host.heightAt(x0), host.heightAt(x0 + barW * 0.5), host.heightAt(x0 + barW));
                const top = snap(Math.max(0, base) + v * reach);
                const bottom = Math.max(0, snap(base) - BELOW_PX);
                s.y = groundY - top;
                s.height = Math.max(PIXEL_SCALE, top - bottom);
                s.alpha = Math.min(1, level * (a0 + (a1 - a0) * v));
            }
        },
        setVisible(id, visible) {
            if (id === def.id) on = visible;
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
