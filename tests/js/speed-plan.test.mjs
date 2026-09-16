// Plan de velocidad (afinado de velocidad, Sep 2026): cómo acelera el mundo.
//
// Tras el playtest de la Ola 5, el nivel más largo y difícil no se sentía épico:
// aceleraba poco y volvía a la base entre tramos. Se protege:
//   - Marchas: la velocidad sube en escalones hacia el clímax, en compases que
//     abren tramo o frase; la última marcha es el clímax; más canción, más marchas.
//   - Trinquete: hasta que termina el clímax nunca frena; después, un único
//     frenazo en rampa. El clímax es lo más rápido.
//   - Anacrusa: cada acelerón cae en la pulsación previa a un primer tiempo, con
//     antelación suficiente para la vista, y ninguna acción del chart engaña a
//     quien juega mirando más de `readerBudgetS`.
//   - Dificultad: más difícil, más amplitud. Nunca por encima del techo.
//   - Regresión del playtest: What's Up Danger no vuelve a la base del 60 % al
//     80 % y llega al clímax bastante más rápido de lo que empieza.
//   - La sincronía no cambia: con el plan nuevo cada obstáculo sigue cruzando
//     al Dino en su instante (speed-profile.test.mjs) y todo chart se supera
//     jugando con el oído y con la vista (charter.test.mjs, validatePlayability).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChart } from '../../resources/js/game/levels/charter.js';
import { SPEED_RULES, pickupTime } from '../../resources/js/game/levels/speedPlan.js';
import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { OBSTACLE_KIND } from '../../resources/js/game/config.js';
import { actionLeadS } from '../../resources/js/game/systems/physics.js';
import { READER_ADAPT_S, readerOffsetS } from '../../resources/js/game/systems/playability.js';
import { speedProfileOf } from '../../resources/js/game/systems/speedProfile.js';
import { makeSyntheticSong } from './helpers/synthetic-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const obstacles = (chart) => chart.events.filter((e) => e.type === 'obstacle');
const ups = (chart) => chart.world.speedChanges.filter((c, i, all) => c.speedPxS > (i === 0 ? chart.world.speedPxS : all[i - 1].speedPxS));

