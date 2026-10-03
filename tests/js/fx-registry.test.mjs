// Registro de efectos (T03.1, doc 11): un efecto es una entrada, y no entra sin su
// familia, su plano, su coste y su protección de lo que se juega. La escena manda
// sobre los efectos (su política `fx`) y el shader solo compone cantidades.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_FX_PREF, FX, FX_COLORS, FX_COSTS, FX_FAMILIES, FX_GUARDS, FX_IDS, FX_PREFS,
} from '../../resources/js/game/fx/registry.js';
import { policyIssues, sceneFxPolicy } from '../../resources/js/game/fx/policy.js';
import { createFxSignals } from '../../resources/js/game/fx/signals.js';
import { SKY_FX, createSkyAmounts, skyAmounts } from '../../resources/js/game/fx/skyAmounts.js';
import { QUALITY_TIERS, resolveBudget } from '../../resources/js/game/RenderProfile.js';
import { SCENES, sceneElements } from '../../resources/js/game/scenes/registry.js';
import { FX_LEVEL_VALUES, getFxLevel, setFxLevel } from '../../resources/js/ui/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLANES = ['sky', 'scenery', 'ground', 'world', 'screen', 'game'];

test('cada efecto tiene nombre, familia, plano, coste y protección', () => {
    assert.ok(FX_IDS.length >= 14);
    const labels = new Set();
    for (const id of FX_IDS) {
        const def = FX[id];
        assert.ok(typeof def.label === 'string' && def.label.length > 3, `${id}: sin nombre`);
        assert.ok(!labels.has(def.label), `${id}: nombre repetido "${def.label}"`);
        labels.add(def.label);
        assert.ok(Object.hasOwn(FX_FAMILIES, def.family), `${id}: familia ${def.family}`);
        assert.ok(PLANES.includes(def.plane), `${id}: plano ${def.plane}`);
        assert.ok(FX_COSTS.includes(def.cost), `${id}: coste ${def.cost}`);
        assert.ok(FX_GUARDS.includes(def.guard), `${id}: protección ${def.guard}`);
        if (def.when !== undefined) assert.ok(typeof def.whenWhy === 'string', `${id}: condición sin motivo para el panel`);
        if (def.arc !== undefined) assert.ok(def.arc[0] < def.arc[1], `${id}: arco`);
        // Lo que pinta el shader dentro del cielo y suma luz pasa por el limitador;
        // lo que es del juego no lo toca nadie.
        if (def.family === 'game') assert.equal(def.guard, 'game', `${id}`);
        if (def.screen === true) assert.notEqual(def.base, true, `${id}: un efecto de pantalla no puede ser esencial`);
    }
});

test('familias: el espectro y la firma son huecos de uno; la del juego no la toca ni la escena', () => {
    assert.equal(FX_FAMILIES.spectrum.exclusive, true);
    assert.equal(FX_FAMILIES.signature.exclusive, true);
    assert.equal(FX_FAMILIES.game.fixed, true);
    // Hoy hay un solo efecto de espectro: cada escena lo pinta con su paisaje.
    assert.deepEqual(FX_IDS.filter((id) => FX[id].family === 'spectrum'), ['spectrum']);
    // El espectro lo pone la escena; la firma, la canción (T03.3): es la única
    // familia que se reparte.
    assert.deepEqual(Object.keys(FX_FAMILIES).filter((f) => FX_FAMILIES[f].cast === true), ['signature']);
    const policy = sceneFxPolicy({ fx: { allow: [] } });
    for (const id of FX_IDS) assert.equal(policy.allows(id), FX[id].family === 'game', id);
});

test('preferencias del jugador: las tres de AJUSTES, y Mínimos deja solo lo esencial', () => {
    assert.deepEqual(Object.keys(FX_PREFS), [...FX_LEVEL_VALUES], 'settings.js y el registro dicen lo mismo');
    assert.ok(Object.hasOwn(FX_PREFS, DEFAULT_FX_PREF));
    for (const [id, p] of Object.entries(FX_PREFS)) {
        assert.ok(p.label.length > 3 && p.gain > 0 && p.gain <= 1, id);
        for (const fx of p.only ?? []) {
            assert.ok(Object.hasOwn(FX, fx), `${id}: efecto desconocido ${fx}`);
            assert.equal(FX[fx].base, true, `${id}: "${fx}" no es esencial`);
        }
    }
    assert.equal(FX_PREFS.full.screen, true);
    assert.equal(FX_PREFS.soft.screen, false);
    assert.ok(FX_PREFS.soft.gain < 1);
    assert.ok(FX_PREFS.min.only.includes('groundPulse') && FX_PREFS.min.only.includes('speedLines'));
});

