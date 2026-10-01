// Historias de autor (T02.6, doc 11 §2.8-2.10): One Day. Sin Pixi ni DOM: el
// relato se coloca en su canción por la estructura del chart, el cielo lo cuenta
// por horas y el barco y el cabo siguen sus pistas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DROP_FX } from '../../resources/js/game/config.js';
import { WORLD_VIEW } from '../../resources/js/game/config.js';
import {
    CHILD_ROWS, SHIP_ROWS, SHIP_WATERLINE, STORY_CELL, STORY_SOLID_MATERIALS, WOMAN_ROWS,
    createStoryColors, storyColors,
} from '../../resources/js/game/entities/scenery/storyArt.js';
import { ISLAND_GROUPS, ISLAND_LIFT, ISLAND_YEARS, islandArt, islandLandAt, islandMaterialSpans, islandSurfRows, islandVisibleHeight } from '../../resources/js/game/entities/scenery/storyIsland.js';
import { ISLAND_INKS, ISLAND_MATERIAL_MAPS } from '../../resources/js/game/entities/scenery/storyIslandParts.js';
import { rgbToNumber } from '../../resources/js/game/scenes/color.js';
import { SCENES, sceneCycle } from '../../resources/js/game/scenes/registry.js';
import { planSky } from '../../resources/js/game/scenes/skyClock.js';
import { FLASH_GREEN, createSkyState, skyStateAt, sunLimbHour } from '../../resources/js/game/scenes/skyModel.js';
import { STORY_DEFS, bindStory, placeStory, songOutline, storyHour, trackAt } from '../../resources/js/game/scenes/stories/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BAKED = path.join(ROOT, 'database/seeds/official/baked');
const SCENE = SCENES['one-day'];
const STORY = SCENE.story;

function official(slug) {
    const j = JSON.parse(readFileSync(path.join(BAKED, `${slug}.json`), 'utf8'));
    return {
        sections: j.chart.events.filter((e) => e.type === 'section'),
        fx: j.chart.events.filter((e) => e.type === 'fx'),
        durationSec: j.audio.durationSec,
    };
}

const near = (actual, expected, tol, label = '') => assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `${label} esperaba ${expected} ± ${tol}, salió ${actual}`,
);

/** Cuánto dura (s de canción) un destello verde y dónde está su pico, muestreando el plan. */
function flashes(plan, D) {
    const s = createSkyState();
    const out = [];
    let cur = null;
    for (let t = 0; t <= D; t += 0.02) {
        const f = skyStateAt(plan.hourAt(t), SCENE, s).sun.flash;
        if (f > 0.05) {
            if (cur === null) cur = { t0: t, t1: t, peak: f, at: t };
            cur.t1 = t;
            if (f > cur.peak) Object.assign(cur, { peak: f, at: t });
        } else if (cur !== null) {
            out.push(cur);
            cur = null;
        }
    }
    if (cur !== null) out.push(cur);
    return out;
}

test('One Day: el relato cae en su canción (la despedida en el drop, el regreso en la última gran subida)', () => {
    const input = official('one-day');
    const plan = planSky(input, sceneCycle(SCENE));
    const at = Object.fromEntries(plan.story.moments.map((m) => [m.id, m.t]));
    // Instantes medidos en el chart horneado (charter 12): la primera subida, la
    // subida hacia el drop, el drop (inicio del clímax), el límite de sección de
    // la orquesta y la coda en re mayor.
    near(at.day, 0, 0.001, 'el día');
    near(at.departure, 35.4, 0.05, 'la partida');
    near(at.touch, 55, 0.05, 'el sol toca el mar');
    near(at.farewell, 63.12, 0.05, 'la despedida');
    near(at.dawn, at.return - 11, 0.001, 'diez años después');
    near(at.return, 99.2, 0.05, 'el regreso');
    near(at.home, 132.34, 0.05, 'rumbo a casa');
    near(at.end, input.durationSec, 0.001, 'el final');
    assert.equal(plan.story.id, 'one-day');
    // Los rótulos, con su momento.
    assert.deepEqual(plan.story.captions.map((c) => c.text), ['Un día en tierra, diez años en el mar.', 'No pierdas de vista el horizonte.']);
    near(plan.story.captions[0].t, 5, 0.001);
    // El primer destello se puede mirar: ningún obstáculo en su respiro, y los vecinos siguen.
    const acts = JSON.parse(readFileSync(path.join(BAKED, 'one-day.json'), 'utf8')).chart.events.filter((e) => e.type === 'obstacle').map((e) => e.t);
    assert.equal(acts.filter((t) => t >= at.farewell - 1 && t < at.farewell + 2).length, 0, 'un obstáculo en el destello');
    assert.ok(acts.some((t) => t >= at.farewell - 3 && t < at.farewell - 1) && acts.some((t) => t >= at.farewell + 2 && t < at.farewell + 4), 'los de antes y después siguen');
    // "No pierdas de vista el horizonte": con el sol tocando el mar, y se ha ido antes del destello.
    near(plan.story.captions[1].t, at.touch, 0.001);
    assert.ok(plan.story.captions[1].t + plan.story.captions[1].holdS <= plan.story.holds[0].t0 + 1e-9, 'el rótulo no pisa el destello');
});

