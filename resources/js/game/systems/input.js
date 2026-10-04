// input.js — fuente única de input del juego. Canales:
//
//   'jump'      — pulsación de salto. Teclado Space/ArrowUp (sin auto-repeat),
//                 touch en la MITAD IZQUIERDA del viewport, y lo que el jugador
//                 hace con la cara dentro del portal de Vout (iframe/remote.js).
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
//   - Cada pulsación tiene una FUENTE (una tecla, un dedo, un gesto de Vout) y
//     una fuente no pulsa dos veces sin soltar: `press` y `release` van por
//     parejas. Un mismo salto no se cuenta dos veces aunque el aviso llegue
//     repetido (dos gestos de Vout que mantienen la misma acción, una tecla que
//     ya estaba abajo), y solo "suelta" lo que estaba pulsado.
//   - Las pulsaciones del control facial de Vout llevan `remote: true`. Su
//     "soltar" llega tarde (con un gesto de la cara, medio segundo o más después
//     de relajarlo), así que no sirve para medir un salto: corriendo cuentan como
//     un toque (el arco del nivel), y solo el propulsor atiende a cuánto duran.
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
//     perder el foco se suelta lo que estuviera mantenido en ESTE equipo; lo que
//     mantiene el portal lo suelta el portal, tenga o no el foco el juego.
//   - Desacoplado de Pixi y de la entidad — la GameSession suscribe.

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

/**
 * Lo que dura una pulsación que llega sin su "soltar" (un clic del control facial
 * de Vout). Corriendo da igual lo que dure; con el propulsor es un empujón corto.
 */
const TAP_MS = 90;

/**
 * Eventos de teclado que no vienen de un teclado: el control facial de Vout
 * (iframe/remote.js) crea en la página las teclas del mapeo de cada usuario. Aquí
 * se apunta cuándo ocurrió el gesto de verdad (el evento se crea después).
 * @type {WeakMap<Event, number>}
 */
const REMOTE_EVENTS = new WeakMap();

/**
 * Marca un evento de teclado como creado por el mando del portal.
 *
 * @template {Event} E
 * @param {E} ev
 * @param {number} timeStamp  Cuándo ocurrió el gesto, en el reloj de `performance.now()`.
 * @returns {E}
 */
export function markRemote(ev, timeStamp) {
    REMOTE_EVENTS.set(ev, timeStamp);
    return ev;
}

/**
 * @typedef {{ timeStamp: number, remote?: boolean }} Press
 *   `remote`: viene del control facial de Vout (ver la cabecera).
 */

class InputHub {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._handlers = new Map();
        this._keyDown = null;
        this._keyUp = null;
        this._touchStart = null;
        this._touchEnd = null;
        /**
         * Lo que está pulsado ahora, por fuente: `key:Space`, `touch:3`, `action:JUMP`…
         * @type {Map<string, { channel: 'jump' | 'duck', remote: boolean }>}
         */
        this._held = new Map();
        this._taps = 0;
        this._releaseLocal = null;
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
     * Una fuente empieza a pulsar. Si ya estaba pulsando no pasa nada: una
     * pulsación, un salto.
     *
     * @param {string} source              Quién pulsa (`key:Space`, `touch:3`, `action:JUMP`).
     * @param {'jump' | 'duck'} channel
     * @param {Press} [payload]
     * @returns {boolean}  false si esa fuente ya estaba pulsando.
     */
    press(source, channel, payload = now()) {
        if (this._held.has(source)) return false;
        this._held.set(source, { channel, remote: payload.remote === true });
        this.emit(channel === 'jump' ? 'jump' : 'duckStart', payload);
        return true;
    }

    /**
     * Una fuente suelta. Solo cuenta si estaba pulsando.
     *
     * @param {string} source
     * @param {Press} [payload]
     * @returns {boolean}  false si esa fuente no estaba pulsando.
     */
    release(source, payload = now()) {
        const held = this._held.get(source);
        if (held === undefined) return false;
        this._held.delete(source);
        this.emit(held.channel === 'jump' ? 'jumpEnd' : 'duckEnd', payload);
        return true;
    }

