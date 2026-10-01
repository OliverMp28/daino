// Reloj continuo a partir del reloj de audio, que avanza a escalones (Oct 2026).
//
// Medido en Chrome (Windows, 60 FPS): `ctx.currentTime` sube 9-20 ms de golpe y
// se queda hasta 13 ms por detrás de lo que ha sonado. Leído tal cual, los
// obstáculos avanzaban 9 ms de canción en un fotograma y 20 en el siguiente
// (temblaban frente al suelo) y cada pulsación se fechaba con ese error. En un
// móvil los bloques de audio son mayores.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSteadyClock } from '../../resources/js/game/audio/steadyClock.js';

/**
 * Un reloj de audio de mentira: el tiempo verdadero es `wall + offset` y lo que se
 * lee es su último escalón de `blockS`.
 */
function stair(blockS, offset = 100) {
    return (wallS) => Math.floor((wallS + offset) / blockS) * blockS;
}

/** Fotogramas a ~60 FPS con algo de baile (determinista). */
function frames(seconds, startS = 0) {
    const out = [];
    let t = startS;
    let i = 0;
    while (t < startS + seconds) {
        t += [0.0166, 0.0171, 0.0158, 0.0169, 0.0164, 0.0182, 0.0151][i++ % 7];
        out.push(t);
    }
    return out;
}

test('a escalones de 20 ms, el reloj sale continuo: sigue al tiempo de verdad y cada fotograma avanza lo que dura', () => {
    for (const blockS of [0.0029, 0.0116, 0.0203, 0.04]) {
        const clock = createSteadyClock();
        const read = stair(blockS);
        let prev = null;
        let prevWall = null;
        let worstStep = 0;
        let worstError = 0;
        for (const wall of frames(4)) {
            const t = clock.read(wall, read(wall));
            if (prev !== null) assert.ok(t >= prev, 'monótono');
            // Tras el arranque (medio segundo para aprender el desfase):
            if (wall > 1) {
                worstStep = Math.max(worstStep, Math.abs((t - prev) - (wall - prevWall)));
                worstError = Math.max(worstError, Math.abs(t - (wall + 100)));
            }
            prev = t;
            prevWall = wall;
        }
        // Lo que se leía antes: el escalón, que baila hasta un bloque entero.
        assert.ok(worstStep < 0.0012, `bloques de ${blockS * 1000} ms: un fotograma avanza ${(worstStep * 1000).toFixed(2)} ms de más o de menos`);
        assert.ok(worstError < Math.max(0.003, blockS * 0.2), `bloques de ${blockS * 1000} ms: a ${(worstError * 1000).toFixed(2)} ms del tiempo de verdad`);
    }
});

test('el escalón tal cual bailaba un bloque entero: es lo que se arregla', () => {
    const read = stair(0.0203);
    let worst = 0;
    let prev = null;
    let prevWall = null;
    for (const wall of frames(2)) {
        const t = read(wall);
        if (prev !== null) worst = Math.max(worst, Math.abs((t - prev) - (wall - prevWall)));
        prev = t;
        prevWall = wall;
    }
    assert.ok(worst > 0.01, `el escalón baila ${(worst * 1000).toFixed(1)} ms por fotograma`);
});

test('nunca retrocede y avanza siempre cerca del ritmo real, también mientras aprende el desfase', () => {
    const clock = createSteadyClock();
    const read = stair(0.0203);
    let prev = null;
    let prevWall = null;
    for (const wall of frames(3)) {
        const t = clock.read(wall, read(wall));
        if (prev !== null) {
            const rate = (t - prev) / (wall - prevWall);
            assert.ok(rate >= 0.94 && rate <= 1.06, `ritmo ${rate.toFixed(3)} en ${wall.toFixed(3)}`);
        }
        prev = t;
        prevWall = wall;
    }
});

test('un corte de audio de 80 ms: el reloj no salta atrás y vuelve a seguir al audio', () => {
    const clock = createSteadyClock();
    const blockS = 0.0116;
    let lost = 0;
    const read = (wall) => stair(blockS)(wall - lost);
    let prev = -Infinity;
    for (const wall of frames(8)) {
        if (wall > 3 && lost === 0) lost = 0.08;   // el audio se quedó 80 ms atrás
        const t = clock.read(wall, read(wall));
        assert.ok(t >= prev, `retrocede en ${wall.toFixed(3)}`);
        prev = t;
        if (wall > 7) assert.ok(Math.abs(t - (wall - lost + 100)) < 0.004, `a ${((t - (wall - lost + 100)) * 1000).toFixed(1)} ms del audio tras el corte`);
    }
});

test('si el audio se detiene sin avisar, el reloj se detiene con él', () => {
    const clock = createSteadyClock({ maxAheadS: 0.12 });
    const read = stair(0.01);
    let last = 0;
    for (const wall of frames(2)) last = clock.read(wall, read(wall));
    const frozen = read(2);
    // El reloj de audio deja de avanzar; el de alta resolución sigue.
    let t = last;
    for (const wall of frames(2, 2)) t = clock.read(wall, frozen);
    assert.ok(t <= frozen + 0.12 + 1e-9, `se pasa ${((t - frozen) * 1000).toFixed(0)} ms`);
    assert.ok(t >= last);
});

test('tras una pausa (reset) se re-ancla sin saltos: sigue donde iba', () => {
    const clock = createSteadyClock();
    let read = stair(0.0203);
    let last = 0;
    for (const wall of frames(2)) last = clock.read(wall, read(wall));
    // Cinco segundos en pausa: el audio no avanzó, el reloj de pared sí.
    clock.reset();
    read = stair(0.0203, 100 - 5);
    const first = clock.read(7.001, read(7.001));
    assert.ok(first >= last && first - last < 0.03, `al volver salta ${((first - last) * 1000).toFixed(1)} ms`);
    let prev = first;
    for (const wall of frames(2, 7.001)) {
        const t = clock.read(wall, read(wall));
        assert.ok(t >= prev);
        prev = t;
    }
    assert.ok(Math.abs(prev - (9.001 - 5 + 100)) < 0.02);
});

test('sin reset, una separación grande entre los relojes también re-ancla', () => {
    const clock = createSteadyClock();
    for (const wall of frames(1)) clock.read(wall, stair(0.01)(wall));
    const t = clock.read(1.5, stair(0.01, 100 + 2)(1.5));   // el audio saltó 2 s adelante
    assert.ok(Math.abs(t - 103.5) < 0.02, `tras el salto marca ${t.toFixed(3)}`);
});

test('restart empieza de cero: otra canción puede empezar antes de donde acabó la anterior', () => {
    const clock = createSteadyClock();
    clock.read(10, 500);
    clock.restart();
    assert.equal(clock.read(11, 3), 3);
});