test('One Day: el cielo nunca retrocede y pasa por cada momento a su hora', () => {
    const input = official('one-day');
    const plan = planSky(input, sceneCycle(SCENE));
    let prev = -Infinity;
    for (let t = 0; t <= input.durationSec; t += 0.05) {
        const h = plan.hourAt(t);
        assert.ok(h >= prev - 1e-9, `retrocede en ${t.toFixed(2)} s`);
        prev = h;
    }
    for (const m of plan.story.moments) near(plan.hourAt(m.t), m.hour, 1e-6, m.id);
    // La noche cae con la despedida y el alba llega con "Diez años después".
    near(plan.events.nightfall, plan.story.moments.find((m) => m.id === 'farewell').t, 0.001);
    near(plan.events.dawnStart, plan.story.moments.find((m) => m.id === 'dawn').t, 0.001);
});

test('One Day: dos destellos verdes de segundos (cámara lenta), en la despedida y en el regreso', () => {
    const input = official('one-day');
    const plan = planSky(input, sceneCycle(SCENE));
    const at = Object.fromEntries(plan.story.moments.map((m) => [m.id, m.t]));
    const found = flashes(plan, input.durationSec);
    assert.equal(found.length, 2, JSON.stringify(found));
    const [setFlash, riseFlash] = found;
    for (const [f, moment] of [[setFlash, at.farewell], [riseFlash, at.return]]) {
        assert.ok(f.peak > 0.95, `pico ${f.peak}`);
        near(f.at, moment, 0.5, 'el pico cae en su momento');
        const dur = f.t1 - f.t0;
        assert.ok(dur >= 2.5 && dur <= 8, `dura ${dur.toFixed(2)} s`);
    }
    // Las ventanas de cámara lenta (donde los efectos se apartan) contienen su destello.
    for (const [hold, f] of [[plan.story.holds[0], setFlash], [plan.story.holds[1], riseFlash]]) {
        assert.ok(hold.t0 <= f.at && f.at <= hold.t1, `${hold.id}: ${hold.t0}-${hold.t1} no contiene ${f.at}`);
    }
});

test('el destello verde solo existe en las escenas que lo piden, y su verde es uno solo', () => {
    const s = createSkyState();
    for (const scene of Object.values(SCENES)) {
        if (scene.greenFlash) continue;
        for (let h = 12; h <= 36; h += 0.01) {
            assert.equal(skyStateAt(h, scene, s).sun.flash, 0, `${scene.id} a las ${h.toFixed(2)}`);
        }
    }
    // El drop que cae en el destello destella con el mismo verde que pinta el shader.
    assert.equal(DROP_FX.greenFlashColor, rgbToNumber(FLASH_GREEN));
});