test('por defecto, Completos: solo cuenta lo que el jugador elija en el ajuste (el interruptor antiguo no deja a nadie sin efectos)', () => {
    const store = new Map();
    const events = [];
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
    };
    globalThis.window = { dispatchEvent: (e) => events.push(e) };
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    try {
        assert.equal(getFxLevel(), 'full', 'sin nada guardado');
        // En el playtest, quien tenía marcado "Reducir efectos visuales" (que solo
        // apagaba los relámpagos) se quedó sin ningún efecto de la música.
        store.set('daino:reduce_effects', 'true');
        assert.equal(getFxLevel(), 'full', 'el interruptor de antes de la T03.1 ya no se lee');
        store.set('daino:fx_level', 'raro');
        assert.equal(getFxLevel(), 'full', 'un valor desconocido');
        setFxLevel('soft');
        assert.equal(getFxLevel(), 'soft');
        assert.equal(store.has('daino:reduce_effects'), false, 'al elegir, la clave antigua se borra');
        assert.equal(events.at(-1).detail.level, 'soft');
        setFxLevel('min');
        assert.equal(getFxLevel(), 'min', 'quien elige Mínimos, los tiene');
    } finally {
        delete globalThis.localStorage;
        delete globalThis.window;
        delete globalThis.CustomEvent;
    }
});

test('cada tier de calidad dice hasta qué coste pinta; el bajo, solo lo barato', () => {
    for (const [tier, q] of Object.entries(QUALITY_TIERS)) assert.ok(FX_COSTS.includes(q.fxCost), tier);
    assert.equal(resolveBudget('PLAYING', 'high').fxCost, 'heavy');
    assert.equal(resolveBudget('PLAYING', 'low').fxCost, 'cheap');
});

test('la política de efectos de cada escena es válida; un ambiente solo veta las firmas del cielo si lo cierra, y One Day declara lo suyo', () => {
    for (const sc of Object.values(SCENES)) {
        assert.deepEqual(policyIssues(sc), [], `${sc.id}: ${policyIssues(sc).join('; ')}`);
        if (sc.kind !== 'ambient') continue;
        // Con lluvia el cielo está cerrado: sin aurora ni lluvia de estrellas (T03.3).
        // Los demás ambientes no declaran nada.
        const rains = sc.layers.some((l) => l.type === 'rain');
        assert.deepEqual(sc.fx, rains ? { denyFamilies: ['signature'] } : undefined, `${sc.id}`);
        const policy = sceneFxPolicy(sc);
        for (const id of FX_IDS) assert.equal(policy.allows(id), !(rains && FX[id].family === 'signature'), `${sc.id}: ${id}`);
    }
    assert.equal(policyIssues({ fx: { denyFamilies: ['nada', 'game'] } }).length, 2);
    assert.deepEqual(policyIssues({ fx: { deny: ['noExiste'], hush: ['nada'], temper: 2, colors: { warm: 'rojo', cool: '#fff' } } }).length, 5);
    assert.deepEqual(policyIssues({ fx: { temper: { game: 0.5, nada: 0.5, pulse: 3 } } }).length, 3);

    const story = sceneFxPolicy(SCENES['one-day']);
    // Lo esencial…
    for (const id of ['groundPulse', 'starPulse', 'dropFlash', 'dropWave', 'breakCalm', 'speedLines']) assert.ok(story.allows(id), id);
    // …y nada que toque su horizonte, su sol, su mar ni su barco.
    for (const id of ['horizonGlow', 'sunPulse', 'sunGlow', 'spectrum', 'beatPump', 'ridgePulse', 'motes', 'climaxTint', 'keyHue', 'aurora', 'meteors']) {
        assert.equal(story.allows(id), false, `One Day no permite "${id}"`);
    }
    assert.ok(story.temperOf('pulse') < 1, 'lo que late, suave');
    assert.equal(story.temperOf('moment'), 1, 'el momento del drop, entero: cae en el destello verde');
    assert.ok(story.colors !== null && story.colors.warm.length === 3, 'con los colores de su escena');
    assert.ok(story.hushes('air'));
    // El rebote de los obstáculos es del juego.
    assert.ok(story.allows('obstacleBounce'));

    // Un ambiente: todo vale, con los colores de siempre.
    const ambient = sceneFxPolicy(SCENES.mountains);
    for (const id of FX_IDS) assert.ok(ambient.allows(id), id);
    assert.equal(ambient.colors, null);
    assert.equal(ambient.temperOf('pulse'), 1);
    assert.equal(sceneFxPolicy({ fx: { temper: 0.4 } }).temperOf('air'), 0.4, 'un número atenúa todas las familias');
});

