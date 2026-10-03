// AppController — máquina de estados de la UI.
//
// Centraliza el ciclo "menú ↔ partida" para que main.js sea solo un entry
// point. Estados:
//
//   MENU       Estado base. Menú visible, HUD oculto.
//   LOADING    Preparando la partida: audio (caché o red), chart (caché, red o
//              generado aquí). Hint visible con la fase y su progreso real.
//   PLAYING    Partida en curso. Menú oculto, HUD visible.
//   PAUSED     Pausa explícita (Esc o el botón del HUD). Panel de pausa.
//   RESULTS    La partida terminó (choque o victoria). Panel de resultados
//              sobre la escena: reintentar, niveles o menú.
//   GAME_OVER  Efímero: la transición de salida (a otra partida o al menú).
//
// Eventos consumidos:
//   - 'daino:play-request'  Alguien pidió jugar (ui/playRequests.js) → LOADING.
//   - 'daino:prefetch-request'  Se abrió la ficha de un nivel: precarga (Ola 2).
//   - 'daino:gamestate'     GameSession terminó (win/collision) → RESULTS.
//
// Ola 3: la preparación de la partida la hace `levelLoader`, que decide qué
// sale de la caché, qué se descarga y qué se analiza. Aquí solo se traduce eso
// a estados y mensajes, y se decide qué persistir en el servidor.
//
// Reintentos (Sep 2026): antes, al chocar se volvía al menú con un aviso y
// reintentar costaba JUGAR + buscar la canción + esperar la carga. Ahora el
// nivel cargado se guarda en `run` mientras se juega: reintentar solo crea otra
// GameSession con el mismo audio decodificado y el mismo chart (un fundido de
// 0.36 s, sin red ni análisis). "Niveles" vuelve al catálogo con ese nivel a la
// vista. Un reintento desde la pausa, igual que salir, no guarda progreso.
//
// Direcciones (T06): la URL es una proyección de todo esto. Aquí se dice dónde
// está la app (`currentPlace`: el menú, el catálogo, la ficha de un nivel, o
// jugando) y el router (ui/router.js) mantiene la dirección al día. Cuando es el
// navegador el que se mueve —atrás, adelante, un enlace—, `handleNavigate` decide:
// en el menú se va a ese sitio; jugando, "atrás" es una pausa y no se va a ningún
// lado (lo mismo que Esc).
//
// El AppController es el único dueño de `activeSession`.

import { readSeedFromUrl } from '../game/levels/Seed.js';
import { createLevelLoader, LevelLoadError, LOAD_STAGE } from '../game/levels/levelLoader.js';
import { createWorkerAnalyzer, spawnAnalysisWorker } from '../game/levels/analysisClient.js';
import { GameSession } from '../game/GameSession.js';
import { getAudioEngine } from '../game/audio/sharedEngine.js';
import { ANALYSIS_SAMPLE_RATE } from '../game/audio/AudioEngine.js';
import { createLevelCache } from '../storage/levelCache.js';
import { sha256Hex } from '../storage/hash.js';
import { createLocalBests, mergeBest } from '../storage/localBests.js';
import * as menu from './menu.js';
import { fadeOverlay } from './transitions.js';
import { closeAllModals, openSettingsModal } from './modals.js';
import { catalogView, onCatalogView, openCatalog } from './catalog.js';
import { createRouter } from './router.js';
import { MENU } from './routeModel.js';
import { isBridgeEmbedded } from '../iframe/bridge.js';
import { PLAY_REQUEST_EVENT, PREFETCH_REQUEST_EVENT } from './playRequests.js';
import { showToast } from './toast.js';
import { hideLoader, showLoader } from './loader.js';
import { Input } from '../game/systems/input.js';
import { SCENERY } from '../game/config.js';
import { DEFAULT_SCENE, playSceneId } from '../game/scenes/registry.js';
import { resolveFxIdentity } from '../game/fx/identity.js';
import { fetchBinary, getUser, init as clientInit, request as apiRequest } from '../api/client.js';
import { invalidateLevels } from '../api/levelsCache.js';
import {
    getSkin, getQuality, getVolume, setVolume, getAutoRetry, setAutoRetry, countRunAndShouldHint,
    getFxLevel, FX_LEVEL_EVENT,
} from './settings.js';
import { openRunPanel, closeRunPanel } from './runPanel.js';
import { RUN_ACTION, runPanelView, createAttemptCounter } from './runPanelModel.js';
import { perfWanted } from './perfModel.js';
import { isTouchPortrait, shouldSuggestRotation, waitForLandscape } from './orientation.js';

const STATE = Object.freeze({
    MENU: 'MENU',
    LOADING: 'LOADING',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    RESULTS: 'RESULTS',
    GAME_OVER: 'GAME_OVER',
});

let state = STATE.MENU;
let engineApi = null;
let activeSession = null;
let lastAudioEngine = null;   // AudioEngine de la partida en curso (Settings lo usa)
let onPlayRequest = null;
let onGameState = null;
let onPause = null;
let onViewportChange = null;
let loader = null;
let onPrefetch = null;
const localBests = createLocalBests();
const attempts = createAttemptCounter();

