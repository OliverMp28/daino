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
//   Un clic (VOUT_CLICK)      Cae donde apunta el cursor (VOUT_CURSOR, la cabeza).
//                             Jugando, sobre el lienzo: mitad izquierda salta y
//                             mitad derecha agacha, como el táctil. Sobre la
//                             interfaz: pulsa lo que haya debajo.
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
//   - Las pulsaciones llevan la hora del gesto (`timeStamp`, de `at`) y van
//     marcadas `remote` (game/systems/input.js: corriendo son un toque).
//   - Cada función devuelve en una línea lo que hizo: lo enseña la depuración
//     (`?voutdebug=1`).

import { Input, markRemote, takesTouch } from '../game/systems/input.js';
import * as focusNav from '../ui/focusNav.js';
import { showToast } from '../ui/toast.js';
import { setPortalInput } from './bridge.js';

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

    function onClick({ button, timeStamp }) {
        if (button !== 'left') return 'ignorado: Daino no usa el clic derecho';
        const payload = { timeStamp, remote: true };
        if (cursor === null) {
            // Sin cursor el clic no tiene sitio: es "el botón".
            if (!playing()) return press();
            Input.tap('jump', payload);
            return 'clic sin cursor: salto';
        }
        const x = cursor.x * window.innerWidth;
        const y = cursor.y * window.innerHeight;
        const target = document.elementFromPoint(x, y);
        if (takesTouch(target, Input.has('jump'), dialogOpen())) {
            const jump = x < window.innerWidth / 2;
            Input.tap(jump ? 'jump' : 'duck', payload);
            return jump ? 'clic en la mitad izquierda: salto' : 'clic en la mitad derecha: agacharse';
        }
        const control = nav.clickAt(target, x, y);
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
            return channel === 'jump' ? 'salto' : 'agacharse';
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
                case 'click': return onClick(input);
                case 'cursor': return onCursor(input);
                case 'action': return onAction(input);
                default: return null;
            }
        },
    };
}

/** Pone el mando a atender lo que llega del portal. */
export function startRemote() {
    const remote = createRemote();
    setPortalInput(remote.handle);
    return remote;
}
