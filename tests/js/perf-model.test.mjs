// La lectura de rendimiento (T05.4): lo que mide el engine, en una línea que quien
// prueba el juego en su móvil puede leer y decir.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { perfLine, perfStat, perfWanted, qualityLabel } from '../../resources/js/ui/perfModel.js';
import { runPanelView } from '../../resources/js/ui/runPanelModel.js';

/** Lo que devuelve `engine.getPerf()`, con valores de una partida normal. */
const PERF = Object.freeze({
    frames: 7200, seconds: 120, fps: 59.94, lateRatio: 0.004, cpuMs: 1.83, worstMs: 34, downs: 0,
    tier: 'high', pace: 'native', locked: false, refreshHz: 60, measured: true, divisor: 1,
    skyTexels: 6, skyNative: 7, skySize: [1646, 926], skyHz: 30, skyFields: 2, canvas: [1920, 1080],
});

test('la línea de rendimiento dice fotogramas, tardíos, JS, calidad, cielo y pantalla', () => {
    assert.equal(perfLine(PERF), '60 FPS · 0,4 % tardíos · JS 1,8 ms · Alta · cielo 6 · 60 Hz');
    assert.equal(
        perfLine({ ...PERF, fps: 29.8, lateRatio: 0.031, cpuMs: 9.4, tier: 'medium', pace: 'steady', skyTexels: 4 }),
        '30 FPS · 3,1 % tardíos · JS 9,4 ms · Media a 30 · cielo 4 · 60 Hz',
    );
    // Sin nada medido (el menú, un intento de un segundo) solo dice el equipo.
    assert.equal(perfLine({ ...PERF, frames: 0, fps: 0 }), 'Alta · cielo 6 · 60 Hz');
    assert.equal(perfLine({ ...PERF, frames: 12 }), 'Alta · cielo 6 · 60 Hz');
});

test('la calidad en uso, con su ritmo y si es fija', () => {
    assert.equal(qualityLabel({ tier: 'high', pace: 'native' }), 'Alta');
    assert.equal(qualityLabel({ tier: 'low', pace: 'steady' }), 'Baja a 30');
    assert.equal(qualityLabel({ tier: 'high', pace: 'half' }), 'Alta a la mitad');
    assert.equal(qualityLabel({ tier: 'medium', pace: 'native', locked: true }), 'Media (fija)');
});

test('se enseña en desarrollo, o en producción con ?perf=1', () => {
    assert.equal(perfWanted('', true), true);
    assert.equal(perfWanted('', false), false);
    assert.equal(perfWanted('?perf=1', false), true);
    assert.equal(perfWanted('?seed=3&perf=1', false), true);
    assert.equal(perfWanted('?perf=0', false), false);
});

test('el panel de resultados lleva la fila "Rendimiento" solo si se le pasa lo medido', () => {
    const run = { mode: 'results', kind: 'collision', percentage: 40, points: 1200, reachedSec: 48, durationSec: 120, attempt: 2, title: 'X' };
    const labels = (view) => view.stats.map((s) => s.label);
    assert.ok(!labels(runPanelView(run)).includes('Rendimiento'));
    assert.ok(!labels(runPanelView({ ...run, perf: null })).includes('Rendimiento'));
    const view = runPanelView({ ...run, perf: PERF });
    assert.deepEqual(view.stats.at(-1), { label: 'Rendimiento', value: '60 FPS · 0,4 %' });
    // Un intento de un suspiro no dice nada.
    assert.equal(perfStat({ ...PERF, frames: 10 }), null);
});
