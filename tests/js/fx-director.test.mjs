// Director de efectos (T03.1, doc 11): el único sitio donde se decide cuánto se ve
// cada efecto. Escena, jugador, equipo, hora, arco, historia y panel dev son
// factores de un producto; los pintores solo leen el resultado.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFxDirector, rotateHue } from '../../resources/js/game/fx/director.js';
import { FX, FX_COLORS, FX_COSTS, FX_IDS } from '../../resources/js/game/fx/registry.js';
import { applyMusicFrame, clearMusicSignals, createFxSignals, readSkySignals } from '../../resources/js/game/fx/signals.js';
import { sceneFxPolicy } from '../../resources/js/game/fx/policy.js';
import { hexToRgb } from '../../resources/js/game/scenes/color.js';
import { SCENES, sceneCycle } from '../../resources/js/game/scenes/registry.js';
import { planSky } from '../../resources/js/game/scenes/skyClock.js';
import { createSkyState, skyStateAt } from '../../resources/js/game/scenes/skyModel.js';
import { createBeatClock } from '../../resources/js/game/systems/beatClock.js';
import { createSongDirector } from '../../resources/js/game/systems/songDirector.js';
import { normalizeChart } from '../../resources/js/game/levels/chartFormat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Señales de una partida en marcha, de noche o de día. */
function playing({ night = false, intensity = 0.76 } = {}) {
    const s = createFxSignals();
    s.playing = true;
    s.song.intensity = intensity;
    s.sky.night = night ? 1 : 0;
    s.sky.stars = night ? 1 : 0;
    s.sky.sunUp = night ? 0 : 1;
    return s;
}

/** Deja pasar tiempo de sobra para que terminen los fundidos. */
function settle(director, s, seconds = 9) {
    for (let t = 0; t < seconds; t += 1 / 60) director.update(s, 1 / 60);
}

test('con todo por defecto, los efectos de siempre salen a 1: mover el control al director no cambia el aspecto', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    const day = playing();
    settle(d, day);
    for (const id of FX_IDS) {
        if (id === 'starPulse') continue;
        assert.equal(d.levels[id], 1, `${id} de día`);
        assert.equal(d.reasonOf(id), '', id);
    }
    // El astro del pulso lo elige la hora: de día el sol, de noche las estrellas.
    assert.equal(d.levels.starPulse, 0);
    assert.match(d.reasonOf('starPulse'), /estrellas/);
    settle(d, playing({ night: true }));
    assert.equal(d.levels.starPulse, 1);
    assert.equal(d.levels.sunPulse, 0);
    assert.equal(d.levels.sunGlow, 0);
    assert.match(d.reasonOf('sunPulse'), /sol/);
});

test('sin partida no hay efectos; las motas del menú, sí', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    const s = createFxSignals();
    settle(d, s);
    for (const id of FX_IDS) assert.equal(d.levels[id], FX[id].ambient === true ? 1 : 0, id);
    assert.equal(d.reasonOf('groundPulse'), 'sin partida');
});

test('un efecto entra y sale con fundido, y reset lo apaga de golpe', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    const s = playing();
    d.update(s, 1 / 60);
    assert.ok(d.levels.horizonGlow > 0 && d.levels.horizonGlow < 0.2, `primer fotograma: ${d.levels.horizonGlow}`);
    let prev = 0;
    for (let i = 0; i < 30; i++) {
        d.update(s, 1 / 60);
        assert.ok(d.levels.horizonGlow >= prev, 'sube sin retroceder');
        prev = d.levels.horizonGlow;
    }
    settle(d, s);
    d.setOverrides({ off: ['horizonGlow'] });
    d.update(s, 1 / 60);
    assert.ok(d.levels.horizonGlow > 0.8, 'apagarlo no lo quita de golpe');
    settle(d, s);
    assert.equal(d.levels.horizonGlow, 0);
    assert.match(d.reasonOf('horizonGlow'), /panel dev/);

    d.setOverrides({ off: [] });
    settle(d, s);
    d.reset();
    for (const id of FX_IDS) if (FX[id].ambient !== true) assert.equal(d.levels[id], 0, id);
});

