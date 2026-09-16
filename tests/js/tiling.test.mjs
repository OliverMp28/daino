// Tiras con textura repetida recortadas a la pantalla (Ola 6b).
//
// Regresión del playtest de la Ola 6a: el techo del pasillo de la antigravedad
// parecía una cinta de correr. Su textura se desplazaba el doble de rápido que el
// mundo porque, al recortar la tira por la izquierda, el desfase de la textura
// tenía el signo cambiado. Lo que se protege: la textura está anclada al MUNDO.
// Un punto del techo que está a k unidades del inicio del tramo muestra siempre
// el mismo píxel de la textura, se mueva como se mueva el tramo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clipTiledStrip } from '../../resources/js/game/systems/tiling.js';

const W = 32;
const mod = (a, n) => ((a % n) + n) % n;

/**
 * Píxel de la textura que un TilingSprite muestra en su píxel local `p`. Así lo
 * pinta Pixi v8: `TilingSpriteShader.updateUniforms` invierte la matriz de
 * `tilePosition`, de modo que el local `p` lee la textura en `p - tilePosition.x`.
 */
const texelAt = (strip, p) => mod(p - strip.tileX, W);
/** Distancia en la textura, que es circular (0 y W son el mismo píxel). */
const texelDistance = (a, b) => Math.min(Math.abs(a - b), W - Math.abs(a - b));

test('la textura queda anclada al inicio del tramo aunque la tira se recorte por la izquierda', () => {
    const left = 0;
    const right = 1100;
    for (let x0 = 900; x0 > -2000; x0 -= 7.3) {
        const x1 = x0 + 2400;
        const strip = clipTiledStrip(x0, x1, left, right, W);
        assert.ok(strip !== null);
        for (const k of [0, 5, 31, 32, 250, 1999]) {
            const worldX = x0 + k;
            if (worldX < strip.x || worldX >= strip.x + strip.width) continue;
            assert.ok(texelDistance(texelAt(strip, worldX - strip.x), mod(k, W)) < 1e-6, `x0=${x0.toFixed(1)}, k=${k}`);
        }
    }
});

test('recorte: dentro de la pantalla, del ancho visible, y nada si no se ve', () => {
    assert.deepEqual(clipTiledStrip(100, 300, 0, 1000, W), { x: 100, width: 200, tileX: 0 });
    const clipped = clipTiledStrip(-50, 300, 0, 1000, W);
    assert.equal(clipped.x, 0);
    assert.equal(clipped.width, 300);
    assert.equal(clipped.tileX, mod(-50, W));
    assert.equal(clipTiledStrip(900, 2000, 0, 1000, W).width, 100);
    assert.equal(clipTiledStrip(1200, 2000, 0, 1000, W), null);
    assert.equal(clipTiledStrip(-500, -10, 0, 1000, W), null);
    assert.equal(clipTiledStrip(10, 10.5, 0, 1000, W), null, 'menos de un píxel no se pinta');
});