/**
 * La partida vigente y lo necesario para reintentarla sin volver a cargar.
 *
 * @type {{
 *   key: string,
 *   loaded: object,
 *   levelId: number | null,          progreso en el servidor (solo con sesión)
 *   catalogLevelId: number | null,   nivel del catálogo (marca local y "Niveles")
 *   catalogTab: 'public' | 'mine',
 *   best: { points: number, percentage: number } | null,   marca antes del intento en curso
 *   attempt: number,
 *   sections: Array<object>,
 *   scene: string,                   escenario del nivel (T02), ya cargado
 * } | null}
 */
let run = null;

/** Destino pedido desde la pausa cuando la partida ya estaba superada (se cierra como victoria antes). */
let pendingExit = null;

/** El router (T06) y la baja de su aviso del catálogo. */
let router = null;
let offCatalogView = null;
/**
 * Lo que se está cargando para jugar, antes de que exista `run`: el nivel del
 * catálogo (su dirección es la de la partida) o una canción propia (`id` null).
 * @type {{ id: number | null, title: string | null, tab: 'public' | 'mine' } | null}
 */
let loadingPlay = null;
/** Adónde se está saliendo de la partida, mientras dura el fundido. @type {import('./routeModel.js').Route | null} */
let leavingTo = null;
/** Lo que se espera a saber quién mira antes de abrir un enlace («Míos», un nivel propio sin publicar). */
const INITIAL_AUTH_WAIT_MS = 4000;

/** Cuenta atrás al reanudar desde la pausa: de cuánto, cada cuánto y cuándo se comprueba que el audio volvió. */
const RESUME_COUNTDOWN = Object.freeze({ from: 3, stepMs: 420, watchMs: 500 });
/** El audio no volvió tras una cuenta atrás: el siguiente "Reanudar" lo hace dentro del gesto. */
let resumeInGesture = false;
/** Temporizador de la cuenta atrás en marcha (0 = ninguna). */
let resumeTimer = 0;
let onAudioPause = null;

/**
 * Número de la petición de partida vigente. Si llega otra mientras la
 * anterior carga (soltar un MP3 con otro descargándose), la vieja descubre al
 * terminar que ya no es la vigente y se descarta en silencio.
 */
let playRequestSeq = 0;

/**
 * Análisis de canciones locales en un Web Worker (Ola 4), con el hilo principal
 * como respaldo. Mismo resultado en ambos: la caché de análisis no distingue.
 */
const localAnalyzer = createWorkerAnalyzer({
    spawn: typeof Worker === 'function' ? spawnAnalysisWorker : null,
    analyzeInline: async (audioBuffer, opts) => (await import('../game/levels/analyze.js')).analyzeAudio(audioBuffer, opts),
});

/**
 * @param {{ engine: any }} cfg
 */
