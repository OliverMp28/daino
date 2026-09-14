// Ola 4 — publicar con análisis en servidor, desde el cliente: qué enseña la UI
// (publishModel) y cómo se sigue el análisis (analysisWatcher) con un reloj
// falso, sin red ni DOM. Tras el playtest de la Ola 5, publicar son dos pasos:
// analizar (el nivel queda listo) y confirmar con la dificultad elegida.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    analysisView, difficultyChoiceView, failureView, publishOutcome, publishStateFor, publishView, stageLabel, PUBLISH_STATE, STAGE_LABELS,
} from '../../resources/js/ui/publishModel.js';
import { createAnalysisWatcher, POLL_MS } from '../../resources/js/api/analysisWatcher.js';
import { cardView } from '../../resources/js/ui/catalogModel.js';

const mine = (extra = {}) => ({
    id: 5, title: 'Mi tema', is_mine: true, is_official: false, is_public: false, pending_public: false,
    has_audio: false, analysis: null, difficulty: 3, duration_sec: 120, ...extra,
});

// --------------------------- Modelo ---------------------------

test('estado de publicación: privado, analizando, listo, fallido y público', () => {
    assert.equal(publishStateFor(mine()), PUBLISH_STATE.PRIVATE);
    assert.equal(publishStateFor(mine({ pending_public: true, has_audio: true })), PUBLISH_STATE.ANALYZING);
    assert.equal(publishStateFor(mine({ has_audio: true, publish_ready: true })), PUBLISH_STATE.READY);
    assert.equal(publishStateFor(mine({ has_audio: true, publish_ready: true, pending_public: true })), PUBLISH_STATE.ANALYZING,
        'reanalizándose: su chart va a cambiar, todavía no se elige nada');
    assert.equal(publishStateFor(mine({ has_audio: true, analysis: { status: 'failed' } })), PUBLISH_STATE.FAILED);
    assert.equal(publishStateFor(mine({ is_public: true, has_audio: true, analysis: { status: 'failed' } })), PUBLISH_STATE.PUBLIC,
        'un reanálisis fallido no despublica');
    // Falló y después lo retiró (se borró el MP3): vuelve a ser un privado normal.
    assert.equal(publishStateFor(mine({ has_audio: false, analysis: { status: 'failed' } })), PUBLISH_STATE.PRIVATE);
    // Un reintento tras un fallo pasajero sigue pendiente.
    assert.equal(publishStateFor(mine({ pending_public: true, has_audio: true, analysis: { status: 'queued', attempts: 1 } })), PUBLISH_STATE.ANALYZING);
});

test('análisis en cola: posición en la cola o aviso de reintento', () => {
    assert.equal(analysisView({ status: 'queued', attempts: 0, queue_position: 0 }).detail, 'Eres el siguiente.');
    assert.equal(analysisView({ status: 'queued', attempts: 0, queue_position: 1 }).detail, '1 canción por delante.');
    assert.equal(analysisView({ status: 'queued', attempts: 0, queue_position: 4 }).detail, '4 canciones por delante.');
    assert.match(analysisView({ status: 'queued', attempts: 1, queue_position: 0 }).detail, /reintentará/);
    const v = analysisView({ status: 'queued', attempts: 0, queue_position: null });
    assert.deepEqual([v.tone, v.progress, v.active, v.canRetry], ['waiting', null, true, false]);
});

test('análisis en curso: etapa con palabras de jugador y progreso acotado', () => {
    const v = analysisView({ status: 'running', stage: 'beats', progress: 0.466 });
    assert.equal(v.detail, 'Buscando el pulso');
    assert.equal(v.progress, 0.466);
    assert.equal(analysisView({ status: 'running', stage: 'x', progress: 7 }).progress, 1);
    assert.equal(analysisView({ status: 'running', stage: 'x', progress: 'nope' }).progress, 0);
    assert.equal(stageLabel('etapa-de-un-worker-futuro'), 'Analizando');
    // Toda etapa que emite el analizador tiene texto propio.
    for (const stage of ['starting', 'analyzing', 'spectral', 'beats', 'onsets', 'energy', 'sections', 'features', 'done', 'charting']) {
        assert.ok(Object.hasOwn(STAGE_LABELS, stage), stage);
    }
});

