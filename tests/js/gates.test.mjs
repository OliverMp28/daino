// Acentos de dos lados (charter 15): el paso de medusa y la pinza de cristales.
//
// Tercer playtest de la dificultad (Oct 2026): "el Extremo lo pasé al segundo
// intento". Los acentos de entonces (hileras de cactus, cristales afilados) solo
// apretaban a quien pulsaba un toque justo en el golpe: mantener el salto regala
// ~130 ms por el lado de pulsar pronto, y adelantarse a un cristal era gratis por
// diseño. Un acento de dos lados castiga igual pulsar pronto que tarde, se
// mantenga o no, y se juegue con el oído o con la vista.
//
// Invariantes protegidos:
//   - El margen de un paso y de una pinza es el mismo por los dos lados y para
//     los dos gestos, a cualquier velocidad.
//   - No hay atajo: ni saltando antes, ni por encima, ni quedándose quieto.
//   - Los márgenes sin simular (trackMargins.js) son los del simulador, también
//     en antigravedad.
//   - El charter solo los pone donde caben: con sitio antes, sin que mantener el
//     salto anterior mate en ellos.
//   - Un nivel termina un momento después de su último obstáculo, no con el
//     archivo de audio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATE, OBSTACLE_KIND, PINCH } from '../../resources/js/game/config.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { ACCENT_RULES } from '../../resources/js/game/levels/accents.js';
import { REFERENCE_PLAYER } from '../../resources/js/game/levels/challenge.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import { MOVEMENT_MODES } from '../../resources/js/game/systems/modes/index.js';
import { actionLeadS, bodyFigure, bodyHitbox, bodyState, obstacleHit, obstacleTopY } from '../../resources/js/game/systems/physics.js';
import { simulateRun, timingMarginsS, toSimObstacles, validateChart } from '../../resources/js/game/systems/playability.js';
import { RUN_END, playEndSec } from '../../resources/js/game/systems/runEnd.js';
import { speedProfileOf } from '../../resources/js/game/systems/speedProfile.js';
import { createTimingLog } from '../../resources/js/game/systems/timingLog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOLD = REFERENCE_PLAYER.holdS;

