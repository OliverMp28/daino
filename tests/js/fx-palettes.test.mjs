// Paletas de los efectos y la identidad de un nivel (T03.3, doc 11).
//
// Una paleta es una intención: lo que se pinta es lo que queda tras ponerla a
// juego con el cielo de cada hora. Por eso se mide ESO, en todas las escenas y
// horas: que su tono no salte, que siga teniendo color y que se distinga de las
// demás. Un naranja o un oro no pasan (el cielo de detrás va del azul al
// magenta), y este test guarda por qué.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFxDirector } from '../../resources/js/game/fx/director.js';
import { DEFAULT_FX_IDENTITY, SIGNATURE_IDS, fxIdentityOf, isSignature, resolveFxIdentity } from '../../resources/js/game/fx/identity.js';
import { PALETTE_RULES, measurePalettes, paletteIssues } from '../../resources/js/game/fx/paletteCheck.js';
import { DEFAULT_PALETTE, FX_PALETTES, PALETTE_IDS, isPalette } from '../../resources/js/game/fx/palettes.js';
import { FX, FX_COLORS } from '../../resources/js/game/fx/registry.js';
import { createFxSignals, readSkySignals } from '../../resources/js/game/fx/signals.js';
import { TONE_RULES, harmonize, hueOf, spectrumEnds } from '../../resources/js/game/fx/tones.js';
import { hexToRgb } from '../../resources/js/game/scenes/color.js';
import { SCENES, SCENE_ID_PATTERN } from '../../resources/js/game/scenes/registry.js';
import { createSkyState, skyStateAt } from '../../resources/js/game/scenes/skyModel.js';

const hueGap = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

function skySignals(sceneId, hour) {
    const state = createSkyState();
    const s = createFxSignals();
    skyStateAt(hour, SCENES[sceneId], state);
    readSkySignals(state, SCENES[sceneId], s);
    return s;
}

test('cada paleta tiene nombre, descripción y dos colores; la de siempre es Neón, el rosa y el cian de los efectos', () => {
    assert.ok(PALETTE_IDS.length >= 4 && PALETTE_IDS.length <= 6, 'pocas y distintas');
    const labels = new Set();
    for (const [id, p] of Object.entries(FX_PALETTES)) {
        assert.match(id, SCENE_ID_PATTERN, `${id}: se guarda en la base de datos con la forma de un id`);
        assert.ok(p.label.length > 2 && p.blurb.length > 5, id);
        assert.ok(!labels.has(p.label), `${id}: nombre repetido`);
        labels.add(p.label);
        for (const c of [p.warm, p.cool]) {
            assert.equal(c.length, 3, id);
            for (const v of c) assert.ok(v >= 0 && v <= 1, id);
        }
        assert.ok(Object.isFrozen(p) && Object.isFrozen(p.warm), `${id}: congelada`);
    }
    assert.equal(DEFAULT_PALETTE, 'neon');
    assert.equal(FX_PALETTES.neon.warm, FX_COLORS.warm, 'Neón es la de siempre: ni un píxel cambia en un nivel sin reparto');
    assert.equal(FX_PALETTES.neon.cool, FX_COLORS.cool);
    assert.ok(isPalette('ultra') && !isPalette('toString') && !isPalette('oro') && !isPalette(null));
});

test('las tres medidas: cada paleta es estable, viva y distinta de las demás, en todos los ambientes y a todas las horas', () => {
    const measured = measurePalettes(FX_PALETTES);
    assert.deepEqual(paletteIssues(measured), []);
    // Con margen: nada al borde de las reglas.
    for (const [id, m] of Object.entries(measured.palettes)) {
        assert.ok(m.hueJump < PALETTE_RULES.maxHueJumpDeg - 5, `${id}: salto de ${m.hueJump.toFixed(1)}° (${m.hueJumpAt})`);
    }
    assert.ok(measured.pairs[0].distance > PALETTE_RULES.minDistance + 0.01, `las más parecidas: ${measured.pairs[0].a} y ${measured.pairs[0].b}, ${measured.pairs[0].distance.toFixed(3)}`);
    // Todas las parejas se han medido.
    assert.equal(measured.pairs.length, (PALETTE_IDS.length * (PALETTE_IDS.length - 1)) / 2);
});

