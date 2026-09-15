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
import { READER_ADAPT_S, readerOffsetS, simulateRun, toSimObstacles, validatePlayability } from '../../resources/js/game/systems/playability.js';
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
    // El acelerón cae entre dos acciones, como la anacrusa del charter: el
    // obstáculo anterior ya cruzó y el siguiente se ve llegar a la velocidad nueva.
    const profile = createSpeedProfile(420, [{ t: 11.625, speedPxS: 600, rampS: 0 }, { t: 24, speedPxS: 480, rampS: 1.5 }]);
    const sim = toSimObstacles(events);
    assert.ok(validatePlayability(sim, profile).ok);
    assert.ok(simulateRun(sim, profile).ok);
    // Y no reacciona por nadie: sin pulsar, choca con el primero.
    const lazy = simulateRun(sim, profile, { pressOffset: () => 5 });
    assert.equal(lazy.ok, false);
    assert.equal(lazy.index, 0);
});

test('vista: tras un acelerón quien juega mirando pulsa tarde; tras un frenazo, pronto; con velocidad constante, en el golpe', () => {
    const lead = actionLeadS(OBSTACLE_KIND.CACTUS_SMALL);
    assert.equal(readerOffsetS(createSpeedProfile(430), 10, lead), 0, 'velocidad constante');

    const up = createSpeedProfile(400, [{ t: 10, speedPxS: 560, rampS: 0 }]);
    const late = readerOffsetS(up, 10, lead);
    // Sin recalibrar pulsaría adelanto·(1 − 400/560) tarde; recalibra algo antes de pulsar.
    assert.ok(late > 0.04 && late < lead * (1 - 400 / 560) + 1e-9, `acción en el acelerón: ${late}`);
    assert.ok(readerOffsetS(up, 9.8, lead) > 0.02, 'el error empieza antes del cambio: ese obstáculo ya se ve más lejos');
    assert.ok(Math.abs(readerOffsetS(up, 9.5, lead)) < 1e-6, 'uno que cruza antes del cambio no se entera');

    const brake = createSpeedProfile(560, [{ t: 10, speedPxS: 400, rampS: 0 }]);
    assert.ok(readerOffsetS(brake, 10, lead) < -0.04, 'tras un frenazo, pronto');

    // La anacrusa: el cambio READER_ADAPT_S antes de la acción, con el
    // obstáculo anterior ya cruzado. La vista acierta.
    const pickup = createSpeedProfile(400, [{ t: 10 - READER_ADAPT_S, speedPxS: 560, rampS: 0 }]);
    assert.ok(Math.abs(readerOffsetS(pickup, 10, lead)) < 1e-6);
});

test('validatePlayability exige que también lo supere quien juega mirando', () => {
    // Dos saltos a 0.70 s (legal en Extremo, ±40 ms) y un acelerón del 26 %
    // justo en el primero, como el portal en el primer tiempo del charter de la
    // Ola 5. Quien pulsa con el oído pasa; quien se guía por la vista salta
    // tarde el primero, aterriza tarde y el segundo le alcanza.
    const sim = toSimObstacles([
        { t: 10, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 10.7, type: 'obstacle', kind: 'CACTUS_SMALL' },
    ]);
    const onAction = createSpeedProfile(380, [{ t: 10, speedPxS: 480, rampS: 0 }]);
    const ear = [0, 0.04, -0.04].every((o) => simulateRun(sim, onAction, { pressOffset: (i) => (i % 2 === 0 ? o : -o) }).ok);
    assert.ok(ear, 'con el oído se supera');
    const verdict = validatePlayability(sim, onAction, { toleranceS: 0.04 });
    assert.equal(verdict.ok, false, 'con la vista no');
    assert.match(verdict.pattern, /^vista-/);
    assert.equal(verdict.index, 1);
    // El mismo acelerón en la anacrusa (0.35 s antes): lo superan los dos.
    const pickup = createSpeedProfile(380, [{ t: 10 - 0.35, speedPxS: 480, rampS: 0 }]);
    assert.ok(validatePlayability(sim, pickup, { toleranceS: 0.04 }).ok);
});
