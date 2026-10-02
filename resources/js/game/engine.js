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
// getView (vista del mundo), setWorldSpeed (scroll del scenery), setMusic (lo que
// la partida sabe de la música en este fotograma) y los efectos (ver abajo).
//
// Tamaños de pantalla (Sep 2026): scenery, líneas de velocidad, juego y motas
// cuelgan de `worldRoot`, escalado por la vista del mundo (systems/worldView.js):
// todo lo de dentro trabaja en unidades de mundo, y cualquier pantalla apaisada
// enseña casi el mismo mundo. El fondo (shader) y el hudLayer (destellos a
// pantalla completa) siguen en píxeles de pantalla.
//
// Escenario (T01): el engine es dueño de la ESCENA (scenes/registry.js)
// y de la HORA del cielo. La partida empuja la hora de su plan (setSkyHour) y el
// menú usa la de la escena; cada frame en que cambia, scenes/skyModel.js la
// convierte en el cielo del shader y el color de las capas del escenario.
// `setAudioFxEnabled(false)` (panel dev) deja ver el escenario sin los efectos.
//
// Efectos (T03.1): el engine es dueño de las SEÑALES (fx/signals.js: lo que suena,
// lo que empuja la partida con `setMusic`, la hora del cielo) y del DIRECTOR
// (fx/director.js), que decide cuánto se ve cada efecto. Cada fotograma: señales →
// director → pintores (el shader con fx/skyAmounts.js, las capas del escenario,
// las motas y las líneas de velocidad). Nada más decide si un efecto se ve.
//
// Escena por nivel (T02): AppController carga la escena del nivel
// (`loadScene`, que descarga sus capas si no van en el bundle) y la pone al
// empezar la partida (`setScene`); el menú vuelve a la de siempre. Cada escena
// dice dónde está su horizonte (`horizonRise`): el shader pinta el cielo hasta
// él (uHorizon) y los efectos siguen anclados al suelo (uGround).

import {
    Application,
    Container,
    Sprite,
    Texture,
} from 'pixi.js';

import { createAudioFilter, FFT_BINS } from './shaders/audioFilter.js';
import { computeBands } from './audio/features.js';
import { createFxDirector } from './fx/director.js';
import { FX_LIMIT } from './fx/limiter.js';
import { DEFAULT_FX_PREF, FX_COSTS } from './fx/registry.js';
import { applyMusicFrame, clearMusicSignals, createFxSignals, readSkySignals } from './fx/signals.js';
import { createSkyAmounts, skyAmounts } from './fx/skyAmounts.js';
import { createSpectrum } from './fx/spectrum.js';
import { createParticleLayer } from './entities/ParticleLayer.js';
import { createScenery } from './entities/Scenery.js';
import { layerTypesReady, loadLayerTypes } from './entities/scenery/index.js';
import { createSpeedLines } from './entities/SpeedLines.js';
import { SCENERY, DT_CAP_S, WORLD_VIEW, WORLD_VIEW_PORTRAIT_MENU } from './config.js';
import { resolveBudget, MAX_FILTER_DPR, TIER_ORDER } from './RenderProfile.js';
import { computeWorldView, sameView } from './systems/worldView.js';
import { DEFAULT_SCENE, SKY_ELEMENTS, resolveScene, sceneElements } from './scenes/registry.js';
import { createSkyState, skyColorAt, skyStateAt } from './scenes/skyModel.js';
import { rgbToHex } from './scenes/color.js';

/** Evento con la vista nueva cuando cambia (resize, rotación, zoom). */
export const VIEW_CHANGE_EVENT = 'daino:viewchange';

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
let speedLines = null;     // líneas de velocidad (null con reduced motion)
let isPaused = false;
let timeAccum = 0;         // segundos desde init — siempre avanza salvo pausa
let worldSpeed = SCENERY.menuSpeed;  // px/s del scroll del scenery

// --- Efectos (T03.1) ---
/** Bins nativos del AnalyserNode (fftSize 2048): de ellos sale el espectro en barras. */
const NATIVE_BINS = 1024;
const fxSignals = createFxSignals();
const fxDirector = createFxDirector();
const fxAmounts = createSkyAmounts();
const spectrum = createSpectrum({ bins: NATIVE_BINS });
/** Lo que reciben los pintores del escenario cada fotograma (el mismo objeto: no guardarlo). */
const fxFrame = { levels: fxDirector.levels, colors: fxDirector.colors, signals: fxSignals, spectrum };
/** Preferencia del jugador ("Efectos visuales" de AJUSTES); con reduced motion, la mínima. */
let fxPref = DEFAULT_FX_PREF;

