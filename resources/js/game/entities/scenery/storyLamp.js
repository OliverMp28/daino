// Un farol de las historias de autor (T02.6): el de ella en el cabo y el de popa
// del barco. Luz propia, sumada al cielo (no se tiñe con la hora): un punto casi
// blanco, un brillo cálido en cruz, un halo tenue alrededor y, de noche, el aura
// suave que baña lo que tiene cerca. Titila un poco, salvo con reduced motion, y
// se aviva (`flare`) cuando ella ve el barco.

import { Container, Sprite, Texture } from 'pixi.js';
import { artTexture, PIXEL_SCALE } from '../../assets/pixelart.js';
import { LAMP_GLOW_ROWS } from './storyArt.js';

const INNER_ROWS = Object.freeze(['.Q.', 'QQQ', '.Q.']);
const COLORS = Object.freeze({ dot: 0xfff1c9, inner: 0xffd27a, halo: 0xffb85a, aura: 0xffa040 });
/** Brillo de cada parte con el farol del todo encendido, y cuánto sube al avivarse. */
const ALPHA = Object.freeze({ dot: 1, inner: 0.72, halo: 0.36, aura: 0.22, innerFlare: 0.25, haloFlare: 0.3, auraFlare: 0.25 });
const FLARE_SCALE = 0.25;

/** El aura: un degradado radial (es luz, no un objeto: sin píxeles). Uno para todos. */
let auraTex = null;
function auraTexture() {
    if (auraTex !== null) return auraTex;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    auraTex = Texture.from(canvas);
    return auraTex;
}

/**
 * @param {{ still?: boolean, flickerHz?: number, cell?: number, aura?: number }} [opts]
 *   `cell`: unidades de mundo por píxel del farol (la media celda de las historias).
 *   `aura`: diámetro del aura en unidades de mundo (0: sin aura).
 */
export function createStoryLamp(opts = {}) {
    const still = opts.still === true;
    const flickerHz = opts.flickerHz ?? 2.3;
    const S = opts.cell ?? PIXEL_SCALE;
    const container = new Container({ label: 'lamp' });
    const aura = opts.aura > 0 ? new Sprite(auraTexture()) : null;
    const halo = new Sprite(artTexture('story:lampHalo', LAMP_GLOW_ROWS));
    const inner = new Sprite(artTexture('story:lampInner', INNER_ROWS));
    const dot = new Sprite(artTexture('story:lampDot', ['Q']));
    if (aura !== null) {
        aura.anchor.set(0.5);
        aura.width = aura.height = opts.aura;
        aura.tint = COLORS.aura;
        aura.blendMode = 'add';
        container.addChild(aura);
    }
    for (const [sp, color] of [[halo, COLORS.halo], [inner, COLORS.inner], [dot, COLORS.dot]]) {
        sp.anchor.set(0.5);
        sp.scale.set(S);
        sp.tint = color;
        sp.blendMode = 'add';
        container.addChild(sp);
    }
    let level = 0;
    let flare = 0;
    let t = 0;
    /** Lo último aplicado: con el farol quieto no se toca nada (cero trabajo por frame). */
    let lastK = -1;
    let lastFlare = -1;

    function apply() {
        const flicker = still ? 1 : 0.86 + 0.14 * Math.sin(t * flickerHz * Math.PI * 2) * Math.sin(t * 0.9 + 1);
        const k = Math.round(level * flicker * 100) / 100;
        if (k === lastK && flare === lastFlare) return;
        lastK = k;
        lastFlare = flare;
        container.visible = k > 0.01;
        if (!container.visible) return;
        dot.alpha = Math.min(1, ALPHA.dot * k * 1.2);
        inner.alpha = Math.min(1, (ALPHA.inner + ALPHA.innerFlare * flare) * k);
        halo.alpha = Math.min(1, (ALPHA.halo + ALPHA.haloFlare * flare) * k);
        halo.scale.set(S * (1 + FLARE_SCALE * flare));
        if (aura !== null) aura.alpha = Math.min(1, (ALPHA.aura + ALPHA.auraFlare * flare) * k);
    }

    return {
        container,
        /** Cuánto arde [0,1] y cuánto se aviva [0,1]. */
        set(k, f = 0) {
            level = Math.max(0, Math.min(1, k));
            flare = Math.max(0, Math.min(1, f));
            apply();
        },
        tick(dt) {
            t += dt;
            apply();
        },
    };
}
