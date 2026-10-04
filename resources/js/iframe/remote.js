// resources/js/iframe/remote.js
//
// El mando del portal: qué hace en Daino cada cosa que el jugador hace con la
// cara (control facial de Vout). Solo se carga dentro del portal (main.js).
//
// El navegador no deja que el portal pulse teclas ni haga clic dentro de un iframe
// de otro origen: el portal dice qué tecla, qué clic o qué acción corresponde al
// gesto (bridge.js, que comprueba el mensaje) y es Daino quien lo hace en su
// página. Cada usuario trae SU mapeo de gestos, así que se atienden las tres
// formas en que puede llegar un gesto:
//
//   Una tecla (VOUT_KEY)      Se crea el evento de teclado en la página: el juego
//                             y los paneles lo reciben por donde reciben un
//                             teclado. Lo que el navegador hace por su cuenta con
//                             una tecla de verdad (Enter pulsa el botón con el
//                             foco, Esc cierra el diálogo, las flechas mueven) NO
//                             ocurre con un evento creado por código: se hace aquí
//                             (`defaultAction`), si nadie ha atendido la tecla.
//   Un botón del ratón        Se pulsa y se suelta donde apunta el cursor
//   (VOUT_POINTER)            (VOUT_CURSOR, la cabeza). Jugando, sobre el lienzo:
//                             mitad izquierda salta y mitad derecha agacha,
//                             mientras dure, como un dedo. Sobre la interfaz: el
//                             clic se hace al soltar, si sigue sobre lo mismo.
//   Una acción (VOUT_ACTION)  JUMP, DUCK y PAUSE (preset `runner`). Jugando son
//                             saltar, agacharse y pausar. En los menús, un mando
//                             de dos botones: agacharse pasa al siguiente y saltar
//                             lo pulsa. Sin eso, quien acepta ese preset no podría
//                             llegar a jugar.
//
// Decisiones:
//   - Con la cara se llega de la portada a jugar con cualquier mapeo: cursor y
//     clic, teclas (flechas, Enter, Espacio, Esc) o las dos acciones del preset.
//   - Lo señalado se VE (`data-pointed`, con el aspecto del foco): con un cursor
//     que mueve la cabeza hay que saber dónde va a caer el clic.
//   - Un gesto no cuenta dos veces: una acción que ya está mantenida (otro gesto
//     con el mismo nombre) no vuelve a empezar, y solo termina lo que empezó.
//   - Un gesto mantenido es una pulsación mantenida: agachado mientras dure, el
//     propulsor encendido, el salto alto (con la regla de los gestos, GESTURE_JUMP).
//   - Nada se queda pulsado: el portal suelta lo que pulsa, un final sin su
//     principio no hace nada, y si la sesión termina se suelta todo aquí.
//   - Las pulsaciones llevan la hora del gesto (`timeStamp`, de `at`) y van
//     marcadas `remote` (game/systems/input.js).
//   - Cada función devuelve en una línea lo que hizo: lo enseña la depuración
//     (`?voutdebug=1`).

import { Input, markRemote, takesTouch } from '../game/systems/input.js';
import * as focusNav from '../ui/focusNav.js';
import { showToast } from '../ui/toast.js';
import { onSessionEnd, setPortalInput } from './bridge.js';

/**
 * Las acciones de juego que Daino entiende. `event` es texto que elige el usuario
 * en Vout (puede mapear un gesto a cualquier nombre): lo demás se descarta.
 */
const ACTIONS = Object.freeze({ JUMP: 'jump', DUCK: 'duck', PAUSE: 'pause' });

/** @type {Readonly<Record<string, import('../ui/focusNav.js').Direction>>} */
const ARROWS = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' });

/** Teclas que pulsan lo señalado. */
const PRESS_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

/** El cursor tiene que moverse esto (sobre 1) para cambiar lo señalado: el pulso de la cabeza no cuenta. */
const CURSOR_MOVED = 0.004;

const POINTED = 'data-pointed';

/** La fuente de pulsaciones del botón del ratón que mantiene un gesto. */
const POINTER_SOURCE = 'pointer:left';

const SCAN_HINT = 'Con gestos: agáchate para pasar al botón siguiente y salta para pulsarlo.';

