// Vista del mundo (tamaños de pantalla, Sep 2026): cualquier pantalla apaisada
// enseña casi el mismo mundo, con el píxel del arte entero y tiempo de sobra
// para ver venir un obstáculo a la velocidad máxima.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeWorldView, readAheadS, sameView } from '../../resources/js/game/systems/worldView.js';
import { WORLD_VIEW, GROUND_OFFSET_PX, PIXEL_SCALE, DINO_SIZE, JUMP_VELOCITY, GRAVITY, FLIP_MODE } from '../../resources/js/game/config.js';
import { SPEED_RULES } from '../../resources/js/game/levels/speedPlan.js';
import { ceilingYOf } from '../../resources/js/game/systems/geometry.js';

/** Pantallas reales: [nombre, ancho CSS, alto CSS, devicePixelRatio]. */
const LANDSCAPE = [
    ['iPhone SE apaisado', 667, 375, 2],
    ['iPhone 13 apaisado', 844, 390, 3],
    ['Android apaisado', 915, 412, 2.625],
    ['móvil con barras del navegador', 740, 300, 3],
    ['iPad apaisado', 1024, 768, 2],
    ['720p', 1280, 720, 1],
    ['portátil 1366', 1366, 768, 1],
    ['MacBook', 1440, 900, 2],
    ['portátil 125 %', 1536, 864, 1.25],
    ['1080p', 1920, 1080, 1],
    ['1440p', 2560, 1440, 1],
    ['1440p al 150 %', 1707, 960, 1.5],
    ['4K', 3840, 2160, 1],
    ['4K al 200 %', 1920, 1080, 2],
    ['ultrapanorámico 21:9', 3440, 1440, 1],
    ['super ultrapanorámico 32:9', 5120, 1440, 1],
];

test('la celda del arte ocupa siempre un número entero de píxeles de dispositivo', () => {
    for (const [name, width, height, dpr] of [...LANDSCAPE, ['vertical', 390, 844, 3], ['tablet vertical', 768, 1024, 2]]) {
        const v = computeWorldView({ width, height, dpr });
        assert.ok(Number.isInteger(v.cellDevicePx) && v.cellDevicePx >= 1, `${name}: ${v.cellDevicePx}`);
        assert.ok(Math.abs(v.scale * PIXEL_SCALE * dpr - v.cellDevicePx) < 1e-9, name);
        assert.ok(Math.abs(v.width * v.scale - width) < 1e-6 && Math.abs(v.height * v.scale - height) < 1e-6, name);
        assert.equal(v.groundY, v.height - GROUND_OFFSET_PX);
        assert.ok(Math.abs(v.screenGroundY - v.groundY * v.scale) < 1e-6, `${name}: el suelo del shader es el del mundo`);
    }
});

test('en pantalla apaisada nunca se ve menos del mínimo: a la velocidad máxima hay ≥ 1.0 s para ver venir cada obstáculo', () => {
    // Ola 6a: el techo pasó de 690 a 820 px/s (la velocidad se notaba poco). El
    // legacy acababa sus canciones con 0.74 s de lectura.
    for (const [name, width, height, dpr] of LANDSCAPE) {
        const v = computeWorldView({ width, height, dpr });
        assert.ok(v.width >= WORLD_VIEW.minWidth - 1e-6, `${name}: ancho ${v.width.toFixed(0)}`);
        assert.ok(v.height >= WORLD_VIEW.minHeight - 1e-6, `${name}: alto ${v.height.toFixed(0)}`);
        assert.ok(v.width <= WORLD_VIEW.maxWidth * 1.08, `${name}: ancho ${v.width.toFixed(0)} (no se diluye)`);
        const read = readAheadS(v, SPEED_RULES.maxSpeedPxS);
        assert.ok(read >= 1.0, `${name}: ${read.toFixed(2)} s a ${SPEED_RULES.maxSpeedPxS}/s`);
    }
});