// --- Escenario (T01) ---
let scene = resolveScene(DEFAULT_SCENE);
let skyHour = null;              // hora que empuja la partida; null = la del menú
const skyState = createSkyState();
let appliedHour = NaN;           // última hora convertida en cielo
let skyDirty = true;             // escena o vista nuevas: recalcular aunque la hora no cambie
let cssSkyAt = -Infinity;        // último volcado del cielo a las variables CSS
let fxEnabled = true;            // efectos de la música (panel dev: "Efectos del audio")

// --- Perfiles de render (Ola 1) ---
let profileName = 'MENU';        // estado actual de la app
let qualityTier = 'high';        // tier efectivo (auto-degradado o forzado)
let qualityLocked = false;       // true si el user eligió tier a mano
let budget = resolveBudget('MENU', 'high');
let modalOpen = false;           // hay un <dialog open>: presupuesto de PAUSED

// Layers expuestos a module-scope para que `getApi().getLayers()` pueda
// devolver referencias estables sin filtrar internals.
let bgLayer = null;
let worldRoot = null;      // escala de la vista: todo lo de dentro, en unidades de mundo
let sceneryLayer = null;
let gameLayer = null;
let particleLayer = null;
let hudLayer = null;
/** @type {import('./systems/worldView.js').WorldView | null} */
let view = null;
/** Recalcula la vista y la aplica si cambió (lo monta startEngine). */
let refitView = () => {};

