// Modos de movimiento (Olas 6a-6b): antigravedad, portales y el reparto de modos.
//
// Se protege:
//   - La física de la antigravedad: cualquier pulsación invierte la gravedad y
//     el Dino llega rápido a la otra superficie; en el aire la pulsación se
//     guarda; soltar no hace nada; cabeza abajo el hitbox se refleja; al volver a
//     correr cae al suelo en seco.
//   - La sincronía: pulsar SOBRE el golpe es la jugada buena ante un cristal, con
//     margen de sobra para la tolerancia de cualquier dificultad, también en los
//     patrones apretados; aporrear no sirve.
//   - Los portales: rigen en su instante (partida, simulador y formato leen la
//     misma línea de modos) y el validador detecta una acción pegada a un portal.
//   - El formato 4: portales, notas mantenidas y lo que se descarta o se rechaza.
//   - El reparto (Ola 6b): cada modo en el momento que suena como él, qué modos
//     tiene cada dificultad, una canción sin contraste sin momentos, cada modo una
//     vez, el presupuesto por duración, dónde van (tramo del arco, anacrusa,
//     separados), el estreno espaciado, los cristales alternando, la memoria de
//     frases dentro del modo y los 8 oficiales jugables y distintos entre sí.
//   - Tras el playtest de la 6b: un modo dura su tramo entero (entra y sale donde
//     la música cambia) y en What's Up Danger, Time y Dawn of Faith cae donde se
//     oyó el cambio.
//   El vuelo (física, túnel, notas) tiene su archivo: flight.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DINO_SIZE, FLIP_MODE, OBSTACLE_KIND, PHYSICS_STEP_S } from '../../resources/js/game/config.js';
import {
    BODY_EVENT, actionLeadS, applyInput, bodyHitbox, bodyState, ceilingYOf, enterMode, integrateBody,
} from '../../resources/js/game/systems/physics.js';
import { MOVEMENT_MODES } from '../../resources/js/game/systems/modes/index.js';
import { clearTimeS } from '../../resources/js/game/systems/modes/flip.js';
import { createModeTimeline, modeChanges } from '../../resources/js/game/systems/modeTimeline.js';
import { simulateRun, timingWindowS, toSimObstacles, validateChart, validatePlayability } from '../../resources/js/game/systems/playability.js';
import { virtualPlayerScript } from '../../resources/js/game/systems/virtualPlayer.js';
import { createSpeedProfile } from '../../resources/js/game/systems/speedProfile.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { CHART_FORMAT_VERSION, ChartError, normalizeChart } from '../../resources/js/game/levels/chartFormat.js';
import { MODE_RULES, momentBudget } from '../../resources/js/game/levels/modePlan.js';
import { FLY_MARGIN_RANGE } from '../../resources/js/game/systems/flightCourse.js';
import { PAIR_GAP } from '../../resources/js/game/levels/patterns.js';
import { pickupTime } from '../../resources/js/game/levels/speedPlan.js';
import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import { chartStats } from '../../resources/js/game/levels/chartStats.js';
import { CONTRAST_SONG_SECTIONS, makeSyntheticSong } from './helpers/synthetic-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUND = 1000;
const CEILING = ceilingYOf(GROUND);
const FLIP = [{ t: 2, mode: 'flip' }];
const obstacles = (chart) => chart.events.filter((e) => e.type === 'obstacle');
const crystals = (chart) => obstacles(chart).filter((e) => OBSTACLE_KIND[e.kind].mode === 'flip');

/** Avanza el cuerpo `seconds` a paso fijo y devuelve los eventos que ocurrieron. */
function run(body, seconds) {
    let events = 0;
    for (let i = 0; i < Math.round(seconds / PHYSICS_STEP_S); i++) events |= integrateBody(body, PHYSICS_STEP_S, GROUND);
    return events;
}

function flipBody() {
    const body = bodyState(GROUND);
    enterMode(body, 'flip');
    return body;
}

/** Tramos alternos suelo/techo cada `gap` segundos desde t0. */
function zigzag(t0, gap, n) {
    return Array.from({ length: n }, (_, i) => ({ t: t0 + i * gap, type: 'obstacle', kind: i % 2 === 0 ? 'CRYSTAL_FLOOR' : 'CRYSTAL_CEIL' }));
}

// --------------------------- Física ---------------------------

