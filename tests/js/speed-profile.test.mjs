// Perfil de velocidad (Ola 5): la velocidad del mundo cambia por tramos sin
// romper la sincronía de la Ola 3.
//
// Lo que se protege: con cualquier perfil, el centro de un obstáculo cruza al
// Dino exactamente en su instante; ningún obstáculo salta de sitio al cambiar
// la velocidad; y el simulador de jugabilidad valida con la misma distancia
// que usa el spawner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSpeedProfile, asSpeedProfile } from '../../resources/js/game/systems/speedProfile.js';
import { createSpawner } from '../../resources/js/game/systems/spawner.js';
import { DINO_CENTER_X, actionLeadS, obstacleLeftX } from '../../resources/js/game/systems/physics.js';
import { simulateRun, toSimObstacles, validatePlayability } from '../../resources/js/game/systems/playability.js';
import { OBSTACLE_KIND } from '../../resources/js/game/config.js';

/** Integral numérica de la velocidad, para comparar con la exacta. */
function integrate(profile, a, b, steps = 20000) {
    const h = (b - a) / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += profile.speedAt(a + (i + 0.5) * h) * h;
    return sum;
}

test('velocidad constante: la distancia es exactamente (b − a) · v, como en la Ola 3', () => {
    const p = createSpeedProfile(437);
    assert.equal(p.constant, true);
    assert.equal(p.distanceBetween(2.5, 7.25), (7.25 - 2.5) * 437);
    assert.equal(p.speedAt(-3), 437);
    assert.equal(asSpeedProfile(437).base, 437);
});

test('cambio instantáneo: la velocidad salta y la distancia es continua', () => {
    const p = createSpeedProfile(400, [{ t: 10, speedPxS: 500, rampS: 0 }]);
    assert.equal(p.speedAt(9.999), 400);
    assert.equal(p.speedAt(10), 500);
    assert.ok(Math.abs(p.distanceAt(10 - 1e-9) - p.distanceAt(10)) < 1e-3, 'sin salto de posición');
    assert.ok(Math.abs(p.distanceBetween(5, 15) - (5 * 400 + 5 * 500)) < 1e-9);
    assert.equal(p.minSpeed, 400);
    assert.equal(p.maxSpeed, 500);
});

test('rampas: velocidad lineal y distancia igual a la integral; rampas solapadas se cortan', () => {
    const p = createSpeedProfile(420, [
        { t: 20, speedPxS: 520, rampS: 2 },
        { t: 21, speedPxS: 380, rampS: 3 },   // empieza antes de acabar la anterior
        { t: 40, speedPxS: 600, rampS: 0 },
    ]);
    assert.ok(Math.abs(p.speedAt(20.5) - 445) < 1e-9, 'a mitad de la primera rampa');
    assert.ok(Math.abs(p.speedAt(21) - 470) < 1e-9, 'la segunda rampa arranca desde donde iba la primera');
    assert.ok(Math.abs(p.speedAt(24) - 380) < 1e-9);
    // Tramos con rampas: contra la integral numérica (sin discontinuidades dentro).
    for (const [a, b] of [[0, 30], [19, 26], [20.3, 20.9], [26, 39]]) {
        assert.ok(Math.abs(p.distanceBetween(a, b) - integrate(p, a, b)) < 0.05, `distancia ${a}-${b}`);
    }
    // A través del cambio instantáneo de t=40: exacto (la regla del punto medio
    // del propio test yerra ahí hasta Δv·h/2).
    assert.equal(p.distanceBetween(35, 50), 5 * 380 + 10 * 600);
});

test('con cualquier perfil, el centro de cada obstáculo cruza al Dino en su instante exacto', () => {
    const profile = createSpeedProfile(380, [
        { t: 6, speedPxS: 520, rampS: 0 },
        { t: 9, speedPxS: 450, rampS: 1.2 },
    ]);
    for (const kind of Object.keys(OBSTACLE_KIND)) {
        const def = OBSTACLE_KIND[kind];
        for (const t of [4, 5.9, 6.1, 8.8, 9.5, 12]) {
            const cross = t + actionLeadS(def);
            const center = obstacleLeftX(def, cross, cross, profile) + def.w / 2;
            assert.ok(Math.abs(center - DINO_CENTER_X) < 1e-9, `${kind} en t=${t}`);
        }
    }
});

test('spawner con perfil: posiciones continuas al cambiar la velocidad y cruce en su instante', () => {
    const events = [
        { t: 5.6, type: 'obstacle', kind: 'CACTUS_SMALL' },   // se acerca a una velocidad y cruza a otra
        { t: 7, type: 'obstacle', kind: 'PTERO' },
        { t: 9.2, type: 'obstacle', kind: 'CACTUS_WIDE' },
    ];
    const profile = createSpeedProfile(400, [{ t: 6, speedPxS: 560, rampS: 0 }, { t: 9, speedPxS: 470, rampS: 1 }]);
    const fakes = new Map();
    const spawner = createSpawner({
        events,
        speed: profile,
        layer: { addChild() {}, removeChild() {} },
        createObstacle: (kind) => {
            const o = { kind, x: NaN, activate() {}, deactivate() {}, placeAt(x) { this.x = x; }, animate() {} };
            fakes.set(kind, o);
            return o;
        },
    });
    const last = new Map();
    const dt = 1 / 240;
    for (let tau = 0; tau <= 12; tau += dt) {
        spawner.tick(tau, dt, { width: 1920, groundY: 700 });
        for (const o of spawner.getActive()) {
            const prev = last.get(o.kind);
            // Entre dos frames un obstáculo avanza lo que dicta la velocidad: nunca teletransporta.
            if (prev !== undefined) assert.ok(prev - o.x <= 560 * dt + 1e-6 && prev - o.x >= 0, `${o.kind} saltó ${prev - o.x} px en t=${tau.toFixed(3)}`);
            last.set(o.kind, o.x);
        }
    }
    for (const e of events) {
        const def = OBSTACLE_KIND[e.kind];
        const cross = e.t + actionLeadS(def);
        const x = obstacleLeftX(def, cross, cross, profile);
        assert.ok(Math.abs(x + def.w / 2 - DINO_CENTER_X) < 1e-6);
    }
    assert.equal(fakes.size, 3);
});

test('simulador con perfil: lo que valida con la velocidad variable se supera con esa velocidad', () => {
    const events = [];
    for (let i = 0; i < 40; i++) events.push({ t: 3 + i * 0.75, type: 'obstacle', kind: i % 3 === 2 ? 'PTERO' : 'CACTUS_SMALL' });
    const profile = createSpeedProfile(420, [{ t: 12, speedPxS: 600, rampS: 0 }, { t: 24, speedPxS: 480, rampS: 1.5 }]);
    const sim = toSimObstacles(events);
    assert.ok(validatePlayability(sim, profile).ok);
    assert.ok(simulateRun(sim, profile).ok);
    // Y no reacciona por nadie: sin pulsar, choca con el primero.
    const lazy = simulateRun(sim, profile, { pressOffset: () => 5 });
    assert.equal(lazy.ok, false);
    assert.equal(lazy.index, 0);
});