/** Reglas de la vista: las de partida, salvo el menú en una pantalla vertical. */
function viewRules() {
    return profileName === 'MENU' && window.innerHeight > window.innerWidth ? WORLD_VIEW_PORTRAIT_MENU : WORLD_VIEW;
}

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
    view = computeWorldView({ width: window.innerWidth, height: window.innerHeight, dpr: app.renderer.resolution }, viewRules());

    // Layers — contenedores apilados, mismo orden que doc 06 §3 + scenery.
    bgLayer = new Container({ label: 'bg' });
    worldRoot = new Container({ label: 'world' });
    worldRoot.scale.set(view.scale);
    scenery = createScenery({ width: view.width, height: view.height }, scene, { still: REDUCED_MOTION });
    sceneryLayer = scenery.container;
    gameLayer = new Container({ label: 'game' });
    particleLayer = createParticleLayer(
        { width: view.width, height: view.height },
        { reducedMotion: REDUCED_MOTION },
    );
    hudLayer = new Container({ label: 'hud' });
    // Líneas de velocidad entre el scenery y el juego: aire por delante de las
    // montañas y por detrás de Dino y obstáculos.
    if (!REDUCED_MOTION) speedLines = createSpeedLines({ width: view.width, height: view.height, groundY: view.groundY });
    worldRoot.addChild(sceneryLayer);
    if (speedLines) worldRoot.addChild(speedLines.container);
    worldRoot.addChild(gameLayer, particleLayer);
    app.stage.addChild(bgLayer, worldRoot, hudLayer);

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

    let applied = null;
    const fitViewport = () => {
        const next = computeWorldView({ width: window.innerWidth, height: window.innerHeight, dpr: app.renderer.resolution }, viewRules());
        if (sameView(applied, next)) return;
        applied = next;
        view = next;
        const { screenWidth: w, screenHeight: h } = next;
        if (bgSprite) {
            bgSprite.width = w;
            bgSprite.height = h;
        }
        if (audioFilter) {
            // uFrame y uCell: el sol es un círculo y las estrellas son celdas del
            // arte en cualquier formato (antes se estiraban con la pantalla).
            // uFxBand: dónde acaba la franja jugable en pantalla (el limitador de
            // los efectos, fx/limiter.js).
            audioFilter.setUniforms({
                frame: [w, h],
                cell: next.cellPx,
                band: [
                    (next.screenGroundY - FX_LIMIT.playTopPx * next.scale) / h,
                    (FX_LIMIT.softPx * next.scale) / h,
                    FX_LIMIT.cap,
                ],
            });
        }
        applyHorizon();
        worldRoot.scale.set(next.scale);
        scenery.resize(next.width, next.height);
        skyDirty = true;
        particleLayer.resize(next.width, next.height);
        speedLines?.resize(next.width, next.height, next.groundY);
        // La vista también la usa el CSS: el HUD y los paneles pueden alinearse
        // con el suelo del mundo sin preguntar al engine.
        document.documentElement.style.setProperty('--daino-ground-offset', `${(h - next.screenGroundY).toFixed(1)}px`);
        window.dispatchEvent(new CustomEvent(VIEW_CHANGE_EVENT, { detail: next }));
    };
    fitViewport();
    refitView = fitViewport;
    // Tras `resize` también en orientationchange y visualViewport: algunos
    // móviles informan el tamaño nuevo un frame después de girar.
    window.addEventListener('resize', fitViewport);
    window.addEventListener('orientationchange', () => requestAnimationFrame(fitViewport));
    window.visualViewport?.addEventListener('resize', fitViewport);

    // Presupuesto inicial (MENU). Se aplica DESPUÉS de crear el filtro y la
    // capa de partículas: `applyBudget` toca ambos.
    fxDirector.configure({ scene, pref: REDUCED_MOTION ? 'min' : fxPref });
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
    speedLines?.setActiveRatio(budget.particleRatio);
    // La lluvia y la nieve del escenario (T02.3), con el mismo presupuesto.
    scenery?.setDetail(budget.particleRatio);
    // Efectos (T03.1): el tier de calidad dice hasta qué coste se pintan.
    fxDirector.configure({ costRank: FX_COSTS.indexOf(budget.fxCost) });
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
    // El menú en vertical usa otra vista (ver WORLD_VIEW_PORTRAIT_MENU).
    refitView();
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

    // Scenery: vivo salvo reduced motion o presupuesto que lo congele
    // (LOADING, PAUSED, modal abierto).
    if (!REDUCED_MOTION && budget.sceneryAnimated) {
        scenery.tick(dt, worldSpeed);
        speedLines?.tick(dt, worldSpeed);
    }
    updateSky();

    // ---------- Efectos (T03.1): señales → director → pintores ----------
    // Lo que suena ahora. Sin audio (el menú) las señales de la música están a
    // cero y el director deja a cero todo lo que no es ambiente.
    if (audio !== null) {
        const bytes = audio.getFrequencyData(NATIVE_BINS);
        computeBands(bytes, fxSignals.live);
        fxSignals.live.rms = audio.getRMS();
        spectrum.update(bytes, dt);
        if (DEBUG_MODE === 1 && audioFilter) {
            audioFilter.fftBuffer.set(audio.getFrequencyData(FFT_BINS));
            audioFilter.uploadFft();
        }
    }
    fxDirector.update(fxSignals, dt);
    const levels = fxDirector.levels;

    if (audioFilter) {
        // uTime y uDebugMode se actualizan SIEMPRE — alimentan la escena idle
        // (estrellas, respiración del sol) y los modos ?debug=N.
        audioFilter.setUniforms({ time: timeAccum, debugMode: DEBUG_MODE });
        audioFilter.setFx(skyAmounts(levels, fxSignals, fxAmounts), fxDirector.colors);
    }
    scenery.setFx(fxFrame);
    speedLines?.setLevel(fxSignals.speed.lines * levels.speedLines);
    speedLines?.setColors(fxDirector.colors);

    // Las motas suben con la energía de lo que suena y más en los tramos que
    // empujan: en una estrofa flotan, en el clímax vuelan. Su nivel dice cuánto
    // se ven (con lluvia o nieve, o si la escena no las quiere, se van).
    if (particleLayer.tick) {
        particleLayer.alpha = Math.min(1, levels.motes);
        particleLayer.visible = levels.motes > 0.004;
        if (particleLayer.visible) particleLayer.tick(dt, fxSignals.live.rms * (0.6 + 0.9 * fxSignals.song.intensity));
    }
}

// --------------------------- Escenario (T01) ---------------------------

/** Hora del cielo: la del panel dev si está fijada, la de la partida o la del menú. */
function currentSkyHour() {
    if (import.meta.env.DEV) {
        const dev = window.__daino?.sky?.hour;
        if (Number.isFinite(dev)) return dev;
    }
    return skyHour ?? scene.menuHour;
}

let cssSkyPending = false;
const cssTmp = [0, 0, 0];

/**
 * Convierte la hora en cielo cuando cambia: uniforms del shader, color de las
 * capas del escenario y, sin shader (prefers-reduced-motion), el degradado CSS.
 * En el menú la hora no se mueve y esto no hace nada.
 */
