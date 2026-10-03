// El shader del cielo: el escenario (T01) con los efectos de la música encima.
// Es la Capa 1 del engine, y lo único caro de un fotograma.
//
// No es un Filter de Pixi (lo fue hasta la T05.1). Un filtro se aplica sobre la
// superficie donde se pinta su sprite —la pantalla, a resolución completa— y antes
// pinta ese sprite en una textura de entrada que este shader ni lee. Aquí el
// shader se pinta a mano, con un rectángulo, en el búfer del cielo
// (shaders/skyBuffer.js): a los texeles que diga la calidad y por bandas.
//
// PixiJS v8 strict:
//   - GLSL ES 3.0 (in/out, texture(), out vec4 finalColor) — doc 09 §2.4.
//   - Dos grupos de uniforms que no se mezclan (doc 11 §2.4):
//       audioUniforms — los efectos: cantidades ya calculadas (fx/skyAmounts.js),
//                       sus dos colores y el limitador de la franja jugable (T03.1).
//       skyUniforms   — el escenario: el cielo de la hora (scenes/skyModel.js).
//     Se accede vía shader.resources.<grupo>.uniforms.X.
//   - Texturas como propiedad directa de `resources` (NO dentro de un grupo).
//     uFFT es un sampler2D 256x1 con formato r8unorm — un byte por bin.
//
// HMR: vite-plugin-glsl emite un `default export` con el string del shader.
// Cuando se edita .frag, import.meta.hot.accept reinstancia el GlProgram en
// caliente sin perder el AudioContext ni el AnalyserNode (doc 09 §1.4).

import {
    BufferImageSource,
    GlProgram,
    Shader,
} from 'pixi.js';

import fragmentSrc from './background.frag';
import vertexSrc from './background.vert';

export const FFT_BINS = 256;

/**
 * El programa del cielo. Con precisión alta en el fragment: trabaja con posiciones
 * en píxeles de pantalla (pasan de 1024) y con `hash21`, y con el `mediump` que
 * Pixi pone por defecto las estrellas y las celdas saldrían mal en un móvil. En
 * escritorio las dos precisiones son la misma.
 */
function skyProgram(fragment, vertex) {
    return new GlProgram({ fragment, vertex, name: 'daino-sky', preferredFragmentPrecision: 'highp' });
}

/**
 * Crea el shader del cielo (lo pinta shaders/skyBuffer.js).
 *
 * @returns {{
 *     shader: Shader,
 *     fftBuffer: Uint8Array,
 *     fftSource: BufferImageSource,
 *     setUniforms: (u: { time?: number, debugMode?: number, horizon?: number, frame?: number[], cell?: number, band?: number[] }) => void,
 *     setFrameRect: (x: number, y: number, w: number, h: number) => void,
 *     setFx: (amounts: { a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array }, colors: { warm: number[], cool: number[] }) => void,
 *     uploadFft: () => void,
 * }}
 */
