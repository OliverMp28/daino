// Engine — núcleo PixiJS de Daino.
//
// Responsabilidades (ampliadas en el rediseño visual Jul 2026):
//   - Crear la Application en `<div id="app">` o `document.body`.
//   - Apilar las capas visuales del doc 06 §3 + scenery:
//       bg (shader) → scenery (suelo/nubes/montañas parallax) → game →
//       particles → hud.
//   - Montar el Filter audio-reactivo sobre un sprite full-viewport en la
//     capa de fondo, con uHorizon anclado a la línea del suelo.
//   - Scrollear el scenery SIEMPRE (menú a SCENERY.menuSpeed, partida a
//     gameSpeed vía setWorldSpeed) — el mundo nunca está muerto.
//   - Animar las motas de la particleLayer (energy = RMS en partida, 0 idle).
//   - Pausar el ticker cuando el AudioContext esté `suspended` (doc 07 §C.3).
//   - Si `prefers-reduced-motion`: sin filter, sin motas, scenery estático —
//     el body muestra el degradado CSS y el canvas pinta la escena quieta.
//
// API para el resto del módulo: attachAudio/detachAudio, getLayers, getTicker,
// setWorldSpeed (scroll del scenery), setBeatPulse (uniform uBpmPulse del
// shader — GameSession lo calcula del BPM detectado + audioTime).

import {
    Application,
    Container,
    Sprite,
    Texture,
} from 'pixi.js';

import { createAudioFilter, FFT_BINS } from './shaders/audioFilter.js';
import { computeBands } from './audio/features.js';
import { createParticleLayer } from './entities/ParticleLayer.js';
import { createScenery } from './entities/Scenery.js';
import { GROUND_OFFSET_PX, SCENERY } from './config.js';

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEBUG_MODE = (() => {
    const p = new URLSearchParams(window.location.search).get('debug');
    if (p === 'fft') return 1;
    if (p === 'uv') return 2;
    if (p === 'uniforms') return 3;
    return 0;
})();

let app = null;
let audio = null;          // AudioEngine atachado (o null)
let audioFilter = null;    // resultado de createAudioFilter()
let bgSprite = null;
let scenery = null;        // resultado de createScenery()
let isPaused = false;
let timeAccum = 0;         // segundos desde init — siempre avanza salvo pausa
let worldSpeed = SCENERY.menuSpeed;  // px/s del scroll del scenery

// Layers expuestos a module-scope para que `getApi().getLayers()` pueda
// devolver referencias estables sin filtrar internals.
let bgLayer = null;
let sceneryLayer = null;
let gameLayer = null;
let particleLayer = null;
let hudLayer = null;

/**
 * Inicializa Pixi y monta el escenario. Idempotente — segunda llamada es no-op.
 *
 * @param {HTMLElement} mountTarget  Dónde insertar el canvas (ej. document.body).
 */
export async function startEngine(mountTarget = document.body) {
    if (app !== null) return getApi();

    app = new Application();
    await app.init({
        resizeTo: window,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        preference: 'webgl',           // doc 09 §2.6 — WebGPU como toggle Bloque 8.
        antialias: false,
        powerPreference: 'high-performance',
        background: 0x05050a,
        backgroundAlpha: REDUCED_MOTION ? 0 : 1,
    });

    mountTarget.appendChild(app.canvas);  // OJO: app.canvas en v8 (no app.view).

    // Dimensionado con window.innerWidth/Height (no app.screen) porque tras
    // `await app.init({ resizeTo: window })` el internal resize de Pixi puede
    // no haber corrido todavía — app.screen reporta defaults (800x600).
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Layers — contenedores apilados, mismo orden que doc 06 §3 + scenery.
    bgLayer = new Container({ label: 'bg' });
    scenery = createScenery({ width: vw, height: vh });
    sceneryLayer = scenery.container;
    gameLayer = new Container({ label: 'game' });
    particleLayer = createParticleLayer(
        { width: vw, height: vh },
        { reducedMotion: REDUCED_MOTION },
    );
    hudLayer = new Container({ label: 'hud' });
    app.stage.addChild(bgLayer, sceneryLayer, gameLayer, particleLayer, hudLayer);

    // Si el user pidió reducir movimiento, no montamos el filter — el body
    // muestra el degradado CSS estático que ya define main.css. El canvas
    // pinta scenery + gameplay quietos encima sin problemas.
    if (!REDUCED_MOTION) {
        audioFilter = createAudioFilter();

        // Sprite "vacío" (Texture.WHITE) que ocupa toda la pantalla — soporte
        // del Filter, que ignora uTexture y pinta desde cero. Tinta negra
        // para evitar flash blanco si el filtro tarda un frame en aplicarse.
        bgSprite = new Sprite(Texture.WHITE);
        bgSprite.tint = 0x000000;
        bgSprite.filters = [audioFilter.filter];
        bgLayer.addChild(bgSprite);
    }

    const fitViewport = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (bgSprite) {
            bgSprite.width = w;
            bgSprite.height = h;
        }
        // uHorizon en uv [0,1] (v=0 arriba): la línea del suelo pixel-art.
        if (audioFilter) {
            audioFilter.setUniforms({ horizon: (h - GROUND_OFFSET_PX) / h });
        }
        scenery.resize(w, h);
        particleLayer.resize(w, h);
    };
    fitViewport();
    window.addEventListener('resize', fitViewport);

    // Pause/resume del ticker basado en el estado del AudioContext.
    // dispatch lo hace AudioEngine cuando recibe `onstatechange`.
    window.addEventListener('audio:pause', () => { isPaused = true; });
    window.addEventListener('audio:resume', () => { isPaused = false; });

    app.ticker.add(tick);

    // Hook de debugging SOLO en dev (Vite lo elimina del build de prod):
    // expone la API del engine en window para poder inspeccionar capas,
    // forzar worldSpeed, etc. desde la consola del navegador.
    if (import.meta.env.DEV) {
        window.__dainoEngine = getApi();
    }

    return getApi();
}

