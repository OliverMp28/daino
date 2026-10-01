// Reloj de canción con corrección de latencia de salida (Ola 3).
//
// Medido en Chrome: `outputLatency` vale 0 al empezar a sonar y salta a 40 ms
// ~117 ms después. Restarla tal cual hacía retroceder el reloj 40 ms de golpe.
//
// Oct 2026: el reloj se lee continuo (steadyClock.js, con sus pruebas aparte), se
// queda quieto con el audio detenido y el audio se detiene por motivos que se
// acumulan (pausa del jugador, pestaña oculta).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../resources/js/game/audio/AudioEngine.js';

/** AudioEngine con un contexto simulado cuyo reloj y latencia controla el test. */
function engineWithFakeClock() {
    const ctx = { currentTime: 100, outputLatency: 0, baseLatency: 0.01 };
    const engine = new AudioEngine();
    engine.ctx = ctx;
    engine.source = {};
    // Los dos relojes avanzan juntos: aquí se prueba la latencia, no los escalones.
    engine._wallS = () => ctx.currentTime;
    engine._playStartedAt = ctx.currentTime;
    engine._latency = engine._measuredLatency();
    engine._latencyUpdatedAt = ctx.currentTime;
    return { engine, ctx };
}

test('el reloj de canción es monótono aunque la latencia salte de 0 a 40 ms', () => {
    const { engine, ctx } = engineWithFakeClock();
    let prev = engine.getSongTime();
    const step = 128 / 44100;   // un quantum de render de audio
    for (let i = 0; i < 2000; i++) {
        ctx.currentTime += step;
        if (i === 40) ctx.outputLatency = 0.04;   // el salto medido en Chrome
        const t = engine.getSongTime();
        assert.ok(t >= prev, `el reloj retrocedió en el paso ${i}: ${prev} → ${t}`);
        prev = t;
    }
});

test('la corrección converge a la latencia real en menos de un segundo', () => {
    const { engine, ctx } = engineWithFakeClock();
    ctx.outputLatency = 0.04;
    for (let i = 0; i < 100; i++) {
        ctx.currentTime += 0.01;
        engine.getSongTime();
    }
    // Tras 1 s, el reloj descuenta los 40 ms completos.
    const expected = ctx.currentTime - engine._playStartedAt - 0.04;
    assert.ok(Math.abs(engine.getSongTime() - expected) < 1e-9);
});

test('llamar al reloj varias veces en el mismo instante no altera el ajuste', () => {
    const { engine, ctx } = engineWithFakeClock();
    ctx.outputLatency = 0.04;
    ctx.currentTime += 0.1;
    const a = engine.getSongTime();
    const b = engine.getSongTime();
    const c = engine.getSongTime();
    assert.equal(a, b);
    assert.equal(b, c);
});

test('valores de latencia absurdos se ignoran', () => {
    const { engine, ctx } = engineWithFakeClock();
    ctx.outputLatency = Number.NaN;
    ctx.baseLatency = 5;   // 5 s: no es una latencia plausible
    assert.equal(engine._measuredLatency(), 0);
});

/** Contexto de mentira con estado: suspend/resume como los del navegador. */
function engineWithState() {
    const { engine, ctx } = engineWithFakeClock();
    ctx.state = 'running';
    ctx.calls = [];
    ctx.suspend = () => { ctx.calls.push('suspend'); ctx.state = 'suspended'; return Promise.resolve(); };
    ctx.resume = () => { ctx.calls.push('resume'); ctx.state = 'running'; return Promise.resolve(); };
    return { engine, ctx };
}

test('el audio se detiene por motivos que se acumulan: volver a la pestaña no reanuda una partida en pausa', () => {
    const { engine, ctx } = engineWithState();
    engine.hold('pause');
    assert.deepEqual(ctx.calls, ['suspend']);
    // El jugador cambia de pestaña con la partida en pausa y vuelve.
    engine.hold('hidden');
    engine.release('hidden');
    assert.deepEqual(ctx.calls, ['suspend'], 'sigue en pausa: nadie lo reanudó');
    assert.equal(ctx.state, 'suspended');
    engine.release('pause');
    assert.deepEqual(ctx.calls, ['suspend', 'resume']);
    // Soltar un motivo que no estaba no hace nada raro.
    engine.release('pause');
    assert.deepEqual(ctx.calls, ['suspend', 'resume']);
});

test('ocultar la pestaña jugando detiene el audio y al volver sigue, si nadie más lo retiene', () => {
    const { engine, ctx } = engineWithState();
    engine.hold('hidden');
    assert.equal(ctx.state, 'suspended');
    engine.release('hidden');
    assert.equal(ctx.state, 'running');
});

test('con el audio detenido el reloj de la canción no avanza, y al volver sigue donde iba sin saltar atrás', () => {
    const { engine, ctx } = engineWithState();
    let wall = 100;
    engine._wallS = () => wall;
    const tick = (s) => { wall += s; if (ctx.state === 'running') ctx.currentTime += s; };
    for (let i = 0; i < 60; i++) { tick(1 / 60); engine.getSongTime(); }
    const before = engine.getSongTime();
    engine.hold('pause');
    for (let i = 0; i < 300; i++) { tick(1 / 60); assert.equal(engine.getSongTime(), before, 'en pausa no avanza'); }
    engine.release('pause');
    let prev = before;
    for (let i = 0; i < 60; i++) {
        tick(1 / 60);
        const t = engine.getSongTime();
        assert.ok(t >= prev && t - prev < 0.03, `tras la pausa avanza ${((t - prev) * 1000).toFixed(1)} ms en un fotograma`);
        prev = t;
    }
    assert.ok(Math.abs(prev - (before + 1)) < 0.02, 'un segundo después de reanudar, un segundo más de canción');
});
