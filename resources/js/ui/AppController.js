// AppController — máquina de estados de la UI.
//
// Centraliza el ciclo "menú ↔ partida" para que main.js sea solo un entry
// point. Estados:
//
//   MENU       Estado base. Menú visible, HUD oculto. Drop o JUGAR → LOADING.
//   LOADING    Análisis offline del MP3 (LevelGenerator). Hint visible con
//              progreso. Cuando resuelve → fadeToBlack → PLAYING.
//   PLAYING    Partida en curso. Menú oculto, HUD visible.
//   PAUSED     Pausa explícita (Lote E). PLAYING ↔ PAUSED.
//   GAME_OVER  Efímero — entra y sale solo a MENU (con toast del score).
//
// Eventos consumidos:
//   - 'audio:ready'      MP3 listo a reproducir → LOADING.
//   - 'daino:gamestate'  GameSession terminó (win/collision/stopped) → MENU.
//
// El AppController es el único dueño de `activeSession` (ya no main.js).

import { generate } from '../game/levels/LevelGenerator.js';
import { readSeedFromUrl } from '../game/levels/Seed.js';
import { GameSession } from '../game/GameSession.js';
import * as menu from './menu.js';
import { fadeOverlay } from './transitions.js';
import { closeAllModals, openSettingsModal, openPauseModal } from './modals.js';
import { Input } from '../game/systems/input.js';
import { getUser, request as apiRequest } from '../api/client.js';
import { getSkin } from './settings.js';

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
let lastAudioEngine = null;   // último AudioEngine visto vía audio:ready (Settings lo usa)
let onAudioReady = null;
let onGameState = null;
let onPause = null;

/**
 * @param {{ engine: any }} cfg
 */
export function start(cfg) {
    engineApi = cfg.engine;

    // Mount inicial del menú. Visible al boot — sin sesión, esperando un MP3.
    // Sin pasar `onPlay`: el menú usa su fallback (pickFileViaInput de upload.js),
    // que dispara `audio:ready` igual que el drag&drop. handleAudioReady toma
    // el control desde ahí; el ciclo es agnóstico al origen del archivo.
    //
    // `onSettings` SÍ lo inyectamos para pasar el getter del AudioEngine al
    // modal — así el slider de volumen aplica live cuando hay audio sonando.
    menu.mount({
        onSettings: () => openSettingsModal({ getActiveAudioEngine }),
    });

    // Inicializar atributo desde el primer paint (sin esto el CSS no tiene
    // forma de saber el estado base).
    setState(STATE.MENU);

    onAudioReady = (ev) => { void handleAudioReady(ev); };
    onGameState = (ev) => { handleGameState(ev); };
    window.addEventListener('audio:ready', onAudioReady);
    window.addEventListener('daino:gamestate', onGameState);

    // ESC durante partida → pausa explícita. Input.setup() ya se llama en
    // GameSession.start; Input.on persiste mientras el handler exista, así
    // que registrar aquí basta — emit solo dispara cuando hay listeners.
    onPause = () => handlePauseRequested();
    Input.on('pause', onPause);

    // Skin del dino: aplicar la persistida al dino ambiente del menú y
    // reaccionar en vivo cuando el user la cambie en AJUSTES (settings.js
    // dispatcha 'daino:skinchange'). La GameSession la lee al arrancar cada
    // partida — no hay que tocar una partida en curso.
    engineApi.setAmbientDinoSkin?.(getSkin());
    window.addEventListener('daino:skinchange', (ev) => {
        engineApi.setAmbientDinoSkin?.(ev.detail?.skinId ?? getSkin());
    });
}

