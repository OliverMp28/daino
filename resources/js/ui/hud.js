// HUD durante partida — DOM puro con Tailwind/CSS. Reemplaza al
// game/systems/Hud.js (BitmapText) del Bloque 5.
//
// Doc 06 §4.2 + §8: HUD `fixed` con `pointer-events: none`. Tipografía
// vectorial (Inter via tokens en main.css), transiciones CSS, ARIA gratis.
//
// API igual a la del HUD canvas anterior — GameSession solo cambia el
// import y un argumento (createHud() sin layers, ahora):
//   createHud()                       → { update, setMessage, dispose }
//   update(score, currentSec, total)  Llamado cada frame por GameSession.
//   setMessage(text)                  Mensaje grande centrado (game over/win).
//   dispose()                         Quita el HUD del DOM.

let rootEl = null;
let scoreEl = null;
let timerEl = null;
let progressFgEl = null;
let messageEl = null;
let bannerEl = null;
let songEl = null;
let lastPhase = '';
let lastScore = -1;
let lastTimeKey = '';
let lastRatio = -1;

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
    const scoreLabel = document.createElement('span');
    scoreLabel.className = 'daino-hud__label';
    scoreLabel.textContent = 'SCORE';
    scoreEl = document.createElement('span');
    scoreEl.className = 'daino-hud__value';
    scoreEl.textContent = '000000';
    scoreBox.appendChild(scoreLabel);
    scoreBox.appendChild(scoreEl);

    const centerBox = document.createElement('div');
    centerBox.className = 'daino-hud__progress';
    timerEl = document.createElement('span');
    timerEl.className = 'daino-hud__timer';
    timerEl.textContent = '0:00 / 0:00';
    const progressBar = document.createElement('div');
    progressBar.className = 'daino-hud__progress-bar';
    progressFgEl = document.createElement('div');
    progressFgEl.className = 'daino-hud__progress-fg';
    progressBar.appendChild(progressFgEl);
    centerBox.appendChild(timerEl);
    centerBox.appendChild(progressBar);

    const songBox = document.createElement('div');
    songBox.className = 'daino-hud__song';
    songEl = document.createElement('span');
    songEl.textContent = '';      // Bloque 7 lo llenará con metadata real
    songBox.appendChild(songEl);

    topBar.appendChild(scoreBox);
    topBar.appendChild(centerBox);
    topBar.appendChild(songBox);

    // Mensaje central (game over / win). Oculto por defecto.
    messageEl = document.createElement('div');
    messageEl.className = 'daino-hud__message';
    messageEl.setAttribute('role', 'alert');

    // Rótulo secundario (Ola 5): "¡Superado!" cuando ya no quedan obstáculos
    // y la canción termina sonando. No tapa el centro de la escena.
    bannerEl = document.createElement('div');
    bannerEl.className = 'daino-hud__banner';
    bannerEl.setAttribute('role', 'status');

    rootEl.appendChild(topBar);
    rootEl.appendChild(bannerEl);
    rootEl.appendChild(messageEl);
    host.appendChild(rootEl);

    return api;
}

function resetState() {
    lastScore = -1;
    lastTimeKey = '';
    lastRatio = -1;
    lastPhase = '';
    if (messageEl) {
        messageEl.textContent = '';
        messageEl.dataset.shown = 'false';
    }
    if (bannerEl) {
        bannerEl.textContent = '';
        bannerEl.dataset.shown = 'false';
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
        if (score !== lastScore && scoreEl) {
            scoreEl.textContent = String(score).padStart(6, '0');
            lastScore = score;
        }
        const timeKey = `${fmtTime(currentSec)}|${fmtTime(totalSec)}`;
        if (timeKey !== lastTimeKey && timerEl) {
            timerEl.textContent = `${fmtTime(currentSec)} / ${fmtTime(totalSec)}`;
            lastTimeKey = timeKey;
        }
        const ratio = totalSec > 0 ? Math.max(0, Math.min(1, currentSec / totalSec)) : 0;
        // El progress bar puede ser fractional — solo repaint si cambió un pelín.
        // Round a 4 decimales (~0.01% precisión) para evitar jitter.
        const rounded = Math.round(ratio * 10000) / 10000;
        if (rounded !== lastRatio && progressFgEl) {
            progressFgEl.style.width = `${(rounded * 100).toFixed(2)}%`;
            lastRatio = rounded;
        }
    },
    /** Setea el nombre de la canción mostrado arriba-derecha. */
    setSong(name) {
        if (songEl) songEl.textContent = name ?? '';
    },
    /** Mensaje grande centrado (game over / win). Pasar '' para ocultar. */
    setMessage(text) {
        if (!messageEl) return;
        messageEl.textContent = text;
        messageEl.dataset.shown = (text && text !== '') ? 'true' : 'false';
    },
    /** Rótulo secundario (p. ej. "¡Superado!"). Pasar '' para ocultar. */
    setBanner(text) {
        if (!bannerEl) return;
        bannerEl.textContent = text;
        bannerEl.dataset.shown = (text && text !== '') ? 'true' : 'false';
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
    dispose() {
        if (rootEl !== null) {
            rootEl.remove();
            rootEl = null;
            scoreEl = null;
            timerEl = null;
            progressFgEl = null;
            messageEl = null;
            bannerEl = null;
            songEl = null;
        }
        resetState();
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