export function start(cfg) {
    engineApi = cfg.engine;

    loader = createLevelLoader({
        cache: createLevelCache(),
        // Con el Bearer de la sesión: el autor juega su nivel listo para
        // publicar desde el audio del servidor (sin volver a elegir el MP3).
        fetchAudio: (url) => fetchBinary(url),
        getJson: (path) => apiRequest('GET', path),
        decode: (bytes) => getAudioEngine().decode(bytes),
        // La precarga decodifica sin tocar el AudioContext del juego: crearlo o
        // reanudarlo fuera de un gesto del usuario lo dejaría suspendido. Un
        // AudioBuffer no está atado a su contexto, así que el de un
        // OfflineAudioContext al mismo rate se reproduce igual.
        decodeDetached: typeof OfflineAudioContext === 'function'
            ? (bytes) => new OfflineAudioContext(2, 1, ANALYSIS_SAMPLE_RATE).decodeAudioData(bytes)
            : undefined,
        analyze: (audioBuffer, opts) => localAnalyzer.analyze(audioBuffer, opts),
        // El charter solo hace falta con una canción local (los niveles del
        // catálogo traen su chart hecho): se carga cuando toca, no en el arranque.
        buildChart: async (analysis, opts) => (await import('../game/levels/charter.js')).buildChart(analysis, opts),
        hash: sha256Hex,
    });

    // `onSettings` inyectado para pasar el getter del AudioEngine al modal: el
    // slider de volumen aplica en vivo cuando hay audio sonando.
    menu.mount({
        onSettings: () => openSettingsModal({ getActiveAudioEngine }),
    });

    setState(STATE.MENU);

    onPlayRequest = (ev) => { void handlePlayRequest(ev.detail); };
    onGameState = (ev) => { handleGameState(ev); };
    window.addEventListener(PLAY_REQUEST_EVENT, onPlayRequest);
    window.addEventListener('daino:gamestate', onGameState);

    // Abrir la ficha de un nivel es intención de jugarlo: su audio y su chart
    // se van descargando para que JUGAR arranque sin esperar a la red.
    onPrefetch = (ev) => {
        if (state === STATE.MENU && ev.detail?.level) void loader.prefetchCatalog(ev.detail.level);
    };
    window.addEventListener(PREFETCH_REQUEST_EVENT, onPrefetch);

    // ESC (o el botón de pausa del HUD) durante partida → pausa explícita.
    onPause = () => handlePauseRequested();
    Input.on('pause', onPause);

    // El audio se detuvo sin que nadie pausara (la pestaña se ocultó, el sistema
    // interrumpió el sonido: una llamada, otro audio en un móvil): es una pausa
    // como cualquier otra, con su panel. Sin él, al volver la canción arrancaba
    // sola con el jugador sin las manos puestas; y en un móvil que no reanuda el
    // audio por su cuenta, la partida se quedaba congelada sin nada que tocar.
    onAudioPause = () => { if (state === STATE.PLAYING) handlePauseRequested(); };
    window.addEventListener('audio:pause', onAudioPause);

    // Girar el móvil a vertical en plena partida la pausa: la escena se queda
    // diminuta y los toques caerían donde no toca. El panel sugiere volver a
    // girarlo.
    onViewportChange = () => {
        if (state === STATE.PLAYING && shouldSuggestRotation()) handlePauseRequested();
    };
    window.addEventListener('resize', onViewportChange);

    // Calidad gráfica persistida (Ola 1; T05.2). 'auto' deja que el engine baje
    // solo si mide fotogramas tardíos en la partida, y recuerda lo aprendido.
    // Elegir "Auto" en AJUSTES le hace empezar de cero (`fresh`).
    engineApi.setQualityTier?.(getQuality());
    window.addEventListener('daino:qualitychange', (ev) => {
        engineApi.setQualityTier?.(ev.detail?.quality ?? getQuality(), { fresh: true });
    });

    // Skin del dino: la persistida al dino ambiente del menú, y en vivo al
    // cambiarla en AJUSTES. La GameSession la lee al arrancar cada partida.
    engineApi.setAmbientDinoSkin?.(getSkin());
    window.addEventListener('daino:skinchange', (ev) => {
        engineApi.setAmbientDinoSkin?.(ev.detail?.skinId ?? getSkin());
    });

    // "Efectos visuales" (T03.1): cuánto de los efectos de la música quiere el
    // jugador (y, con los mínimos, sin los relámpagos del escenario), también en vivo.
    engineApi.setFxPref?.(getFxLevel());
    window.addEventListener(FX_LEVEL_EVENT, (ev) => {
        engineApi.setFxPref?.(ev.detail?.level ?? getFxLevel());
    });

    // Direcciones (T06). Incrustado en Vout el historial es el de su página: no se toca.
    router = createRouter({ place: currentPlace, navigate: handleNavigate, passive: isBridgeEmbedded() });
    offCatalogView = onCatalogView(() => router?.sync());
    void openInitialPlace(router.start());
}

export function dispose() {
    if (onPlayRequest) window.removeEventListener(PLAY_REQUEST_EVENT, onPlayRequest);
    if (onGameState) window.removeEventListener('daino:gamestate', onGameState);
    if (onPrefetch) window.removeEventListener(PREFETCH_REQUEST_EVENT, onPrefetch);
    if (onPause) Input.off('pause', onPause);
    if (onAudioPause) window.removeEventListener('audio:pause', onAudioPause);
    cancelResume();
    if (onViewportChange) window.removeEventListener('resize', onViewportChange);
    offCatalogView?.();
    offCatalogView = null;
    router?.dispose();
    router = null;
    onPlayRequest = null;
    onGameState = null;
    onPrefetch = null;
    onPause = null;
    onAudioPause = null;
    onViewportChange = null;
    closeRunPanel();
    run = null;
    if (activeSession) {
        try { activeSession.stop(); } catch { /* ignore */ }
        activeSession = null;
    }
    menu.dispose();
}

export function getState() {
    return state;
}

export function getActiveSession() {
    return activeSession;
}

/**
 * AudioEngine de la partida en curso (o null). El modal Settings lo consume
 * para aplicar volumen en vivo cuando hay audio sonando.
 */
export function getActiveAudioEngine() {
    return lastAudioEngine;
}

// --------------------------- Direcciones (T06) ---------------------------

/**
 * Dónde está la app ahora mismo. La dirección del navegador sale de aquí.
 *
 * @returns {import('./routeModel.js').Place}
 */
function currentPlace() {
    // Saliendo de una partida: ya se está donde se va (el fundido es solo eso).
    if (leavingTo !== null) return { route: leavingTo, playing: false };

    // Cargando manda lo que se carga (puede quedar la partida anterior en `run`).
    let play = null;
    if (state === STATE.LOADING) play = loadingPlay;
    else if (run !== null) play = { id: run.catalogLevelId, title: run.loaded.title ?? null, tab: run.catalogTab };
    if (state !== STATE.MENU && play !== null) {
        return {
            route: play.id !== null ? { name: 'level', id: play.id, title: play.title, tab: play.tab } : MENU,
            playing: true,
        };
    }

    const view = catalogView();
    if (!view.open) return { route: MENU, playing: false };
    if (view.level !== null) return { route: { name: 'level', id: view.level.id, title: view.level.title, tab: view.tab }, playing: false };
    return { route: { name: 'levels', tab: view.tab }, playing: false };
}

