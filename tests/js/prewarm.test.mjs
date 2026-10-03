// Precalentado (T05.3): al empezar el intento se crea ya un obstáculo de cada tipo
// que trae el nivel, para que su primera vez no caiga a mitad de canción.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSpawner } from '../../resources/js/game/systems/spawner.js';
import { OBSTACLE_KIND } from '../../resources/js/game/config.js';

const VIEW = { width: 1100, groundY: 598 };

/** Una fábrica de obstáculos de mentira que apunta lo que crea y lo que enciende. */
function factory() {
    const log = { created: [], activated: 0, added: 0 };
    const createObstacle = (kind) => {
        const o = { kind, on: false, activate() { o.on = true; log.activated++; }, deactivate() { o.on = false; }, placeAt() {}, animate() {} };
        log.created.push(o);
        return o;
    };
    const layer = { addChild() { log.added++; }, removeChild() {} };
    return { log, createObstacle, layer };
}

const kinds = Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].trigger === undefined).slice(0, 4);
const events = [];
// Cada tipo, tres veces, bien separados: nunca hay dos del mismo a la vez en pantalla.
for (let i = 0; i < 12; i++) events.push({ t: 4 + i * 4, type: 'obstacle', kind: kinds[i % kinds.length] });

test('crea un obstáculo de cada tipo del nivel, apagado y ya en la escena', () => {
    const f = factory();
    const spawner = createSpawner({ events, speedPxS: 400, layer: f.layer, createObstacle: f.createObstacle });
    const made = spawner.prewarm();
    assert.deepEqual(made.map((o) => o.kind).sort(), [...kinds].sort());
    assert.equal(f.log.added, kinds.length, 'en la capa del juego: quien llama puede pintarlos');
    assert.ok(made.every((o) => o.on === false), 'apagados');
    assert.equal(spawner.getActive().length, 0);
    // Llamarlo otra vez no crea nada más.
    assert.deepEqual(spawner.prewarm(), []);
});

test('después, la partida no construye ninguno: usa los que ya están', () => {
    const f = factory();
    const spawner = createSpawner({ events, speedPxS: 400, layer: f.layer, createObstacle: f.createObstacle });
    spawner.prewarm();
    const before = f.log.created.length;
    for (let t = 0; t < 56; t += 1 / 60) spawner.tick(t, 1 / 60, VIEW);
    assert.equal(f.log.created.length, before, 'ni uno nuevo en toda la canción');
    assert.equal(f.log.activated, events.length, 'y salieron todos');

    // Sin precalentar, el primero de cada tipo se construía al asomar.
    const g = factory();
    const cold = createSpawner({ events, speedPxS: 400, layer: g.layer, createObstacle: g.createObstacle });
    for (let t = 0; t < 56; t += 1 / 60) cold.tick(t, 1 / 60, VIEW);
    assert.equal(g.log.created.length, kinds.length);
});

test('un nivel sin obstáculos no precalienta nada', () => {
    const f = factory();
    const spawner = createSpawner({ events: [{ t: 0, type: 'section', level: 1 }], speedPxS: 400, layer: f.layer, createObstacle: f.createObstacle });
    assert.deepEqual(spawner.prewarm(), []);
});
