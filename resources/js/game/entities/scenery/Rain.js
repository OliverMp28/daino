// Capa `rain` del escenario (T02.3): la lluvia.
//
// Gotas de pixel art en dos profundidades (las lejanas, cortas y tenues; las
// cercanas, largas y más claras) que caen un poco sesgadas por el viento,
// delante del paisaje y detrás del juego. Cuántas, lo dice el arco del ambiente
// (`state.arc.rain`: sube hacia el clímax y escampa con el alba) por el
// presupuesto de render (`setDetail`: en el tier bajo, menos gotas). Su color es
// el del cielo aclarado (`state.arc.rainColor`), así que se tiñen con la hora.
// Las cercanas salpican al llegar al suelo.
//
// Con reduced motion (`view.still`) se quedan quietas: la lluvia se ve, no se
// mueve. Se carga bajo demanda con la escena.

import { Container, Particle, ParticleContainer, Rectangle, Sprite } from 'pixi.js';
import { artTexture, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';
import { hash01 } from './ridgeShape.js';

/**
 * Gota lejana (3 celdas de alto) y cercana (6). Media celda de ancho, como el
 * detalle de la luna: con una celda entera parecían barrotes, no lluvia.
 */
const FAR_DROP = Object.freeze(['Q', 'Q', 'Q']);
const NEAR_DROP = Object.freeze(['Q', 'Q', 'Q', 'Q', 'Q', 'Q']);
const DROP_WIDTH = 0.5;
/** Salpicadura: dos fotogramas. */
const SPLASH_A = Object.freeze(['.Q.Q.', 'Q...Q']);
const SPLASH_B = Object.freeze(['.....', 'Q...Q']);
const SPLASH_FRAME_S = 0.06;
const SPLASH_POOL = 20;

/**
 * @param {{ id: string, params: { count: number, fallPxS: number, slant: number, nearShare: number } }} def
 * @param {{ width: number, height: number, groundY: number, still?: boolean }} view
 */
export function createRainLayer(def, view) {
    const { count, fallPxS, slant, nearShare } = def.params;
    const still = view.still === true;
    const container = new Container({ label: def.id });
    let W = view.width;
    let H = view.height;
    let groundY = view.groundY;

    const drops = new ParticleContainer({
        boundsArea: new Rectangle(0, 0, W, H),
        dynamicProperties: { position: true, scale: false, rotation: false, color: true },
    });
    const splashBox = new Container({ label: `${def.id}:splashes` });
    container.addChild(drops, splashBox);

    const farTex = artTexture('scene:rainFar', FAR_DROP);
    const nearTex = artTexture('scene:rainNear', NEAR_DROP);
    const splashTex = [artTexture('scene:splashA', SPLASH_A), artTexture('scene:splashB', SPLASH_B)];

    /** @type {Array<{ p: Particle, near: boolean, vy: number, vx: number, alpha: number }>} */
    const pool = [];
    for (let i = 0; i < count; i++) {
        // Cercana o lejana por hash del índice: cualquier número de gotas activas
        // mantiene la mezcla.
        const near = hash01(i, 71) < nearShare;
        const speed = fallPxS * (near ? 1 : 0.72) * (0.88 + 0.24 * hash01(i, 72));
        const p = new Particle({
            texture: near ? nearTex : farTex,
            x: 0,
            y: -100,
            scaleX: PIXEL_SCALE * DROP_WIDTH,
            scaleY: PIXEL_SCALE,
        });
        pool.push({ p, near, vy: speed, vx: -speed * slant * (near ? 1 : 0.8), alpha: near ? 0.52 : 0.3 });
    }

    const splashes = [];
    for (let i = 0; i < SPLASH_POOL; i++) {
        const s = new Sprite(splashTex[0]);
        s.scale.set(PIXEL_SCALE);
        s.visible = false;
        splashBox.addChild(s);
        splashes.push({ s, life: 0 });
    }

    let active = 0;
    let intensity = 0;
    let detail = 1;
    let tint = 0xffffff;
    let strength = 1;
    let splashIndex = 0;
    let spawnSeq = 0;

    /** Sitio de una gota nueva: arriba (al caer) o en cualquier punto (al empezar o quieta). */
    function place(d, anywhere) {
        const k = spawnSeq++;
        // El viento las lleva a la izquierda: nacen también un poco a la derecha.
        d.p.x = hash01(k, 73) * (W + groundY * slant);
        d.p.y = anywhere ? hash01(k, 74) * groundY : -hash01(k, 74) * H * 0.3 - 30;
    }

    function applyColor(d) {
        d.p.tint = tint;
        d.p.alpha = d.alpha * strength;
    }

    /** Ajusta cuántas gotas caen (el arco por el presupuesto). */
    function setActive(target) {
        target = Math.max(0, Math.min(pool.length, target));
        if (target === active) return;
        if (target < active) {
            for (let i = target; i < active; i++) drops.removeParticle(pool[i].p);
        } else {
            for (let i = active; i < target; i++) {
                place(pool[i], still || active === 0);
                applyColor(pool[i]);
                drops.addParticle(pool[i].p);
            }
        }
        active = target;
        if (still) drops.update();
    }

    function splash(x) {
        const sp = splashes[splashIndex];
        splashIndex = (splashIndex + 1) % splashes.length;
        sp.s.texture = splashTex[0];
        sp.s.position.set(Math.round(x / PIXEL_SCALE) * PIXEL_SCALE - 2 * PIXEL_SCALE, groundY - 2 * PIXEL_SCALE);
        sp.s.tint = tint;
        sp.s.alpha = 0.7 * strength;
        sp.s.visible = true;
        sp.life = 0;
    }

    return {
        container,
        tick(dt) {
            for (let i = 0; i < active; i++) {
                const d = pool[i];
                d.p.y += d.vy * dt;
                d.p.x += d.vx * dt;
                if (d.p.y > groundY - 6) {
                    if (d.near && hash01(spawnSeq, 75) < 0.35) splash(d.p.x);
                    place(d, false);
                }
            }
            if (active > 0) drops.update();
            for (const sp of splashes) {
                if (!sp.s.visible) continue;
                sp.life += dt;
                if (sp.life >= 2 * SPLASH_FRAME_S) sp.s.visible = false;
                else if (sp.life >= SPLASH_FRAME_S) sp.s.texture = splashTex[1];
            }
        },
        resize(width, height, gY) {
            W = width;
            H = height;
            groundY = gY;
            drops.boundsArea = new Rectangle(0, 0, W, H);
            for (let i = 0; i < active; i++) place(pool[i], true);
            if (active > 0) drops.update();
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            intensity = state.arc.rain;
            const t = rgbToNumber(state.arc.rainColor);
            const k = Math.round((0.6 + 0.4 * intensity) * 20) / 20;
            if (t !== tint || k !== strength) {
                tint = t;
                strength = k;
                for (let i = 0; i < active; i++) applyColor(pool[i]);
                // Quieta, nadie llama a update() cada frame: el color se sube aquí.
                if (still && active > 0) drops.update();
            }
            setActive(Math.round(pool.length * intensity * detail));
        },
        /** Presupuesto de render (RenderProfile.particleRatio): el tier bajo, menos gotas. */
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
