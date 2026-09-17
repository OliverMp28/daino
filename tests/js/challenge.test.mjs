// Exigencia y acentos (segundo playtest de la dificultad).
//
// "What's Up Danger en Extremo lo pasé a la segunda", "lo demás era lo típico de
// esquivar y saltar", "un nivel medio o difícil no puede pasarse a la primera
// como uno fácil". Se mide con un jugador de referencia que pulsa sobre el golpe
// con un error gaussiano de ±45 ms, jugando de verdad con la física
// (challenge.referencePassRate).
//
// Invariantes protegidos:
//   - El jugador de referencia: probabilidades bien calculadas y Monte Carlo
//     determinista.
//   - Márgenes: los del salto calculados sin simular coinciden con el simulador.
//   - Registro: toda variante de acento es la misma acción que su kind base con
//     menos margen.
//   - Acentos: sobre golpes que suenan fuerte.
//   - Exigencia: cada dificultad exige más que la anterior; Extremo es difícil
//     de verdad sin ser imposible para quien juega preciso; y se muere donde la
//     música aprieta, no al principio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBSTACLE_KIND } from '../../resources/js/game/config.js';
import { buildChart } from '../../resources/js/game/levels/charter.js';
import { REFERENCE_PLAYER, hazardOf, missChance, referencePassRate } from '../../resources/js/game/levels/challenge.js';
import { ACCENT_RULES } from '../../resources/js/game/levels/accents.js';
import { MOVEMENT_MODES } from '../../resources/js/game/systems/modes/index.js';
import { actionLeadS } from '../../resources/js/game/systems/physics.js';
import { simulateRun, timingMarginsS, toSimObstacles } from '../../resources/js/game/systems/playability.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const obstacles = (chart) => chart.events.filter((e) => e.type === 'obstacle');