/**
 * El navegador ha ido a otra entrada (atrás, adelante). Qué se hace depende de lo
 * que se esté haciendo: en plena partida, "atrás" es una pausa —lo mismo que Esc—
 * y no se sale de ella; el router repone la entrada de la partida al ver que la
 * app sigue ahí.
 *
 * @param {import('./routeModel.js').Place} place
 */
function handleNavigate(place) {
    switch (state) {
        case STATE.PLAYING:
            handlePauseRequested();
            return;
        case STATE.PAUSED:
        case STATE.GAME_OVER:
            return;
        case STATE.RESULTS:
            void leaveTo(place.route.name === 'menu' ? 'menu' : 'levels');
            return;
        case STATE.LOADING:
            cancelLoading();
            break;
        default:
            break;
    }
    showPlace(place);
}

/** Enseña un lugar desde el menú: lo cierra todo, abre el catálogo o la ficha de un nivel. */
function showPlace(place) {
    const { route } = place;
    const view = catalogView();
    if (route.name === 'levels') {
        if (!view.open || view.level !== null || view.tab !== route.tab) openCatalog({ tab: route.tab });
    } else if (route.name === 'level') {
        if (!view.open || view.level?.id !== route.id) openCatalog({ levelId: route.id });
    } else {
        closeAllModals();
    }
}

/** La página se ha abierto en una dirección que no es la del menú: se enseña. */
async function openInitialPlace(place) {
    if (place.route.name === 'menu') return;
    // «Míos» y la ficha de un nivel propio sin publicar dependen de quién mira.
    await Promise.race([clientInit(), new Promise((resolve) => { window.setTimeout(resolve, INITIAL_AUTH_WAIT_MS); })]);
    if (state !== STATE.MENU || catalogView().open) return;   // ya está en otra cosa
    showPlace(place);
}

/** Deja de preparar la partida que se estaba cargando (se fue atrás durante la carga). */
function cancelLoading() {
    playRequestSeq++;
    loadingPlay = null;
    run = null;
    engineApi.setRenderPaused(false);
    hideHint();
    closeAllModals();
    menu.setVisible(true);
    setState(STATE.MENU);
}

// --------------------------- Handlers ---------------------------

/**
 * @param {{ source: 'local', file: File, level?: object | null } | { source: 'catalog', level: object }} request
 *        `local` con `level`: nivel privado propio jugado con su archivo (D11).
 */
