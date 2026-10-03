// El búfer del cielo (T05.1): el cielo se pinta a N texeles por celda del arte,
// alineado con las celdas, y cuesta lo mismo en cualquier pantalla.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { skyBufferFor, sameSkyGrid, skyBand, skyBandCount } from '../../resources/js/game/systems/skyGrid.js';
import { computeWorldView } from '../../resources/js/game/systems/worldView.js';
import { QUALITY_TIERS, TIER_ORDER, RENDER_PROFILES, resolveBudget } from '../../resources/js/game/RenderProfile.js';
import { LANDSCAPE, PORTRAIT } from './helpers/screens.mjs';

const LEVELS = TIER_ORDER.map((t) => QUALITY_TIERS[t].skyTexels);

test('el texel mide exactamente celda/N: las celdas del shader caen en fronteras de texel', () => {
    for (const [name, width, height, dpr] of [...LANDSCAPE, ...PORTRAIT]) {
        const v = computeWorldView({ width, height, dpr });
        for (const n of [...LEVELS, 99]) {
            const g = skyBufferFor(v, n);
            assert.ok(Number.isInteger(g.texels) && g.texels >= 1, `${name} ${n}: ${g.texels}`);
            assert.ok(Math.abs(g.texelPx * g.texels - v.cellPx) < 1e-9, `${name} ${n}: texel × N = celda`);
            assert.ok(Number.isInteger(g.width) && Number.isInteger(g.height), `${name} ${n}`);
        }
    }
});

test('el búfer cubre la pantalla entera y sobra menos de un texel por cada borde', () => {
    for (const [name, width, height, dpr] of [...LANDSCAPE, ...PORTRAIT]) {
        const v = computeWorldView({ width, height, dpr });
        for (const n of LEVELS) {
            const g = skyBufferFor(v, n);
            const skyW = g.width * g.texelPx;
            const skyH = g.height * g.texelPx;
            assert.ok(skyW >= width - 1e-6 && skyH >= height - 1e-6, `${name} ${n}: cubre`);
            assert.ok(skyW - width < g.texelPx + 1e-6, `${name} ${n}: sobra ${(skyW - width).toFixed(2)} px de ancho`);
            assert.ok(skyH - height < g.texelPx + 1e-6, `${name} ${n}: sobra de alto`);
            assert.ok(Math.abs(g.frameScale[0] - skyW / width) < 1e-12 && g.frameScale[0] >= 1 && g.frameScale[1] >= 1, name);
        }
    }
});

test('nunca más texeles que píxeles: con el detalle al máximo, el búfer es la pantalla', () => {
    for (const [name, width, height, dpr] of LANDSCAPE) {
        const v = computeWorldView({ width, height, dpr });
        const g = skyBufferFor(v, 99);
        assert.equal(g.texels, v.cellDevicePx, name);
        assert.equal(g.native, v.cellDevicePx, name);
        assert.ok(Math.abs(g.texelPx * dpr - 1) < 1e-9, `${name}: un texel = un píxel de dispositivo`);
        assert.equal(g.width, Math.ceil(width * dpr - 1e-6), name);
        for (const n of LEVELS) assert.ok(skyBufferFor(v, n).texels <= v.cellDevicePx, `${name} ${n}`);
    }
});

test('a igual detalle, el cielo cuesta lo mismo en un portátil, en un 4K y en un móvil', () => {
    const wide = LANDSCAPE.filter(([, w, h]) => Math.abs(w / h - 16 / 9) < 0.01);
    assert.ok(wide.length >= 6);
    for (const n of [4, 2]) {
        const pixels = wide.map(([name, width, height, dpr]) => {
            const g = skyBufferFor(computeWorldView({ width, height, dpr }), n);
            return [name, g.width * g.height];
        });
        const min = Math.min(...pixels.map((p) => p[1]));
        const max = Math.max(...pixels.map((p) => p[1]));
        // No es idéntico porque no lo es el mundo que se ve (de 1024 a 1138 de ancho);
        // antes iba de 0,9 a 8,3 millones de píxeles.
        assert.ok(max / min < 1.3, `${n} texeles: de ${min} a ${max} píxeles (${JSON.stringify(pixels)})`);
    }
    // Antes el cielo se pintaba a los píxeles de la pantalla: en 4K, 8,3 millones.
    const uhd = computeWorldView({ width: 3840, height: 2160, dpr: 1 });
    const g = skyBufferFor(uhd, QUALITY_TIERS.high.skyTexels);
    assert.ok(g.width * g.height < 3840 * 2160 / 5, `${g.width}×${g.height}`);
    // Y un móvil de DPR alto ya no lo pinta a su resolución entera.
    const phone = computeWorldView({ width: 915, height: 412, dpr: 2.625 });
    const p = skyBufferFor(phone, QUALITY_TIERS.medium.skyTexels);
    assert.ok(p.width * p.height < 915 * 412 * 2.625 * 2.625 / 2.5, `${p.width}×${p.height}`);
});

