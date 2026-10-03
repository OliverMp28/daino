// Móviles (Oct 2026): qué toques se queda el juego y poner la pantalla en horizontal.
//
// Del playtest en un Android: "los botones solo funcionan si los toco por una
// esquina" y "el botón de poner en horizontal no hace nada".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { takesTouch } from '../../resources/js/game/systems/input.js';
import { canLockLandscape, lockLandscape } from '../../resources/js/ui/screenLock.js';
import { runPanelView } from '../../resources/js/ui/runPanelModel.js';

/** Un elemento de mentira: dice dentro de qué está. `kind` no es HTMLElement a propósito. */
const node = (...inside) => ({ kind: 'svg', closest: (selector) => (inside.includes(selector) ? {} : null) });

test('el juego solo se queda los toques sobre su lienzo, jugando y sin un diálogo encima', () => {
    const canvas = node('#app');
    assert.equal(takesTouch(canvas, true, false), true, 'jugando, en el lienzo: es un salto');
    assert.equal(takesTouch(canvas, false, false), false, 'en el menú el lienzo es el fondo de una página: deja tirar para recargar');
    assert.equal(takesTouch(canvas, true, true), false, 'con el panel de pausa o de resultados encima, tampoco');
});

test('el rótulo de un botón (un <svg>) no es del juego: su toque llega como clic', () => {
    // El fallo: `target instanceof HTMLElement` daba falso para el <svg> del rótulo,
    // el toque se tomaba por uno del juego y se anulaba. Solo funcionaba el borde.
    const label = node('button', '#hud-root');
    const pathInLabel = node('button', 'dialog', '#modal-root');
    assert.equal(takesTouch(label, true, false), false);
    assert.equal(takesTouch(pathInLabel, true, false), false);
    // Cualquier cosa nueva que se ponga sobre el lienzo es interfaz sin apuntarla en una lista.
    assert.equal(takesTouch(node('.algo-que-aun-no-existe'), true, false), false);
});

test('un destino raro no rompe nada', () => {
    assert.equal(takesTouch(null, true, false), false);
    assert.equal(takesTouch(undefined, true, false), false);
    assert.equal(takesTouch({}, true, false), false);
});

/** `document` y `screen` de mentira, con lo que un navegador puede o no dejar hacer. */
function fakeScreen({ fullscreen = 'ok', lock = 'ok', already = false } = {}) {
    const log = [];
    const doc = {
        fullscreenEnabled: fullscreen !== 'disabled',
        fullscreenElement: already ? {} : null,
        documentElement: fullscreen === 'missing' ? {} : {
            requestFullscreen: async () => {
                log.push('fullscreen');
                if (fullscreen === 'denied') throw new Error('sin gesto');
                doc.fullscreenElement = doc.documentElement;
            },
        },
        exitFullscreen: async () => { log.push('exit'); doc.fullscreenElement = null; },
    };
    const screen = {
        orientation: lock === 'missing' ? {} : {
            lock: async (kind) => {
                log.push(`lock:${kind}`);
                if (lock === 'denied') throw new Error('not available on this device');
            },
        },
    };
    return { env: { doc, screen }, log, doc };
}

test('poner en horizontal: pantalla completa y, dentro, orientación apaisada', async () => {
    const { env, log, doc } = fakeScreen();
    assert.equal(canLockLandscape(env), true);
    assert.equal(await lockLandscape(env), 'locked');
    assert.deepEqual(log, ['fullscreen', 'lock:landscape']);
    assert.notEqual(doc.fullscreenElement, null, 'se queda en pantalla completa: sin ella el navegador suelta la orientación');
});

test('si ya estaba en pantalla completa no la vuelve a pedir, ni la quita si falla', async () => {
    const ok = fakeScreen({ already: true });
    assert.equal(await lockLandscape(ok.env), 'locked');
    assert.deepEqual(ok.log, ['lock:landscape']);

    const denied = fakeScreen({ already: true, lock: 'denied' });
    assert.equal(await lockLandscape(denied.env), 'failed');
    assert.deepEqual(denied.log, ['lock:landscape'], 'la pantalla completa no era suya: no la toca');
});

test('si el navegador no deja girar, la pantalla completa se deshace: a medias no sirve', async () => {
    const { env, log, doc } = fakeScreen({ lock: 'denied' });
    assert.equal(await lockLandscape(env), 'failed');
    assert.deepEqual(log, ['fullscreen', 'lock:landscape', 'exit']);
    assert.equal(doc.fullscreenElement, null);

    const noGesture = fakeScreen({ fullscreen: 'denied' });
    assert.equal(await lockLandscape(noGesture.env), 'failed');
    assert.deepEqual(noGesture.log, ['fullscreen'], 'sin pantalla completa no se intenta lo demás');
});

test('donde no se puede (un iPhone) no se ofrece: no se promete lo que no se va a hacer', async () => {
    for (const env of [
        fakeScreen({ lock: 'missing' }).env,
        fakeScreen({ fullscreen: 'missing' }).env,
        fakeScreen({ fullscreen: 'disabled' }).env,
        { doc: null, screen: null },
    ]) {
        assert.equal(canLockLandscape(env), false);
        assert.equal(await lockLandscape(env), 'unsupported');
    }
});

test('el panel de pausa ofrece ponerlo en horizontal solo con el móvil en vertical', () => {
    const base = { mode: 'pause', percentage: 40, points: 1200, reachedSec: 30, durationSec: 80, attempt: 1, previousBest: null, title: 'x', sections: [] };
    assert.equal(runPanelView({ ...base, rotate: true }).rotate, true);
    assert.match(runPanelView({ ...base, rotate: true }).note, /horizontal/);
    assert.equal(runPanelView({ ...base, rotate: false }).rotate, false);
    assert.equal(runPanelView(base).rotate, false);
});