test('fallos: mensaje comprensible y reintento solo si puede salir bien', () => {
    assert.equal(failureView('timeout').retryable, true);
    assert.equal(failureView('analyzer_crashed').retryable, true);
    assert.equal(failureView('decode_failed').retryable, false, 'el archivo no es audio: reintentar no sirve');
    assert.equal(failureView('audio_mismatch').retryable, false);
    assert.equal(failureView('audio_missing').retryable, false);
    assert.equal(failureView('toString').retryable, true, 'claves del prototipo no cuentan como fallo conocido');
    assert.match(failureView('lo-que-sea').message, /inesperado/);

    const v = analysisView({ status: 'failed', error: { code: 'decode_failed', message: 'ffmpeg: Invalid data found' } });
    assert.equal(v.tone, 'error');
    assert.doesNotMatch(v.detail, /ffmpeg/, 'nunca se enseña el mensaje técnico del worker');
    assert.equal(analysisView({ status: 'done' }), null);
    assert.equal(analysisView({ status: 'cancelled' }), null);
    assert.equal(analysisView(null), null);
});

test('vista de publicación: qué se puede hacer en cada estado', () => {
    const analyzing = publishView(mine({ pending_public: true, has_audio: true, analysis: null }));
    assert.equal(analyzing.badge, 'Analizando');
    assert.equal(analyzing.canPublish, false, 'no se vuelve a subir mientras se analiza');
    assert.equal(analyzing.analysis.tone, 'waiting', 'sin resumen todavía: en cola');

    const failedRetryable = publishView(mine({ has_audio: true, analysis: { status: 'failed', error: { code: 'timeout' } } }));
    assert.deepEqual([failedRetryable.badge, failedRetryable.canPublish, failedRetryable.canRetry], ['Sin publicar', true, true]);
    const failedFile = publishView(mine({ has_audio: true, analysis: { status: 'failed', error: { code: 'decode_failed' } } }));
    assert.deepEqual([failedFile.canPublish, failedFile.canRetry], [true, false]);

    assert.deepEqual([publishView(mine()).badge, publishView(mine()).canPublish], ['Privado', true]);
    assert.equal(publishView(mine({ is_public: true })).canPublish, false);
    assert.equal(publishView(mine({ is_mine: false })).canPublish, false, 'lo ajeno nunca se publica');
    assert.equal(publishView(mine({ is_official: true })).canPublish, false);

    const ready = publishView(mine({ has_audio: true, publish_ready: true }));
    assert.deepEqual([ready.badge, ready.canPublish, ready.canConfirm], ['Listo para publicar', false, true],
        'analizado: no se vuelve a subir, se confirma con la dificultad elegida');
    assert.equal(publishView(mine({ has_audio: true, publish_ready: true, is_mine: false })).canConfirm, false);
    assert.equal(publishView(mine({ is_public: true })).canConfirm, false);
});

test('la tarjeta refleja la publicación en curso', () => {
    const card = cardView(mine({ pending_public: true, has_audio: true, analysis: { status: 'running', stage: 'onsets', progress: 0.5 } }));
    assert.equal(card.badge, 'Analizando');
    assert.equal(card.canPublish, false);
    assert.equal(card.publish.state, PUBLISH_STATE.ANALYZING);
    assert.equal(cardView({ ...mine({ is_public: true }), is_official: true }).badge, 'Oficial');
});

