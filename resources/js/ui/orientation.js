// Orientación en móviles (tamaños de pantalla, Sep 2026).
//
// Daino se juega en horizontal: en un móvil vertical la vista del mundo
// (systems/worldView.js) conserva el trecho que se lee por delante del Dino,
// pero el mundo sale diminuto al pie de un cielo enorme. Antes de empezar se
// sugiere girar el móvil; quien quiera puede jugar en vertical igualmente, y
// la decisión se recuerda hasta recargar.

let allowPortrait = false;

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
    const title = document.createElement('h2');
    title.id = 'daino-rotate-title';
    title.textContent = 'Gira el móvil';
    const text = document.createElement('p');
    text.textContent = 'Daino se juega en horizontal: verás venir cada obstáculo con tiempo.';
    const actions = document.createElement('div');
    actions.className = 'daino-rotate__actions';
    const portrait = button('Jugar en vertical', 'daino-btn');
    const cancel = button('Ahora no', 'daino-btn daino-rotate__cancel');
    actions.append(portrait, cancel);
    dialog.append(icon, title, text, actions);
    root.appendChild(dialog);

    return new Promise((resolve) => {
        const landscape = matchMedia('(orientation: landscape)');
        const finish = (result) => {
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
        portrait.addEventListener('click', () => {
            allowPortrait = true;
            finish('portrait');
        });
        cancel.addEventListener('click', () => finish('cancel'));
        dialog.addEventListener('cancel', (ev) => {
            ev.preventDefault();
            finish('cancel');
        });
        dialog.showModal();
        portrait.focus({ preventScroll: true });
    });
}

function button(label, className) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.dataset.interactive = 'true';
    b.textContent = label;
    return b;
}
