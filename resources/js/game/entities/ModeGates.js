// Portales y techo de los modos de movimiento (Ola 6a).
//
// Un cambio de modo no es un aviso en el HUD: es un OBJETO del mundo que viene
// hacia el Dino y lo cruza exactamente en el instante del chart. Se ve llegar
// desde el borde de la pantalla, como en Geometry Dash, y cuando pasa cambian las
// reglas. El techo del pasillo de un modo (antigravedad, vuelo) aparece con el
// portal de entrada y termina en el de salida, así que también se ve venir.
//
// La posición sale de la misma fórmula que los obstáculos (distancia recorrida
// entre dos instantes de canción, speedProfile.js): portal y obstáculos no
// pueden desincronizarse.
//
// Coste: dos contenedores de portal reutilizados y una tira de techo; nada se
// crea ni se destruye durante la partida.

import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { MODE_COLORS, PIXEL_SCALE } from '../config.js';
import { getTexture, spriteSize } from '../assets/pixelart.js';
import { ceilingYOf, DINO_CENTER_X } from '../systems/geometry.js';
import { clipTiledStrip } from '../systems/tiling.js';

/** Frames del aro del portal. */
const PORTAL_ANIM_S = 0.12;

/** Margen fuera de pantalla en el que un portal sigue colocado (entra y sale suave). */
const MARGIN_PX = 200;

/**
 * Flechas de cada portal, de arriba abajo: qué hace el modo que empieza. Invertir
 * la gravedad (arriba y abajo), subir (arriba, arriba) o volver a correr (abajo).
 * Un modo nuevo sin entrada usa las de la antigravedad.
 */
const PORTAL_MARKS = Object.freeze({
    run: Object.freeze(['chevronDown']),
    flip: Object.freeze(['chevronUp', 'chevronDown']),
    fly: Object.freeze(['chevronUp', 'chevronUp']),
});

/** Textura del techo del pasillo de cada modo (la línea en su color). */
const CEILING_TEXTURE = Object.freeze({ flip: 'ceiling', fly: 'ceilingFly' });

function createPortal() {
    const box = new Container({ label: 'portal' });
    const size = spriteSize('portalA');

    const glow = new Sprite(getTexture('portalA'));
    glow.anchor.set(0.5, 1);
    glow.scale.set(PIXEL_SCALE * 1.12);
    glow.blendMode = 'add';
    glow.alpha = 0.35;

    const ring = new Sprite(getTexture('portalA'));
    ring.anchor.set(0.5, 1);
    ring.scale.set(PIXEL_SCALE);

    const marks = [new Sprite(getTexture('chevronUp')), new Sprite(getTexture('chevronDown'))];
    for (const m of marks) {
        m.anchor.set(0.5);
        m.scale.set(PIXEL_SCALE);
    }

    box.addChild(glow, ring, ...marks);
    box.visible = false;
    return { box, glow, ring, marks, height: size.h };
}

/**
 * @param {object} cfg
 * @param {Array<{ t: number, mode: string, from: string }>} cfg.changes  Cambios de modo del chart.
 * @param {import('../systems/speedProfile.js').SpeedProfile} cfg.speed
 */
