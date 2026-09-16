// Vuelo (Ola 6b): mantener para subir, el túnel que dibujan las notas y su charter.
//
// Se protege:
//   - La física: mantener sube en línea recta a velocidad fija, soltar baja,
//     siempre entre el suelo y el techo; se cuentan los botones mantenidos; entrar
//     en el modo no hereda lo pulsado corriendo.
//   - El recorrido: el camino de las notas, sus muros a `margin` por cada lado, la
//     boca abierta del túnel y la colisión con la anchura del hitbox.
//   - La jugabilidad: con las notas se supera con la tolerancia de la dificultad;
//     sin pulsar o manteniendo de más, se choca; y sin volver al suelo entre notas
//     el error se acumula hasta chocar (por eso existe la regla de la vuelta).
//   - El charter: notas en la rejilla y a la medida de la música, con su vuelta al
//     suelo, estreno en el pulso, aterrizaje antes del portal, túnel con la holgura
//     de la dificultad, estadísticas y determinismo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DINO_HITBOX_PADDING, DINO_SIZE, FLY_MODE, PHYSICS_STEP_S } from '../../resources/js/game/config.js';
import {
    BODY_EVENT, applyInput, bodyHitbox, bodyState, ceilingYOf, enterMode, integrateBody,
} from '../../resources/js/game/systems/physics.js';
import {
    FLY_MARGIN_RANGE, MAX_ALT, altAt, createFlightCourse, flightMargin, flightPath, wallsFor,
} from '../../resources/js/game/systems/flightCourse.js';
import { simulateRun, toSimHolds, toSimModes, validateChart, validatePlayability } from '../../resources/js/game/systems/playability.js';
import { virtualPlayerScript } from '../../resources/js/game/systems/virtualPlayer.js';
import { createSpeedProfile, speedProfileOf } from '../../resources/js/game/systems/speedProfile.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { FLY_RULES, restEnd } from '../../resources/js/game/levels/flightCharter.js';
import { MODE_RULES } from '../../resources/js/game/levels/modePlan.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import { chartStats } from '../../resources/js/game/levels/chartStats.js';
import { CONTRAST_SONG_SECTIONS, makeSyntheticSong } from './helpers/synthetic-audio.mjs';

const GROUND = 1000;
const FLOOR_Y = GROUND - DINO_SIZE.h;

function run(body, seconds) {
    let events = 0;
    for (let i = 0; i < Math.round(seconds / PHYSICS_STEP_S); i++) events |= integrateBody(body, PHYSICS_STEP_S, GROUND);
    return events;
}

const altOf = (body) => FLOOR_Y - body.y;
/** Hitbox del Dino con la base a `alt` sobre el suelo. */
const boxAt = (alt) => bodyHitbox({ ...bodyState(GROUND), y: FLOOR_Y - alt });

/** Un tramo de vuelo de 10 a 16 s con estas notas. */
function flightEvents(holds, margin) {
    return [
        { t: 10, type: 'mode', mode: 'fly', ...(margin === undefined ? {} : { margin }) },
        ...holds.map(([t, until]) => ({ t, type: 'hold', until })),
        { t: 16, type: 'mode', mode: 'run' },
    ];
}

// --------------------------- Física ---------------------------

test('vuelo: mantener sube en línea recta a velocidad fija y soltar baja, entre el suelo y el techo del pasillo', () => {
    const body = bodyState(GROUND);
    enterMode(body, 'fly');
    assert.equal(applyInput(body, 'jump'), 'climb');
    run(body, 0.5);
    assert.ok(Math.abs(altOf(body) - 0.5 * FLY_MODE.climbPxS) <= FLY_MODE.climbPxS * PHYSICS_STEP_S + 1e-6, `altura ${altOf(body)}`);

    run(body, 2);
    assert.equal(body.y, ceilingYOf(GROUND), 'pegado al techo');
    assert.equal(altOf(body), MAX_ALT);

    assert.equal(applyInput(body, 'jumpEnd'), null);
    run(body, 0.3);
    assert.ok(Math.abs(altOf(body) - (MAX_ALT - 0.3 * FLY_MODE.divePxS)) <= FLY_MODE.divePxS * PHYSICS_STEP_S + 1e-6);
    const events = run(body, 1);
    assert.ok(events & BODY_EVENT.LANDED, 'aterriza');
    assert.equal(body.y, FLOOR_Y);
    assert.ok(body.grounded);
});

