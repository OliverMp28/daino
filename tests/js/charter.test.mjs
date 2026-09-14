// Charter musical: análisis → nivel (Ola 5).
//
// El charter es puro, así que estos tests usan canciones sintéticas con
// estructura conocida (helpers/synthetic-audio.mjs: secciones de energía
// distinta, bombo grave en 1 y 3, caja brillante en 2 y 4, charles a
// contratiempo) y, al final, los análisis REALES de los 8 oficiales horneados.
//
// Invariantes protegidos:
//   - Determinismo: mismo análisis + misma seed + misma dificultad ⇒ mismo chart.
//   - Rejilla: toda acción cae en un pulso o un contratiempo de la canción.
//   - Dinámica: la densidad sigue al arco (reposo < calma < groove < empuje < clímax).
//   - Estructura: un clímax en la segunda mitad, el mundo acelera en los tramos
//     que empujan y nunca por debajo de la base, drops con respiración antes.
//   - Dificultad: más difícil ⇒ más acciones; cada chart se supera con la
//     tolerancia de su dificultad; nunca por encima del techo de la canción.
//   - Progresión: las mecánicas se estrenan en su momento del arco.
//   - Justicia: 0 patrones imposibles en las 8 canciones reales × 5 dificultades.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChart, CHARTER_RULES, gameplayTempo, unlockSchedule } from '../../resources/js/game/levels/charter.js';
import { normalizeChart, seedFromSha256, CHART_FORMAT_VERSION } from '../../resources/js/game/levels/chartFormat.js';
import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { DIFFICULTY_PROFILES } from '../../resources/js/game/levels/difficulty.js';
import { OBSTACLE_KIND } from '../../resources/js/game/config.js';
import { actionLeadS } from '../../resources/js/game/systems/physics.js';
import { toSimObstacles, validatePlayability } from '../../resources/js/game/systems/playability.js';
import { speedProfileOf } from '../../resources/js/game/systems/speedProfile.js';
import { makeSyntheticAnalysis, makeSyntheticSong } from './helpers/synthetic-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = 'c0ffee'.padEnd(64, '0');

const obstacles = (chart) => chart.events.filter((e) => e.type === 'obstacle');
const sections = (chart) => chart.events.filter((e) => e.type === 'section');

/** Acciones por minuto dentro de [t0, t1). */
function apmIn(chart, t0, t1) {
    return (obstacles(chart).filter((e) => e.t >= t0 && e.t < t1).length / Math.max(1e-6, t1 - t0)) * 60;
}

/** ¿Cae t en un beat o a mitad de dos beats de la lista (±tol)? */
function onGrid(t, beats, tol = 0.002) {
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (beats[m] < t) lo = m + 1;
        else hi = m;
    }
    const a = beats[Math.max(0, lo - 1)];
    const b = beats[Math.min(beats.length - 1, lo)];
    return [a, b, (a + b) / 2].some((c) => Math.abs(c - t) <= tol);
}

test('determinismo: misma entrada, seed y dificultad ⇒ mismo chart byte a byte', () => {
    const analysis = makeSyntheticSong({ bpm: 118 });
    for (const difficulty of [1, 3, 5, 'auto']) {
        const a = buildChart(analysis, { seed: 4242, sha256: SHA, difficulty }).chart;
        const b = buildChart(analysis, { seed: 4242, sha256: SHA, difficulty }).chart;
        assert.equal(JSON.stringify(a), JSON.stringify(b), `dificultad ${difficulty}`);
    }
    const c = buildChart(analysis, { sha256: SHA }).chart;
    assert.equal(c.seed, seedFromSha256(SHA), 'sin seed explícita se deriva del hash del audio');
});

