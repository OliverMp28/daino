// El espectro en barras (T03.2, doc 11): bandas logarítmicas, lo que se mueve es
// lo que se ve, y el silencio es plano.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBands } from '../../resources/js/game/audio/features.js';
import { SPECTRUM_BARS, SPECTRUM_RULES, createSpectrum } from '../../resources/js/game/fx/spectrum.js';

const BINS = 1024;
const HZ = 44100 / 2 / BINS;

/** Bytes del AnalyserNode con un fondo y, opcionalmente, un tono en `hz`. */
function frame(background, hz = null, level = 255) {
    const bytes = new Uint8Array(BINS).fill(background);
    if (hz !== null) {
        const bin = Math.round(hz / HZ);
        for (let b = Math.max(0, bin - 1); b <= Math.min(BINS - 1, bin + 1); b++) bytes[b] = level;
    }
    return bytes;
}

test('bandas logarítmicas: sin solaparse, sin huecos y con la música repartida a lo ancho', () => {
    const sp = createSpectrum({ bins: BINS });
    const ranges = sp.ranges();
    assert.equal(ranges.length, SPECTRUM_RULES.bars);
    for (let i = 0; i < ranges.length; i++) {
        const [from, to] = ranges[i];
        assert.ok(to > from, `barra ${i} vacía`);
        if (i > 0) assert.equal(from, ranges[i - 1][1], `hueco o solape antes de la barra ${i}`);
    }
    assert.ok(ranges[0][0] * HZ < 60, 'empieza en los graves');
    assert.ok(ranges.at(-1)[1] * HZ > 9000 && ranges.at(-1)[1] * HZ < 13000, 'acaba donde acaba la música');
    // Cada barra, el mismo intervalo musical: las de arriba abarcan muchos más bins.
    assert.ok(ranges.at(-1)[1] - ranges.at(-1)[0] > 20 * (ranges[0][1] - ranges[0][0]));
    // 1 kHz cae hacia la mitad, no en el primer 5 % como en un reparto lineal.
    const mid = ranges.findIndex(([from, to]) => from * HZ <= 1000 && to * HZ > 1000);
    assert.ok(mid > ranges.length * 0.4 && mid < ranges.length * 0.75, `1 kHz en la barra ${mid}`);
});

test('el silencio es plano y un golpe levanta su barra, no las demás', () => {
    const sp = createSpectrum({ bins: BINS });
    for (let i = 0; i < 120; i++) sp.update(frame(0), 1 / 60);
    assert.ok(sp.bars.every((v) => v === 0), 'silencio');

    // Un fondo constante (una nota sostenida en todas las bandas) se aplana…
    for (let i = 0; i < 600; i++) sp.update(frame(140), 1 / 60);
    assert.ok(Math.max(...sp.bars) < 0.12, `fondo sostenido: ${Math.max(...sp.bars)}`);
    // …y un golpe en 100 Hz sobre ese fondo destaca en los graves.
    sp.update(frame(140, 100), 1 / 60);
    const hit = sp.bars.indexOf(Math.max(...sp.bars));
    assert.ok(hit <= 5, `el golpe grave, en la barra ${hit}`);
    assert.ok(sp.bars[hit] > 0.5, `nivel del golpe: ${sp.bars[hit]}`);
    assert.ok(sp.bars[SPECTRUM_RULES.bars - 1] < 0.12, 'los agudos no se mueven');
});

test('una barra sube al instante y cae suave', () => {
    const sp = createSpectrum({ bins: BINS });
    // Tiempo de sobra para que cada barra conozca su fondo.
    for (let i = 0; i < 1200; i++) sp.update(frame(120), 1 / 60);
    sp.update(frame(120, 2000), 1 / 60);
    const bar = sp.bars.indexOf(Math.max(...sp.bars));
    const peak = sp.bars[bar];
    assert.ok(peak > 0.5);
    let prev = peak;
    for (let i = 0; i < 12; i++) {
        sp.update(frame(120), 1 / 60);
        assert.ok(sp.bars[bar] < prev && sp.bars[bar] > prev * 0.8, 'cae poco a poco');
        prev = sp.bars[bar];
    }
    for (let i = 0; i < 120; i++) sp.update(frame(120), 1 / 60);
    assert.ok(sp.bars[bar] < 0.02, 'y termina en cero');
});

test('por debajo del suelo de ruido no hay barras; reset deja silencio', () => {
    const sp = createSpectrum({ bins: BINS });
    // Un golpe muy flojo (bajo la puerta) no se enseña.
    const quiet = Math.round(SPECTRUM_RULES.gate * 255) - 4;
    sp.update(frame(0, 400, quiet), 1 / 60);
    assert.ok(sp.bars.every((v) => v === 0));
    sp.update(frame(60, 400), 1 / 60);
    assert.ok(Math.max(...sp.bars) > 0.5);
    sp.reset();
    assert.ok(sp.bars.every((v) => v === 0));
});

test('grupos (el mar por bandas) y lectura interpolada (las barras del paisaje)', () => {
    const sp = createSpectrum({ bins: BINS });
    sp.bars.fill(0);
    for (let i = 0; i < 4; i++) sp.bars[i] = 1;   // solo los graves
    const groups = sp.groups(6, new Float32Array(6));
    assert.ok(groups[0] > 0.9, 'el primer grupo son los graves');
    assert.ok(groups[5] === 0);
    assert.equal(sp.at(0), 1);
    assert.equal(sp.at(1), 0);
    assert.ok(sp.at(3.5 / (SPECTRUM_RULES.bars - 1)) > 0.4 && sp.at(3.5 / (SPECTRUM_RULES.bars - 1)) < 0.6);
    assert.equal(sp.at(-1), 1);
    assert.equal(sp.at(2), 0);
    assert.ok(SPECTRUM_BARS.count >= SPECTRUM_RULES.bars && SPECTRUM_BARS.maxRise > 0 && SPECTRUM_BARS.alpha[0] < SPECTRUM_BARS.alpha[1]);
});

test('bandas en vivo: lo mismo con los 1024 bins nativos que con 256', () => {
    const native = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) native[i] = i < 40 ? 200 : i < 400 ? 100 : 40;
    const small = new Uint8Array(256);
    for (let i = 0; i < 256; i++) small[i] = i < 10 ? 200 : i < 100 ? 100 : 40;
    const a = computeBands(native);
    const b = computeBands(small);
    for (const k of ['bass', 'mid', 'high']) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, k);
    assert.ok(Math.abs(a.bass - 200 / 255) < 1e-9);
    const out = { bass: 0, mid: 0, high: 0 };
    assert.equal(computeBands(native, out), out, 'sin asignaciones en el bucle de render');
});
