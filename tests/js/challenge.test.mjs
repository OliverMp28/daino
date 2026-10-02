// Exigencia y acentos (segundo y tercer playtest de la dificultad).
//
// "What's Up Danger en Extremo lo pasé a la segunda", "lo demás era lo típico de
// esquivar y saltar", "un nivel medio o difícil no puede pasarse a la primera
// como uno fácil". Y, un mes después, con hileras y cristales afilados ya puestos:
// "el Extremo lo pasé al segundo intento… si es extremo debe ser realmente
// extremo". Se mide con un jugador de referencia CON PRÁCTICA: pulsa sobre el
// golpe con un error gaussiano de ±30 ms y mantiene el salto donde le conviene,
// jugando de verdad con la física (challenge.referencePassRate).
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
import { speedProfileOf } from '../../resources/js/game/systems/speedProfile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const obstacles = (chart) => chart.events.filter((e) => e.type === 'obstacle');

async function baked(slug) {
    return JSON.parse(await readFile(path.join(ROOT, `database/seeds/official/baked/${slug}.json`), 'utf8'));
}

test('jugador de referencia: la probabilidad de fallar sale de la normal y la exigencia se suma', () => {
    const sigma = REFERENCE_PLAYER.sigmaS;
    // Un margen de una desviación por cada lado: 2 × 15.87 %.
    assert.equal(sigma, 0.03, 'alguien con práctica: ±30 ms');
    assert.ok(Math.abs(missChance(sigma, sigma) - 0.3173) < 1e-3);
    assert.ok(Math.abs(missChance(Infinity, 2 * sigma) - 0.02275) < 1e-4, 'solo el lado tarde');
    assert.ok(missChance(0.06, 0.06) < missChance(0.045, 0.06), 'menos margen, más fallos');
    assert.equal(missChance(0.07, 0.05), missChance(0.05, 0.07), 'simétrica');
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
    assert.ok(precise.passRate > a.passRate, `±20 ms supera ${precise.passRate}, ±30 ms ${a.passRate}`);
    assert.ok(a.deaths.every((t) => t > 0 && t < chart.audio.durationSec));
});

test('márgenes del salto sin simular: coinciden con el barrido del simulador a menos de un paso, a toques y manteniendo', () => {
    // playability.timingMarginsS los pide al modo de correr (run.js::marginsS),
    // que integra el salto una vez y lo pasa por delante del obstáculo
    // (trackMargins.js). El charter los consulta miles de veces al elegir acentos:
    // tienen que ser los de la física. Un paso de medusa de cada cuatro basta (son
    // el mismo dibujo con otro hueco).
    const run = MOVEMENT_MODES.run;
    const kinds = Object.keys(OBSTACLE_KIND).filter((k) => OBSTACLE_KIND[k].action === 'jump').filter((k, i) => !OBSTACLE_KIND[k].gate || i % 4 === 0);
    for (const kind of kinds) {
        for (const [speed, holdS] of [[400, 0], [650, 0], [900, 0], [650, 0.45], [900, 0.45]]) {
            const fast = run.marginsS(OBSTACLE_KIND[kind], speed, holdS);
            const events = toSimObstacles([{ t: 5, type: 'obstacle', kind }]);
            const survives = (offset) => simulateRun(events, speed, { pressOffset: () => offset, tapS: holdS > 0 ? () => holdS : null }).ok;
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
            // El barrido se queda con la peor fase de la rejilla; el rastro da la media: hasta medio paso más.
            assert.ok(Math.abs(Math.min(fast.early, 0.4) - early) <= 0.012, `${kind}@${speed} (${holdS}): pronto ${fast.early} vs ${early}`);
            assert.ok(Math.abs(Math.min(fast.late, 0.4) - late) <= 0.012, `${kind}@${speed} (${holdS}): tarde ${fast.late} vs ${late}`);
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
            // La mayoría sobre un golpe fuerte; el resto, cambios de acorde sobre el pulso y
            // entradas tras un silencio de juego (donde cabe un paso de medusa), que
            // entran con un golpe más flojo pero que se oye.
            const onStrong = accents.filter((e) => strongNear(e.t)).length / accents.length;
            assert.ok(onStrong >= 0.65, `${slug} d${difficulty}: solo el ${(onStrong * 100).toFixed(0)} % sobre golpes fuertes`);
            const audible = (t) => analysis.onsets.some(([ot, st]) => Math.abs(ot - t) <= 0.065 && st >= ACCENT_RULES.relaxedStrength);
            const gates = accents.filter((e) => OBSTACLE_KIND[e.kind].gate === true);
            const heard = gates.filter((e) => audible(e.t)).length / Math.max(1, gates.length);
            assert.ok(heard >= 0.85, `${slug} d${difficulty}: solo el ${(heard * 100).toFixed(0)} % de los acentos de dos lados sobre un golpe que se oye`);
            // Lo que aprietan los que más aprietan: el margen (del lado estrecho, a la
            // velocidad con la que cruza cada uno) por debajo del cual queda uno de cada cinco.
            const speed = speedProfileOf(chart);
            const margins = accents.map((e) => {
                const m = timingMarginsS(e.kind, speed.speedAt(e.t + actionLeadS(OBSTACLE_KIND[e.kind])));
                return Math.min(m.early, m.late);
            }).sort((a, b) => a - b);
            meanMargin.push(margins[Math.floor(margins.length / 5)]);
        }
        for (let i = 1; i < meanMargin.length; i++) {
            assert.ok(meanMargin[i] < meanMargin[i - 1] + 0.003, `${slug}: los acentos no se estrechan con la dificultad (${meanMargin.map((m) => m.toFixed(3))})`);
        }
    }
});