test('vuelo: se cuentan los botones mantenidos; entrar no hereda lo pulsado corriendo; muerto no sube', () => {
    const body = bodyState(GROUND);
    applyInput(body, 'jump');
    enterMode(body, 'fly');
    run(body, 0.3);
    assert.equal(body.y, FLOOR_Y, 'el salto de correr no hace subir al cruzar el portal');

    applyInput(body, 'jump');
    assert.equal(applyInput(body, 'duckStart'), null, 'el segundo botón no es otro gesto');
    applyInput(body, 'jumpEnd');
    const y0 = body.y;
    run(body, 0.1);
    assert.ok(body.y < y0, 'con un botón aún mantenido, sigue subiendo');
    applyInput(body, 'duckEnd');
    applyInput(body, 'duckEnd');
    assert.equal(body.flyHeld, 0, 'soltar de más no deja la cuenta negativa');
    const y1 = body.y;
    run(body, 0.1);
    assert.ok(body.y > y1, 'sin botones, baja');

    body.dead = true;
    assert.equal(applyInput(body, 'jump'), null);
    assert.equal(body.flyHeld, 0);
});

// --------------------------- Recorrido ---------------------------

test('camino: sube en cada nota, baja en cada silencio, se recorta al tramo y no pasa del techo', () => {
    const pts = flightPath([{ t: 5, until: 6.5 }, { t: 2, until: 2.4 }], 1, 10);
    assert.equal(altAt(pts, 1.5), 0);
    assert.ok(Math.abs(altAt(pts, 2.4) - 0.4 * FLY_MODE.climbPxS) < 1e-6);
    assert.ok(Math.abs(altAt(pts, 2.6) - 0.2 * FLY_MODE.climbPxS) < 1e-6, 'baja a la misma velocidad');
    assert.equal(altAt(pts, 3), 0);
    assert.equal(altAt(pts, 6.5), MAX_ALT, 'una nota larga se queda en el techo');
    assert.equal(altAt(pts, 10), 0);
    assert.ok(pts.every((p, i) => i === 0 || p.t > pts[i - 1].t), 'puntos ordenados y sin repetir');

    const clipped = flightPath([{ t: 0, until: 1.5 }], 1, 3);
    assert.ok(Math.abs(altAt(clipped, 1.5) - 0.5 * FLY_MODE.climbPxS) < 1e-6, 'la nota empieza a contar en el portal');

    const w = wallsFor(100, 40);
    const hitboxH = DINO_SIZE.h - DINO_HITBOX_PADDING.top - DINO_HITBOX_PADDING.bottom;
    assert.equal(w.floorWall, 100 + DINO_HITBOX_PADDING.bottom - 40);
    assert.equal(w.ceilingWall - w.floorWall, hitboxH + 80, 'el hueco es el hitbox más la holgura a cada lado');
});

test('túnel: quien sigue el camino no toca nada; desviarse más que la holgura choca; boca abierta tras el portal; fuera del vuelo no hay muros', () => {
    const course = createFlightCourse(flightEvents([[11, 11.5], [13, 13.8]], 40));
    assert.equal(course.spans.length, 1);
    assert.equal(course.lastEnd, 16);
    for (const speed of [300, 600, 820]) {
        for (let t = 10; t <= 16; t += 0.005) {
            assert.equal(course.collisionAt(boxAt(course.altAt(t)), t, GROUND, speed), false, `${speed} px/s, t=${t.toFixed(3)}`);
        }
    }
    assert.ok(course.collisionAt(boxAt(course.altAt(11.5) + 50), 11.5, GROUND, 450), 'por encima del camino');
    assert.ok(course.collisionAt(boxAt(Math.max(0, course.altAt(11.4) - 50)), 11.4, GROUND, 450), 'por debajo del camino');

    const mouth = 10 + FLY_MODE.entryOpenS;
    assert.equal(course.collisionAt(boxAt(120), mouth - 0.1, GROUND, 450), false, 'el Dino puede cruzar el portal al final de un salto');
    assert.ok(course.collisionAt(boxAt(120), mouth + 0.1, GROUND, 450), 'tras la boca, los muros rigen');
    assert.equal(course.collisionAt(boxAt(200), 20, GROUND, 450), false);
    assert.equal(course.altAt(20), null);

    assert.equal(createFlightCourse(flightEvents([])).spans[0].margin, FLY_MARGIN_RANGE.max, 'sin holgura declarada, la máxima');
    assert.equal(createFlightCourse([{ t: 1, type: 'hold', until: 2 }]).empty, true, 'una nota sin vuelo no crea túnel');
});

