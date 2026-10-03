// Orientación en móviles (tamaños de pantalla, Sep 2026).
//
// Daino se juega en horizontal: en un móvil vertical la vista del mundo
// (systems/worldView.js) conserva el trecho que se lee por delante del Dino,
// pero el mundo sale diminuto al pie de un cielo enorme. Antes de empezar se
// sugiere girar el móvil; quien quiera puede jugar en vertical igualmente, y
// la decisión se recuerda hasta recargar.
//
// El aviso no se queda en pedirlo (Oct 2026): donde el navegador lo permite,
// "Poner en horizontal" lo hace él (pantalla completa + orientación, ui/screenLock.js),
// también con el giro del teléfono bloqueado. Donde no, se explica cómo girarlo a
// mano: quien tenía el giro bloqueado lo giraba, no pasaba nada y no sabía por qué.

import { button } from './kit.js';
import { pixelText } from './pixel/text.js';
import { canLockLandscape, lockLandscape, ROTATE_BY_HAND } from './screenLock.js';

let allowPortrait = false;

/** Lo que se espera a que la pantalla gire tras fijar la orientación. */
const LOCK_SETTLE_MS = 1500;

/** Pantalla táctil en vertical (ratón o teclado en una ventana estrecha no cuentan). */
export function isTouchPortrait() {
    if (typeof matchMedia !== 'function') return false;
    return matchMedia('(pointer: coarse)').matches && window.innerHeight > window.innerWidth;
}

/** ¿Toca sugerir girar el móvil? */
export function shouldSuggestRotation() {
    return !allowPortrait && isTouchPortrait();
}

/**
 * Muestra "Gira el móvil" y espera. Resuelve:
 *   'landscape' al girarlo,
 *   'portrait'  si elige jugar en vertical (se recuerda),
 *   'cancel'    si prefiere no jugar ahora.
 *
 * @returns {Promise<'landscape' | 'portrait' | 'cancel'>}
 */
export function waitForLandscape() {
    const root = document.getElementById('modal-root') ?? document.body;
    const dialog = document.createElement('dialog');
    dialog.className = 'daino-rotate';
    dialog.setAttribute('aria-labelledby', 'daino-rotate-title');

    const icon = document.createElement('div');
    icon.className = 'daino-rotate__phone';
    icon.setAttribute('aria-hidden', 'true');
    const title = pixelText('Gira el móvil', { tag: 'h2' });
    title.id = 'daino-rotate-title';
    const text = document.createElement('p');
    text.textContent = 'Daino se juega en horizontal: verás venir cada obstáculo con tiempo.';
    // Cómo girarlo a mano: a la vista desde el principio si el navegador no puede
    // hacerlo él, o cuando lo intenta y no le dejan.
    const byHand = document.createElement('p');
    byHand.className = 'daino-rotate__help';
    byHand.textContent = ROTATE_BY_HAND;
    const actions = document.createElement('div');
    actions.className = 'daino-rotate__actions';
    const lock = canLockLandscape() ? button('Poner en horizontal', 'daino-btn daino-btn--primary') : null;
    byHand.hidden = lock !== null;
    const portrait = button('Jugar en vertical', 'daino-btn');
    const cancel = button('Ahora no', 'daino-btn daino-btn--ghost daino-rotate__cancel');
    if (lock !== null) actions.appendChild(lock);
    actions.append(portrait, cancel);
    const card = document.createElement('div');
    card.className = 'daino-panel daino-rotate__card';
    card.append(icon, title, text, byHand, actions);
    dialog.appendChild(card);
    root.appendChild(dialog);

    return new Promise((resolve) => {
        const landscape = matchMedia('(orientation: landscape)');
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            landscape.removeEventListener('change', onChange);
            window.removeEventListener('resize', onChange);
            if (dialog.open) dialog.close();
            dialog.remove();
            resolve(result);
        };
        const onChange = () => {
            if (!isTouchPortrait()) finish('landscape');
        };
        landscape.addEventListener('change', onChange);
        window.addEventListener('resize', onChange);
        lock?.addEventListener('click', async () => {
            lock.disabled = true;
            const result = await lockLandscape();
            if (!dialog.isConnected) return;   // ya giró (o se cerró) mientras tanto
            // No le dejaron (o dijo que sí y la pantalla no giró): fuera el botón
            // que no sirve y, en su sitio, cómo hacerlo a mano.
            const giveUp = () => {
                if (!dialog.isConnected) return;
                lock.remove();
                byHand.hidden = false;
                portrait.focus({ preventScroll: true });
            };
            if (result !== 'locked') {
                giveUp();
                return;
            }
            // La pantalla gira sola en un momento y `onChange` cierra el aviso; por
            // si el aviso del giro no llega, se mira ahora y un poco después.
            onChange();
            window.setTimeout(() => {
                if (!dialog.isConnected) return;
                onChange();
                giveUp();
            }, LOCK_SETTLE_MS);
        });
        portrait.addEventListener('click', () => {
            allowPortrait = true;
            finish('portrait');
        });
        cancel.addEventListener('click', () => finish('cancel'));
        dialog.addEventListener('cancel', (ev) => {
            ev.preventDefault();
            finish('cancel');
        });
        // Cerrado desde fuera (se fue atrás mientras cargaba): no se queda esperando.
        dialog.addEventListener('close', () => finish('cancel'));
        dialog.showModal();
        (lock ?? portrait).focus({ preventScroll: true });
    });
}