test('toda pantalla 16:9 ve casi el mismo mundo, de un portátil a un 4K (antes: de 1366 a 3840 de ancho)', () => {
    const widths = LANDSCAPE
        .filter(([, w, h]) => Math.abs(w / h - 16 / 9) < 0.01)
        .map(([name, width, height, dpr]) => [name, computeWorldView({ width, height, dpr }).width]);
    assert.ok(widths.length >= 6);
    for (const [name, w] of widths) {
        assert.ok(w >= 1020 && w <= 1150, `${name}: ${w.toFixed(0)} de mundo`);
    }
    // Y a la velocidad típica de un clímax, entre 1.5 y 1.8 s de lectura (antes 1.2-6.4 s).
    for (const [name, w] of widths) {
        const read = readAheadS({ width: w }, 572);
        assert.ok(read > 1.5 && read < 1.8, `${name}: ${read.toFixed(2)} s`);
    }
});

test('el salto completo, el ptero y el HUD caben siempre por encima del suelo', () => {
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY) + DINO_SIZE.h;
    const HUD_CSS_PX = 84;
    for (const [name, width, height, dpr] of LANDSCAPE) {
        const v = computeWorldView({ width, height, dpr });
        const hudWorld = HUD_CSS_PX / v.scale;
        assert.ok(v.groundY - apex > hudWorld, `${name}: la cabeza del Dino en el ápice (${(v.groundY - apex).toFixed(0)}) queda bajo el HUD (${hudWorld.toFixed(0)})`);
    }
});

test('el pasillo de la antigravedad y la franja de su techo caben siempre bajo el HUD', () => {
    const HUD_CSS_PX = 84;
    const RAIL_WORLD = 44;
    for (const [name, width, height, dpr] of LANDSCAPE) {
        const v = computeWorldView({ width, height, dpr });
        const railTop = ceilingYOf(v.groundY) - RAIL_WORLD;
        assert.ok(railTop > HUD_CSS_PX / v.scale, `${name}: la franja del techo (${railTop.toFixed(0)}) queda bajo el HUD (${(HUD_CSS_PX / v.scale).toFixed(0)})`);
    }
    assert.ok(FLIP_MODE.ceilingAbovePx - DINO_SIZE.h > 180, 'el Dino tiene recorrido de sobra entre suelo y techo');
});

test('en un móvil apaisado el mundo se reduce en vez de recortarse: más lectura que antes', () => {
    const phone = computeWorldView({ width: 844, height: 390, dpr: 3 });
    assert.ok(phone.scale < 1);
    assert.ok(readAheadS(phone, SPEED_RULES.maxSpeedPxS) > readAheadS({ width: 844 }, SPEED_RULES.maxSpeedPxS) + 0.4);
});

test('en vertical manda el ancho mínimo: se ve el mismo trecho por delante, con mucho cielo', () => {
    const v = computeWorldView({ width: 390, height: 844, dpr: 3 });
    assert.ok(v.width >= WORLD_VIEW.minWidth - 1e-6);
    assert.ok(v.height > v.width, 'el alto sobra: por eso se sugiere girar el móvil');
});

test('entradas raras no rompen la vista', () => {
    for (const s of [{ width: 0, height: 0 }, { width: 200, height: 100, dpr: 0 }, { width: 50, height: 900, dpr: NaN }]) {
        const v = computeWorldView(s);
        assert.ok(Number.isFinite(v.scale) && v.scale > 0);
        assert.ok(Number.isFinite(v.width) && Number.isFinite(v.height));
    }
});

test('sameView: un resize que no cambia la escala ni la pantalla no toca la escena', () => {
    const a = computeWorldView({ width: 1920, height: 1080, dpr: 1 });
    assert.ok(sameView(a, computeWorldView({ width: 1920, height: 1080, dpr: 1 })));
    assert.ok(!sameView(a, computeWorldView({ width: 1920, height: 1000, dpr: 1 })));
    assert.ok(!sameView(null, a));
});