test('holgura: crece con la tolerancia y a menos velocidad, y cabe en el rango del formato', () => {
    assert.ok(flightMargin(0.08, 450) > flightMargin(0.04, 450));
    assert.ok(flightMargin(0.055, 300) > flightMargin(0.055, 800));
    for (const d of [1, 2, 3, 4, 5]) {
        for (const speed of [250, 820]) {
            const m = flightMargin(DIFFICULTY_PROFILES[d].toleranceS, speed);
            assert.ok(m >= FLY_MARGIN_RANGE.min && m <= FLY_MARGIN_RANGE.max, `d${d} a ${speed}: ${m}`);
        }
    }
});

// --------------------------- Jugabilidad ---------------------------

test('jugador virtual: empieza cada nota en su instante y la suelta en su final', () => {
    const obstacles = [];
    const script = virtualPlayerScript(obstacles, createSpeedProfile(450), () => 0, [{ t: 11, until: 11.5 }, { t: 13, until: 13.8 }]);
    assert.deepEqual(script.map((s) => [s.at, s.input, s.index]), [[11, 'jump', 0], [11.5, 'jumpEnd', 1], [13, 'jump', 2], [13.8, 'jumpEnd', 3]]);
    // Soltar nunca antes de empezar, aunque los desplazamientos de tolerancia se crucen.
    const crossed = virtualPlayerScript(obstacles, createSpeedProfile(450), (i) => (i % 2 === 0 ? 0.3 : -0.3), [{ t: 11, until: 11.2 }]);
    assert.ok(crossed[1].at > crossed[0].at);
});

test('simulador: con las notas se supera el túnel con la tolerancia; sin pulsar o manteniendo de más se choca', () => {
    const tol = 0.08;
    const speed = 450;
    const holds = [];
    let t = 11;
    for (const len of [0.5, 0.8, 0.3]) {
        holds.push([t, t + len]);
        t = Math.ceil(restEnd({ t, until: t + len }, tol) * 100) / 100;
    }
    const events = flightEvents(holds, flightMargin(tol, speed));
    const chart = { world: { speedPxS: speed }, events };
    assert.ok(t < 16 - FLY_RULES.landBeforeExitS);
    assert.ok(validateChart(chart, { toleranceS: tol }).ok, 'perfecto, tarde-pronto y pronto-tarde');

    const course = createFlightCourse(events);
    const opts = { modes: toSimModes(events), course, holds: toSimHolds(events) };
    const none = simulateRun([], speed, { ...opts, holds: [] });
    assert.equal(none.ok, false, 'sin pulsar se choca con el muro del suelo');
    const long = simulateRun([], speed, { ...opts, pressOffset: (i) => (i % 2 === 1 ? 0.3 : 0) });
    assert.equal(long.ok, false, 'soltando 300 ms tarde se choca con el techo');
    assert.equal(long.index, 0, 'el choque señala la nota (índice n + 2k)');
});

test('sin volver al suelo entre notas, el error de tiempo se acumula hasta chocar: la regla de la vuelta es necesaria', () => {
    const tol = 0.055;
    const speed = 450;
    const margin = flightMargin(tol, speed);
    // Notas de medio segundo con descansos de 0.25 s: el camino no llega al suelo.
    const close = [];
    for (let k = 0; k < 6; k++) close.push([11 + k * 0.75, 11.5 + k * 0.75]);
    const verdict = validateChart({ world: { speedPxS: speed }, events: flightEvents(close, margin) }, { toleranceS: tol });
    assert.equal(verdict.ok, false, 'con notas pegadas, quien juega con la tolerancia choca');
    assert.ok(verdict.index >= 2, `choca tras la primera nota (índice ${verdict.index})`);

    // Las mismas notas con la vuelta al suelo se superan.
    const spaced = [];
    let t = 11;
    for (let k = 0; k < 3; k++) {
        spaced.push([t, t + 0.5]);
        t = restEnd({ t, until: t + 0.5 }, tol);
    }
    assert.ok(validateChart({ world: { speedPxS: speed }, events: flightEvents(spaced, margin) }, { toleranceS: tol }).ok);
});

// --------------------------- Charter ---------------------------

