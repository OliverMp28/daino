// HUD durante partida — DOM puro con Tailwind/CSS. Reemplaza al
// game/systems/Hud.js (BitmapText) del Bloque 5.
//
// Doc 06 §4.2 + §8: HUD `fixed` con `pointer-events: none`. Lo que dice el juego
// (puntos, tiempo, rótulos) va en su letra de celdas con sombra dura (T04, doc 12:
// pixel/text.js); el título de la canción, en la letra del sistema.
//
// API:
//   createHud()                       → { update, setBanner, dispose, … }
//   update(score, currentSec, total)  Llamado cada frame por GameSession.
//   setBanner(text)                   Rótulo bajo la barra ("¡Superado!", "Intento 3").
//   setCaption(text)                  Rótulo de una historia de autor (T02.6), '' para ocultar.
//   setRoadmap / setGear / bumpGear   Mapa de la canción y marchas de velocidad.
//   setControls(visible)              Cómo se juega, en las primeras partidas.
//   dispose()                         Quita el HUD del DOM.
//
// Reintentos y tamaños de pantalla (Sep 2026):
//   - Botón de pausa arriba a la derecha. En un móvil era la ÚNICA forma de
//     pausar o salir de una partida (Esc no existe en táctil). Emite el mismo
//     canal 'pause' que la tecla Esc.
//   - El mensaje grande de GAME OVER/WIN desaparece: lo sustituye el panel de
//     resultados (ui/runPanel.js), que además deja reintentar.
//   - Controles visibles al empezar las primeras partidas: en táctil las dos
//     mitades de la pantalla son invisibles y nadie adivina que la derecha agacha.

import { Input } from '../game/systems/input.js';
import { keycap } from './kit.js';
import { pixelText, setPixelText } from './pixel/text.js';

let rootEl = null;
let scoreEl = null;
let timerEl = null;
let progressBarEl = null;
let progressFgEl = null;
let roadEl = null;
let gearEl = null;
let modeEl = null;
let modeLabelEl = null;
let modeHintEl = null;
let chevEls = [];
let bannerEl = null;
let countEl = null;
let captionEl = null;
let controlsEl = null;
let songEl = null;
let lastPhase = '';
let lastScore = -1;
let lastScoreAt = -Infinity;
let lastTimeKey = '';
let lastRatio = -1;
let lastGearKey = '';
let lastModeKey = '';

/**
 * Cada cuánto se reescribe el marcador como mucho (s). Sube unos 100 puntos por
 * segundo: a 60 Hz cambiaba en cada fotograma, y cada cambio repinta el texto
 * con su sombra difuminada. A 20 Hz sigue corriendo igual a la vista (T02.6).
 */
const SCORE_MIN_INTERVAL_S = 0.05;
/** Paso de la barra de progreso: 0.1 % (menos de un píxel en cualquier pantalla). */
const PROGRESS_STEP = 1000;

/** Marchas que caben en el indicador (speedCues.SPEED_CUES.gearThresholds). */
const GEAR_SLOTS = 4;

function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
}