test('el filo del sol: la hora del destello es la del último (o primer) instante en que se ve', () => {
    const set = sunLimbHour(SCENE, 'set');
    const rise = sunLimbHour(SCENE, 'rise');
    assert.ok(set > SCENE.sun.set && set < SCENE.sun.set + 2, `puesta ${set}`);
    assert.ok(rise < SCENE.sun.rise && rise > SCENE.sun.rise - 2, `salida ${rise}`);
    const s = createSkyState();
    // En ese instante el destello está en su pico; media hora antes o después, nada.
    assert.ok(skyStateAt(set, SCENE, s).sun.flash > 0.99);
    assert.ok(skyStateAt(rise, SCENE, s).sun.flash > 0.99);
    for (const h of [set - 0.5, set + 0.5, rise - 0.5, rise + 0.5]) assert.equal(skyStateAt(h, SCENE, s).sun.flash, 0);
    // Y la historia ligada a la escena usa esas horas.
    near(STORY.moments.find((m) => m.id === 'farewell').hour, storyHour(set), 1e-9);
    near(STORY.moments.find((m) => m.id === 'return').hour, storyHour(rise), 1e-9);
});

test('el barco: se va con el sol, no se ve en los diez años y vuelve emergiendo con las luces encendidas', () => {
    const ship = STORY.tracks.ship;
    const hour = (id) => STORY.moments.find((m) => m.id === id).hour;
    // A flote hasta que toca el sol; hundido del todo en la despedida y toda la noche.
    assert.equal(trackAt(ship.sink, hour('day')), 0);
    assert.equal(trackAt(ship.sink, hour('touch')), 0);
    for (let h = hour('farewell'); h <= hour('return'); h += 0.25) assert.equal(trackAt(ship.sink, h), 1, `a las ${h}`);
    assert.equal(trackAt(ship.sink, hour('return') + 0.2), 0);
    // Se va hacia el sol (proa a la derecha) y vuelve hacia el cabo (a la izquierda).
    assert.equal(trackAt(ship.dir, hour('touch')), 1);
    assert.equal(trackAt(ship.dir, hour('return')), -1);
    assert.ok(trackAt(ship.x, hour('touch')) > trackAt(ship.x, hour('day')));
    assert.ok(trackAt(ship.x, hour('end')) < trackAt(ship.x, hour('return')));
    // El agua solo al emerger; las luces de popa, con el regreso y hasta la mañana.
    assert.equal(trackAt(ship.spray, hour('farewell')), 0);
    assert.ok(trackAt(ship.spray, hour('return') + 0.05) > 0.5);
    assert.equal(trackAt(ship.spray, hour('home')), 0);
    assert.equal(trackAt(ship.lamp, hour('touch')), 0);
    assert.equal(trackAt(ship.lamp, hour('return') + 0.2), 1);
    assert.equal(trackAt(ship.lamp, hour('end')), 0);
});

test('la isla: el farol arde de noche y se aviva al ver el barco; el hijo está desde "Diez años después"', () => {
    const cliff = STORY.tracks.cliff;
    const hour = (id) => STORY.moments.find((m) => m.id === id).hour;
    assert.equal(trackAt(cliff.lantern, hour('day')), 0);
    assert.equal(trackAt(cliff.lantern, 23), 1);
    assert.equal(trackAt(cliff.lantern, hour('dawn')), 1);
    assert.equal(trackAt(cliff.lantern, hour('home')), 0);
    assert.equal(trackAt(cliff.child, hour('farewell')), 0);
    assert.equal(trackAt(cliff.child, 23), 0);
    assert.equal(trackAt(cliff.child, hour('dawn') + 0.01), 1);
    assert.equal(trackAt(cliff.flare, hour('dawn')), 0);
    // Las ventanas, el humo y el faro: apagados de día, encendidos del ocaso a la mañana.
    assert.equal(trackAt(cliff.lights, hour('day')), 0);
    assert.equal(trackAt(cliff.lights, hour('farewell') + 0.2), 1);
    assert.equal(trackAt(cliff.lights, 24), 1);
    assert.equal(trackAt(cliff.lights, hour('home')), 0);
    assert.ok(trackAt(cliff.flare, hour('return') + 0.06) > 0.99);
    // El borde del cabo se aleja despacio, nunca hacia el sol.
    assert.ok(trackAt(cliff.x, hour('end')) < trackAt(cliff.x, hour('day')));
});

