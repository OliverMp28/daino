// Los efectos no tapan lo que se juega ni destellan (T03.1, doc 11).
//
// El guardián de legibilidad (scenes/readability.js) medía el cielo sin efectos.
// Ahora mide también el cielo CON ellos, en el peor caso: dentro de la franja
// jugable toda la luz de los efectos pasa por un limitador (fx/limiter.js), así
// que la prueba no depende de la fórmula de cada efecto. Suponiendo que un efecto
// sumara luz sin límite, lo que se juega se sigue leyendo a cualquier hora de
// cualquier escena.
//
// Y nada de pantalla destella más de tres veces por segundo (WCAG 2.3.1): lo que
// late con el pulso no llega a ser un destello (fx/flashSafety.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FLASH_RULES, maxDimFor } from '../../resources/js/game/fx/flashSafety.js';
import { FX_LIMIT, capColor, limitFx, limiterWeight, proxyLuma } from '../../resources/js/game/fx/limiter.js';
import { FX_COLORS, FX_IDS } from '../../resources/js/game/fx/registry.js';
import { createFxSignals, readSkySignals } from '../../resources/js/game/fx/signals.js';
import { applyCalm, createSkyAmounts, skyAmounts } from '../../resources/js/game/fx/skyAmounts.js';
import { relativeLuminance } from '../../resources/js/game/scenes/color.js';
import { READABILITY_RULES, checkReadability, heightToSkyFrac, playSubjects } from '../../resources/js/game/scenes/readability.js';
import { SCENES } from '../../resources/js/game/scenes/registry.js';
import { createSkyState, skyColorAt, skyStateAt } from '../../resources/js/game/scenes/skyModel.js';
import { WORLD_VIEW } from '../../resources/js/game/config.js';
import { Seeded } from '../../resources/js/game/levels/Seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** El fondo más claro que aún deja leer cada cosa que se juega, y el menor de todos. */
function readableCeiling() {
    let cap = Infinity;
    for (const s of playSubjects()) cap = Math.min(cap, (relativeLuminance(s.color) + 0.05) / s.min - 0.05);
    return cap;
}

test('el techo del limitador cabe bajo lo que necesita lo más difícil de leer, con margen', () => {
    const ceiling = readableCeiling();
    assert.ok(ceiling > 0.085 && ceiling < 0.1, `techo de legibilidad: ${ceiling.toFixed(4)}`);
    // El sustituto de la luminancia queda por encima de la real en el rango que
    // importa: limitar el sustituto limita la real.
    const rng = new Seeded(7);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
        const c = [rng.next(), rng.next(), rng.next()];
        const p = proxyLuma(c);
        if (p > FX_LIMIT.cap) {
            const k = Math.sqrt(FX_LIMIT.cap / p);
            for (let j = 0; j < 3; j++) c[j] *= k;
        }
        worst = Math.max(worst, relativeLuminance(c));
    }
    assert.ok(worst < ceiling - 0.008, `con el sustituto en su techo, la luminancia real llega a ${worst.toFixed(4)} (máximo ${ceiling.toFixed(4)})`);
    // La franja que protege es la del guardián.
    assert.equal(FX_LIMIT.playTopPx, READABILITY_RULES.dinoTopPx);
    assert.equal(limiterWeight(0), 1);
    assert.equal(limiterWeight(FX_LIMIT.playTopPx), 1);
    assert.equal(limiterWeight(FX_LIMIT.playTopPx + FX_LIMIT.softPx), 0);
    assert.ok(limiterWeight(FX_LIMIT.playTopPx + FX_LIMIT.softPx / 2) > 0.4);
});

