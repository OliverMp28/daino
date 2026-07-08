// Fábrica del Filter audio-reactivo que vive en la Capa 1 del engine.
//
// PixiJS v8 strict:
//   - GLSL ES 3.0 (in/out, texture(), out vec4 finalColor) — doc 09 §2.4.
//   - Uniforms scalar agrupados en `resources.audioUniforms`. Pixi compila el
//     grupo a un UBO; se accede vía filter.resources.audioUniforms.uniforms.X.
//   - Texturas como propiedad directa de `resources` (NO dentro de un grupo).
//     uFFT es un sampler2D 256x1 con formato r8unorm — un byte por bin.
//
// HMR: vite-plugin-glsl emite un `default export` con el string del shader.
// Cuando se edita .frag, import.meta.hot.accept reinstancia el GlProgram en
// caliente sin perder el AudioContext ni el AnalyserNode (doc 09 §1.4).

import {
    BufferImageSource,
    Filter,
    GlProgram,
} from 'pixi.js';

import fragmentSrc from './background.frag';
import vertexSrc from './background.vert';

export const FFT_BINS = 256;

/**
 * Crea el Filter listo para usar como `sprite.filters = [filter]`.
 *
 * @returns {{
 *     filter: Filter,
 *     fftBuffer: Uint8Array,
 *     fftSource: BufferImageSource,
 *     setUniforms: (u: { time?: number, rms?: number, bass?: number, mid?: number, high?: number, bpmPulse?: number }) => void,
 *     uploadFft: () => void,
 * }}
 */
export function createAudioFilter() {
    const fftBuffer = new Uint8Array(FFT_BINS);
    const fftSource = new BufferImageSource({
        resource: fftBuffer,
        width: FFT_BINS,
        height: 1,
        format: 'r8unorm',
    });

    const filter = new Filter({
        glProgram: new GlProgram({
            fragment: fragmentSrc,
            vertex: vertexSrc,
            name: 'daino-audio-bg',
        }),
        resources: {
            audioUniforms: {
                uShaderMode: { value: 0.0, type: 'f32' },  // 0=idle, 1=reactive
                uTime:       { value: 0.0, type: 'f32' },
                uRMS:        { value: 0.0, type: 'f32' },
                uBass:       { value: 0.0, type: 'f32' },
                uMid:        { value: 0.0, type: 'f32' },
                uHigh:       { value: 0.0, type: 'f32' },
                uBpmPulse:   { value: 0.0, type: 'f32' },
                uDebugMode:  { value: 0.0, type: 'f32' },
                // Y del horizonte en uv [0,1] (v=0 arriba). El engine la deriva
                // de GROUND_OFFSET_PX / viewport height y la refresca en resize.
                uHorizon:    { value: 0.94, type: 'f32' },
            },
            // CRÍTICO: pasar el TextureSource (BufferImageSource extiende de él),
            // no una Texture wrapper. Si pones `Texture` aquí, Pixi v8 deja el
            // sampler2D del shader sin bindear y `texture(uFFT, ...)` devuelve
            // un valor saturado en vez del buffer real. Diagnóstico durante el
            // Bloque 4 (ver historial git).
            uFFT: fftSource,
        },
    });

    // Subir el buffer (todo ceros) al GPU. Sin esto la textura GPU vive sin
    // datos y el sample devuelve memoria sin inicializar.
    fftSource.update();

    function setUniforms({ time, rms, bass, mid, high, bpmPulse, debugMode, horizon }) {
        const u = filter.resources.audioUniforms.uniforms;
        if (time      !== undefined) u.uTime      = time;
        if (rms       !== undefined) u.uRMS       = rms;
        if (bass      !== undefined) u.uBass      = bass;
        if (mid       !== undefined) u.uMid       = mid;
        if (high      !== undefined) u.uHigh      = high;
        if (bpmPulse  !== undefined) u.uBpmPulse  = bpmPulse;
        if (debugMode !== undefined) u.uDebugMode = debugMode;
        if (horizon   !== undefined) u.uHorizon   = horizon;
    }

    /**
     * Cambia el modo del shader de forma declarativa. En idle el shader
     * ignora todos los uniforms de audio; al pasar a reactive vuelven a
     * leerse. Esto reemplaza el patrón frágil de "resetear cada band uniform
     * a 0 en cada salida del juego".
     *
     * @param {'idle' | 'reactive'} mode
     */
    function setMode(mode) {
        const u = filter.resources.audioUniforms.uniforms;
        u.uShaderMode = mode === 'reactive' ? 1.0 : 0.0;
        if (mode === 'idle') {
            // Defensa adicional: limpiar los floats band y la textura FFT
            // para que cualquier debug que mire los uniforms vea ceros, y
            // para que el siguiente attach reactive arranque "desde cero"
            // sin un primer frame con valores stale.
            u.uRMS = 0;
            u.uBass = 0;
            u.uMid = 0;
            u.uHigh = 0;
            u.uBpmPulse = 0;
            fftBuffer.fill(0);
            fftSource.update();
        }
    }

    function uploadFft() {
        // El consumidor llena fftBuffer con AnalyserNode.getByteFrequencyData.
        // Marcar dirty para que Pixi suba la textura al GPU este frame.
        fftSource.update();
    }

    // HMR de shaders: al cambiar background.frag o .vert, recompilar el
    // GlProgram in-place. Sin esto, Vite haría reload completo y tiraría el
    // AudioContext + AnalyserNode (autoplay policy obliga al user a soltar
    // el MP3 otra vez). Doc 09 §1.4.
    if (import.meta.hot) {
        import.meta.hot.accept('./background.frag', (mod) => {
            if (!mod) return;
            filter.glProgram = new GlProgram({
                fragment: mod.default,
                vertex: vertexSrc,
                name: 'daino-audio-bg',
            });
            console.info('[hmr] background.frag recargado en caliente');
        });
        import.meta.hot.accept('./background.vert', (mod) => {
            if (!mod) return;
            filter.glProgram = new GlProgram({
                fragment: fragmentSrc,
                vertex: mod.default,
                name: 'daino-audio-bg',
            });
            console.info('[hmr] background.vert recargado en caliente');
        });
    }

    return { filter, fftBuffer, fftSource, setUniforms, setMode, uploadFft };
}
