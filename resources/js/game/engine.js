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
import { GROUND_OFFSET_PX, SCENERY, DT_CAP_S } from './config.js';
import { resolveBudget, MAX_FILTER_DPR, TIER_ORDER } from './RenderProfile.js';

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

// --- Perfiles de render (Ola 1) ---
let profileName = 'MENU';        // estado actual de la app
let qualityTier = 'high';        // tier efectivo (auto-degradado o forzado)
let qualityLocked = false;       // true si el user eligió tier a mano
let budget = resolveBudget('MENU', 'high');
let modalOpen = false;           // hay un <dialog open>: presupuesto de PAUSED

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

    // Presupuesto inicial (MENU). Se aplica DESPUÉS de crear el filtro y la
    // capa de partículas: `applyBudget` toca ambos.
    applyBudget();
    watchModals();

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

/**
 * Vigila si hay algún `<dialog open>` para bajar el presupuesto mientras un
 * modal tapa la escena.
 *
 * Se hace con MutationObserver y no pidiendo a `modals.js` que avise porque
 * así no hay nada que recordar: cualquier `<dialog>` que se abra en el futuro
 * queda cubierto sin tocar el engine. `showModal()` además no dispara ningún
 * evento de apertura, así que escuchar eventos no bastaría.
 *
 * El coste es nulo: solo se observa el atributo `open`, que cambia un puñado
 * de veces por sesión.
 */
function watchModals() {
    if (typeof MutationObserver === 'undefined') return;

    const sync = () => {
        const anyOpen = document.querySelector('dialog[open]') !== null;
        if (anyOpen === modalOpen) return;
        modalOpen = anyOpen;
        applyBudget();
    };

    new MutationObserver(sync).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open'],
    });
    sync();
}

/**
 * Traduce el presupuesto activo a ajustes concretos del renderer.
 *
 * Punto único donde un presupuesto se convierte en efecto: si mañana el
 * presupuesto gana un campo, se cablea aquí y en ningún otro sitio.
 */
function applyBudget() {
    // Un modal abierto congela el juego por detrás: no se mira, no se juega.
    const effective = modalOpen && profileName === 'PLAYING' ? 'PAUSED' : profileName;
    budget = resolveBudget(effective, qualityTier);

    if (app) {
        // maxFPS 0 = sin tope. Pixi interpreta 0 como "usa el rAF nativo".
        app.ticker.maxFPS = budget.maxFPS;
    }

    if (audioFilter?.filter) {
        // `resolution` del filtro es un multiplicador sobre la del render
        // target. Se capa por MAX_FILTER_DPR porque un pase full-screen a 3×
        // (móviles) cuesta 9 veces lo que a 1× sin diferencia visible en una
        // escena de degradados.
        const dpr = app?.renderer?.resolution ?? 1;
        const capped = Math.min(dpr, MAX_FILTER_DPR) / (dpr || 1);
        audioFilter.filter.resolution = Math.max(0.25, budget.filterResolution * capped);
    }

    if (particleLayer?.setActiveRatio) {
        particleLayer.setActiveRatio(budget.particleRatio);
    }
}

/**
 * Cambia el perfil de render según el estado de la app.
 * Lo llama `AppController.setState()`; no hay otro punto de entrada.
 *
 * @param {import('./RenderProfile.js').ProfileName} name
 */
export function setRenderProfile(name) {
    if (name === profileName) return;
    profileName = name;
    applyBudget();
}

/**
 * Fuerza un tier de calidad ('high' | 'medium' | 'low') o vuelve a 'auto'.
 * Lo expone el modal AJUSTES. Elegir a mano desactiva el degradado automático:
 * si el usuario pidió Alta explícitamente, bajarle la calidad por detrás sería
 * ignorar su decisión.
 *
 * @param {'auto'|'high'|'medium'|'low'} tier
 */
export function setQualityTier(tier) {
    if (tier === 'auto') {
        qualityLocked = false;
        qualityTier = 'high';   // el monitor volverá a bajar si hace falta
    } else {
        qualityLocked = true;
        qualityTier = tier;
    }
    frameSamples = 0;
    slowFrames = 0;
    applyBudget();
}