/**
 * @param {{ nav?: typeof focusNav, notify?: (message: string) => void }} [deps]
 *        Lo que toca la página, sustituible en los tests.
 */
export function createRemote({ nav = focusNav, notify = (message) => showToast(message, 'info', 7000) } = {}) {
    /** @type {{ x: number, y: number } | null}  Donde apunta la cabeza (0 a 1). null: no hay cursor. */
    let cursor = null;
    /** @type {Element | null} */
    let pointed = null;
    let pointFrame = 0;
    /** Acciones que algún gesto mantiene ahora. */
    const heldActions = new Set();
    /**
     * El botón izquierdo, mientras un gesto lo mantiene: dónde se pulsó. null: suelto.
     * @type {{ game: boolean, target?: Element | null, control?: Element | null } | null}
     */
    let pointerDown = null;
    let scanExplained = false;

    const dialogOpen = () => document.querySelector('dialog[open]') !== null;
    /** Hay una partida que atiende pulsaciones y nada encima de ella. */
    const playing = () => Input.has('jump') && !dialogOpen();

    function point(el) {
        if (pointed === el) return;
        pointed?.removeAttribute(POINTED);
        pointed = el;
        el?.setAttribute(POINTED, '');
    }

    /** Cuenta lo señalado, o por qué no se señaló nada. */
    function pointedLine(el, none) {
        if (el === null) return none;
        point(el);
        return `señala «${nav.labelOf(el)}»`;
    }

    // ----- Lo que una tecla de verdad haría sola -----

    /** Pulsa lo señalado. Sin nada señalado todavía, señala lo primero: se ve antes de pulsar. */
    function press() {
        const el = nav.current();
        if (el === null) return pointedLine(nav.first(), 'no hay nada que pulsar');
        if (!nav.pressable(el)) return `«${nav.labelOf(el)}» no se pulsa`;
        point(el);
        nav.activate(el);
        return `pulsa «${nav.labelOf(el)}»`;
    }

    function back() {
        const result = nav.dismiss();
        if (result === null) return 'no hay nada que cerrar';
        return result === 'closed' ? 'cierra el panel' : 'vuelve atrás';
    }

    function defaultAction(code, target) {
        if (PRESS_KEYS.has(code)) return press();
        if (code === 'Escape') return back();
        if (code === 'Tab') return pointedLine(nav.step(1), 'no hay nada que señalar');
        const dir = ARROWS[code];
        if (dir === undefined) return null;
        if (nav.adjust(target, dir)) return `ajusta «${nav.labelOf(target)}»`;
        return pointedLine(nav.move(dir), 'no hay nada en esa dirección');
    }

    // ----- Los tres caminos -----

    function onKey({ code, key, state, timeStamp }) {
        const down = state === 'down';
        const target = document.activeElement ?? document.body;
        const event = markRemote(new KeyboardEvent(down ? 'keydown' : 'keyup', { key, code, bubbles: true, cancelable: true }), timeStamp);
        const wasPlaying = playing();
        const unhandled = target.dispatchEvent(event);
        if (!down) return 'tecla soltada';
        if (!unhandled) return wasPlaying ? 'la atiende el juego' : 'la atiende la interfaz';
        // Jugando, una tecla que el juego no usa no hace nada (no mueve lo señalado).
        if (wasPlaying) return 'jugando, esta tecla no hace nada';
        return defaultAction(code, target) ?? 'nadie usa esta tecla aquí';
    }

    /** Dónde apunta el cursor, en píxeles de la ventana. null: todavía no hay cursor. */
    function cursorPoint() {
        return cursor === null ? null : { x: cursor.x * window.innerWidth, y: cursor.y * window.innerHeight };
    }

    function onPointer({ button, state, timeStamp }) {
        if (button !== 'left') return 'ignorado: Daino no usa el botón derecho';
        const payload = { timeStamp, remote: true };
        const at = cursorPoint();

        if (state === 'down') {
            if (pointerDown !== null) return 'el botón ya estaba pulsado: nada';
            const target = at === null ? null : document.elementFromPoint(at.x, at.y);
            // Sin cursor el botón no tiene sitio: es "el botón" (salta jugando).
            const inGame = at === null ? playing() : takesTouch(target, Input.has('jump'), dialogOpen());
            if (inGame) {
                const jump = at === null || at.x < window.innerWidth / 2;
                Input.press(POINTER_SOURCE, jump ? 'jump' : 'duck', payload);
                pointerDown = { game: true };
                if (at === null) return 'botón sin cursor: salto';
                return jump ? 'botón en la mitad izquierda: salto' : 'botón en la mitad derecha: agacharse';
            }
            // En la interfaz el clic se hace al soltar, como con un ratón.
            const control = at === null ? nav.current() : nav.controlAt(target);
            pointerDown = { game: false, target, control };
            if (control === null) return 'botón pulsado donde no hay nada que pulsar';
            point(control);
            return `botón pulsado sobre «${nav.labelOf(control)}»: el clic, al soltar`;
        }

        const down = pointerDown;
        pointerDown = null;
        if (down === null) return 'soltar sin haber pulsado: nada';
        if (down.game) {
            Input.release(POINTER_SOURCE, payload);
            return 'suelta';
        }
        if (at === null) return press();
        const target = document.elementFromPoint(at.x, at.y);
        const same = down.control !== null ? nav.controlAt(target) === down.control : target === down.target;
        if (!same) return 'clic anulado: el cursor ya no está sobre lo mismo';
        const control = nav.clickAt(target, at.x, at.y);
        return control === null ? 'clic donde no hay ningún botón' : `clic en «${nav.labelOf(control)}»`;
    }

    function onCursor({ x, y }) {
        const moved = cursor === null || Math.abs(x - cursor.x) + Math.abs(y - cursor.y) >= CURSOR_MOVED;
        if (!moved) return null;
        cursor = { x, y };
        // El cursor llega con cada imagen de la cámara: lo señalado se mira una
        // vez por fotograma como mucho.
        if (pointFrame === 0) pointFrame = requestAnimationFrame(refreshPointed);
        return null;
    }

    function refreshPointed() {
        pointFrame = 0;
        if (cursor === null) return;
        // Jugando no se señala nada: el cursor solo decide la mitad del clic.
        if (playing()) {
            point(null);
            return;
        }
        point(nav.controlAt(document.elementFromPoint(cursor.x * window.innerWidth, cursor.y * window.innerHeight)));
    }

    function onAction({ event, phase, timeStamp }) {
        const channel = ACTIONS[event];
        if (channel === undefined) return `ignorado: Daino no tiene la acción «${event}»`;
        const source = `action:${event}`;

        if (phase === 'end') {
            if (!heldActions.delete(event)) return 'fin de una acción que no había empezado: nada';
            return Input.release(source, { timeStamp, remote: true }) ? 'suelta' : 'fin del gesto';
        }
        // Dos gestos pueden mantener la misma acción (cejas y cabeza arriba): el
        // segundo no vuelve a empezarla.
        if (heldActions.has(event)) return 'ya estaba mantenida por otro gesto: nada';
        heldActions.add(event);

        if (playing()) {
            if (channel === 'pause') {
                Input.emit('pause');
                return 'pausa';
            }
            Input.press(source, channel, { timeStamp, remote: true });
            return channel === 'jump' ? 'salto (alto si el gesto sigue)' : 'agacharse (mientras dure)';
        }

        // En los menús: un mando de dos botones.
        if (!scanExplained && channel !== 'pause') {
            scanExplained = true;
            notify(SCAN_HINT);
        }
        if (channel === 'jump') return press();
        if (channel === 'duck') return pointedLine(nav.step(1), 'no hay nada que señalar');
        return back();
    }

    return {
        /**
         * @param {import('./bridge.js').PortalInput} input
         * @returns {string | null}  Qué se hizo, en una línea.
         */
        handle(input) {
            switch (input.kind) {
                case 'key': return onKey(input);
                case 'pointer': return onPointer(input);
                case 'cursor': return onCursor(input);
                case 'action': return onAction(input);
                default: return null;
            }
        },

        /**
         * Suelta todo lo que algún gesto mantiene. Para cuando los finales del
         * portal pueden no llegar (la sesión terminó): nada se queda pulsado.
         */
        releaseAll() {
            heldActions.clear();
            pointerDown = null;
            Input.releaseRemote();
        },
    };
}

/** Pone el mando a atender lo que llega del portal. */
export function startRemote() {
    const remote = createRemote();
    setPortalInput(remote.handle);
    onSessionEnd(() => remote.releaseAll());
    return remote;
}
