// La calidad automática (T05.2): mide los fotogramas tardíos de la partida, baja
// primero el cielo y lo último los fotogramas, y solo vuelve a subir al empezar un
// intento.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFrameGovernor, GOVERNOR_RULES } from '../../resources/js/game/systems/frameGovernor.js';

const MS60 = 1000 / 60;

/**
 * Le da al gobernador `seconds` de fotogramas con los intervalos de `pattern`
 * (se repite). Devuelve los cambios que pidió, con el segundo en que lo hizo.
 */
function feed(g, { seconds, pattern = [MS60], cpuMs = 2, frameMs = MS60, onChange = null }) {
    const changes = [];
    let t = 0;
    for (let i = 0; t < seconds * 1000; i++) {
        const dt = pattern[i % pattern.length];
        t += dt;
        const c = g.sample(dt, typeof cpuMs === 'function' ? cpuMs(dt) : cpuMs, typeof frameMs === 'function' ? frameMs() : frameMs);
        if (c) {
            changes.push({ ...c, at: t / 1000 });
            onChange?.(c);
        }
    }
    return changes;
}

/** Un intento entero: empieza, juega y termina. */
function attempt(g, opts) {
    const up = g.attemptStart();
    const changes = feed(g, opts);
    g.attemptEnd();
    return { up, changes };
}

test('a 60 estables no toca nada, y un tirón suelto cada pocos segundos tampoco', () => {
    const g = createFrameGovernor();
    assert.deepEqual(g.state, { tier: 'high', pace: 'native' });
    assert.deepEqual(attempt(g, { seconds: 120 }).changes, []);
    // Un fotograma de 100 ms cada 5 s (un portal que aparece, el recolector de basura).
    const hitch = [...new Array(299).fill(MS60), 100];
    assert.deepEqual(attempt(g, { seconds: 120, pattern: hitch }).changes, []);
    assert.deepEqual(g.state, { tier: 'high', pace: 'native' });
    assert.equal(g.learned, false, 'un equipo que nunca bajó no deja nada que recordar');
});

test('45 FPS a trompicones baja el cielo en pocos segundos (antes: nunca)', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    const changes = feed(g, { seconds: 10, pattern: [MS60, MS60, 2 * MS60] });
    assert.ok(changes.length >= 1);
    assert.deepEqual([changes[0].tier, changes[0].pace, changes[0].why], ['medium', 'native', 'gpu']);
    assert.ok(changes[0].at <= GOVERNOR_RULES.startS + 2 * GOVERNOR_RULES.windowS + 0.5, `a los ${changes[0].at.toFixed(1)} s`);
});

test('25 FPS con fotogramas alternos (el caso medido: 15 s en "Alta" sin reaccionar) baja', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    const changes = feed(g, { seconds: 8, pattern: [MS60, 2 * MS60, MS60, 6 * MS60, 2 * MS60] });
    assert.ok(changes.length >= 1, 'reacciona');
    assert.equal(changes[0].tier, 'medium');
});

test('con un 15 % de tardíos hacen falta dos ventanas seguidas; con un 30 %, una', () => {
    const soft = createFrameGovernor();
    soft.attemptStart();
    // 1 de cada 7 fotogramas, tardío (14 %).
    const a = feed(soft, { seconds: 8, pattern: [MS60, MS60, MS60, MS60, MS60, MS60, 2 * MS60] });
    assert.ok(a.length >= 1 && a[0].at > GOVERNOR_RULES.startS + 2 * GOVERNOR_RULES.windowS - 0.2, `${a[0]?.at}`);
    const hard = createFrameGovernor();
    hard.attemptStart();
    const b = feed(hard, { seconds: 8, pattern: [MS60, 2 * MS60] });
    assert.ok(b[0].at < GOVERNOR_RULES.startS + GOVERNOR_RULES.windowS + 0.5, `${b[0].at}`);
    // Por debajo del umbral (1 de cada 12: 8 %), nada.
    const fine = createFrameGovernor();
    fine.attemptStart();
    assert.deepEqual(feed(fine, { seconds: 30, pattern: [...new Array(11).fill(MS60), 2 * MS60] }), []);
});

test('si nada lo arregla, recorre la escalera en orden: cielo 4, cielo 2 y, lo último, 30 estables', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    // A 30 estables el intervalo previsto son 33 ms: lo que antes era tardío ya no lo es.
    const frameMs = () => (g.state.pace === 'steady' ? 2 * MS60 : MS60);
    const changes = feed(g, { seconds: 40, pattern: [2 * MS60], frameMs });
    assert.deepEqual(changes.map((c) => `${c.tier}/${c.pace}`), ['medium/native', 'low/native', 'low/steady']);
    assert.ok(changes.every((c) => c.why === 'gpu'));
    // Entre un escalón y el siguiente deja asentarse lo nuevo.
    for (let i = 1; i < changes.length; i++) assert.ok(changes[i].at - changes[i - 1].at >= GOVERNOR_RULES.settleS + GOVERNOR_RULES.windowS - 0.1);
    assert.deepEqual(g.state, { tier: 'low', pace: 'steady' });
    // Abajo del todo ya no hay más que hacer.
    assert.deepEqual(feed(g, { seconds: 20, pattern: [4 * MS60], frameMs }), []);
});

