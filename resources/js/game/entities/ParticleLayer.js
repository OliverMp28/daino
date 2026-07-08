// Capa 2 del z-stack visual (doc 06 §3): partículas ambientales que reaccionan
// al volumen del audio — motas que ascienden lento en el menú y se aceleran/
// avivan con la energía de la canción durante la partida.
//
// Implementación (rediseño Jul 2026, antes stub):
//   - `ParticleContainer` + `Particle` (doc 09 §2.2: NUNCA Sprite aquí).
//   - `boundsArea` OBLIGATORIO o el cull falla silenciosamente (doc 09 §2.2).
//   - `dynamicProperties: { position: true }` — solo position cambia frame a
//     frame; scale/rotation/color se uploadean una vez al GPU (gain de v8).
//   - Con `prefers-reduced-motion` la capa queda vacía (doc 06 §6).
//
// Además exporta `createBurstEmitter`: mini-sistema de partículas one-shot
// (polvo de aterrizaje, estallido de muerte) sobre un Container normal —
// son pocas decenas de sprites con vida corta, no necesitan ParticleContainer.

import { Container, Particle, ParticleContainer, Rectangle, Sprite } from 'pixi.js';
import { AMBIENT_PARTICLES } from '../config.js';
import { getTexture } from '../assets/pixelart.js';

/**
 * Crea el contenedor de motas ambientales. El engine lo agrega al stage y
 * llama `tick(dt, energy)` cada frame (energy = RMS [0,1], 0 en menú).
 *
 * @param {{ width: number, height: number }} viewport
 * @param {{ reducedMotion?: boolean }} [opts]
 */
export function createParticleLayer(viewport, opts = {}) {
    const layer = new ParticleContainer({
        boundsArea: new Rectangle(0, 0, viewport.width, viewport.height),
        dynamicProperties: {
            position: true,
            scale: false,
            rotation: false,
            color: false,
        },
    });
    layer.label = 'particles';

    let W = viewport.width;
    let H = viewport.height;

    /** @type {Array<{ p: Particle, speed: number, drift: number, phase: number }>} */
    const motes = [];

    if (!opts.reducedMotion) {
        const tex = getTexture('dot');
        const { count, minSpeed, maxSpeed } = AMBIENT_PARTICLES;
        for (let i = 0; i < count; i++) {
            const p = new Particle({
                texture: tex,
                x: Math.random() * W,
                y: Math.random() * H,
                scaleX: 0.5 + Math.random() * 1.0,
                scaleY: 0.5 + Math.random() * 1.0,
                alpha: 0.06 + Math.random() * 0.16,
                tint: Math.random() < 0.25 ? 0x7fe6ff : 0x8b9aff,
            });
            layer.addParticle(p);
            motes.push({
                p,
                speed: minSpeed + Math.random() * (maxSpeed - minSpeed),
                drift: 6 + Math.random() * 14,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    let t = 0;

    layer.tick = (dt, energy) => {
        if (motes.length === 0) return;
        t += dt;
        // La energía de la canción multiplica la velocidad de ascenso (hasta
        // ×4 con RMS a tope) — en el menú (energy 0) flotan tranquilas.
        const boost = 1 + energy * 3;
        for (const m of motes) {
            m.p.y -= m.speed * boost * dt;
            m.p.x += Math.sin(t * 0.8 + m.phase) * m.drift * dt;
            if (m.p.y < -4) {
                m.p.y = H + 4;
                m.p.x = Math.random() * W;
            }
            if (m.p.x < -4) m.p.x = W + 4;
            else if (m.p.x > W + 4) m.p.x = -4;
        }
        layer.update();
    };

    layer.resize = (width, height) => {
        W = width;
        H = height;
        layer.boundsArea = new Rectangle(0, 0, W, H);
    };

    return layer;
}

/**
 * Emisor de ráfagas one-shot (polvo, estallidos). El caller lo monta sobre
 * un Container (típicamente gameLayer) y llama `tick(dt)` en su loop.
 *
 * @param {Container} parent
 */
export function createBurstEmitter(parent) {
    const container = new Container({ label: 'bursts' });
    parent.addChild(container);

    /** @type {Array<{ s: Sprite, vx: number, vy: number, g: number, life: number, ttl: number }>} */
    const live = [];
    const tex = getTexture('dot');

    return {
        /**
         * @param {object} o
         * @param {number} o.x  Origen en stage coords.
         * @param {number} o.y
         * @param {number} [o.count=8]
         * @param {number} [o.color=0xb9c6ea]
         * @param {number} [o.speedMin=60]   px/s
         * @param {number} [o.speedMax=220]
         * @param {number} [o.gravity=600]   px/s² (0 = flotan)
         * @param {number} [o.lifeS=0.45]
         * @param {number} [o.upBias=0.6]    0..1 — cuánto favorece salir hacia arriba
         */
        burst({ x, y, count = 8, color = 0xb9c6ea, speedMin = 60, speedMax = 220, gravity = 600, lifeS = 0.45, upBias = 0.6 }) {
            for (let i = 0; i < count; i++) {
                const s = new Sprite(tex);
                s.tint = color;
                s.anchor.set(0.5);
                const sc = 1 + Math.random() * 1.6;
                s.scale.set(sc);
                s.position.set(x, y);
                const ang = Math.random() * Math.PI * 2;
                const spd = speedMin + Math.random() * (speedMax - speedMin);
                live.push({
                    s,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd - spd * upBias,
                    g: gravity,
                    life: 0,
                    ttl: lifeS * (0.7 + Math.random() * 0.6),
                });
                container.addChild(s);
            }
        },

        tick(dt) {
            for (let i = live.length - 1; i >= 0; i--) {
                const q = live[i];
                q.life += dt;
                if (q.life >= q.ttl) {
                    container.removeChild(q.s);
                    q.s.destroy();
                    live.splice(i, 1);
                    continue;
                }
                q.vy += q.g * dt;
                q.s.x += q.vx * dt;
                q.s.y += q.vy * dt;
                q.s.alpha = 1 - (q.life / q.ttl);
            }
        },

        dispose() {
            for (const q of live) q.s.destroy();
            live.length = 0;
            if (container.parent) container.parent.removeChild(container);
            container.destroy({ children: true });
        },
    };
}
