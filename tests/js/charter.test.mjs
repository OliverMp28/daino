// Charter: análisis → chart jugable (Ola 3).
//
// El charter es puro, así que estos tests usan análisis sintéticos con la
// distribución de fuerzas medida en audio real (ver makeSyntheticAnalysis) y
// corren en milisegundos. El análisis de audio de verdad se prueba en
// analyze.test.mjs.
//
// Invariantes protegidos:
//   - Determinismo: mismo análisis + misma seed ⇒ mismo chart byte a byte.
//   - Musicalidad: los eventos caen en golpes, nunca en picos de ruido.
//   - Justicia: todo chart generado es superable con ±40 ms.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildChart,
    CHARTER_RULES,
    dropWeakOnsets,
    fillGapsOnBeats,
    gameplayTempo,
    selectStrongestSpaced,
    snapFillersToBeats,
} from '../../resources/js/game/levels/charter.js';
import { normalizeChart, seedFromSha256 } from '../../resources/js/game/levels/chartFormat.js';
import { OBSTACLE_KIND } from '../../resources/js/game/config.js';
import { actionLeadS } from '../../resources/js/game/systems/physics.js';
import { toSimObstacles, validatePlayability } from '../../resources/js/game/systems/playability.js';
import { makeSyntheticAnalysis } from './helpers/synthetic-audio.mjs';

const SHA = 'c0ffee'.padEnd(64, '0');

const isOnBeat = (t, bpm, firstBeatS = 0) => {
    const period = 60 / bpm;
    const k = Math.round((t - firstBeatS) / period);
    return Math.abs(t - (firstBeatS + k * period)) <= 0.0015;
};

test('misma entrada + misma seed ⇒ mismo chart, byte a byte', () => {
    const analysis = makeSyntheticAnalysis({ bpm: 130 });
    const a = buildChart(analysis, { seed: 4242, sha256: SHA }).chart;
    const b = buildChart(analysis, { seed: 4242, sha256: SHA }).chart;
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.seed, 4242);
    assert.equal(a.audio.sha256, SHA);
});

test('sin seed explícita se deriva del hash: mismo archivo ⇒ mismo nivel', () => {
    const analysis = makeSyntheticAnalysis({ bpm: 130 });
    const a = buildChart(analysis, { sha256: SHA }).chart;
    assert.equal(a.seed, seedFromSha256(SHA));
    assert.equal(JSON.stringify(a), JSON.stringify(buildChart(analysis, { sha256: SHA }).chart));
});

test('seeds distintas cambian los tipos, no los instantes', () => {
    const analysis = makeSyntheticAnalysis({ bpm: 130 });
    const a = buildChart(analysis, { seed: 1 }).chart;
    const b = buildChart(analysis, { seed: 999 }).chart;
    assert.deepEqual(a.events.map((e) => e.t), b.events.map((e) => e.t));
    assert.notEqual(a.events.map((e) => e.kind).join(), b.events.map((e) => e.kind).join());
});

test('ningún evento cae en un pico de ruido: todos sobre golpes', () => {
    for (const bpm of [70, 90, 128, 150, 174, 200]) {
        for (const seed of [1, 2]) {
            const analysis = makeSyntheticAnalysis({ bpm, durationSec: 90, seed, noisePerBeat: 4 });
            const { chart, report } = buildChart(analysis, { seed });
            const off = chart.events.filter((e) => !isOnBeat(e.t, bpm));
            assert.equal(off.length, 0, `${bpm} BPM: ${off.length}/${chart.events.length} fuera de beat (${JSON.stringify(report)})`);
            assert.ok(chart.events.length > 40, `${bpm} BPM: solo ${chart.events.length} eventos`);
        }
    }
});

test('respeta la ventana inicial, el hueco mínimo y el descanso final', () => {
    const analysis = makeSyntheticAnalysis({ bpm: 140, durationSec: 60 });
    const { chart } = buildChart(analysis, { seed: 3 });
    const maxLead = Math.max(...Object.values(OBSTACLE_KIND).map(actionLeadS));

    assert.ok(chart.events[0].t >= CHARTER_RULES.firstActionMinS - 1e-9);
    const last = chart.events.at(-1);
    assert.ok(last.t + maxLead <= analysis.durationSec - CHARTER_RULES.tailRestS + 1e-3);
    for (let i = 1; i < chart.events.length; i++) {
        const gap = chart.events[i].t - chart.events[i - 1].t;
        assert.ok(gap >= CHARTER_RULES.minGapS - 0.001, `hueco ${gap.toFixed(3)} s en ${i}`);
    }
});

test('los kinds con availableFromS no aparecen antes de su gracia', () => {
    const { chart } = buildChart(makeSyntheticAnalysis({ bpm: 150 }), { seed: 3 });
    for (const e of chart.events) {
        assert.ok(e.t >= (OBSTACLE_KIND[e.kind].availableFromS ?? 0), `"${e.kind}" en t=${e.t}`);
    }
});

