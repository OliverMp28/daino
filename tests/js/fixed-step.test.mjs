// Física a paso fijo sincronizada con el reloj de audio (Ola 3).
//
// Este defecto lo encontró el E2E en navegador, no un test: con la máquina
// cargada había frames de 90-160 ms; los obstáculos (colocados desde el reloj
// de audio) avanzaban todo ese tiempo, pero el Dino integraba con dt capado a
// 33 ms, así que su salto quedaba atrás del mundo y un bot perfecto chocaba.
//
// Aquí se reproduce el bucle de frame del juego con las piezas reales (reloj
// de paso fijo, física, spawner, colisión por instante) bajo frames regulares
// e irregulares, para que no vuelva a pasar.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFixedStepper } from '../../resources/js/game/systems/fixedStep.js';
import { createInputTimeline, songTimeOfEvent } from '../../resources/js/game/systems/inputTimeline.js';
import { createSpawner } from '../../resources/js/game/systems/spawner.js';
import {
    applyInput, bodyHitbox, bodyState, enterMode, integrateBody,
} from '../../resources/js/game/systems/physics.js';
import { MAX_PHYSICS_CATCHUP_S, PHYSICS_STEP_S } from '../../resources/js/game/config.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { speedProfileOf } from '../../resources/js/game/systems/speedProfile.js';
import { toSimHolds, toSimModes, toSimObstacles } from '../../resources/js/game/systems/playability.js';
import { virtualPlayerScript } from '../../resources/js/game/systems/virtualPlayer.js';
import { createFlightCourse } from '../../resources/js/game/systems/flightCourse.js';
import { CONTRAST_SONG_SECTIONS, makeSyntheticAnalysis, makeSyntheticSong } from './helpers/synthetic-audio.mjs';

const GROUND = 700;

test('el reloj de paso fijo da los mismos pasos con frames regulares o con tirones', () => {
    const record = (frames) => {
        const stepper = createFixedStepper({ stepS: PHYSICS_STEP_S, maxCatchUpS: MAX_PHYSICS_CATCHUP_S });
        stepper.reset(0);
        const steps = [];
        let t = 0;
        for (const ms of frames) {
            t += ms / 1000;
            stepper.advance(t, (st) => { steps.push(st); });
        }
        return steps;
    };
    const smooth = record(new Array(600).fill(1000 / 120));             // 5 s a 120 fps
    const hitchy = record([160, 7, 90, 33, 250, 16, ...new Array(300).fill(14.8)]);  // ~5 s con tirones
    const n = Math.min(smooth.length, hitchy.length);
    assert.ok(n > 550);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(smooth[i] - hitchy[i]) < 1e-9, `paso ${i}`);
});

test('tras una congelación de minutos no se simula todo de golpe', () => {
    const stepper = createFixedStepper({ stepS: PHYSICS_STEP_S, maxCatchUpS: MAX_PHYSICS_CATCHUP_S });
    stepper.reset(0);
    let count = 0;
    stepper.advance(120, () => { count++; });
    assert.equal(count, Math.round(MAX_PHYSICS_CATCHUP_S / PHYSICS_STEP_S));
});

test('un frame lento pero legítimo (1 s, pestaña estrangulada) se recupera ENTERO', () => {
    // Regresión: con un tope de 0.5 s se descartaba medio segundo de física
    // por frame y el Dino se desincronizaba de la música.
    const stepper = createFixedStepper({ stepS: PHYSICS_STEP_S, maxCatchUpS: MAX_PHYSICS_CATCHUP_S });
    stepper.reset(0);
    let count = 0;
    for (let s = 1; s <= 10; s++) stepper.advance(s, () => { count++; });
    assert.equal(count, Math.round(10 / PHYSICS_STEP_S));
});

test('un nivel completo se supera aunque el juego vaya a 1 FPS', () => {
    const { chart } = buildChart(makeSyntheticAnalysis({ bpm: 120, durationSec: 40 }), { seed: 6 });
    assert.ok(runWithTimestampedInputs(chart, () => 1000));
});

test('un paso puede detener el avance (colisión)', () => {
    const stepper = createFixedStepper({ stepS: 0.01, maxCatchUpS: 1 });
    stepper.reset(0);
    let count = 0;
    const stopped = stepper.advance(0.5, () => ++count === 3);
    assert.equal(stopped, true);
    assert.equal(count, 3);
    assert.ok(Math.abs(stepper.time - 0.03) < 1e-9, 'el reloj queda en el paso que chocó');
});

/**
 * Reproduce el bucle de frame de GameSession con las piezas reales.
 * El jugador virtual reacciona en el primer FRAME con tiempo ≥ el del evento,
 * como una persona: no puede actuar entre dos frames que no ha visto.
 */