/** Crea el HUD y lo monta en #hud-root. Idempotente. */
export function createHud(_unused) {
    const host = document.getElementById('hud-root');
    if (host === null) {
        throw new Error('createHud: #hud-root no existe en el DOM');
    }
    if (rootEl !== null) {
        // Reusar — esto pasa cuando se reinicia partida sin recargar.
        resetState();
        return api;
    }

    rootEl = document.createElement('div');
    rootEl.className = 'daino-hud';
    rootEl.setAttribute('role', 'group');
    rootEl.setAttribute('aria-label', 'Información de la partida');

    // Top bar: score (izq) — timer+progress (centro) — song (der).
    const topBar = document.createElement('div');
    topBar.className = 'daino-hud__top';

    const scoreBox = document.createElement('div');
    scoreBox.className = 'daino-hud__score';
    scoreBox.setAttribute('role', 'status');
    scoreBox.setAttribute('aria-live', 'polite');
    const scoreLabel = pixelText('Puntos', { className: 'daino-hud__label', shadow: true });
    scoreEl = pixelText('000000', { className: 'daino-hud__value', shadow: true });
    scoreBox.appendChild(scoreLabel);
    scoreBox.appendChild(scoreEl);

    const centerBox = document.createElement('div');
    centerBox.className = 'daino-hud__progress';
    const timerRow = document.createElement('div');
    timerRow.className = 'daino-hud__timer-row';
    timerEl = pixelText('0:00 / 0:00', { className: 'daino-hud__timer', shadow: true });
    // Marchas (afinado de velocidad): cuánto más rápido va el mundo que al
    // empezar. Decorativo para lectores de pantalla: la información es visual.
    gearEl = document.createElement('span');
    gearEl.className = 'daino-hud__gear';
    gearEl.setAttribute('aria-hidden', 'true');
    chevEls = [];
    for (let i = 0; i < GEAR_SLOTS; i++) {
        // Una flecha de la letra del juego por marcha.
        const chev = pixelText('▶', { className: 'daino-hud__chev', shadow: true });
        gearEl.appendChild(chev);
        chevEls.push(chev);
    }
    timerRow.appendChild(timerEl);
    timerRow.appendChild(gearEl);
    const progressBar = document.createElement('div');
    progressBar.className = 'daino-hud__progress-bar';
    progressBarEl = progressBar;
    // Mapa de la canción bajo la barra: tramos por intensidad, el clímax y
    // cada acelerón. Lo que viene se ve venir.
    roadEl = document.createElement('div');
    roadEl.className = 'daino-hud__road';
    roadEl.setAttribute('aria-hidden', 'true');
    progressFgEl = document.createElement('div');
    progressFgEl.className = 'daino-hud__progress-fg';
    progressBar.appendChild(roadEl);
    progressBar.appendChild(progressFgEl);
    // Modo de movimiento (Ola 6a): avisa del portal que viene y nombra el modo
    // mientras dura. La primera vez que alguien lo juega, además dice cómo.
    modeEl = document.createElement('div');
    modeEl.className = 'daino-hud__mode';
    modeEl.dataset.state = '';
    modeEl.setAttribute('role', 'status');
    modeLabelEl = pixelText('', { className: 'daino-hud__mode-label' });
    modeHintEl = document.createElement('span');
    modeHintEl.className = 'daino-hud__mode-hint';
    modeEl.append(modeLabelEl, modeHintEl);

    centerBox.appendChild(timerRow);
    centerBox.appendChild(progressBar);
    centerBox.appendChild(modeEl);

    const songBox = document.createElement('div');
    songBox.className = 'daino-hud__song';
    songEl = document.createElement('span');
    songEl.textContent = '';      // Bloque 7 lo llenará con metadata real
    songBox.appendChild(songEl);

    topBar.appendChild(scoreBox);
    topBar.appendChild(centerBox);
    topBar.appendChild(songBox);

    // Pausa: tamaño de dedo (≥ 44 px) y arriba a la derecha, donde está en
    // todos los juegos. Pierde el foco al pulsarse: con el foco encima, la
    // barra espaciadora (saltar) lo "pulsaría" otra vez.
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'daino-btn daino-hud__pause';
    pauseBtn.dataset.interactive = 'true';
    pauseBtn.setAttribute('aria-label', 'Pausa (Esc)');
    pauseBtn.title = 'Pausa (Esc)';
    pauseBtn.append(document.createElement('i'), document.createElement('i'));
    pauseBtn.addEventListener('click', () => {
        pauseBtn.blur();
        Input.emit('pause');
    });

    // Rótulo secundario (Ola 5): "¡Superado!" cuando ya no quedan obstáculos
    // y la canción termina sonando; "Intento N" al reintentar. No tapa el
    // centro de la escena.
    bannerEl = pixelText('', { tag: 'div', className: 'daino-hud__banner', shadow: true });
    bannerEl.setAttribute('role', 'status');

    // Rótulo de una historia de autor (T02.6): una línea breve, en cursiva, bajo el
    // mapa de la canción ("Diez años después…"). Como los subtítulos de una
    // película: aparece, se lee y se va, sin tapar lo que se juega.
    captionEl = document.createElement('p');
    captionEl.className = 'daino-hud__caption';
    captionEl.setAttribute('role', 'status');
    captionEl.setAttribute('aria-live', 'polite');

    controlsEl = buildControls();

    rootEl.appendChild(topBar);
    rootEl.appendChild(pauseBtn);
    rootEl.appendChild(bannerEl);
    rootEl.appendChild(captionEl);
    rootEl.appendChild(controlsEl);
    host.appendChild(rootEl);

    return api;
}

