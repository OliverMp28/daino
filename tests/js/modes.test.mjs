// Modos de movimiento (Ola 6a): antigravedad, portales y su sitio en la canción.
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
//   - El charter: qué dificultades cambian de modo, cuántas veces, dónde (tramos
//     con cuerpo, frases completas de 12-24 s, la anacrusa del primer compás), el
//     estreno espaciado, los cristales alternando, la vuelta del modo con su
//     material, la memoria de frases dentro del modo y los 8 oficiales jugables.

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
import { CHART_FORMAT_VERSION, normalizeChart } from '../../resources/js/game/levels/chartFormat.js';
import { MODE_RULES } from '../../resources/js/game/levels/modePlan.js';
import { PAIR_GAP } from '../../resources/js/game/levels/patterns.js';
import { pickupTime } from '../../resources/js/game/levels/speedPlan.js';
import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import { chartStats } from '../../resources/js/game/levels/chartStats.js';
import { makeSyntheticSong } from './helpers/synthetic-audio.mjs';

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

test('formato 3: los portales se conservan; un modo desconocido o un cristal fuera de su modo se descartan con aviso', () => {
    const base = {
        formatVersion: CHART_FORMAT_VERSION, charter: { name: 'x', version: 5 }, seed: 1,
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
            { t: 30, type: 'mode', mode: 'nave' },                   // desconocido
        ],
    });
    assert.equal(CHART_FORMAT_VERSION, 3);
    assert.deepEqual(chart.events.map((e) => e.kind ?? e.mode), ['flip', 'CRYSTAL_FLOOR', 'run', 'CACTUS_SMALL']);
    assert.equal(warnings.length, 2, JSON.stringify(warnings));
    assert.throws(() => normalizeChart({ ...base, formatVersion: 4, events: [] }), /formato 4/);
});

test('estadísticas: los cristales cuentan como acciones con su margen, no como voladores', () => {
    const chart = { world: { speedPxS: 450 }, events: [{ t: 3, type: 'mode', mode: 'flip' }, ...zigzag(5, 0.6, 20)] };
    const stats = chartStats(chart);
    assert.equal(stats.actions, 20);
    assert.equal(stats.airShare, 0);
    assert.ok(stats.meanWindowS > 0.3);
});

// --------------------------- Charter ---------------------------

test('dificultad: Relajado no cambia de reglas; Fácil una vez; Normal hasta dos y nunca en el clímax; Extremo también en el clímax', () => {
    const analysis = makeSyntheticSong({ bpm: 120 });
    const spans = (d) => buildChart(analysis, { seed: 1, difficulty: d }).report;
    assert.deepEqual(spans(1).modes, []);
    assert.equal(spans(2).modes.length, 1);
    const normal = spans(3);
    assert.equal(normal.modes.length, 2);
    for (const m of normal.modes) assert.ok(m.t1 <= normal.climax.t0 || m.t0 >= normal.climax.t1, 'Normal corre el clímax');
    const extreme = spans(5);
    assert.equal(extreme.modes.length, 3);
    assert.ok(extreme.modes.some((m) => m.t0 < extreme.climax.t0 && m.t1 > extreme.climax.t0), 'Extremo invierte la gravedad en el clímax');
    for (const d of [1, 2, 3, 4, 5]) {
        assert.ok(DIFFICULTY_PROFILES[d].modes !== undefined, `d${d} declara sus modos`);
    }
});

test('dónde: tramos con cuerpo, frases completas de 12-24 s, portales en la anacrusa y separados; el modo vuelve con su material', () => {
    for (const bpm of [80, 120, 150]) {
        const analysis = makeSyntheticSong({ bpm });
        const model = buildMusicModel(analysis);
        const arc = buildSongArc(model);
        for (const d of [2, 3, 4, 5]) {
            const { chart, report } = buildChart(analysis, { seed: 2, difficulty: d });
            const label = `${bpm} BPM d${d}`;
            const portals = chart.events.filter((e) => e.type === 'mode');
            assert.equal(portals.length, report.modes.length * 2, label);
            for (const m of report.modes) {
                const bar0 = model.bars.findIndex((b) => b.t0 > m.t0 + 1e-6);
                const bar1 = model.bars.findIndex((b) => b.t0 > m.t1 + 1e-6);
                const dur = model.bars[bar1].t0 - model.bars[bar0].t0;
                assert.ok(dur >= MODE_RULES.minS - 1e-6 && dur <= MODE_RULES.maxS + 1e-6, `${label}: tramo de ${dur.toFixed(1)} s`);
                assert.equal((bar1 - bar0) % MODE_RULES.phraseBars, 0, `${label}: frases completas`);
                assert.equal(m.t0, Math.round(pickupTime(model, bar0) * 1000) / 1000, `${label}: entrada en la anacrusa`);
                assert.equal(m.t1, Math.round(pickupTime(model, bar1) * 1000) / 1000, `${label}: salida en la anacrusa`);
                const seg = arc.segments.find((s) => s.bar0 === bar0);
                assert.ok(seg !== undefined && seg.level >= 2, `${label}: empieza con un tramo con cuerpo`);
                assert.ok(m.t0 >= MODE_RULES.minStartS - 1, `${label}: no en el arranque`);
            }
            for (let i = 1; i < report.modes.length; i++) {
                assert.ok(report.modes[i].t0 - report.modes[i - 1].t1 >= MODE_RULES.minGapS - 1e-6, `${label}: se corre entre dos tramos`);
            }
            assert.deepEqual(normalizeChart(chart).warnings, [], label);
        }
    }
    // Normal en la canción por defecto: los dos estribillos que no son el clímax.
    const analysis = makeSyntheticSong({ bpm: 120 });
    const { report } = buildChart(analysis, { seed: 1, difficulty: 3 });
    const choruses = analysis.sections.filter((s) => s.role === 'chorus').map((s) => s.startSec);
    assert.equal(report.modes.length, 2);
    report.modes.forEach((m, i) => assert.ok(Math.abs(m.t0 - choruses[i]) < 0.6, `el modo ${i} abre el estribillo ${choruses[i]}`));
});