test('antigravedad: cualquier pulsación invierte la gravedad y el Dino llega al techo en ~0.2 s, y vuelve', () => {
    const body = flipBody();
    assert.equal(applyInput(body, 'jump'), 'flip');
    assert.equal(body.gravityDir, -1);
    let t = 0;
    while (!body.grounded && t < 1) {
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        t += PHYSICS_STEP_S;
    }
    assert.ok(t > 0.15 && t < 0.26, `viaje suelo→techo: ${t.toFixed(3)} s`);
    assert.equal(body.y, CEILING, 'apoyado en el techo');

    assert.equal(applyInput(body, 'duckStart'), 'flip', 'agacharse también invierte');
    run(body, 0.4);
    assert.ok(body.grounded && body.gravityDir === 1 && body.y === GROUND - DINO_SIZE.h, 'de vuelta en el suelo');

    assert.equal(applyInput(body, 'jumpEnd'), null, 'soltar no hace nada');
    assert.equal(applyInput(body, 'duckEnd'), null);
    assert.equal(body.gravityDir, 1);
});

test('antigravedad: en el aire la pulsación se guarda y dispara al tocar la superficie', () => {
    const body = flipBody();
    applyInput(body, 'jump');
    run(body, 0.1);
    assert.equal(applyInput(body, 'jump'), null, 'en el aire no invierte…');
    assert.equal(body.gravityDir, -1);
    const events = run(body, 0.2);
    assert.ok(events & BODY_EVENT.LANDED && events & BODY_EVENT.BUFFERED, '…pero al llegar dispara la guardada');
    assert.equal(body.gravityDir, 1, 'y vuelve a caer hacia el suelo');
});

test('cabeza abajo el hitbox refleja su relleno; al volver a correr cae al suelo en seco', () => {
    const body = flipBody();
    applyInput(body, 'jump');
    run(body, 0.4);
    const inverted = bodyHitbox(body);
    const upright = bodyHitbox({ ...bodyState(GROUND), y: CEILING });
    assert.equal(inverted.h, upright.h);
    assert.ok(inverted.y > upright.y, 'los pies (menos relleno) quedan contra el techo');

    enterMode(body, 'run');
    assert.equal(body.gravityDir, 1);
    let t = 0;
    while (!body.grounded && t < 1) {
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        t += PHYSICS_STEP_S;
    }
    assert.ok(t < 0.3, `caída del techo al suelo al salir: ${t.toFixed(3)} s`);

    const ducking = bodyState(GROUND);
    applyInput(ducking, 'duckStart');
    enterMode(ducking, 'flip');
    assert.equal(ducking.ducking, false, 'entrar en antigravedad no conserva el agachado');
});

test('el adelanto de un cristal sale de la física: lo que tarda en despejarlo más el margen', () => {
    const lead = actionLeadS(OBSTACLE_KIND.CRYSTAL_FLOOR);
    assert.equal(lead, clearTimeS(OBSTACLE_KIND.CRYSTAL_FLOOR) + FLIP_MODE.leadMarginS);
    assert.equal(actionLeadS(OBSTACLE_KIND.CRYSTAL_CEIL), lead, 'suelo y techo son simétricos');
    assert.ok(lead > 0.25 && lead < 0.4);
    for (const mode of Object.values(MOVEMENT_MODES)) {
        for (const key of ['id', 'label', 'color', 'actions', 'settleS', 'enter', 'integrate', 'input', 'hitbox', 'leadS']) {
            assert.ok(mode[key] !== undefined, `${mode.id ?? '?'} cumple el contrato: ${key}`);
        }
    }
});

// --------------------------- Sincronía y jugabilidad ---------------------------

test('pulsar SOBRE el golpe supera cada cristal a cada velocidad, con la tolerancia de Relajado', () => {
    for (const kind of ['CRYSTAL_FLOOR', 'CRYSTAL_CEIL']) {
        for (const speed of [300, 450, 650, 820]) {
            const window = timingWindowS(kind, speed);
            assert.ok(window >= 0.3, `${kind} a ${speed} px/s: margen ${window}`);
        }
    }
    // El lado exigente es pulsar tarde: sin él no despeja a tiempo.
    for (const speed of [300, 450, 650, 820]) {
        const sim = toSimObstacles([{ t: 5, type: 'obstacle', kind: 'CRYSTAL_FLOOR' }]);
        assert.ok(simulateRun(sim, speed, { modes: FLIP, pressOffset: () => 0.08 }).ok, `${speed}: 80 ms tarde`);
        assert.equal(simulateRun(sim, speed, { modes: FLIP, pressOffset: () => 1 }).ok, false, `${speed}: sin pulsar choca`);
    }
});

