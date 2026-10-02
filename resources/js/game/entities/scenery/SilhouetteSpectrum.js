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
// EL COLOR (fx/tones.js). De los graves a los agudos, del cálido al frío de los
// efectos POR EL TONO (magenta, violeta, añil), no en línea recta por sRGB, que
// pasa por un malva sucio; y solo con tonos que siguen siendo color bajo el techo
// de luminancia de la franja jugable (fx/limiter.js): un rojo ahí es un granate y
// un cian, un gris. Con la luminancia que deja el cielo de cada hora:
//   - DE NOCHE son luz: el tono, a la luminancia del techo;
//   - DE DÍA no cabe luz detrás de lo que se juega (el cielo ya está en ese
//     techo): son el mismo tono, en sombra. Vivo y algo más oscuro que el cielo se
//     lee como color; apagado, como suciedad (playtest: "se ven grisáceas");
//   - AL ANOCHECER cada barra se enciende de la punta hacia abajo: la punta ya es
//     luz contra el cielo alto, oscuro, y el pie sigue en sombra contra el
//     resplandor del horizonte. (Con un solo color que pasase de sombra a luz, a
//     mitad de camino la barra medía lo mismo que su cielo y desaparecía.)
//   Por eso cada barra son dos Sprites: la sombra, entera, y la luz encima.
// Siempre con mezcla normal y por debajo del techo: lo que se juega se lee delante
// a cualquier hora (el guardián mide estos mismos colores: scenes/backdrops.js).
//
// (Se probó una "marca del pico", la raya que en un ecualizador se queda un
// instante donde llegó la barra: sueltas por la franja jugable eran rayas
// flotando a la altura a la que vuela el ptero. Fuera.)
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
import { proxyLuma } from '../../fx/limiter.js';
import { SPECTRUM_BARS } from '../../fx/spectrum.js';
import { spectrumDay, spectrumEnds, spectrumLight, spectrumShade } from '../../fx/tones.js';

/** Cuánto asoma la barra bajo la cresta más baja de su hueco (por los valles). */
const BELOW_PX = 24;

/** Con cuánta sombra (`spectrumDay`) la sombra de una barra ya se ve entera: por debajo se va apagando bajo la luz. */
const SHADE_FULL_AT = 0.25;

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
 * @param {{ id: string, params: { host: string, count?: number, maxRise?: number } }} def
 * @param {{ width: number, height: number, groundY: number, horizonRise?: number, find: (id: string) => { heightAt?: (x: number) => number, heightRange?: () => { min: number, max: number } } | null }} view
 */
export function createSpectrumLayer(def, view) {
    const count = def.params.count ?? SPECTRUM_BARS.count;
    const maxRise = def.params.maxRise ?? SPECTRUM_BARS.maxRise;
    const container = new Container({ label: def.id });
    container.visible = false;

    /** La sombra de cada barra (debajo) y su luz (encima, de la punta hacia abajo). */
    /** @type {Sprite[]} */
    const shades = [];
    /** @type {Sprite[]} */
    const lights = [];
    for (const pool of [shades, lights]) {
        for (let i = 0; i < count; i++) {
            const s = new Sprite(gradient());
            s.alpha = 0;
            pool.push(s);
            container.addChild(s);
        }
    }

    let W = view.width;
    let groundY = view.groundY;
    let slot = W / count;
    let barW = Math.max(PIXEL_SCALE, Math.round((slot * SPECTRUM_BARS.fill) / PIXEL_SCALE) * PIXEL_SCALE);
    let on = true;
    let viewH = view.height;
    /** Sustituto de luminancia del cielo que las barras tienen detrás a esta hora. */
    let skyLuma = 0;
    /** [0,1] cuánto de cada barra es sombra: 1 de día, 0 de noche. */
    let day = 0;
    /** Lo último con lo que se tiñeron: colores de los efectos y claridad del cielo. */
    let tintKey = '';
    const ends = [0, 0];
    const toneTmp = [0, 0, 0];
    const skyTmp = [0, 0, 0];

    function layout(width, ground) {
        W = width;
        groundY = ground;
        slot = W / count;
        barW = Math.max(PIXEL_SCALE, Math.round((slot * SPECTRUM_BARS.fill) / PIXEL_SCALE) * PIXEL_SCALE);
        for (let i = 0; i < count; i++) {
            const x = Math.round(i * slot + (slot - barW) / 2);
            shades[i].x = x;
            shades[i].width = barW;
            lights[i].x = x;
            lights[i].width = barW;
        }
    }
    layout(view.width, view.groundY);

    const snap = (v) => Math.round(v / PIXEL_SCALE) * PIXEL_SCALE;

    /** Tiñe las barras: de los graves a los agudos, con la luz que deja el cielo. */
    function tint(colors) {
        const key = `${rgbToNumber(colors.warm)}:${rgbToNumber(colors.cool)}:${Math.round(skyLuma * 2000)}`;
        if (key === tintKey) return;
        tintKey = key;
        spectrumEnds(colors, ends);
        for (let i = 0; i < count; i++) {
            const t = count > 1 ? i / (count - 1) : 0;
            shades[i].tint = rgbToNumber(spectrumShade(ends, t, skyLuma, toneTmp));
            lights[i].tint = rgbToNumber(spectrumLight(ends, t, toneTmp));
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
            // El cielo que tienen detrás, a media altura de lo que suben sobre su silueta.
            const rise = view.horizonRise ?? 0;
            const range = view.find(def.params.host)?.heightRange?.();
            const at = (range ? (range.min + range.max) / 2 : 0) + maxRise / 2;
            const frac = 1 - (at - rise) / Math.max(1, viewH - GROUND_OFFSET_PX - rise);
            skyLuma = proxyLuma(skyColorAt(state, Math.max(0, Math.min(1, frac)), skyTmp));
            day = spectrumDay(skyLuma);
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
            // Cuánto de cada barra es luz (de la punta hacia abajo) y cuánto se ve su sombra.
            const lit = 1 - day;
            const shadeA = Math.min(1, day / SHADE_FULL_AT);
            for (let i = 0; i < count; i++) {
                const s = shades[i];
                const l = lights[i];
                const v = fx.spectrum.at(count > 1 ? i / (count - 1) : 0);
                // Una barra en silencio se queda transparente, no oculta: en Pixi v8
                // cambiar `visible` rehace las instrucciones de dibujo de toda la
                // escena, y aquí pasaría varias veces por segundo (medido: entre 0.5
                // y 1.5 ms por fotograma del hilo principal).
                if (v < 0.02) {
                    s.alpha = 0;
                    l.alpha = 0;
                    continue;
                }
                // La cresta más baja de su hueco: desde ahí asoma la barra.
                const x0 = s.x;
                const base = Math.max(0, Math.min(host.heightAt(x0), host.heightAt(x0 + barW * 0.5), host.heightAt(x0 + barW)));
                const top = snap(base + v * reach);
                const bottom = Math.max(0, snap(base) - BELOW_PX);
                const height = Math.max(PIXEL_SCALE, top - bottom);
                const alpha = Math.min(1, level * (a0 + (a1 - a0) * v));
                s.alpha = alpha * shadeA;
                if (shadeA > 0) {
                    s.y = groundY - top;
                    s.height = height;
                }
                l.alpha = lit > 0 ? alpha : 0;
                if (lit > 0) {
                    l.y = groundY - top;
                    l.height = Math.max(PIXEL_SCALE, snap(height * lit));
                }
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