async function baked(slug) {
    return JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${slug}.json`), 'utf8'));
}

test('marchas: la velocidad sube en escalones hacia el clímax, cada uno al abrir tramo o frase, y el último es el clímax', () => {
    for (const bpm of [80, 120, 146]) {
        const analysis = makeSyntheticSong({ bpm });
        const model = buildMusicModel(analysis);
        const arc = buildSongArc(model);
        const { chart, report } = buildChart(analysis, { seed: 3, difficulty: 3 });
        const label = `${bpm} BPM, ${analysis.durationSec.toFixed(0)} s`;

        const steps = ups(chart).map((c) => model.bars.find((b) => b.t0 > c.t + 1e-6).t0);
        assert.ok(steps.length >= 3, `${label}: ${steps.length} acelerones`);
        assert.equal(steps.at(-1), report.climax.t0, `${label}: el último acelerón es el clímax`);
        assert.equal(report.gears.at(-1), report.climax.t0, `${label}: la última marcha es el clímax`);
        for (let i = 1; i < report.gears.length; i++) {
            assert.ok(report.gears[i] - report.gears[i - 1] >= SPEED_RULES.minGearGapS - 1e-6, `${label}: marchas separadas`);
        }
        // Cada acelerón abre un tramo o una frase del tramo.
        for (const at of steps) {
            const bar = model.bars.findIndex((b) => Math.abs(b.t0 - at) < 0.002);
            const seg = arc.segments.find((s) => bar >= s.bar0 && bar < s.bar1);
            assert.ok(bar === seg.bar0 || (bar - seg.bar0) % SPEED_RULES.phraseBars === 0, `${label}: acelerón en ${at} fuera de tramo y de frase`);
        }
    }
});

test('regresión: una canción que arranca empujando también sube de marcha antes del clímax', () => {
    // Visto al rechartear "Instrumental" (comunidad, 2:55): con el trinquete
    // sobre la velocidad, la marcha intermedia caía en una estrofa, pedía menos
    // que el estribillo inicial y desaparecía; el nivel solo aceleraba en el clímax.
    const analysis = makeSyntheticSong({
        bpm: 120,
        sections: [
            { bars: 12, energy: 0.92, hits: 0.95, role: 'chorus', cluster: 'C' },
            { bars: 16, energy: 0.45, hits: 0.45, role: 'verse', cluster: 'V' },
            { bars: 16, energy: 0.5, hits: 0.5, role: 'verse', cluster: 'V' },
            { bars: 12, energy: 0.95, hits: 1, role: 'chorus', cluster: 'C' },
            { bars: 4, energy: 0.3, hits: 0.3, role: 'outro', cluster: 'O' },
        ],
    });
    for (const difficulty of [1, 3, 5]) {
        const { chart, report } = buildChart(analysis, { seed: 1, difficulty });
        const before = ups(chart).filter((c) => c.t < report.climax.t0 - 1);
        assert.ok(report.gears.length >= 2, `d${difficulty}: marchas ${JSON.stringify(report.gears)}`);
        assert.ok(before.length >= 1, `d${difficulty}: acelera antes del clímax: ${JSON.stringify(chart.world)}`);
        assert.ok(before[0].speedPxS > chart.world.speedPxS * (1 + SPEED_RULES.minStepRatio), `d${difficulty}: y se nota`);
    }
});

test('trinquete: hasta que suelta el clímax no frena nunca; después, un único frenazo en rampa; el clímax es lo más rápido', () => {
    for (const bpm of [66, 104, 128, 174]) {
        const analysis = makeSyntheticSong({ bpm });
        for (const difficulty of [1, 3, 5]) {
            const { chart, report } = buildChart(analysis, { seed: 3, difficulty });
            const speed = speedProfileOf(chart);
            const label = `${bpm} BPM d${difficulty}`;
            let prev = speed.speedAt(0);
            for (let t = 0; t < report.climax.t1; t += 0.1) {
                const v = speed.speedAt(t);
                assert.ok(v >= prev - 1e-9, `${label}: frena en t=${t.toFixed(1)} antes de soltar el clímax`);
                prev = v;
            }
            const climaxSpeed = speed.speedAt((report.climax.t0 + report.climax.t1) / 2);
            assert.equal(climaxSpeed, speed.maxSpeed, `${label}: el clímax es lo más rápido`);
            const downs = chart.world.speedChanges.filter((c, i, all) => c.speedPxS < (i === 0 ? chart.world.speedPxS : all[i - 1].speedPxS));
            assert.ok(downs.length <= 1, `${label}: ${downs.length} frenazos`);
            for (const d of downs) {
                assert.ok(d.t >= report.climax.t1 - 1e-6, `${label}: el frenazo es tras el clímax`);
                assert.ok(Math.abs(d.rampS - SPEED_RULES.releaseBeats * analysis.beatPeriodS) < 0.01, `${label}: en rampa de ${SPEED_RULES.releaseBeats} beats`);
                assert.ok(d.speedPxS >= chart.world.speedPxS, `${label}: nunca por debajo de la base`);
            }
        }
    }
});

test('anacrusa: cada acelerón cae en la pulsación previa a un primer tiempo, con antelación para la vista', () => {
    for (const bpm of [66, 96, 128, 174]) {
        const analysis = makeSyntheticSong({ bpm });
        const model = buildMusicModel(analysis);
        const { chart } = buildChart(analysis, { seed: 3, difficulty: 4 });
        const beat = 60 / bpm;
        assert.ok(ups(chart).length > 0, `${bpm} BPM: acelera`);
        for (const c of ups(chart)) {
            const bar = model.bars.findIndex((b) => b.t0 > c.t + 1e-6);
            const at = model.bars[bar].t0;
            assert.ok(at - c.t >= SPEED_RULES.pickupMinS - 1e-6, `${bpm} BPM: acelerón en ${c.t} a ${(at - c.t).toFixed(3)} s del primer tiempo`);
            assert.ok(at - c.t <= beat + 1e-6 || beat / 2 < SPEED_RULES.pickupMinS, `${bpm} BPM: acelerón en ${c.t} demasiado pronto`);
            assert.equal(c.t, Math.round(pickupTime(model, bar) * 1000) / 1000, `${bpm} BPM: en un hueco de la rejilla`);
            assert.equal(c.rampS, 0, 'un acelerón es un portal, sin rampa');
        }
    }
    assert.ok(SPEED_RULES.pickupMinS >= READER_ADAPT_S, 'la anacrusa da a la vista el tiempo que tarda en recalibrar');
});

test('vista: ninguna acción del chart engaña a quien juega mirando más de readerBudgetS', () => {
    for (const bpm of [66, 104, 146, 174]) {
        const analysis = makeSyntheticSong({ bpm });
        for (const difficulty of [2, 5]) {
            const { chart } = buildChart(analysis, { seed: 5, difficulty });
            const speed = speedProfileOf(chart);
            for (const e of obstacles(chart)) {
                const err = readerOffsetS(speed, e.t, actionLeadS(OBSTACLE_KIND[e.kind]));
                assert.ok(Math.abs(err) <= SPEED_RULES.readerBudgetS + 1e-6, `${bpm} BPM d${difficulty}: ${e.kind} en ${e.t} con ${(err * 1000).toFixed(0)} ms`);
            }
        }
    }
});

test('escalada según la canción: una corta apenas acelera, una larga sube de marcha; más difícil, más amplitud', () => {
    const short = makeSyntheticSong({
        bpm: 120,
        sections: [
            { bars: 6, energy: 0.5, hits: 0.5, role: 'verse', cluster: 'V' },
            { bars: 8, energy: 0.9, hits: 1, role: 'chorus', cluster: 'C' },
            { bars: 4, energy: 0.3, hits: 0.3, role: 'outro', cluster: 'O' },
        ],
    });
    const long = makeSyntheticSong({ bpm: 120 });
    const ratio = (analysis, difficulty) => {
        const { chart, report } = buildChart(analysis, { seed: 1, difficulty });
        return { top: report.topSpeedPxS / chart.world.speedPxS, gears: report.gears.length };
    };
    const s = ratio(short, 3);
    const l = ratio(long, 3);
    assert.equal(s.gears, 0, `canción de ${short.durationSec.toFixed(0)} s sin marchas: solo el clímax`);
    assert.equal(l.gears, SPEED_RULES.maxGears, `canción de ${long.durationSec.toFixed(0)} s con todas las marchas`);
    assert.ok(l.top > s.top + 0.15, `la larga escala más: ×${l.top.toFixed(2)} frente a ×${s.top.toFixed(2)}`);

    let prev = 1;
    for (const difficulty of [1, 2, 3, 4, 5]) {
        const r = ratio(long, difficulty);
        assert.ok(r.top >= prev - 1e-9, `d${difficulty}: ×${r.top.toFixed(2)} por debajo de la dificultad anterior`);
        prev = r.top;
    }
    assert.ok(ratio(long, 5).top > ratio(long, 1).top + 0.15, 'Extremo acelera claramente más que Relajado');
});

test('techo: ni una canción rápida en Extremo pasa de SPEED_RULES.maxSpeedPxS', () => {
    for (const bpm of [170, 190]) {
        const { chart, report } = buildChart(makeSyntheticSong({ bpm }), { seed: 1, difficulty: 5 });
        assert.ok(report.topSpeedPxS <= SPEED_RULES.maxSpeedPxS, `${bpm} BPM: ${report.topSpeedPxS}`);
        assert.ok(chart.world.speedChanges.every((c) => c.speedPxS <= SPEED_RULES.maxSpeedPxS));
    }
});

test('regresión del playtest: What\'s Up Danger (Extremo) no vuelve a la base del 60 % al 80 % y llega al clímax mucho más rápido', async () => {
    // Segundo playtest (Ola 6a): con ×1.2 y ×1.55 "se nota un poquito, pero no
    // tanto". Ahora ×1.35 del 60 % al 80 % y ×1.75 en el clímax como mínimo.
    const b = await baked('whats-up-danger');
    const { chart, report } = buildChart(b.analysis, { sha256: b.audio.sha256, difficulty: 5 });
    const speed = speedProfileOf(chart);
    const base = chart.world.speedPxS;
    const dur = chart.audio.durationSec;
    assert.equal(report.gears.length, 3, `marchas ${JSON.stringify(report.gears)}`);
    for (let f = 0.6; f <= 0.8; f += 0.02) {
        assert.ok(speed.speedAt(dur * f) >= base * 1.35, `al ${Math.round(f * 100)} %: ${speed.speedAt(dur * f)} px/s (base ${base})`);
    }
    assert.ok(report.topSpeedPxS >= base * 1.75, `clímax a ${report.topSpeedPxS} px/s, ×${(report.topSpeedPxS / base).toFixed(2)}`);
    assert.ok(report.climax.t0 > dur * 0.6, 'el clímax llega en el tramo final');
});

test('los 8 oficiales × 5 dificultades: las canciones de más de 2:30 aceleran varias veces y el clímax acelera', async () => {
    const dir = path.join(ROOT, 'database/seeds/official/baked');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
        const b = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        for (const difficulty of [1, 2, 3, 4, 5]) {
            const { chart, report } = buildChart(b.analysis, { sha256: b.audio.sha256, difficulty });
            const label = `${file} d${difficulty}`;
            if (chart.audio.durationSec >= 150) {
                assert.ok(ups(chart).length >= 2, `${label}: ${ups(chart).length} acelerones`);
                assert.ok(report.topSpeedPxS >= chart.world.speedPxS * 1.3, `${label}: solo ×${(report.topSpeedPxS / chart.world.speedPxS).toFixed(2)}`);
            }
            const speed = speedProfileOf(chart);
            assert.ok(speed.speedAt(report.climax.t0 + 0.5) > speed.speedAt(report.climax.t0 - 1), `${label}: el clímax acelera`);
            assert.ok(report.topSpeedPxS <= SPEED_RULES.maxSpeedPxS);
        }
    }
});
