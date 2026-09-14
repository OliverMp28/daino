// AppController — máquina de estados de la UI.
//
// Centraliza el ciclo "menú ↔ partida" para que main.js sea solo un entry
// point. Estados:
//
//   MENU       Estado base. Menú visible, HUD oculto.
//   LOADING    Preparando la partida: audio (caché o red), chart (caché, red o
//              generado aquí). Hint visible con la fase y su progreso real.
//   PLAYING    Partida en curso. Menú oculto, HUD visible.
//   PAUSED     Pausa explícita. PLAYING ↔ PAUSED.
//   GAME_OVER  Efímero — entra y sale solo a MENU (con toast del score).
//
// Eventos consumidos:
//   - 'daino:play-request'  Alguien pidió jugar (ui/playRequests.js) → LOADING.
//   - 'daino:prefetch-request'  Se abrió la ficha de un nivel: precarga (Ola 2).
//   - 'daino:gamestate'     GameSession terminó (win/collision/stopped) → MENU.
//
// Ola 3: la preparación de la partida la hace `levelLoader`, que decide qué
// sale de la caché, qué se descarga y qué se analiza. Aquí solo se traduce eso
// a estados y mensajes, y se decide qué persistir en el servidor.
//
// El AppController es el único dueño de `activeSession`.

import { readSeedFromUrl } from '../game/levels/Seed.js';
import { createLevelLoader, LevelLoadError, LOAD_STAGE } from '../game/levels/levelLoader.js';
import { analyzeAudio } from '../game/levels/analyze.js';
import { createWorkerAnalyzer, spawnAnalysisWorker } from '../game/levels/analysisClient.js';
import { buildChart } from '../game/levels/charter.js';
import { chartStats, difficultyFromStats } from '../game/levels/chartStats.js';
import { GameSession } from '../game/GameSession.js';
import { getAudioEngine } from '../game/audio/sharedEngine.js';
import { ANALYSIS_SAMPLE_RATE } from '../game/audio/AudioEngine.js';
import { createLevelCache } from '../storage/levelCache.js';
import { sha256Hex } from '../storage/hash.js';
import { createLocalBests } from '../storage/localBests.js';
import * as menu from './menu.js';
import { fadeOverlay } from './transitions.js';
import { closeAllModals, openSettingsModal, openPauseModal } from './modals.js';
import { openCatalog } from './catalog.js';
import { PLAY_REQUEST_EVENT, PREFETCH_REQUEST_EVENT } from './playRequests.js';
import { showToast } from './toast.js';
import { Input } from '../game/systems/input.js';
import { fetchBinary, getUser, request as apiRequest } from '../api/client.js';
import { invalidateLevels } from '../api/levelsCache.js';
import { getSkin, getQuality } from './settings.js';

const STATE = Object.freeze({
    MENU: 'MENU',
    LOADING: 'LOADING',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    GAME_OVER: 'GAME_OVER',
});

let state = STATE.MENU;
let engineApi = null;
let activeSession = null;
let lastAudioEngine = null;   // AudioEngine de la partida en curso (Settings lo usa)
let onPlayRequest = null;
let onGameState = null;
let onPause = null;
let loader = null;
let onPrefetch = null;
const localBests = createLocalBests();

/**
 * Id del nivel del catálogo que se está jugando (null en una canción local sin
 * guardar). Al terminar, la marca se recuerda en el navegador para enseñarla en
 * la tarjeta aunque no haya sesión (Ola 2).
 */
let playingLevelId = null;

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
    analyzeInline: (audioBuffer, opts) => analyzeAudio(audioBuffer, opts),
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
        buildChart,
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

    // ESC durante partida → pausa explícita.
    onPause = () => handlePauseRequested();
    Input.on('pause', onPause);

    // Calidad gráfica persistida (Ola 1). 'auto' deja que el engine degrade
    // solo si mide frames lentos sostenidos durante la partida.
    engineApi.setQualityTier?.(getQuality());
    window.addEventListener('daino:qualitychange', (ev) => {
        engineApi.setQualityTier?.(ev.detail?.quality ?? getQuality());
    });

    // Skin del dino: la persistida al dino ambiente del menú, y en vivo al
    // cambiarla en AJUSTES. La GameSession la lee al arrancar cada partida.
    engineApi.setAmbientDinoSkin?.(getSkin());
    window.addEventListener('daino:skinchange', (ev) => {
        engineApi.setAmbientDinoSkin?.(ev.detail?.skinId ?? getSkin());
    });
}

