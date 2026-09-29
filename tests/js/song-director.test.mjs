// Director de la canción y reloj de beat con acento (Ola 5): lo que la partida
// sabe de la estructura en cada frame. Sin Pixi: mismos instantes, mismos estados.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSongDirector, LEVEL_INTENSITY } from '../../resources/js/game/systems/songDirector.js';
import { createBeatClock } from '../../resources/js/game/systems/beatClock.js';

const chart = {
    events: [
        { t: 0, type: 'section', level: 1, intensity: 0.3, role: 'intro', climax: false },
        { t: 3.5, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 10, type: 'section', level: 3, intensity: 0.8, role: 'chorus', climax: false },
        { t: 10, type: 'fx', fx: 'lift', level: 3 },
        { t: 20, type: 'section', level: 1, intensity: 0.3, role: 'bridge', climax: false },
        { t: 30, type: 'section', level: 4, intensity: 0.9, role: 'chorus', climax: true },
        { t: 30, type: 'fx', fx: 'drop', level: 4 },
        { t: 40, type: 'section', level: 0, intensity: 0.1, role: 'outro', climax: false },
    ],
};

/** Avanza el director de `from` a `to` a 60 fps y devuelve los efectos disparados. */
function run(director, from, to) {
    const fired = [];
    for (let t = from; t <= to + 1e-9; t += 1 / 60) {
        for (const e of director.update(t, 1 / 60)) fired.push({ t: Math.round(t * 60) / 60, fx: e.fx });
    }
    return fired;
}

test('sigue los tramos: nivel y clímax en cada instante', () => {
    const d = createSongDirector(chart);
    run(d, 0, 5);
    assert.equal(d.level, 1);
    assert.equal(d.climax, false);
    run(d, 5, 12);
    assert.equal(d.level, 3);
    run(d, 12, 35);
    assert.equal(d.level, 4);
    assert.equal(d.climax, true);
});

test('efectos: cada uno se dispara una sola vez, en su frame', () => {
    const d = createSongDirector(chart);
    const fired = run(d, 0, 50);
    assert.deepEqual(fired.map((f) => f.fx), ['lift', 'drop']);
    assert.ok(Math.abs(fired[0].t - 10) <= 1 / 60 + 1e-9);
    assert.ok(Math.abs(fired[1].t - 30) <= 1 / 60 + 1e-9);
    // Un salto largo de reloj (pestaña en segundo plano) dispara lo pendiente de golpe, sin repetir.
    const jump = createSongDirector(chart);
    jump.update(0, 1 / 60);
    assert.deepEqual(jump.update(45, 1 / 60).map((e) => e.fx), ['lift', 'drop']);
    assert.deepEqual(jump.update(46, 1 / 60), []);
});

test('intensidad: sube rápido (un drop se nota ya) y baja despacio (sin apagón)', () => {
    const d = createSongDirector(chart);
    run(d, 0, 9.9);
    assert.ok(Math.abs(d.intensity - LEVEL_INTENSITY[1]) < 0.01, 'asentada en la calma');
    run(d, 10, 10.5);
    const rise = (d.intensity - LEVEL_INTENSITY[1]) / (LEVEL_INTENSITY[3] - LEVEL_INTENSITY[1]);
    assert.ok(rise > 0.9, `medio segundo después del estribillo va al ${(rise * 100).toFixed(0)} %`);
    run(d, 10.5, 19.9);
    run(d, 20, 20.5);
    const fall = (LEVEL_INTENSITY[3] - d.intensity) / (LEVEL_INTENSITY[3] - LEVEL_INTENSITY[1]);
    assert.ok(fall < 0.5, `medio segundo después del puente solo ha bajado el ${(fall * 100).toFixed(0)} %`);
});

test('el reloj no retrocede y un chart sin estructura queda en intensidad media', () => {
    const d = createSongDirector(chart);
    run(d, 0, 12);
    assert.deepEqual(d.update(5, 1 / 60), [], 'un instante anterior no dispara ni cambia nada');
    assert.equal(d.level, 3);

    const flat = createSongDirector({ events: [{ t: 4, type: 'obstacle', kind: 'PTERO' }] });
    run(flat, 0, 20);
    assert.equal(flat.intensity, 0.5);
    assert.equal(flat.climax, false);
});

test('reloj de beat: fase anclada a los beats reales y acento en los primeros tiempos', () => {
    const beats = [];
    for (let i = 0; i < 32; i++) beats.push(0.5 + i * 0.5);
    const downbeats = beats.filter((_, i) => i % 4 === 0);
    const clock = createBeatClock(beats, 0.5, downbeats);
    assert.ok(clock.phaseAt(2.5) < 1e-9, 'fase 0 en un beat');
    assert.ok(Math.abs(clock.phaseAt(2.75) - 0.5) < 1e-9, 'a mitad de beat');
    assert.equal(clock.isAccentAt(2.51), true, '2.5 es el primer tiempo del compás 2');
    assert.equal(clock.isAccentAt(3.01), false);
    assert.equal(clock.isAccentAt(4.55), true, '4.5 es el primer tiempo del compás 3');
    // Sin downbeats (chart de formato 1): nunca hay acento, la fase sigue igual.
    const plain = createBeatClock(beats, 0.5);
    assert.equal(plain.isAccentAt(2.51), false);
    assert.ok(plain.phaseAt(2.5) < 1e-9);
});