function updateSky() {
    const hour = currentSkyHour();
    if (hour !== appliedHour || skyDirty) {
        appliedHour = hour;
        skyDirty = false;
        skyStateAt(hour, scene, skyState);
        if (audioFilter) audioFilter.setSky(skyState);
        scenery.light(skyState);
        // El cielo también es una señal de los efectos: el sol late si hay sol,
        // las estrellas si es de noche, las motas se van si llueve.
        readSkySignals(skyState, scene, fxSignals, view?.height);
        cssSkyPending = audioFilter === null;
    }
    // Sin shader, el cielo es el degradado CSS del body: como mucho 2 veces por
    // segundo (un cambio de variables CSS repinta la página entera).
    if (cssSkyPending && performance.now() - cssSkyAt >= 500) {
        cssSkyAt = performance.now();
        cssSkyPending = false;
        const root = document.documentElement.style;
        root.setProperty('--daino-sky-top', rgbToHex(skyState.sky.top));
        root.setProperty('--daino-sky-mid', rgbToHex(skyColorAt(skyState, 0.55, cssTmp)));
        root.setProperty('--daino-sky-horizon', rgbToHex(skyColorAt(skyState, 0.97, cssTmp)));
    }
}

/**
 * Hora del cielo que empuja la partida (horas continuas: las 5:00 del día
 * siguiente son 29). `null` vuelve a la hora del menú de la escena.
 * @param {number | null} hour
 */
export function setSkyHour(hour) {
    skyHour = Number.isFinite(hour) ? hour : null;
}

/**
 * Horizonte del cielo de la escena en pantalla (T02.2): uv del shader (uHorizon)
 * y variable CSS del degradado de reduced motion.
 */
function applyHorizon() {
    if (!view) return;
    const h = view.screenHeight;
    const skyY = view.screenGroundY - (scene.horizonRise ?? 0) * view.scale;
    audioFilter?.setUniforms({ horizon: skyY / h });
    document.documentElement.style.setProperty('--daino-sky-horizon-offset', `${(h - skyY).toFixed(1)}px`);
}

/**
 * Deja lista una escena: descarga las capas que no van en el bundle. Devuelve el
 * id de la escena que se podrá poner (la de siempre si la pedida no llega: sin
 * red, por ejemplo; una partida no se queda sin empezar por su escenario).
 *
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function loadScene(id) {
    const target = resolveScene(id);
    try {
        await loadLayerTypes(target);
        return target.id;
    } catch (err) {
        console.warn(`[engine] no se pudo cargar la escena "${target.id}"; se usa la de siempre:`, err);
        return DEFAULT_SCENE;
    }
}

/** Número de la última escena pedida: una carga lenta no pisa a una petición posterior. */
let sceneRequest = 0;

/**
 * Pone una escena. Síncrona si ya está cargada (AppController la carga antes con
 * `loadScene`); si no (el panel dev), la carga y la pone al llegar, salvo que
 * entretanto se haya pedido otra.
 *
 * @param {string} id
 */
export function setScene(id) {
    const next = resolveScene(id);
    const req = ++sceneRequest;
    if (!layerTypesReady(next)) {
        void loadScene(next.id).then((readyId) => {
            if (req === sceneRequest) applyScene(resolveScene(readyId));
        });
        return;
    }
    applyScene(next);
}

function applyScene(next) {
    if (next === scene) return;
    scene = next;
    scenery?.setScene(scene);
    applyHorizon();
    skyDirty = true;
    // La escena manda sobre los efectos (su política `fx`, fx/policy.js).
    fxDirector.configure({ scene });
}

/** Enciende o apaga un elemento del escenario por su id (panel dev). */
export function setSkyElementVisible(id, visible) {
    const el = SKY_ELEMENTS.find((e) => e.id === id);
    if (el) audioFilter?.setSkyElement(el.slot, visible);
    else scenery?.setElementVisible(id, visible);
}

/**
 * Efectos de la música sí/no (panel dev): sin ellos se ve el escenario solo, con
 * su hora. Es el maestro del director: todos los niveles a cero.
 */
export function setAudioFxEnabled(enabled) {
    fxEnabled = enabled;
    fxDirector.setOverrides({ master: enabled });
}

/**
 * Preferencia del jugador para los efectos ("Efectos visuales" de AJUSTES):
 * 'full' | 'soft' | 'min' (fx/registry.js, FX_PREFS). Con reduced motion manda
 * la mínima. También decide los destellos del escenario (los relámpagos): solo
 * se apagan con la mínima.
 *
 * @param {string} pref
 */
export function setFxPref(pref) {
    fxPref = pref;
    fxDirector.configure({ pref: REDUCED_MOTION ? 'min' : pref });
    scenery?.setFlashes(pref !== 'min');
}