test('formato 2: un chart generado se normaliza sin avisos y conserva velocidad, pulso y dificultad', () => {
    const analysis = makeSyntheticSong({ bpm: 124 });
    const { chart } = buildChart(analysis, { sha256: SHA, difficulty: 4 });
    const { chart: n, warnings } = normalizeChart(chart);
    assert.deepEqual(warnings, []);
    assert.equal(n.formatVersion, CHART_FORMAT_VERSION);
    assert.equal(n.difficulty.level, 4);
    assert.equal(n.difficulty.requested, 4);
    assert.ok(n.world.speedChanges.length > 0, 'una canción con estribillos cambia de velocidad');
    assert.equal(n.music.beats.length, analysis.beats.length);
    assert.equal(n.music.downbeats.length, analysis.downbeats.length);
});

test('rejilla: toda acción cae en un pulso o un contratiempo real, a cualquier tempo', () => {
    for (const bpm of [66, 92, 120, 146, 174]) {
        const analysis = makeSyntheticSong({ bpm, seed: bpm });
        for (const difficulty of [1, 3, 5]) {
            const { chart } = buildChart(analysis, { seed: 1, difficulty });
            const off = obstacles(chart).filter((e) => !onGrid(e.t, analysis.beats));
            assert.equal(off.length, 0, `${bpm} BPM, dificultad ${difficulty}: ${off.length} fuera de rejilla`);
            assert.ok(obstacles(chart).length > 20, `${bpm} BPM: solo ${obstacles(chart).length} acciones`);
        }
    }
});

test('dinámica: la densidad sigue al arco (reposo < calma < groove < empuje < clímax)', () => {
    const analysis = makeSyntheticSong({ bpm: 96 });
    const { chart } = buildChart(analysis, { seed: 2, difficulty: 4 });
    const secs = sections(chart);
    const byLevel = new Map();
    for (let i = 0; i < secs.length; i++) {
        const t1 = secs[i + 1]?.t ?? chart.audio.durationSec - CHARTER_RULES.tailRestS;
        const t0 = Math.max(secs[i].t, CHARTER_RULES.firstActionMinS);
        if (t1 <= t0) continue;
        const acc = byLevel.get(secs[i].level) ?? { n: 0, dur: 0 };
        acc.n += obstacles(chart).filter((e) => e.t >= t0 && e.t < t1).length;
        acc.dur += t1 - t0;
        byLevel.set(secs[i].level, acc);
    }
    const apm = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, { n, dur }]) => [level, (n / dur) * 60]);
    for (let i = 1; i < apm.length; i++) {
        assert.ok(apm[i][1] > apm[i - 1][1], `nivel ${apm[i][0]} (${apm[i][1].toFixed(0)}/min) no supera a ${apm[i - 1][0]} (${apm[i - 1][1].toFixed(0)}/min)`);
    }
    assert.deepEqual(apm.map(([level]) => level), [0, 1, 2, 3, 4], 'la canción sintética recorre los cinco niveles');
});

test('estructura: un único clímax, en la segunda mitad, el tramo más denso y el más rápido', () => {
    for (const bpm of [80, 128]) {
        const analysis = makeSyntheticSong({ bpm });
        const { chart, report } = buildChart(analysis, { seed: 3, difficulty: 3 });
        const climaxes = sections(chart).filter((s) => s.climax);
        assert.equal(climaxes.length, 1, `${bpm} BPM: un clímax`);
        assert.ok(report.climax.t0 > chart.audio.durationSec * 0.45, 'el clímax llega en la segunda mitad');
        // El último estribillo de DEFAULT_SONG_SECTIONS es el clímax.
        const lastChorus = analysis.sections.filter((s) => s.role === 'chorus').at(-1);
        assert.ok(Math.abs(report.climax.t0 - lastChorus.startSec) < 60 / bpm * 4 + 1e-6, 'y es el último estribillo');

        const climaxApm = apmIn(chart, report.climax.t0, report.climax.t1);
        const others = sections(chart).filter((s) => !s.climax);
        for (let i = 0; i < others.length; i++) {
            const next = chart.events.find((e) => e.type === 'section' && e.t > others[i].t)?.t ?? chart.audio.durationSec;
            if (next - others[i].t < 8) continue;
            assert.ok(apmIn(chart, Math.max(others[i].t, 3), next) <= climaxApm + 1e-9, `${bpm} BPM: tramo en ${others[i].t} más denso que el clímax`);
        }

        const speed = speedProfileOf(chart);
        const base = chart.world.speedPxS;
        const climaxSpeed = speed.speedAt((report.climax.t0 + report.climax.t1) / 2);
        assert.ok(climaxSpeed > base, 'el clímax corre más que la base');
        for (let t = 0; t < chart.audio.durationSec; t += 0.5) {
            const v = speed.speedAt(t);
            assert.ok(v >= base - 1e-9 && v <= climaxSpeed + 1e-9, `velocidad ${v} en t=${t}: nunca por debajo de la base ni por encima del clímax`);
            assert.ok(v <= CHARTER_RULES.maxSpeedPxS + 1e-9);
        }
    }
});