test('la preferencia del jugador: Suaves baja y quita lo de pantalla; Mínimos deja el pulso del suelo y las líneas', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains, pref: 'soft' });
    const s = playing();
    settle(d, s);
    assert.equal(d.levels.groundPulse, 1, 'lo esencial, a su fuerza');
    assert.equal(d.levels.speedLines, 1);
    assert.ok(Math.abs(d.levels.horizonGlow - 0.55) < 1e-9);
    for (const id of ['beatPump', 'dropFlash', 'dropKick']) {
        assert.equal(d.levels[id], 0, `${id} cambia la pantalla entera`);
        assert.match(d.reasonOf(id), /Suaves/);
    }
    assert.equal(d.levels.obstacleBounce, 1, 'lo del juego no lo toca la preferencia');

    d.configure({ pref: 'min' });
    settle(d, s);
    for (const id of FX_IDS) {
        const kept = id === 'groundPulse' || id === 'speedLines' || FX[id].family === 'game';
        assert.equal(d.levels[id], kept ? 1 : 0, id);
    }
    // Un valor desconocido no deja el juego sin efectos.
    d.configure({ pref: 'raro' });
    settle(d, s);
    assert.equal(d.levels.horizonGlow, 1);
});

test('el tier de calidad apaga los efectos más caros de lo que admite', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains, costRank: FX_COSTS.indexOf('cheap') });
    const s = playing();
    settle(d, s);
    for (const id of FX_IDS) {
        if (id === 'starPulse') continue;
        assert.equal(d.levels[id] > 0, FX[id].cost === 'cheap', `${id} (${FX[id].cost})`);
    }
});

test('panel dev: apagar todo, ver uno solo y subir o bajar la intensidad', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    const s = playing();
    d.setOverrides({ solo: 'spectrum' });
    settle(d, s);
    for (const id of FX_IDS) assert.equal(d.levels[id] > 0, id === 'spectrum', id);
    assert.match(d.reasonOf('horizonGlow'), /solo/);

    d.setOverrides({ solo: null, gain: { spectrum: 2, horizonGlow: 0.25 } });
    settle(d, s);
    assert.equal(d.levels.spectrum, 2);
    assert.equal(d.levels.horizonGlow, 0.25);
    assert.equal(d.levels.groundPulse, 1);

    d.setOverrides({ master: false });
    settle(d, s);
    for (const id of FX_IDS) assert.equal(d.levels[id], 0, id);
});

test('el arco: el espectro entra con el cuerpo de la canción, no en el reposo', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    settle(d, playing({ intensity: 0.12 }));   // nivel 0: reposo
    assert.equal(d.levels.spectrum, 0);
    assert.match(d.reasonOf('spectrum'), /tranquilo/);
    settle(d, playing({ intensity: 0.32 }));   // calma
    assert.ok(d.levels.spectrum > 0.4 && d.levels.spectrum < 1);
    settle(d, playing({ intensity: 0.52 }));   // groove
    assert.equal(d.levels.spectrum, 1);
});

test('con lluvia o nieve las motas se van', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.storm });
    const s = playing();
    s.sky.precip = 0.9;
    settle(d, s, 8);
    assert.equal(d.levels.motes, 0);
    assert.match(d.reasonOf('motes'), /llueve/);
    s.sky.precip = 0.02;
    settle(d, s, 8);
    assert.equal(d.levels.motes, 1);
});

test('una historia aparta el aire en sus instantes clave; un ambiente no tiene instantes', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES['one-day'] });
    const s = playing({ night: true });
    settle(d, s);
    const before = d.levels.speedLines;
    assert.ok(before > 0);
    s.hush = 1;
    settle(d, s);
    assert.equal(d.levels.speedLines, 0);
    assert.match(d.reasonOf('speedLines'), /historia/);
    assert.ok(d.levels.groundPulse > 0, 'el pulso del suelo sigue: la escena solo aparta el aire');
    s.hush = 0;
    settle(d, s);
    assert.equal(d.levels.speedLines, before);
});

test('colores: los de la canción giran con sus cambios de tonalidad; los de una escena que los fija, no', () => {
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    const s = playing();
    settle(d, s);
    assert.deepEqual(d.colors.warm.map((v) => +v.toFixed(4)), [...FX_COLORS.warm]);
    assert.deepEqual(d.colors.cool.map((v) => +v.toFixed(4)), [...FX_COLORS.cool]);
    s.song.hue = 2 / 12;
    settle(d, s);
    assert.ok(Math.abs(d.colors.warm[0] - FX_COLORS.warm[0]) > 0.05, 'una modulación cambia el color');
    // El giro conserva el brillo (rota alrededor del gris).
    const sum = (c) => c[0] + c[1] + c[2];
    const turned = rotateHue([0.6, 0.3, 0.4], 0.2, [0, 0, 0]);
    assert.ok(Math.abs(sum(turned) - 1.3) < 1e-4);
    assert.deepEqual(rotateHue([0.6, 0.3, 0.4], 1, [0, 0, 0]).map((v) => +v.toFixed(4)), [0.6, 0.3, 0.4], 'una vuelta entera es el mismo color');

    d.configure({ scene: SCENES['one-day'] });
    settle(d, s);
    const policy = sceneFxPolicy(SCENES['one-day']);
    assert.deepEqual(d.colors.warm, policy.colors.warm);
    assert.deepEqual(d.colors.cool, hexToRgb(SCENES['one-day'].fx.colors.cool));
});