test('el limitador: la luz de un efecto nunca sube el fondo por encima del techo (o de sí mismo), y sin efecto no cambia nada', () => {
    const rng = new Seeded(21);
    const out = [0, 0, 0];
    for (let i = 0; i < 20000; i++) {
        const base = [rng.next() * 0.5, rng.next() * 0.5, rng.next() * 0.6];
        const lit = [base[0] + rng.next() * 2, base[1] + rng.next() * 2, base[2] + rng.next() * 2];
        limitFx(base, lit, out);
        assert.ok(proxyLuma(out) <= Math.max(proxyLuma(base), FX_LIMIT.cap) + 1e-9, `${base} + luz → ${out}`);
        for (let k = 0; k < 3; k++) assert.ok(out[k] >= base[k] - 1e-12 && out[k] <= lit[k] + 1e-12, 'queda entre el fondo y la luz');
    }
    // Sin efecto, o con un efecto que oscurece, el color pasa tal cual.
    assert.deepEqual(limitFx([0.2, 0.3, 0.6], [0.2, 0.3, 0.6], out), [0.2, 0.3, 0.6]);
    assert.deepEqual(limitFx([0.2, 0.3, 0.6], [0.1, 0.1, 0.2], out), [0.1, 0.1, 0.2]);
    // De noche hay sitio: una luz moderada pasa entera.
    const night = [0.02, 0.02, 0.06];
    const glow = [0.1, 0.05, 0.12];
    assert.deepEqual(limitFx(night, glow, out), glow);
    // Por encima de la franja jugable (peso 0) no limita.
    assert.deepEqual(limitFx(night, [1, 1, 1], out, 0), [1, 1, 1]);
});

test('guardián con efectos a tope: aunque sumaran luz sin límite, lo que se juega se lee a cualquier hora de cualquier escena', () => {
    const s = createSkyState();
    const out = [0, 0, 0];
    // Lo peor que puede pedir un efecto: blanco, y los dos colores de los efectos a tope.
    const floods = [[1, 1, 1], [...FX_COLORS.warm], [...FX_COLORS.cool], [1, 0.2, 0.9], [0.2, 1, 0.3]];
    for (const sc of Object.values(SCENES)) {
        for (let h = 0; h <= 31; h += 0.05) {
            skyStateAt(h, sc, s);
            for (const flood of floods) {
                const fails = checkReadability(s, sc, {
                    sky: (rgb, heightPx) => {
                        const lit = [rgb[0] + flood[0] * 3, rgb[1] + flood[1] * 3, rgb[2] + flood[2] * 3];
                        return [...limitFx(rgb, lit, out, limiterWeight(heightPx))];
                    },
                });
                assert.deepEqual(fails, [], `${sc.id} a las ${h.toFixed(2)} con luz ${flood}: ${JSON.stringify(fails[0])}`);
            }
        }
    }
});

test('la calma del break apaga el color sin borrar lo que se juega', () => {
    const s = createSkyState();
    const out = [0, 0, 0];
    // Solo oscurece: nunca deja el cielo más claro.
    const rng = new Seeded(3);
    for (let i = 0; i < 5000; i++) {
        const c = [rng.next(), rng.next(), rng.next()];
        assert.ok(relativeLuminance(applyCalm(c, 1, out)) <= relativeLuminance(c) + 1e-9, `${c}`);
    }
    for (const sc of Object.values(SCENES)) {
        for (let h = 0; h <= 31; h += 0.25) {
            skyStateAt(h, sc, s);
            const fails = checkReadability(s, sc, { sky: (rgb) => [...applyCalm(rgb, 1, out)] });
            assert.deepEqual(fails, [], `${sc.id} a las ${h.toFixed(2)}: ${JSON.stringify(fails[0])}`);
        }
    }
});

test('los colores de las barras del espectro: el mismo tono, bajado al techo', () => {
    const out = [0, 0, 0];
    const ceiling = readableCeiling();
    const rng = new Seeded(99);
    for (let i = 0; i < 5000; i++) {
        const c = [rng.next(), rng.next(), rng.next()];
        capColor(c, out);
        assert.ok(proxyLuma(out) <= FX_LIMIT.cap + 1e-9);
        assert.ok(relativeLuminance(out) < ceiling);
        // Mismo tono: los canales guardan su proporción.
        const k = out[0] / (c[0] || 1);
        if (c[0] > 0.05) for (let j = 1; j < 3; j++) assert.ok(Math.abs(out[j] - c[j] * k) < 1e-9);
    }
    // Un color ya oscuro no se toca.
    assert.deepEqual(capColor([0.1, 0.05, 0.2], out), [0.1, 0.05, 0.2]);
    // Mezclado con cualquier opacidad sobre un fondo que pasa, el resultado pasa:
    // queda entre los dos, y los dos están bajo el techo.
    const warm = capColor(FX_COLORS.warm, [0, 0, 0]);
    const sky = [0.02, 0.03, 0.09];
    for (let a = 0; a <= 1; a += 0.1) {
        const mix = sky.map((v, j) => v + (warm[j] - v) * a);
        assert.ok(relativeLuminance(mix) < ceiling);
    }
});