test('zigzag suelo-techo: a un beat se supera con ±80 ms; en el hueco mínimo del charter, con su tolerancia; aporrear no sirve', () => {
    for (const speed of [300, 450, 650, 820]) {
        assert.ok(validatePlayability(toSimObstacles(zigzag(5, 0.5, 12)), speed, { modes: FLIP, toleranceS: 0.08 }).ok, `${speed}: a 0.5 s`);
        for (const tol of [0.04, 0.055, 0.08]) {
            const gap = PAIR_GAP.flipFlip(speed, tol);
            const v = validatePlayability(toSimObstacles(zigzag(5, gap, 10)), speed, { modes: FLIP, toleranceS: tol });
            assert.ok(v.ok, `${speed} px/s, ±${tol * 1000} ms, a ${gap.toFixed(3)} s: ${v.pattern}`);
        }
    }
    // Aporrear: una pulsación cada 0.2 s sin mirar el nivel. Las pulsaciones las
    // generan "obstáculos" sin cuerpo; a los cristales de verdad no se responde.
    const level = toSimObstacles(zigzag(5, 0.6, 16));
    let survived = 0;
    for (const phase of [0, 0.05, 0.1, 0.15]) {
        const ghosts = [];
        for (let t = 3 + phase; t < 16; t += 0.2) ghosts.push({ t, cross: t, kind: 'MASH', ghost: true, def: { action: 'flip', w: -100, h: -100, altitude: 0 } });
        const merged = [...level, ...ghosts].sort((a, b) => a.t - b.t);
        if (simulateRun(merged, 450, { modes: FLIP, pressOffset: (i) => (merged[i].ghost ? 0 : 1000) }).ok) survived++;
    }
    assert.equal(survived, 0, 'aporreando se choca con algún cristal');
});

test('un portal rige en su instante: la acción de correr pegada al portal falla; separada, pasa', () => {
    const tight = toSimObstacles([
        { t: 5, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 6.2, type: 'obstacle', kind: 'CRYSTAL_FLOOR' },
    ]);
    // El portal llega cuando el Dino aún está saltando el cactus: con las reglas
    // de la antigravedad cae antes y el cactus aún está debajo.
    assert.equal(validatePlayability(tight, 450, { modes: [{ t: 5.12, mode: 'flip' }] }).ok, false);
    assert.ok(validatePlayability(tight, 450, { modes: [{ t: 5.7, mode: 'flip' }] }).ok);

    // Salir cabeza abajo: el Dino cae y la siguiente acción de correr llega bien.
    const exit = toSimObstacles([
        { t: 5, type: 'obstacle', kind: 'CRYSTAL_FLOOR' },
        { t: 6.5, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 7.3, type: 'obstacle', kind: 'PTERO' },
    ]);
    assert.ok(validatePlayability(exit, 450, { modes: [{ t: 2, mode: 'flip' }, { t: 5.9, mode: 'run' }], toleranceS: 0.08 }).ok);
});

test('línea de modos: todo nivel empieza corriendo; cambios repetidos o desconocidos no cuentan', () => {
    const events = [
        { t: 20, type: 'mode', mode: 'flip' },
        { t: 10, type: 'mode', mode: 'run' },     // ya se corre: no cambia nada
        { t: 25, type: 'mode', mode: 'flip' },    // repetido
        { t: 30, type: 'mode', mode: 'nave' },    // desconocido
        { t: 40, type: 'mode', mode: 'run' },
        { t: 41, type: 'obstacle', kind: 'CACTUS_SMALL' },
    ];
    assert.deepEqual(modeChanges(events), [{ t: 20, mode: 'flip', from: 'run' }, { t: 40, mode: 'run', from: 'flip' }]);
    const tl = createModeTimeline(events);
    assert.deepEqual([0, 19.99, 20, 39.9, 40, 90].map((t) => tl.modeAt(t)), ['run', 'run', 'flip', 'flip', 'run', 'run']);
    assert.deepEqual(tl.segmentsOf('flip'), [{ mode: 'flip', t0: 20, t1: 40 }]);
    assert.equal(tl.nextChange(20).t, 40);
    assert.equal(createModeTimeline([]).constant, true);
});

test('jugador virtual: salta y se agacha como siempre, e invierte ante cada cristal', () => {
    const sim = toSimObstacles([
        { t: 1, type: 'obstacle', kind: 'PTERO' },
        { t: 1.3, type: 'obstacle', kind: 'PTERO' },
        { t: 3, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 6, type: 'obstacle', kind: 'CRYSTAL_FLOOR' },
        { t: 6.5, type: 'obstacle', kind: 'CRYSTAL_CEIL' },
    ]);
    const script = virtualPlayerScript(sim, createSpeedProfile(450));
    assert.deepEqual(script.map((s) => s.input), ['duckStart', 'duckStart', 'duckEnd', 'jump', 'jump', 'jump'],
        'entre dos pteros seguidos no suelta');
    assert.deepEqual(script.filter((s) => s.input === 'jump').map((s) => s.at), [3, 6, 6.5]);
});

