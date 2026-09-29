// Modelo del cielo y registro de escenas (T01): de una hora a lo que
// se ve, y el guardián de legibilidad a todas las horas de todas las escenas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rgbToOklab } from '../../resources/js/game/scenes/color.js';
import { createSkyState, phaseOfHour, skyColorAt, skyStateAt, sunElevation } from '../../resources/js/game/scenes/skyModel.js';
import { SKY_PALETTES } from '../../resources/js/game/scenes/palettes.js';
import { SKY_CYCLES } from '../../resources/js/game/scenes/skyClock.js';
import { SCENES, SKY_ELEMENTS, sceneElements } from '../../resources/js/game/scenes/registry.js';
import { READABILITY_RULES, checkReadability, playSubjects } from '../../resources/js/game/scenes/readability.js';
import { GROUND_OFFSET_PX, WORLD_VIEW } from '../../resources/js/game/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scene = SCENES.mountains;

test('el sol: arriba de día, bajo el horizonte de noche, en lo alto a mediodía', () => {
    for (let h = 7; h <= 18; h += 0.5) assert.ok(sunElevation(h, scene.sun) > 0, `${h}`);
    for (const h of [19, 21, 0, 3, 5.5]) assert.ok(sunElevation(h, scene.sun) < 0, `${h}`);
    const noon = (scene.sun.rise + scene.sun.set) / 2;
    assert.ok(Math.abs(sunElevation(noon, scene.sun) - scene.sun.maxElev) < 1e-9);
});

test('estrellas, luna y lucero: de noche sí, de día no', () => {
    const s = createSkyState();
    for (const h of [9, 12, 15, 16.5]) {
        skyStateAt(h, scene, s);
        assert.equal(s.stars.vis, 0, `estrellas a las ${h}`);
        assert.equal(s.moon.color[3], 0, `luna a las ${h}`);
        assert.equal(s.lucero[2], 0, `lucero a las ${h}`);
    }
    for (const h of [21, 23.5, 26]) {
        skyStateAt(h, scene, s);
        assert.equal(s.stars.vis, 1, `estrellas a las ${h}`);
        assert.ok(s.moon.color[3] > 0.99, `luna a las ${h}`);
        assert.ok(s.night > 0.99);
    }
    // El lucero de la tarde: el primer punto del cielo tras el ocaso.
    skyStateAt(19, scene, s);
    assert.ok(s.lucero[2] > 0.9);
});

test('la luna cruza el cielo de izquierda a derecha y el cielo estrellado gira', () => {
    const s = createSkyState();
    const xs = [];
    const rots = [];
    for (const h of [20, 23, 26, 29]) {
        skyStateAt(h, scene, s);
        xs.push(s.moon.pos[0]);
        rots.push(s.stars.rot);
    }
    for (let i = 1; i < xs.length; i++) {
        assert.ok(xs[i] > xs[i - 1], 'la luna avanza hacia la derecha');
        assert.ok(rots[i] > rots[i - 1], 'el cielo gira');
    }
    // Sale fuera de la columna del Dino (x ≈ 0.1-0.19).
    assert.ok(scene.moon.riseX > 0.25);
    // Un giro sutil: ~15° en doce horas de noche.
    assert.ok(Math.abs(scene.starRotPerHour * 12 - 0.25) < 0.05);
});

test('el menú: el sol synthwave asomando sobre las crestas y las primeras estrellas', () => {
    const s = createSkyState();
    skyStateAt(scene.menuHour, scene, s);
    assert.equal(phaseOfHour(scene.menuHour), 'sunset');
    assert.ok(s.elev > 2, 'el sol sigue por encima de la cordillera');
    assert.ok(s.sun.slits > 0.9, 'con sus rendijas');
    assert.ok(s.stars.vis > 0, 'y alguna estrella arriba');
});

test('el cielo cambia sin saltos: minuto a minuto, todo el día y el viaje de un nivel', () => {
    const s = createSkyState();
    const prev = { top: null, mid: null, horizon: null, far: null, cloudBody: null };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let worst = 0;
    for (let h = 0; h <= 31; h += 1 / 60) {
        skyStateAt(h, scene, s);
        const now = {
            top: rgbToOklab(s.sky.top), mid: rgbToOklab(s.sky.mid), horizon: rgbToOklab(s.sky.horizon),
            far: rgbToOklab(s.mountains.far), cloudBody: rgbToOklab(s.clouds.body),
        };
        for (const k of Object.keys(prev)) {
            if (prev[k] !== null) worst = Math.max(worst, dist(prev[k], now[k]));
            prev[k] = now[k];
        }
        for (const v of [s.sun.pos[0], s.sun.pos[1], s.moon.pos[0], s.moon.pos[1], s.stars.vis, s.lucero[2]]) {
            assert.ok(Number.isFinite(v), `valor no finito a las ${h}`);
        }
    }
    // En un minuto de cielo el color nunca se mueve más de 0.03 en OKLab (un salto
    // visible es del orden de 0.05). El minuto más rápido es el del ocaso.
    assert.ok(worst < 0.03, `salto de ${worst.toFixed(4)} en un minuto`);
});

