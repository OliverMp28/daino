// input.js — fuente única de input del juego. Canales:
//
//   'jump'      — pulsación de salto. Teclado Space/ArrowUp (sin auto-repeat),
//                 touch en la MITAD IZQUIERDA del viewport, GAME_ACTION 'JUMP'
//                 del bridge (modo iframe en Vout).
//   'jumpEnd'   — se soltó el botón/tap de salto. Habilita el salto de altura
//                 variable (soltar pronto = salto corto).
//   'duckStart' — mantener ↓/KeyS o touch en la MITAD DERECHA (doc 06 §6).
//   'duckEnd'   — se soltó el agacharse.
//   'pause'     — Escape (delega al <dialog> nativo si hay uno abierto).
//
// Diseño:
//   - Singleton que la GameSession instancia en `start()` y dispone en `stop()`.
//   - EventEmitter mínimo: `on(event, fn)`, `off(event, fn)`.
//   - Touch: el lado se decide en touchstart y se recuerda por touch id — el
//     touchend del mismo dedo emite el End del canal que abrió, aunque el
//     dedo se haya deslizado al otro lado.
//   - Desacoplado de Pixi y de la entidad — la GameSession suscribe.

import { setOnGameAction, isBridgeEmbedded } from '../../iframe/bridge.js';

const KEYS_JUMP = new Set(['Space', 'ArrowUp']);
const KEYS_DUCK = new Set(['ArrowDown', 'KeyS']);
const KEYS_PAUSE = new Set(['Escape']);

/** Duración del "tap" sintético de salto/agacharse que llega por el bridge
 *  (postMessage no trae keyup — cerramos el gesto tras este delay). */
const BRIDGE_TAP_MS = 160;

class InputHub {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._handlers = new Map();
        this._keyDown = null;
        this._keyUp = null;
        this._touchStart = null;
        this._touchEnd = null;
        /** @type {Map<number, 'jump' | 'duck'>} side abierto por cada touch id. */
        this._touchSides = new Map();
        this._mounted = false;
    }

    on(event, fn) {
        let set = this._handlers.get(event);
        if (!set) {
            set = new Set();
            this._handlers.set(event, set);
        }
        set.add(fn);
    }

    off(event, fn) {
        const set = this._handlers.get(event);
        if (set) set.delete(fn);
    }

    emit(event, payload) {
        const set = this._handlers.get(event);
        if (!set) return;
        for (const fn of set) fn(payload);
    }

    /**
     * Cablea los listeners DOM y el handler del bridge. Idempotente — segunda
     * llamada es no-op para evitar duplicar listeners si el caller despista.
     */
    setup() {
        if (this._mounted) return;
        this._mounted = true;

        this._keyDown = (ev) => {
            if (KEYS_JUMP.has(ev.code)) {
                // preventDefault evita que Space haga scroll. ev.repeat fuera:
                // mantener pulsado NO re-salta (el jump buffer ya cubre el
                // "pulsé un pelín antes de aterrizar").
                ev.preventDefault();
                if (!ev.repeat) this.emit('jump');
                return;
            }
            if (KEYS_DUCK.has(ev.code)) {
                ev.preventDefault();
                if (!ev.repeat) this.emit('duckStart');
                return;
            }
            if (KEYS_PAUSE.has(ev.code)) {
                // Si hay un <dialog open>, dejamos al cierre nativo del
                // dialog manejar el ESC. Sin esto, abrir Settings durante
                // partida y pulsar ESC cerraba ese dialog Y abría el modal
                // de pausa (los dos visibles).
                if (document.querySelector('dialog[open]') !== null) return;
                ev.preventDefault();
                this.emit('pause');
            }
        };
        this._keyUp = (ev) => {
            if (KEYS_JUMP.has(ev.code)) this.emit('jumpEnd');
            else if (KEYS_DUCK.has(ev.code)) this.emit('duckEnd');
        };
        window.addEventListener('keydown', this._keyDown);
        window.addEventListener('keyup', this._keyUp);

        this._touchStart = (ev) => {
            // Si el tap viene encima de UI DOM (toasts, menú, modales, HUD,
            // chip de auth, cualquier botón/enlace), lo dejamos burbujear sin
            // emitir ni preventDefault — sino el tap no genera click y la UI
            // deja de responder en táctil.
            if (ev.target instanceof HTMLElement && ev.target.closest(
                '[role="alert"], button, a, input, label, select, dialog, #menu-root, #modal-root, #hud-root, #auth-anchor',
            )) {
                return;
            }
            ev.preventDefault();
            const half = window.innerWidth / 2;
            for (const t of ev.changedTouches) {
                const side = t.clientX < half ? 'jump' : 'duck';
                this._touchSides.set(t.identifier, side);
                this.emit(side === 'jump' ? 'jump' : 'duckStart');
            }
        };
        this._touchEnd = (ev) => {
            for (const t of ev.changedTouches) {
                const side = this._touchSides.get(t.identifier);
                if (!side) continue;
                this._touchSides.delete(t.identifier);
                this.emit(side === 'jump' ? 'jumpEnd' : 'duckEnd');
            }
        };
        // passive:false porque hacemos preventDefault. En móviles el navegador
        // queja si lo dejas passive y luego cancelas el evento.
        document.body.addEventListener('touchstart', this._touchStart, { passive: false });
        document.body.addEventListener('touchend', this._touchEnd);
        document.body.addEventListener('touchcancel', this._touchEnd);

        // Bridge: solo si estamos embebidos (Vout). Sin keyup remoto — el End
        // se sintetiza con un timer corto (medio salto / agachada breve).
        if (isBridgeEmbedded()) {
            setOnGameAction((payload) => {
                if (payload === 'JUMP') {
                    this.emit('jump');
                    setTimeout(() => this.emit('jumpEnd'), BRIDGE_TAP_MS);
                } else if (payload === 'DUCK') {
                    this.emit('duckStart');
                    setTimeout(() => this.emit('duckEnd'), BRIDGE_TAP_MS * 2);
                }
            });
        }
    }

    /** Despide listeners. La GameSession llama esto en `stop()`. */
    dispose() {
        if (!this._mounted) return;
        if (this._keyDown) window.removeEventListener('keydown', this._keyDown);
        if (this._keyUp) window.removeEventListener('keyup', this._keyUp);
        if (this._touchStart) document.body.removeEventListener('touchstart', this._touchStart);
        if (this._touchEnd) {
            document.body.removeEventListener('touchend', this._touchEnd);
            document.body.removeEventListener('touchcancel', this._touchEnd);
        }
        if (isBridgeEmbedded()) setOnGameAction(null);
        this._handlers.clear();
        this._touchSides.clear();
        this._keyDown = null;
        this._keyUp = null;
        this._touchStart = null;
        this._touchEnd = null;
        this._mounted = false;
    }
}

/** Instancia compartida. Daino es single-page, una sola sesión activa a la vez. */
export const Input = new InputHub();
