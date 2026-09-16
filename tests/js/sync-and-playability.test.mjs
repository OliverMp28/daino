// Sincronía y jugabilidad (Ola 3).
//
// Estos tests son la prueba de que el defecto §1.A del doc 10 está arreglado:
// los obstáculos llegan al Dino en su instante musical, sin depender del
// ancho de pantalla, y cualquier chart generado se puede superar.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OBSTACLE_KIND } from '../../resources/js/game/config.js';
import {
    DINO_CENTER_X,
    actionLeadS,
    jumpApexTimeS,
    obstacleLeftX,
} from '../../resources/js/game/systems/physics.js';
import {
    simulateRun,
    toSimObstacles,
    validatePlayability,
} from '../../resources/js/game/systems/playability.js';
import { createSpawner } from '../../resources/js/game/systems/spawner.js';
import { createBeatClock } from '../../resources/js/game/systems/beatClock.js';

// Los kinds de correr; los de otros modos se juegan dentro de su modo (modes.test.mjs).
const KINDS = Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].mode === 'run');
const SPEEDS = [250, 350, 450, 600];

test('el centro del obstáculo cruza al Dino exactamente actionLead después de su evento', () => {
    for (const kind of KINDS) {
        const def = OBSTACLE_KIND[kind];
        const t = 12.5;
        const cross = t + actionLeadS(def);
        for (const speed of SPEEDS) {
            const centerAtCross = obstacleLeftX(def, cross, cross, speed) + def.w / 2;
            assert.ok(Math.abs(centerAtCross - DINO_CENTER_X) < 1e-9, `${kind}@${speed}`);
        }
    }
});

test('la posición no depende del ancho de la ventana (antes el desfase cambiaba con el monitor)', () => {
    // En el modelo nuevo el viewport solo decide CUÁNDO se hace visible un
    // obstáculo, nunca DÓNDE está. Se comprueba con el spawner real a dos
    // anchos: la x de cada obstáculo en el mismo instante debe coincidir.
    const events = [
        { t: 4, type: 'obstacle', kind: 'CACTUS_SMALL' },
        { t: 5, type: 'obstacle', kind: 'PTERO' },
        { t: 6.2, type: 'obstacle', kind: 'CACTUS_WIDE' },
    ];
    const snapshot = (width) => {
        const fakes = [];
        const spawner = createSpawner({
            events,
            speedPxS: 437,
            layer: { addChild() {}, removeChild() {} },
            createObstacle: (kind) => {
                const o = fakeObstacle(kind);
                fakes.push(o);
                return o;
            },
        });
        const xs = {};
        for (let tau = 0; tau <= 8; tau += 1 / 60) {
            spawner.tick(tau, 1 / 60, { width, groundY: 700 });
            if (Math.abs(tau - 5.2) < 1 / 120) {
                for (const o of spawner.getActive()) xs[o.kind] = o.x;
            }
        }
        return xs;
    };
    const narrow = snapshot(1024);
    const wide = snapshot(3440);
    for (const kind of Object.keys(narrow)) {
        assert.ok(Math.abs(narrow[kind] - wide[kind]) < 1e-9, `${kind}: ${narrow[kind]} vs ${wide[kind]}`);
    }
    assert.ok(Object.keys(narrow).length >= 2, 'debe haber obstáculos en pantalla en ese instante');
});

test('el adelanto por defecto es el tiempo al ápice del salto (derivado de la física)', () => {
    assert.equal(actionLeadS(OBSTACLE_KIND.CACTUS_SMALL), jumpApexTimeS());
    assert.equal(actionLeadS({ actionLeadS: 0.2 }), 0.2, 'un kind puede declarar su propio adelanto');
});

test('pulsar SOBRE el beat supera cada kind a cada velocidad, con ±40 ms de margen', () => {
    // La decisión central de la Ola 3 (event.t = instante de acción) solo es
    // correcta si actuar en t es la jugada buena. Se prueba kind a kind.
    for (const kind of KINDS) {
        for (const speed of SPEEDS) {
            const obstacles = toSimObstacles([{ t: 5, type: 'obstacle', kind }]);
            for (const offset of [-0.04, 0, 0.04]) {
                const r = simulateRun(obstacles, speed, { pressOffset: () => offset });
                assert.ok(r.ok, `${kind} a ${speed} px/s con la pulsación desplazada ${offset * 1000} ms`);
            }
        }
    }
});

test('no pulsar provoca la colisión: el simulador detecta de verdad', () => {
    for (const kind of KINDS) {
        const obstacles = toSimObstacles([{ t: 5, type: 'obstacle', kind }]);
        // Pulsar muy tarde (1 s después) equivale a no reaccionar.
        const r = simulateRun(obstacles, 437, { pressOffset: () => 1.0 });
        assert.equal(r.ok, false, `${kind} sin reacción debería chocar`);
        assert.equal(r.t, 5);
    }
});