test('regresión: una canción que arranca ya empujando empieza a esa velocidad, sin portal en el segundo 0', () => {
    // Estribillo de entrada muy por encima de la intensidad típica (dos estrofas
    // largas): el primer tramo empuja (nivel 3) desde el segundo 0.
    const analysis = makeSyntheticSong({
        bpm: 120,
        sections: [
            { bars: 12, energy: 0.92, hits: 0.95, role: 'chorus', cluster: 'C' },
            { bars: 16, energy: 0.45, hits: 0.45, role: 'verse', cluster: 'V' },
            { bars: 16, energy: 0.5, hits: 0.5, role: 'verse', cluster: 'V' },
            { bars: 12, energy: 0.95, hits: 1, role: 'chorus', cluster: 'C' },
        ],
    });
    const arc = buildSongArc(buildMusicModel(analysis));
    assert.equal(arc.segments[0].level, 3, `niveles ${arc.segments.map((s) => s.level)}`);
    const { chart } = buildChart(analysis, { seed: 1, difficulty: 4 });
    assert.ok(chart.world.speedChanges.every((c) => c.t > 0), `cambios: ${JSON.stringify(chart.world.speedChanges)}`);
    const tempoOnly = buildChart({ ...analysis, sections: [] }, { seed: 1, difficulty: 4 });
    assert.ok(chart.world.speedPxS > tempoOnly.chart.world.speedPxS - 1e-9, 'la base ya es la del tramo que empuja');
    const verse = analysis.sections[1];
    assert.ok(chart.world.speedChanges.some((c) => Math.abs(c.t - verse.startSec) < 0.01 && c.speedPxS < chart.world.speedPxS), `baja al entrar en la estrofa: ${JSON.stringify(chart.world)}`);
});

test('drops y lifts: momentos en el primer tiempo; antes del drop, el último beat respira', () => {
    const analysis = makeSyntheticSong({ bpm: 104 });
    const { chart } = buildChart(analysis, { seed: 5, difficulty: 4 });
    const fx = chart.events.filter((e) => e.type === 'fx');
    const drops = fx.filter((e) => e.fx === 'drop');
    const lifts = fx.filter((e) => e.fx === 'lift');
    // Estructura sintética: estrofa → estribillo sube un nivel (lift) dos veces;
    // puente → estribillo final es el clímax (drop).
    assert.equal(drops.length, 1, 'un drop: el clímax tras el puente');
    assert.equal(lifts.length, 2, 'dos lifts: la entrada de cada estribillo');
    const choruses = analysis.sections.filter((s) => s.role === 'chorus').map((s) => s.startSec);
    for (const e of fx) {
        assert.ok(choruses.some((c) => Math.abs(c - e.t) < 0.002), `el momento de ${e.t} cae en el primer tiempo de un estribillo`);
    }
    const period = 60 / 104;
    for (const drop of drops) {
        if (drop.t < CHARTER_RULES.firstActionMinS) continue;
        assert.ok(obstacles(chart).some((e) => Math.abs(e.t - drop.t) < 0.002), `el drop de ${drop.t} tiene su acción en el primer tiempo`);
        const breath = obstacles(chart).filter((e) => e.t > drop.t - period - 0.02 && e.t < drop.t - 0.002);
        assert.equal(breath.length, 0, `el beat anterior al drop de ${drop.t} respira`);
    }
});