export function createModeGates({ changes, speed }) {
    const container = new Container({ label: 'mode-gates' });

    // Techo del pasillo: la tira tileable y su filo de luz, recortados cada frame
    // a lo que se ve del tramo.
    const railSize = spriteSize('ceiling');
    const rail = new TilingSprite({ texture: getTexture('ceiling'), width: 0, height: railSize.h });
    rail.tileScale.set(PIXEL_SCALE);
    rail.visible = false;
    const railGlow = new Sprite(Texture.WHITE);
    railGlow.tint = MODE_COLORS.flip;
    railGlow.blendMode = 'add';
    railGlow.height = 3;
    railGlow.visible = false;
    container.addChild(rail, railGlow);

    const portals = [createPortal(), createPortal()];
    for (const p of portals) container.addChild(p.box);

    const gates = changes.map((c) => ({ ...c, crossD: speed.distanceAt(c.t) }));
    // Tramos de cada modo distinto de correr: del portal que lo abre al que lo cierra.
    const spans = [];
    for (let i = 0; i < gates.length; i++) {
        if (gates[i].mode === 'run') continue;
        const end = gates[i + 1] ?? null;
        spans.push({ mode: gates[i].mode, d0: gates[i].crossD, d1: end === null ? Infinity : end.crossD });
    }

    let animT = 0;
    let frame = 0;
    let pulse = 0;

    return {
        container,

        /** Pulso del beat: los portales laten con la canción como todo lo demás. */
        setBeat(v) {
            pulse = v;
        },

        /**
         * @param {number} songTime
         * @param {number} dt
         * @param {{ width: number, groundY: number }} view
         */
        tick(songTime, dt, view) {
            if (gates.length === 0) return;
            const nowD = speed.distanceAt(songTime);
            const left = -MARGIN_PX;
            const right = view.width + MARGIN_PX;
            const ceilingY = ceilingYOf(view.groundY);

            animT += dt;
            if (animT >= PORTAL_ANIM_S) {
                animT -= PORTAL_ANIM_S;
                frame = 1 - frame;
            }
            const texture = getTexture(frame === 0 ? 'portalA' : 'portalB');

            // Portales visibles (a lo sumo dos a la vez: los tramos están
            // separados por segundos de carrera).
            let slot = 0;
            for (const gate of gates) {
                const x = DINO_CENTER_X + (gate.crossD - nowD);
                if (x < left || x > right || slot >= portals.length) continue;
                const p = portals[slot++];
                const color = MODE_COLORS[gate.mode] ?? MODE_COLORS.run;
                p.box.visible = true;
                p.box.position.set(x, view.groundY);
                p.ring.texture = texture;
                p.glow.texture = texture;
                p.ring.tint = color;
                p.glow.tint = color;
                p.glow.alpha = 0.28 + 0.25 * pulse;
                p.ring.scale.set(PIXEL_SCALE, PIXEL_SCALE * (1 + 0.03 * pulse));
                // Flechas centradas en la mitad del aro, separadas 52 unidades.
                const marks = PORTAL_MARKS[gate.mode] ?? PORTAL_MARKS.flip;
                const mid = -p.height * 0.5;
                p.marks.forEach((m, k) => {
                    m.visible = k < marks.length;
                    if (!m.visible) return;
                    m.texture = getTexture(marks[k]);
                    m.tint = color;
                    m.position.set(0, mid + (k - (marks.length - 1) / 2) * 52);
                });
            }
            for (let i = slot; i < portals.length; i++) portals[i].box.visible = false;

            // Techo: la parte visible del tramo, con la textura anclada al mundo
            // (systems/tiling.js: el patrón no resbala al recortar por la izquierda).
            let shown = false;
            for (const span of spans) {
                const strip = clipTiledStrip(DINO_CENTER_X + (span.d0 - nowD), DINO_CENTER_X + (span.d1 - nowD), left, right, railSize.w);
                if (strip === null) continue;
                rail.visible = true;
                rail.texture = getTexture(CEILING_TEXTURE[span.mode] ?? CEILING_TEXTURE.flip);
                // La fila de la línea del tile cae justo encima de la superficie
                // del techo, como la del suelo cae justo debajo del suyo.
                rail.position.set(strip.x, ceilingY - railSize.h + PIXEL_SCALE);
                rail.width = strip.width;
                rail.tilePosition.x = strip.tileX;
                railGlow.tint = MODE_COLORS[span.mode] ?? MODE_COLORS.flip;
                railGlow.visible = true;
                railGlow.position.set(strip.x, ceilingY - 1);
                railGlow.width = strip.width;
                railGlow.alpha = 0.25 + 0.5 * pulse;
                shown = true;
                break;
            }
            if (!shown) {
                rail.visible = false;
                railGlow.visible = false;
            }
        },

        dispose() {
            if (container.parent) container.parent.removeChild(container);
            container.destroy({ children: true });
        },
    };
}