test('destellos: lo que late con el pulso no llega a ser un destello, ni de día ni en una subida a contratiempo', () => {
    assert.ok(FLASH_RULES.maxBeatDelta < FLASH_RULES.flashDelta);
    assert.equal(FLASH_RULES.maxPerSecond, 3);
    const levels = Object.fromEntries(FX_IDS.map((id) => [id, 1]));
    const sky = createSkyState();
    const tmp = [0, 0, 0];
    const lim = [0, 0, 0];
    const out = createSkyAmounts();
    let dayDim = Infinity;
    let nightDim = 0;
    for (const sc of Object.values(SCENES)) {
        const rise = sc.horizonRise ?? 0;
        for (let h = 0; h <= 31; h += 0.1) {
            skyStateAt(h, sc, sky);
            // El peor caso: el tramo más intenso y una subida entera. El cielo
            // respira hacia abajo: lo más oscuro es justo antes del golpe (pulso 0)
            // y en el golpe vuelve a su brillo.
            const s = createFxSignals();
            s.playing = true;
            s.beat.world = 0;
            s.beat.pulse = 0;
            s.song.intensity = 1;
            s.song.build = 1;
            s.song.climax = 1;
            s.live.bass = 1;
            s.live.high = 1;
            readSkySignals(sky, sc, s);
            skyAmounts(levels, s, out);
            const dim = out.b[3];
            if (sky.elev > 20) dayDim = Math.min(dayDim, dim);
            if (sky.night > 0.9) nightDim = Math.max(nightDim, dim);
            // El cielo entero, a cualquier altura: del golpe (su brillo) a lo más oscuro.
            for (let px = 0; px <= WORLD_VIEW.targetHeight - 22; px += 12) {
                const c = skyColorAt(sky, Math.min(1, heightToSkyFrac(px, undefined, rise)), tmp);
                const dark = [c[0] * (1 - dim), c[1] * (1 - dim), c[2] * (1 - dim)];
                const delta = relativeLuminance(c) - relativeLuminance(dark);
                assert.ok(delta >= 0 && delta < FLASH_RULES.flashDelta, `${sc.id} a las ${h.toFixed(1)}, a ${px} del suelo: el golpe cambia la luminancia ${delta.toFixed(3)}`);
            }
            // Dentro, el limitador: ni con luz sin límite.
            for (let px = 0; px <= FX_LIMIT.playTopPx; px += 26) {
                const c = skyColorAt(sky, Math.min(1, heightToSkyFrac(px, undefined, rise)), tmp);
                limitFx(c, [1, 1, 1], lim);
                const delta = relativeLuminance(lim) - relativeLuminance(c);
                assert.ok(delta < FLASH_RULES.flashDelta, `${sc.id} a las ${h.toFixed(1)}, en la franja jugable: ${delta.toFixed(3)}`);
            }
        }
    }
    // De noche el bombeo va entero; de día, el tope lo recorta un poco. Y de día se ve.
    assert.ok(Math.abs(nightDim - 0.29) < 1e-6, `bombeo de noche: ${nightDim}`);
    assert.ok(dayDim > 0.15 && dayDim < 0.29, `bombeo de día: ${dayDim}`);
    assert.ok(maxDimFor(0.2) < maxDimFor(0.1));
    assert.equal(maxDimFor(0.01), 1, 'un cielo oscuro no puede dar un destello');
});

test('destellos: los drops de los niveles oficiales van sueltos, nunca más de tres por segundo', async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, 'database/seeds/official/manifest.json'), 'utf8'));
    for (const entry of manifest.levels ?? manifest) {
        const { chart } = JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${entry.slug}.json`), 'utf8'));
        const drops = chart.events.filter((e) => e.type === 'fx' && e.fx === 'drop').map((e) => e.t).sort((a, b) => a - b);
        for (let i = 1; i < drops.length; i++) {
            assert.ok(drops[i] - drops[i - 1] > 1, `${entry.slug}: drops a ${drops[i - 1]} y ${drops[i]} s`);
        }
    }
});