test('pistas: lineales entre claves, planas fuera, un salto con dos claves a la misma hora', () => {
    const track = [[18, 0], [20, 1], [20, -1], [22, 1]];
    assert.equal(trackAt(track, 17), 0);
    assert.equal(trackAt(track, 19), 0.5);
    assert.equal(trackAt(track, 20.5), -0.5);
    assert.equal(trackAt(track, 30), 1);
    // Horas de la madrugada: las 5:00 son las 29 de la historia.
    assert.equal(trackAt([[28, 0], [30, 1]], 5), 0.5);
    assert.equal(trackAt([], 12), 0);
});

test('ligar una historia: momentos en orden, pistas que no retroceden y nombres que existen', () => {
    const def = STORY_DEFS['one-day'];
    assert.throws(() => bindStory({ ...def, moments: [...def.moments].reverse() }, SCENE), /no va después/);
    assert.throws(() => bindStory({ ...def, tracks: { ship: { x: [['farewell', 0], ['day', 1]] } } }, SCENE), /retrocede/);
    assert.throws(() => bindStory({ ...def, tracks: { ship: { x: [['nadie', 0]] } } }, SCENE), /desconocido/);
    assert.throws(() => bindStory({ ...def, epilogueHour: { foo: 1 } }, SCENE), /desconocido|inválida/);
});

test('la historia se coloca sin romperse en cualquier canción (los demás oficiales y estructuras raras)', () => {
    const inputs = readdirSync(BAKED).filter((f) => f.endsWith('.json')).map((f) => [f, official(f.replace('.json', ''))]);
    inputs.push(
        ['sin secciones', { durationSec: 150, sections: [], fx: [] }],
        ['muy corta', { durationSec: 9, sections: [{ t: 0 }], fx: [] }],
        ['corta', { durationSec: 40, sections: [{ t: 0 }, { t: 18 }], fx: [{ t: 18, fx: 'drop' }] }],
        ['larga', { durationSec: 420, sections: [0, 60, 120, 180, 240, 300, 360].map((t) => ({ t })), fx: [{ t: 240, fx: 'drop' }] }],
        ['drop al principio', { durationSec: 120, sections: [{ t: 0 }, { t: 3 }], fx: [{ t: 3, fx: 'drop' }] }],
    );
    for (const [label, input] of inputs) {
        const placed = placeStory(STORY, songOutline(input));
        const D = input.durationSec;
        const ts = placed.moments.map((m) => m.t);
        assert.equal(ts[0], 0, label);
        assert.ok(Math.abs(ts.at(-1) - D) < 1e-9, label);
        for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1], `${label}: ${placed.moments[i].id} no va después`);
        for (let i = 1; i < placed.anchors.length; i++) {
            assert.ok(placed.anchors[i].t > placed.anchors[i - 1].t, `${label}: anclas en orden`);
            assert.ok(placed.anchors[i].hour > placed.anchors[i - 1].hour, `${label}: el cielo avanza`);
        }
        for (const c of placed.captions) assert.ok(c.t >= 0 && c.t + c.holdS <= D + 1e-9, `${label}: rótulo dentro`);
        for (const h of placed.holds) assert.ok(h.t0 >= 0 && h.t0 <= h.t && h.t <= h.t1 && h.t1 <= D, `${label}: ventana ${JSON.stringify(h)}`);
        // Y el plan del cielo entero sale bien.
        const plan = planSky(input, sceneCycle(SCENE));
        assert.ok(Number.isFinite(plan.hourAt(D / 2)), label);
    }
});