function tick(ticker) {
    if (isPaused) return;

    const dt = Math.min(1 / 20, ticker.deltaMS / 1000);
    timeAccum += dt;

    // Energía de la canción para partículas (0 en idle/menú).
    let rms = 0;

    // Scenery + motas: siempre vivos (salvo reduced motion).
    if (!REDUCED_MOTION) {
        scenery.tick(dt, worldSpeed);
    }

    if (audioFilter) {
        // uTime y uDebugMode se actualizan SIEMPRE — alimentan la escena idle
        // (estrellas, respiración del sol) y los modos ?debug=N.
        audioFilter.setUniforms({ time: timeAccum, debugMode: DEBUG_MODE });

        // FFT/bands solo cuando hay audio atachado. En idle el shader fuerza
        // a 0 los reactivos vía uShaderMode (branch GLSL).
        if (audio !== null) {
            const fftSlice = audio.getFrequencyData(FFT_BINS);
            audioFilter.fftBuffer.set(fftSlice);
            audioFilter.uploadFft();

            const bands = computeBands(fftSlice);
            rms = audio.getRMS();
            audioFilter.setUniforms({
                rms,
                bass: bands.bass,
                mid: bands.mid,
                high: bands.high,
            });
        }
    }

    if (particleLayer.tick) particleLayer.tick(dt, rms);
}

/**
 * Conecta un AudioEngine al ticker. Llamar tras el primer drop de MP3.
 * Idempotente — reemplaza el audio anterior si lo había. Pone el shader en
 * modo reactive: el branch GLSL pasa a leer FFT/bands/BPM en cada frame.
 */
export function attachAudio(audioEngine) {
    audio = audioEngine;
    if (audioFilter) audioFilter.setMode('reactive');
}

/**
 * Desconecta el audio y vuelve el shader a idle (el branch GLSL fuerza los
 * reactivos a 0 — el menú se ve idéntico al primer load, sin contaminación).
 */
export function detachAudio() {
    audio = null;
    if (audioFilter) audioFilter.setMode('idle');
}

/**
 * Velocidad de scroll del scenery en px/s. GameSession la sube a gameSpeed
 * al arrancar y la devuelve a SCENERY.menuSpeed al parar.
 */
export function setWorldSpeed(pxPerSec) {
    worldSpeed = pxPerSec;
}

/**
 * Pulso de beat [0,1] para el shader (uBpmPulse). GameSession lo calcula
 * cada frame como exp-decay de la fase del beat (BPM detectado + audioTime).
 */
export function setBeatPulse(v) {
    if (audioFilter) audioFilter.setUniforms({ bpmPulse: v });
}

function getApi() {
    return {
        app,
        attachAudio,
        detachAudio,
        setWorldSpeed,
        setBeatPulse,
        getCanvas: () => app?.canvas ?? null,
        // GameSession monta Dino/Obstacle en gameLayer, bursts también ahí.
        // Devolvemos refs vivas — no copiamos para evitar el foot-gun de
        // "monté en una copia y nada se ve".
        getLayers: () => ({ bgLayer, sceneryLayer, gameLayer, particleLayer, hudLayer }),
        // Passthrough del ticker. La GameSession registra su tick aquí; no
        // creamos un rAF propio (un solo loop, ya pausa con audio:pause).
        getTicker: () => app?.ticker ?? null,
        get reducedMotion() { return REDUCED_MOTION; },
    };
}