test('el espectro tiene sitio en cada ambiente: barras tras una silueta o el mar; y un nombre en el panel dev', () => {
    for (const sc of Object.values(SCENES)) {
        const bars = sc.layers.filter((l) => l.type === 'spectrum');
        const sea = sc.layers.some((l) => l.type === 'sea');
        if (sc.kind === 'ambient') assert.ok(bars.length === 1 || sea, `${sc.id}: sin sitio para el espectro`);
        for (const b of bars) {
            const hostIdx = sc.layers.findIndex((l) => l.id === b.params.host);
            assert.ok(hostIdx >= 0, `${sc.id}: la anfitriona "${b.params.host}" no existe`);
            assert.ok(sc.layers.indexOf(b) < hostIdx, `${sc.id}: las barras van DETRÁS de su anfitriona`);
            assert.ok(['ridge', 'skyline'].includes(sc.layers[hostIdx].type), `${sc.id}: la anfitriona tiene silueta`);
        }
        const ids = sceneElements(sc).map((e) => e.id);
        if (bars.length > 0) assert.ok(ids.includes('spectrumBars'), sc.id);
        // El "espectro del suelo" de la primera versión se leyó como un error
        // ("barras debajo del suelo") y ya no existe.
        assert.ok(!ids.includes('groundSpectrum'), sc.id);
    }
    // Una historia no tiene barras: su horizonte es suyo.
    assert.equal(SCENES['one-day'].layers.some((l) => l.type === 'spectrum'), false);
});

