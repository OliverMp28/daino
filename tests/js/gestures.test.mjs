// Una pulsación, un gesto (playtest de Oct 2026).
//
// "Presionaba la tecla de salto y no saltaba, y perdí." "Se levantó cuando se
// estaba agachando del pájaro y creyó que no iba a perder."
//
// El nivel se construye y se valida con un jugador que mantiene: el salto
// completo y agachado hasta que el ptero pasa. Pero el salto dependía de cuánto
// se mantenía la tecla, y con un toque (el gesto natural, y el único en un móvil)
// subía 103 en vez de 158: pulsando EN el golpe ya no se salvaba un cactus a
// ninguna velocidad. Y soltar ↓ un pelo antes de tiempo era levantarse contra el
// ptero.
//
// Ahora cada acción se supera pulsando en su golpe, se mantenga o no:
//   - el salto es siempre el mismo arco;
//   - un toque agacha lo que dura el gesto y el Dino no se levanta con algo encima.
// Lo protege el "jugador de toques" jugando los niveles oficiales.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DINO_SIZE, DUCK_MIN_S, OBSTACLE_KIND, PHYSICS_STEP_S } from '../../resources/js/game/config.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import {
    DINO_CENTER_X, actionLeadS, applyInput, bodyFigure, bodyHitbox, bodyState, integrateBody, obstacleHit, obstacleTopY, settlePosture,
} from '../../resources/js/game/systems/physics.js';
import { validateChart } from '../../resources/js/game/systems/playability.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUND = 1000;
/** Lo que dura un toque: un dedo en una pantalla, una tecla pulsada sin mantener. */
const TAP_S = 0.06;

/**
 * Juega un obstáculo (acción en t = 5) con las pulsaciones dadas, paso a paso como
 * la partida: pulsaciones, integración, postura y choque.
 *
 * @param {string} kind
 * @param {number} speed
 * @param {Array<[number, string]>} inputs  [instante, entrada], en orden.
 * @param {(body: object, t: number) => void} [probe]  Se llama tras cada paso.
 */
function play(kind, speed, inputs, probe = () => {}) {
    const def = OBSTACLE_KIND[kind];
    const cross = 5 + actionLeadS(def);
    const body = bodyState(GROUND);
    const box = { x: 0, y: 0, w: 0, h: 0 };
    const scratch = { x: 0, y: 0, w: 0, h: 0 };
    const top = obstacleTopY(def, GROUND);
    let next = 0;
    for (let t = 3; t <= 7.5; t += PHYSICS_STEP_S) {
        while (next < inputs.length && inputs[next][0] <= t) applyInput(body, inputs[next++][1]);
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        const x = DINO_CENTER_X + (cross - t) * speed - def.w / 2;
        settlePosture(body, (b, figure) => obstacleHit(figure, b, def, x, top, scratch));
        probe(body, t);
        if (obstacleHit(bodyFigure(body), bodyHitbox(body, box), def, x, top, scratch)) return { ok: false, at: t };
    }
    return { ok: true };
}

const tap = (input, at) => (input === 'jump'
    ? [[at, 'jump'], [at + TAP_S, 'jumpEnd']]
    : [[at, 'duckStart'], [at + TAP_S, 'duckEnd']]);

test('el salto es siempre el mismo arco: da igual cuánto se mantenga la tecla', () => {
    const arc = (releaseAfter) => {
        const body = bodyState(GROUND);
        applyInput(body, 'jump');
        let apex = 0;
        let steps = 0;
        for (let i = 0; i < 400; i++) {
            if (i === Math.round(releaseAfter / PHYSICS_STEP_S)) applyInput(body, 'jumpEnd');
            integrateBody(body, PHYSICS_STEP_S, GROUND);
            apex = Math.max(apex, GROUND - DINO_SIZE.h - body.y);
            steps++;
            if (body.grounded) break;
        }
        return { apex, airS: steps * PHYSICS_STEP_S };
    };
    const held = arc(Infinity);
    assert.ok(held.apex > 150 && held.airS > 0.7, `salto completo: ${held.apex.toFixed(0)} de alto, ${held.airS.toFixed(2)} s`);
    for (const release of [0.03, 0.06, 0.1, 0.2]) assert.deepEqual(arc(release), held, `soltando a los ${release} s`);
});

test('un toque en el golpe salva un cactus a cualquier velocidad del juego, también pulsando ±80 ms', () => {
    for (const speed of [250, 300, 380, 500, 700, 1000]) {
        for (const offset of [-0.08, 0, 0.08]) {
            const r = play('CACTUS_SMALL', speed, tap('jump', 5 + offset));
            assert.ok(r.ok, `a ${speed} px/s con ${offset * 1000} ms: choque en ${r.at?.toFixed(3)}`);
        }
    }
});

test('un toque en el golpe agacha bajo el ptero a cualquier velocidad: no hace falta mantener', () => {
    for (const speed of [250, 300, 380, 500, 700, 1000]) {
        for (const offset of [-0.08, 0, 0.08]) {
            const r = play('PTERO', speed, tap('duck', 5 + offset));
            assert.ok(r.ok, `a ${speed} px/s con ${offset * 1000} ms: choque en ${r.at?.toFixed(3)}`);
        }
    }
    // Sin pulsar, el ptero se lleva al Dino por delante.
    assert.equal(play('PTERO', 500, []).ok, false);
});

