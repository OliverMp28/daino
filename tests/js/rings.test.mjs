// Anillos de salto (Ola 6c): un segundo salto en el aire sobre el golpe que sigue a un salto.
//
// Se protege:
//   - La física: pulsar dentro del aro en el aire vuelve a impulsar; en el suelo, sin
//     pulsación o muerto, no; en otro modo, no; cada aro vale una vez.
//   - La sincronía: pulsar sobre el golpe (con la tolerancia) salva la figura; sin
//     pulsar en el aro se choca; el margen queda centrado en el golpe.
//   - El registro: un activador no tiene acción propia, tiene zona, texto y un modo
//     que sabe aplicarlo; no se choca y el spawner lo entrega una sola vez.
//   - Los huecos (PAIR_GAP): las fórmulas quedan por encima de lo medido.
//   - El charter: anillos solo donde la dificultad los tiene y desde su etapa, siempre
//     tras un salto y dentro de su ventana, con un obstáculo que los hace necesarios,
//     en charts jugables y deterministas; el obstáculo nunca es un acento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DINO_SIZE, JUMP_RING, OBSTACLE_KIND, PHYSICS_STEP_S } from '../../resources/js/game/config.js';
import {
    applyInput, applyTrigger, bodyState, enterMode, integrateBody, triggerZone,
} from '../../resources/js/game/systems/physics.js';
import { MOVEMENT_MODES } from '../../resources/js/game/systems/modes/index.js';
import { simulateRun, toSimObstacles, toSimTriggers, validateChart, validatePlayability } from '../../resources/js/game/systems/playability.js';
import { createSpawner } from '../../resources/js/game/systems/spawner.js';
import { PAIR_GAP } from '../../resources/js/game/levels/patterns.js';
import { RING_HAZARDS, RING_KIND, ringHazard } from '../../resources/js/game/levels/rings.js';
import { buildChart, unlockSchedule } from '../../resources/js/game/levels/charter.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { normalizeChart } from '../../resources/js/game/levels/chartFormat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUND = 1000;
const RING = OBSTACLE_KIND[RING_KIND];

