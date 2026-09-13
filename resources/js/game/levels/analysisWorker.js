// Web Worker del análisis local (Ola 4, doc 10): "probar mi canción" analiza
// fuera del hilo principal para que la interfaz no se congele.
//
// Recibe el audio YA mezclado a mono (ver `analysisClient.js`) y devuelve el
// mismo análisis que `analyzeAudio` en el hilo principal, bit a bit.
//
// Protocolo (un mensaje por petición, varias pueden convivir):
//   ← { id, samples: Float32Array, sampleRate, duration }
//   → { id, type: 'progress', ratio }
//   → { id, type: 'result', analysis }
//   → { id, type: 'error', message }

import { analyzeAudio } from './analyze.js';

self.addEventListener('message', (event) => {
    void handle(event.data);
});

async function handle(msg) {
    const { id, samples, sampleRate, duration } = msg ?? {};
    if (!(samples instanceof Float32Array) || !Number.isFinite(sampleRate) || !Number.isFinite(duration)) {
        self.postMessage({ id, type: 'error', message: 'Petición de análisis mal formada.' });
        return;
    }
    const mono = {
        numberOfChannels: 1,
        length: samples.length,
        sampleRate,
        duration,
        getChannelData: () => samples,
    };
    try {
        // Sin yields: aquí no hay interfaz que desbloquear.
        const analysis = await analyzeAudio(mono, {
            yieldEvery: 0,
            onProgress: (ratio) => self.postMessage({ id, type: 'progress', ratio }),
        });
        self.postMessage({ id, type: 'result', analysis });
    } catch (err) {
        self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
}
