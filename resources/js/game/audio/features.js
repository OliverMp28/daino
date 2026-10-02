// Extracción mínima de features sobre el array FFT.
//
// Bloque 4: solo división en bandas (bass / mid / high) y promedio. El análisis
// de la canción (Spectral Flux, onsets) vive en levels/; el espectro en barras
// que pintan los efectos, en fx/spectrum.js. Este `computeBands` se llama 60 veces
// por segundo y debe ser O(n) sin allocations.

/** Fin de los graves y de los medios, como fracción del espectro (0-22 kHz). */
const BASS_END = 10 / 256;   // ~860 Hz
const MID_END = 100 / 256;   // ~8.6 kHz
// El resto hasta el final del buffer son "high".

/**
 * @param {Uint8Array} fft  Output de AnalyserNode.getByteFrequencyData (valores
 *   0..255), con cualquier número de bins: los 1024 nativos o un downsample.
 * @param {{ bass: number, mid: number, high: number }} [out]  Dónde escribir
 *   (sin él se crea un objeto: no usar así en el bucle de render).
 * @returns {{ bass: number, mid: number, high: number }}  Cada banda en [0,1].
 */
export function computeBands(fft, out = { bass: 0, mid: 0, high: 0 }) {
    const len = fft.length;
    let bassSum = 0;
    let midSum = 0;
    let highSum = 0;

    const bassEnd = Math.min(len, Math.round(BASS_END * len));
    const midEnd = Math.min(len, Math.round(MID_END * len));

    for (let i = 0; i < bassEnd; i++) bassSum += fft[i];
    for (let i = bassEnd; i < midEnd; i++) midSum += fft[i];
    for (let i = midEnd; i < len; i++) highSum += fft[i];

    const bassN = bassEnd;
    const midN = midEnd - bassEnd;
    const highN = len - midEnd;

    out.bass = bassN > 0 ? (bassSum / bassN) / 255 : 0;
    out.mid = midN > 0 ? (midSum / midN) / 255 : 0;
    out.high = highN > 0 ? (highSum / highN) / 255 : 0;
    return out;
}
