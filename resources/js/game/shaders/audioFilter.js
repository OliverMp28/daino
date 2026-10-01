// Fábrica del Filter del fondo: el cielo del escenario (T01) con los
// efectos de la música encima. Vive en la Capa 1 del engine.
//
// PixiJS v8 strict:
//   - GLSL ES 3.0 (in/out, texture(), out vec4 finalColor) — doc 09 §2.4.
//   - Dos grupos de uniforms que no se mezclan (doc 11 §2.4):
//       audioUniforms — los efectos: lo que reacciona a la música.
//       skyUniforms   — el escenario: el cielo de la hora (scenes/skyModel.js).
//     Se accede vía filter.resources.<grupo>.uniforms.X.
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
                // Y del horizonte del CIELO en uv [0,1] (v=0 arriba): la línea del
                // suelo, o más arriba si la escena lo sube (T02.2, la Costa: el mar
                // llega hasta él). El engine la refresca en resize y al cambiar de
                // escena.
                uHorizon:    { value: 0.94, type: 'f32' },
                // Y de la línea del SUELO en uv: donde se anclan los efectos (el
                // ecualizador), que no cambian con la escena.
                uGround:     { value: 0.94, type: 'f32' },
                // Tamaño del frame en px CSS y px CSS por celda del arte (vista
                // del mundo): el sol es redondo y las estrellas miden una celda
                // en cualquier formato de pantalla.
                uFrame:      { value: new Float32Array([1280, 720]), type: 'vec2<f32>' },
                uCell:       { value: 4.0, type: 'f32' },
                // Estructura de la canción (Ola 5): ver background.frag.
                uIntensity:  { value: 0.0, type: 'f32' },
                uClimax:     { value: 0.0, type: 'f32' },
                uFlash:      { value: 0.0, type: 'f32' },
                // Efectos del plan del charter (Ola 6c): ver background.frag.
                uBuild:      { value: 0.0, type: 'f32' },
                uCalm:       { value: 0.0, type: 'f32' },
                uHue:        { value: 0.0, type: 'f32' },
            },
            // Cielo del escenario (T01): lo rellena `setSky` con el estado de
            // scenes/skyModel.js. Posiciones en fracción del cielo (0 arriba, 1
            // horizonte). Ver background.frag.
            skyUniforms: {
                uSkyTop:     { value: new Float32Array([0.02, 0.02, 0.05]), type: 'vec3<f32>' },
                uSkyMid:     { value: new Float32Array([0.04, 0.04, 0.12]), type: 'vec3<f32>' },
                uSkyHorizon: { value: new Float32Array([0.11, 0.07, 0.18]), type: 'vec3<f32>' },
                uHaze:       { value: new Float32Array(4), type: 'vec4<f32>' },
                uSunPos:     { value: new Float32Array([0.8, 1.2]), type: 'vec2<f32>' },
                uSunRadius:  { value: 0.1, type: 'f32' },
                uSunCore:    { value: new Float32Array(3), type: 'vec3<f32>' },
                uSunEdge:    { value: new Float32Array(3), type: 'vec3<f32>' },
                uSunSlits:   { value: 0.0, type: 'f32' },
                uSunGlow:    { value: new Float32Array(4), type: 'vec4<f32>' },
                uSunHalo:    { value: 0.0, type: 'f32' },
                uSunFlash:   { value: 0.0, type: 'f32' },
                uMoonPos:    { value: new Float32Array([0.5, 1.2]), type: 'vec2<f32>' },
                uMoonRadius: { value: 0.04, type: 'f32' },
                uMoonColor:  { value: new Float32Array(4), type: 'vec4<f32>' },
                uStarVis:    { value: 0.0, type: 'f32' },
                uStarRot:    { value: 0.0, type: 'f32' },
                uLucero:     { value: new Float32Array(4), type: 'vec4<f32>' },
                uNight:      { value: 0.0, type: 'f32' },
                uVignette:   { value: 0.2, type: 'f32' },
                // Interruptores del panel dev (1 = se ve), por hueco de
                // SKY_ELEMENTS (scenes/registry.js).
                uShow0:      { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
                uShow1:      { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
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

    function setUniforms({ time, rms, bass, mid, high, bpmPulse, debugMode, horizon, ground, frame, cell, intensity, climax, flash, build, calm, hue }) {
        const u = filter.resources.audioUniforms.uniforms;
        if (frame     !== undefined) {
            u.uFrame[0] = frame[0];
            u.uFrame[1] = frame[1];
        }
        if (cell      !== undefined) u.uCell      = cell;
        if (time      !== undefined) u.uTime      = time;
        if (rms       !== undefined) u.uRMS       = rms;
        if (bass      !== undefined) u.uBass      = bass;
        if (mid       !== undefined) u.uMid       = mid;
        if (high      !== undefined) u.uHigh      = high;
        if (bpmPulse  !== undefined) u.uBpmPulse  = bpmPulse;
        if (debugMode !== undefined) u.uDebugMode = debugMode;
        if (horizon   !== undefined) u.uHorizon   = horizon;
        if (ground    !== undefined) u.uGround    = ground;
        if (intensity !== undefined) u.uIntensity = intensity;
        if (climax    !== undefined) u.uClimax    = climax;
        if (flash     !== undefined) u.uFlash     = flash;
        if (build     !== undefined) u.uBuild     = build;
        if (calm      !== undefined) u.uCalm      = calm;
        if (hue       !== undefined) u.uHue       = hue;
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
            u.uIntensity = 0;
            u.uClimax = 0;
            u.uFlash = 0;
            u.uBuild = 0;
            u.uCalm = 0;
            u.uHue = 0;
            fftBuffer.fill(0);
            fftSource.update();
        }
    }

    /**
     * Sube el cielo de una hora (scenes/skyModel.js). Copia en los arrays del
     * grupo: sin asignaciones por frame.
     *
     * @param {ReturnType<import('../scenes/skyModel.js').createSkyState>} s
     */
    function setSky(s) {
        const u = filter.resources.skyUniforms.uniforms;
        u.uSkyTop.set(s.sky.top);
        u.uSkyMid.set(s.sky.mid);
        u.uSkyHorizon.set(s.sky.horizon);
        u.uHaze.set(s.sky.haze);
        u.uSunPos.set(s.sun.pos);
        u.uSunRadius = s.sun.radius;
        u.uSunCore.set(s.sun.core);
        u.uSunEdge.set(s.sun.edge);
        u.uSunSlits = s.sun.slits;
        u.uSunGlow.set(s.sun.glow);
        u.uSunHalo = s.sun.halo;
        u.uSunFlash = s.sun.flash;
        u.uMoonPos.set(s.moon.pos);
        u.uMoonRadius = s.moon.radius;
        u.uMoonColor.set(s.moon.color);
        u.uStarVis = s.stars.vis;
        u.uStarRot = s.stars.rot;
        u.uLucero.set(s.lucero);
        u.uNight = s.night;
        u.uVignette = s.vignette;
    }

    /**
     * Enciende o apaga un elemento del cielo por su hueco (SKY_ELEMENTS).
     * @param {number} slot  0-7
     * @param {boolean} visible
     */
    function setSkyElement(slot, visible) {
        const u = filter.resources.skyUniforms.uniforms;
        (slot < 4 ? u.uShow0 : u.uShow1)[slot % 4] = visible ? 1 : 0;
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

    return { filter, fftBuffer, fftSource, setUniforms, setMode, setSky, setSkyElement, uploadFft };
}
