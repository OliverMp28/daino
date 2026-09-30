// Capa `snow` del escenario (T02.3): la nevada.
//
// Copos en dos tamaños (media celda y una) que caen despacio, se mecen y se van hacia
// atrás con el mundo (más deprisa cuanto más cerca: la profundidad se nota al
// correr). Cuántos, lo dice el arco del ambiente (`state.arc.snow`: arrecia hacia
// el clímax y amaina con el alba) por el presupuesto de render (`setDetail`). Su
// color es el del cielo casi blanco (`state.arc.snowColor`): de noche, azulados;
// al atardecer, rosados.
//
// Con reduced motion (`view.still`) se quedan quietos. Se carga bajo demanda con
// la escena.

import { Container, Particle, ParticleContainer, Rectangle } from 'pixi.js';
import { artTexture, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { hash01 } from './ridgeShape.js';

/**
 * Copo lejano (media celda) y cercano (una celda). Con 2×2 celdas parecían
 * bloques, no nieve.
 */
const FLAKE = Object.freeze(['Q']);
const FAR_SCALE = 0.5;

/**
 * @param {{ id: string, params: { count: number, fallPxS: [number, number], swayPxS: number, parallax: [number, number], nearShare: number } }} def
 * @param {{ width: number, height: number, groundY: number, still?: boolean }} view
 */
export function createSnowLayer(def, view) {
    const { count, fallPxS, swayPxS, parallax, nearShare } = def.params;
    const still = view.still === true;
    const container = new Container({ label: def.id });
    let W = view.width;
    let H = view.height;
    let groundY = view.groundY;

    const flakes = new ParticleContainer({
        boundsArea: new Rectangle(0, 0, W, H),
        dynamicProperties: { position: true, scale: false, rotation: false, color: true },
    });
    container.addChild(flakes);

    const flakeTex = artTexture('scene:flake', FLAKE);

    /** @type {Array<{ p: Particle, depth: number, vy: number, par: number, phase: number, freq: number, alpha: number }>} */
    const pool = [];
    for (let i = 0; i < count; i++) {
        const near = hash01(i, 81) < nearShare;
        // Profundidad [0,1]: los cercanos caen y se van más deprisa.
        const depth = near ? 0.6 + 0.4 * hash01(i, 82) : 0.5 * hash01(i, 82);
        const size = PIXEL_SCALE * (near ? 1 : FAR_SCALE);
        const p = new Particle({ texture: flakeTex, x: 0, y: -20, scaleX: size, scaleY: size });
        pool.push({
            p,
            depth,
            vy: fallPxS[0] + (fallPxS[1] - fallPxS[0]) * depth,
            par: parallax[0] + (parallax[1] - parallax[0]) * depth,
            phase: hash01(i, 83) * Math.PI * 2,
            freq: 0.6 + 0.8 * hash01(i, 84),
            alpha: near ? 0.85 : 0.5,
        });
    }

    let active = 0;
    let intensity = 0;
    let detail = 1;
    let tint = 0xffffff;
    let t = 0;
    let spawnSeq = 0;

    function place(f, anywhere) {
        const k = spawnSeq++;
        f.p.x = hash01(k, 85) * (W + 40);
        f.p.y = anywhere ? hash01(k, 86) * groundY : -hash01(k, 86) * 60 - 10;
    }

    function setActive(target) {
        target = Math.max(0, Math.min(pool.length, target));
        if (target === active) return;
        if (target < active) {
            for (let i = target; i < active; i++) flakes.removeParticle(pool[i].p);
        } else {
            for (let i = active; i < target; i++) {
                const f = pool[i];
                place(f, still || active === 0);
                f.p.tint = tint;
                f.p.alpha = f.alpha;
                flakes.addParticle(f.p);
            }
        }
        active = target;
        if (still) flakes.update();
    }

    return {
        container,
        tick(dt, worldSpeed) {
            t += dt;
            for (let i = 0; i < active; i++) {
                const f = pool[i];
                f.p.y += f.vy * dt;
                f.p.x += (Math.sin(t * f.freq + f.phase) * swayPxS - worldSpeed * f.par) * dt;
                if (f.p.y > groundY - 2) place(f, false);
                if (f.p.x < -12) f.p.x += W + 24;
                else if (f.p.x > W + 12) f.p.x -= W + 24;
            }
            if (active > 0) flakes.update();
        },
        resize(width, height, gY) {
            W = width;
            H = height;
            groundY = gY;
            flakes.boundsArea = new Rectangle(0, 0, W, H);
            for (let i = 0; i < active; i++) place(pool[i], true);
            if (active > 0) flakes.update();
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            intensity = state.arc.snow;
            const c = rgbToNumber(state.arc.snowColor);
            if (c !== tint) {
                tint = c;
                for (let i = 0; i < active; i++) pool[i].p.tint = tint;
                if (still && active > 0) flakes.update();
            }
            setActive(Math.round(pool.length * intensity * detail));
        },
        /** Presupuesto de render (RenderProfile.particleRatio). */
        setDetail(ratio) {
            detail = Math.max(0, Math.min(1, ratio));
            setActive(Math.round(pool.length * intensity * detail));
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