/**
 * Panel dev "Efectos": apagar, ver solo uno o cambiar la intensidad de un efecto
 * (fx/director.js, setOverrides).
 */
export function setFxOverrides(overrides) {
    fxDirector.setOverrides(overrides);
}

/**
 * Conecta un AudioEngine al ticker. Idempotente — reemplaza el audio anterior si
 * lo había. Desde aquí hay partida: las señales en vivo se leen cada fotograma.
 */
export function attachAudio(audioEngine) {
    audio = audioEngine;
    fxSignals.playing = true;
    if (audioFilter) audioFilter.setMode('reactive');
}

/**
 * Desconecta el audio: las señales de la música a cero y los efectos fuera sin
 * fundido (el menú se ve idéntico al primer load, sin contaminación).
 */
export function detachAudio() {
    audio = null;
    clearMusicSignals(fxSignals);
    fxDirector.reset();
    spectrum.reset();
    if (audioFilter) audioFilter.setMode('idle');
    scenery?.setFx(fxFrame);
    speedLines?.setLevel(0);
    speedLines?.setClearance(0);
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
 * Lo que la partida sabe de la música en este fotograma (fx/signals.js): el pulso
 * (`pulse`, `worldPulse` con el contratiempo de las subidas, `accent` en el
 * primer tiempo), la estructura (`intensity`, `climax`, `build`, `calm`,
 * `hue`, `flash`), las líneas de velocidad que pide el nivel (`lines`) y el
 * silencio de una historia (`hush`). Solo cambian las claves que se pasan. El
 * director decide qué hace cada efecto con ello.
 *
 * `clearAbove` (Ola 6a) no es una señal sino geometría: sube la franja libre de
 * líneas de velocidad mientras el pasillo de un modo está en pantalla (una raya
 * a la altura del techo se leería como un obstáculo). 0 vuelve a la de siempre.
 *
 * @param {Parameters<typeof applyMusicFrame>[1] & { clearAbove?: number }} frame
 */
export function setMusic(frame) {
    applyMusicFrame(fxSignals, frame);
    if (frame.clearAbove !== undefined) speedLines?.setClearance(frame.clearAbove);
}

/** Ráfaga de líneas de velocidad en un acelerón, si el efecto se está viendo. */
export function speedBurst() {
    if (fxDirector.levels.speedLines > 0.5) speedLines?.burst();
}

function getApi() {
    return {
        app,
        attachAudio,
        detachAudio,
        setWorldSpeed,
        setMusic,
        speedBurst,
        setFxPref,
        setFxOverrides,
        // Efectos (T03.1): niveles y colores que leen los pintores de la partida
        // (objetos vivos: no guardarlos), y todo junto para el panel dev.
        getFxLevels: () => fxDirector.levels,
        getFxColors: () => fxDirector.colors,
        getFx: () => ({ levels: fxDirector.levels, colors: fxDirector.colors, signals: fxSignals, spectrum, reasonOf: fxDirector.reasonOf, pref: fxPref }),
        setRenderPaused,
        setRenderProfile,
        setQualityTier,
        getQualityTier,
        setAmbientDinoVisible,
        setAmbientDinoSkin,
        setSkyHour,
        loadScene,
        setScene,
        setSkyElementVisible,
        setAudioFxEnabled,
        // Escenario vigente y su hora (lo lee la GameSession para su plan y el
        // panel dev para enseñarlo).
        getScene: () => scene,
        getSceneElements: () => sceneElements(scene),
        getSky: () => ({ hour: appliedHour, phase: skyState.phase, elev: skyState.elev, flash: skyState.sun.flash, sceneId: scene.id, fx: fxEnabled }),
        getCanvas: () => app?.canvas ?? null,
        // Vista del mundo vigente (se sustituye, no se muta, al cambiar):
        // tamaño visible y suelo en unidades de mundo, escala y suelo en px.
        getView: () => view,
        // GameSession monta Dino/Obstacle en gameLayer, bursts también ahí.
        // Devolvemos refs vivas — no copiamos para evitar el foot-gun de
        // "monté en una copia y nada se ve". scenery, game y particles están en
        // unidades de mundo; bg y hud, en píxeles de pantalla.
        getLayers: () => ({ bgLayer, worldRoot, sceneryLayer, gameLayer, particleLayer, hudLayer }),
        // Passthrough del ticker. La GameSession registra su tick aquí; no
        // creamos un rAF propio (un solo loop, ya pausa con audio:pause).
        getTicker: () => app?.ticker ?? null,
        get reducedMotion() { return REDUCED_MOTION; },
    };
}