test('silencio: donde la música calla no hay acciones', () => {
    const analysis = makeSyntheticSong({
        bpm: 110,
        sections: [
            { bars: 8, energy: 0.7, hits: 0.8, role: 'verse' },
            { bars: 6, energy: 0, hits: 0, role: 'break', silent: true },
            { bars: 8, energy: 0.8, hits: 0.9, role: 'chorus' },
        ],
    });
    const silent = analysis.sections[1];
    for (const difficulty of [1, 5]) {
        const { chart } = buildChart(analysis, { seed: 1, difficulty });
        const inside = obstacles(chart).filter((e) => e.t > silent.startSec + 0.3 && e.t < silent.endSec - 0.3);
        assert.equal(inside.length, 0, `dificultad ${difficulty}: ${inside.length} acciones en el silencio`);
    }
});

test('dificultad: más difícil ⇒ más acciones, más rápido y validado con menos margen', () => {
    const analysis = makeSyntheticSong({ bpm: 100 });
    let prevCount = 0;
    let prevTop = 0;
    for (const difficulty of [1, 2, 3, 4, 5]) {
        const { chart, report } = buildChart(analysis, { seed: 9, difficulty });
        assert.equal(report.difficulty, difficulty, 'la canción sintética admite hasta Extremo');
        const n = obstacles(chart).length;
        assert.ok(n > prevCount, `dificultad ${difficulty}: ${n} acciones, no más que ${prevCount}`);
        prevCount = n;
        const top = Math.max(chart.world.speedPxS, ...chart.world.speedChanges.map((c) => c.speedPxS));
        assert.ok(top >= prevTop, `dificultad ${difficulty}: velocidad máxima ${top} < ${prevTop}`);
        prevTop = top;
        const v = validatePlayability(toSimObstacles(obstacles(chart)), speedProfileOf(chart), { toleranceS: DIFFICULTY_PROFILES[difficulty].toleranceS });
        assert.ok(v.ok, `dificultad ${difficulty}: injugable en t=${v.t} (${v.pattern}) con ±${DIFFICULTY_PROFILES[difficulty].toleranceS * 1000} ms`);
    }
});

test('dificultad: nunca por encima del techo de la canción; "auto" es Normal o el techo', () => {
    const soft = makeSyntheticSong({
        bpm: 76,
        sections: [
            { bars: 12, energy: 0.4, hits: 0.2, role: 'verse' },
            { bars: 12, energy: 0.6, hits: 0.3, role: 'chorus' },
        ],
    });
    // Densidad musical 10 + ¼·60·0.5 = 17.5 → techo 2 (difficultyCeiling.js).
    soft.features = { ...soft.features, strongEventsPerMin: 10, eventsPerMin: 60, beatSupport: 0.5 };
    const extreme = buildChart(soft, { seed: 1, difficulty: 5 });
    assert.equal(extreme.report.ceiling, 2);
    assert.equal(extreme.report.difficulty, 2, 'pedir Extremo en una balada da su techo');
    assert.equal(extreme.chart.difficulty.requested, 5);
    assert.equal(buildChart(soft, { seed: 1 }).report.difficulty, 2, 'auto con techo 2');
    assert.equal(buildChart(makeSyntheticSong({ bpm: 128 }), { seed: 1 }).report.difficulty, 3, 'auto con techo 5 es Normal');
    // Formato 1 (navegador): sin techo calculable, se respeta lo pedido y auto es Normal.
    assert.equal(buildChart(makeSyntheticAnalysis({ bpm: 120, durationSec: 60 }), { seed: 1, difficulty: 5 }).report.difficulty, 5);
    assert.equal(buildChart(makeSyntheticAnalysis({ bpm: 120, durationSec: 60 }), { seed: 1 }).report.difficulty, 3);
});