async function baked(slug) {
    return JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${slug}.json`), 'utf8'));
}

test('jugador de referencia: la probabilidad de fallar sale de la normal y la exigencia se suma', () => {
    const sigma = REFERENCE_PLAYER.sigmaS;
    // Un margen de una desviación por cada lado: 2 × 15.87 %.
    assert.ok(Math.abs(missChance(sigma, sigma) - 0.3173) < 1e-3);
    assert.ok(Math.abs(missChance(Infinity, 2 * sigma) - 0.02275) < 1e-4, 'solo el lado tarde');
    assert.ok(missChance(0.08, 0.08) < missChance(0.06, 0.08), 'menos margen, más fallos');
    assert.equal(missChance(0.1, 0.07), missChance(0.07, 0.1), 'simétrica');
    assert.equal(hazardOf(0), 0);
    assert.ok(Math.abs(hazardOf(0.5) - Math.LN2) < 1e-12, '−ln(1 − p)');
});

test('Monte Carlo del jugador de referencia: determinista y más preciso ⇒ supera más', async () => {
    const { analysis, audio } = await baked('mi-fiesta');
    const { chart } = buildChart(analysis, { sha256: audio.sha256, difficulty: 4 });
    const a = referencePassRate(chart, { runs: 30, seed: 7 });
    const b = referencePassRate(chart, { runs: 30, seed: 7 });
    assert.deepEqual(a, b, 'misma semilla, mismas partidas');
    const precise = referencePassRate(chart, { runs: 30, seed: 7, sigmaS: 0.02 });
    assert.ok(precise.passRate > a.passRate, `±20 ms supera ${precise.passRate}, ±45 ms ${a.passRate}`);
    assert.ok(a.deaths.every((t) => t > 0 && t < chart.audio.durationSec));
});

test('márgenes del salto sin simular: coinciden con el barrido del simulador a menos de un paso', () => {
    // playability.timingMarginsS los pide al modo de correr (run.js::marginsS),
    // que integra el salto una vez. El charter los consulta miles de veces al
    // elegir acentos: tienen que ser los de la física.
    const run = MOVEMENT_MODES.run;
    for (const kind of Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].action === 'jump')) {
        for (const speed of [400, 650, 900]) {
            const fast = run.marginsS(OBSTACLE_KIND[kind], speed);
            const events = toSimObstacles([{ t: 5, type: 'obstacle', kind }]);
            const survives = (offset) => simulateRun(events, speed, { pressOffset: () => offset }).ok;
            let early = 0;
            let late = 0;
            if (survives(0)) {
                while (early < 0.4 && survives(-(early + 0.002))) early += 0.002;
                while (late < 0.4 && survives(late + 0.002)) late += 0.002;
            }
            if (early === 0 && late === 0) {
                assert.ok(fast.early < 0.02 && fast.late < 0.02, `${kind}@${speed}: injugable y la fórmula da ${JSON.stringify(fast)}`);
                continue;
            }
            assert.ok(Math.abs(fast.early - early) <= 0.012, `${kind}@${speed}: pronto ${fast.early} vs ${early}`);
            assert.ok(Math.abs(fast.late - late) <= 0.012, `${kind}@${speed}: tarde ${fast.late} vs ${late}`);
        }
    }
});

test('registro: cada variante de acento es la misma acción que su kind base, con menos margen a alguna velocidad del juego', () => {
    const variants = Object.entries(OBSTACLE_KIND).filter(([, def]) => def.accentOf !== undefined);
    assert.ok(variants.length >= 2, 'hay variantes de acento');
    const narrowest = (m) => Math.min(m.early, m.late);
    for (const [kind, def] of variants) {
        const base = OBSTACLE_KIND[def.accentOf];
        assert.ok(base !== undefined, `${kind}: su base ${def.accentOf} existe`);
        assert.equal(base.accentOf, undefined, `${kind}: la base no es a su vez una variante`);
        for (const field of ['mode', 'action', 'surface']) assert.equal(def[field], base[field], `${kind}: mismo ${field} que ${def.accentOf}`);
        assert.equal(def.role, 'accent', `${kind}: papel de acento (nunca se elige por papel)`);
        // El charter solo la usa donde aprieta más que la acción normal
        // (accents.js::accentVariant); tiene que haber velocidades así.
        const tighterAt = [350, 450, 600, 750, 900, 1000].filter((v) => {
            const own = narrowest(timingMarginsS(kind, v));
            return own > 0 && own < narrowest(timingMarginsS(def.accentOf, v));
        });
        assert.ok(tighterAt.length > 0, `${kind}: a ninguna velocidad deja menos margen que ${def.accentOf}`);
        assert.ok(actionLeadS(def) > 0);
    }
});

test('acentos: sobre golpes que suenan fuerte, más estrechos cuanto más difícil', async () => {
    for (const slug of ['whats-up-danger', 'dawn-of-faith', 'mi-fiesta']) {
        const { analysis, audio } = await baked(slug);
        const strongNear = (t) => analysis.onsets.some(([ot, s]) => Math.abs(ot - t) <= 0.065 && s >= ACCENT_RULES.minStrength);
        const meanMargin = [];
        for (const difficulty of [3, 4, 5]) {
            const { chart, report } = buildChart(analysis, { sha256: audio.sha256, difficulty });
            if (report.difficulty !== difficulty) continue;
            const accents = obstacles(chart).filter((e) => OBSTACLE_KIND[e.kind].accentOf !== undefined);
            assert.ok(accents.length >= 10, `${slug} d${difficulty}: ${accents.length} acentos`);
            // Casi todos sobre un golpe fuerte; el resto, cambios de acorde sobre el pulso.
            const onStrong = accents.filter((e) => strongNear(e.t)).length / accents.length;
            assert.ok(onStrong >= 0.8, `${slug} d${difficulty}: solo el ${(onStrong * 100).toFixed(0)} % sobre golpes fuertes`);
            const margins = accents.map((e) => {
                const m = timingMarginsS(e.kind, 800);
                return Math.min(m.early, m.late);
            });
            meanMargin.push(margins.reduce((s, m) => s + m, 0) / margins.length);
        }
        for (let i = 1; i < meanMargin.length; i++) {
            assert.ok(meanMargin[i] < meanMargin[i - 1] + 0.005, `${slug}: los acentos no se estrechan con la dificultad (${meanMargin.map((m) => m.toFixed(3))})`);
        }
    }
});

test('regresión del segundo playtest: cada dificultad exige más y Extremo es difícil de verdad, no imposible', async () => {
    // Antes (charter 8), con ±45 ms: What's Up Danger en Extremo se superaba el
    // 51 % de las veces y Dawn of Faith en Difícil, sin su vuelo, el 100 %.
    const wud = await baked('whats-up-danger');
    const pass = {};
    let extreme = null;
    for (const difficulty of [3, 4, 5]) {
        const { chart } = buildChart(wud.analysis, { sha256: wud.audio.sha256, difficulty });
        pass[difficulty] = referencePassRate(chart, { runs: 60, seed: 3 });
        if (difficulty === 5) extreme = chart;
    }
    assert.ok(pass[3].passRate > pass[4].passRate && pass[4].passRate > pass[5].passRate, `Normal ${pass[3].passRate} > Difícil ${pass[4].passRate} > Extremo ${pass[5].passRate}`);
    assert.ok(pass[3].passRate <= 0.8, `Normal no se supera casi siempre a la primera: ${pass[3].passRate}`);
    assert.ok(pass[5].passRate <= 0.15, `Extremo con ±45 ms: ${pass[5].passRate}`);
    const precise = referencePassRate(extreme, { runs: 60, seed: 3, sigmaS: 0.03 });
    assert.ok(precise.passRate >= 0.35, `quien juega con ±30 ms debe poder superarlo: ${precise.passRate}`);

    // Se muere donde la música aprieta: en el primer cuarto de la canción, poco.
    const deaths = pass[5].deaths;
    const early = deaths.filter((t) => t < extreme.audio.durationSec * 0.25).length;
    assert.ok(early <= deaths.length * 0.25, `${early} de ${deaths.length} muertes en el primer cuarto`);

    const dawn = await baked('dawn-of-faith');
    const { chart: hard } = buildChart(dawn.analysis, { sha256: dawn.audio.sha256, difficulty: 4 });
    const dawnPass = referencePassRate(hard, { runs: 60, seed: 3 }).passRate;
    assert.ok(dawnPass <= 0.6, `Dawn of Faith en Difícil (65 BPM, saltos a un beat): ${dawnPass}`);
});