async function baked(slug) {
    return JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${slug}.json`), 'utf8'));
}

/** Salto sobre un cactus en 5 s, y en 5 + gap su anillo con `hazard`. */
function figure(gap, hazard = 'CACTUS_SMALL', extra = []) {
    const events = [
        { t: 5, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 5 + gap, type: 'obstacle', kind: hazard },
        { t: 5 + gap, type: 'obstacle', kind: RING_KIND },
        ...extra,
    ];
    return { events, obstacles: toSimObstacles(events), triggers: toSimTriggers(events) };
}

function airborne() {
    const body = bodyState(GROUND);
    applyInput(body, 'jump');
    for (let i = 0; i < 24; i++) integrateBody(body, PHYSICS_STEP_S, GROUND);
    return body;
}

// --------------------------- Física ---------------------------

test('física: en el aire, una pulsación dentro del aro vuelve a impulsar; en el suelo, sin pulsación, muerto o en otro modo, no', () => {
    const body = airborne();
    assert.equal(applyTrigger(body, RING), null, 'sin pulsación pendiente no pasa nada');
    applyInput(body, 'jump');
    assert.ok(body.jumpBufferT > 0, 'la pulsación en el aire queda guardada');
    assert.equal(applyTrigger(body, RING), 'ring');
    assert.equal(body.vy, -JUMP_RING.impulsePxS);
    assert.equal(body.jumpBufferT, 0, 'la pulsación se gasta');

    const grounded = bodyState(GROUND);
    grounded.jumpBufferT = 0.1;
    assert.equal(applyTrigger(grounded, RING), null, 'en el suelo la pulsación ya fue un salto');

    const dead = airborne();
    applyInput(dead, 'jump');
    dead.dead = true;
    assert.equal(applyTrigger(dead, RING), null);

    const flip = airborne();
    applyInput(flip, 'jump');
    enterMode(flip, 'flip');
    flip.jumpBufferT = 0.1;
    assert.equal(applyTrigger(flip, RING), null, 'la antigravedad no tiene anillos');
});

test('registro: un activador no tiene acción propia, tiene zona, texto y un modo que lo aplica', () => {
    const triggers = Object.entries(OBSTACLE_KIND).filter(([, def]) => def.trigger !== undefined);
    assert.ok(triggers.length >= 1);
    for (const [kind, def] of triggers) {
        assert.equal(def.action, undefined, `${kind}: la pulsación la pide su obstáculo`);
        assert.equal(typeof MOVEMENT_MODES[def.mode].trigger, 'function', `${kind}: su modo lo sabe aplicar`);
        assert.ok(def.zone.padX > 0 && def.zone.padY > 0, `${kind}: zona con holgura`);
        assert.ok(def.hint.label && def.hint.keys && def.hint.touch, `${kind}: se explica`);
        const zone = triggerZone(def, 100, 400);
        assert.deepEqual(zone, { x: 100 - def.zone.padX, y: 400 - def.zone.padY, w: def.w + 2 * def.zone.padX, h: def.h + 2 * def.zone.padY });
    }
    // Un Dino en el suelo no toca el aro (si no, pulsar corriendo lo gastaría).
    const standingTop = RING.altitude - RING.zone.padY;
    assert.ok(standingTop > DINO_SIZE.h - 10, `el aro empieza a ${standingTop} del suelo`);
});

// --------------------------- Sincronía ---------------------------

test('figura salto → anillo: pulsar en el golpe (con la tolerancia) la salva; sin pulsar en el aro se choca', () => {
    for (const speed of [450, 650, 900]) {
        for (const gap of [0.3, 0.45, 0.6]) {
            const f = figure(gap);
            assert.ok(validatePlayability(f.obstacles, speed, { toleranceS: 0.055, triggers: f.triggers }).ok, `${speed} px/s, ${gap} s`);
            const skipped = simulateRun(f.obstacles, speed, { triggers: f.triggers, pressOffset: (i) => (i === 1 ? 5 : 0) });
            assert.equal(skipped.ok, false, `${speed} px/s, ${gap} s: sin el anillo el cactus no se salva`);
            // Sin aro, pulsar en el aire no basta... salvo cerca del aterrizaje, donde la
            // pulsación guardada (jump buffer) ya salta desde el suelo a tiempo.
            if (gap <= 0.45) {
                const noRing = simulateRun(f.obstacles, speed, {});
                assert.equal(noRing.ok, false, `${speed} px/s, ${gap} s: sin aro, pulsar en el aire no basta`);
            }
        }
    }
});

test('el margen de la pulsación del anillo queda centrado en el golpe', () => {
    for (const speed of [650, 1000]) {
        const f = figure(0.3);
        const survives = (offset) => simulateRun(f.obstacles, speed, { triggers: f.triggers, pressOffset: (i) => (i === 1 ? offset : 0) }).ok;
        let early = 0;
        while (early < 0.3 && survives(-(early + 0.005))) early += 0.005;
        let late = 0;
        while (late < 0.3 && survives(late + 0.005)) late += 0.005;
        assert.ok(early >= 0.1 && late >= 0.1, `${speed} px/s: −${(early * 1000).toFixed(0)}/+${(late * 1000).toFixed(0)} ms`);
        assert.ok(Math.abs(early - late) <= 0.08, `${speed} px/s: descentrado −${(early * 1000).toFixed(0)}/+${(late * 1000).toFixed(0)} ms`);
    }
});

test('spawner: el aro se ve pero no se choca, y se entrega una sola vez', () => {
    const f = figure(0.3);
    const spawner = createSpawner({
        events: f.events,
        speedPxS: 650,
        layer: { addChild() {}, removeChild() {} },
        createObstacle: (kind) => ({ kind, x: 0, activate() {}, deactivate() {}, placeAt(x) { this.x = x; }, animate() {}, onTriggered() { this.popped = true; } }),
    });
    const at = 5.3 + JUMP_RING.leadS;
    spawner.tick(at, 1 / 60, { width: 1600, groundY: GROUND });
    assert.ok(spawner.getActive().some((o) => o.kind === RING_KIND), 'el aro está en escena');
    // Un Dino a media altura justo en el aro.
    const box = { x: 140, y: GROUND - 200, w: 34, h: 59 };
    assert.equal(spawner.collisionAt(box, at, GROUND), null, 'no es un obstáculo');
    const hit = spawner.triggerAt(box, at, GROUND);
    assert.equal(hit?.kind, RING_KIND);
    spawner.markTriggerUsed(hit);
    assert.ok(spawner.getActive().find((o) => o.kind === RING_KIND).popped, 'su visual se entera');
    assert.equal(spawner.triggerAt(box, at, GROUND), null, 'ya usado');
});

test('spawner: el orbe al alcance se ilumina y se apaga al salir, uno solo cada vez', () => {
    // Tras el playtest de la 6c ("parece un portal"): el orbe enseña cuándo pulsar.
    const f = figure(0.3);
    const spawner = createSpawner({
        events: f.events,
        speedPxS: 650,
        layer: { addChild() {}, removeChild() {} },
        createObstacle: (kind) => ({
            kind, x: 0, armed: false,
            activate() { this.armed = false; }, deactivate() {}, placeAt(x) { this.x = x; }, animate() {}, onTriggered() {},
            setArmed(on) { this.armed = on; },
        }),
    });
    const at = 5.3 + JUMP_RING.leadS;
    spawner.tick(at, 1 / 60, { width: 1600, groundY: GROUND });
    const orb = spawner.getActive().find((o) => o.kind === RING_KIND);
    const inside = spawner.triggerAt({ x: 140, y: GROUND - 200, w: 34, h: 59 }, at, GROUND);
    spawner.armTrigger(inside);
    assert.equal(orb.armed, true, 'al alcance: iluminado');
    spawner.armTrigger(inside);
    assert.equal(orb.armed, true, 'repetir no cambia nada');
    spawner.armTrigger(null);
    assert.equal(orb.armed, false, 'fuera de alcance: apagado');
    assert.ok(spawner.getActive().filter((o) => o.armed).length === 0);
});

// --------------------------- Huecos ---------------------------

test('PAIR_GAP del anillo: la ventana tras un salto es jugable y necesaria, y el aterrizaje cabe con la fórmula', () => {
    for (const tol of [0.04, 0.055]) {
        for (const speed of [450, 800, 1100]) {
            const lo = PAIR_GAP.jumpRing.min(speed, tol);
            const hi = PAIR_GAP.jumpRing.max(speed, tol);
            for (const gap of [lo, (lo + hi) / 2, hi]) {
                assert.notEqual(ringHazard('CACTUS_SMALL', gap, speed, tol), null, `±${tol} ${speed} px/s: sin obstáculo para un anillo a ${gap.toFixed(2)} s`);
            }
            const g = 0.3;
            const hazard = ringHazard('CACTUS_SMALL', g, speed, tol);
            for (const [next, gapFor] of [['CACTUS_SMALL', PAIR_GAP.ringJump], ['PTERO', PAIR_GAP.ringDuck]]) {
                const f = figure(g, hazard, [{ t: 5 + g + gapFor(speed, tol), type: 'obstacle', kind: next }]);
                assert.ok(validatePlayability(f.obstacles, speed, { toleranceS: tol, triggers: f.triggers }).ok, `±${tol} ${speed} px/s: anillo → ${next}`);
            }
        }
    }
    assert.ok(RING_HAZARDS[0] === 'CACTUS_SMALL' && RING_HAZARDS.every((k) => OBSTACLE_KIND[k].action === 'jump'), RING_HAZARDS.join(' '));
});

// --------------------------- Charter ---------------------------

test('charter: anillos solo desde Normal y desde su etapa, tras un salto, necesarios y en charts jugables y deterministas', async () => {
    let total = 0;
    for (const slug of ['sugar-red', 'whats-up-danger', 'mi-fiesta']) {
        const { analysis, audio } = await baked(slug);
        for (const d of [1, 2, 3, 4, 5]) {
            const { chart, report } = buildChart(analysis, { sha256: audio.sha256, difficulty: d });
            const label = `${slug} d${d}`;
            const profile = DIFFICULTY_PROFILES[report.difficulty];
            const rings = chart.events.filter((e) => e.type === 'obstacle' && e.kind === RING_KIND);
            assert.equal(rings.length, report.rings, label);
            if (profile.ring === null) {
                assert.equal(rings.length, 0, `${label}: esta dificultad no tiene anillos`);
                continue;
            }
            total += rings.length;
            const unlock = unlockSchedule(buildSongArc(buildMusicModel(analysis)), profile).ring;
            const actions = chart.events.filter((e) => e.type === 'obstacle' && OBSTACLE_KIND[e.kind].trigger === undefined);
            for (const ring of rings) {
                assert.ok(ring.t >= unlock - 1e-6, `${label}: anillo en ${ring.t} antes de su etapa (${unlock})`);
                const i = actions.findIndex((a) => Math.abs(a.t - ring.t) < 1e-9);
                assert.ok(i > 0, `${label}: el anillo de ${ring.t} lleva su obstáculo`);
                const hazard = actions[i];
                const prev = actions[i - 1];
                assert.equal(OBSTACLE_KIND[prev.kind].action, 'jump', `${label}: el anillo de ${ring.t} sigue a un salto`);
                const gap = ring.t - prev.t;
                assert.ok(gap >= PAIR_GAP.jumpRing.min(0, 0) - 1e-6 && gap <= PAIR_GAP.jumpRing.max(0, 0) + 1e-6, `${label}: hueco ${gap.toFixed(3)}`);
                assert.equal(OBSTACLE_KIND[prev.kind].accentOf, undefined, `${label}: el salto de un anillo no lleva acento`);
                // Necesario: sin pulsar en el aro, esa figura choca.
                const local = [prev, hazard, ring];
                const obstacles = toSimObstacles(local);
                const skipped = simulateRun(obstacles, chart.world.speedPxS, { triggers: toSimTriggers(local), pressOffset: (k) => (k === 1 ? 5 : 0) });
                assert.equal(skipped.ok, false, `${label}: el anillo de ${ring.t} se puede ignorar`);
            }
            assert.ok(validateChart(chart, { toleranceS: profile.toleranceS }).ok, `${label}: jugable`);
            assert.equal(JSON.stringify(buildChart(analysis, { sha256: audio.sha256, difficulty: d }).chart), JSON.stringify(chart), `${label}: determinista`);
            assert.deepEqual(normalizeChart(chart).warnings, [], `${label}: sin avisos`);
        }
    }
    assert.ok(total >= 20, `anillos en los tres oficiales: ${total}`);
});
