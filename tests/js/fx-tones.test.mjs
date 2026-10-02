// Tonos de los efectos (fx/tones.js), tras el segundo playtest de los efectos:
// "las barras se ven grisáceas: son rojizas y con el fondo azulado queda raro; de
// noche pasa lo mismo, y puede que pase más con otros escenarios".
//
// Lo que se protege aquí, para cualquier escena y cualquier hora:
//   - un color de efecto no queda lejos del tono del cielo que tiene detrás;
//   - las barras del espectro son COLOR (nunca un gris), de punta a punta de la
//     rampa, y nunca más claras que el techo de la franja jugable;
//   - una barra no desaparece contra su cielo a ninguna hora.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFxDirector } from '../../resources/js/game/fx/director.js';
import { FX_LIMIT, capColor, proxyLuma } from '../../resources/js/game/fx/limiter.js';
import { FX_COLORS } from '../../resources/js/game/fx/registry.js';
import { createFxSignals, readSkySignals } from '../../resources/js/game/fx/signals.js';
import {
    SPECTRUM_TONES, TONE_RULES, harmonize, hueOf, spectrumDay, spectrumEnds, spectrumLight, spectrumShade, vividAt,
} from '../../resources/js/game/fx/tones.js';
import { relativeLuminance, rgbToOklab } from '../../resources/js/game/scenes/color.js';
import { SCENES } from '../../resources/js/game/scenes/registry.js';
import { createSkyState, skyStateAt } from '../../resources/js/game/scenes/skyModel.js';

const chromaOf = (rgb) => {
    const lab = rgbToOklab(rgb);
    return Math.hypot(lab[1], lab[2]);
};
/** Viveza: croma en proporción a la claridad (un color oscuro tiene poca croma aunque sea puro). */
const vividness = (rgb) => chromaOf(rgb) / rgbToOklab(rgb)[0];
/** Distancia entre dos tonos, en grados [0, 180]. */
const hueGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
/** Posición de un tono dentro del arco de las barras, o null si está fuera. */
const inArc = (h) => {
    const span = (TONE_RULES.arc[1] - TONE_RULES.arc[0] + 360) % 360;
    const p = (h - TONE_RULES.arc[0] + 360) % 360;
    return p <= span + 1.5 || p >= 358.5;
};

/** Las horas de un ciclo entero, cada 0.05 h. */
const HOURS = Array.from({ length: 361 }, (_, i) => 13 + i * 0.05);
/** Escenas cuyos efectos llevan los colores de la canción (las que los fijan, como una historia, no se tocan). */
const SONG_COLOR_SCENES = Object.values(SCENES).filter((sc) => sc.fx?.colors === undefined);
const BAR_SCENES = Object.values(SCENES).filter((sc) => sc.layers.some((l) => l.type === 'spectrum'));

/** Colores de los efectos que da el director para una escena a una hora (partida en marcha). */
function colorsAt(scene, hour, hueTurns = 0) {
    const d = createFxDirector();
    d.configure({ scene });
    const s = createFxSignals();
    s.playing = true;
    s.song.intensity = 0.8;
    s.song.hue = hueTurns;
    readSkySignals(skyStateAt(hour, scene, createSkyState()), scene, s);
    for (let i = 0; i < 400; i++) d.update(s, 1 / 60);
    return { colors: d.colors, sky: s.sky.band };
}

test('el color más vivo de cada tono: cabe en sRGB, es de ese tono y está en una arista del cubo', () => {
    const c = [0, 0, 0];
    for (let h = 0; h < 360; h += 3) {
        vividAt(h, c);
        for (const v of c) assert.ok(v >= 0 && v <= 1, `tono ${h}: ${c}`);
        assert.ok(hueGap(hueOf(c), h) < 2.5, `tono pedido ${h}, sale ${hueOf(c).toFixed(1)}`);
        // Un canal a tope y otro a cero (o casi: entre dos grados se interpola).
        assert.ok(Math.max(...c) > 0.97 && Math.min(...c) < 0.03, `tono ${h}: ${c.map((v) => v.toFixed(2))}`);
    }
    // El azul puro, el magenta y el rojo, donde se esperan.
    assert.ok(hueGap(hueOf([0, 0, 1]), 264) < 1 && hueGap(hueOf([1, 0, 1]), 328) < 1 && hueGap(hueOf([1, 0, 0]), 29) < 1);
});

test('a juego con el cielo: sobre el azul del día el rosa gira al magenta, con su mismo brillo', () => {
    const blue = [0.13, 0.27, 0.72];
    const out = harmonize(FX_COLORS.warm, blue, [0, 0, 0]);
    assert.ok(hueGap(hueOf(FX_COLORS.warm), hueOf(blue)) > 100, 'el rosa de los efectos está lejos del azul del día');
    assert.ok(Math.abs(hueGap(hueOf(out), hueOf(blue)) - TONE_RULES.maxHueDeg) < 1.5, `queda a ${hueGap(hueOf(out), hueOf(blue)).toFixed(1)}°`);
    // Giró por el camino corto: hacia el magenta, no hacia el verde.
    assert.ok(hueOf(out) > 300 && hueOf(out) < 345, `tono ${hueOf(out).toFixed(0)}`);
    assert.ok(Math.abs(rgbToOklab(out)[0] - rgbToOklab(FX_COLORS.warm)[0]) < 0.01, 'mismo brillo');
    assert.ok(chromaOf(out) > chromaOf(FX_COLORS.warm) * 0.9, 'misma viveza');
    for (const v of out) assert.ok(v >= 0 && v <= 1);
});