test('las señales de la partida: solo cambian las claves que se pasan, y al terminar quedan a cero', () => {
    const s = createFxSignals();
    applyMusicFrame(s, { pulse: 0.5, worldPulse: 0.7, intensity: 0.8, lines: 0.4 });
    applyMusicFrame(s, { flash: 0.9 });
    assert.equal(s.beat.pulse, 0.5);
    assert.equal(s.beat.world, 0.7);
    assert.equal(s.song.intensity, 0.8);
    assert.equal(s.song.flash, 0.9);
    assert.equal(s.speed.lines, 0.4);
    s.playing = true;
    s.sky.night = 1;
    clearMusicSignals(s);
    assert.equal(s.playing, false);
    assert.equal(s.beat.pulse + s.beat.world + s.song.intensity + s.song.flash + s.speed.lines, 0);
    assert.equal(s.sky.night, 1, 'el cielo no es de la partida');
});

test('One Day entero: nada toca su horizonte, su sol ni su mar; late el suelo y, de noche, las estrellas', async () => {
    const baked = JSON.parse(await readFile(path.join(ROOT, 'database/seeds/official/baked/one-day.json'), 'utf8'));
    const { chart } = normalizeChart(baked.chart);
    const scene = SCENES['one-day'];
    const D = chart.audio.durationSec;
    const plan = planSky(
        { sections: chart.events.filter((e) => e.type === 'section'), fx: chart.events.filter((e) => e.type === 'fx'), durationSec: D },
        sceneCycle(scene),
    );
    const song = createSongDirector(chart);
    const beats = createBeatClock(chart.music.beats, chart.music.beatPeriodS, chart.music.downbeats ?? []);
    const holds = [...(plan.story?.holds ?? []), ...(plan.story?.captions ?? []).map((c) => ({ t0: c.t, t1: c.t + c.holdS }))];
    assert.ok(holds.length >= 2, 'la historia tiene sus instantes');
    const hushAt = (t) => holds.reduce((h, w) => Math.max(h, Math.min(1, Math.min((t - w.t0 + 0.5) / 0.5, (w.t1 + 0.5 - t) / 0.5))), 0);

    const d = createFxDirector();
    d.configure({ scene });
    const s = createFxSignals();
    s.playing = true;
    const sky = createSkyState();
    const denied = ['horizonGlow', 'sunPulse', 'sunGlow', 'spectrum', 'beatPump', 'ridgePulse', 'motes', 'climaxTint', 'keyHue'];
    const peak = Object.fromEntries(FX_IDS.map((id) => [id, 0]));
    let hushed = 0;
    for (let t = 0; t < D; t += 1 / 30) {
        song.update(t, 1 / 30);
        const phase = beats.phaseAt(t);
        const pulse = Math.exp(-phase * 4.5);
        applyMusicFrame(s, {
            pulse, worldPulse: pulse, accent: beats.isAccentAt(t) ? pulse : 0,
            intensity: song.intensity, climax: song.climax ? 1 : 0, build: song.build, calm: song.calm, hue: song.hue,
            lines: 0.6, hush: hushAt(t),
        });
        skyStateAt(plan.hourAt(t), scene, sky);
        readSkySignals(sky, scene, s);
        d.update(s, 1 / 30);
        for (const id of denied) assert.equal(d.levels[id], 0, `${id} a los ${t.toFixed(1)} s`);
        for (const id of FX_IDS) peak[id] = Math.max(peak[id], d.levels[id]);
        if (s.hush >= 1 && d.levels.speedLines === 0) hushed++;
    }
    assert.ok(Math.abs(peak.groundPulse - scene.fx.temper.pulse) < 1e-9, 'el suelo late, suave');
    assert.ok(Math.abs(peak.starPulse - scene.fx.temper.pulse) < 1e-9, 'las estrellas de la noche de la espera titilan, suave');
    assert.equal(peak.dropFlash, 1, 'el drop conserva su momento entero');
    assert.equal(peak.obstacleBounce, 1);
    assert.ok(hushed > 30, 'en sus instantes clave las líneas de velocidad se apartan');
});