test('progresión: cada mecánica se estrena en su momento del arco, nunca antes', () => {
    const analysis = makeSyntheticSong({ bpm: 90 });
    const model = buildMusicModel(analysis);
    const arc = buildSongArc(model);
    for (const difficulty of [1, 2, 3, 4, 5]) {
        const profile = DIFFICULTY_PROFILES[difficulty];
        const unlock = unlockSchedule(arc, profile);
        const { chart } = buildChart(analysis, { seed: 11, difficulty });
        const obs = obstacles(chart);
        const first = (kind) => obs.find((e) => e.kind === kind)?.t ?? Infinity;
        assert.ok(first('PTERO') >= unlock.duck - 1e-9, `d${difficulty}: agachado en ${first('PTERO')} antes de ${unlock.duck}`);
        assert.ok(first('CACTUS_WIDE') >= unlock.wide - 1e-9, `d${difficulty}: cactus ancho en ${first('CACTUS_WIDE')} antes de ${unlock.wide}`);
        // Contratiempos solo tras su desbloqueo.
        const period = 60 / 90;
        for (const e of obs) {
            const isOffbeat = !analysis.beats.some((b) => Math.abs(b - e.t) < 0.002);
            if (isOffbeat) assert.ok(e.t >= unlock.offbeat - period, `d${difficulty}: contratiempo en ${e.t} antes de ${unlock.offbeat}`);
        }
    }
    const easy = obstacles(buildChart(analysis, { seed: 11, difficulty: 1 }).chart);
    assert.equal(easy.filter((e) => e.kind === 'CACTUS_WIDE').length, 0, 'Relajado no usa cactus anchos');
});

test('intro de tutorial, ventana inicial y descanso final', () => {
    const analysis = makeSyntheticSong({ bpm: 140 });
    for (const difficulty of [1, 3, 5]) {
        const { chart } = buildChart(analysis, { seed: 3, difficulty });
        const obs = obstacles(chart);
        assert.ok(obs[0].t >= CHARTER_RULES.firstActionMinS - 1e-9, 'primera acción tras la ventana inicial');
        for (let i = 0; i < CHARTER_RULES.introActions; i++) {
            assert.equal(OBSTACLE_KIND[obs[i].kind].altitude, 0, `d${difficulty}: la acción ${i} del tutorial es un salto`);
            if (i > 0) assert.ok(obs[i].t - obs[i - 1].t >= 1.1 - 1e-9, `d${difficulty}: tutorial espaciado`);
        }
        const maxLead = Math.max(...Object.values(OBSTACLE_KIND).map(actionLeadS));
        assert.ok(obs.at(-1).t + maxLead <= chart.audio.durationSec - CHARTER_RULES.tailRestS + 1e-3, 'descanso final');
    }
});

test('memoria de frases: un riff que se repite se juega con el mismo patrón', () => {
    const riff = { bars: 12, energy: 0.8, hits: 0.9, role: 'chorus', cluster: 'R', riff: true };
    const blocks = [
        { bars: 4, energy: 0.5, hits: 0.5, role: 'intro', cluster: 'I' },
        riff,
        riff,
        { bars: 4, energy: 0.3, hits: 0.3, role: 'outro', cluster: 'O' },
    ];
    for (const difficulty of [3, 5]) {
        const analysis = makeSyntheticSong({ bpm: 100, sections: blocks });
        const { chart } = buildChart(analysis, { seed: 1, difficulty });
        const period = 60 / 100;
        const barLen = 4 * period;
        const patternOf = (barStart) => obstacles(chart)
            .filter((e) => e.t >= barStart - 0.01 && e.t < barStart + barLen - 0.01)
            .map((e) => `${Math.round((e.t - barStart) / (period / 2))}:${e.kind}`)
            .join(' ');
        const downbeats = analysis.downbeats;
        // Dentro de cada bloque del riff, sin su primer compás (puede ser un drop)
        // ni los dos últimos (subida y respiración antes del siguiente bloque):
        // una frase dura 4 compases (la acción extra de la densidad cae en el
        // mismo compás de cada frase), así que cada compás debe jugarse igual
        // que el de cuatro compases después.
        let same = 0;
        let pairs = 0;
        const patterns = [];
        for (const start of [4, 16]) {
            const block = downbeats.slice(start + 1, start + 12 - 2).map(patternOf);
            patterns.push(block);
            for (let i = 0; i + 4 < block.length; i++) {
                pairs++;
                if (block[i] === block[i + 4] && block[i] !== '') same++;
            }
        }
        assert.ok(pairs >= 8);
        assert.ok(same / pairs >= 0.9, `d${difficulty}: solo ${same}/${pairs} compases repiten la frase: ${JSON.stringify(patterns)}`);
    }
});