async function handlePlayRequest(request) {
    if (request?.source !== 'local' && request?.source !== 'catalog') return;

    // Durante el fundido de fin de partida el menú todavía no está listo:
    // arrancar otra encima dejaría dos transiciones pisándose.
    if (state === STATE.GAME_OVER) return;

    const seq = ++playRequestSeq;
    // Dónde se va a jugar (para la dirección): en la de su nivel, o en la del menú.
    loadingPlay = request.level
        ? { id: request.level.id, title: request.level.title ?? null, tab: catalogTabFor(request.level) }
        : { id: null, title: null, tab: 'public' };

    if (activeSession) {
        activeSession.stop();
        activeSession = null;
        engineApi.detachAudio();
    }
    closeAllModals();

    setState(STATE.LOADING);
    menu.setVisible(false);
    showHintWithText(request.source === 'local' ? 'Leyendo tu canción…' : 'Preparando nivel…');

    let loaded;
    let renderPaused = false;
    const onStage = (stage, progress) => {
        if (seq !== playRequestSeq) return;
        // Si el análisis corre en el hilo principal (sin Web Worker), mientras
        // dura se congela el render para darle toda la CPU y no animar a
        // trompicones. En el Worker (Ola 4) no compite y el fondo sigue vivo.
        const analyzing = stage === LOAD_STAGE.ANALYZING && !localAnalyzer.offThread;
        if (analyzing !== renderPaused) {
            engineApi.setRenderPaused(analyzing);
            renderPaused = analyzing;
        }
        showHintWithText(stageText(stage, progress));
    };

    try {
        loaded = request.source === 'local'
            ? await loader.loadLocal(request.file, {
                onStage,
                seed: readSeedFromUrl() ?? undefined,
                level: request.level ?? undefined,
            })
            : await loader.loadCatalog(request.level, { onStage });
    } catch (err) {
        if (renderPaused) engineApi.setRenderPaused(false);
        if (seq !== playRequestSeq) return;
        if (err instanceof LevelLoadError) {
            // Error esperado y explicado al jugador (otro MP3, nivel retirado):
            // no es un fallo del programa.
            console.warn('[AppController] no se pudo preparar la partida:', err.code, err.message);
        } else {
            console.error('[AppController] no se pudo preparar la partida:', err);
        }
        hideHint();
        menu.setVisible(true);
        setState(STATE.MENU);
        // Si venía del catálogo, se vuelve a él, en la misma pestaña: el jugador
        // reintenta (o elige el archivo correcto) sin buscar el nivel otra vez.
        if (request.level) openCatalog({ tab: request.level.is_mine && request.level.is_public !== true ? 'mine' : undefined });
        // DESPUÉS de abrir el catálogo: la top layer apila por orden de
        // apertura, y un aviso abierto antes quedaría debajo del diálogo.
        showToast(err instanceof LevelLoadError ? err.message : 'No se pudo preparar el nivel. Inténtalo de nuevo.');
        return;
    }
    if (renderPaused) engineApi.setRenderPaused(false);
    if (seq !== playRequestSeq) return;   // llegó otra petición mientras cargaba

    console.info('[daino] nivel listo:', {
        origen: request.source,
        eventos: loaded.chart.events.length,
        bpm: loaded.chart.music.bpm.toFixed(1),
        velocidad: loaded.chart.world.speedPxS.toFixed(0),
        seed: loaded.chart.seed,
        cache: loaded.fromCache,
    });

    // `levelId` para la GameSession solo sirve para GUARDAR PROGRESO, así que
    // únicamente existe con sesión iniciada. Un nivel del catálogo jugado sin
    // sesión se juega igual, pero sin intentar un POST que el servidor
    // rechazaría con 401. Canción local con sesión: se registra (o se recupera,
    // si ya se jugó) para poder guardar el progreso.
    let levelId = loaded.levelId;
    // El nivel tal como lo da la API (su escenario, entre otras cosas): el del
    // catálogo, o el tuyo si la canción local ya era un nivel tuyo.
    let levelMeta = request.level ?? null;
    if (getUser() === null) {
        levelId = null;
    } else if (levelId === null) {
        const saved = await persistLocalLevel(loaded);
        if (seq !== playRequestSeq) return;
        levelId = saved?.id ?? null;
        if (saved !== null) levelMeta = saved.level;
        if (saved !== null && !saved.created) {
            // La canción ya era un nivel tuyo (publicado, listo para publicar con
            // la dificultad elegida…): se juega SU chart y no el recién generado
            // en Automática, o la marca se guardaría en un nivel distinto del que
            // se ha jugado.
            try {
                loaded = await loader.loadLocal(request.file, { onStage, level: saved.level });
            } catch (err) {
                console.warn('[AppController] no se pudo usar el chart de tu nivel; se juega sin guardar progreso:', err);
                levelId = null;
            }
            if (renderPaused) {
                engineApi.setRenderPaused(false);
                renderPaused = false;
            }
            if (seq !== playRequestSeq) return;
        }
    }
    if (seq !== playRequestSeq) return;

    // El escenario del nivel (T02): sus capas se descargan ahora, con el aviso de
    // carga aún en pantalla, y se pone al empezar, bajo el fundido.
    const scene = await engineApi.loadScene(playSceneId(levelMeta));
    if (seq !== playRequestSeq) return;

    // Móvil en vertical: antes de empezar, sugerir girarlo (la canción no
    // arranca hasta que se gira o se elige jugar así).
    if (shouldSuggestRotation()) {
        hideHint();
        const choice = await waitForLandscape();
        if (seq !== playRequestSeq) return;
        if (choice === 'cancel') {
            menu.setVisible(true);
            setState(STATE.MENU);
            if (request.level) openCatalog({ tab: catalogTabFor(request.level), focusLevelId: request.level.id });
            return;
        }
    }

    run = {
        key: loaded.levelId !== null ? `level:${loaded.levelId}` : `audio:${loaded.sha256}`,
        loaded,
        levelId,
        catalogLevelId: loaded.levelId,
        catalogTab: catalogTabFor(request.level),
        best: loaded.levelId !== null ? mergeBest(request.level?.my_best, localBests.get(loaded.levelId)) : null,
        attempt: 0,
        sections: loaded.chart.events.filter((e) => e.type === 'section'),
        scene,
        // La identidad de los efectos de la canción (T03.3): su paleta y su firma,
        // repartidas por el servidor. Una canción local lleva lo de siempre.
        fx: resolveFxIdentity(levelMeta),
    };

    await fadeOverlay({
        totalMs: 600,
        onMidpoint: () => {
            if (seq !== playRequestSeq) return;
            hideHint();
            closeAllModals();
            startAttempt();
        },
    });
}

/** Pestaña del catálogo donde vive un nivel (un nivel propio sin publicar, en «Míos»). */
function catalogTabFor(level) {
    return level?.is_mine === true && level.is_public !== true ? 'mine' : 'public';
}

/**
 * Arranca un intento de la partida vigente (`run`): el primero o un reintento.
 * No carga nada: audio decodificado y chart ya están en `run.loaded`.
 */
