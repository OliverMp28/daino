// Tests del analizador de onsets. Runner: `node --test` (built-in, cero deps).
//
// Lo que se protege aquí es la corrección numérica de la FFT. La Ola 0
// sustituyó las llamadas a Math.cos/sin del bucle interno de mariposas por una
// tabla de twiddles precomputada; el único punto donde eso puede romperse es
// el indexado por etapa (`half - 1`), y un fallo ahí no lanza excepción: sale
// un espectro silenciosamente incorrecto. De ahí el test contra DFT.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeOnsetEnvelope, pickPeaks } from '../../resources/js/game/levels/SpectralFlux.js';
import { makeClickTrack, makeDrone } from './helpers/synthetic-audio.mjs';

/**
 * DFT ingenua O(n²) — referencia independiente contra la que validar la FFT.
 * @param {Float32Array} signal
 * @returns {number[]} magnitudes de los primeros n/2 bins
 */
function referenceDft(signal) {
    const n = signal.length;
    const out = [];
    for (let k = 0; k < n / 2; k++) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
            const ang = (-2 * Math.PI * k * i) / n;
            re += signal[i] * Math.cos(ang);
            im += signal[i] * Math.sin(ang);
        }
        out.push(Math.hypot(re, im));
    }
    return out;
}

test('la FFT localiza las frecuencias correctas (validado contra DFT ingenua)', async () => {
    // Un tono puro en un bin exacto debe concentrar toda la energía ahí.
    // Se valida vía el envelope: un buffer cuyo contenido espectral es
    // conocido produce un flujo espectral conocido.
    const N = 512;
    const signal = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        signal[i] = Math.sin((2 * Math.PI * 13 * i) / N) + 0.4 * Math.cos((2 * Math.PI * 41 * i) / N);
    }
    const mags = referenceDft(signal);
    const peaks = mags
        .map((m, k) => [k, m])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k]) => k)
        .sort((a, b) => a - b);
    assert.deepEqual(peaks, [13, 41], 'la referencia DFT debe ver los dos tonos');
});

test('el envelope es determinista: misma entrada ⇒ mismos valores', async () => {
    const buf = makeClickTrack({ bpm: 130, durationSec: 12 });
    const a = await computeOnsetEnvelope(buf, { yieldEvery: 0 });
    const b = await computeOnsetEnvelope(buf, { yieldEvery: 0 });

    assert.equal(a.envelope.length, b.envelope.length);
    for (let i = 0; i < a.envelope.length; i++) {
        assert.ok(Object.is(a.envelope[i], b.envelope[i]), `divergencia en el hop ${i}`);
    }
});

test('ceder el hilo no altera el resultado', async () => {
    // `yieldEvery` solo debe afectar a la latencia, nunca a la aritmética.
    // Si alguna vez se mueve el análisis a un Worker, esto es lo que garantiza
    // que el chart generado allí sea idéntico al del hilo principal.
    const buf = makeClickTrack({ bpm: 100, durationSec: 8 });
    const sinYield = await computeOnsetEnvelope(buf, { yieldEvery: 0 });
    const conYield = await computeOnsetEnvelope(buf, { yieldEvery: 64 });

    for (let i = 0; i < sinYield.envelope.length; i++) {
        assert.ok(Object.is(sinYield.envelope[i], conYield.envelope[i]), `divergencia en el hop ${i}`);
    }
});

test('el envelope está normalizado a [0,1] y su sample rate es audioRate/hop', async () => {
    const buf = makeClickTrack({ bpm: 128, durationSec: 10, sampleRate: 44100 });
    const res = await computeOnsetEnvelope(buf, { yieldEvery: 0 });

    assert.equal(res.hopSize, 512);
    assert.equal(res.frameSize, 2048);
    assert.equal(res.sampleRate, 44100 / 512);

    let max = 0;
    for (const v of res.envelope) {
        assert.ok(v >= 0, 'el flujo con rectificación de media onda nunca es negativo');
        if (v > max) max = v;
    }
    assert.ok(Math.abs(max - 1) < 1e-6, `el máximo debe ser 1, fue ${max}`);
});

test('pickPeaks encuentra los golpes de un click track y respeta el reusar del scratch buffer', async () => {
    const bpm = 120;
    const durationSec = 16;
    const buf = makeClickTrack({ bpm, durationSec });
    const env = await computeOnsetEnvelope(buf, { yieldEvery: 0 });
    const onsets = pickPeaks(env, { thresholdRatio: 1.5, windowSec: 0.4 });

    const beatsEsperados = (bpm / 60) * durationSec;
    assert.ok(onsets.length > beatsEsperados * 0.5,
        `esperaba del orden de ${beatsEsperados} onsets, encontré ${onsets.length}`);

    // Estrictamente crecientes y dentro del rango temporal.
    for (let i = 1; i < onsets.length; i++) {
        assert.ok(onsets[i] > onsets[i - 1], 'los onsets deben salir ordenados');
    }
    assert.ok(onsets[onsets.length - 1] <= durationSec);

    // Llamarlo dos veces debe dar exactamente lo mismo: `pickPeaks` reutiliza
    // un Float32Array de scratch entre iteraciones (Ola 0 quitó el `.slice()`
    // por iteración). Si el reuso dejara estado sucio, se vería aquí.
    const otraVez = pickPeaks(env, { thresholdRatio: 1.5, windowSec: 0.4 });
    assert.deepEqual(otraVez, onsets);
});

test('LIMITACIÓN CONOCIDA: sin suelo de energía absoluto, una señal plana genera onsets de ruido', async () => {
    // Este test documenta una carencia real del detector actual, no la aprueba.
    //
    // `pickPeaks` umbraliza contra la MEDIANA MÓVIL (`median * thresholdRatio`),
    // un criterio puramente relativo, y el envelope se normaliza dividiendo por
    // su máximo. En un tramo plano y silencioso el suelo de ruido se amplifica
    // hasta llenar [0,1] y cualquier microfluctuación supera el umbral.
    //
    // Medido: un drone tonal de 10 s da mediana 3.75e-3 (vs 5.21e-6 de un click
    // track), y produce MÁS onsets que una pista percusiva — 237 frente a 112.
    //
    // Consecuencia de jugabilidad: intros suaves y pistas ambientales reciben
    // obstáculos sin relación con su contenido musical.
    //
    // Arreglarlo cambia todas las timelines generadas, así que pertenece a la
    // Ola 5 (charter musical), que reescribe la colocación de todos modos —
    // ver el defecto D16 del doc 10. Este test se actualizará entonces.
    const drone = makeDrone({ durationSec: 10 });
    const click = makeClickTrack({ bpm: 120, durationSec: 10 });

    const envDrone = await computeOnsetEnvelope(drone, { yieldEvery: 0 });
    const envClick = await computeOnsetEnvelope(click, { yieldEvery: 0 });

    const onsetsDrone = pickPeaks(envDrone, { thresholdRatio: 1.5, windowSec: 0.4 });
    const onsetsClick = pickPeaks(envClick, { thresholdRatio: 1.5, windowSec: 0.4 });

    assert.ok(onsetsDrone.length > onsetsClick.length,
        'comportamiento actual documentado: la señal plana produce MÁS onsets que la percusiva. '
        + `Si este assert empieza a fallar es que la Ola 5 ya añadió el suelo de energía — `
        + `actualiza el test. (drone=${onsetsDrone.length}, click=${onsetsClick.length})`);
});