function playLikeTheGame(chart, frameMs) {
    const { script, modes, hits } = levelOf(chart);
    const spawner = fakeSpawner(chart);
    const body = bodyState(GROUND);
    const stepper = createFixedStepper({ stepS: PHYSICS_STEP_S, maxCatchUpS: MAX_PHYSICS_CATCHUP_S });
    const box = { x: 0, y: 0, w: 0, h: 0 };
    let next = 0;
    let modeIdx = 0;
    let songTime = 0;
    let frame = 0;
    const end = chart.audio.durationSec;

    while (songTime < end) {
        songTime += frameMs(frame++) / 1000;

        // Entrada del jugador (entre frames, como los eventos de teclado).
        while (next < script.length && script[next].at <= songTime) applyInput(body, script[next++].input);

        // Igual que GameSession: física a paso fijo (portales en su instante), luego el spawner.
        let hitAt = null;
        stepper.advance(songTime, (t) => {
            while (modeIdx < modes.length && modes[modeIdx].t <= t) enterMode(body, modes[modeIdx++].mode);
            integrateBody(body, PHYSICS_STEP_S, GROUND);
            if (spawner.collisionAt(bodyHitbox(body, box), t, GROUND) !== null || hits(box, t)) { hitAt = t; return true; }
            return false;
        });
        if (hitAt !== null) return { ok: false, at: hitAt };
        spawner.tick(songTime, frameMs(frame) / 1000, { width: 1920, groundY: GROUND });
    }
    return { ok: true, frames: frame };
}

test('un nivel completo se supera actuando en el beat, a 144, 60 y 30 fps', () => {
    for (const bpm of [90, 128, 170]) {
        const { chart } = buildChart(makeSyntheticAnalysis({ bpm, durationSec: 60 }), { seed: 3 });
        for (const fps of [144, 60, 30]) {
            const r = playLikeTheGame(chart, () => 1000 / fps);
            assert.ok(r.ok, `${bpm} BPM a ${fps} fps: choque en t=${r.at?.toFixed(3)}`);
        }
    }
});

test('un nivel con antigravedad y vuelo (Olas 6a-6b) se supera con portales y túnel en su paso de física, a 144, 60, 30 y 1 fps y con tirones', () => {
    const { chart, report } = buildChart(makeSyntheticSong({ bpm: 124, sections: CONTRAST_SONG_SECTIONS }), { seed: 8, difficulty: 5 });
    assert.deepEqual(report.modes.map((m) => m.mode), ['flip', 'fly'], 'el chart invierte la gravedad y vuela');
    assert.ok(report.holds >= 4, `${report.holds} notas mantenidas`);
    for (const fps of [144, 60, 30]) {
        const r = playLikeTheGame(chart, () => 1000 / fps);
        assert.ok(r.ok, `${fps} fps: choque en t=${r.at?.toFixed(3)}`);
    }
    assert.ok(runWithTimestampedInputs(chart, () => 1000), 'a 1 FPS con pulsaciones fechadas');
    assert.ok(runWithTimestampedInputs(chart, (i) => (i % 5 === 2 ? 250 : 16)), 'con tirones de 250 ms');
});

test('se supera también con frames irregulares y tirones moderados', () => {
    // Patrón pseudoaleatorio determinista entre 6 y 33 ms, con un tirón de
    // 33 ms cada pocos frames: una máquina ocupada pero jugable.
    const jitter = (i) => [16, 7, 33, 12, 25, 16, 9, 33, 20, 14][i % 10];
    const { chart } = buildChart(makeSyntheticAnalysis({ bpm: 140, durationSec: 60 }), { seed: 5 });
    assert.ok(playLikeTheGame(chart, jitter).ok);
});

test('regresión: con dt capado (el bucle anterior) un tirón hacía chocar a quien pulsó a tiempo', () => {
    // Documenta el defecto: el mismo jugador y el mismo chart, pero integrando
    // la física con el delta de frame capado a 1/30 s como hacía la Ola 3
    // antes del arreglo, chocan en cuanto aparecen tirones de 160 ms.
    const { chart } = buildChart(makeSyntheticAnalysis({ bpm: 128, durationSec: 30 }), { seed: 2 });
    const hitchEvery = (i) => (i % 7 === 3 ? 160 : 16);

    const oldLoop = () => {
        const { script } = levelOf(chart);
        const spawner = fakeSpawner(chart);
        const body = bodyState(GROUND);
        let songTime = 0; let next = 0; let frame = 0;
        const box = { x: 0, y: 0, w: 0, h: 0 };
        while (songTime < chart.audio.durationSec) {
            const ms = hitchEvery(frame++);
            songTime += ms / 1000;
            while (next < script.length && script[next].at <= songTime) applyInput(body, script[next++].input);
            integrateBody(body, Math.min(1 / 30, ms / 1000), GROUND);   // ← el defecto
            if (spawner.collisionAt(bodyHitbox(body, box), songTime, GROUND) !== null) return false;
            spawner.tick(songTime, ms / 1000, { width: 1920, groundY: GROUND });
        }
        return true;
    };

    assert.equal(oldLoop(), false, 'el bucle con dt capado debería chocar con tirones');
});