function startAttempt() {
    const audioEngine = getAudioEngine();
    lastAudioEngine = audioEngine;
    // Partida nueva: ninguna pausa pendiente (por si se salió en mitad de una).
    cancelResume();
    resumeInGesture = false;
    audioEngine.release('pause');

    // El shader lee el FFT del audio activo; se desconecta al volver al menú.
    engineApi.attachAudio(audioEngine);

    run.attempt = attempts.next(run.key);
    // El escenario del nivel ANTES de crear la sesión: su plan del cielo usa el
    // ciclo de la escena vigente. En un reintento es la misma (no hace nada).
    engineApi.setScene(run.scene);
    engineApi.setFxIdentity?.(run.fx);
    // Empieza un intento: bajo el fundido, la calidad automática puede probar un
    // escalón más si el intento anterior fue limpio (T05.2; nunca a mitad de partida).
    engineApi.beginAttempt?.();
    // La sesión arranca ella misma la reproducción cuando termina de
    // montarse: es la única dueña del reloj de la partida.
    activeSession = new GameSession({
        engine: engineApi,
        audioEngine,
        audioBuffer: run.loaded.audioBuffer,
        chart: run.loaded.chart,
        title: run.loaded.title,
        levelId: run.levelId,
        skinId: getSkin(),
        attempt: run.attempt,
        showControls: countRunAndShouldHint(),
    });
    activeSession.start();
    setState(STATE.PLAYING);
}

/**
 * Registra en el servidor una canción local jugada con sesión iniciada.
 *
 * Idempotente por hash del audio (defecto D1): la misma canción devuelve el
 * mismo nivel en vez de crear otro. Se envían el chart y el análisis para que,
 * si el usuario la publica sin analizador en el servidor, los demás jueguen
 * exactamente este nivel. Un fallo aquí no impide jugar: solo no se guardará el
 * progreso.
 *
 * @returns {Promise<{ id: number, level: object, created: boolean } | null>}
 */
/** Dificultad medida de un chart sin dificultad declarada (charts anteriores a la Ola 5). */
async function measuredDifficulty(chart) {
    const { chartStats, difficultyFromStats } = await import('../game/levels/chartStats.js');
    return difficultyFromStats(chartStats(chart));
}

async function persistLocalLevel(loaded) {
    if (getUser() === null) return null;
    try {
        const res = await apiRequest('POST', '/api/levels', {
            body: {
                title: loaded.title.slice(0, 120),
                audio_sha256: loaded.sha256,
                // Ola 5: la dificultad con la que el charter generó el nivel;
                // medida del chart solo para charts sin ella (anteriores).
                difficulty: loaded.chart.difficulty?.level ?? await measuredDifficulty(loaded.chart),
                generator_seed: String(loaded.chart.seed),
                chart: loaded.chart,
                analysis: loaded.analysis ?? undefined,
            },
        });
        if (res.ok && typeof res.data?.id === 'number') {
            const created = res.status === 201;
            // "Mis niveles" cambió si el nivel es nuevo.
            if (created) invalidateLevels('mine');
            return { id: res.data.id, level: res.data, created };
        }
        console.warn('[AppController] POST /api/levels falló:', res.status, res.data);
    } catch (err) {
        console.warn('[AppController] POST /api/levels error:', err);
    }
    return null;
}

function stageText(stage, progress) {
    const pct = Number.isFinite(progress) ? ` ${Math.round(progress * 100)} %` : '';
    switch (stage) {
        case LOAD_STAGE.READING: return 'Leyendo tu canción…';
        case LOAD_STAGE.DOWNLOADING: return `Descargando nivel…${pct}`;
        case LOAD_STAGE.DECODING: return 'Preparando el audio…';
        case LOAD_STAGE.ANALYZING: return `Analizando la canción…${pct}`;
        case LOAD_STAGE.CHARTING: return 'Colocando obstáculos…';
        default: return 'Cargando…';
    }
}

function handlePauseRequested() {
    if (!lastAudioEngine || activeSession === null || run === null) return;
    // Pausar otra vez durante la cuenta atrás: se cancela y vuelve el panel.
    if (state === STATE.PAUSED) {
        if (cancelResume()) openPausePanel();
        return;
    }
    // Solo aplica durante PLAYING.
    if (state !== STATE.PLAYING) return;

    setState(STATE.PAUSED);

    // Detener el audio congela todo: dispatcha 'audio:pause', la GameSession
    // congela su tick y el reloj de la canción no avanza.
    lastAudioEngine.hold('pause');
    openPausePanel();
}

function openPausePanel() {
    const durationSec = activeSession.lengthSec;
    const reachedSec = Math.min(durationSec, Math.max(0, lastAudioEngine.getSongTime()));
    openRunPanel(runPanelView({
        mode: 'pause',
        percentage: durationSec > 0 ? (reachedSec / durationSec) * 100 : 0,
        points: activeSession._score,
        reachedSec,
        durationSec,
        attempt: run.attempt,
        previousBest: run.best,
        title: run.loaded.title,
        sections: run.sections,
        rotate: isTouchPortrait(),
    }), {
        onAction: handleRunAction,
        volume: { value: getVolume(), onInput: (v) => setVolume(v, lastAudioEngine) },
    });
}