test('una pantalla de 120 Hz que no llega va primero a la mitad (60 parejos), sin tocar el dibujo', () => {
    const ms = 1000 / 120;
    const g = createFrameGovernor({ refreshHz: 120 });
    g.attemptStart();
    const frameMs = () => (g.state.pace === 'native' ? ms : 2 * ms);
    // 80 FPS: un fotograma a su hora y otro que pierde el suyo.
    const a = feed(g, { seconds: 6, pattern: [ms, 2 * ms], frameMs });
    assert.deepEqual(a.map((c) => `${c.tier}/${c.pace}`), ['high/half']);
    // A 60 ya llega: no baja más.
    assert.deepEqual(feed(g, { seconds: 30, pattern: [2 * ms], frameMs }), []);
    // Si a 60 tampoco, entonces sí el cielo, manteniendo la mitad.
    const b = feed(g, { seconds: 8, pattern: [2 * ms, 4 * ms], frameMs });
    assert.deepEqual([b[0].tier, b[0].pace], ['medium', 'half']);
});

test('si lo que falta es procesador salta directo a 30 estables, sin tocar el cielo', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    const frameMs = () => (g.state.pace === 'steady' ? 2 * MS60 : MS60);
    // El JS de cada fotograma se come 14 ms de los 16,7: 50 FPS a trompicones.
    const changes = feed(g, { seconds: 10, pattern: [MS60, 2 * MS60, MS60], cpuMs: 14, frameMs });
    assert.deepEqual(changes.map((c) => `${c.tier}/${c.pace}/${c.why}`), ['high/steady/cpu']);
    // A 30, 14 ms de JS caben de sobra: estable.
    assert.deepEqual(feed(g, { seconds: 30, pattern: [2 * MS60], cpuMs: 14, frameMs }), []);
});

test('no mide el arranque del intento, ni una pestaña oculta, ni justo después de un cambio', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    // Dos segundos de fundido y texturas nuevas a trompicones, y luego todo bien.
    assert.deepEqual(feed(g, { seconds: GOVERNOR_RULES.startS - 0.1, pattern: [3 * MS60] }), []);
    assert.deepEqual(feed(g, { seconds: 20 }), []);
    // La pestaña se oculta: los fotogramas llegan cada segundo.
    assert.deepEqual(feed(g, { seconds: 30, pattern: [1000] }), []);
    // Un cambio de tamaño de ventana: `hold`.
    g.hold(3);
    assert.deepEqual(feed(g, { seconds: 2.9, pattern: [3 * MS60] }), []);
    assert.deepEqual(g.state, { tier: 'high', pace: 'native' });
});

test('vuelve a subir solo al empezar un intento, tras uno limpio; si la prueba falla, no insiste', () => {
    const g = createFrameGovernor();
    const first = attempt(g, { seconds: 30, pattern: [MS60, 2 * MS60] });
    assert.equal(first.up, null);
    assert.ok(first.changes.length >= 1);
    // El resto del nivel, ya abajo, va bien; pero bajó durante él: no fue limpio.
    const stateAfter = { ...g.state };
    const second = attempt(g, { seconds: 60 });
    assert.equal(second.up, null, 'tras un intento con bajadas no prueba');
    assert.deepEqual(second.changes, [], 'ni sube a mitad de partida');
    // Ese sí fue limpio: al empezar el siguiente prueba un escalón más.
    const up = g.attemptStart();
    assert.equal(up.why, 'retry');
    assert.notDeepEqual({ tier: up.tier, pace: up.pace }, stateAfter);
    // Y vuelve a fallar: baja…
    const again = feed(g, { seconds: 10, pattern: [MS60, 2 * MS60] });
    assert.ok(again.length >= 1);
    g.attemptEnd();
    // …y ya no lo intenta más en la sesión, por limpio que vaya.
    for (let i = 0; i < 3; i++) {
        const r = attempt(g, { seconds: 60 });
        assert.equal(r.up, null, `intento ${i + 1}`);
    }
});