test('el hueco mínimo del charter (0.70 s) es superable entre cualquier par de kinds', () => {
    for (const a of KINDS) {
        for (const b of KINDS) {
            for (const speed of SPEEDS) {
                const obstacles = toSimObstacles([
                    { t: 5, type: 'obstacle', kind: a },
                    { t: 5.7, type: 'obstacle', kind: b },
                ]);
                const v = validatePlayability(obstacles, speed);
                assert.ok(v.ok, `${a} → ${b} a ${speed} px/s falla con patrón "${v.pattern}"`);
            }
        }
    }
});

test('dos saltos demasiado juntos se detectan como injugables', () => {
    const obstacles = toSimObstacles([
        { t: 5, type: 'obstacle', kind: 'CACTUS_WIDE' },
        { t: 5.3, type: 'obstacle', kind: 'CACTUS_WIDE' },
    ]);
    const v = validatePlayability(obstacles, 450);
    assert.equal(v.ok, false);
    assert.equal(v.t, 5.3, 'se señala el segundo obstáculo, el que habría que retirar');
});

test('el spawner recicla obstáculos (pool) en vez de crear uno por evento', () => {
    const events = [];
    for (let i = 0; i < 200; i++) events.push({ t: 3 + i * 0.8, type: 'obstacle', kind: KINDS[i % KINDS.length] });
    let created = 0;
    const spawner = createSpawner({
        events,
        speedPxS: 600,
        layer: { addChild() {}, removeChild() {} },
        createObstacle: (kind) => { created++; return fakeObstacle(kind); },
    });
    for (let tau = 0; tau <= 3 + 200 * 0.8 + 3; tau += 1 / 60) {
        spawner.tick(tau, 1 / 60, { width: 1920, groundY: 700 });
    }
    assert.ok(created < 30, `200 obstáculos no deberían necesitar ${created} objetos`);
    assert.equal(spawner.getActive().length, 0, 'al final todo ha salido de pantalla');
});

test('la partida no se da por ganada mientras quede un obstáculo por cruzar', () => {
    const spawner = createSpawner({
        events: [{ t: 9.8, type: 'obstacle', kind: 'CACTUS_SMALL' }],
        speedPxS: 400,
        layer: { addChild() {}, removeChild() {} },
        createObstacle: fakeObstacle,
    });
    // La canción "acaba" en 10 s pero el cruce es en 9.8 + 0.36.
    assert.equal(spawner.hasPendingCrossing(10), true);
    assert.equal(spawner.hasPendingCrossing(10.2), false);
});

test('un obstáculo que nace dentro de la pantalla entra con fundido; uno fuera, no', () => {
    const born = [];
    const spawner = createSpawner({
        events: [{ t: 0.5, type: 'obstacle', kind: 'CACTUS_SMALL' }, { t: 30, type: 'obstacle', kind: 'CACTUS_SMALL' }],
        speedPxS: 300,
        layer: { addChild() {}, removeChild() {} },
        createObstacle: (kind) => {
            const o = fakeObstacle(kind);
            const activate = o.activate;
            o.activate = (fadeIn) => { born.push(fadeIn); activate.call(o, fadeIn); };
            return o;
        },
    });
    for (let tau = 0; tau <= 31; tau += 1 / 60) spawner.tick(tau, 1 / 60, { width: 1280, groundY: 700 });
    assert.deepEqual(born, [true, false]);
});

test('el reloj de beat se ancla a los golpes reales y no acumula deriva', () => {
    // Golpes reales cada 0.5 s, pero el BPM detectado dice 0.505 s (1 % de
    // error, típico). Con fase global el error crecería sin parar.
    const anchors = [];
    for (let i = 0; i < 200; i++) anchors.push(3 + i * 0.5);
    const clock = createBeatClock(anchors, 0.505);
    for (let i = 0; i < 200; i++) {
        const phase = clock.phaseAt(anchors[i]);
        assert.ok(phase < 1e-9 || phase > 1 - 1e-9, `en el golpe ${i} la fase debería ser 0, fue ${phase}`);
    }
    // Antes del primer golpe también va en fase (anclado hacia atrás).
    assert.ok(Math.abs(createBeatClock(anchors, 0.5).phaseAt(3 - 0.5)) < 1e-9);
});

/** Obstáculo mínimo con la interfaz que el spawner espera, sin Pixi. */
function fakeObstacle(kind) {
    const def = OBSTACLE_KIND[kind];
    return {
        kind,
        x: 0,
        y: 0,
        visible: false,
        activate() { this.visible = true; },
        deactivate() { this.visible = false; },
        placeAt(x) { this.x = x; },
        animate() {},
        getHitbox() { return { x: this.x, y: this.y, w: def.w, h: def.h }; },
    };
}