test('todo chart generado es superable con un jugador de ±40 ms', () => {
    for (const bpm of [60, 80, 100, 128, 160, 190, 220]) {
        for (const seed of [1, 2, 3, 4]) {
            const analysis = makeSyntheticAnalysis({ bpm, durationSec: 120, seed });
            const { chart, report } = buildChart(analysis, { seed });
            const v = validatePlayability(toSimObstacles(chart.events), chart.world.speedPxS);
            assert.ok(v.ok, `${bpm} BPM seed ${seed}: injugable en t=${v.t} (${v.pattern}), reparados ${report.repaired}`);
        }
    }
});

test('ante dos onsets demasiado juntos se queda el más fuerte, no el primero', () => {
    const accepted = selectStrongestSpaced([
        { t: 5.0, strength: 0.2 },   // pre-transitorio débil: pierde contra 5.1
        { t: 5.1, strength: 0.9 },   // el golpe de verdad
        { t: 6.0, strength: 0.5 },   // a 0.9 s de 5.1: cabe
    ], 0.7);
    assert.deepEqual(accepted, [5.1, 6.0]);
});

test('el suelo LOCAL quita el ruido pero conserva una estrofa suave', () => {
    const onsets = [
        { t: 10.0, strength: 0.9 },
        { t: 10.5, strength: 0.05 },  // ruido junto a golpes fuertes
        { t: 11.0, strength: 0.9 },
        { t: 30.0, strength: 0.2 },   // estrofa suave, lejos de los fuertes
        { t: 31.0, strength: 0.22 },
        { t: 32.0, strength: 0.21 },
    ];
    assert.deepEqual(dropWeakOnsets(onsets, 4, 0.3).map((o) => o.t), [10.0, 11.0, 30.0, 31.0, 32.0]);
});

test('el suelo local es O(n): su coste no depende del tamaño de la ventana', () => {
    // Test de COMPLEJIDAD, no de milisegundos: compara dos tiempos medidos en
    // la misma máquina y en el mismo momento, así que no depende de lo cargada
    // que esté. Con n fijo se multiplica la ventana ×80: una implementación
    // ingenua O(n·ventana) tardaría ~×80; la cola monótona, lo mismo.
    const make = (n) => {
        const out = [];
        for (let i = 0; i < n; i++) out.push({ t: i * 0.02, strength: ((i * 7919) % 97) / 97 });
        return out;
    };
    const onsets = make(40_000);
    const small = minTime(() => dropWeakOnsets(onsets, 0.5, 0.3));   // ventana ~50
    const large = minTime(() => dropWeakOnsets(onsets, 40, 0.3));    // ventana ~4000
    assert.ok(large < small * 8, `ventana ×80 costó ×${(large / small).toFixed(1)} (O(n·ventana) daría ~×80)`);
});

test('D17: un relleno nunca queda a menos del hueco mínimo del siguiente golpe', () => {
    const anchors = [3.0, 4.95, 9.0];
    const out = fillGapsOnBeats(anchors, { beatPeriodS: 0.45, minGapS: 0.7, maxGapS: 1.8, tMin: 3, tMax: 20 });
    for (let i = 1; i < out.length; i++) {
        assert.ok(out[i] - out[i - 1] >= 0.7 - 1e-9, `hueco ${(out[i] - out[i - 1]).toFixed(3)} entre ${out[i - 1]} y ${out[i]}`);
    }
    const fillers = out.filter((t) => !anchors.includes(t));
    assert.ok(fillers.length > 0);
    for (const f of fillers) {
        const anchor = anchors.filter((a) => a < f).pop();
        const beats = (f - anchor) / 0.45;
        assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6, `relleno ${f} no cae en beat desde ${anchor}`);
    }
});

test('los rellenos se anclan localmente: un error de BPM no los saca del beat', () => {
    // Golpes reales a 120 BPM (0.5 s) pero el análisis cree 121 BPM (≈1 % de
    // error, típico). Con una rejilla global los rellenos derivarían; anclados
    // al golpe anterior, siguen a milisegundos del beat.
    const real = [];
    for (let i = 0; i < 20; i++) real.push(3 + i * 10);   // golpes sueltos, huecos de 10 s
    const out = fillGapsOnBeats(real, { beatPeriodS: 60 / 121, minGapS: 0.7, maxGapS: 1.8, tMin: 3, tMax: 200 });
    for (const t of out) {
        const err = Math.abs(t - (3 + Math.round((t - 3) / 0.5) * 0.5));
        assert.ok(err < 0.1, `relleno en ${t.toFixed(3)} a ${(err * 1000).toFixed(0)} ms del beat real`);
    }
});