test('alrededor de un portal no hay acciones; el estreno espera y va espaciado; los cristales alternan desde el suelo', () => {
    for (const bpm of [90, 128]) {
        const analysis = makeSyntheticSong({ bpm });
        for (const d of [2, 3, 5]) {
            const { chart, report } = buildChart(analysis, { seed: 4, difficulty: d });
            const label = `${bpm} BPM d${d}`;
            const beat = 60 / bpm;
            const runLead = actionLeadS(OBSTACLE_KIND.CACTUS_SMALL);
            const flipLead = actionLeadS(OBSTACLE_KIND.CRYSTAL_FLOOR);
            report.modes.forEach((m, i) => {
                const inside = obstacles(chart).filter((e) => e.t >= m.t0 && e.t < m.t1);
                assert.ok(inside.length >= 4, `${label}: tramo ${i} con ${inside.length} acciones`);
                assert.ok(inside.every((e) => OBSTACLE_KIND[e.kind].mode === 'flip'), `${label}: dentro, solo cristales`);
                inside.forEach((e, k) => assert.equal(e.kind, k % 2 === 0 ? 'CRYSTAL_FLOOR' : 'CRYSTAL_CEIL', `${label}: alternan en ${e.t}`));
                const before = obstacles(chart).filter((e) => e.t < m.t0).at(-1);
                if (before) assert.ok(m.t0 - before.t >= runLead + MODE_RULES.exitClearS - 1e-3, `${label}: acción de correr en ${before.t} pegada al portal ${m.t0}`);
                assert.ok(inside[0].t - m.t0 >= (i === 0 ? MODE_RULES.introBeats * beat - 0.03 : MOVEMENT_MODES.flip.settleS - 1e-3), `${label}: primera inversión en ${inside[0].t}`);
                assert.ok(m.t1 - inside.at(-1).t >= flipLead + MODE_RULES.exitClearS - 1e-3, `${label}: última inversión pegada a la salida`);
                const after = obstacles(chart).find((e) => e.t >= m.t1);
                if (after) assert.ok(after.t - m.t1 >= MOVEMENT_MODES.run.settleS - 1e-3, `${label}: primera acción al volver a correr`);
                if (i === 0) {
                    assert.ok(inside[1].t - inside[0].t >= MODE_RULES.introGapS - 1e-3, `${label}: estreno espaciado`);
                    assert.ok(analysis.beats.some((b) => Math.abs(b - inside[0].t) < 0.002), `${label}: estreno en el pulso`);
                }
            });
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

test('los 8 oficiales × 5 dificultades: con los portales, jugables; las canciones largas cambian de modo desde Fácil', async () => {
    const dir = path.join(ROOT, 'database/seeds/official/baked');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    let longWithModes = 0;
    let long = 0;
    for (const file of files) {
        const baked = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        for (const d of [1, 2, 3, 4, 5]) {
            const { chart, report } = buildChart(baked.analysis, { sha256: baked.audio.sha256, difficulty: d });
            const label = `${file} d${d}`;
            const v = validateChart(chart, { toleranceS: DIFFICULTY_PROFILES[report.difficulty].toleranceS });
            assert.ok(v.ok, `${label}: injugable en ${v.t} (${v.pattern})`);
            if (report.difficulty === 1) assert.deepEqual(report.modes, [], `${label}: Relajado corre`);
            for (const m of report.modes) assert.ok(m.t1 - m.t0 <= MODE_RULES.maxS + 2, `${label}: tramo de ${(m.t1 - m.t0).toFixed(1)} s`);
            if (d === 3 && chart.audio.durationSec >= 150) {
                long++;
                if (report.modes.length > 0) longWithModes++;
            }
        }
    }
    assert.equal(longWithModes, long, `${longWithModes}/${long} canciones de más de 2:30 en Normal con antigravedad`);
});