test('regresión de los playtests: cada dificultad exige más y Extremo es difícil de verdad para quien ya juega bien, no imposible', async () => {
    // Segundo playtest (charter 8, ±45 ms a toques): What's Up Danger en Extremo se
    // superaba el 51 % de las veces. Tercero (charter 14): con ±45 ms ya era el 7 %,
    // pero con ±30 ms y manteniendo los saltos, el 88 %: "lo pasé al segundo intento".
    const wud = await baked('whats-up-danger');
    const pass = {};
    let extreme = null;
    for (const difficulty of [3, 4, 5]) {
        const { chart } = buildChart(wud.analysis, { sha256: wud.audio.sha256, difficulty });
        pass[difficulty] = referencePassRate(chart, { runs: 80, seed: 3 });
        if (difficulty === 5) extreme = chart;
    }
    assert.ok(pass[3].passRate > pass[4].passRate && pass[4].passRate > pass[5].passRate, `Normal ${pass[3].passRate} > Difícil ${pass[4].passRate} > Extremo ${pass[5].passRate}`);
    assert.ok(pass[3].passRate <= 0.85, `Normal no se supera casi siempre a la primera: ${pass[3].passRate}`);
    assert.ok(pass[5].passRate <= 0.28, `Extremo con ±30 ms: ${pass[5].passRate}`);
    const precise = referencePassRate(extreme, { runs: 80, seed: 3, sigmaS: 0.02 });
    assert.ok(precise.passRate >= 0.7, `quien juega con ±20 ms debe poder superarlo: ${precise.passRate}`);

    // Se muere donde la música aprieta: en el primer cuarto de la canción, poco.
    const deaths = pass[5].deaths;
    const early = deaths.filter((t) => t < extreme.audio.durationSec * 0.25).length;
    assert.ok(early <= deaths.length * 0.2, `${early} de ${deaths.length} muertes en el primer cuarto`);

    const dawn = await baked('dawn-of-faith');
    const { chart: hard } = buildChart(dawn.analysis, { sha256: dawn.audio.sha256, difficulty: 4 });
    const dawnPass = referencePassRate(hard, { runs: 80, seed: 3 }).passRate;
    assert.ok(dawnPass <= 0.5, `Dawn of Faith en Difícil (65 BPM, saltos a un beat): ${dawnPass}`);
});