test('por qué no hay naranja ni oro: el cielo los vuelve rosa, y el oro salta de color a media tarde', () => {
    const pair = (warm, cool) => ({ warm: hexToRgb(warm), cool: hexToRgb(cool) });
    // Oro y melocotón: casi opuestos al azul del día. Caen a un lado u otro del
    // cielo según la hora.
    const gold = measurePalettes({ gold: pair('#ffc93c', '#ff8a5c') });
    assert.ok(gold.palettes.gold.hueJump > 60, `el oro salta ${gold.palettes.gold.hueJump.toFixed(0)}° (${gold.palettes.gold.hueJumpAt})`);
    assert.ok(paletteIssues(gold).some((i) => /salta/.test(i)));
    // Brasa (naranja y ámbar): de noche, ninguno de los dos sigue siendo cálido.
    const ember = pair('#ff5a2a', '#ffc24a');
    const night = skySignals('mountains', 22).sky.band;
    for (const c of [ember.warm, ember.cool]) {
        const seen = harmonize(c, night, [0, 0, 0]);
        assert.ok(hueGap(hueOf(seen), hueOf(c)) > 35, `un naranja de noche se pinta a ${hueOf(seen).toFixed(0)}° (era ${hueOf(c).toFixed(0)}°)`);
    }
    // Y la regla general: a ninguna hora de ningún ambiente, un color de una
    // paleta queda lejos del cielo que tiene detrás.
    for (const sc of Object.values(SCENES)) {
        if (sc.kind !== 'ambient') continue;
        for (let h = 13; h <= 30.6; h += 0.25) {
            const band = skySignals(sc.id, h).sky.band;
            for (const [id, p] of Object.entries(FX_PALETTES)) {
                for (const c of [p.warm, p.cool]) {
                    const seen = harmonize(c, band, [0, 0, 0]);
                    assert.ok(hueGap(hueOf(seen), hueOf(band)) <= TONE_RULES.maxHueDeg + 1.5, `${id} en ${sc.id} a las ${h}: a ${hueGap(hueOf(seen), hueOf(band)).toFixed(0)}° del cielo`);
                }
            }
        }
    }
});

test('cada paleta da su propia rampa en las barras del espectro', () => {
    const night = skySignals('mountains', 22).sky.band;
    const ends = {};
    for (const [id, p] of Object.entries(FX_PALETTES)) {
        const colors = { warm: harmonize(p.warm, night, [0, 0, 0]), cool: harmonize(p.cool, night, [0, 0, 0]) };
        ends[id] = spectrumEnds(colors, [0, 0]);
    }
    for (let i = 0; i < PALETTE_IDS.length; i++) {
        for (let j = i + 1; j < PALETTE_IDS.length; j++) {
            const a = ends[PALETTE_IDS[i]];
            const b = ends[PALETTE_IDS[j]];
            assert.ok(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) >= 10, `${PALETTE_IDS[i]} y ${PALETTE_IDS[j]} pintan las mismas barras: ${a} / ${b}`);
        }
    }
});

test('la identidad de un nivel: lo que el servidor repartió, o lo de siempre; lo que el cliente no conoce se ignora', () => {
    assert.equal(DEFAULT_FX_IDENTITY.paletteId, 'neon');
    assert.equal(DEFAULT_FX_IDENTITY.signature, null);
    assert.deepEqual(SIGNATURE_IDS, ['aurora', 'meteors']);
    assert.deepEqual(resolveFxIdentity(null), DEFAULT_FX_IDENTITY, 'canción local');
    assert.deepEqual(resolveFxIdentity({ fx_auto: null }), DEFAULT_FX_IDENTITY, 'nivel sin analizar por el servidor');

    const hope = resolveFxIdentity({ fx_auto: { palette: 'rose', signature: 'aurora' } });
    assert.equal(hope.paletteId, 'rose');
    assert.equal(hope.palette, FX_PALETTES.rose);
    assert.equal(hope.signature, 'aurora');
    assert.equal(resolveFxIdentity({ fx_auto: { signature: 'meteors' } }).paletteId, 'neon', 'solo firma');
    assert.equal(resolveFxIdentity({ fx_auto: { palette: 'ice' } }).signature, null, 'solo paleta');

    // Un servidor más nuevo que este cliente, o un valor roto.
    for (const bad of [{ palette: 'oro', signature: 'cometa' }, { palette: 'toString', signature: 'spectrum' }, { palette: 7, signature: ['aurora'] }, 'ultra', 42, []]) {
        assert.deepEqual(fxIdentityOf(bad), DEFAULT_FX_IDENTITY, JSON.stringify(bad));
    }
    assert.ok(isSignature('aurora') && !isSignature('spectrum') && !isSignature('hasOwnProperty'));
    for (const id of SIGNATURE_IDS) assert.equal(FX[id].family, 'signature');
});

test('el director pinta con la paleta de la canción; una escena que fija sus colores sigue mandando', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains, palette: FX_PALETTES.ultra });
    const s = skySignals('mountains', 22);
    s.playing = true;
    d.update(s, 1 / 60);
    // Ultravioleta ya está cerca del cielo de la noche: se pinta tal cual.
    assert.deepEqual(d.colors.warm.map((v) => +v.toFixed(3)), FX_PALETTES.ultra.warm.map((v) => +v.toFixed(3)));
    assert.deepEqual(d.colors.cool.map((v) => +v.toFixed(3)), FX_PALETTES.ultra.cool.map((v) => +v.toFixed(3)));

    // null vuelve a la de siempre.
    d.configure({ palette: null });
    d.update(s, 1 / 60);
    assert.deepEqual(d.colors.cool.map((v) => +v.toFixed(3)), FX_COLORS.cool.map((v) => +v.toFixed(3)));

    // One Day: su oro y su verde azulado, elija lo que elija el reparto.
    d.configure({ scene: SCENES['one-day'], palette: FX_PALETTES.fucsia, signature: 'aurora' });
    d.update(s, 1 / 60);
    assert.deepEqual(d.colors.warm, hexToRgb(SCENES['one-day'].fx.colors.warm));
    assert.deepEqual(d.colors.cool, hexToRgb(SCENES['one-day'].fx.colors.cool));
});