/**
 * Cómo se juega. En táctil, las dos mitades de la pantalla con lo que hace
 * cada una (así se juega de verdad: izquierda salta, derecha agacha); con
 * teclado, las teclas.
 */
function buildControls() {
    const box = document.createElement('div');
    box.className = 'daino-hud__controls';
    box.setAttribute('aria-hidden', 'true');
    box.dataset.shown = 'false';
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    box.dataset.input = touch ? 'touch' : 'keys';
    const side = (cls, key, text) => {
        const el = document.createElement('div');
        el.className = `daino-hud__controls-side ${cls}`;
        el.append(keycap(key), pixelText(text));
        return el;
    };
    if (touch) {
        box.append(side('is-left', 'Toca', 'Saltar'), side('is-right', 'Toca', 'Agacharse'));
    } else {
        box.append(side('is-left', 'Espacio', 'Saltar'), side('is-right', '↓', 'Agacharse'), side('is-pause', 'Esc', 'Pausa'));
    }
    return box;
}

function resetState() {
    lastScore = -1;
    lastScoreAt = -Infinity;
    lastTimeKey = '';
    lastRatio = -1;
    lastPhase = '';
    lastGearKey = '';
    if (roadEl) roadEl.replaceChildren();
    if (progressBarEl) delete progressBarEl.dataset.road;
    if (gearEl) {
        gearEl.dataset.gear = '0';
        delete gearEl.dataset.bump;
    }
    for (const chev of chevEls) {
        delete chev.dataset.on;
        delete chev.dataset.next;
    }
    if (controlsEl) controlsEl.dataset.shown = 'false';
    if (modeEl) {
        modeEl.dataset.state = '';
        setPixelText(modeLabelEl, '');
        modeHintEl.textContent = '';
    }
    lastModeKey = '';
    if (bannerEl) {
        setPixelText(bannerEl, '');
        bannerEl.dataset.shown = 'false';
    }
    if (captionEl) {
        captionEl.textContent = '';
        captionEl.dataset.shown = 'false';
    }
    if (rootEl) delete rootEl.dataset.phase;
}

