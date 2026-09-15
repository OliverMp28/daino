// Panel de partida (reintentos, Sep 2026): qué se enseña al pausar y al
// terminar, qué hace cada tecla y cómo se cuentan los intentos. Sin DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RUN_ACTION, createAttemptCounter, keyAction, runPanelView } from '../../resources/js/ui/runPanelModel.js';

const SECTIONS = [
    { t: 0, level: 1 },
    { t: 60, level: 2 },
    { t: 150, level: 4, climax: true },
    { t: 185, level: 1 },
];

const base = {
    mode: 'results',
    kind: 'collision',
    percentage: 57,
    points: 12345,
    reachedSec: 123,
    durationSec: 215,
    attempt: 3,
    previousBest: null,
    title: "What's Up Danger",
    sections: SECTIONS,
};

test('al chocar: el porcentaje manda y REINTENTAR es la acción principal (Espacio), con Niveles (Esc) y Menú', () => {
    const v = runPanelView(base);
    assert.equal(v.tone, 'fail');
    assert.equal(v.heading, 'Llegaste al');
    assert.equal(v.percentLabel, '57 %');
    assert.deepEqual(v.primary, { action: RUN_ACTION.RETRY, label: 'Reintentar', key: 'Espacio' });
    assert.deepEqual(v.secondary.map((a) => [a.action, a.key]), [[RUN_ACTION.LEVELS, 'Esc'], [RUN_ACTION.MENU, null]]);
    assert.deepEqual(v.stats.map((s) => s.value), ['12.345', '2:03 / 3:35', '3']);
    assert.equal(v.offerAutoRetry, true);
    assert.equal(v.bar.fill, 0.57);
});

test('récord: solo si supera una marca que ya había; la primera partida no "bate" nada', () => {
    const first = runPanelView(base);
    assert.equal(first.newBest, false);
    assert.equal(first.bar.best, null);

    const better = runPanelView({ ...base, previousBest: { points: 9000, percentage: 42 } });
    assert.equal(better.newBest, true);
    assert.equal(better.tone, 'record');
    assert.equal(better.heading, '¡Nuevo récord!');
    assert.equal(better.note, 'Superas tu marca del 42 %.');
    assert.equal(better.bar.best, 0.42, 'la marca anterior sigue marcada en la barra');

    const worse = runPanelView({ ...base, previousBest: { points: 20000, percentage: 72 } });
    assert.equal(worse.newBest, false);
    assert.equal(worse.note, 'Tu mejor marca: 72 %.');
});

test('notas: casi al final, en pleno clímax', () => {
    assert.equal(runPanelView({ ...base, percentage: 93, reachedSec: 200 }).note, '¡Te faltaba muy poco!');
    assert.equal(runPanelView({ ...base, percentage: 75, reachedSec: 160 }).note, 'Caíste en pleno clímax.');
    assert.equal(runPanelView({ ...base, percentage: 20, reachedSec: 40 }).note, null);
});

test('victoria: "Otra vez" delante, sin interruptor de reintento automático', () => {
    const v = runPanelView({ ...base, kind: 'win', percentage: 100, reachedSec: 215, previousBest: { points: 1, percentage: 80 } });
    assert.equal(v.tone, 'win');
    assert.equal(v.heading, '¡Nivel superado!');
    assert.equal(v.primary.label, 'Otra vez');
    assert.equal(v.note, 'Primera vez que lo completas.');
    assert.equal(v.offerAutoRetry, false);
    assert.equal(runPanelView({ ...base, kind: 'win', percentage: 100, previousBest: { points: 1, percentage: 100 } }).note, null);
});

test('pausa: Reanudar delante (Esc) y Reintentar, Niveles y Menú detrás; sugiere girar el móvil en vertical', () => {
    const v = runPanelView({ ...base, mode: 'pause', kind: undefined, percentage: 40 });
    assert.equal(v.heading, 'Pausa');
    assert.deepEqual(v.primary, { action: RUN_ACTION.RESUME, label: 'Reanudar', key: 'Esc' });
    assert.deepEqual(v.secondary.map((a) => a.action), [RUN_ACTION.RETRY, RUN_ACTION.LEVELS, RUN_ACTION.MENU]);
    assert.equal(v.offerAutoRetry, false);
    assert.equal(v.newBest, false, 'pausar no es terminar');
    assert.match(runPanelView({ ...base, mode: 'pause', rotate: true }).note, /Gira el móvil/);
});

test('mapa de la barra: los tramos de la canción como fracciones, con el clímax marcado', () => {
    const { segments } = runPanelView(base).bar;
    assert.equal(segments.length, 4);
    assert.deepEqual(segments[2], { from: 150 / 215, to: 185 / 215, level: 4, climax: true });
    assert.equal(segments.at(-1).to, 1);
    assert.deepEqual(runPanelView({ ...base, durationSec: 0 }).bar.segments, []);
});

test('teclas: en resultados Espacio/Enter/↑/R reintentan y Esc va a Niveles; en pausa Esc reanuda', () => {
    assert.equal(keyAction('results', { key: ' ', code: 'Space' }), RUN_ACTION.RETRY);
    assert.equal(keyAction('results', { key: 'Enter', code: 'Enter' }), RUN_ACTION.RETRY);
    assert.equal(keyAction('results', { key: 'ArrowUp', code: 'ArrowUp' }), RUN_ACTION.RETRY);
    assert.equal(keyAction('results', { key: 'r', code: 'KeyR' }), RUN_ACTION.RETRY);
    assert.equal(keyAction('results', { key: 'Escape', code: 'Escape' }), RUN_ACTION.LEVELS);
    assert.equal(keyAction('pause', { key: 'Escape', code: 'Escape' }), RUN_ACTION.RESUME);
    assert.equal(keyAction('pause', { key: ' ', code: 'Space' }), null, 'en pausa Espacio no reanuda por sorpresa');
    assert.equal(keyAction('pause', { key: 'r', code: 'KeyR' }), RUN_ACTION.RETRY);
});

test('teclas: una tecla mantenida desde antes (repetición) no decide; con el foco en Menú, Enter pulsa Menú', () => {
    assert.equal(keyAction('results', { key: ' ', code: 'Space', repeat: true }), null);
    assert.equal(keyAction('results', { key: 'Enter', code: 'Enter' }, { focusedSecondary: true }), null);
    assert.equal(keyAction('results', { key: 'Tab', code: 'Tab' }), null);
});

test('intentos: se cuentan por nivel y siguen al volver a elegir el mismo nivel', () => {
    const attempts = createAttemptCounter();
    assert.equal(attempts.next('level:7'), 1);
    assert.equal(attempts.next('level:7'), 2);
    assert.equal(attempts.next('audio:abc'), 1);
    assert.equal(attempts.next('level:7'), 3);
    assert.equal(attempts.peek('level:9'), 0);
});