function handleGameState(ev) {
    const detail = ev.detail ?? {};
    const { kind } = detail;
    if (kind !== 'win' && kind !== 'collision' && kind !== 'stopped') return;

    // Guard de re-entry: solo si veníamos de PLAYING o PAUSED. Toda salida
    // voluntaria (reintentar, niveles, menú) cambia de estado ANTES de parar la
    // sesión, así que su `_end('stopped')` se ignora aquí.
    if (state !== STATE.PLAYING && state !== STATE.PAUSED) return;
    if (kind === 'stopped' || run === null) {
        void leaveTo('menu');
        return;
    }

    // La marca antes de esta partida (para "¡Nuevo récord!") y la nueva. Anónimo
    // o no, la del catálogo se recuerda en el navegador para su tarjeta.
    const points = detail.score ?? 0;
    const percentage = detail.percentage ?? 0;
    const previous = run.best;
    if (run.catalogLevelId !== null) localBests.record(run.catalogLevelId, { points, percentage });
    run.best = mergeBest(previous, { points, percentage });

    // Salir desde la pausa con el nivel ya superado: se cerró como victoria y
    // ahora se va adonde se pidió.
    if (pendingExit !== null) {
        const destination = pendingExit;
        pendingExit = null;
        void leaveTo(destination);
        return;
    }

    if (kind === 'collision' && getAutoRetry()) {
        void retry();
        return;
    }

    setState(STATE.RESULTS);
    openRunPanel(runPanelView({
        mode: 'results',
        kind,
        percentage,
        points,
        reachedSec: detail.reachedSec ?? 0,
        durationSec: detail.durationSec ?? 0,
        attempt: run.attempt,
        previousBest: previous,
        title: run.loaded.title,
        sections: run.sections,
        // En desarrollo, la precisión de la partida: con ella se calibra la dificultad.
        timing: import.meta.env.DEV ? (detail.timing ?? null) : null,
        // El rendimiento del intento (T05.4): en desarrollo, o con `?perf=1` (para
        // quien prueba en un móvil y dice qué le sale).
        perf: perfWanted(window.location.search, import.meta.env.DEV) ? (detail.perf ?? null) : null,
    }), {
        onAction: handleRunAction,
        autoRetry: { checked: getAutoRetry(), onChange: setAutoRetry },
    });
}

/** @param {string} action  RUN_ACTION */
function handleRunAction(action) {
    switch (action) {
        case RUN_ACTION.RESUME:
            if (state !== STATE.PAUSED) return;
            if (resumeInGesture) {
                // El navegador no dejó reanudar el audio fuera de un gesto: se
                // reanuda aquí mismo, dentro del toque, sin cuenta atrás.
                resumeInGesture = false;
                setState(STATE.PLAYING);
                lastAudioEngine?.release('pause');
                watchResume();
                return;
            }
            resumeAfterCountdown();
            return;
        case RUN_ACTION.RETRY: void retry(); return;
        case RUN_ACTION.LEVELS: void leaveTo('levels'); return;
        case RUN_ACTION.MENU: void leaveTo('menu'); return;
        default: return;
    }
}

/**
 * Reanudar con cuenta atrás: 3, 2, 1 y la canción sigue. Reanudar de golpe era
 * volver a un obstáculo ya encima con las manos todavía en el ratón (o el dedo
 * en el botón, en un móvil); la cuenta da tiempo a colocarse y a recordar el
 * pulso. Pausar durante la cuenta la cancela (`handlePauseRequested`).
 */
function resumeAfterCountdown() {
    cancelResume();
    let left = RESUME_COUNTDOWN.from;
    const step = () => {
        resumeTimer = 0;
        if (state !== STATE.PAUSED || activeSession === null) return;
        if (left === 0) {
            activeSession.hud?.setCountdown?.('');
            setState(STATE.PLAYING);
            lastAudioEngine?.release('pause');
            watchResume();
            return;
        }
        activeSession.hud?.setCountdown?.(String(left));
        left--;
        resumeTimer = window.setTimeout(step, RESUME_COUNTDOWN.stepMs);
    };
    step();
}

/**
 * Tras reanudar, comprueba que el audio ha vuelto de verdad. Algún navegador
 * móvil solo deja reanudarlo dentro de un gesto (y la cuenta atrás termina en un
 * temporizador): si medio segundo después sigue detenido, vuelve el panel y el
 * siguiente "Reanudar" lo hace dentro del toque. Sin esto la partida se
 * quedaría congelada sin nada que pulsar.
 */
function watchResume() {
    const engine = lastAudioEngine;
    window.setTimeout(() => {
        if (state !== STATE.PLAYING || engine !== lastAudioEngine || activeSession === null) return;
        if (document.hidden || engine?.ctx == null || engine.ctx.state === 'running') return;
        resumeInGesture = true;
        handlePauseRequested();
    }, RESUME_COUNTDOWN.watchMs);
}

/** @returns {boolean} true si había una cuenta atrás en marcha. */
function cancelResume() {
    if (resumeTimer === 0) return false;
    window.clearTimeout(resumeTimer);
    resumeTimer = 0;
    activeSession?.hud?.setCountdown?.('');
    return true;
}