test('formato 4: portales y notas se conservan; cristal fuera de su modo, nota fuera del vuelo o solapada se descartan con aviso; un modo desconocido no se juega', () => {
    const base = {
        formatVersion: CHART_FORMAT_VERSION, charter: { name: 'x', version: 6 }, seed: 1,
        audio: { durationSec: 60, sampleRate: 44100 }, music: { bpm: 120 }, world: { speedPxS: 450 },
    };
    const { chart, warnings } = normalizeChart({
        ...base,
        events: [
            { t: 10, type: 'mode', mode: 'flip' },
            { t: 11, type: 'obstacle', kind: 'CRYSTAL_FLOOR' },
            { t: 20, type: 'mode', mode: 'run' },
            { t: 21, type: 'obstacle', kind: 'CRYSTAL_CEIL' },      // fuera de su modo
            { t: 22, type: 'obstacle', kind: 'CACTUS_SMALL' },
            { t: 23, type: 'hold', until: 23.5 },                    // fuera del vuelo
            { t: 30, type: 'mode', mode: 'fly', margin: 500 },       // holgura fuera de rango
            { t: 31, type: 'hold', until: 31.6 },
            { t: 31.4, type: 'hold', until: 32 },                    // solapada con la anterior
            { t: 33, type: 'hold', until: 33 },                      // mal formada
            { t: 39.8, type: 'hold', until: 40.5 },                  // sigue tras el portal de salida
            { t: 40, type: 'mode', mode: 'run' },
        ],
    });
    assert.equal(CHART_FORMAT_VERSION, 4);
    assert.deepEqual(chart.events.map((e) => e.kind ?? e.mode ?? `hold→${e.until}`),
        ['flip', 'CRYSTAL_FLOOR', 'run', 'CACTUS_SMALL', 'fly', 'hold→31.6', 'run']);
    assert.equal(chart.events[4].margin, FLY_MARGIN_RANGE.max, 'la holgura se ajusta a su rango');
    assert.equal(warnings.length, 4, JSON.stringify(warnings));

    // Un modo desconocido cambiaría las reglas de un tramo entero: no se juega otro nivel.
    assert.throws(() => normalizeChart({ ...base, events: [{ t: 10, type: 'mode', mode: 'nave' }] }), (e) => e instanceof ChartError && /nave/.test(e.message));
    assert.throws(() => normalizeChart({ ...base, formatVersion: 5, events: [] }), /formato 5/);
});

test('estadísticas: los cristales y las notas del vuelo cuentan como acciones con su margen, no como voladores', () => {
    const chart = {
        world: { speedPxS: 450 },
        events: [
            { t: 3, type: 'mode', mode: 'flip' }, ...zigzag(5, 0.6, 20),
            { t: 20, type: 'mode', mode: 'fly', margin: 60 },
            { t: 21, type: 'hold', until: 21.5 }, { t: 23, type: 'hold', until: 23.4 },
            { t: 30, type: 'mode', mode: 'run' },
        ],
    };
    const stats = chartStats(chart);
    assert.equal(stats.actions, 22);
    assert.equal(stats.airShare, 0);
    assert.ok(stats.meanWindowS > 0.3);
});

// --------------------------- Charter: el reparto de modos ---------------------------

