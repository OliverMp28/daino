// input.js — fuente única de input del juego. Canales:
//
//   'jump'      — pulsación de salto. Teclado Space/ArrowUp (sin auto-repeat),
//                 touch en la MITAD IZQUIERDA del viewport, GAME_ACTION 'JUMP'
//                 del bridge (modo iframe en Vout).
//   'jumpEnd'   — se soltó el botón/tap de salto. Corriendo no cambia nada (el
//                 salto es siempre el mismo arco); en el vuelo, soltar es bajar.
//   'duckStart' — ↓/KeyS o touch en la MITAD DERECHA (doc 06 §6). Un toque basta
//                 para agacharse; mantener sigue valiendo.
//   'duckEnd'   — se soltó el agacharse.
//   'pause'     — Escape (delega al <dialog> nativo si hay uno abierto).
//
// Diseño:
//   - Cada emisión lleva `{ timeStamp }`: el instante REAL de la pulsación en el
//     reloj de `performance.now()` (Ola 3). Si el hilo principal va con retraso
//     (un frame largo), la tecla se procesa tarde, pero la GameSession la aplica
//     en el paso de física que corresponde a cuándo se pulsó, no a cuándo se
//     leyó. En un juego de ritmo esa diferencia decide si el salto cae en el beat.
//   - Singleton que la GameSession instancia en `start()` y dispone en `stop()`.
//   - EventEmitter mínimo: `on(event, fn)`, `off(event, fn)`.
//   - Touch: el lado se decide en touchstart y se recuerda por touch id — el
//     touchend del mismo dedo emite el End del canal que abrió, aunque el
//     dedo se haya deslizado al otro lado.
//   - El juego solo se queda un toque cuando es SUYO: hay una partida escuchando,
//     no hay un diálogo encima y el dedo cae en el lienzo (`takesTouch`). Todo lo
//     demás —un botón, un panel, el menú— es de la interfaz y sigue su curso
//     normal: su clic, su desplazamiento, tirar para recargar. La misma regla que
//     el teclado.
//   - Nada se queda pulsado: si la ventana pierde el foco o la pestaña se oculta
//     con una tecla o un dedo abajo, su `keyup`/`touchend` no llega nunca. Al
//     perder el foco se suelta todo lo que estuviera mantenido.
//   - Desacoplado de Pixi y de la entidad — la GameSession suscribe.

import { setOnGameAction, isBridgeEmbedded } from '../../iframe/bridge.js';

const KEYS_JUMP = new Set(['Space', 'ArrowUp']);
const KEYS_DUCK = new Set(['ArrowDown', 'KeyS']);
const KEYS_PAUSE = new Set(['Escape']);

/** Donde se juega: el lienzo de Pixi (`<div id="app">`). */
const PLAY_SURFACE = '#app';

/**
 * ¿Este toque es del juego?
 *
 * Hasta Oct 2026 la pregunta era la contraria ("¿cae sobre la interfaz?"), con una
 * lista de lo que era interfaz y `target instanceof HTMLElement`. Los rótulos de
 * los botones son un `<svg>` desde la T04, y un `<svg>` NO es un HTMLElement: el
 * toque sobre el rótulo se tomaba por uno del juego, se anulaba, y el botón no
 * recibía su clic (solo funcionaba tocándolo por el borde). Y como los listeners
 * se quedan montados tras la primera partida, pasaba en todas las pantallas.
 *
 * Ahora se pregunta por lo único que es del juego, el lienzo: cualquier cosa que
 * se ponga encima en el futuro es interfaz sin tener que apuntarla en ningún sitio.
 *
 * @param {{ closest?: (selector: string) => unknown } | null} target  Donde cayó el dedo.
 * @param {boolean} playing     Hay una partida escuchando.
 * @param {boolean} dialogOpen  Hay un `<dialog>` abierto (pausa, resultados, catálogo…).
 */