test('soltar ↓ con el ptero encima no levanta al Dino: espera a que pase y entonces se levanta', () => {
    const def = OBSTACLE_KIND.PTERO;
    const cross = 5 + actionLeadS(def);
    for (const speed of [300, 600, 1000]) {
        let duckingAtCross = null;
        let stoodAt = null;
        // Mantiene desde el golpe y suelta justo cuando el ptero cruza sobre él.
        const r = play('PTERO', speed, [[5, 'duckStart'], [cross, 'duckEnd']], (body, t) => {
            if (duckingAtCross === null && t >= cross + 2 * PHYSICS_STEP_S) duckingAtCross = body.ducking;
            if (stoodAt === null && t > cross && !body.ducking) stoodAt = t;
        });
        assert.ok(r.ok, `a ${speed} px/s: choque en ${r.at?.toFixed(3)}`);
        assert.equal(duckingAtCross, true, 'con el ptero encima sigue agachado');
        assert.ok(stoodAt !== null && stoodAt - cross < 0.5, `se levanta en cuanto pasa (${((stoodAt - cross) * 1000).toFixed(0)} ms)`);
    }
});

test('el toque de agacharse dura lo que el gesto y saltar lo cancela', () => {
    const body = bodyState(GROUND);
    const free = () => false;
    applyInput(body, 'duckStart');
    applyInput(body, 'duckEnd');
    let steps = 0;
    while (body.ducking && steps < 400) {
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        settlePosture(body, free);
        steps++;
    }
    assert.ok(Math.abs(steps * PHYSICS_STEP_S - DUCK_MIN_S) <= 2 * PHYSICS_STEP_S, `agachado ${(steps * PHYSICS_STEP_S).toFixed(3)} s`);

    // Mantener: agachado mientras se mantenga.
    applyInput(body, 'duckStart');
    for (let i = 0; i < 240; i++) { integrateBody(body, PHYSICS_STEP_S, GROUND); settlePosture(body, free); }
    assert.equal(body.ducking, true, 'dos segundos mantenido');

    // Saltar deja de agacharse (aunque ↓ siga pulsado) y da el salto completo.
    assert.equal(applyInput(body, 'jump'), 'jump');
    assert.equal(body.ducking, false);
    let apex = 0;
    for (let i = 0; i < 400 && (i === 0 || !body.grounded); i++) {
        integrateBody(body, PHYSICS_STEP_S, GROUND);
        settlePosture(body, free);
        apex = Math.max(apex, GROUND - DINO_SIZE.h - body.y);
    }
    assert.ok(apex > 150, `salto completo tras agacharse: ${apex.toFixed(0)}`);
    assert.equal(body.ducking, false, 'aterriza de pie');
});

test('↓ en el aire acelera la caída y el Dino aterriza agachado; al soltar se levanta', () => {
    const free = () => false;
    const airtime = (duckAfter) => {
        const body = bodyState(GROUND);
        applyInput(body, 'jump');
        let steps = 0;
        for (let i = 0; i < 400; i++) {
            if (i === duckAfter) applyInput(body, 'duckStart');
            integrateBody(body, PHYSICS_STEP_S, GROUND);
            settlePosture(body, free);
            steps++;
            if (body.grounded) return { steps, body };
        }
        return { steps, body: null };
    };
    const normal = airtime(-1);
    const fast = airtime(48);   // ↓ a los 0.4 s, ya bajando
    assert.ok(fast.steps < normal.steps - 10, `cae antes: ${fast.steps} pasos frente a ${normal.steps}`);
    assert.equal(fast.body.ducking, true, 'aterriza agachado');
    assert.equal(fast.body.fastFall, false);
    applyInput(fast.body, 'duckEnd');
    for (let i = 0; i < 60; i++) { integrateBody(fast.body, PHYSICS_STEP_S, GROUND); settlePosture(fast.body, free); }
    assert.equal(fast.body.ducking, false);
});

test('los niveles oficiales se superan a toques: pulsando en el golpe sin mantener nada, con la tolerancia de su dificultad', async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, 'database/seeds/official/manifest.json'), 'utf8'));
    const levels = manifest.levels ?? manifest;
    assert.ok(levels.length >= 8);
    for (const entry of levels) {
        const { chart } = JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${entry.slug}.json`), 'utf8'));
        const toleranceS = DIFFICULTY_PROFILES[chart.difficulty.level].toleranceS;
        const held = validateChart(chart, { toleranceS });
        assert.ok(held.ok, `${entry.slug}: manteniendo, falla en t=${held.t} (${held.pattern})`);
        const tapped = validateChart(chart, { toleranceS, tapS: TAP_S });
        assert.ok(tapped.ok, `${entry.slug}: a toques, falla en t=${tapped.t} (${tapped.pattern})`);
    }
});