test('a juego con el cielo: lo que ya está cerca no cambia, y un cielo gris no arrastra a nadie', () => {
    const same = (a, b) => assert.deepEqual(Array.from(a).map((v) => +v.toFixed(6)), Array.from(b).map((v) => +v.toFixed(6)));
    // El frío de los efectos, sobre el azul del día.
    same(harmonize(FX_COLORS.cool, [0.13, 0.27, 0.72], [0, 0, 0]), FX_COLORS.cool);
    // El rosa, en un ocaso rosa.
    same(harmonize(FX_COLORS.warm, [0.5, 0.11, 0.36], [0, 0, 0]), FX_COLORS.warm);
    // Sin cielo (negro, antes de leer la primera hora) o con un cielo gris.
    same(harmonize(FX_COLORS.warm, [0, 0, 0], [0, 0, 0]), FX_COLORS.warm);
    same(harmonize(FX_COLORS.warm, [0.3, 0.3, 0.3], [0, 0, 0]), FX_COLORS.warm);
    // Un gris no tiene tono que girar.
    same(harmonize([0.5, 0.5, 0.5], [0.13, 0.27, 0.72], [0, 0, 0]), [0.5, 0.5, 0.5]);
    // Girar es continuo: un cielo un poco distinto da un color un poco distinto.
    let prev = harmonize(FX_COLORS.warm, [0.13, 0.27, 0.72], [0, 0, 0]);
    for (let i = 1; i <= 60; i++) {
        const sky = [0.13 + i * 0.006, 0.27 - i * 0.003, 0.72 - i * 0.006];
        const next = harmonize(FX_COLORS.warm, sky, [0, 0, 0]);
        for (let k = 0; k < 3; k++) assert.ok(Math.abs(next[k] - prev[k]) < 0.04, `salto con el cielo ${sky.map((v) => v.toFixed(2))}`);
        prev = next;
    }
});

test('el playtest como regresión: a ninguna hora de ninguna escena un color de efecto queda lejos del cielo', () => {
    // Hasta ahora el rosa quedaba a 107° del azul del día y a ~90° del de la noche.
    for (const scene of SONG_COLOR_SCENES) {
        for (const hour of HOURS) {
            for (const turns of [0, 1 / 12, -2 / 12]) {
                const { colors, sky } = colorsAt(scene, hour, turns);
                for (const key of ['warm', 'cool']) {
                    const gap = hueGap(hueOf(colors[key]), hueOf(sky));
                    assert.ok(gap <= TONE_RULES.maxHueDeg + 2, `${scene.id} ${hour.toFixed(2)} h, ${key} girado ${turns.toFixed(2)}: a ${gap.toFixed(0)}° del cielo`);
                    for (const v of colors[key]) assert.ok(v >= 0 && v <= 1);
                }
            }
        }
    }
    // De día el cálido es un magenta; en el ocaso sigue siendo el rosa de siempre.
    const day = colorsAt(SCENES.mountains, 14.5).colors.warm;
    assert.ok(hueOf(day) > 320 && hueOf(day) < 345, `de día: ${hueOf(day).toFixed(0)}°`);
    const sunset = colorsAt(SCENES.mountains, 18.3).colors.warm;
    assert.ok(hueGap(hueOf(sunset), hueOf(FX_COLORS.warm)) < 12, `en el ocaso: ${hueOf(sunset).toFixed(0)}°`);
});

test('una escena que fija sus colores (una historia) los conserva tal cual', () => {
    const scene = SCENES['one-day'];
    for (const hour of [15, 18.9, 24, 29.5]) {
        const { colors } = colorsAt(scene, hour);
        assert.ok(hueGap(hueOf(colors.warm), 80) < 20 && hueGap(hueOf(colors.cool), 185) < 20, `${hour} h: oro y verde azulado`);
    }
});

