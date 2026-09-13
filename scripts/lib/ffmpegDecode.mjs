// Decodificación de MP3 fuera del navegador, para hornear niveles oficiales.
//
// El analizador (`resources/js/game/levels/analyze.js`) solo necesita un objeto
// con la forma de un AudioBuffer. Aquí se obtiene decodificando con `ffmpeg` a
// PCM float de 32 bits, estéreo, 44.1 kHz — el mismo rate que fija el
// AudioContext del juego (`ANALYSIS_SAMPLE_RATE`).
//
// Por qué ffmpeg y no un decodificador MP3 en JS: el reloj del juego corre
// sobre el buffer que decodifica EL NAVEGADOR, así que un chart horneado fuera
// solo es válido si los dos decodificadores producen las mismas muestras en la
// misma posición. Medido (Sep 2026, ffmpeg 8.1 vs Chrome, 3 MP3 del catálogo
// con y sin cabecera LAME): misma longitud en muestras, desfase 0 muestras y
// diferencia cuadrática ~2e-10 en ventanas de 2048 muestras — idénticos salvo
// redondeo. Ambos aplican el recorte de encoder delay/padding del MP3. Un
// decodificador JS arbitrario no da esa garantía.

import { spawn } from 'node:child_process';

export const DECODE_SAMPLE_RATE = 44100;
const CHANNELS = 2;

/**
 * @param {string} file  Ruta del MP3.
 * @param {{ ffmpeg?: string }} [opts]
 * @returns {Promise<{ numberOfChannels: number, length: number, sampleRate: number,
 *                     duration: number, getChannelData: (c: number) => Float32Array }>}
 */
export function decodeWithFfmpeg(file, opts = {}) {
    const bin = opts.ffmpeg ?? process.env.FFMPEG ?? 'ffmpeg';
    const args = ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(CHANNELS), '-ar', String(DECODE_SAMPLE_RATE), 'pipe:1'];

    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            reject(err);
            return;
        }
        const chunks = [];
        let size = 0;
        let stderr = '';
        child.stdout.on('data', (c) => { chunks.push(c); size += c.length; });
        child.stderr.on('data', (c) => { stderr += c; });
        child.on('error', (err) => {
            reject(err.code === 'ENOENT'
                ? new Error(`No se encontró ffmpeg ("${bin}"). Instálalo o indica su ruta con FFMPEG=/ruta/ffmpeg.`)
                : err);
        });
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`ffmpeg terminó con código ${code} al decodificar ${file}: ${stderr.trim()}`));
                return;
            }
            const bytes = Buffer.concat(chunks, size);
            // Copia alineada: el Buffer de Node puede no empezar en múltiplo de 4.
            const interleaved = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (size - (size % 4))));
            resolve(toAudioBufferShape(interleaved));
        });
    });
}

/**
 * @param {Float32Array} interleaved  L R L R …
 */
export function toAudioBufferShape(interleaved) {
    const length = Math.floor(interleaved.length / CHANNELS);
    const channels = [];
    for (let c = 0; c < CHANNELS; c++) {
        const ch = new Float32Array(length);
        for (let i = 0; i < length; i++) ch[i] = interleaved[i * CHANNELS + c];
        channels.push(ch);
    }
    return {
        numberOfChannels: CHANNELS,
        length,
        sampleRate: DECODE_SAMPLE_RATE,
        duration: length / DECODE_SAMPLE_RATE,
        getChannelData: (c) => channels[c],
    };
}