test('charter del vuelo: notas en la rejilla y a la medida del beat, con su vuelta al suelo, estreno en el pulso y aterrizaje antes del portal', () => {
    for (const bpm of [90, 120, 150]) {
        const analysis = makeSyntheticSong({ bpm, sections: CONTRAST_SONG_SECTIONS });
        const beat = 60 / bpm;
        const grid = [...analysis.beats, ...analysis.beats.map((b) => b + beat / 2)];
        const onGrid = (x) => grid.some((g) => Math.abs(g - x) < 0.002);
        // A 150 BPM la canción dura 2:20: en Normal solo cabe un momento, y es la antigravedad.
        for (const d of bpm === 150 ? [4, 5] : [3, 4, 5]) {
            const { chart, report } = buildChart(analysis, { seed: 5, difficulty: d });
            const label = `${bpm} BPM d${d}`;
            const tol = DIFFICULTY_PROFILES[report.difficulty].toleranceS;
            const fly = report.modes.find((m) => m.mode === 'fly');
            assert.ok(fly !== undefined, `${label}: hay vuelo`);
            const holds = chart.events.filter((e) => e.type === 'hold');
            assert.ok(holds.length >= 4, `${label}: ${holds.length} notas`);

            const portal = chart.events.find((e) => e.type === 'mode' && e.mode === 'fly');
            const topSpeed = report.topSpeedPxS;
            assert.ok(portal.margin >= flightMargin(tol, topSpeed) && portal.margin <= FLY_MARGIN_RANGE.max, `${label}: holgura ${portal.margin}`);

            holds.forEach((h, i) => {
                assert.ok(h.t >= fly.t0 && h.until <= fly.t1, `${label}: nota ${h.t} dentro del vuelo`);
                assert.ok(onGrid(h.t) && onGrid(h.until), `${label}: nota ${h.t}→${h.until} en la rejilla`);
                const len = h.until - h.t;
                assert.ok(len >= FLY_RULES.minHoldBeats * beat - 0.03 && len <= Math.min(FLY_RULES.maxHoldBeats * beat, FLY_RULES.maxHoldS) + 0.002, `${label}: nota de ${len.toFixed(3)} s`);
                if (i > 0) assert.ok(h.t >= restEnd(holds[i - 1], tol) - 0.002, `${label}: la nota ${h.t} no deja volver al suelo`);
            });
            assert.ok(holds[0].t - fly.t0 >= Math.max(FLY_MODE.entryOpenS, MODE_RULES.introBeats * beat - 0.02) - 0.002, `${label}: estreno tras asentarse`);
            assert.ok(analysis.beats.some((b) => Math.abs(b - holds[0].t) < 0.002) && analysis.beats.some((b) => Math.abs(b - holds[1].t) < 0.002), `${label}: estreno en el pulso`);
            assert.ok(holds[1].t - holds[0].t >= MODE_RULES.introGapS - 0.002, `${label}: estreno espaciado`);
            assert.ok(restEnd(holds.at(-1), tol) + FLY_RULES.landBeforeExitS <= fly.t1 + 0.002, `${label}: aterriza antes del portal de salida`);

            assert.equal(chartStats(chart).actions, chart.events.filter((e) => e.type === 'obstacle').length + holds.length);
            assert.equal(JSON.stringify(buildChart(analysis, { seed: 5, difficulty: d }).chart), JSON.stringify(chart), `${label}: determinista`);
        }
    }
});

test('charter del vuelo: el túnel usa la velocidad más lenta del tramo (la de menos margen de error)', () => {
    const analysis = makeSyntheticSong({ bpm: 120, sections: CONTRAST_SONG_SECTIONS });
    const { chart, report } = buildChart(analysis, { seed: 1, difficulty: 5 });
    const fly = report.modes.find((m) => m.mode === 'fly');
    const speed = speedProfileOf(chart);
    let min = Infinity;
    for (let t = fly.t0; t <= fly.t1; t += 0.05) min = Math.min(min, speed.speedAt(t));
    const portal = chart.events.find((e) => e.type === 'mode' && e.mode === 'fly');
    assert.equal(portal.margin, flightMargin(DIFFICULTY_PROFILES[5].toleranceS, min));
    assert.ok(validatePlayability([], speed, { toleranceS: 0.04, course: createFlightCourse(chart.events), holds: toSimHolds(chart.events), modes: toSimModes(chart.events) }).ok);
});