export function takesTouch(target, playing, dialogOpen) {
    if (!playing || dialogOpen) return false;
    return typeof target?.closest === 'function' && target.closest(PLAY_SURFACE) !== null;
}

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
        /** @type {Map<string, 'jump' | 'duck'>} canal abierto por cada tecla mantenida. */
        this._keysHeld = new Map();
        this._releaseAll = null;
        this._onHidden = null;
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

    /** ¿Hay alguien escuchando este canal? (una partida en curso escucha 'jump'). */
    has(event) {
        return (this._handlers.get(event)?.size ?? 0) > 0;
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
            if (KEYS_JUMP.has(ev.code) || KEYS_DUCK.has(ev.code)) {
                // Solo se roban las teclas mientras alguien juega y no hay un
                // diálogo encima (reintentos, Sep 2026). Antes, tras la primera
                // partida los listeners seguían montados y el preventDefault
                // global dejaba sin Espacio a los botones de los paneles y sin
                // flechas al scroll del catálogo y a los desplegables de AJUSTES.
                if (!this.has('jump') || document.querySelector('dialog[open]') !== null) return;
                // Jugando, sí: Espacio no hace scroll ni "pulsa" el botón que
                // tenga el foco (p. ej. el de pausa tras usarlo con el ratón).
                // ev.repeat fuera: mantener pulsado NO re-salta (el jump buffer
                // ya cubre el "pulsé un pelín antes de aterrizar").
                ev.preventDefault();
                if (ev.repeat) return;
                const channel = KEYS_JUMP.has(ev.code) ? 'jump' : 'duck';
                this._keysHeld.set(ev.code, channel);
                this.emit(channel === 'jump' ? 'jump' : 'duckStart', stamp(ev));
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
            this._keysHeld.delete(ev.code);
            if (KEYS_JUMP.has(ev.code)) this.emit('jumpEnd', stamp(ev));
            else if (KEYS_DUCK.has(ev.code)) this.emit('duckEnd', stamp(ev));
        };
        window.addEventListener('keydown', this._keyDown);
        window.addEventListener('keyup', this._keyUp);

        // Sin foco no llegan los `keyup` ni los `touchend`: se suelta todo ahora.
        this._releaseAll = () => {
            const at = now();
            for (const channel of this._keysHeld.values()) this.emit(channel === 'jump' ? 'jumpEnd' : 'duckEnd', at);
            for (const side of this._touchSides.values()) this.emit(side === 'jump' ? 'jumpEnd' : 'duckEnd', at);
            this._keysHeld.clear();
            this._touchSides.clear();
        };
        this._onHidden = () => { if (document.hidden) this._releaseAll(); };
        window.addEventListener('blur', this._releaseAll);
        document.addEventListener('visibilitychange', this._onHidden);

        this._touchStart = (ev) => {
            // Solo los toques del juego. Anular cualquier otro dejaría sin clic al
            // botón que hay debajo y sin gesto al navegador (tirar para recargar).
            if (!takesTouch(ev.target, this.has('jump'), document.querySelector('dialog[open]') !== null)) return;
            ev.preventDefault();
            const half = window.innerWidth / 2;
            for (const t of ev.changedTouches) {
                const side = t.clientX < half ? 'jump' : 'duck';
                this._touchSides.set(t.identifier, side);
                this.emit(side === 'jump' ? 'jump' : 'duckStart', stamp(ev));
            }
        };
        this._touchEnd = (ev) => {
            for (const t of ev.changedTouches) {
                const side = this._touchSides.get(t.identifier);
                if (!side) continue;
                this._touchSides.delete(t.identifier);
                this.emit(side === 'jump' ? 'jumpEnd' : 'duckEnd', stamp(ev));
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
                // postMessage no trae la marca de la pulsación original: la
                // mejor aproximación es el instante en que llega el mensaje.
                if (payload === 'JUMP') {
                    this.emit('jump', now());
                    setTimeout(() => this.emit('jumpEnd', now()), BRIDGE_TAP_MS);
                } else if (payload === 'DUCK') {
                    this.emit('duckStart', now());
                    setTimeout(() => this.emit('duckEnd', now()), BRIDGE_TAP_MS * 2);
                }
            });
        }
    }

    /** Despide listeners. La GameSession llama esto en `stop()`. */
    dispose() {
        if (!this._mounted) return;
        if (this._keyDown) window.removeEventListener('keydown', this._keyDown);
        if (this._keyUp) window.removeEventListener('keyup', this._keyUp);
        if (this._releaseAll) window.removeEventListener('blur', this._releaseAll);
        if (this._onHidden) document.removeEventListener('visibilitychange', this._onHidden);
        if (this._touchStart) document.body.removeEventListener('touchstart', this._touchStart);
        if (this._touchEnd) {
            document.body.removeEventListener('touchend', this._touchEnd);
            document.body.removeEventListener('touchcancel', this._touchEnd);
        }
        if (isBridgeEmbedded()) setOnGameAction(null);
        this._handlers.clear();
        this._touchSides.clear();
        this._keysHeld.clear();
        this._releaseAll = null;
        this._onHidden = null;
        this._keyDown = null;
        this._keyUp = null;
        this._touchStart = null;
        this._touchEnd = null;
        this._mounted = false;
    }
}

/**
 * Payload de una emisión: el instante real del evento.
 * `Event.timeStamp` usa el mismo reloj que `performance.now()` en todos los
 * navegadores actuales. Si faltara, el instante de procesado es la alternativa.
 */
function stamp(ev) {
    return { timeStamp: Number.isFinite(ev.timeStamp) && ev.timeStamp > 0 ? ev.timeStamp : performance.now() };
}

function now() {
    return { timeStamp: performance.now() };
}

/** Instancia compartida. Daino es single-page, una sola sesión activa a la vez. */
export const Input = new InputHub();