test('una subida que aguanta se queda, y puede seguir subiendo de escalón en escalón', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    const frameMs = () => (g.state.pace === 'steady' ? 2 * MS60 : MS60);
    feed(g, { seconds: 9, pattern: [2 * MS60], frameMs });    // otra pestaña se come la gráfica
    assert.deepEqual(g.state, { tier: 'low', pace: 'native' });
    g.attemptEnd();
    attempt(g, { seconds: 40 });                      // limpio en Baja
    assert.deepEqual(attempt(g, { seconds: 40 }).up && g.state, { tier: 'medium', pace: 'native' });
    assert.deepEqual(attempt(g, { seconds: 40 }).up && g.state, { tier: 'high', pace: 'native' });
    assert.equal(attempt(g, { seconds: 40 }).up, null, 'arriba del todo no hay más');
    // Un intento corto (murió a los 5 s) no confirma ni deshace nada.
    const h = createFrameGovernor();
    attempt(h, { seconds: 9, pattern: [2 * MS60] });
    attempt(h, { seconds: 40 });
    assert.ok(attempt(h, { seconds: 5 }).up !== null);
    assert.equal(attempt(h, { seconds: 5 }).up, null, 'la prueba sigue sin confirmar: no sube otro');
});

test('lo aprendido se recuerda: la visita siguiente empieza donde quedó, y sube solo tras un intento limpio', () => {
    const g = createFrameGovernor();
    attempt(g, { seconds: 9, pattern: [2 * MS60] });
    assert.equal(g.learned, true);
    const mem = JSON.parse(JSON.stringify(g.memory()));
    assert.deepEqual(mem.state, { tier: 'low', pace: 'native' });

    const next = createFrameGovernor({ remembered: mem });
    assert.deepEqual(next.state, { tier: 'low', pace: 'native' });
    assert.equal(next.attemptStart(), null, 'sin un intento limpio en esta visita no prueba');
    feed(next, { seconds: 40 });
    next.attemptEnd();
    assert.deepEqual(next.attemptStart() && next.state, { tier: 'medium', pace: 'native' });

    // Una memoria corrupta (localStorage lo edita cualquiera) se ignora.
    for (const bad of [{ state: { tier: 'ultra', pace: 'native' }, history: [] }, { state: null }, 'x', { state: { tier: 'low', pace: 'native' }, history: [3] }]) {
        assert.deepEqual(createFrameGovernor({ remembered: bad }).state, { tier: 'high', pace: 'native' });
    }
});

test('una pantalla táctil empieza con el cielo en Media (y a la mitad si es de 120 Hz), y no sube de ahí', () => {
    const phone = createFrameGovernor({ coarse: true });
    assert.deepEqual(phone.state, { tier: 'medium', pace: 'native' });
    attempt(phone, { seconds: 60 });
    assert.equal(phone.attemptStart(), null, 'no hay nada que deshacer');
    const fast = createFrameGovernor({ coarse: true, refreshHz: 120 });
    assert.deepEqual(fast.state, { tier: 'medium', pace: 'half' });
    // La pantalla se mide después de crear el gobernador: mientras no haya medido nada, la sigue.
    const late = createFrameGovernor({ coarse: true });
    assert.deepEqual([late.setRefresh(120).pace, late.state.pace], ['half', 'half']);
    assert.equal(late.setRefresh(144), null, 'sigue siendo rápida: nada cambia');
});

test('la elección de AJUSTES es fija: mide, pero no la cambia', () => {
    const g = createFrameGovernor();
    assert.deepEqual(g.lock('high'), { tier: 'high', pace: 'native', why: 'manual' });
    assert.equal(g.locked, true);
    g.attemptStart();
    assert.deepEqual(feed(g, { seconds: 30, pattern: [3 * MS60] }), []);
    assert.deepEqual(g.state, { tier: 'high', pace: 'native' });
    const s = g.stats();
    assert.ok(s.lateRatio > 0.9 && s.fps < 21 && s.worstMs >= 49, JSON.stringify(s));
    // De vuelta a automática sigue con lo suyo.
    assert.equal(g.lock(null).why, 'manual');
    assert.equal(g.locked, false);
    assert.ok(feed(g, { seconds: 10, pattern: [3 * MS60] }).length >= 1);
    // Baja elegida a mano va a los fotogramas de la pantalla, no a 30.
    assert.deepEqual(createFrameGovernor().lock('low'), { tier: 'low', pace: 'native', why: 'manual' });
});

test('el resumen del intento: fotogramas, tardíos y JS medio (lo que enseña la lectura de rendimiento)', () => {
    const g = createFrameGovernor();
    g.attemptStart();
    feed(g, { seconds: 2 });                                    // arranque: no cuenta
    feed(g, { seconds: 30, pattern: [...new Array(19).fill(MS60), 2 * MS60], cpuMs: 3 });
    const s = g.stats();
    assert.ok(Math.abs(s.lateRatio - 0.05) < 0.01, String(s.lateRatio));
    assert.ok(Math.abs(s.cpuMs - 3) < 0.2 && s.fps > 55 && s.fps < 60, JSON.stringify(s));
    assert.ok(Math.abs(s.seconds - 30) < 1 && s.downs === 0);
});
