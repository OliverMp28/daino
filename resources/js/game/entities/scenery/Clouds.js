// Capa `clouds` del escenario (fase E1, doc 11): nubes a la deriva.
//
// Cada nube es su cuerpo más dos filos de luz (assets/pixelart.js, `edgeRows`):
// el de arriba lo enciende el sol alto o la luna, el de abajo el sol bajo del
// atardecer, que las ilumina desde debajo. Todo en claros y teñido por la hora.
//
// La hora también decide cuántas hay (`cloudCover` de la paleta): pocas a
// mediodía, muchas en un ocaso dramático, el cielo despejado de noche. Una nube
// que sobra se deshace poco a poco donde está; una que falta entra por la
// derecha, nunca aparece de golpe en medio del cielo.
//
// Parallax por tamaño: las grandes están más cerca y corren más. Nunca bajan de
// `clearancePx` sobre el suelo: de día son blancas, y un Dino blanco delante de
// una nube blanca desaparecería (el guardián de legibilidad lo comprueba).

import { Container, Sprite } from 'pixi.js';
import { getTexture, spriteSize, PIXEL_SCALE } from '../../assets/pixelart.js';
import { rgbToNumber } from '../../scenes/color.js';

const SHAPES = Object.freeze([
    Object.freeze({ body: 'cloud', top: 'cloudRimTop', bottom: 'cloudRimBottom' }),
    Object.freeze({ body: 'cloudB', top: 'cloudBRimTop', bottom: 'cloudBRimBottom' }),
]);

/** Segundos en que una nube que sobra termina de deshacerse (o de entrar). */
const FADE_S = 2.5;

/**
 * @param {{ id: string, params: { count: number, band: [number, number], scale: [number, number], parallax: number, driftPxS: number, clearancePx: number } }} def
 * @param {{ width: number, height: number, groundY: number }} view
 */
export function createCloudLayer(def, view) {
    const { count, band, scale, parallax, driftPxS, clearancePx } = def.params;
    const container = new Container({ label: def.id });
    let W = view.width;
    let H = view.height;
    let groundY = view.groundY;
    let cover = 0.7;
    let alpha = 0.9;

    /** @type {Array<{ c: Container, body: Sprite, top: Sprite, bottom: Sprite, w: number, h: number, depth: number, drift: number, threshold: number, presence: number, present: boolean }>} */
    const clouds = [];

    for (let i = 0; i < count; i++) {
        const shape = SHAPES[i % SHAPES.length];
        const c = new Container();
        const body = new Sprite(getTexture(shape.body));
        const bottom = new Sprite(getTexture(shape.bottom));
        const top = new Sprite(getTexture(shape.top));
        c.addChild(body, bottom, top);
        const depth = Math.random();
        const s = scale[0] + depth * (scale[1] - scale[0]);
        c.scale.set(PIXEL_SCALE * s);
        const size = spriteSize(shape.body);
        clouds.push({
            c, body, top, bottom,
            // Tamaño en unidades de mundo, fijo: pedir `width` al contenedor
            // recalcula sus límites en cada frame.
            w: size.w * s,
            h: size.h * s,
            depth,
            drift: driftPxS * (0.6 + Math.random() * 0.8),
            // La nube i está si la cobertura pasa de su umbral: con cobertura 0.5
            // está la mitad del cielo.
            threshold: (i + 0.5) / count,
            presence: 0,
            present: false,
        });
        container.addChild(c);
    }

    /** Franja vertical donde caben (y de la parte de arriba de la nube). */
    function bandFor(cl) {
        const lo = band[0] * H;
        const hi = Math.min(band[1] * H, groundY - clearancePx - cl.h);
        return hi > lo ? [lo, hi] : null;
    }

    /** Coloca una nube: al empezar en cualquier punto, después entrando por la derecha. */
    function place(cl, anywhere) {
        const b = bandFor(cl);
        cl.present = b !== null && cover > cl.threshold;
        cl.presence = anywhere && cl.present ? 1 : 0;
        cl.c.x = anywhere ? Math.random() * W : W + 20 + Math.random() * 160;
        cl.c.y = b ? b[0] + Math.random() * (b[1] - b[0]) : -200;
    }

    for (const cl of clouds) place(cl, true);

    let lastBody = -1;
    let lastTop = -1;
    let lastBottom = -1;

    return {
        container,
        tick(dt, worldSpeed) {
            for (const cl of clouds) {
                cl.c.x -= (worldSpeed * parallax * (0.7 + 0.6 * cl.depth) + cl.drift) * dt;
                if (cl.c.x + cl.w < -20) place(cl, false);
                // Sobra (la cobertura bajó): se deshace donde está.
                if (cl.present && cover <= cl.threshold) cl.present = false;
                const target = cl.present ? 1 : 0;
                const k = Math.min(1, dt / FADE_S);
                cl.presence += (target - cl.presence) * k * 3;
                cl.presence = Math.max(0, Math.min(1, cl.presence));
                cl.c.alpha = alpha * cl.presence;
                cl.c.visible = cl.c.alpha > 0.005;
            }
        },
        resize(width, height, gY) {
            W = width;
            H = height;
            groundY = gY;
            for (const cl of clouds) {
                const b = bandFor(cl);
                if (b === null) cl.present = false;
                else if (cl.c.y < b[0] || cl.c.y > b[1]) cl.c.y = b[0] + Math.random() * (b[1] - b[0]);
            }
        },
        /** @param {ReturnType<import('../../scenes/skyModel.js').createSkyState>} state */
        light(state) {
            const { clouds: s } = state;
            cover = s.cover;
            alpha = s.alpha;
            const bodyTint = rgbToNumber(s.body);
            const topTint = rgbToNumber(s.rimTop);
            const bottomTint = rgbToNumber(s.rimBottom);
            const topAlpha = Math.round(s.rimTopAmt * 100) / 100;
            const bottomAlpha = Math.round(s.rimBottomAmt * 100) / 100;
            const tintChanged = bodyTint !== lastBody || topTint !== lastTop || bottomTint !== lastBottom;
            for (const cl of clouds) {
                if (tintChanged) {
                    cl.body.tint = bodyTint;
                    cl.top.tint = topTint;
                    cl.bottom.tint = bottomTint;
                }
                cl.top.alpha = topAlpha;
                cl.bottom.alpha = bottomAlpha;
            }
            lastBody = bodyTint;
            lastTop = topTint;
            lastBottom = bottomTint;
        },
        setVisible(id, on) {
            if (id === def.id) container.visible = on;
        },
        dispose() {
            container.destroy({ children: true });
        },
    };
}