// --------------------------- Pulsaciones fechadas ---------------------------


test('una pulsación se fecha en el instante en que ocurrió, no en el que se leyó', () => {
    // El jugador oye t=10.000 s ahora; la tecla se pulsó 250 ms antes (el hilo
    // estuvo ocupado un frame largo): su instante musical es 9.750 s.
    assert.ok(Math.abs(songTimeOfEvent(10, 5000, 5250) - 9.75) < 1e-9);
    // Una marca "del futuro" (relojes desalineados) no adelanta la pulsación.
    assert.equal(songTimeOfEvent(10, 6000, 5250), 10);
    // Nunca antes de lo ya simulado: la física no se reescribe.
    assert.equal(songTimeOfEvent(10, 5000, 5250, 9.9), 9.9);
});

test('la cola aplica cada pulsación en su paso y en orden de llegada', () => {
    const tl = createInputTimeline();
    tl.push('jump', 1.0);
    tl.push('duckStart', 0.5);
    tl.push('jumpEnd', 1.0);    // mismo instante que 'jump': va detrás
    const applied = [];
    tl.drainUntil(0.49, (a) => applied.push(a));
    assert.deepEqual(applied, []);
    tl.drainUntil(1.0, (a) => applied.push(a));
    assert.deepEqual(applied, ['duckStart', 'jump', 'jumpEnd']);
    assert.equal(tl.size, 0);
});

test('con pulsaciones fechadas, un tirón de 250 ms ya no cambia el resultado', () => {
    // El jugador pulsa exactamente en el beat, pero el juego solo lee la tecla
    // al final de cada frame. Con la cola fechada, la física aplica cada salto
    // en su instante real aunque el frame dure 250 ms.
    const { chart } = buildChart(makeSyntheticAnalysis({ bpm: 128, durationSec: 40 }), { seed: 4 });
    assert.equal(runWithTimestampedInputs(chart, () => 16), true, 'a 60 fps');
    assert.equal(runWithTimestampedInputs(chart, (i) => (i % 5 === 2 ? 250 : 16)), true, 'con tirones de 250 ms cada 5 frames');
});

/**
 * Bucle de frame del juego con pulsaciones FECHADAS (como hace GameSession):
 * cada pulsación se aplica en el paso de física de su instante real.
 */
function runWithTimestampedInputs(chart, frameMs) {
    const { script, modes, hits } = levelOf(chart);
    const spawner = fakeSpawner(chart);
    const body = bodyState(GROUND);
    const stepper = createFixedStepper({ stepS: PHYSICS_STEP_S, maxCatchUpS: MAX_PHYSICS_CATCHUP_S });
    const inputs = createInputTimeline();
    const box = { x: 0, y: 0, w: 0, h: 0 };
    let next = 0;
    let modeIdx = 0;
    let songTime = 0;
    let frame = 0;
    while (songTime < chart.audio.durationSec) {
        songTime += frameMs(frame++) / 1000;
        // El juego LEE las teclas ahora, pero cada una lleva su instante real.
        while (next < script.length && script[next].at <= songTime) {
            inputs.push(script[next].input, script[next].at);
            next++;
        }
        let hit = false;
        stepper.advance(songTime, (t) => {
            while (modeIdx < modes.length && modes[modeIdx].t <= t) enterMode(body, modes[modeIdx++].mode);
            inputs.drainUntil(t, (a) => applyInput(body, a));
            integrateBody(body, PHYSICS_STEP_S, GROUND);
            if (spawner.collisionAt(bodyHitbox(body, box), t, GROUND) !== null || hits(box, t)) { hit = true; return true; }
            return false;
        });
        if (hit) return false;
        spawner.tick(songTime, 0.016, { width: 1920, groundY: GROUND });
    }
    return true;
}

/** Guion del jugador virtual (el mismo del simulador del charter), portales y túnel del vuelo del chart. */
function levelOf(chart) {
    const obstacles = toSimObstacles(chart.events);
    const speed = speedProfileOf(chart);
    const course = createFlightCourse(chart.events);
    return {
        script: virtualPlayerScript(obstacles, speed, () => 0, toSimHolds(chart.events)),
        modes: toSimModes(chart.events),
        // Igual que GameSession: el túnel choca con el hitbox del paso (ya calculado).
        hits: (box, t) => !course.empty && course.collisionAt(box, t, GROUND, speed.speedAt(t)),
    };
}

function fakeSpawner(chart) {
    return createSpawner({
        events: chart.events,
        speed: speedProfileOf(chart),
        layer: { addChild() {}, removeChild() {} },
        createObstacle: () => ({ activate() {}, deactivate() {}, placeAt() {}, animate() {} }),
    });
}
