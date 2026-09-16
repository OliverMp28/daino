// Túnel del vuelo (Ola 6b): los muros que dibujan las notas mantenidas.
//
// Cada tramo de vuelo del chart tiene un camino (systems/flightCourse.js): la
// altura a la que va el Dino si mantiene cada nota exactamente. Los muros siguen
// ese camino con la holgura de la dificultad por arriba y por abajo, así que
// leer el túnel ES leer las notas: donde el muro del suelo sube hay que mantener,
// donde el del techo baja hay que soltar. Lo que se dibuja es la misma geometría
// con la que se choca (y con la que el charter valida el nivel).
//
// Coste: un Graphics por tramo, construido una vez al empezar la partida (en
// unidades de mundo, con el origen en el portal de entrada y en el suelo). Cada
// frame solo se mueve y se oculta fuera de pantalla.

import { Container, Graphics } from 'pixi.js';
import { CORRIDOR_HEIGHT_PX, MODE_COLORS } from '../config.js';
import { DINO_CENTER_X } from '../systems/geometry.js';
import { altAt, wallsFor } from '../systems/flightCourse.js';

/** Resolución del dibujo: un punto del muro cada tanto tiempo de canción. */
const SAMPLE_S = 0.03;

/** Margen fuera de pantalla en el que un tramo sigue visible. */
const MARGIN_PX = 200;

export const TUNNEL_STYLE = Object.freeze({
    fill: 0x241a08,
    fillAlpha: 0.82,
    edge: MODE_COLORS.fly,
    edgeWidth: 4,
    glowWidth: 14,
    glowAlpha: 0.16,
});

/**
 * @param {object} cfg
 * @param {ReturnType<import('../systems/flightCourse.js').createFlightCourse>} cfg.course
 * @param {import('../systems/speedProfile.js').SpeedProfile} cfg.speed
 */
export function createFlightTunnel({ course, speed }) {
    const container = new Container({ label: 'flight-tunnel' });
    const pieces = course.spans.map((span) => buildSpan(span, speed));
    for (const p of pieces) {
        container.addChild(p.glow, p.body);
        p.glow.visible = false;
        p.body.visible = false;
    }
    let pulse = 0;

    return {
        container,

        /** Pulso del beat: el filo de los muros late con la canción. */
        setBeat(v) {
            pulse = v;
        },

        /**
         * @param {number} songTime
         * @param {{ width: number, groundY: number }} view
         */
        tick(songTime, view) {
            if (pieces.length === 0) return;
            const nowD = speed.distanceAt(songTime);
            for (const p of pieces) {
                const x0 = DINO_CENTER_X + (p.d0 - nowD);
                const visible = x0 + p.width >= -MARGIN_PX && x0 <= view.width + MARGIN_PX;
                p.body.visible = visible;
                p.glow.visible = visible;
                if (!visible) continue;
                p.body.position.set(x0, view.groundY);
                p.glow.position.set(x0, view.groundY);
                p.glow.alpha = 0.6 + 0.4 * pulse;
            }
        },

        dispose() {
            if (container.parent) container.parent.removeChild(container);
            container.destroy({ children: true });
        },
    };
}

/**
 * Geometría de un tramo en coordenadas locales: x = distancia del mundo desde el
 * portal de entrada, y = −altura sobre el suelo (hacia arriba, negativo).
 */
function buildSpan(span, speed) {
    const d0 = speed.distanceAt(span.tIn);
    const H = CORRIDOR_HEIGHT_PX;

    // Instantes: las esquinas del camino y un muestreo regular (la velocidad del
    // mundo puede cambiar dentro del tramo y la distancia no es lineal en t).
    const times = new Set([span.tIn, span.tWalls, span.tOut]);
    for (const p of span.points) times.add(p.t);
    for (let t = span.tIn; t < span.tOut; t += SAMPLE_S) times.add(t);
    const ts = [...times].filter((t) => t >= span.tIn && t <= span.tOut).sort((a, b) => a - b);

    const floor = [];
    const ceiling = [];
    for (const t of ts) {
        const x = speed.distanceAt(t) - d0;
        const walls = wallsFor(altAt(span.points, t), span.margin);
        if (t < span.tWalls) {
            // Boca del túnel: sin muro del suelo y el del techo bajando desde arriba
            // (no se choca con él hasta `tWalls`; enseña por dónde entrar).
            const k = span.tWalls > span.tIn ? (t - span.tIn) / (span.tWalls - span.tIn) : 1;
            floor.push({ x, h: 0 });
            ceiling.push({ x, h: H + (Math.min(H, walls.ceilingWall) - H) * k });
        } else {
            floor.push({ x, h: clamp(walls.floorWall, 0, H) });
            ceiling.push({ x, h: clamp(walls.ceilingWall, 0, H) });
        }
    }
    const width = floor.length > 0 ? floor[floor.length - 1].x : 0;

    const body = new Graphics();
    const glow = new Graphics();
    glow.blendMode = 'add';
    const S = TUNNEL_STYLE;

    // Muro del suelo: del suelo hasta su filo. Muro del techo: del techo hasta el suyo.
    if (floor.some((p) => p.h > 0)) {
        body.poly([0, 0, ...floor.flatMap((p) => [p.x, -p.h]), width, 0]).fill({ color: S.fill, alpha: S.fillAlpha });
    }
    if (ceiling.some((p) => p.h < H)) {
        body.poly([0, -H, ...ceiling.flatMap((p) => [p.x, -p.h]), width, -H]).fill({ color: S.fill, alpha: S.fillAlpha });
    }
    // Filos: solo donde el muro asoma (un filo pegado al suelo o al techo se
    // leería como parte de la superficie).
    for (const [edge, hidden] of [[floor, (h) => h <= 0], [ceiling, (h) => h >= H]]) {
        let open = false;
        for (let i = 0; i < edge.length; i++) {
            const p = edge[i];
            const next = edge[i + 1];
            const shows = !hidden(p.h) || (next !== undefined && !hidden(next.h));
            if (shows && !open) {
                body.moveTo(p.x, -p.h);
                glow.moveTo(p.x, -p.h);
                open = true;
            } else if (open) {
                body.lineTo(p.x, -p.h);
                glow.lineTo(p.x, -p.h);
                if (!shows) open = false;
            }
        }
    }
    body.stroke({ width: S.edgeWidth, color: S.edge, alpha: 1, join: 'round', cap: 'round' });
    glow.stroke({ width: S.glowWidth, color: S.edge, alpha: S.glowAlpha, join: 'round', cap: 'round' });

    return { d0, width, body, glow };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