export function createSkyShader() {
    const fftBuffer = new Uint8Array(FFT_BINS);
    const fftSource = new BufferImageSource({
        resource: fftBuffer,
        width: FFT_BINS,
        height: 1,
        format: 'r8unorm',
    });

    const shader = new Shader({
        glProgram: skyProgram(fragmentSrc, vertexSrc),
        resources: {
            audioUniforms: {
                uShaderMode: { value: 0.0, type: 'f32' },  // 0=idle, 1=hay música
                uTime:       { value: 0.0, type: 'f32' },
                uDebugMode:  { value: 0.0, type: 'f32' },
                // Y del horizonte del CIELO en uv [0,1] (v=0 arriba): la línea del
                // suelo, o más arriba si la escena lo sube (T02.2, la Costa: el mar
                // llega hasta él). El engine la refresca en resize y al cambiar de
                // escena.
                uHorizon:    { value: 0.94, type: 'f32' },
                // Tamaño del frame en px CSS y px CSS por celda del arte (vista
                // del mundo): el sol es redondo y las estrellas miden una celda
                // en cualquier formato de pantalla.
                uFrame:      { value: new Float32Array([1280, 720]), type: 'vec2<f32>' },
                uCell:       { value: 4.0, type: 'f32' },
                // Qué uv de pantalla cubre lo que se está pintando: una banda del
                // búfer del cielo (systems/skyGrid.js, skyBand). Lo usa el vertex.
                uFrameRect:  { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
                // Efectos (T03.1): cantidades por hueco (fx/skyAmounts.js) y sus dos
                // colores. Ver background.frag.
                uFxA:        { value: new Float32Array(4), type: 'vec4<f32>' },
                uFxB:        { value: new Float32Array([0, 0, 26, 0]), type: 'vec4<f32>' },
                uFxC:        { value: new Float32Array(4), type: 'vec4<f32>' },
                // Relojes de las firmas del cielo (T03.3): fase y vaivén de la
                // aurora, tanda de la lluvia de estrellas y segundos desde ella.
                uFxD:        { value: new Float32Array([0, 0, 0, 60]), type: 'vec4<f32>' },
                uFxWarm:     { value: new Float32Array([0.88, 0.22, 0.38]), type: 'vec3<f32>' },
                uFxCool:     { value: new Float32Array([0.56, 0.88, 1.0]), type: 'vec3<f32>' },
                // Limitador de la franja jugable (fx/limiter.js): uv de su techo,
                // fundido por encima (uv) y techo de luminancia. El engine lo pone
                // en resize.
                uFxBand:     { value: new Float32Array([0.35, 0.09, 0.085]), type: 'vec3<f32>' },
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

    function setUniforms({ time, debugMode, horizon, frame, cell, band }) {
        const u = shader.resources.audioUniforms.uniforms;
        if (frame     !== undefined) {
            u.uFrame[0] = frame[0];
            u.uFrame[1] = frame[1];
        }
        if (cell      !== undefined) u.uCell      = cell;
        if (time      !== undefined) u.uTime      = time;
        if (debugMode !== undefined) u.uDebugMode = debugMode;
        if (horizon   !== undefined) u.uHorizon   = horizon;
        if (band      !== undefined) u.uFxBand.set(band);
    }

    /** La uv de pantalla (esquina y lo que abarca) de lo que se va a pintar. */
    function setFrameRect(x, y, w, h) {
        const r = shader.resources.audioUniforms.uniforms.uFrameRect;
        r[0] = x;
        r[1] = y;
        r[2] = w;
        r[3] = h;
    }

    /**
     * Las cantidades de los efectos del cielo y sus colores, cada fotograma
     * (fx/skyAmounts.js y el director de efectos). Copia: sin asignaciones.
     *
     * @param {{ a: Float32Array, b: Float32Array, c: Float32Array, d: Float32Array }} amounts
     * @param {{ warm: ArrayLike<number>, cool: ArrayLike<number> }} colors
     */
    function setFx(amounts, colors) {
        const u = shader.resources.audioUniforms.uniforms;
        u.uFxA.set(amounts.a);
        u.uFxB.set(amounts.b);
        u.uFxC.set(amounts.c);
        u.uFxD.set(amounts.d);
        u.uFxWarm.set(colors.warm);
        u.uFxCool.set(colors.cool);
    }

    /**
     * Con música o sin ella. Sin música (el menú) el sol respira por su cuenta
     * y los efectos quedan a cero: el menú se ve idéntico al primer arranque.
     *
     * @param {'idle' | 'reactive'} mode
     */
    function setMode(mode) {
        const u = shader.resources.audioUniforms.uniforms;
        u.uShaderMode = mode === 'reactive' ? 1.0 : 0.0;
        if (mode === 'idle') {
            u.uFxA.fill(0);
            u.uFxB[0] = 0;
            u.uFxB[1] = 0;
            u.uFxB[3] = 0;
            u.uFxC.fill(0);
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
        const u = shader.resources.skyUniforms.uniforms;
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
        const u = shader.resources.skyUniforms.uniforms;
        (slot < 4 ? u.uShow0 : u.uShow1)[slot % 4] = visible ? 1 : 0;
    }

    function uploadFft() {
        // Solo el modo de depuración ?debug=fft: el engine llena fftBuffer con
        // AnalyserNode.getByteFrequencyData y aquí se sube a la GPU.
        fftSource.update();
    }

    // HMR de shaders: al cambiar background.frag o .vert, recompilar el
    // GlProgram in-place. Sin esto, Vite haría reload completo y tiraría el
    // AudioContext + AnalyserNode (autoplay policy obliga al user a soltar
    // el MP3 otra vez). Doc 09 §1.4.
    if (import.meta.hot) {
        import.meta.hot.accept('./background.frag', (mod) => {
            if (!mod) return;
            shader.glProgram = skyProgram(mod.default, vertexSrc);
            console.info('[hmr] background.frag recargado en caliente');
        });
        import.meta.hot.accept('./background.vert', (mod) => {
            if (!mod) return;
            shader.glProgram = skyProgram(fragmentSrc, mod.default);
            console.info('[hmr] background.vert recargado en caliente');
        });
    }

    return { shader, fftBuffer, fftSource, setUniforms, setFrameRect, setFx, setMode, setSky, setSkyElement, uploadFft };
}
