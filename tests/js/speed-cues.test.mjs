// Señales de velocidad en partida (afinado de velocidad): lo que se ve venir y
// lo que se nota al llegar. Sin Pixi ni DOM: mismos instantes, mismas señales.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEED_CUES, createSpeedCues } from '../../resources/js/game/systems/speedCues.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { normalizeChart } from '../../resources/js/game/levels/chartFormat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Chart mínimo: base 400, beat de 0.5 s y compases de 4 beats desde t=0. */
function chart(speedChanges) {
    const downbeats = [];
    for (let t = 0; t < 120; t += 2) downbeats.push(t);
    return { world: { speedPxS: 400, speedChanges }, music: { beatPeriodS: 0.5, downbeats }, events: [] };
}

test('acelerones: solo las subidas que se notan, con el primer tiempo que las motiva', () => {
    const cues = createSpeedCues(chart([
        { t: 19.75, speedPxS: 440, rampS: 0 },    // anacrusa de 20: +10 %
        { t: 39.7, speedPxS: 448, rampS: 0 },     // +1.8 %: no se nota, no cuenta
        { t: 59.5, speedPxS: 540, rampS: 0 },     // anacrusa de 60
        { t: 80, speedPxS: 460, rampS: 2 },       // frenazo: no es un acelerón
        { t: 90.3, speedPxS: 520, rampS: 0 },     // sin primer tiempo cerca (el siguiente, 92, a 1.7 s)
    ]));
    assert.deepEqual(cues.ups.map((u) => [u.t, u.at]), [[19.75, 20], [59.5, 60], [90.3, 90.3]]);
    // ×1.10, ×1.35 y ×1.30 sobre la velocidad de arranque.
    assert.deepEqual(cues.ups.map((u) => u.gear), [1, 3, 2]);
    assert.equal(cues.warnS, Math.max(SPEED_CUES.warnMinS, SPEED_CUES.warnBeats * 0.5));
});

test('marchas del HUD: escalones sobre la velocidad de arranque', () => {
    const cues = createSpeedCues(chart([
        { t: 10, speedPxS: 424, rampS: 0 },   // ×1.06
        { t: 20, speedPxS: 472, rampS: 0 },   // ×1.18
        { t: 30, speedPxS: 528, rampS: 0 },   // ×1.32
        { t: 40, speedPxS: 584, rampS: 0 },   // ×1.46
        { t: 50, speedPxS: 700, rampS: 0 },
    ]));
    assert.deepEqual([5, 10, 20, 30, 40, 55].map((t) => cues.gearAt(t)), [0, 1, 2, 3, 4, 4]);
    assert.equal(cues.linesAt(5), 0, 'a la velocidad de arranque, sin líneas');
    assert.equal(cues.linesAt(55), 1, 'muy por encima, todas');
    assert.ok(cues.linesAt(25) > 0 && cues.linesAt(25) < 1);
});

test('aviso: nada lejos del acelerón, crece en su ventana y señala la marcha que viene', () => {
    const cues = createSpeedCues(chart([{ t: 20, speedPxS: 480, rampS: 0 }]));
    assert.deepEqual(cues.aheadAt(10), { ahead: 0, next: cues.ups[0] });
    const early = cues.aheadAt(20 - cues.warnS + 0.5).ahead;
    const late = cues.aheadAt(19.9).ahead;
    assert.ok(early > 0 && early < 0.2, `al entrar en la ventana: ${early}`);
    assert.ok(late > 0.95, `justo antes: ${late}`);
    assert.equal(cues.aheadAt(19.9).next.gear, 2);
    assert.deepEqual(cues.aheadAt(21), { ahead: 0, next: null }, 'pasado el último, nada');
});

test('update: cada acelerón una vez, en su frame; un salto de reloj los dispara todos; el reloj no retrocede', () => {
    const changes = [{ t: 10, speedPxS: 440, rampS: 0 }, { t: 20, speedPxS: 500, rampS: 0 }, { t: 30, speedPxS: 560, rampS: 0 }];
    const cues = createSpeedCues(chart(changes));
    const fired = [];
    for (let t = 0; t <= 25; t += 1 / 60) for (const u of cues.update(t)) fired.push([u.t, Math.round(t * 60) / 60]);
    assert.deepEqual(fired.map((f) => f[0]), [10, 20]);
    for (const [t, frame] of fired) assert.ok(frame >= t && frame - t <= 1 / 60 + 1e-9);
    assert.deepEqual(cues.update(12).map((u) => u.t), [], 'un instante anterior no dispara nada');

    const jump = createSpeedCues(chart(changes));
    jump.update(0);
    assert.deepEqual(jump.update(45).map((u) => u.t), [10, 20, 30]);
    assert.deepEqual(jump.update(46), []);
});

test('un chart sin cambios de velocidad no avisa ni enciende nada', () => {
    const cues = createSpeedCues(chart([]));
    assert.deepEqual(cues.ups, []);
    assert.equal(cues.gearAt(30), 0);
    assert.equal(cues.linesAt(30), 0);
    assert.deepEqual(cues.aheadAt(30), { ahead: 0, next: null });
});

test('con el chart real de What\'s Up Danger: cada acelerón cae medio beat antes de su primer tiempo y el clímax enciende las cuatro marchas', async () => {
    const baked = JSON.parse(await readFile(path.join(ROOT, 'database/seeds/official/baked/whats-up-danger.json'), 'utf8'));
    const { chart: built, report } = buildChart(baked.analysis, { sha256: baked.audio.sha256, difficulty: 5 });
    const { chart: c } = normalizeChart(built);
    const cues = createSpeedCues(c);
    assert.ok(cues.ups.length >= 3);
    for (const u of cues.ups) {
        assert.ok(u.at > u.t && u.at - u.t <= c.music.beatPeriodS + 1e-6, `acelerón en ${u.t}, primer tiempo en ${u.at}`);
    }
    assert.equal(cues.ups.at(-1).at, report.climax.t0, 'el último acelerón es el clímax');
    assert.equal(cues.gearAt(report.climax.t0 + 1), 4);
    assert.equal(cues.linesAt(report.climax.t0 + 1), 1);
});