test('velocidad base: sale del pulso jugable; el bpm del chart sigue siendo el real', () => {
    assert.equal(gameplayTempo(63), 126);
    assert.equal(gameplayTempo(40), 160, 'dos doblados');
    assert.equal(gameplayTempo(145.9), 145.9);
    assert.equal(gameplayTempo(250), 125);
    const slow = buildChart(makeSyntheticSong({ bpm: 63 }), { seed: 1 }).chart;
    const fast = buildChart(makeSyntheticSong({ bpm: 126 }), { seed: 1 }).chart;
    assert.equal(slow.music.bpm, 63);
    assert.equal(slow.world.speedPxS, fast.world.speedPxS);
});

test('formato 1 (análisis del navegador): pulso reconstruido, en rejilla y jugable', () => {
    for (const bpm of [80, 128, 170]) {
        const analysis = makeSyntheticAnalysis({ bpm, durationSec: 90, noisePerBeat: 4, seed: bpm });
        const { chart } = buildChart(analysis, { seed: 1 });
        const period = 60 / bpm;
        const truth = [];
        for (let t = 0; t < 90; t += period) truth.push(t);
        const off = obstacles(chart).filter((e) => !onGrid(e.t, truth, 0.015));
        assert.equal(off.length, 0, `${bpm} BPM: ${off.length}/${obstacles(chart).length} fuera del pulso real`);
        assert.ok(obstacles(chart).length > 15);
        const v = validatePlayability(toSimObstacles(obstacles(chart)), speedProfileOf(chart), { toleranceS: DIFFICULTY_PROFILES[3].toleranceS });
        assert.ok(v.ok, `${bpm} BPM: injugable en ${v.t}`);
    }
});

test('canciones extremas: vacía, muy corta o sin golpes no rompen', () => {
    const tiny = makeSyntheticAnalysis({ bpm: 120, durationSec: 4 });
    const { chart: empty } = buildChart(tiny, { seed: 1 });
    assert.equal(obstacles(empty).length, 0);
    assert.doesNotThrow(() => normalizeChart(empty));

    const noHits = { ...makeSyntheticAnalysis({ bpm: 120, durationSec: 40 }), onsets: [] };
    const { chart } = buildChart(noHits, { seed: 1 });
    assert.doesNotThrow(() => normalizeChart(chart));
    const v = validatePlayability(toSimObstacles(obstacles(chart)), speedProfileOf(chart));
    assert.ok(v.ok);
});