/**
 * Otro intento del mismo nivel, sin cargar nada. Desde resultados, desde la
 * pausa (no guarda progreso, como salir) o al chocar con el reintento
 * automático activado.
 */
async function retry() {
    if (run === null || activeSession === null) return;
    if (state !== STATE.RESULTS && state !== STATE.PAUSED && state !== STATE.PLAYING) return;

    // GAME_OVER antes de parar: el `_end('stopped')` de la sesión se ignora.
    setState(STATE.GAME_OVER);
    closeRunPanel();
    await fadeOverlay({
        totalMs: 360,
        onMidpoint: () => {
            // Desde la pausa el audio está detenido: se suelta la pausa (sigue
            // detenido si además la pestaña está oculta).
            lastAudioEngine?.release('pause');
            if (activeSession) {
                try { activeSession.stop(); } catch { /* ya parado */ }
                activeSession = null;
            }
            if (run !== null) startAttempt();
        },
    });
}

/**
 * Deja la partida: al menú o al catálogo con el nivel jugado a la vista.
 * @param {'menu' | 'levels'} destination
 */
async function leaveTo(destination) {
    // Ola 5: si ya no quedaba ningún obstáculo ("¡Superado!") y solo faltaba
    // que la canción terminase, salir no pierde el nivel: se cierra como
    // victoria (handleGameState guarda la marca y vuelve aquí).
    if (state === STATE.PAUSED && pendingExit === null && activeSession?.cleared) {
        pendingExit = destination;
        if (activeSession.finishCleared()) return;
        pendingExit = null;
    }

    const catalogOpts = run !== null && run.catalogLevelId !== null
        ? { tab: run.catalogTab, focusLevelId: run.catalogLevelId }
        : { tab: run?.catalogTab };

    // La dirección pasa ya a la del destino: el fundido no es un sitio.
    leavingTo = destination === 'levels' ? { name: 'levels', tab: catalogOpts.tab ?? 'public' } : MENU;
    setState(STATE.GAME_OVER);
    closeRunPanel();
    await transitionToMenu(() => {
        // Bajo el negro del fundido: el catálogo aparece ya abierto al aclarar.
        if (destination === 'levels') openCatalog(catalogOpts);
    });
}

/** @param {() => void} [onMenu]  Se llama ya en MENU, antes de aclarar el fundido. */
async function transitionToMenu(onMenu) {
    await fadeOverlay({
        totalMs: 600,
        onMidpoint: () => {
            // Si venimos de la pausa el audio está detenido; sin soltarla el
            // ticker del engine seguiría congelado en el menú.
            lastAudioEngine?.release('pause');

            if (activeSession) {
                try { activeSession.stop(); } catch { /* ya parado */ }
                activeSession = null;
            }

            // Shader a modo idle y el mundo al paso del menú.
            engineApi.detachAudio();
            engineApi.setWorldSpeed?.(SCENERY.menuSpeed);
            lastAudioEngine = null;
            run = null;
            leavingTo = null;

            closeAllModals();
            menu.setVisible(true);

            // setState dentro del negro del fundido: el chip de auth arranca
            // su transición oculto y no hace "pop" al aparecer.
            setState(STATE.MENU);
            onMenu?.();
        },
    });
}

// --------------------------- Helpers ---------------------------

function setState(next) {
    state = next;
    // `<body data-app-state>` permite al CSS mostrar/ocultar UI por modo. También
    // en <html>: los gestos del navegador (tirar para recargar) se permiten o no
    // según el estado, y eso se decide en el elemento raíz (base.css).
    document.body.dataset.appState = next;
    document.documentElement.dataset.appState = next;

    // Fuera del menú, el chip de sesión no solo se ve transparente: no recibe
    // clics ni foco (una capa invisible encima del juego no debe hacer nada).
    const authAnchor = document.getElementById('auth-anchor');
    if (authAnchor !== null) authAnchor.inert = next !== STATE.MENU;

    // El dino ambiente del scenery solo corre en el menú.
    engineApi?.setAmbientDinoVisible?.(next === STATE.MENU);
    // En el menú, la escena de siempre (T02) con el cielo de su menú (T01): la
    // partida ya no empuja su hora. Se llega aquí bajo el fundido a negro: no se
    // ve el salto.
    if (next === STATE.MENU) {
        engineApi?.setScene?.(DEFAULT_SCENE);
        engineApi?.setFxIdentity?.(null);
        engineApi?.setSkyHour?.(null);
    }

    // Presupuesto de render del estado (Ola 1). Las claves de STATE y de
    // RENDER_PROFILES coinciden a propósito.
    engineApi?.setRenderProfile?.(next);

    // La dirección del navegador, al día con el estado nuevo (T06).
    router?.sync();
}

// El aviso de "preparando nivel" (el Dino que trota y la fase) vive en ui/loader.js.
function showHintWithText(text) {
    showLoader(text);
}

function hideHint() {
    hideLoader();
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => dispose());
}