test('el shader solo compone: recibe cantidades, sin señales del audio, y lo que suma luz pasa por el limitador', () => {
    const frag = readFileSync(path.join(ROOT, 'resources/js/game/shaders/background.frag'), 'utf8');
    const code = frag.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const gone of ['uBass', 'uMid', 'uHigh', 'uRMS', 'uBpmPulse', 'uIntensity', 'uClimax', 'uFlash', 'uBuild', 'uCalm', 'uHue', 'hueShift', 'uGround']) {
        assert.ok(!new RegExp(`\\b${gone}\\b`).test(code), `el shader aún usa ${gone}`);
    }
    assert.match(code, /col = fxLimit\(col, col \+ uFxWarm \* uFxA\.x/, 'el tinte del clímax pasa por el limitador');
    assert.match(code, /col = fxLimit\(col, col \+ uSunGlow\.rgb \* exp\(-d \* 9\.0\) \* uFxA\.w/, 'el halo del sol pasa por el limitador');
    assert.match(code, /col = fxLimit\(col, lit, fxW\)/, 'el brillo del horizonte pasa por el limitador');
    // El bombeo solo oscurece: no suma luz, así que no necesita limitador.
    assert.match(code, /col \*= 1\.0 - uFxB\.w;/, 'el bombeo del cielo oscurece entre golpes');
    assert.ok(code.indexOf('col *= 1.0 - uFxB.w;') < code.indexOf('uStarVis > 0.001'), 'respira el cielo, no los astros: va antes de las estrellas, la luna y el sol');
    assert.ok(!/1\.0 \+ uFxB\.w/.test(code), 'el bombeo ya no aclara');
    // La calma del break: los mismos números que su espejo en JS.
    const C = SKY_FX.breakCalm;
    assert.ok(code.includes(`vec3(${C.tint.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))).join(', ')}), ${C.desaturate} * calm) * (1.0 - ${C.darken} * calm)`), 'calma del break distinta del espejo');
    // Y los uniforms que declara son los que sube la fábrica del filtro.
    const filter = readFileSync(path.join(ROOT, 'resources/js/game/shaders/audioFilter.js'), 'utf8');
    for (const u of ['uFxA', 'uFxB', 'uFxC', 'uFxD', 'uFxWarm', 'uFxCool', 'uFxBand']) {
        assert.ok(new RegExp(`uniform \\w+\\s+${u};`).test(frag), `falta ${u} en el shader`);
        assert.ok(filter.includes(`${u}:`), `falta ${u} en audioFilter.js`);
    }
});

test('cantidades del cielo: sin música, cero; con ella, lo de siempre; un efecto apagado no pinta', () => {
    // Las firmas (aurora, lluvia de estrellas) tienen su test: fx-signatures.test.mjs.
    const levels = Object.fromEntries(FX_IDS.map((id) => [id, FX[id].family === 'signature' ? 0 : 1]));
    const s = createFxSignals();
    const out = createSkyAmounts();
    // Sin efectos (el menú: el director los deja a cero) no hay nada que componer.
    skyAmounts(Object.fromEntries(FX_IDS.map((id) => [id, 0])), s, out);
    assert.deepEqual([...out.a], [0, 0, 0, 0]);
    assert.equal(out.b[0], 0);
    assert.equal(out.b[1], 0);
    assert.equal(out.b[3], 0);
    assert.deepEqual([...out.c], [0, 0, 0, 0]);
    // Con efectos pero en silencio, lo único que queda es el cielo en su punto
    // bajo, esperando el golpe.
    skyAmounts(levels, s, out);
    assert.deepEqual([...out.a], [0, 0, 0, 0]);
    assert.equal(out.b[0], 0);
    assert.ok(Math.abs(out.b[3] - 0.09) < 1e-6);
    assert.deepEqual([...out.c], [0, 0, 0, 0]);

    // Las cantidades de cada efecto, con los números de SKY_FX.
    s.playing = true;
    s.beat.world = 0.8;
    s.beat.pulse = 0.8;
    s.beat.accent = 0.8;
    s.live.bass = 0.6;
    s.live.high = 0.3;
    s.song.intensity = 0.5;
    s.song.climax = 1;
    s.song.build = 0.4;
    s.song.flash = 0.5;
    s.song.calm = 0.7;
    s.sky.maxLuma = 0.004;   // de noche: el bombeo no tiene tope
    skyAmounts(levels, s, out);
    const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
    near(out.a[0], 0.035 + 0.05 * 0.8, 'tinte del clímax');
    near(out.a[2], 0.8 * (0.018 + 0.02 * 0.5), 'radio del sol');
    near(out.a[3], 0.6 * 0.3 + 0.8 * (0.1 + 0.14 * 0.5) + 0.25 * 0.5, 'halo del sol');
    near(out.b[0], 0.6 * 0.55 + 0.8 * (0.15 + 0.30 * 0.5 + 0.35 * 0.4) + 0.45 * 0.5 + 0.30 * 0.4, 'brillo del horizonte');
    near(out.b[1], 0.3 * 0.35 + 0.25 * 0.5, 'línea fría');
    near(out.b[2], 26 - 8 * 0.5, 'caída del brillo');
    // El bombeo: lo que el cielo se oscurece ahora (0 en el golpe, todo entre golpes).
    near(out.b[3], (0.09 + 0.14 * 0.5 + 0.06 * 0.4) * (1 - 0.8), 'bombeo');
    s.beat.world = 1;
    skyAmounts(levels, s, out);
    assert.equal(out.b[3], 0, 'en el golpe, el cielo a su brillo');
    s.beat.world = 0;
    skyAmounts(levels, s, out);
    near(out.b[3], 0.09 + 0.14 * 0.5 + 0.06 * 0.4, 'entre golpes, lo más oscuro');
    s.beat.world = 0.8;
    skyAmounts(levels, s, out);
    near(out.c[0], 0.5 * 0.10, 'destello');
    near(out.c[1], 0.7, 'calma');

    // Apagar un efecto (el director pone su nivel a 0) lo quita del shader.
    skyAmounts({ ...levels, horizonGlow: 0, beatPump: 0, dropFlash: 0 }, s, out);
    assert.equal(out.b[0], 0);
    assert.equal(out.b[1], 0);
    assert.equal(out.b[3], 0);
    assert.equal(out.c[0], 0);
    near(out.a[3], 0.6 * 0.3 + 0.8 * (0.1 + 0.14 * 0.5), 'sin destello, el halo no lo recibe');
});

test('colores por defecto: el rosa y el cian de los tokens de la interfaz', () => {
    // Los colores de la interfaz viven en tokens.css desde el T04 (doc 12).
    const css = readFileSync(path.join(ROOT, 'resources/css/ui/tokens.css'), 'utf8');
    assert.ok(/--d-beat:/.test(css) && /--d-spike:/.test(css));
    for (const c of [FX_COLORS.warm, FX_COLORS.cool]) for (const v of c) assert.ok(v >= 0 && v <= 1);
});