test('las barras del espectro son color de punta a punta: sin gris en medio y bajo el techo', () => {
    assert.ok(BAR_SCENES.length >= 4);
    const ends = [0, 0];
    const light = [0, 0, 0];
    const shade = [0, 0, 0];
    for (const scene of BAR_SCENES) {
        for (const hour of HOURS) {
            const { colors, sky } = colorsAt(scene, hour);
            spectrumEnds(colors, ends);
            const skyLuma = proxyLuma(sky);
            let prevHue = null;
            for (let i = 0; i <= 35; i++) {
                const t = i / 35;
                spectrumLight(ends, t, light);
                spectrumShade(ends, t, skyLuma, shade);
                const where = `${scene.id} ${hour.toFixed(2)} h, barra ${i}`;
                // Bajo el techo de la franja jugable, como luz y en sombra.
                assert.ok(proxyLuma(light) <= FX_LIMIT.cap + 1e-6, where);
                assert.ok(proxyLuma(shade) <= proxyLuma(light) + 1e-6, where);
                // Color de verdad. (La mezcla de antes, del granate al azul acero
                // por sRGB, daba una viveza de 0.33 en los graves y 0.2 en el centro.)
                assert.ok(vividness(light) > 0.38, `${where}: viveza ${vividness(light).toFixed(3)}`);
                // En sombra (donde la sombra se ve), el mismo tono, igual de vivo.
                if (spectrumDay(skyLuma) > 0) {
                    assert.ok(hueGap(hueOf(shade), hueOf(light)) < 8, `${where}: en sombra, a ${hueGap(hueOf(shade), hueOf(light)).toFixed(1)}° de su luz`);
                    assert.ok(vividness(shade) > 0.34, `${where}: en sombra, viveza ${vividness(shade).toFixed(3)}`);
                }
                // Dentro del arco de tonos que brillan en oscuro, y sin saltos entre vecinas.
                const h = hueOf(light);
                assert.ok(inArc(h), `${where}: tono ${h.toFixed(0)}`);
                if (prevHue !== null) assert.ok(hueGap(h, prevHue) < 5, `${where}: salto de tono`);
                prevHue = h;
            }
            // De los graves a los agudos hay recorrido: no son todas del mismo color.
            assert.ok(Math.abs(ends[0] - ends[1]) > 40, `${scene.id} ${hour.toFixed(2)} h: rampa de ${Math.abs(ends[0] - ends[1]).toFixed(0)}°`);
        }
    }
});

test('cualquier par de colores da una rampa de barras con color: lo que no brilla en oscuro va a su extremo del arco', () => {
    const ends = [0, 0];
    const out = [0, 0, 0];
    // Oro y verde azulado (One Day), verde y amarillo, dos grises.
    for (const [warm, cool] of [[[1, 0.75, 0.33], [0.38, 0.84, 0.77]], [[0.2, 0.9, 0.3], [0.95, 0.9, 0.2]], [[0.5, 0.5, 0.5], [0.8, 0.8, 0.8]]]) {
        spectrumEnds({ warm, cool }, ends);
        for (const t of [0, 0.5, 1]) {
            spectrumLight(ends, t, out);
            assert.ok(inArc(hueOf(out)) && vividness(out) > 0.38 && proxyLuma(out) <= FX_LIMIT.cap + 1e-6, `${warm} → ${cool}, ${t}`);
        }
    }
});

test('una barra no desaparece contra su cielo: de día es sombra, de noche luz, y al anochecer las dos cosas', () => {
    const T = SPECTRUM_TONES;
    assert.ok(T.dusk[0] < T.dusk[1] && T.shade[0] < T.shade[1] && T.shade[1] < 1);
    const ends = [0, 0];
    spectrumEnds(FX_COLORS, ends);
    const light = [0, 0, 0];
    const shade = [0, 0, 0];
    let prevDay = -1;
    for (let k = 0; k <= 1.6; k += 0.02) {
        const sky = k * FX_LIMIT.cap;
        const day = spectrumDay(sky);
        assert.ok(day >= prevDay - 1e-9 && day >= 0 && day <= 1, 'cuanto más claro el cielo, más sombra');
        prevDay = day;
        for (const t of [0, 0.5, 1]) {
            spectrumLight(ends, t, light);
            spectrumShade(ends, t, sky, shade);
            // Contraste de la parte de la barra que se ve con el cielo (con el
            // sustituto de la luminancia, que es el que se limita).
            const asLight = (proxyLuma(light) + 0.05) / (sky + 0.05);
            const asShade = (sky + 0.05) / (proxyLuma(shade) + 0.05);
            // La luz solo cuenta donde hay luz (day < 1), y la sombra donde hay sombra (day > 0).
            const seen = Math.max(day < 1 ? asLight : 0, day > 0 ? asShade : 0);
            assert.ok(seen > 1.2, `cielo a ${k.toFixed(2)} techos, barra ${t}: contraste ${seen.toFixed(2)}`);
        }
    }
    // De noche, todo luz; a pleno día, todo sombra.
    assert.equal(spectrumDay(0.004), 0);
    assert.equal(spectrumDay(FX_LIMIT.cap), 1);
    // La luz de una barra es lo más claro que llega a ser: lo que mide el guardián.
    for (const t of [0, 0.3, 0.7, 1]) assert.ok(relativeLuminance(spectrumLight(ends, t, light)) <= FX_LIMIT.cap);
    // Y el techo sigue siendo el del limitador.
    assert.deepEqual(capColor([1, 1, 1], [0, 0, 0]).map((v) => +proxyLuma([v, v, v]).toFixed(4)), [FX_LIMIT.cap, FX_LIMIT.cap, FX_LIMIT.cap]);
});