    /**
     * Una pulsación que llega entera, sin su "soltar" (un clic): se suelta sola.
     *
     * @param {'jump' | 'duck'} channel
     * @param {Press} [payload]
     */
    tap(channel, payload = now()) {
        const source = `tap:${++this._taps}`;
        this.press(source, channel, payload);
        setTimeout(() => this.release(source), TAP_MS);
    }

    /**
     * Cablea los listeners DOM. Idempotente — segunda llamada es no-op para
     * evitar duplicar listeners si el caller despista.
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
                this.press(`key:${ev.code}`, KEYS_JUMP.has(ev.code) ? 'jump' : 'duck', stamp(ev));
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
            this.release(`key:${ev.code}`, stamp(ev));
        };
        window.addEventListener('keydown', this._keyDown);
        window.addEventListener('keyup', this._keyUp);

        // Sin foco no llegan los `keyup` ni los `touchend`: se suelta ahora lo que
        // estuviera pulsado en este equipo. Lo del portal de Vout no: su "soltar"
        // llega por mensaje, con foco o sin él.
        this._releaseLocal = () => {
            const at = now();
            for (const [source, held] of [...this._held]) {
                if (!held.remote) this.release(source, at);
            }
        };
        this._onHidden = () => { if (document.hidden) this._releaseLocal(); };
        window.addEventListener('blur', this._releaseLocal);
        document.addEventListener('visibilitychange', this._onHidden);

        this._touchStart = (ev) => {
            // Solo los toques del juego. Anular cualquier otro dejaría sin clic al
            // botón que hay debajo y sin gesto al navegador (tirar para recargar).
            if (!takesTouch(ev.target, this.has('jump'), document.querySelector('dialog[open]') !== null)) return;
            ev.preventDefault();
            const half = window.innerWidth / 2;
            for (const t of ev.changedTouches) {
                this.press(`touch:${t.identifier}`, t.clientX < half ? 'jump' : 'duck', stamp(ev));
            }
        };
        this._touchEnd = (ev) => {
            for (const t of ev.changedTouches) this.release(`touch:${t.identifier}`, stamp(ev));
        };
        // passive:false porque hacemos preventDefault. En móviles el navegador
        // queja si lo dejas passive y luego cancelas el evento.
        document.body.addEventListener('touchstart', this._touchStart, { passive: false });
        document.body.addEventListener('touchend', this._touchEnd);
        document.body.addEventListener('touchcancel', this._touchEnd);
    }

    /** Despide listeners. La GameSession llama esto en `stop()`. */
    dispose() {
        if (!this._mounted) return;
        if (this._keyDown) window.removeEventListener('keydown', this._keyDown);
        if (this._keyUp) window.removeEventListener('keyup', this._keyUp);
        if (this._releaseLocal) window.removeEventListener('blur', this._releaseLocal);
        if (this._onHidden) document.removeEventListener('visibilitychange', this._onHidden);
        if (this._touchStart) document.body.removeEventListener('touchstart', this._touchStart);
        if (this._touchEnd) {
            document.body.removeEventListener('touchend', this._touchEnd);
            document.body.removeEventListener('touchcancel', this._touchEnd);
        }
        this._handlers.clear();
        this._held.clear();
        this._releaseLocal = null;
        this._onHidden = null;
        this._keyDown = null;
        this._keyUp = null;
        this._touchStart = null;
        this._touchEnd = null;
        this._mounted = false;
    }
}

/**
 * Payload de una emisión: el instante real del evento. El de una tecla creada por
 * el mando del portal es el de su gesto.
 *
 * `Event.timeStamp` usa el mismo reloj que `performance.now()` en todos los
 * navegadores actuales. Si faltara, el instante de procesado es la alternativa.
 *
 * @returns {Press}
 */
function stamp(ev) {
    const remote = REMOTE_EVENTS.get(ev);
    if (remote !== undefined) return { timeStamp: remote, remote: true };
    return { timeStamp: Number.isFinite(ev.timeStamp) && ev.timeStamp > 0 ? ev.timeStamp : performance.now() };
}

function now() {
    return { timeStamp: performance.now() };
}

/** Instancia compartida. Daino es single-page, una sola sesión activa a la vez. */
export const Input = new InputHub();
