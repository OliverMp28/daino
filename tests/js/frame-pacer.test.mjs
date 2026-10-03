// El ritmo de los fotogramas (T05.2): se pinta uno de cada k de los que ofrece la
// pantalla, siempre parejos, y la pantalla se mide con sus propios rAF.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFramePacer, divisorFor, PACE_RULES } from '../../resources/js/game/systems/framePacer.js';
import { STEADY_FPS } from '../../resources/js/game/RenderProfile.js';

/** Generador con semilla: el test es el mismo en cada ejecución. */
function rng(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Tiempos de rAF de una pantalla de `hz`, con un poco de ruido. */
function rafTrain(hz, seconds, { jitterMs = 0.2, from = 1000, seed = 7 } = {}) {
    const rnd = rng(seed);
    const out = [];
    for (let i = 0; i < hz * seconds; i++) out.push(from + (i * 1000) / hz + (rnd() - 0.5) * jitterMs);
    return out;
}

test('de cada cuántos fotogramas de la pantalla se pinta uno', () => {
    const table = [
        // [pantalla, tope del estado, ritmo, esperado]
        [60, 0, 'native', 1], [60, 30, 'native', 2], [60, 15, 'native', 4],
        [120, 0, 'native', 1], [120, 0, 'half', 2], [120, 30, 'native', 4],
        [144, 0, 'half', 2], [144, 30, 'native', 5], [90, 30, 'native', 3], [90, 0, 'half', 2],
        [60, 0, 'steady', 2], [120, 0, 'steady', 4], [144, 0, 'steady', 5], [90, 0, 'steady', 3],
        [50, 30, 'native', 2], [30, 30, 'native', 1], [30, 0, 'steady', 1],
        // El tope del estado manda si pide menos que el ritmo de la calidad.
        [60, 15, 'steady', 4], [120, 30, 'half', 4],
    ];
    for (const [hz, max, pace, want] of table) assert.equal(divisorFor(hz, max, pace), want, `${hz} Hz, tope ${max}, ${pace}`);
    assert.equal(STEADY_FPS, 30);
});

test('los fotogramas pintados salen parejos a 60, 90, 120 y 144 Hz (con ticker.maxFPS no lo eran)', () => {
    for (const hz of [60, 90, 120, 144]) {
        for (const [max, pace] of [[0, 'native'], [30, 'native'], [0, 'half'], [0, 'steady'], [15, 'native']]) {
            const pacer = createFramePacer();
            // El menú es lo primero que se ve: ahí mide la pantalla.
            for (const t of rafTrain(hz, 1.5)) pacer.tick(t, true);
            const k = divisorFor(pacer.refreshHz, max, pace);
            pacer.setDivisor(k);
            const painted = rafTrain(hz, 4, { from: 5000 }).filter((t) => pacer.tick(t, false));
            const gaps = painted.slice(1).map((t, i) => t - painted[i]);
            const want = (1000 / hz) * k;
            assert.ok(gaps.length > 20, `${hz} Hz ÷ ${k}`);
            for (const g of gaps) assert.ok(Math.abs(g - want) < 0.5, `${hz} Hz ÷ ${k}: un intervalo de ${g.toFixed(2)} ms (previsto ${want.toFixed(2)})`);
            assert.ok(Math.abs(pacer.frameMs - want) < 0.05, `${hz} Hz ÷ ${k}: intervalo previsto`);
        }
    }
    // Sin haber medido nada supone la pantalla más común.
    assert.ok(Math.abs(createFramePacer().refreshHz - PACE_RULES.defaultHz) < 1e-9);
});

test('mide la pantalla con sus rAF, en los estados de confianza', () => {
    for (const hz of [60, 75, 90, 120, 144, 165]) {
        const pacer = createFramePacer();
        assert.equal(pacer.measured, false);
        for (const t of rafTrain(hz, 2)) pacer.tick(t, true);
        assert.equal(pacer.measured, true, `${hz}`);
        assert.equal(Math.round(pacer.refreshHz), hz, `${hz} Hz`);
    }
    // 59,94 Hz es una pantalla de 60.
    const ntsc = createFramePacer();
    for (const t of rafTrain(59.94, 2)) ntsc.tick(t, true);
    assert.equal(Math.round(ntsc.refreshHz * 1000) / 1000, 60, "ajustada a la conocida, no 59,94");
    // Con el menú a 30 (uno de cada 2), los rAF siguen llegando todos: mide 60.
    const menu = createFramePacer();
    menu.setDivisor(2);
    for (const t of rafTrain(60, 2)) menu.tick(t, true);
    assert.equal(Math.round(menu.refreshHz), 60);
    assert.ok(Math.abs(menu.frameMs - 33.33) < 0.1);
});

test('en plena partida no aprende: un equipo que no llega no convierte la pantalla en una de 30 Hz', () => {
    const pacer = createFramePacer();
    for (const t of rafTrain(60, 2)) pacer.tick(t, true);
    assert.equal(Math.round(pacer.refreshHz), 60);
    // La partida va a 30: los rAF llegan cada 33 ms.
    for (const t of rafTrain(30, 6, { from: 5000 })) pacer.tick(t, false);
    assert.equal(Math.round(pacer.refreshHz), 60, 'sigue siendo una pantalla de 60');
    // De vuelta al menú, unos pocos rAF sueltos no bastan para cambiarla (lo de la partida no se mezcla).
    for (const t of rafTrain(60, 0.3, { from: 12000 })) pacer.tick(t, true);
    assert.equal(Math.round(pacer.refreshHz), 60);
    // Y si la ventana se va a otro monitor, en un estado de confianza se entera.
    for (const t of rafTrain(144, 2, { from: 13000 })) pacer.tick(t, true);
    assert.equal(Math.round(pacer.refreshHz), 144);
});

test('un hueco (pestaña oculta, render parado) no cuenta como intervalo, y un cambio de ritmo pinta en el rAF siguiente', () => {
    const pacer = createFramePacer();
    const train = rafTrain(60, 1);
    for (const t of train) pacer.tick(t, true);
    pacer.skip();
    // Vuelve 5 s después: ese hueco no es de la pantalla.
    for (const t of rafTrain(60, 1.2, { from: 8000 })) pacer.tick(t, true);
    assert.equal(Math.round(pacer.refreshHz), 60);

    pacer.setDivisor(4);
    assert.equal(pacer.tick(20000, false), true, 'el primer rAF tras cambiar el ritmo pinta');
    assert.equal(pacer.tick(20016.7, false), false);
    assert.equal(pacer.divisor, 4);
    pacer.setDivisor(4);
    assert.equal(pacer.tick(20033.3, false), false, 'pedir el mismo ritmo no reinicia la cuenta');
});

test('a un equipo que no llega los rAF le llegan a menos: el ritmo va por tiempo, no contándolos', () => {
    // Pantalla de 60 Hz, 30 estables pedidos (uno de cada 2)…
    const pacer = createFramePacer();
    for (const t of rafTrain(60, 2)) pacer.tick(t, true);
    pacer.setDivisor(divisorFor(pacer.refreshHz, 0, 'steady'));
    assert.equal(pacer.divisor, 2);
    // …pero el equipo solo entrega un rAF cada 33 ms: se pintan todos (antes, uno de cada 2: 15).
    const slow = rafTrain(30, 3, { from: 9000 });
    assert.equal(slow.filter((t) => pacer.tick(t, false)).length, slow.length);
    // Con rAF cada 50 ms (20 por segundo), también todos.
    const slower = rafTrain(20, 3, { from: 20000 });
    assert.equal(slower.filter((t) => pacer.tick(t, false)).length, slower.length);
    // Y cuando vuelven a llegar a 60, otra vez uno de cada 2, parejos.
    const back = rafTrain(60, 2, { from: 30000 }).filter((t) => pacer.tick(t, false));
    const gaps = back.slice(1).map((t, i) => t - back[i]);
    for (const g of gaps) assert.ok(Math.abs(g - 33.33) < 0.5, `${g.toFixed(2)} ms`);
});