test('los 8 oficiales reales × 5 dificultades: jugables, en rejilla, sin avisos y con dinámica', async () => {
    const dir = path.join(ROOT, 'database/seeds/official/baked');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 8);
    for (const file of files) {
        const baked = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        const analysis = baked.analysis;
        for (const difficulty of [1, 2, 3, 4, 5]) {
            const { chart, report } = buildChart(analysis, { sha256: baked.audio.sha256, difficulty });
            const label = `${file} d${difficulty}→${report.difficulty}`;
            const { warnings } = normalizeChart(chart);
            assert.deepEqual(warnings, [], label);
            const obs = obstacles(chart);
            const v = validatePlayability(toSimObstacles(obs), speedProfileOf(chart), { toleranceS: DIFFICULTY_PROFILES[report.difficulty].toleranceS });
            assert.ok(v.ok, `${label}: patrón imposible en t=${v.t} (${v.pattern})`);
            const off = obs.filter((e) => !onGrid(e.t, analysis.beats, 0.065));
            assert.equal(off.length, 0, `${label}: ${off.length} acciones fuera de la rejilla`);
            assert.ok(report.difficulty <= (report.ceiling ?? 5), `${label}: por encima del techo`);
            assert.equal(sections(chart).filter((s) => s.climax).length, 1, `${label}: un clímax`);
        }
    }
});

test('publicar: el servidor prepara una variante por dificultad admitida, idéntica a chartear esa dificultad', async () => {
    const { chartFromAnalysis } = await import('../../scripts/lib/chartFromAnalysis.mjs');
    // HOPE (tranquila, techo 2) y What's Up Danger (techo 5).
    for (const slug of ['hope', 'whats-up-danger']) {
        const baked = JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${slug}.json`), 'utf8'));
        const { analysis } = baked;
        const sha = baked.audio.sha256;
        const out = chartFromAnalysis(analysis, sha, { variants: true });
        const ceiling = out.difficultyCeiling;
        const expectedKeys = ['auto', ...Array.from({ length: ceiling }, (_, i) => String(i + 1))];
        assert.deepEqual(Object.keys(out.variants).sort(), expectedKeys.sort(), `${slug}: Automática y 1..techo, nunca por encima`);
        for (const [key, chart] of Object.entries(out.variants)) {
            const difficulty = key === 'auto' ? 'auto' : Number(key);
            const expected = buildChart(analysis, { sha256: sha, seed: seedFromSha256(sha), difficulty }).chart;
            assert.deepEqual(chart, expected, `${slug} ${key}: la variante es exactamente ese chart`);
            assert.equal(normalizeChart(chart).warnings.length, 0, `${slug} ${key}: sin avisos`);
        }
        assert.deepEqual(out.variants.auto, out.chart, `${slug}: sin dificultad pedida, el chart del nivel es el de Automática`);
        if (ceiling >= 2) {
            const hard = obstacles(out.variants[String(ceiling)]).length;
            const easy = obstacles(out.variants['1']).length;
            assert.ok(hard > easy, `${slug}: cada variante es un nivel distinto (${easy} → ${hard} acciones)`);
        }
        assert.equal(chartFromAnalysis(analysis, sha).variants, null, `${slug}: sin pedirlas (horneado), no se generan`);
    }
});

test('el charter escala linealmente con la duración de la canción', () => {
    // Por proporción y no en milisegundos: estable en cualquier máquina.
    const short = makeSyntheticSong({ bpm: 128, sections: [{ bars: 16, energy: 0.6, hits: 0.7 }, { bars: 16, energy: 0.9, hits: 1 }] });
    const long = makeSyntheticSong({ bpm: 128, sections: Array.from({ length: 8 }, (_, i) => ({ bars: 16, energy: i % 2 ? 0.9 : 0.6, hits: i % 2 ? 1 : 0.7, cluster: i % 2 ? 'B' : 'A' })) });
    const tShort = minTime(() => buildChart(short, { seed: 1, difficulty: 4 }));
    const tLong = minTime(() => buildChart(long, { seed: 1, difficulty: 4 }));
    assert.ok(tLong < tShort * 9, `×4 de duración costó ×${(tLong / tShort).toFixed(1)}`);
});

/**
 * Tiempo MÍNIMO de varias ejecuciones tras calentar el JIT: la carga de la
 * máquina solo puede añadir tiempo, así que el mínimo es la estimación estable.
 */
function minTime(fn, runs = 7) {
    fn();
    fn();
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        fn();
        best = Math.min(best, performance.now() - t0);
    }
    return best;
}
