// Engine — núcleo PixiJS de Daino.
//
// Responsabilidades (ampliadas en el rediseño visual Jul 2026):
//   - Crear la Application en `<div id="app">` o `document.body`.
//   - Apilar las capas visuales del doc 06 §3 + scenery:
//       bg (shader) → scenery (suelo/nubes/montañas parallax) → game →
//       particles → hud.
//   - Pintar el cielo (el shader del fondo, con los efectos de la música) en su
//     búfer y enseñarlo en la capa de fondo, con uHorizon anclado al suelo.
//   - Scrollear el scenery SIEMPRE (menú a SCENERY.menuSpeed, partida a
//     gameSpeed vía setWorldSpeed) — el mundo nunca está muerto.
//   - Animar las motas de la particleLayer (energy = RMS en partida, 0 idle).
//   - Pausar el ticker cuando el AudioContext esté `suspended` (doc 07 §C.3).
//   - Si `prefers-reduced-motion`: sin shader, sin motas, scenery estático —
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
// Rendimiento (T05): el cielo —lo único caro del fotograma— se pinta en su propio
// búfer (shaders/skyBuffer.js), a los texeles por celda que diga la calidad
// (systems/skyGrid.js) y por bandas —cada imagen, repartida en varios
// fotogramas—, y la escena solo lo enseña. El engine
// lleva su bucle de rAF (systems/framePacer.js decide cuáles se pintan, siempre
// parejos) y la calidad automática mide los fotogramas de la partida
// (systems/frameGovernor.js).
//
// Escena por nivel (T02): AppController carga la escena del nivel
// (`loadScene`, que descarga sus capas si no van en el bundle) y la pone al
// empezar la partida (`setScene`); el menú vuelve a la de siempre. Cada escena
// dice dónde está su horizonte (`horizonRise`): el shader pinta el cielo hasta
// él (uHorizon) y los efectos siguen anclados al suelo (uGround).

import {
    Application,
    Container,
} from 'pixi.js';

import { createSkyBuffer } from './shaders/skyBuffer.js';
import { createSkyShader, FFT_BINS } from './shaders/skyShader.js';
import { computeBands } from './audio/features.js';
import { createFxDirector } from './fx/director.js';
import { DEFAULT_FX_IDENTITY } from './fx/identity.js';
import { FX_LIMIT } from './fx/limiter.js';
import { DEFAULT_FX_PREF, FX_COSTS } from './fx/registry.js';
import { applyMusicFrame, clearMusicSignals, createFxSignals, readSkySignals } from './fx/signals.js';
import { advanceSkyClocks, createSkyAmounts, createSkyClocks, resetSkyClocks, skyAmounts } from './fx/skyAmounts.js';
import { createSpectrum } from './fx/spectrum.js';
import { createParticleLayer } from './entities/ParticleLayer.js';
import { createScenery } from './entities/Scenery.js';
import { layerTypesReady, loadLayerTypes } from './entities/scenery/index.js';
import { createSpeedLines } from './entities/SpeedLines.js';
import { SCENERY, DT_CAP_S, WORLD_VIEW, WORLD_VIEW_PORTRAIT_MENU } from './config.js';
import { resolveBudget } from './RenderProfile.js';
import { createFrameGovernor } from './systems/frameGovernor.js';
import { createFramePacer, divisorFor } from './systems/framePacer.js';
import { skyBandCount, skyBufferFor } from './systems/skyGrid.js';
import { computeWorldView, sameView } from './systems/worldView.js';
import { DEFAULT_SCENE, SKY_ELEMENTS, resolveScene, sceneElements } from './scenes/registry.js';
import { createSkyState, skyColorAt, skyStateAt } from './scenes/skyModel.js';
import { rgbToHex } from './scenes/color.js';
import { getAutoQuality, setAutoQuality } from '../ui/settings.js';

/** Evento con la vista nueva cuando cambia (resize, rotación, zoom). */
export const VIEW_CHANGE_EVENT = 'daino:viewchange';

/** Cuánto conserva la gráfica lo que no se está pintando (ver `app.init`): más que una canción. */
const GPU_KEEP_MS = 12 * 60 * 1000;

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
let skyShader = null;      // resultado de createSkyShader() (null con reduced motion)
let skyBuffer = null;      // donde se pinta: shaders/skyBuffer.js
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
/** Relojes de las firmas del cielo (cuánto ha fluido la aurora, el último primer tiempo). */
const fxClocks = createSkyClocks();
/** La identidad de los efectos de la canción que suena (T03.3): su paleta y su firma. */
let fxIdentity = DEFAULT_FX_IDENTITY;
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

