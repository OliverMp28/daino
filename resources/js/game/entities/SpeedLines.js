// Líneas de velocidad — el aire que pasa (afinado de velocidad, Sep 2026).
//
// Con el mundo acelerando por marchas, la velocidad se nota en lo que tarda un
// obstáculo en cruzar la pantalla (desde Sep 2026 casi lo mismo en cualquier
// pantalla: ver systems/worldView.js). Estas rayas de luz además venden la
// velocidad sin tocar la jugabilidad. Cruzan el cielo más rápido que el suelo,
// hay más y más largas cuanto más por encima de su arranque va el nivel, y en
// cada acelerón pasa una ráfaga por toda la pantalla.
//
// Nunca bajan a la franja del juego (clearAboveGroundPx): una raya a la altura
// del ptero se leería como un obstáculo.
//
// Coste: un pool fijo de Sprites de Texture.WHITE (≤ 40), sin crear ni
// destruir nada durante la partida. El engine lo limita con el presupuesto de
// partículas del estado (RenderProfile).

import { Container, Sprite, Texture } from 'pixi.js';
import { SPEED_LINES } from '../config.js';

/**
 * @param {{ width: number, height: number, groundY: number }} viewport
 */
export function createSpeedLines(viewport) {
    const container = new Container({ label: 'speed-lines' });
    container.alpha = 0;

    let W = viewport.width;
    let H = viewport.height;
    let groundY = viewport.groundY;

    /** @type {Array<{ s: Sprite, active: boolean, burst: boolean, factor: number }>} */
    const lines = [];
    for (let i = 0; i < SPEED_LINES.count + SPEED_LINES.burst; i++) {
        const s = new Sprite(Texture.WHITE);
        s.blendMode = 'add';
        s.visible = false;
        s.height = SPEED_LINES.thicknessPx;
        container.addChild(s);
        lines.push({ s, active: false, burst: false, factor: 1 });
    }

    let level = 0;        // [0,1] intensidad pedida
    let budget = 1;       // fracción del pool que permite el perfil de render
    /** Franja libre sobre el suelo; sube con el pasillo de un modo (Ola 6a). */
    let clearance = SPEED_LINES.clearAboveGroundPx;
    let pendingBurst = 0;
    let shown = 0;        // alpha del conjunto, con fundido

    function launch(line, anywhere, burst) {
        const k = burst ? 1 : level;
        const [f0, f1] = SPEED_LINES.speedFactor;
        const [l0, l1] = SPEED_LINES.lengthPx;
        const [a0, a1] = SPEED_LINES.alpha;
        line.factor = f0 + Math.random() * (f1 - f0);
        line.s.width = (l0 + (l1 - l0) * k) * (0.6 + Math.random() * 0.8);
        line.s.alpha = (a0 + (a1 - a0) * k) * (0.6 + Math.random() * 0.4);
        line.s.tint = SPEED_LINES.colors[Math.floor(Math.random() * SPEED_LINES.colors.length)];
        const top = H * SPEED_LINES.topFraction;
        const bottom = Math.max(top + 8, groundY - clearance);
        line.s.y = Math.round(top + Math.random() * (bottom - top));
        line.s.x = anywhere ? Math.random() * W : W + Math.random() * W * 0.3;
        line.s.visible = true;
        line.active = true;
        line.burst = burst;
    }

    function park(line) {
        line.active = false;
        line.burst = false;
        line.s.visible = false;
    }

    return {
        container,

        /** Intensidad [0,1]. Las rayas entran por la derecha: nunca aparecen de golpe. */
        setLevel(v) {
            level = v < 0 ? 0 : v > 1 ? 1 : v;
        },

        /** Ráfaga de un acelerón: rayas por toda la pantalla a la vez. */
        burst() {
            pendingBurst = Math.round(SPEED_LINES.burst * budget);
        },

        /**
         * Franja libre sobre el suelo, en unidades de mundo. 0 = la de siempre
         * (por encima del salto y del ptero).
         * @param {number} px
         */
        setClearance(px) {
            clearance = Math.max(SPEED_LINES.clearAboveGroundPx, px || 0);
        },

        /** @param {number} ratio  Fracción del pool que se permite animar [0,1]. */
        setActiveRatio(ratio) {
            budget = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
        },

        /**
         * @param {number} dt
         * @param {number} worldSpeed  px/s del mundo.
         */
        tick(dt, worldSpeed) {
            const target = Math.round(SPEED_LINES.count * level * budget);

            let normal = 0;
            let bursting = 0;
            for (const line of lines) {
                if (!line.active) continue;
                line.s.x -= worldSpeed * line.factor * dt;
                if (line.s.x + line.s.width < 0) park(line);
                else if (line.burst) bursting++;
                else normal++;
            }

            // Una ráfaga se ve entera aunque el nivel no pida rayas.
            const wanted = target > 0 || bursting > 0 || pendingBurst > 0 ? 1 : 0;
            shown += (wanted - shown) * (1 - Math.exp(-SPEED_LINES.fadeRate * dt));
            if (pendingBurst > 0) shown = 1;
            container.alpha = shown;

            // Sin nada que enseñar y ya fundido: fuera todo, para que la partida
            // siguiente no herede rayas a medio cruzar.
            if (wanted === 0 && shown < 0.01) {
                for (const line of lines) if (line.active) park(line);
                return;
            }
            for (let i = 0; i < lines.length && (normal < target || pendingBurst > 0); i++) {
                const line = lines[i];
                if (line.active) continue;
                if (pendingBurst > 0) {
                    launch(line, true, true);
                    pendingBurst--;
                } else {
                    launch(line, false, false);
                    normal++;
                }
            }
            pendingBurst = 0;
        },

        resize(width, height, ground) {
            W = width;
            H = height;
            groundY = ground;
        },
    };
}