test('la exigencia no depende del gesto: a toques, manteniendo o adelantándose, un nivel cuesta lo mismo', async () => {
    // Tercer playtest, medido con ±30 ms en Dawn of Faith (Difícil, charter 14 con
    // los márgenes de hoy): a toques se superaba el 12 % de las veces; manteniendo
    // los saltos, el 45 %; adelantándose 35 ms, el 99 %. Una hilera solo aprieta a
    // quien da un toque en el golpe. Con los acentos de dos lados (pasos de medusa
    // y pinzas) adelantarse ya no regala nada.
    for (const [slug, difficulty] of [['dawn-of-faith', 4], ['whats-up-danger', 5], ['mi-fiesta', 4]]) {
        const { analysis, audio } = await baked(slug);
        const { chart } = buildChart(analysis, { sha256: audio.sha256, difficulty });
        const reference = referencePassRate(chart, { runs: 80, seed: 21 }).passRate;
        const taps = referencePassRate(chart, { runs: 80, seed: 21, hold: false }).passRate;
        const early = referencePassRate(chart, { runs: 80, seed: 21, biasS: -0.035 }).passRate;
        assert.ok(Math.abs(reference - taps) <= 0.15, `${slug} d${difficulty}: manteniendo donde conviene ${reference}, a toques ${taps}`);
        assert.ok(early <= reference + 0.1, `${slug} d${difficulty}: adelantándose 35 ms se supera ${early} frente a ${reference}`);
    }
});

test('lo que promete cada dificultad: bandas medidas con el jugador de referencia en canciones de verdad', async () => {
    // Lo que se pidió: 3★ se pasa al segundo o tercer intento; 4★ cuesta cinco o
    // más y no todo el mundo llega; 5★ lo supera casi nadie. "Pasarlo al intento N"
    // es superar ~1/N partidas. El jugador de referencia (±30 ms) es alguien con
    // práctica: quien pulsa con ±35 ms supera la mitad que él en Normal, la tercera
    // parte en Difícil y la décima en Extremo, que es donde caen esos intentos.
    //
    // Medido con 300 partidas sobre los 9 oficiales (charter 15), en las canciones
    // enteras: Relajado y Fácil 1.00 · Normal 0.69-0.78 · Difícil 0.25-0.46 ·
    // Extremo 0.10-0.15. (Los clips de 40 s quedan por encima: 0.79-0.90, 0.77-0.80
    // y 0.55-0.58; no tienen golpes para gastar la exigencia. Ver doc 10.)
    const BANDS = [
        { level: 1, min: 0.95, max: 1 },
        { level: 3, min: 0.5, max: 0.85 },
        { level: 4, min: 0.15, max: 0.55 },
        { level: 5, min: 0.03, max: 0.25 },
    ];
    for (const slug of ['whats-up-danger', 'mi-fiesta', 'dawn-of-faith']) {
        const { analysis, audio } = await baked(slug);
        for (const band of BANDS) {
            const { chart, report } = buildChart(analysis, { sha256: audio.sha256, difficulty: band.level });
            if (report.difficulty !== band.level) continue; // la canción no admite esa dificultad
            const { passRate } = referencePassRate(chart, { runs: 80, seed: 11 });
            assert.ok(passRate >= band.min - 0.08 && passRate <= band.max + 0.08,
                `${slug} en ${band.level}★: supera ${passRate} y su banda es ${band.min}-${band.max}`);
        }
    }
});

test('un nivel de 5★ es durísimo, no imposible: quien juega muy preciso lo supera', async () => {
    const { analysis, audio } = await baked('whats-up-danger');
    const { chart } = buildChart(analysis, { sha256: audio.sha256, difficulty: 5 });
    // El validador ya garantiza que es jugable con la tolerancia de la dificultad;
    // esto mide que además hay un camino humano: cuanto más preciso, más se supera.
    const rates = [0.02, 0.03, 0.045].map((sigmaS) => referencePassRate(chart, { runs: 60, seed: 5, sigmaS }).passRate);
    assert.ok(rates[0] >= 0.75, `con ±20 ms debería superarse casi siempre: ${rates[0]}`);
    assert.ok(rates[0] > rates[1] && rates[1] >= rates[2], `más preciso, más se supera: ${rates}`);
});