test('los niveles de calidad bajan el detalle del cielo, siempre en texeles pares (la luna va a media celda)', () => {
    assert.deepEqual([...TIER_ORDER], ['high', 'medium', 'low']);
    for (let i = 0; i < LEVELS.length; i++) {
        assert.equal(LEVELS[i] % 2, 0, `${TIER_ORDER[i]}: ${LEVELS[i]}`);
        if (i > 0) assert.ok(LEVELS[i] < LEVELS[i - 1], TIER_ORDER[i]);
    }
    // 1080p: Alta pinta 3/4 de los píxeles de la pantalla; Media, un tercio; Baja, un doceavo.
    const v = computeWorldView({ width: 1920, height: 1080, dpr: 1 });
    const share = (tier) => { const g = skyBufferFor(v, QUALITY_TIERS[tier].skyTexels); return g.width * g.height / (1920 * 1080); };
    assert.ok(share('high') > 0.7 && share('high') < 0.78, String(share('high')));
    assert.ok(share('medium') > 0.3 && share('medium') < 0.36, String(share('medium')));
    assert.ok(share('low') > 0.07 && share('low') < 0.1, String(share('low')));
});

test('cada estado dice a qué ritmo se repinta el cielo, y nunca más que el de sus fotogramas', () => {
    for (const [name, p] of Object.entries(RENDER_PROFILES)) {
        assert.ok(p.skyHz > 0, name);
        if (p.maxFPS > 0) assert.ok(p.skyHz <= p.maxFPS, `${name}: cielo a ${p.skyHz} con ${p.maxFPS} fps`);
    }
    assert.equal(RENDER_PROFILES.PLAYING.maxFPS, 0, 'la partida, a los fotogramas de la pantalla');
    assert.equal(RENDER_PROFILES.PLAYING.skyHz, 30);
    const b = resolveBudget('PLAYING', 'medium', 'half');
    assert.deepEqual([b.skyTexels, b.skyHz, b.pace, b.particleRatio], [4, 30, 'half', 1]);
    assert.equal(resolveBudget('NOPE', 'nope', 'nope').pace, 'native', 'lo desconocido cae en lo de siempre');
});

test('un cambio de tamaño que no cambia el búfer no lo recrea', () => {
    const v = computeWorldView({ width: 1920, height: 1080, dpr: 1 });
    assert.ok(sameSkyGrid(skyBufferFor(v, 4), skyBufferFor(v, 4)));
    assert.ok(!sameSkyGrid(skyBufferFor(v, 4), skyBufferFor(v, 2)));
    assert.ok(!sameSkyGrid(null, skyBufferFor(v, 4)));
});

test('las bandas se reparten las filas del cielo sin dejarse ninguna, y su uv es la de la pantalla', () => {
    for (const [name, width, height, dpr] of LANDSCAPE) {
        const v = computeWorldView({ width, height, dpr });
        for (const n of LEVELS) {
            const g = skyBufferFor(v, n);
            assert.ok(Math.abs(g.spriteWidth - g.width * g.texelPx) < 1e-9 && Math.abs(g.spriteHeight - g.height * g.texelPx) < 1e-9, name);
            for (const count of [1, 2, 3, 4, 5, 6]) {
                let row = 0;
                let uvEnd = 0;
                for (let i = 0; i < count; i++) {
                    const b = skyBand(g, i, count);
                    assert.equal(b.row, row, `${name} ${n}/${count}: la banda ${i} empieza donde acabó la anterior`);
                    // Cada fotograma pinta casi lo mismo: ninguno sale más caro que otro.
                    assert.ok(Math.abs(b.rows - g.height / count) < 1, `${name} ${n}/${count}: ${b.rows} filas`);
                    assert.ok(Math.abs(b.uv[1] - uvEnd) < 1e-9, `${name}: uv continua`);
                    assert.deepEqual([b.uv[0], b.uv[2]], [0, g.frameScale[0]]);
                    // Una fila del búfer mide un texel de pantalla: las celdas del shader caen en su sitio.
                    assert.ok(Math.abs(b.uv[3] * height - b.rows * g.texelPx) < 1e-6, `${name}: ${b.rows} filas`);
                    row += b.rows;
                    uvEnd = b.uv[1] + b.uv[3];
                }
                assert.equal(row, g.height, `${name} ${n}/${count}: todas las filas`);
                assert.ok(Math.abs(uvEnd - g.frameScale[1]) < 1e-9, name);
            }
        }
    }
    // Más bandas que filas no tiene sentido.
    const tiny = { width: 4, height: 3, frameScale: [1, 1], texelPx: 1 };
    assert.deepEqual([0, 1, 2].map((i) => skyBand(tiny, i, 6).rows), [1, 1, 1]);
});

test('en cuántas bandas se reparte cada imagen del cielo: una por fotograma hasta sacar skyHz por segundo', () => {
    const ms = (fps) => 1000 / fps;
    assert.equal(skyBandCount(ms(60), 30), 2, 'partida a 60: dos bandas');
    assert.equal(skyBandCount(ms(30), 30), 1, 'a 30 estables: entera cada fotograma');
    assert.equal(skyBandCount(ms(120), 30), 4);
    assert.equal(skyBandCount(ms(144), 30), 5);
    assert.equal(skyBandCount(ms(30), RENDER_PROFILES.MENU.skyHz), 3, 'el menú');
    assert.equal(skyBandCount(ms(15), RENDER_PROFILES.PAUSED.skyHz), 3, 'la pausa');
    assert.equal(skyBandCount(ms(240), 5), 6, 'con tope');
    assert.equal(skyBandCount(ms(60), 0), 1);
    assert.equal(skyBandCount(ms(60), 240), 1, 'no se pinta más de una vez por fotograma');
});
