// Reloj de canción con corrección de latencia de salida (Ola 3).
//
// Medido en Chrome: `outputLatency` vale 0 al empezar a sonar y salta a 40 ms
// ~117 ms después. Restarla tal cual hacía retroceder el reloj 40 ms de golpe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../resources/js/game/audio/AudioEngine.js';

/** AudioEngine con un contexto simulado cuyo reloj y latencia controla el test. */
function engineWithFakeClock() {
    const ctx = { currentTime: 100, outputLatency: 0, baseLatency: 0.01 };
    const engine = new AudioEngine();
    engine.ctx = ctx;
    engine.source = {};
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