/** Tier efectivo en uso — lo lee AJUSTES para mostrar qué está aplicando 'auto'. */
export function getQualityTier() {
    return { tier: qualityTier, locked: qualityLocked };
}

// --- Degradado automático de calidad ---
//
// Mide el tiempo de frame y baja un escalón si se sostiene por encima del
// presupuesto. Cubre el riesgo del doc 06 §11 (GPU modesta) sin depender de
// `hardwareConcurrency`, que miente en bastantes móviles: medir lo que pasa de
// verdad es más fiable que inferirlo de las specs.
//
// La histéresis importa: se exige una racha larga de frames lentos para bajar,
// y NUNCA se vuelve a subir solo. Oscilar entre tiers se ve peor que quedarse
// en el bajo, y el usuario siempre puede forzar el que quiera desde AJUSTES.
const SLOW_FRAME_MS = 24;        // ~40 fps; por debajo de eso se nota
const SLOW_FRAMES_TO_DEGRADE = 90;
const WARMUP_FRAMES = 120;       // ignora el arranque: compilar shaders da tirones
let frameSamples = 0;
let slowFrames = 0;

function monitorPerformance(elapsedMs) {
    if (qualityLocked) return;
    frameSamples++;
    if (frameSamples < WARMUP_FRAMES) return;

    // Solo se vigila lo que se juega: en el menú, con tope de 30 fps, un frame
    // "lento" es lo normal y no dice nada del hardware.
    if (profileName !== 'PLAYING') { slowFrames = 0; return; }

    if (elapsedMs > SLOW_FRAME_MS) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);

    if (slowFrames >= SLOW_FRAMES_TO_DEGRADE) {
        const idx = TIER_ORDER.indexOf(qualityTier);
        if (idx >= 0 && idx < TIER_ORDER.length - 1) {
            qualityTier = TIER_ORDER[idx + 1];
            console.info(`[engine] frames lentos sostenidos — bajando calidad a "${qualityTier}"`);
            applyBudget();
        }
        slowFrames = 0;
    }
}

function tick(ticker) {
    if (isPaused) return;

    // Mismo cap que usa GameSession (Ola 0). Antes el engine capaba a 1/20 s y
    // la GameSession a DT_CAP_S = 1/30 s sobre el MISMO frame: ante un tirón de
    // 40 ms el mundo (suelo, nubes, partículas) avanzaba 40 ms mientras el Dino
    // y los obstáculos avanzaban 33 ms. Un solo cap compartido mantiene mundo y
    // jugador en la misma escala temporal.
    const dt = Math.min(DT_CAP_S, ticker.deltaMS / 1000);
    timeAccum += dt;

    monitorPerformance(ticker.deltaMS);

    // Energía de la canción para partículas (0 en idle/menú).
    let rms = 0;

    // Scenery: vivo salvo reduced motion o presupuesto que lo congele
    // (LOADING, PAUSED, modal abierto).
    if (!REDUCED_MOTION && budget.sceneryAnimated) {
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
 * Congela/reanuda el render loop COMPLETO (rAF de Pixi incluido). Lo usa
 * AppController durante LOADING: el análisis offline del MP3 corre en el
 * main thread y competir con el render a 60fps lo ralentizaba y hacía que
 * las animaciones fueran a trompicones (feedback user Jul 2026). Canvas
 * congelado en su último frame + CPU entera para el LevelGenerator.
 */
export function setRenderPaused(paused) {
    if (!app) return;
    if (paused) app.ticker.stop();
    else app.ticker.start();
}

/** Passthrough al dino ambiente del scenery (visible solo en MENU). */
export function setAmbientDinoVisible(visible) {
    if (scenery) scenery.setAmbientDinoVisible(visible);
}

/** Cambia el skin del dino ambiente (lo empuja la UI al cambiar AJUSTES). */
export function setAmbientDinoSkin(skinId) {
    if (scenery) scenery.setAmbientDinoSkin(skinId);
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
        setRenderPaused,
        setRenderProfile,
        setQualityTier,
        getQualityTier,
        setAmbientDinoVisible,
        setAmbientDinoSkin,
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