const api = {
    /**
     * @param {number} score        Entero monótono creciente.
     * @param {number} currentSec   Tiempo actual de la canción.
     * @param {number} totalSec     Duración total.
     */
    update(score, currentSec, totalSec) {
        if (score !== lastScore && scoreEl && (score < lastScore || currentSec - lastScoreAt >= SCORE_MIN_INTERVAL_S || currentSec < lastScoreAt)) {
            setPixelText(scoreEl, String(score).padStart(6, '0'));
            lastScore = score;
            lastScoreAt = currentSec;
        }
        const timeKey = `${fmtTime(currentSec)}|${fmtTime(totalSec)}`;
        if (timeKey !== lastTimeKey && timerEl) {
            setPixelText(timerEl, `${fmtTime(currentSec)} / ${fmtTime(totalSec)}`);
            lastTimeKey = timeKey;
        }
        const ratio = totalSec > 0 ? Math.max(0, Math.min(1, currentSec / totalSec)) : 0;
        // Solo se toca la barra cuando avanza un paso (0.1 %): redondeada a 0.01 %
        // cambiaba de ancho en cada fotograma (maquetar y repintar, siempre).
        const rounded = Math.round(ratio * PROGRESS_STEP) / PROGRESS_STEP;
        if (rounded !== lastRatio && progressFgEl) {
            progressFgEl.style.width = `${(rounded * 100).toFixed(2)}%`;
            lastRatio = rounded;
        }
    },
    /** Setea el nombre de la canción mostrado arriba-derecha. */
    setSong(name) {
        if (songEl) songEl.textContent = name ?? '';
    },
    /** Rótulo secundario (p. ej. "¡Superado!"). Pasar '' para ocultar. */
    setBanner(text) {
        if (!bannerEl) return;
        // Al ocultarlo el texto se queda: así se desvanece en vez de vaciarse de golpe.
        if (text) setPixelText(bannerEl, text);
        bannerEl.dataset.shown = text ? 'true' : 'false';
    },
    /** Rótulo de una historia de autor (T02.6). Pasar '' para que se desvanezca. */
    /**
     * Cuenta atrás al reanudar desde la pausa: un número grande en el centro.
     * Cadena vacía = fuera.
     */
    setCountdown(text) {
        if (!rootEl) return;
        if (!countEl) {
            countEl = pixelText('', { tag: 'div', className: 'daino-hud__count', shadow: 'half' });
            countEl.setAttribute('role', 'status');
            countEl.setAttribute('aria-live', 'assertive');
            rootEl.appendChild(countEl);
        }
        if (text) setPixelText(countEl, text);
        countEl.dataset.shown = text ? 'true' : 'false';
        // Cada número entra con su golpe: se reinicia la animación.
        if (text) {
            countEl.style.animation = 'none';
            void countEl.offsetWidth;
            countEl.style.animation = '';
        }
    },

    setCaption(text) {
        if (!captionEl) return;
        if (text) captionEl.textContent = text;
        captionEl.dataset.shown = text ? 'true' : 'false';
    },
    /** Controles de juego, en las primeras partidas. */
    setControls(visible) {
        if (controlsEl) controlsEl.dataset.shown = visible ? 'true' : 'false';
    },
    /**
     * Fase de la canción para el CSS (Ola 5): 'climax' enciende la barra de
     * progreso; '' la deja normal. Solo toca el DOM si cambia.
     * @param {'' | 'climax' | 'cleared'} phase
     */
    setPhase(phase) {
        if (!rootEl || phase === lastPhase) return;
        lastPhase = phase;
        if (phase === '') delete rootEl.dataset.phase;
        else rootEl.dataset.phase = phase;
    },
    /**
     * Mapa de la canción en la barra de progreso (afinado de velocidad): cada
     * tramo con su intensidad, el clímax resaltado y una marca en cada
     * acelerón. Se llama una vez al empezar la partida.
     *
     * @param {{ durationSec: number, sections: Array<{ t: number, level: number, climax?: boolean }>,
     *           speedUps: number[], modes?: Array<{ t0: number, t1: number, color: number }> }} road
     */
    setRoadmap({ durationSec, sections, speedUps, modes = [] }) {
        if (!roadEl || !(durationSec > 0)) return;
        const pct = (t) => `${(Math.max(0, Math.min(1, t / durationSec)) * 100).toFixed(3)}%`;
        const nodes = [];
        for (let i = 0; i < sections.length; i++) {
            const s = sections[i];
            const end = sections[i + 1]?.t ?? durationSec;
            if (end <= s.t) continue;
            const seg = document.createElement('i');
            seg.className = 'daino-hud__road-seg';
            seg.dataset.level = String(s.level);
            if (s.climax) seg.dataset.climax = 'true';
            seg.style.left = pct(s.t);
            seg.style.width = `${((Math.min(end, durationSec) - s.t) / durationSec * 100).toFixed(3)}%`;
            nodes.push(seg);
        }
        // Tramos con otras reglas (Ola 6a): una banda del color del modo.
        for (const m of modes) {
            if (m.t1 <= m.t0) continue;
            const band = document.createElement('i');
            band.className = 'daino-hud__road-mode';
            band.style.left = pct(m.t0);
            band.style.width = `${((Math.min(m.t1, durationSec) - m.t0) / durationSec * 100).toFixed(3)}%`;
            band.style.background = `#${m.color.toString(16).padStart(6, '0')}`;
            nodes.push(band);
        }
        for (const t of speedUps) {
            const tick = document.createElement('b');
            tick.className = 'daino-hud__road-tick';
            tick.style.left = pct(t);
            nodes.push(tick);
        }
        roadEl.replaceChildren(...nodes);
        if (progressBarEl) progressBarEl.dataset.road = nodes.length > 0 ? 'true' : 'false';
    },
    /**
     * Marchas encendidas y aviso de la siguiente (afinado de velocidad). Solo
     * toca el DOM si algo cambia; `blink` lo marca el pulso de la canción.
     *
     * @param {number} gear             0…4
     * @param {{ next?: number | null, blink?: boolean }} [warn]  Marcha que viene y si su chevrón se ve en este instante.
     */
    setGear(gear, warn = {}) {
        if (!gearEl) return;
        const next = warn.next ?? null;
        const blink = next !== null && next > gear && warn.blink === true;
        const key = `${gear}|${next}|${blink}`;
        if (key === lastGearKey) return;
        lastGearKey = key;
        gearEl.dataset.gear = String(gear);
        for (let i = 0; i < chevEls.length; i++) {
            const on = i < gear;
            if (on) chevEls[i].dataset.on = 'true';
            else delete chevEls[i].dataset.on;
            if (blink && i >= gear && i < next) chevEls[i].dataset.next = 'true';
            else delete chevEls[i].dataset.next;
        }
    },
    /**
     * Modo de movimiento (Ola 6a): 'warn' antes de su portal, 'on' mientras dura
     * y '' corriendo. `hint` explica los controles las primeras veces.
     *
     * @param {{ state: '' | 'warn' | 'on', label: string, color?: number, hint?: string }} mode
     */
    setMode({ state, label, color, hint = '' }) {
        if (!modeEl) return;
        const key = `${state}|${label}|${hint}`;
        if (key === lastModeKey) return;
        lastModeKey = key;
        modeEl.dataset.state = state;
        setPixelText(modeLabelEl, label);
        modeHintEl.textContent = hint;
        if (color !== undefined) modeEl.style.setProperty('--daino-mode-color', `#${color.toString(16).padStart(6, '0')}`);
    },

    /** Destello del indicador al entrar una marcha. */
    bumpGear() {
        if (!gearEl) return;
        // Reiniciar la animación CSS: quitar, forzar reflow, volver a poner.
        delete gearEl.dataset.bump;
        void gearEl.offsetWidth;
        gearEl.dataset.bump = 'true';
    },
    dispose() {
        if (rootEl !== null) {
            rootEl.remove();
            rootEl = null;
            scoreEl = null;
            timerEl = null;
            progressFgEl = null;
            bannerEl = null;
            countEl = null;
            captionEl = null;
            controlsEl = null;
            songEl = null;
        }
        resetState();
        progressBarEl = null;
        roadEl = null;
        gearEl = null;
        modeEl = null;
        modeLabelEl = null;
        modeHintEl = null;
        chevEls = [];
    },
};

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        // En HMR durante partida queremos preservar score y timer. El nuevo
        // módulo creará un HUD limpio; los valores vienen de GameSession en
        // el siguiente tick automáticamente.
    });
    import.meta.hot.dispose(() => {
        if (rootEl !== null) {
            rootEl.remove();
            rootEl = null;
        }
    });
}
