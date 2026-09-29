// Efectos del plan (Ola 6c): subida a un drop, break y cambio de tonalidad.
//
// Se protege:
//   - El plan (levels/fxPlan.js): la subida empieza en los compases que el arco
//     marca antes de cada drop y termina en él; un break es un tramo en reposo tras
//     uno con cuerpo; un cambio de tonalidad sale del análisis tonal (y no en los
//     primeros segundos); todo determinista y sin tocar lo que se juega.
//   - El runtime (systems/songDirector.js): la subida crece hasta el drop, el break
//     entra y sale con fundido, el color gira con los semitonos y se queda; un
//     efecto que no está en el registro se ignora, y los de momento se disparan
//     como siempre.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FX_PLANNERS, FX_RULES, planFx } from '../../resources/js/game/levels/fxPlan.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { validateChart } from '../../resources/js/game/systems/playability.js';
import { FX_KINDS, createSongDirector } from '../../resources/js/game/systems/songDirector.js';
import { makeSyntheticSong } from './helpers/synthetic-audio.mjs';

/** Pop con un break en silencio tras un estribillo y una modulación a mitad. */
function song() {
    const analysis = makeSyntheticSong({
        bpm: 110,
        sections: [
            { bars: 8, energy: 0.25, hits: 0.3, role: 'intro', cluster: 'A' },
            { bars: 12, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
            { bars: 8, energy: 0.85, hits: 0.95, role: 'chorus', cluster: 'C' },
            { bars: 4, energy: 0.02, hits: 0, role: 'break', cluster: 'D', silent: true },
            { bars: 12, energy: 0.55, hits: 0.55, role: 'verse', cluster: 'B' },
            { bars: 8, energy: 0.3, hits: 0.25, role: 'bridge', cluster: 'E' },
            { bars: 8, energy: 0.95, hits: 1, role: 'chorus', cluster: 'C' },
            { bars: 6, energy: 0.2, hits: 0.2, role: 'outro', cluster: 'A' },
        ],
    });
    analysis.tonal = {
        key: 'C major', keyConfidence: 0.8, chords: [[0, 'C:maj']], chordConfidence: 0.8, harmonicRhythm: 1, tuningCents: 0,
        modulations: [{ t: 4, key: 'D major', semitones: 2 }, { t: 90, key: 'F major', semitones: 3 }],
    };
    return analysis;
}

test('plan: la subida termina en su drop, el break sigue a un tramo con cuerpo y el cambio de tonalidad sale del análisis', () => {
    const analysis = song();
    const model = buildMusicModel(analysis);
    const arc = buildSongArc(model);
    const fx = planFx({ model, arc });

    const drops = fx.filter((e) => e.fx === 'drop');
    const builds = fx.filter((e) => e.fx === 'build');
    assert.ok(drops.length >= 1, 'hay un drop');
    for (const drop of drops) {
        const build = builds.find((b) => Math.abs(b.until - drop.t) < 1e-6);
        assert.ok(build !== undefined, `el drop de ${drop.t} tiene su subida`);
        const barsBefore = model.bars.filter((b) => b.t0 >= build.t - 1e-6 && b.t0 < drop.t - 1e-6).length;
        assert.ok(barsBefore >= 1 && barsBefore <= 2, `subida de ${barsBefore} compases`);
    }
    assert.ok(builds.every((b) => drops.some((d) => Math.abs(d.t - b.until) < 1e-6)), 'no hay subidas sin drop');

    const breaks = fx.filter((e) => e.fx === 'break');
    assert.ok(breaks.some((b) => b.t > 50 && b.t < 75), `el silencio tras el estribillo es un break (${breaks.map((b) => b.t)})`);
    for (const brk of breaks) {
        const seg = arc.segments.find((s) => Math.abs(s.t0 - brk.t) < 0.002);
        const prev = arc.segments[seg.index - 1];
        assert.ok(seg.level <= FX_RULES.breakMaxLevel && prev.level >= FX_RULES.breakFromLevel, `break en ${brk.t}: ${prev.level} → ${seg.level}`);
        assert.ok(brk.until - brk.t >= FX_RULES.breakMinS);
    }

    const keys = fx.filter((e) => e.fx === 'key');
    assert.deepEqual(keys.map((k) => [k.t, k.semitones]), [[90, 3]], 'la modulación de los primeros segundos no cuenta');
    assert.deepEqual(fx.map((e) => e.t), [...fx.map((e) => e.t)].sort((a, b) => a - b), 'en orden');
    assert.deepEqual(Object.keys(FX_PLANNERS).length >= 4, true);
});

test('plan: los efectos entran en el chart sin cambiar lo que se juega ni el determinismo', () => {
    const analysis = song();
    const { chart } = buildChart(analysis, { seed: 3, difficulty: 4 });
    const kinds = new Set(chart.events.filter((e) => e.type === 'fx').map((e) => e.fx));
    for (const k of ['drop', 'build', 'key']) assert.ok(kinds.has(k), `${k} en el chart (${[...kinds]})`);
    for (const k of kinds) assert.ok(FX_KINDS[k] !== undefined, `el runtime sabe vivir ${k}`);
    assert.ok(validateChart(chart, { toleranceS: 0.047 }).ok);
    // Quitar los efectos no cambia ni un obstáculo: son solo visuales.
    const played = (c) => JSON.stringify(c.events.filter((e) => e.type !== 'fx'));
    assert.equal(played(chart), played(buildChart(analysis, { seed: 3, difficulty: 4 }).chart));
    assert.equal(JSON.stringify(buildChart(analysis, { seed: 3, difficulty: 4 }).chart), JSON.stringify(chart));
});

test('director: la subida crece hasta el drop, el break entra y sale con fundido y el color gira con la tonalidad', () => {
    const chart = {
        events: [
            { t: 0, type: 'section', level: 2, intensity: 0.5, role: 'verse', climax: false },
            { t: 8, type: 'fx', fx: 'build', until: 12 },
            { t: 12, type: 'section', level: 4, intensity: 1, role: 'chorus', climax: true },
            { t: 12, type: 'fx', fx: 'drop', level: 4 },
            { t: 20, type: 'section', level: 0, intensity: 0.1, role: 'break', climax: false },
            { t: 20, type: 'fx', fx: 'break', until: 24 },
            { t: 26, type: 'fx', fx: 'key', semitones: 3 },
            { t: 28, type: 'fx', fx: 'fuegos', strength: 9 },
        ],
    };
    const d = createSongDirector(chart, 40);
    const fired = [];
    const at = {};
    for (let t = 0; t <= 40; t += 1 / 60) {
        for (const e of d.update(t, 1 / 60)) fired.push(e.fx);
        for (const mark of [7, 10, 11.9, 12.1, 20.1, 20.5, 22, 24.3, 25, 26.1, 31, 39]) {
            if (Math.abs(t - mark) < 1 / 120) at[mark] = { build: d.build, calm: d.calm, hue: d.hue };
        }
    }
    assert.deepEqual(fired, ['drop'], 'los momentos se disparan como siempre; lo desconocido se ignora');
    assert.equal(at[7].build, 0);
    assert.ok(at[10].build > 0.45 && at[10].build < 0.55, `a mitad de subida ${at[10].build}`);
    assert.ok(at[11.9].build > 0.95 && at[12.1].build === 0, 'llega arriba justo en el drop y se suelta');
    assert.ok(at[20.1].calm > 0 && at[20.1].calm < at[20.5].calm && at[22].calm === 1, 'el break entra con fundido');
    assert.ok(at[24.3].calm > 0 && at[24.3].calm < 1 && at[25].calm === 0, 'y sale con fundido');
    assert.equal(at[26.1].hue < 0.05, true, 'el color gira poco a poco');
    assert.ok(Math.abs(at[39].hue - 3 / 12) < 0.01, `y se queda girado un cuarto de vuelta (${at[39].hue})`);
});