test('el guardián de legibilidad: todo lo que se juega se lee a cualquier hora de cualquier escena', () => {
    const s = createSkyState();
    for (const sc of Object.values(SCENES)) {
        for (let h = 0; h <= 31; h += 0.05) {
            skyStateAt(h, sc, s);
            const fails = checkReadability(s, sc);
            assert.deepEqual(fails, [], `${sc.id} a las ${h.toFixed(2)}: ${JSON.stringify(fails[0])}`);
        }
    }
});

test('el guardián mide cada obstáculo del registro y detecta un cielo ilegible', () => {
    // Cada kind tiene su color: un obstáculo nuevo no se escapa del guardián.
    const subjects = playSubjects();
    assert.ok(subjects.some((x) => x.id === 'PTERO'));
    assert.ok(subjects.some((x) => x.id === 'CRYSTAL_CEIL'));
    // Un cielo pastel (como el de un día "de verdad") borra el cactus: el guardián lo ve.
    const s = createSkyState();
    skyStateAt(15, scene, s);
    s.sky.top.set([0.56, 0.77, 1]);
    s.sky.mid.set([0.56, 0.77, 1]);
    s.sky.horizon.set([0.56, 0.77, 1]);
    s.sky.haze[3] = 0;
    const fails = checkReadability(s, scene);
    assert.ok(fails.some((f) => f.subject.startsWith('CACTUS') && f.ratio < 1.2));
});

test('las nubes viven por encima del juego (y caben en la vista de siempre)', () => {
    const clouds = scene.layers.find((l) => l.type === 'clouds');
    const H = WORLD_VIEW.targetHeight;
    const groundY = H - GROUND_OFFSET_PX;
    // La nube más alta del arte (28×10 celdas) a la escala máxima.
    const maxCloudH = 10 * 4 * clouds.params.scale[1];
    const hi = Math.min(clouds.params.band[1] * H, groundY - clouds.params.clearancePx - maxCloudH);
    assert.ok(hi > clouds.params.band[0] * H, 'hay sitio para nubes en una pantalla 16:9');
    assert.ok(clouds.params.clearancePx > READABILITY_RULES.dinoTopPx, 'por encima de lo más alto que salta el Dino');
});

test('registro de escenas: paletas, ciclos, capas y elementos con nombre', () => {
    const layerTypes = readFileSync(path.join(ROOT, 'resources/js/game/entities/scenery/index.js'), 'utf8');
    for (const sc of Object.values(SCENES)) {
        assert.ok(SKY_PALETTES[sc.palette], `${sc.id}: paleta ${sc.palette}`);
        assert.ok(SKY_CYCLES[sc.cycle], `${sc.id}: ciclo ${sc.cycle}`);
        for (const l of sc.layers) {
            assert.match(layerTypes, new RegExp(`\\b${l.type}: create`), `${sc.id}: sin implementación para la capa "${l.type}"`);
        }
        const ids = sceneElements(sc).map((e) => e.id);
        assert.equal(new Set(ids).size, ids.length, `${sc.id}: ids repetidos`);
        for (const e of sceneElements(sc)) assert.ok(e.label.length > 0);
    }
    const slots = SKY_ELEMENTS.map((e) => e.slot);
    assert.equal(new Set(slots).size, slots.length);
    assert.ok(slots.every((x) => x >= 0 && x < 8));
});

test('el degradado CSS (reduced motion) sale del mismo cielo que el shader', () => {
    const s = createSkyState();
    skyStateAt(12, scene, s);
    const top = skyColorAt(s, 0);
    const bottom = skyColorAt(s, 1);
    assert.deepEqual([...top].map((v) => +v.toFixed(4)), [...s.sky.top].map((v) => +v.toFixed(4)));
    assert.ok(bottom.every((v) => v >= 0 && v <= 1));
});