// --- Perfiles de render (Ola 1) y rendimiento (T05) ---
let profileName = 'MENU';        // estado actual de la app
let budget = resolveBudget('MENU', 'high');
let modalOpen = false;           // hay un <dialog open>: presupuesto de PAUSED
/** Qué fotogramas de la pantalla se pintan (systems/framePacer.js). */
const pacer = createFramePacer();
/** La calidad: la automática o la elegida en AJUSTES (systems/frameGovernor.js). */
let governor = createFrameGovernor();
let renderPaused = false;        // setRenderPaused: no se pinta nada (carga de un nivel)
let lastPaintAt = NaN;           // tiempo del rAF del último fotograma pintado
let frameCpuMs = 0;              // lo que costó el JS del último fotograma
let knownRefreshMs = pacer.refreshMs;
let attemptOpen = false;         // hay un intento en curso (beginAttempt → sale de la partida)
// El cielo en su búfer (T05.1).
let skyStale = true;             // hay que repintarlo ENTERO (búfer nuevo, escena, perfil…)
/** Panel dev "Cielo": texeles y ritmo forzados (null = los del presupuesto). */
const skyOverride = { texels: null, hz: null };

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
        // El ritmo lo lleva el engine (frameLoop): el ticker de Pixi no pide sus rAF.
        autoStart: false,
        // Pixi suelta de la gráfica lo que lleva un minuto sin pintarse (texturas,
        // geometría de los Graphics) y lo rehace al volver a pintarlo. Aquí eso
        // deshacía el precalentado (systems/prewarm.js): los muros de un túnel que
        // asoma en el minuto 2 se triangulaban otra vez al asomar. Lo que crea un
        // nivel es poco y se destruye con su sesión: se guarda lo que dura una canción.
        gcMaxUnusedTime: GPU_KEEP_MS,
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
    // Pixi (su sistema de eventos, que el juego no usa) deja `touch-action: none`
    // escrito en el propio lienzo, y lo escrito ahí gana a la hoja de estilos: en
    // un móvil, un dedo sobre el fondo no podía tirar para recargar ni en el menú.
    // Se quita, y lo decide el CSS según el estado de la app (base.css).
    app.canvas.style.removeProperty('touch-action');

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

    // Si el user pidió reducir movimiento, no hay shader — el body muestra el
    // degradado CSS estático que ya define main.css. El canvas pinta scenery +
    // gameplay quietos encima sin problemas.
    if (!REDUCED_MOTION) {
        // El cielo se pinta en su búfer y la escena enseña el búfer (T05.1).
        skyShader = createSkyShader();
        skyBuffer = createSkyBuffer(skyShader);
        bgLayer.addChild(skyBuffer.sprite);
    }

    let applied = null;
    const fitViewport = () => {
        const next = computeWorldView({ width: window.innerWidth, height: window.innerHeight, dpr: app.renderer.resolution }, viewRules());
        if (sameView(applied, next)) return;
        applied = next;
        view = next;
        const { screenWidth: w, screenHeight: h } = next;
        if (skyShader) {
            // uFrame y uCell: el sol es un círculo y las estrellas son celdas del
            // arte en cualquier formato (antes se estiraban con la pantalla).
            // uFxBand: dónde acaba la franja jugable en pantalla (el limitador de
            // los efectos, fx/limiter.js).
            skyShader.setUniforms({
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
        applySkyGrid();
        // Un cambio de tamaño da tirones que no dicen nada del equipo.
        governor.hold();
        worldRoot.scale.set(next.scale);
        scenery.resize(next.width, next.height);
        skyDirty = true;
        skyStale = true;
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

    // La calidad automática: lo que aprendió la visita anterior y, en una pantalla
    // táctil, un cielo más ligero de salida (más píxeles y menos gráfica).
    governor = createFrameGovernor({
        refreshHz: pacer.refreshHz,
        coarse: matchMedia('(pointer: coarse)').matches,
        remembered: getAutoQuality(),
    });

    // Presupuesto inicial (MENU). Se aplica DESPUÉS de crear el búfer del cielo
    // y la capa de partículas: `applyBudget` toca ambos.
    fxDirector.configure({ scene, pref: REDUCED_MOTION ? 'min' : fxPref });
    applyBudget();
    watchModals();

    // Pause/resume del ticker basado en el estado del AudioContext.
    // dispatch lo hace AudioEngine cuando recibe `onstatechange`.
    window.addEventListener('audio:pause', () => { isPaused = true; });
    window.addEventListener('audio:resume', () => { isPaused = false; });

    app.ticker.add(tick);
    app.ticker.lastTime = performance.now();
    requestAnimationFrame(frameLoop);

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
    const quality = governor.state;
    budget = resolveBudget(effective, quality.tier, quality.pace);

    // Qué fotogramas de la pantalla se pintan: el tope del estado y el ritmo que
    // pida la calidad, siempre parejos (uno de cada k).
    pacer.setDivisor(divisorFor(pacer.refreshHz, budget.maxFPS, budget.pace));

    // El detalle del cielo: los texeles por celda de la calidad.
    applySkyGrid();
    skyStale = true;

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
 * El búfer del cielo para la vista y la calidad vigentes (T05.1). Si hay que
 * crearlo de nuevo, se repinta antes de enseñarlo.
 */
function applySkyGrid() {
    if (skyBuffer === null || view === null) return;
    if (skyBuffer.configure(skyBufferFor(view, skyOverride.texels ?? budget.skyTexels))) skyStale = true;
}

/**
 * Pinta el cielo de este fotograma: una banda de la imagen en curso (el cielo se
 * renueva `skyHz` veces por segundo; con el ritmo de fotogramas vigente cada
 * imagen se reparte en `skyBandCount` bandas), o la imagen entera si algo lo
 * cambió de golpe.
 *
 * El estado del cielo (la hora, las cantidades de los efectos, el tiempo) se le
 * da al shader solo al EMPEZAR cada imagen: todas sus bandas son del mismo
 * instante. El engine lo calcula cada fotograma igualmente (lo usan el escenario
 * y los relojes de las firmas); aquí solo se decide cuándo lo ve el shader.
 */
function drawSky() {
    if (skyBuffer === null) return;
    const hz = skyOverride.hz ?? budget.skyHz;
    // Un ritmo de 0 (panel dev) lo deja quieto: solo se pinta si algo lo cambió.
    if (!skyStale && !(hz > 0)) return;
    if (skyStale || skyBuffer.startsImage) {
        // uTime alimenta lo que vive solo (las estrellas, la respiración del sol).
        skyShader.setUniforms({ time: timeAccum, debugMode: DEBUG_MODE });
        skyShader.setSky(skyState);
        skyShader.setFx(fxAmounts, fxDirector.colors);
    }
    skyBuffer.draw(app.renderer, skyBandCount(pacer.frameMs, hz), skyStale);
    skyStale = false;
}

/**
 * Panel dev "Cielo" (y las medidas): fuerza los texeles por celda y el ritmo del
 * cielo para compararlos jugando. `null` vuelve a los del presupuesto; un ritmo
 * de 0 lo deja quieto.
 *
 * @param {{ texels?: number | null, hz?: number | null }} o
 */
export function setSkyOverride(o) {
    if (o.texels !== undefined) skyOverride.texels = o.texels;
    if (o.hz !== undefined) skyOverride.hz = o.hz;
    applySkyGrid();
    skyStale = true;
}

/**
 * Cambia el perfil de render según el estado de la app.
 * Lo llama `AppController.setState()`; no hay otro punto de entrada.
 *
 * @param {import('./RenderProfile.js').ProfileName} name
 */
export function setRenderProfile(name) {
    if (name === profileName) return;
    // Salir de la partida (y no a una pausa) cierra el intento: el gobernador
    // apunta si fue limpio, que es lo que le deja probar a subir en el siguiente.
    if (attemptOpen && name !== 'PLAYING' && name !== 'PAUSED') {
        attemptOpen = false;
        governor.attemptEnd();
        rememberQuality();
    }
    profileName = name;
    // Tras una pausa, los primeros fotogramas no dicen nada del equipo.
    governor.hold();
    applyBudget();
    // El menú en vertical usa otra vista (ver WORLD_VIEW_PORTRAIT_MENU).
    refitView();
}

/**
 * Empieza un intento (lo avisa AppController, bajo el fundido): el único momento
 * en que la calidad automática puede SUBIR un escalón.
 */
export function beginAttempt() {
    attemptOpen = true;
    const change = governor.attemptStart();
    if (change !== null) applyQuality(change);
}

/** Aplica un cambio de calidad del gobernador y lo recuerda para la próxima visita. */
function applyQuality(change) {
    if (import.meta.env.DEV) console.info(`[engine] calidad → ${change.tier} · ${change.pace} (${change.why})`);
    applyBudget();
    rememberQuality();
}

/** Guarda lo que la calidad automática ha aprendido de este equipo. */
function rememberQuality() {
    if (governor.learned) setAutoQuality(governor.memory());
}

/**
 * Fuerza un nivel de calidad ('high' | 'medium' | 'low') o vuelve a 'auto'.
 * Lo expone el modal AJUSTES. Elegir a mano desactiva la calidad automática:
 * si el usuario pidió Alta explícitamente, bajarle la calidad por detrás sería
 * ignorar su decisión.
 *
 * `fresh` (quien elige "Auto" en AJUSTES, no el arranque): la automática empieza
 * de cero, olvidando lo que aprendió — la manera de pedirle que vuelva a medir.
 *
 * @param {'auto'|'high'|'medium'|'low'} tier
 * @param {{ fresh?: boolean }} [opts]
 */
export function setQualityTier(tier, opts = {}) {
    if (tier === 'auto' && opts.fresh === true) {
        governor.reset();
        setAutoQuality(null);
    } else {
        governor.lock(tier === 'auto' ? null : tier);
    }
    applyBudget();
}

/** Calidad en uso — lo lee AJUSTES para mostrar qué está aplicando 'auto'. */
export function getQualityTier() {
    const q = governor.state;
    return { tier: q.tier, pace: q.pace, locked: governor.locked };
}

/**
 * Lo que mide el engine (lectura `?perf=1`, panel de resultados, panel dev): el
 * resumen del intento en curso, la pantalla, el ritmo y el cielo.
 */
export function getPerf() {
    const q = governor.state;
    const grid = skyBuffer?.grid ?? null;
    return {
        ...governor.stats(),
        tier: q.tier,
        pace: q.pace,
        locked: governor.locked,
        refreshHz: pacer.refreshHz,
        measured: pacer.measured,
        divisor: pacer.divisor,
        lastCpuMs: frameCpuMs,
        skyTexels: grid?.texels ?? 0,
        skyNative: grid?.native ?? 0,
        skySize: grid ? [grid.width, grid.height] : null,
        skyHz: skyOverride.hz ?? budget.skyHz,
        skyBands: skyBandCount(pacer.frameMs, skyOverride.hz ?? budget.skyHz),
        canvas: app ? [app.canvas.width, app.canvas.height] : null,
    };
}

// --- El bucle de fotogramas (T05.2) ---
//
// Un rAF por fotograma de la pantalla; `pacer` dice cuáles se pintan. Pintar es
// avanzar el ticker de Pixi a mano: sus tareas (la de este engine, la de la
// partida, el render) corren como siempre, con su `deltaMS`.
//
// Lo que cuesta el JS del fotograma se mide aquí mismo: con ello el gobernador
// distingue un equipo al que le falta gráfica (se le baja el cielo) de uno al que
// le falta procesador (se le baja el ritmo: el cielo no le arreglaría nada).
function frameLoop(now) {
    requestAnimationFrame(frameLoop);
    if (renderPaused || app === null) return;

    // La pantalla se mide en los estados en los que los rAF llegan a su hora.
    if (!pacer.tick(now, profileName !== 'PLAYING')) return;
    if (pacer.refreshMs !== knownRefreshMs) {
        knownRefreshMs = pacer.refreshMs;
        governor.setRefresh(pacer.refreshHz);
        applyBudget();
    }

    const dtMs = now - lastPaintAt;
    lastPaintAt = now;
    const t0 = performance.now();
    app.ticker.update(now);
    frameCpuMs = performance.now() - t0;

    // Solo se mide lo que se juega: en el menú, a 30, un fotograma "lento" es lo
    // normal y no dice nada del equipo.
    if (profileName === 'PLAYING' && !modalOpen && !isPaused) {
        const change = governor.sample(dtMs, frameCpuMs, pacer.frameMs);
        if (change !== null) applyQuality(change);
    }
}

function tick(ticker) {
    if (isPaused) {
        // En pausa no avanza nada, pero un búfer recién creado (un cambio de
        // tamaño con el juego detenido) hay que pintarlo: si no, cielo vacío.
        if (skyStale) drawSky();
        return;
    }

    // Mismo cap que usa GameSession (Ola 0). Antes el engine capaba a 1/20 s y
    // la GameSession a DT_CAP_S = 1/30 s sobre el MISMO frame: ante un tirón de
    // 40 ms el mundo (suelo, nubes, partículas) avanzaba 40 ms mientras el Dino
    // y los obstáculos avanzaban 33 ms. Un solo cap compartido mantiene mundo y
    // jugador en la misma escala temporal.
    const dt = Math.min(DT_CAP_S, ticker.deltaMS / 1000);
    timeAccum += dt;

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
        if (DEBUG_MODE === 1 && skyShader) {
            skyShader.fftBuffer.set(audio.getFrequencyData(FFT_BINS));
            skyShader.uploadFft();
        }
    }
    fxDirector.update(fxSignals, dt);
    const levels = fxDirector.levels;

    if (skyShader) {
        // Las cantidades de los efectos del cielo, cada fotograma (sus relojes
        // avanzan con la música); el shader las recibe cuando empieza una imagen.
        advanceSkyClocks(fxClocks, levels, fxSignals, dt);
        skyAmounts(levels, fxSignals, fxAmounts, fxClocks);
        drawSky();
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
        // El shader lo recibe al empezar su próxima imagen (drawSky).
        scenery.light(skyState);
        // El cielo también es una señal de los efectos: el sol late si hay sol,
        // las estrellas si es de noche, las motas se van si llueve.
        readSkySignals(skyState, scene, fxSignals, view?.height);
        cssSkyPending = skyShader === null;
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
    skyShader?.setUniforms({ horizon: skyY / h });
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
    skyStale = true;
    // La escena manda sobre los efectos (su política `fx`, fx/policy.js).
    fxDirector.configure({ scene });
}

/** Enciende o apaga un elemento del escenario por su id (panel dev). */
export function setSkyElementVisible(id, visible) {
    const el = SKY_ELEMENTS.find((e) => e.id === id);
    if (el) skyShader?.setSkyElement(el.slot, visible);
    else scenery?.setElementVisible(id, visible);
    skyStale = true;
}

/**
 * Efectos de la música sí/no (panel dev): sin ellos se ve el escenario solo, con
 * su hora. Es el maestro del director: todos los niveles a cero.
 */
export function setAudioFxEnabled(enabled) {
    fxEnabled = enabled;
    fxDirector.setOverrides({ master: enabled });
    skyStale = true;
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
 * La identidad de los efectos de la canción (T03.3, fx/identity.js): su paleta y,
 * si tiene, su firma. La pone AppController al empezar un nivel, con lo que el
 * servidor repartió por cómo suena (`levels.fx_auto`); `null` vuelve a lo de
 * siempre (el menú, una canción local). Una escena que fija sus colores o que
 * veta las firmas (una historia de autor) sigue mandando: lo decide el director.
 *
 * @param {import('./fx/identity.js').FxIdentity | null} identity
 */
export function setFxIdentity(identity) {
    fxIdentity = identity ?? DEFAULT_FX_IDENTITY;
    fxDirector.configure({ palette: fxIdentity.palette, signature: fxIdentity.signature });
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
    if (skyShader) skyShader.setMode('reactive');
}

/**
 * Desconecta el audio: las señales de la música a cero y los efectos fuera sin
 * fundido (el menú se ve idéntico al primer load, sin contaminación).
 */
export function detachAudio() {
    audio = null;
    clearMusicSignals(fxSignals);
    fxDirector.reset();
    resetSkyClocks(fxClocks);
    spectrum.reset();
    if (skyShader) skyShader.setMode('idle');
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
    renderPaused = paused;
    if (!paused) {
        // El hueco de la carga no es un fotograma: ni para el ritmo ni para el ticker.
        pacer.skip();
        lastPaintAt = NaN;
        app.ticker.lastTime = performance.now();
        governor.hold();
    }
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
        setFxIdentity,
        setFxOverrides,
        // Efectos (T03.1): niveles y colores que leen los pintores de la partida
        // (objetos vivos: no guardarlos), y todo junto para el panel dev.
        getFxLevels: () => fxDirector.levels,
        getFxColors: () => fxDirector.colors,
        getFx: () => ({ levels: fxDirector.levels, colors: fxDirector.colors, signals: fxSignals, spectrum, reasonOf: fxDirector.reasonOf, pref: fxPref, identity: fxIdentity, clocks: fxClocks }),
        setRenderPaused,
        setRenderProfile,
        setQualityTier,
        getQualityTier,
        beginAttempt,
        getPerf,
        setSkyOverride,
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