/** Canción con un break de batería y un puente sostenido (helpers/synthetic-audio.mjs). */
const contrastSong = (bpm) => makeSyntheticSong({ bpm, sections: CONTRAST_SONG_SECTIONS });
/** Canción en la que solo el clímax (percusivo y rotundo) suena distinto. */
const climaxSong = () => makeSyntheticSong({
    bpm: 120,
    sections: [
        { bars: 8, energy: 0.3, hits: 0.35, role: 'intro', cluster: 'A' },
        { bars: 16, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'C' },
        { bars: 16, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'C' },
        { bars: 8, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
        { bars: 8, energy: 0.95, hits: 1, role: 'chorus', cluster: 'F', perc: 0.9 },
        { bars: 6, energy: 0.3, hits: 0.3, role: 'outro', cluster: 'A' },
    ],
});
const startOf = (analysis, role) => analysis.sections.find((s) => s.role === role).startSec;

test('reparto: cada modo va al momento que suena como él — antigravedad en el break de batería, vuelo en el puente sostenido', () => {
    for (const bpm of [90, 120, 150]) {
        const analysis = contrastSong(bpm);
        const { report } = buildChart(analysis, { seed: 1, difficulty: 5 });
        const beat = 60 / bpm;
        assert.deepEqual(report.modes.map((m) => m.mode), ['flip', 'fly'], `${bpm} BPM`);
        // El portal va en la anacrusa: como mucho un beat antes del primer tiempo del tramo.
        const opens = (m, role) => m.t0 < startOf(analysis, role) && startOf(analysis, role) - m.t0 <= beat + 1e-6;
        assert.ok(opens(report.modes[0], 'break'), `${bpm} BPM: la antigravedad abre el break`);
        assert.ok(opens(report.modes[1], 'bridge'), `${bpm} BPM: el vuelo abre el puente`);
        for (const m of report.modes) assert.ok(m.score >= MODE_RULES.minScore, `${bpm} BPM: encaje ${m.score}`);
    }
});

test('dificultad: Relajado corre entero; Fácil solo antigravedad; Normal y más, los dos; el clímax, solo desde Difícil', () => {
    const analysis = contrastSong(120);
    const modesOf = (a, d) => buildChart(a, { seed: 1, difficulty: d }).report.modes.map((m) => m.mode);
    assert.deepEqual(modesOf(analysis, 1), []);
    assert.deepEqual(modesOf(analysis, 2), ['flip'], 'el vuelo pide mantener: no en Fácil');
    assert.deepEqual(modesOf(analysis, 3), ['flip', 'fly']);
    assert.deepEqual(modesOf(analysis, 5), ['flip', 'fly']);

    // Si lo único distinto es el clímax, Normal lo corre y Difícil lo cambia.
    const climax = climaxSong();
    assert.deepEqual(modesOf(climax, 3), [], 'Normal corre el clímax');
    const hard = buildChart(climax, { seed: 1, difficulty: 4 }).report;
    assert.equal(hard.modes.length, 1);
    assert.ok(hard.modes[0].t0 < hard.climax.t0 && hard.modes[0].t1 > hard.climax.t0, 'Difícil cambia de modo en el clímax');

    assert.deepEqual(Object.keys(DIFFICULTY_PROFILES[1].modes), []);
    assert.deepEqual(Object.keys(DIFFICULTY_PROFILES[2].modes), ['flip']);
    for (const d of [3, 4, 5]) assert.deepEqual(Object.keys(DIFFICULTY_PROFILES[d].modes).sort(), ['flip', 'fly']);
});

test('una canción que suena igual de principio a fin no tiene momentos; cada modo, como mucho una vez; el presupuesto crece con la duración', () => {
    const uniform = makeSyntheticSong({ bpm: 120, sections: [{ bars: 80, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' }] });
    for (const d of [1, 2, 3, 4, 5]) assert.deepEqual(buildChart(uniform, { seed: 1, difficulty: d }).report.modes, [], `d${d}`);

    assert.equal(momentBudget(DIFFICULTY_PROFILES[1], 400), 0);
    assert.deepEqual([50, 80, 160].map((s) => momentBudget(DIFFICULTY_PROFILES[3], s)), [0, 1, 2]);
    assert.deepEqual([50, 80, 160].map((s) => momentBudget(DIFFICULTY_PROFILES[2], s)), [0, 1, 1]);
    // 2:20 a 150 BPM: en Normal cabe un momento (el de mejor encaje); en Difícil, dos.
    const short = contrastSong(150);
    assert.deepEqual(buildChart(short, { seed: 1, difficulty: 3 }).report.modes.map((m) => m.mode), ['flip']);
    assert.equal(buildChart(short, { seed: 1, difficulty: 4 }).report.modes.length, 2);

    for (const analysis of [contrastSong(100), climaxSong(), makeSyntheticSong({ bpm: 128 })]) {
        for (const d of [2, 3, 4, 5]) {
            const ids = buildChart(analysis, { seed: 3, difficulty: d }).report.modes.map((m) => m.mode);
            assert.equal(new Set(ids).size, ids.length, `d${d}: ${ids.join(' ')}`);
        }
    }
});

test('dónde: un tramo del arco entero de 10-40 s que empieza en un cambio, portales en la anacrusa, nunca al arranque y separados', () => {
    for (const analysis of [contrastSong(90), contrastSong(128), climaxSong(), makeSyntheticSong({ bpm: 150 })]) {
        const model = buildMusicModel(analysis);
        const arc = buildSongArc(model);
        for (const d of [2, 3, 4, 5]) {
            const { chart, report } = buildChart(analysis, { seed: 2, difficulty: d });
            const label = `${analysis.bpm} BPM d${d}`;
            const portals = chart.events.filter((e) => e.type === 'mode');
            assert.equal(portals.length, report.modes.length * 2, label);
            for (const m of report.modes) {
                const bar0 = model.bars.findIndex((b) => b.t0 > m.t0 + 1e-6);
                const bar1 = model.bars.findIndex((b) => b.t0 > m.t1 + 1e-6);
                const dur = model.bars[bar1].t0 - model.bars[bar0].t0;
                assert.ok(dur >= MODE_RULES.minS - 1e-6 && dur <= MODE_RULES.maxS + 1e-6, `${label}: tramo de ${dur.toFixed(1)} s`);
                const seg = arc.segments.find((s) => s.bar0 === bar0);
                assert.ok(seg !== undefined && seg.level >= 1, `${label}: empieza con un tramo del arco`);
                assert.equal(bar1, seg.bar1, `${label}: el tramo entero`);
                assert.ok(arc.changes.at(bar0) !== null, `${label}: entra donde la canción cambia`);
                const next = arc.segments[seg.index + 1];
                assert.ok(arc.changes.at(bar1) !== null || seg.climax || next?.climax, `${label}: sale donde la canción cambia o en el borde del clímax`);
                assert.equal(m.at, Math.round(model.bars[bar0].t0 * 1000) / 1000, `${label}: primer tiempo del tramo`);
                assert.equal(m.t0, Math.round(pickupTime(model, bar0) * 1000) / 1000, `${label}: entrada en la anacrusa`);
                assert.equal(m.t1, Math.round(pickupTime(model, bar1) * 1000) / 1000, `${label}: salida en la anacrusa`);
                assert.ok(model.bars[bar0].t0 >= Math.max(MODE_RULES.minStartS, analysis.durationSec * MODE_RULES.minStartFraction) - 1e-6, `${label}: no en el arranque`);
            }
            for (let i = 1; i < report.modes.length; i++) {
                assert.ok(report.modes[i].t0 - report.modes[i - 1].t1 >= MODE_RULES.minGapS - 1e-6, `${label}: se corre entre dos momentos`);
            }
            assert.deepEqual(normalizeChart(chart).warnings, [], label);
        }
    }
});

test('un modo dura su pasaje entero, también si pasa de 24 s; un pasaje de más de 40 s no es un momento', () => {
    // Antes el momento se cortaba en frases de 4 compases hasta 24 s: el vuelo de
    // Dawn of Faith acababa a las 1:42 con la canción sonando igual.
    const withBridge = (bpm, bars) => makeSyntheticSong({ bpm, sections: CONTRAST_SONG_SECTIONS.map((sec) => (sec.role === 'bridge' ? { ...sec, bars } : sec)) });
    for (const [bpm, bars] of [[90, 12], [120, 16], [120, 20]]) {
        const analysis = withBridge(bpm, bars);
        const model = buildMusicModel(analysis);
        const bridge = analysis.sections.find((sec) => sec.role === 'bridge');
        const fly = buildChart(analysis, { seed: 1, difficulty: 5 }).report.modes.find((m) => m.mode === 'fly');
        const bar0 = model.bars.findIndex((b) => Math.abs(b.t0 - bridge.startSec) < 1e-3);
        const bar1 = model.bars.findIndex((b) => Math.abs(b.t0 - bridge.endSec) < 1e-3);
        const label = `${bpm} BPM, puente de ${(bridge.endSec - bridge.startSec).toFixed(1)} s`;
        assert.ok(fly !== undefined, label);
        assert.equal(fly.t0, Math.round(pickupTime(model, bar0) * 1000) / 1000, `${label}: entra con el puente`);
        assert.equal(fly.t1, Math.round(pickupTime(model, bar1) * 1000) / 1000, `${label}: sale cuando el puente termina`);
    }
    const long = withBridge(90, 16);
    const bridge = long.sections.find((sec) => sec.role === 'bridge');
    for (const m of buildChart(long, { seed: 1, difficulty: 5 }).report.modes) {
        assert.ok(m.t1 <= bridge.startSec || m.t0 >= bridge.endSec - 1, `un puente de 42.7 s no es un momento: ${JSON.stringify(m)}`);
    }
});

test('alrededor de un portal no hay acciones; el estreno espera y va espaciado; los cristales alternan desde el suelo; en el vuelo no hay obstáculos', () => {
    for (const bpm of [90, 128]) {
        const analysis = contrastSong(bpm);
        for (const d of [2, 3, 5]) {
            const { chart, report } = buildChart(analysis, { seed: 4, difficulty: d });
            const label = `${bpm} BPM d${d}`;
            const beat = 60 / bpm;
            const runLead = actionLeadS(OBSTACLE_KIND.CACTUS_SMALL);
            const flipLead = actionLeadS(OBSTACLE_KIND.CRYSTAL_FLOOR);
            for (const m of report.modes) {
                const inside = obstacles(chart).filter((e) => e.t >= m.t0 && e.t < m.t1);
                const before = obstacles(chart).filter((e) => e.t < m.t0).at(-1);
                if (before) assert.ok(m.t0 - before.t >= runLead + MODE_RULES.exitClearS - 1e-3, `${label}: acción de correr en ${before.t} pegada al portal ${m.t0}`);
                const after = obstacles(chart).find((e) => e.t >= m.t1);
                if (after) assert.ok(after.t - m.t1 >= MOVEMENT_MODES.run.settleS - 1e-3, `${label}: primera acción al volver a correr`);
                if (m.mode === 'fly') {
                    assert.deepEqual(inside, [], `${label}: el vuelo no tiene obstáculos sueltos`);
                    continue;
                }
                assert.ok(inside.length >= 4, `${label}: ${inside.length} acciones`);
                assert.ok(inside.every((e) => OBSTACLE_KIND[e.kind].mode === 'flip'), `${label}: dentro, solo cristales`);
                // Un cristal afilado (acento) está en la superficie que le toca, como uno normal.
                inside.forEach((e, k) => assert.equal(OBSTACLE_KIND[e.kind].surface, k % 2 === 0 ? 'floor' : 'ceiling', `${label}: alternan en ${e.t}`));
                // Cada modo aparece una vez: siempre es su estreno.
                assert.ok(inside[0].t - m.t0 >= MODE_RULES.introBeats * beat - 0.03, `${label}: primera inversión en ${inside[0].t}`);
                assert.ok(inside[1].t - inside[0].t >= MODE_RULES.introGapS - 1e-3, `${label}: estreno espaciado`);
                assert.ok(analysis.beats.some((b) => Math.abs(b - inside[0].t) < 0.002), `${label}: estreno en el pulso`);
                assert.ok(m.t1 - inside.at(-1).t >= flipLead + MODE_RULES.exitClearS - 1e-3, `${label}: última inversión pegada a la salida`);
            }
            const holds = chart.events.filter((e) => e.type === 'hold');
            for (const h of holds) assert.ok(report.modes.some((m) => m.mode === 'fly' && h.t >= m.t0 && h.until <= m.t1), `${label}: nota en ${h.t} fuera del vuelo`);
            const v = validateChart(chart, { toleranceS: DIFFICULTY_PROFILES[report.difficulty].toleranceS });
            assert.ok(v.ok, `${label}: injugable en ${v.t} (${v.pattern})`);
        }
    }
});

test('memoria de frases dentro de la antigravedad: un riff que se repite se juega igual', () => {
    // Estrofa en calma (sin modo) y el riff como clímax: en Extremo, el único tramo de antigravedad.
    const riff = { bars: 16, energy: 0.85, hits: 0.9, role: 'chorus', cluster: 'R', riff: true };
    const analysis = makeSyntheticSong({
        bpm: 150,
        sections: [
            { bars: 24, energy: 0.3, hits: 0.35, role: 'verse', cluster: 'V' },
            riff,
            { bars: 8, energy: 0.25, hits: 0.3, role: 'outro', cluster: 'O' },
        ],
    });
    const { chart, report } = buildChart(analysis, { seed: 1, difficulty: 5 });
    assert.ok(report.modes.length >= 1);
    const m = report.modes[0];
    const period = 60 / 150;
    const barLen = 4 * period;
    // Por acción (la superficie depende de cuántas inversiones van antes), lejos
    // del estreno y de la salida.
    const bars = analysis.downbeats.filter((t) => t > m.t0 + 2 * barLen && t + 2 * barLen < m.t1);
    const patternOf = (start) => crystals(chart).filter((e) => e.t >= start - 0.01 && e.t < start + barLen - 0.01)
        .map((e) => Math.round((e.t - start) / (period / 2))).join(' ');
    let same = 0;
    let pairs = 0;
    for (let i = 0; i + 4 < bars.length; i++) {
        pairs++;
        if (patternOf(bars[i]) === patternOf(bars[i + 4]) && patternOf(bars[i]) !== '') same++;
    }
    assert.ok(pairs >= 2, `${pairs} pares`);
    assert.ok(same / pairs >= 0.9, `${same}/${pairs}: ${bars.map(patternOf).join(' | ')}`);
});

test('determinismo con modos: mismo análisis, seed y dificultad ⇒ mismo chart', () => {
    const analysis = makeSyntheticSong({ bpm: 126 });
    for (const d of [3, 5]) {
        const a = JSON.stringify(buildChart(analysis, { seed: 7, difficulty: d }).chart);
        const b = JSON.stringify(buildChart(analysis, { seed: 7, difficulty: d }).chart);
        assert.equal(a, b);
    }
});

test('los 8 oficiales × 5 dificultades: jugables, con momentos contados y distintos de una canción a otra', async () => {
    const dir = path.join(ROOT, 'database/seeds/official/baked');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    const signatures = new Set();
    for (const file of files) {
        const baked = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        for (const d of [1, 2, 3, 4, 5]) {
            const { chart, report } = buildChart(baked.analysis, { sha256: baked.audio.sha256, difficulty: d });
            const label = `${file} d${d}`;
            const profile = DIFFICULTY_PROFILES[report.difficulty];
            const v = validateChart(chart, { toleranceS: profile.toleranceS });
            assert.ok(v.ok, `${label}: injugable en ${v.t} (${v.pattern})`);

            const ids = report.modes.map((m) => m.mode);
            assert.ok(ids.length <= momentBudget(profile, chart.audio.durationSec), `${label}: ${ids.length} momentos`);
            assert.equal(new Set(ids).size, ids.length, `${label}: cada modo una vez`);
            assert.ok(ids.every((id) => profile.modes[id] !== undefined), `${label}: ${ids.join(' ')} fuera de su dificultad`);
            for (const m of report.modes) {
                assert.ok(m.t1 - m.t0 <= MODE_RULES.maxS + 2, `${label}: tramo de ${(m.t1 - m.t0).toFixed(1)} s`);
                const inClimax = report.climax !== null && m.at < report.climax.t1 - 1e-3 && m.t1 > report.climax.t0;
                if (inClimax) assert.ok(profile.modes[m.mode].climax, `${label}: ${m.mode} en el clímax`);
            }
            if (report.difficulty === 5 || (report.difficulty === 4 && d === 5)) signatures.add(ids.join('+') || 'ninguno');
            // Lo que pidió el playtest de la 6a: en What's Up Danger, uno o dos momentos, no tres.
            if (file.startsWith('whats-up-danger')) assert.ok(ids.length <= 2, `${label}: ${ids.length} momentos`);
        }
    }
    // Cada canción es un mundo: en la dificultad máxima hay niveles sin modos, con uno y con los dos.
    assert.ok(signatures.has('ninguno') && [...signatures].some((s) => s.includes('fly')) && [...signatures].some((s) => s.includes('flip')), [...signatures].join(' | '));
});

test('playtest de la 6b: en What\'s Up Danger, Time y Dawn of Faith los modos y el clímax entran y salen donde cambia la música', async () => {
    const dir = path.join(ROOT, 'database/seeds/official/baked');
    const plan = async (slug) => {
        const baked = JSON.parse(await readFile(path.join(dir, `${slug}.json`), 'utf8'));
        const { chart, report } = buildChart(baked.analysis, { sha256: baked.audio.sha256, difficulty: baked.requestedDifficulty });
        const model = buildMusicModel(baked.analysis);
        // Primer tiempo del tramo en que se vuelve a correr (el portal de salida va en su anacrusa).
        const exitAt = (m) => model.bars.find((b) => b.t0 > m.t1 + 1e-6).t0;
        return { chart, report, exitAt, modes: report.modes.map((m) => m.mode) };
    };
    const near = (actual, expected, label, tol = 0.6) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual.toFixed(2)} s, se esperaba ~${expected}`);

    // What's Up Danger (Extremo). Se oyó: calma desde 2:12; la canción vuelve de
    // golpe tras un break a las 2:37-2:40 (lo más intenso del tema); canto
    // coreado a las 3:12; solo música a las 3:23. Antes la antigravedad y el
    // clímax empezaban a las 2:52, donde la música no cambia.
    const wud = await plan('whats-up-danger');
    assert.deepEqual(wud.modes, ['fly', 'flip']);
    const [fly, flip] = wud.report.modes;
    near(fly.at, 131.9, 'vuelo: entra en la calma (2:11.9)');
    near(wud.exitAt(fly), 144.5, 'vuelo: sale cuando vuelven medios y agudos (2:24.5)');
    near(flip.at, 157.2, 'antigravedad: entra con la vuelta tras el break (2:37.2)');
    near(wud.report.climax.t0, 157.2, 'clímax: empieza con la vuelta');
    near(wud.exitAt(flip), 192.5, 'antigravedad: sale en el coro de 3:12.5');
    near(wud.report.climax.t1, 192.5, 'clímax: termina a las 3:12.5, antes de la outro');
    assert.ok(wud.chart.world.speedChanges.some((c) => c.speedPxS > wud.chart.world.speedPxS && Math.abs(c.t - 157.2) < 0.7), 'el mundo acelera con la vuelta');

    // Time (Fácil). Se oyó: el cambio de 1:14-1:15 (antigravedad, bien), ningún
    // cambio a la 1:30 (donde antes terminaba) y más instrumentos a la 1:47.
    const time = await plan('time');
    assert.deepEqual(time.modes, ['flip']);
    near(time.report.modes[0].at, 75.2, 'antigravedad: entra a la 1:15.2');
    near(time.exitAt(time.report.modes[0]), 105.7, 'antigravedad: sale cuando entran instrumentos (1:45.7), no a la 1:30');
    near(time.report.climax.t0, 105.7, 'clímax: 1:45.7');

    // Dawn of Faith (Difícil). Se oyó: cambio a la 1:28 (vuelo, bien) y ninguno
    // a la 1:42 (donde antes terminaba); vuelven el bajo y el bombo a la 1:49.6.
    const dawn = await plan('dawn-of-faith');
    assert.deepEqual(dawn.modes, ['fly', 'flip']);
    near(dawn.report.modes[0].at, 88.8, 'vuelo: entra a la 1:28.8');
    near(dawn.exitAt(dawn.report.modes[0]), 109.6, 'vuelo: sale cuando vuelve el bajo (1:49.6), no a la 1:42');
    near(dawn.report.modes[1].at, 120.7, 'antigravedad: entra con el clímax (2:00.7)');
    near(dawn.report.climax.t0, 120.7, 'clímax: 2:00.7');
    near(dawn.exitAt(dawn.report.modes[1]), dawn.report.climax.t1, 'antigravedad: dura el clímax');
});