async function baked(slug) {
    return JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${slug}.json`), 'utf8'));
}

const gates = Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].gate === true && OBSTACLE_KIND[k].mode === 'run');
const pinches = Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].gate === true && OBSTACLE_KIND[k].mode === 'flip');

test('registro: los pasos de medusa y las pinzas son variantes de acento con su explicación', () => {
    assert.equal(gates.length, GATE.gapCells.length);
    assert.equal(pinches.length, 2 * PINCH.sepCells.length, 'cada pinza, en el suelo y en el techo');
    for (const kind of [...gates, ...pinches]) {
        const def = OBSTACLE_KIND[kind];
        assert.equal(def.role, 'accent');
        assert.ok(OBSTACLE_KIND[def.accentOf] !== undefined && OBSTACLE_KIND[def.accentOf].accentOf === undefined, `${kind}: variante de un kind normal`);
        assert.ok(/^[A-Z][A-Z0-9_]{0,31}$/.test(kind), `${kind}: nombre que acepta el servidor`);
        assert.ok(def.hint && def.hint.id && def.hint.label && def.hint.keys && def.hint.touch, `${kind}: se explica la primera vez`);
        assert.ok(def.drawn.every(([a, b]) => b > a), `${kind}: dice a qué alturas dibuja`);
    }
    assert.equal(new Set(gates.map((k) => OBSTACLE_KIND[k].hint.id)).size, 1, 'todos los pasos son la misma mecánica');
    // La medusa no toca la cabeza del Dino de pie y llega más alto que un salto mantenido.
    const altitude = GATE.floater.altitudeCells * 4;
    assert.ok(altitude > 84 && altitude <= 100, `las puntas de la medusa, a ${altitude} del suelo`);
    assert.ok(altitude + GATE.floater.hCells * 4 > 193 + 15 + 10, 'no se pasa por encima ni manteniendo el salto');
});

test('paso de medusa: el mismo margen por los dos lados, se mantenga el salto o no, a cualquier velocidad', () => {
    let measured = 0;
    for (const speed of [500, 650, 800, 1000]) {
        for (const kind of gates) {
            const tap = timingMarginsS(kind, speed);
            // Los que el charter usa: de la tolerancia de Extremo a la holgura máxima de un paso.
            if (Math.min(tap.early, tap.late) < 0.04 || Math.max(tap.early, tap.late) > ACCENT_RULES.gateMaxS) continue;
            const held = timingMarginsS(kind, speed, HOLD);
            assert.ok(Math.abs(tap.early - tap.late) <= 0.015, `${kind}@${speed}: −${tap.early} / +${tap.late}`);
            assert.ok(Math.abs(held.early - tap.early) <= 0.004 && Math.abs(held.late - tap.late) <= 0.004,
                `${kind}@${speed}: a toques −${tap.early}/+${tap.late}, manteniendo −${held.early}/+${held.late}`);
            measured++;
        }
    }
    assert.ok(measured >= 30, `pasos medidos: ${measured}`);
    // Una hilera, en cambio, mantenida perdona pulsar mucho antes: por eso no basta.
    const row = timingMarginsS('CACTUS_ROW_308', 900);
    const rowHeld = timingMarginsS('CACTUS_ROW_308', 900, HOLD);
    assert.ok(rowHeld.early >= row.early + 0.1, `hilera a toques −${row.early}, mantenida −${rowHeld.early}`);
});

test('paso de medusa: sin atajos (ni antes, ni por encima, ni sin saltar) y corriendo o agachado no se toca', () => {
    const kind = 'GATE_160';
    const speed = 900;
    const def = OBSTACLE_KIND[kind];
    const obstacles = toSimObstacles([{ t: 5, type: 'obstacle', kind }]);
    const margins = timingMarginsS(kind, speed);
    const run = (offset, holdS) => simulateRun(obstacles, speed, { pressOffset: () => offset, tapS: holdS > 0 ? () => holdS : null });
    assert.equal(run(0, 0).ok, true, 'en el golpe, a toques');
    assert.equal(run(0, HOLD).ok, true, 'en el golpe, manteniendo');
    // Cualquier salto anterior a su margen muere, con los dos gestos: bajo la medusa
    // o, saltando antes de que llegue, contra ella o contra el cactus.
    for (let early = margins.early + 0.02; early <= 1.2; early += 0.01) {
        for (const holdS of [0, HOLD]) {
            const r = run(-early, holdS);
            assert.equal(r.ok, false, `saltando ${Math.round(early * 1000)} ms antes (mantenido ${holdS}) no se pasa`);
        }
    }
    const late = run(margins.late + 0.03, 0);
    assert.equal(late.ok, false, 'tarde: el cactus');
    assert.equal(run(5, 0).ok, false, 'sin saltar: el cactus');

    // De pie y agachado, la medusa pasa por encima sin tocar (solo choca el cactus).
    const top = obstacleTopY(def, 1000);
    const scratch = { x: 0, y: 0, w: 0, h: 0 };
    for (const ducking of [false, true]) {
        const body = bodyState(1000);
        body.ducking = ducking;
        const box = bodyHitbox(body, { x: 0, y: 0, w: 0, h: 0 });
        const figure = bodyFigure(body);
        // Mientras solo la medusa está sobre el Dino (el cactus aún no llega a su caja).
        const cactusLeft = def.hitParts[def.hitParts.length - 1][0];
        for (let x = box.x + box.w - cactusLeft + 4; x <= box.x + box.w + 8; x += 4) {
            assert.equal(obstacleHit(figure, box, def, x, top, scratch), false, `${ducking ? 'agachado' : 'de pie'}, obstáculo en x=${x}`);
        }
    }
});

test('pinza de cristales: el mismo margen por los dos lados, en el suelo y en el techo; invertir pronto es subir contra el cristal de guarda', () => {
    const flip = MOVEMENT_MODES.flip;
    let measured = 0;
    for (const speed of [600, 800, 1000]) {
        for (const kind of pinches) {
            const m = flip.marginsS(OBSTACLE_KIND[kind], speed);
            if (Math.min(m.early, m.late) < 0.04 || Math.max(m.early, m.late) > ACCENT_RULES.gateMaxS) continue;
            assert.ok(Math.abs(m.early - m.late) <= 0.02, `${kind}@${speed}: −${m.early} / +${m.late}`);
            const twin = kind.includes('FLOOR') ? kind.replace('FLOOR', 'CEIL') : kind.replace('CEIL', 'FLOOR');
            assert.deepEqual(flip.marginsS(OBSTACLE_KIND[twin], speed), m, `${kind}: su gemela del otro lado mide lo mismo`);
            measured++;
        }
    }
    assert.ok(measured >= 30, `pinzas medidas: ${measured}`);

    // Jugada de verdad: en el golpe se pasa; mucho antes, contra el cristal de guarda; tarde, contra el del golpe.
    const kind = 'CRYSTAL_FLOOR_PINCH_116';
    const obstacles = toSimObstacles([{ t: 5, type: 'obstacle', kind }]);
    const run = (offset) => simulateRun(obstacles, 900, { modes: [{ t: 2, mode: 'flip' }], pressOffset: () => offset });
    assert.equal(run(0).ok, true);
    const early = run(-0.14);
    assert.equal(early.ok, false, 'invertir 140 ms antes');
    assert.ok(early.atSongTime < obstacles[0].cross, 'muere subiendo, contra el cristal del techo');
    assert.equal(run(0.14).ok, false, 'invertir 140 ms tarde');
    // Un cristal afilado suelto, en cambio, deja adelantarse lo que se quiera.
    assert.ok(flip.marginsS(OBSTACLE_KIND.CRYSTAL_FLOOR_SHARP_80, 900).early >= 0.3);
});

test('márgenes de la antigravedad sin simular: coinciden con el barrido del simulador', () => {
    const flip = MOVEMENT_MODES.flip;
    const sample = [
        'CRYSTAL_FLOOR', 'CRYSTAL_CEIL', 'CRYSTAL_FLOOR_SHARP_110', 'CRYSTAL_CEIL_SHARP_80',
        ...pinches.filter((_, i) => i % 9 === 0),
    ];
    for (const kind of sample) {
        const def = OBSTACLE_KIND[kind];
        for (const speed of [600, 900]) {
            const events = [{ t: 5, type: 'obstacle', kind }];
            // Lo que cuelga del techo se mide con el Dino ya arriba (un cristal del suelo antes).
            if (def.surface === 'ceiling') events.unshift({ t: 3.5, type: 'obstacle', kind: 'CRYSTAL_FLOOR' });
            const obstacles = toSimObstacles(events);
            const target = obstacles.findIndex((o) => o.kind === kind && o.t === 5);
            const survives = (offset) => simulateRun(obstacles, speed, { modes: [{ t: 2, mode: 'flip' }], pressOffset: (i) => (i === target ? offset : 0) }).ok;
            const fast = flip.marginsS(def, speed);
            if (!survives(0)) {
                assert.ok(fast.early < 0.02 && fast.late < 0.02, `${kind}@${speed}: injugable y el rastro da ${JSON.stringify(fast)}`);
                continue;
            }
            let early = 0;
            let late = 0;
            while (early < 0.4 && survives(-(early + 0.002))) early += 0.002;
            while (late < 0.4 && survives(late + 0.002)) late += 0.002;
            assert.ok(Math.abs(Math.min(fast.early, 0.4) - early) <= 0.012, `${kind}@${speed}: pronto ${fast.early} vs ${early}`);
            assert.ok(Math.abs(Math.min(fast.late, 0.4) - late) <= 0.012, `${kind}@${speed}: tarde ${fast.late} vs ${late}`);
        }
    }
});

test('el charter los pone donde caben: con sitio antes, de dos lados de verdad y jugables a toques y manteniendo', async () => {
    for (const [slug, difficulty] of [['whats-up-danger', 5], ['mi-fiesta', 4], ['running-with-the-wolves', 3]]) {
        const { analysis, audio } = await baked(slug);
        const { chart, report } = buildChart(analysis, { sha256: audio.sha256, difficulty });
        const profile = DIFFICULTY_PROFILES[report.difficulty];
        const speed = speedProfileOf(chart);
        const actions = chart.events.filter((e) => e.type === 'obstacle' && OBSTACLE_KIND[e.kind].trigger === undefined);
        const twoSided = actions.filter((e) => OBSTACLE_KIND[e.kind].gate === true);
        assert.ok(twoSided.length >= 8, `${slug} d${difficulty}: ${twoSided.length} acentos de dos lados`);
        for (const e of twoSided) {
            const def = OBSTACLE_KIND[e.kind];
            const i = actions.indexOf(e);
            const prev = actions[i - 1];
            const v = speed.speedAt(e.t + actionLeadS(def));
            const m = timingMarginsS(e.kind, v);
            // Dos lados, y no más estrecho de lo que promete la dificultad.
            assert.ok(Math.min(m.early, m.late) >= profile.accent.marginS - 0.004, `${slug} ${e.t} ${e.kind}: margen ${JSON.stringify(m)}`);
            assert.ok(Math.max(m.early, m.late) <= ACCENT_RULES.gateMaxS + 0.03, `${slug} ${e.t} ${e.kind}: demasiado holgado para leerse como uno`);
            if (def.mode === 'run') {
                const held = timingMarginsS(e.kind, v, HOLD);
                assert.ok(held.early <= m.early + 0.006, `${slug} ${e.t} ${e.kind}: manteniendo perdona pulsar antes (${held.early} vs ${m.early})`);
            }
            // Sitio antes, según lo que venga (accents.js, gateRoomS).
            if (prev !== undefined && (OBSTACLE_KIND[prev.kind].mode === 'flip') === (def.mode === 'flip')) {
                const type = def.mode === 'flip' ? 'flip' : OBSTACLE_KIND[prev.kind].action === 'duck' ? 'duck' : 'jump';
                const room = ACCENT_RULES.gateRoomS[type](speed.speedAt(e.t), profile.accent.marginS);
                assert.ok(e.t - prev.t >= room - 0.001, `${slug} ${e.t} ${e.kind}: a ${(e.t - prev.t).toFixed(3)} s de ${prev.kind} (necesita ${room.toFixed(3)})`);
            }
        }
        // Y el nivel se supera con la tolerancia de su dificultad dando toques.
        assert.equal(validateChart(chart, { toleranceS: profile.toleranceS }).ok, true, `${slug}: jugable`);
        assert.equal(validateChart(chart, { toleranceS: profile.toleranceS, tapS: 0.1 }).ok, true, `${slug}: jugable a toques`);
    }
});

test('mantener de más el salto anterior no mata en el paso de medusa que viene después', () => {
    for (const speed of [600, 800, 1000]) {
        const margin = 0.06;
        const room = ACCENT_RULES.gateRoomS.jump(speed, margin);
        const gate = gates.map((k) => ({ k, m: timingMarginsS(k, speed) })).filter((x) => Math.min(x.m.early, x.m.late) >= margin).sort((a, b) => a.m.early - b.m.early)[0].k;
        const obstacles = toSimObstacles([{ t: 5, type: 'obstacle', kind: 'CACTUS_SMALL' }, { t: 5 + room, type: 'obstacle', kind: gate }]);
        // El primero, mantenido y pulsado 40 ms tarde: aterriza lo más tarde posible.
        const r = simulateRun(obstacles, speed, { pressOffset: (i) => (i === 0 ? 0.04 : 0), tapS: (i) => (i === 0 ? HOLD : null) });
        assert.equal(r.ok, true, `a ${speed} px/s, ${gate} a ${room.toFixed(2)} s de un salto mantenido`);
    }
});

test('un nivel termina un momento después de su último obstáculo, no con el archivo de audio', async () => {
    // Dawn of Faith: 14.5 s entre el último cactus y el final del audio, 12 en silencio.
    const dawn = (await baked('dawn-of-faith')).chart;
    const end = playEndSec(dawn, dawn.audio.durationSec);
    const lastT = Math.max(...dawn.events.filter((e) => e.type === 'obstacle').map((e) => e.t));
    assert.ok(end < dawn.audio.durationSec - 10, `termina en ${end} y el audio en ${dawn.audio.durationSec}`);
    assert.ok(end - lastT >= RUN_END.afterClearS && end - lastT <= RUN_END.afterClearS + 1, `${(end - lastT).toFixed(2)} s tras la última acción`);
    // Si a la canción le queda un suspiro, se la deja terminar.
    const sugar = (await baked('sugar-red')).chart;
    assert.equal(playEndSec(sugar, sugar.audio.durationSec), sugar.audio.durationSec);
    // Nunca más allá del audio; sin nada que jugar, el audio entero; el vuelo también cuenta.
    for (const slug of ['whats-up-danger', 'time', 'one-day', 'hope']) {
        const chart = (await baked(slug)).chart;
        const t = playEndSec(chart, chart.audio.durationSec);
        const last = Math.max(...chart.events.filter((e) => e.type === 'obstacle' || e.type === 'hold').map((e) => e.until ?? e.t));
        assert.ok(t <= chart.audio.durationSec && t > last, `${slug}: ${t}`);
    }
    assert.equal(playEndSec({ events: [{ t: 0, type: 'section', level: 1 }], world: { speedPxS: 500 } }, 90), 90);
});

test('precisión de la partida: adelanto medio y dispersión de las pulsaciones emparejadas con su acción', () => {
    const targets = [];
    for (let i = 0; i < 22; i++) targets.push({ t: 5 + i, action: i % 11 >= 8 ? 'duck' : 'jump' });
    const log = createTimingLog(targets);
    assert.equal(log.summary(), null, 'sin pulsaciones no hay medida');
    // Siempre 20 ms antes, alternando ±10 ms: media −20, dispersión 10.
    let k = 0;
    for (const x of targets) {
        if (x.action === 'jump') log.record(x.t - 0.02 + (k++ % 2 === 0 ? 0.01 : -0.01));
    }
    log.record(100); // una pulsación que no era para nada
    const s = log.summary();
    assert.equal(s.presses, 16, 'los agachados no cuentan');
    assert.ok(Math.abs(s.biasMs + 20) <= 2, `media ${s.biasMs}`);
    assert.ok(Math.abs(s.sigmaMs - 10) <= 1, `dispersión ${s.sigmaMs}`);
});