export function dispose() {
    if (onPlayRequest) window.removeEventListener(PLAY_REQUEST_EVENT, onPlayRequest);
    if (onGameState) window.removeEventListener('daino:gamestate', onGameState);
    if (onPrefetch) window.removeEventListener(PREFETCH_REQUEST_EVENT, onPrefetch);
    if (onPause) Input.off('pause', onPause);
    onPlayRequest = null;
    onGameState = null;
    onPrefetch = null;
    onPause = null;
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
    if (getUser() === null) {
        levelId = null;
    } else if (levelId === null) {
        const saved = await persistLocalLevel(loaded);
        if (seq !== playRequestSeq) return;
        levelId = saved?.id ?? null;
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

    const audioEngine = getAudioEngine();
    lastAudioEngine = audioEngine;

    await fadeOverlay({
        totalMs: 600,
        onMidpoint: () => {
            if (seq !== playRequestSeq) return;
            hideHint();
            closeAllModals();

            // El shader lee el FFT del audio activo; se desconecta al volver al menú.
            engineApi.attachAudio(audioEngine);

            // La sesión arranca ella misma la reproducción cuando termina de
            // montarse: es la única dueña del reloj de la partida.
            activeSession = new GameSession({
                engine: engineApi,
                audioEngine,
                audioBuffer: loaded.audioBuffer,
                chart: loaded.chart,
                title: loaded.title,
                levelId,
                skinId: getSkin(),
            });
            activeSession.start();
            playingLevelId = loaded.levelId;
            setState(STATE.PLAYING);
        },
    });
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
async function persistLocalLevel(loaded) {
    if (getUser() === null) return null;
    try {
        const res = await apiRequest('POST', '/api/levels', {
            body: {
                title: loaded.title.slice(0, 120),
                audio_sha256: loaded.sha256,
                // Ola 5: la dificultad con la que el charter generó el nivel;
                // medida del chart solo para charts sin ella (anteriores).
                difficulty: loaded.chart.difficulty?.level ?? difficultyFromStats(chartStats(loaded.chart)),
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
    // Solo aplica durante PLAYING.
    if (state !== STATE.PLAYING) return;
    if (!lastAudioEngine) return;

    setState(STATE.PAUSED);

    // Suspend del AudioContext congela todo: dispatcha 'audio:pause', la
    // GameSession congela su tick y el reloj de la canción no avanza.
    void lastAudioEngine.ctx?.suspend?.();

    openPauseModal({
        onResume: () => {
            if (state !== STATE.PAUSED) return;
            void lastAudioEngine.ctx?.resume?.();
            setState(STATE.PLAYING);
        },
        onExit: () => {
            // Ola 5: si ya no quedaba ningún obstáculo ("¡Superado!") y solo
            // faltaba que la canción terminase, salir no pierde el nivel: se da
            // por ganado. `finishCleared` emite daino:gamestate (win) y
            // handleGameState hace la transición como en cualquier victoria.
            if (state === STATE.PAUSED && activeSession?.finishCleared?.()) return;

            // GAME_OVER ANTES de transitionToMenu: el stop() del midpoint
            // dispara `_end('stopped')` → daino:gamestate, y el guard de
            // handleGameState lo ignora en vez de lanzar otra transición.
            setState(STATE.GAME_OVER);
            const score = activeSession?._score ?? 0;
            try {
                if (lastAudioEngine?.source) lastAudioEngine.source.stop();
            } catch { /* idempotente */ }
            void transitionToMenu(score, 'stopped');
        },
    });
}

function handleGameState(ev) {
    const { kind, score, percentage } = ev.detail ?? {};
    if (kind !== 'win' && kind !== 'collision' && kind !== 'stopped') return;

    // Guard de re-entry: solo si veníamos de PLAYING o PAUSED.
    if (state !== STATE.PLAYING && state !== STATE.PAUSED) return;

    // 'stopped' (salir desde la pausa) no es un intento real, igual que en el
    // servidor. Anónimo o no, la marca se recuerda para la tarjeta del nivel.
    if (playingLevelId !== null && kind !== 'stopped') {
        localBests.record(playingLevelId, { points: score ?? 0, percentage: percentage ?? 0 });
    }

    setState(STATE.GAME_OVER);
    void transitionToMenu(score, kind);
}

async function transitionToMenu(score, kind) {
    await fadeOverlay({
        totalMs: 600,
        onMidpoint: () => {
            // Si venimos de la pausa el AudioContext está suspendido; sin
            // resume el ticker del engine seguiría congelado en el menú.
            if (lastAudioEngine?.ctx?.state === 'suspended') {
                void lastAudioEngine.ctx.resume();
            }

            if (activeSession) {
                try { activeSession.stop(); } catch { /* ya parado */ }
                activeSession = null;
            }

            // Shader a modo idle.
            engineApi.detachAudio();
            lastAudioEngine = null;
            playingLevelId = null;

            closeAllModals();
            menu.setVisible(true);

            // setState dentro del negro del fundido: el chip de auth arranca
            // su transición oculto y no hace "pop" al aparecer.
            setState(STATE.MENU);
        },
    });

    if (kind === 'win') {
        showToast(`¡Nivel completado! Puntuación ${score}`, 'info');
    } else if (kind === 'collision') {
        showToast(`Puntuación ${score} — pulsa JUGAR para intentarlo otra vez`, 'info');
    }
}

// --------------------------- Helpers ---------------------------

function setState(next) {
    state = next;
    // `<body data-app-state>` permite al CSS mostrar/ocultar UI por modo.
    document.body.dataset.appState = next;

    // Fuera del menú, el chip de sesión no solo se ve transparente: no recibe
    // clics ni foco (una capa invisible encima del juego no debe hacer nada).
    const authAnchor = document.getElementById('auth-anchor');
    if (authAnchor !== null) authAnchor.inert = next !== STATE.MENU;

    // El dino ambiente del scenery solo corre en el menú.
    engineApi?.setAmbientDinoVisible?.(next === STATE.MENU);

    // Presupuesto de render del estado (Ola 1). Las claves de STATE y de
    // RENDER_PROFILES coinciden a propósito.
    engineApi?.setRenderProfile?.(next);
}

function showHintWithText(text) {
    const hint = document.getElementById('hint');
    if (!hint) return;
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.remove('is-hidden');
}

function hideHint() {
    const hint = document.getElementById('hint');
    if (!hint) return;
    hint.classList.add('is-hidden');
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => dispose());
}