test('la isla: una costa cercana, verde y habitada, con las figuras en el borde y el farol en su mano', () => {
    const art = islandArt();
    const sameWidth = (rows) => rows.every((r) => r.length === rows[0].length);
    assert.ok(sameWidth(SHIP_ROWS));
    assert.ok(SHIP_WATERLINE > 0 && SHIP_WATERLINE < SHIP_ROWS.length);
    // Cada grupo del dibujo, del tamaño de la isla y solo con tintas conocidas.
    assert.deepEqual(Object.keys(art.groups), [...ISLAND_GROUPS]);
    for (const [id, grid] of [...Object.entries(art.groups), ...Object.entries(art.lights)]) {
        assert.equal(grid.length, art.height, id);
        assert.ok(grid.every((r) => r.length === art.width), id);
    }
    const count = (grid, material) => grid.reduce((n, r) => n + [...r].filter((c) => ISLAND_INKS[c]?.[0] === material).length, 0);
    for (const [id, grid] of Object.entries(art.groups)) {
        const unknown = new Set(grid.flatMap((r) => [...r].filter((c) => c !== '.' && ISLAND_INKS[c] === undefined)));
        assert.deepEqual([...unknown], [], `${id}: tintas sin material`);
    }
    for (const grid of Object.values(art.lights)) assert.ok(grid.every((r) => /^[.L]*$/.test(r)));
    assert.equal(islandArt(), art, 'el dibujo es siempre el mismo (se calcula una vez)');
    for (const frames of [WOMAN_ROWS, CHILD_ROWS, ...Object.values(art.palmFrames)]) {
        for (const fr of frames) {
            assert.ok(sameWidth(fr));
            assert.equal(fr.length, frames[0].length);
            assert.equal(fr[0].length, frames[0][0].length);
        }
    }
    // Pies en la tierra: bajo la última fila de cada figura hay tierra.
    for (const [rows, [x0, y0]] of [[WOMAN_ROWS[0], art.spots.woman], [CHILD_ROWS[0], art.spots.child]]) {
        const bottom = y0 + rows.length - 1;
        const feet = [...rows.at(-1)].map((c, i) => (c !== '.' ? x0 + i : null)).filter((x) => x !== null);
        assert.ok(feet.some((x) => islandLandAt(x, bottom) || islandLandAt(x, bottom + 1)), `pies en el aire en la fila ${bottom}`);
    }
    // El farol, junto a la mano de ella; ella, en el borde del cabo.
    const [lx, ly] = art.spots.lamp;
    const [wx, wy] = art.spots.woman;
    const touches = WOMAN_ROWS[0].some((r, y) => [...r].some((c, x) => c !== '.' && Math.abs(wx + x + 0.5 - lx) <= 1.5 && Math.abs(wy + y + 0.5 - ly) <= 1.5));
    assert.ok(touches, 'el farol no está en su mano');
    assert.ok(art.wall - (wx + WOMAN_ROWS[0][0].length) < 12, 'ella está en el borde');

    // No es una roca gris (playtest: "se siente a muy rocoso", "desértica"): la
    // tierra es sobre todo hierba, con tierra a la vista, y la roca es la menor parte.
    const land = art.groups.land;
    const [grass, earth, rock] = ['grass', 'earth', 'rock'].map((m) => count(land, m));
    assert.ok(grass > rock && earth > 0, `hierba ${grass}, tierra ${earth}, roca ${rock}`);
    assert.ok(rock / (grass + earth + rock) < 0.4, 'la roca, menos del 40 % de la tierra');
    // Habitada: el faro con su linterna; una casa que no es una caja (muro, tejado,
    // madera y varias ventanas, cada una con su cruceta); árboles que la arropan;
    // un palmeral con formas distintas; arbustos, cerca y bote delante.
    assert.ok(count(art.groups.lighthouse, 'tower') > 0 && art.lights.lighthouse.some((r) => r.includes('L')));
    for (const m of ['wall', 'roof', 'wood', 'dark']) assert.ok(count(art.groups.home, m) > 0, `la casa sin ${m}`);
    const litRows = art.lights.home.filter((r) => r.includes('L'));
    const litRuns = new Set(litRows.flatMap((r) => [...r.matchAll(/L+/g)].map((m) => m.index)));
    assert.ok(litRuns.size >= 6, `${litRuns.size} cristales encendidos en la casa`);
    assert.ok(count(art.groups.back, 'leaf') > 300, 'árboles detrás de la casa');
    assert.ok(count(art.groups.front, 'leaf') > 0 && count(art.groups.front, 'wood') > 0);
    assert.ok(art.palms.length >= 5 && new Set(art.palms.map((p) => p.kind)).size >= 3, 'un palmeral, no dos palmeras iguales');
    // Ninguna palmera pegada a la casa (playtest: "puestas con calzador").
    const homeCols = art.groups.home.flatMap((r) => [...r].map((c, x) => (c !== '.' ? x : -1)).filter((x) => x >= 0));
    const homeLeft = Math.min(...homeCols);
    for (const p of art.palms) assert.ok(p.x + art.palmFrames[p.kind][0][0].length < homeLeft - 40, 'una palmera junto a la casa');
    // Diez años: plantones antes; después, árboles crecidos, hiedra, columpio y otro bote.
    for (const id of ISLAND_YEARS.early) assert.ok(count(art.groups[id], 'leaf') > 0, id);
    assert.ok(count(art.groups.backLate, 'leaf') > 300 && count(art.groups.frontLate, 'leaf') > 60 && count(art.groups.frontLate, 'wood') > 20, 'la isla de diez años después');
    assert.equal(trackAt(STORY.tracks.cliff.years, STORY.moments.find((m) => m.id === 'farewell').hour), 0);
    assert.equal(trackAt(STORY.tracks.cliff.years, STORY.moments.find((m) => m.id === 'dawn').hour), 1);
    // Cada material tiene con qué pintarse.
    for (const material of STORY_SOLID_MATERIALS) assert.ok(ISLAND_MATERIAL_MAPS[material] !== undefined, material);

    // Las proporciones: el faro es más alto que la casa, la casa que ella y ella que el niño.
    const spans = islandMaterialSpans();
    const towerH = spans.tower[1] - spans.tower[0];
    const houseH = spans.roof[1] - spans.wall[0];
    const womanH = WOMAN_ROWS[0].length * STORY_CELL;
    assert.ok(towerH > houseH && houseH > womanH && womanH > CHILD_ROWS[0].length * STORY_CELL, `faro ${towerH}, casa ${houseH}, ella ${womanH}`);
    // La perspectiva: la isla está cerca (su pie, junto a la orilla, muy por debajo
    // del horizonte de la escena), así que ella puede ser casi tan alta como el barco lejano.
    assert.ok(ISLAND_LIFT < SCENE.horizonRise / 2);
    assert.ok(ISLAND_LIFT + islandVisibleHeight() > SCENE.horizonRise + 100, 'la isla sube bien por encima del horizonte');
    // La tierra llega al borde izquierdo de cualquier pantalla, con el cabo donde más a la derecha esté.
    const maxX = Math.max(...STORY.tracks.cliff.x.map(([, v]) => v));
    assert.ok(art.wall * STORY_CELL >= maxX * WORLD_VIEW.maxWidth, 'la isla se acaba antes del borde izquierdo en una pantalla ancha');
    // La espuma del pie, del ancho de la isla.
    for (const fr of [0, 1]) {
        const rows = islandSurfRows(fr);
        assert.equal(rows.length, 3);
        assert.ok(rows.every((r) => r.length === art.width));
    }
    assert.deepEqual(Object.keys(spans).sort(), [...STORY_SOLID_MATERIALS].sort());
});

test('los materiales de la historia salen de la luz de cada hora y no se salen de [0, 1]', () => {
    const s = createSkyState();
    const c = createStoryColors();
    for (let h = 12; h <= 36; h += 0.25) {
        storyColors(skyStateAt(h, SCENE, s), c);
        for (const k of ['hull', 'sail', 'dark', ...STORY_SOLID_MATERIALS]) {
            assert.ok(c[k].every((v) => v >= 0 && v <= 1), `${k} a las ${h}`);
        }
    }
    // De día la hierba es verde y la vela, lona; de noche, todo silueta.
    storyColors(skyStateAt(15, SCENE, s), c);
    assert.ok(c.grass[1] > c.grass[0] && c.grass[1] > c.grass[2], 'hierba verde de día');
    assert.ok(c.sail[0] > c.sail[2], 'lona cálida de día');
    const day = Math.max(...c.rock);
    storyColors(skyStateAt(24, SCENE, s), c);
    assert.ok(Math.max(...c.rock) < day, 'la roca se oscurece de noche');
});