test('desenlace de un análisis para publicar según /analysis', () => {
    assert.equal(publishOutcome({ is_public: false, pending_public: true, analysis: { status: 'running' } }), null);
    assert.equal(publishOutcome({ is_public: false, pending_public: true, analysis: { status: 'queued', attempts: 1 } }), null);
    assert.equal(publishOutcome({ is_public: false, pending_public: false, publish_ready: true, analysis: { status: 'done' } }), 'ready',
        'analizado: NO se publica solo, espera a que su autor elija la dificultad');
    assert.equal(publishOutcome({ is_public: true, pending_public: false, analysis: { status: 'done' } }), 'published',
        'sin analizador en el servidor se publica al instante');
    assert.equal(publishOutcome({ is_public: true, pending_public: false, analysis: { status: 'running', purpose: 'reanalyze' } }), null);
    assert.equal(publishOutcome({ is_public: false, pending_public: false, analysis: { status: 'failed' } }), 'failed');
    assert.equal(publishOutcome({ is_public: false, pending_public: false, analysis: { status: 'cancelled' } }), 'cancelled');
});

test('selector de dificultad: solo en un nivel propio listo para publicar, y solo lo que la canción admite', () => {
    const choice = (requested, options) => ({ requested, options });
    const ready = (extra = {}) => mine({ has_audio: true, publish_ready: true, difficulty: 3, ...extra });

    // Publicado: una sola dificultad para siempre. Sin analizar: no se sabe qué admite.
    assert.equal(difficultyChoiceView(mine({ is_public: true, has_audio: true, difficulty_choice: choice('auto', [1, 2, 3]) })), null,
        'un nivel publicado nunca ofrece cambiarla');
    assert.equal(difficultyChoiceView(mine({ difficulty_choice: choice('auto', [1, 2, 3]) })), null, 'privado sin analizar: nada');
    assert.equal(difficultyChoiceView(mine({ pending_public: true, has_audio: true, publish_ready: true, difficulty_choice: choice('auto', [1, 2]) })), null,
        'analizándose: todavía no');
    assert.equal(difficultyChoiceView(ready({ difficulty_choice: null })), null, 'a otros jugadores no les llega');
    assert.equal(difficultyChoiceView(ready({ difficulty_choice: choice('auto', []) })), null);

    const v = difficultyChoiceView(ready({ difficulty_choice: choice('auto', [1, 2, 3, 4]) }));
    assert.deepEqual(v.options.map((o) => o.value), ['auto', 1, 2, 3, 4], 'nunca por encima del techo');
    assert.deepEqual(v.options.map((o) => o.label), ['Automática', 'Relajado', 'Fácil', 'Normal', 'Difícil']);
    assert.equal(v.options[0].hint, 'Normal', 'Automática dice cuál es');
    assert.equal(v.current, 'auto');
    assert.match(v.note, /hasta Difícil/);
    assert.equal(v.resetsBest, false);

    const calm = difficultyChoiceView(ready({ difficulty_choice: choice(2, [1, 2]) }));
    assert.equal(calm.options[0].hint, 'Fácil', 'una canción tranquila (techo 2): Automática es Fácil y no hay más');
    assert.equal(calm.current, 2);

    assert.match(difficultyChoiceView(ready({ difficulty_choice: choice(5, [1, 2, 3, 4, 5]) })).note, /todas/);
    assert.equal(difficultyChoiceView(ready({ my_best: { points: 10, percentage: 3 }, difficulty_choice: choice(3, [1, 2, 3]) })).resetsBest, true,
        'con marca de prueba, se avisa de que cambiarla la borra');

    const stale = difficultyChoiceView(ready({ difficulty_choice: choice(5, [1, 2, 3]) }));
    assert.equal(stale.current, 'auto', 'una pedida por encima del techo actual se enseña como Automática');
});

// --------------------------- Seguimiento ---------------------------