export function dispose() {
    if (onAudioReady) window.removeEventListener('audio:ready', onAudioReady);
    if (onGameState) window.removeEventListener('daino:gamestate', onGameState);
    if (onPause) Input.off('pause', onPause);
    onAudioReady = null;
    onGameState = null;
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
 * Devuelve el AudioEngine de la última partida (o null). El modal Settings
 * lo consume para aplicar volumen en vivo cuando hay audio sonando.
 */
export function getActiveAudioEngine() {
    return lastAudioEngine;
}

// --------------------------- Handlers ---------------------------

async function handleAudioReady(ev) {
    const { audioBuffer, audioEngine, name } = ev.detail ?? {};
    if (!audioBuffer || !audioEngine) {
        console.warn('[AppController] audio:ready sin audioBuffer/audioEngine');
        return;
    }
    lastAudioEngine = audioEngine;

    // Si había sesión activa, despedirla limpio (el user soltó otro MP3
    // mientras jugaba o desde el menú estado intermedio).
    if (activeSession) {
        activeSession.stop();
        activeSession = null;
    }

    // Cualquier modal abierto se cierra al arrancar partida — la pausa real
    // se modela con estado PAUSED (Lote E), no con modales fortuitos.
    closeAllModals();

    // 1. Parar la canción que upload.js arrancó automáticamente — la
    //    queremos sincronizada desde 0 con el primer tick de la GameSession.
    if (audioEngine.source) {
        try { audioEngine.source.stop(); } catch { /* idempotente */ }
    }

    setState(STATE.LOADING);
    // Ocultamos el menú ya en LOADING — durante la generación el user solo
    // debe ver el hint sobre el shader, sin chrome del menú compitiendo.
    menu.setVisible(false);
    showHintWithText('Generando nivel…');

    // Congelar el render loop de Pixi durante el análisis: el LevelGenerator
    // corre en el main thread y compartir CPU con el shader/scenery a 60fps
    // ralentizaba la generación Y hacía que las animaciones fueran a
    // trompicones. Canvas quieto (el hint DOM sigue vivo) + análisis a tope.
    engineApi.setRenderPaused(true);

    let level;
    try {
        const seed = readSeedFromUrl();
        level = await generate(audioBuffer, {
            seed: seed ?? undefined,
            sourceName: name ?? 'unknown.mp3',
            onProgress: (msg) => {
                if (typeof msg === 'string') showHintWithText(msg);
                // si es número (ratio), ignoramos en este handler — el progreso
                // por hop del SpectralFlux es demasiado granular para mostrarlo.
            },
        });
    } catch (err) {
        engineApi.setRenderPaused(false);
        console.error('[AppController] generate() falló:', err);
        showHintWithText('Error generando nivel — vuelve a soltar el MP3');
        setTimeout(() => hideHint(), 4000);
        menu.setVisible(true);    // restauramos menú tras error
        setState(STATE.MENU);
        return;
    }

    engineApi.setRenderPaused(false);

    console.info('[daino] level ready:', {
        bpm: level.bpm.toFixed(1),
        gameSpeed: level.gameSpeed.toFixed(0),
        seed: level.seed,
        confidence: level.stats.confidence.toFixed(2),
        onsetsKept: level.stats.onsetsKept,
        durationSec: level.durationSec.toFixed(1),
    });

    // Bloque 7: si hay sesión, crear Level row server-side antes de jugar
    // para que GameSession pueda persistir progreso al final. Anónimo: levelId
    // queda null y GameSession no llama POST /api/progress. Hacemos esto
    // ANTES del fadeOverlay para que la latencia (10-50ms) no se note —
    // se solapa con el final del análisis offline. Si la creación falla,
    // logueamos y seguimos en modo "anónimo de facto" — la UX no debe
    // bloquearse por un fallo de persistencia.
    let levelId = null;
    if (getUser() !== null) {
        try {
            const res = await apiRequest('POST', '/api/levels', {
                body: {
                    title: level.sourceName ?? 'Untitled',
                    duration_sec: Math.max(1, Math.round(level.durationSec)),
                    bpm: Math.max(30, Math.min(300, Math.round(level.bpm))),
                    difficulty: 3,
                    generator_seed: String(level.seed),
                },
            });
            if (res.ok && typeof res.data?.id === 'number') {
                levelId = res.data.id;
            } else {
                console.warn('[AppController] POST /api/levels falló:', res.status, res.data);
            }
        } catch (err) {
            console.warn('[AppController] POST /api/levels error:', err);
        }
    }

    // 2. fadeToBlack 600ms total — durante el black mountamos la sesión
    //    y arrancamos el audio desde 0. El user no ve el "flash" del cambio.
    //    El menú ya está oculto desde LOADING; aquí solo escondemos el hint
    //    y arrancamos la partida.
    await fadeOverlay({
        totalMs: 600,
        onMidpoint: () => {
            hideHint();

            // Defensa: si el user abrió un modal (chip de auth) durante el
            // análisis, lo cerramos antes de mostrar el juego. Aunque el
            // chip ya está oculto fuera de MENU, esta belt-and-suspenders
            // cubre cualquier path futuro que abra modal en LOADING.
            closeAllModals();

            // El shader necesita estar atachado al audio activo para
            // reaccionar al FFT/RMS. El detach se hace al salir a MENU.
            engineApi.attachAudio(audioEngine);

            audioEngine.play(audioBuffer);

            activeSession = new GameSession({
                engine: engineApi,
                audioEngine,
                level,
                levelId,
                skinId: getSkin(),
                // onGameOver se queda como fallback — la transición real la
                // dispara `daino:gamestate` que escuchamos arriba.
                onGameOver: () => {},
            });
            activeSession.start();
            setState(STATE.PLAYING);
        },
    });
}

function handlePauseRequested() {
    // Solo aplica durante PLAYING. En MENU/LOADING/PAUSED ignoramos.
    if (state !== STATE.PLAYING) return;
    if (!lastAudioEngine) return;

    setState(STATE.PAUSED);

    // Suspend del AudioContext congela todo automáticamente: dispatcha
    // 'audio:pause' por su statechange handler (AudioEngine.js Bloque 4),
    // GameSession lo escucha y congela su tick interno. El reloj de la
    // canción no avanza, así que al resumir todo retoma sincronizado.
    void lastAudioEngine.ctx?.suspend?.();

    openPauseModal({
        onResume: () => {
            // Solo resumimos si seguimos en PAUSED — si el user salió al
            // menú entre medias, no queremos arrancar audio sobre menú.
            if (state !== STATE.PAUSED) return;
            void lastAudioEngine.ctx?.resume?.();
            setState(STATE.PLAYING);
        },
        onExit: () => {
            // Marcamos GAME_OVER ANTES de llamar transitionToMenu. Sin esto,
            // el activeSession.stop() del midpoint dispara `_end('stopped')`
            // → daino:gamestate → handleGameState → segunda transitionToMenu
            // encima del primero. "Doble carga" visible al user. El guard de
            // handleGameState ahora chequea state y evita el re-entry.
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
    const { kind, score } = ev.detail ?? {};
    if (kind !== 'win' && kind !== 'collision' && kind !== 'stopped') return;

    // Guard de re-entry: solo procesamos si veníamos de PLAYING o PAUSED.
    // Si ya estamos en GAME_OVER o MENU, otro path (ej. handlePauseRequested
    // .onExit) ya inició la transición y este evento es un eco del stop()
    // que ese path disparó internamente. Sin este guard se solapaban dos
    // fadeOverlay y se veía como "carga doble" del menú.
    if (state !== STATE.PLAYING && state !== STATE.PAUSED) return;

    setState(STATE.GAME_OVER);
    void transitionToMenu(score, kind);
}

async function transitionToMenu(score, kind) {
    await fadeOverlay({
        totalMs: 600,
        onMidpoint: () => {
            // Si venimos del modal de pausa, el AudioContext está suspended
            // y nadie lo va a resumir — eso deja el ticker del engine
            // pausado (audio:pause sigue activo) y el shader congelado en
            // su último frame. Resume aquí, durante el black total del fade.
            if (lastAudioEngine?.ctx?.state === 'suspended') {
                void lastAudioEngine.ctx.resume();
            }

            if (activeSession) {
                try { activeSession.stop(); } catch { /* ya parado */ }
                activeSession = null;
            }

            // Detach del audio: el shader pasa a modo idle (setMode('idle')
            // dentro de detachAudio limpia uShaderMode + buffers band).
            engineApi.detachAudio();
            lastAudioEngine = null;

            closeAllModals();
            menu.setVisible(true);

            // setState aquí (no después del await): así body[data-app-state]
            // pasa a "MENU" durante el black del fade. El chip de auth
            // arranca su transición CSS de opacity desde dentro del black —
            // cuando el fade-out se completa el chip ya está al 100%, sin
            // pop visual ("parpadeo" reportado en Bloque 6 Lote E).
            setState(STATE.MENU);
        },
    });

    // Toast con el score. Reusamos el patrón de upload.js (clase .daino-toast).
    const toast = document.createElement('div');
    toast.className = 'daino-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = kind === 'win'
        ? `Nivel completado — Score ${score}`
        : `Score ${score} — pulsa cualquier MP3 para reintentar`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// --------------------------- Helpers ---------------------------

function setState(next) {
    state = next;
    // Refleja el estado en `<body data-app-state>` para que el CSS pueda
    // mostrar/ocultar UI según el modo (chip de auth visible solo en MENU,
    // por ejemplo).
    document.body.dataset.appState = next;

    // El dino ambiente del scenery solo corre en el menú — durante la
    // partida el Dino real de la GameSession ocupa el mismo sitio.
    engineApi?.setAmbientDinoVisible?.(next === STATE.MENU);
}

function showHintWithText(text) {
    const hint = document.getElementById('hint');
    if (!hint) return;
    hint.textContent = text;
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