test('v2: la velocidad sale del pulso jugable; el bpm del chart sigue siendo el real', () => {
    assert.equal(gameplayTempo(63), 126);
    assert.equal(gameplayTempo(40), 160, 'dos doblados');
    assert.equal(gameplayTempo(145.9), 145.9);
    assert.equal(gameplayTempo(250), 125);
    const slow = buildChart(makeSyntheticAnalysis({ bpm: 63, durationSec: 40 }), { seed: 1 }).chart;
    const fast = buildChart(makeSyntheticAnalysis({ bpm: 126, durationSec: 40 }), { seed: 1 }).chart;
    assert.equal(slow.music.bpm, 63);
    assert.equal(slow.world.speedPxS, fast.world.speedPxS);
});

test('v2: con beats reales del analizador, los rellenos caen EN esos beats', () => {
    // Beats reales con swing y pequeñas irregularidades (lo que devuelve un
    // seguidor de beats de verdad); el análisis dice el periodo medio.
    const beats = [];
    for (let i = 0, t = 1; t < 120; i++) {
        beats.push(Math.round(t * 1000) / 1000);
        t += 0.5 + (i % 2 === 0 ? 0.012 : -0.012) + ((i % 7) - 3) * 0.002;
    }
    const analysis = {
        ...makeSyntheticAnalysis({ bpm: 120, durationSec: 120, noisePerBeat: 0 }),
        // Casi ningún golpe utilizable: el nivel es sobre todo relleno. Los
        // onsets de un análisis real caen en su golpe, que coincide con su beat.
        onsets: [[beats[8], 1], [beats[79], 1], [beats[159], 1]],
        beats,
    };
    const { chart, report } = buildChart(analysis, { seed: 3 });
    assert.ok(report.fillers > 30);
    for (const e of chart.events) {
        const nearest = beats.reduce((best, b) => (Math.abs(b - e.t) < Math.abs(best - e.t) ? b : best), beats[0]);
        assert.ok(Math.abs(nearest - e.t) <= 0.0011, `evento en ${e.t} a ${((e.t - nearest) * 1000).toFixed(1)} ms de un beat real`);
    }
    for (let i = 1; i < chart.events.length; i++) {
        assert.ok(chart.events[i].t - chart.events[i - 1].t >= CHARTER_RULES.minGapS - 1e-9);
    }
    assert.ok(validatePlayability(toSimObstacles(chart.events), chart.world.speedPxS).ok);
});

test('v2: llevar un relleno a su beat nunca rompe el hueco mínimo', () => {
    const out = snapFillersToBeats([3.0, 3.72, 4.44], [3.0], [3.0, 3.6, 4.2, 4.44], { maxShiftS: 0.15, minGapS: 0.7, tMin: 3, tMax: 10 });
    assert.equal(out[1], 3.72, '3.6 quedaría a 0.6 s del golpe anterior: se respeta el relleno');
    assert.equal(out[2], 4.44);
});

test('D13: los onsets anteriores a la ventana no suprimen onsets válidos', () => {
    const analysis = makeSyntheticAnalysis({ bpm: 120, durationSec: 30 });
    analysis.onsets = [[2.9, 1.0], [3.3, 0.8]];
    const { chart } = buildChart(analysis, { seed: 1 });
    assert.ok(chart.events.some((e) => e.t === 3.3), 'el onset de 3.3 s debe sobrevivir');
});

test('una canción sin golpes utilizables se rellena y es jugable', () => {
    const analysis = { ...makeSyntheticAnalysis({ bpm: 120, durationSec: 40 }), onsets: [] };
    const { chart } = buildChart(analysis, { seed: 1 });
    assert.ok(chart.events.length > 10);
    assert.ok(validatePlayability(toSimObstacles(chart.events), chart.world.speedPxS).ok);
});

test('una canción demasiado corta produce un chart vacío, no uno roto', () => {
    const analysis = makeSyntheticAnalysis({ bpm: 120, durationSec: 4 });
    const { chart } = buildChart(analysis, { seed: 1 });
    assert.equal(chart.events.length, 0);
    assert.doesNotThrow(() => normalizeChart(chart));
});

test('el charter escala linealmente con la duración de la canción', () => {
    // Una canción el cuádruple de larga debe costar ~×4, no ×16. De nuevo por
    // proporción y no en milisegundos, para ser estable en cualquier máquina.
    const short = makeSyntheticAnalysis({ bpm: 128, durationSec: 60, noisePerBeat: 6 });
    const long = makeSyntheticAnalysis({ bpm: 128, durationSec: 240, noisePerBeat: 6 });
    const tShort = minTime(() => buildChart(short, { seed: 1 }));
    const tLong = minTime(() => buildChart(long, { seed: 1 }));
    assert.ok(tLong < tShort * 9, `×4 de duración costó ×${(tLong / tShort).toFixed(1)}`);
});

/**
 * Tiempo MÍNIMO de varias ejecuciones tras calentar el JIT.
 *
 * Mínimo y no media ni mediana: la carga de la máquina (otros procesos, otros
 * archivos de test en paralelo, el GC) solo puede AÑADIR tiempo, nunca
 * quitarlo. El mínimo es la mejor estimación del coste intrínseco del código y
 * la única que se mantiene estable en una máquina ocupada.
 */
function minTime(fn, runs = 9) {
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