/** Reloj falso: las tareas programadas se ejecutan a mano, en orden de vencimiento. */
function fakeClock() {
    let now = 0;
    let seq = 0;
    const tasks = new Map();
    return {
        schedule(fn, ms) {
            const id = ++seq;
            tasks.set(id, { fn, at: now + ms, ms });
            return id;
        },
        cancel(id) { tasks.delete(id); },
        /** Delays de las tareas pendientes. */
        pending() { return [...tasks.values()].map((t) => t.ms); },
        /** Ejecuta la siguiente tarea y devuelve cuánto se esperó. */
        async next() {
            const [id, task] = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
            if (id === undefined) return null;
            tasks.delete(id);
            now = task.at;
            task.fn();
            await flush();
            return task.ms;
        },
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function statusScript(steps) {
    const calls = [];
    return {
        calls,
        async fetchStatus(id) {
            calls.push(id);
            const step = steps[Math.min(calls.length - 1, steps.length - 1)];
            if (step instanceof Error) throw step;
            return step;
        },
    };
}

const ok = (data) => ({ ok: true, status: 200, data });
const pending = (analysis) => ok({ level_id: 5, is_public: false, pending_public: true, analysis });

test('sigue la publicación: cola → análisis → listo para publicar, a ritmo adaptado, y se detiene solo', async () => {
    const clock = fakeClock();
    const script = statusScript([
        pending({ status: 'queued', attempts: 0, queue_position: 1 }),
        pending({ status: 'running', stage: 'beats', progress: 0.2 }),
        pending({ status: 'running', stage: 'charting', progress: 0.92 }),
        ok({ level_id: 5, is_public: false, pending_public: false, publish_ready: true, analysis: { status: 'done', created_at: 't1' } }),
    ]);
    const settled = [];
    const seen = [];
    const watcher = createAnalysisWatcher({
        fetchStatus: script.fetchStatus,
        fetchLevel: async () => ok({ id: 5, title: 'Mi tema', is_public: false, publish_ready: true }),
        schedule: clock.schedule, cancel: clock.cancel,
        onSettled: (e) => settled.push(e),
    });

    watcher.track(5, { title: 'Mi tema' });
    const off = watcher.subscribe(5, (s) => seen.push(s.analysis.status));
    await flush();
    assert.equal(script.calls.length, 1, 'la primera consulta sale al momento, y una sola aunque haya dos interesados');
    assert.deepEqual(clock.pending(), [POLL_MS.queued], 'en cola se consulta sin prisa');

    assert.equal(await clock.next(), POLL_MS.queued);
    assert.deepEqual(clock.pending(), [POLL_MS.running], 'analizando se consulta a menudo: hay progreso que enseñar');
    await clock.next();
    await clock.next();

    assert.equal(settled.length, 1);
    assert.equal(settled[0].outcome, 'ready');
    assert.deepEqual([settled[0].level.is_public, settled[0].level.publish_ready], [false, true]);
    assert.equal(settled[0].title, 'Mi tema');
    assert.deepEqual(seen, ['queued', 'running', 'running', 'done']);
    assert.deepEqual(clock.pending(), [], 'terminado: no queda nada programado');
    assert.equal(watcher.isTracking(5), false);
    off();
});

test('suscribirse tarde recibe el último estado al momento', async () => {
    const clock = fakeClock();
    const watcher = createAnalysisWatcher({
        fetchStatus: async () => pending({ status: 'running', stage: 'onsets', progress: 0.6 }),
        fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel,
    });
    watcher.track(5);
    await flush();
    let got = null;
    watcher.subscribe(5, (s) => { got = s.analysis.progress; });
    assert.equal(got, 0.6);
});

test('errores de red: espera creciente con tope, y vuelve al ritmo normal al recuperarse', async () => {
    const clock = fakeClock();
    const down = { ok: false, status: 0, data: null };
    const script = statusScript([down, down, down, down, down, down, pending({ status: 'running', progress: 0.1 })]);
    const watcher = createAnalysisWatcher({
        fetchStatus: script.fetchStatus, fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel,
    });
    watcher.track(5);
    await flush();
    const waits = [];
    for (let i = 0; i < 6; i++) waits.push(await clock.next());
    assert.deepEqual(waits, [3000, 6000, 12000, 24000, 30000, 30000]);
    assert.deepEqual(clock.pending(), [POLL_MS.running], 'recuperado: sin castigo acumulado');
    watcher.stopAll();
});

test('una excepción de la petición cuenta como fallo de red, no rompe el seguimiento', async () => {
    const clock = fakeClock();
    const script = statusScript([new Error('boom'), pending({ status: 'queued', attempts: 0 })]);
    const watcher = createAnalysisWatcher({
        fetchStatus: script.fetchStatus, fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel,
    });
    watcher.track(5);
    await flush();
    assert.deepEqual(clock.pending(), [POLL_MS.errorBase]);
    await clock.next();
    assert.deepEqual(clock.pending(), [POLL_MS.queued]);
    watcher.stopAll();
});

test('con la pestaña oculta se consulta mucho menos, y refresh() consulta ya', async () => {
    const clock = fakeClock();
    let hidden = true;
    const script = statusScript([pending({ status: 'running', progress: 0.3 })]);
    const watcher = createAnalysisWatcher({
        fetchStatus: script.fetchStatus, fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel, isHidden: () => hidden,
    });
    watcher.track(5);
    await flush();
    assert.deepEqual(clock.pending(), [POLL_MS.hidden]);

    hidden = false;
    watcher.refresh();
    await flush();
    assert.equal(script.calls.length, 2, 'al volver a la pestaña no se esperan 15 s');
    assert.deepEqual(clock.pending(), [POLL_MS.running], 'la espera anterior se cancela: nunca dos sondeos del mismo nivel');
    watcher.stopAll();
});

test('fallo del análisis y nivel desaparecido terminan el seguimiento con su desenlace', async () => {
    const clock = fakeClock();
    const settled = [];
    const failed = ok({ level_id: 5, is_public: false, pending_public: false, analysis: { status: 'failed', error: { code: 'timeout' } } });
    const responses = { 5: failed, 6: { ok: false, status: 404, data: { error: 'not_found' } } };
    const levelCalls = [];
    const watcher = createAnalysisWatcher({
        fetchStatus: async (id) => responses[id],
        fetchLevel: async (id) => { levelCalls.push(id); return ok({ id, is_public: false }); },
        schedule: clock.schedule, cancel: clock.cancel,
        onSettled: (e) => settled.push(e),
    });
    watcher.track(5);
    watcher.track(6);
    await flush();
    assert.deepEqual(settled.map((e) => [e.levelId, e.outcome]).sort(), [[5, 'failed'], [6, 'gone']]);
    assert.deepEqual(levelCalls, [5], 'de un nivel que ya no existe no se pide nada más');
    assert.equal(watcher.size, 0);
});

test('stopAll (cerrar sesión) cancela todo sin avisar', async () => {
    const clock = fakeClock();
    const settled = [];
    const watcher = createAnalysisWatcher({
        fetchStatus: async () => pending({ status: 'queued', attempts: 0 }),
        fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel,
        onSettled: (e) => settled.push(e),
    });
    watcher.track(1);
    watcher.track(2);
    await flush();
    assert.equal(clock.pending().length, 2);
    watcher.stopAll();
    assert.deepEqual(clock.pending(), []);
    assert.deepEqual(settled, []);
});

test('una respuesta que llega después de parar no reprograma nada', async () => {
    const clock = fakeClock();
    let release;
    const watcher = createAnalysisWatcher({
        fetchStatus: () => new Promise((resolve) => { release = resolve; }),
        fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel,
    });
    watcher.track(5);
    watcher.stopAll();
    release(pending({ status: 'running', progress: 0.5 }));
    await flush();
    assert.deepEqual(clock.pending(), []);
    assert.equal(watcher.latest(5), null);
});

test('un suscriptor que lanza no rompe a los demás ni el seguimiento', async () => {
    const clock = fakeClock();
    const watcher = createAnalysisWatcher({
        fetchStatus: async () => pending({ status: 'running', progress: 0.5 }),
        fetchLevel: async () => ok(null),
        schedule: clock.schedule, cancel: clock.cancel,
    });
    const originalError = console.error;
    console.error = () => {};
    try {
        let second = 0;
        watcher.subscribe(5, () => { throw new Error('vista rota'); });
        watcher.subscribe(5, () => { second++; });
        await flush();
        assert.equal(second, 1);
        assert.deepEqual(clock.pending(), [POLL_MS.running]);
    } finally {
        console.error = originalError;
        watcher.stopAll();
    }
});
