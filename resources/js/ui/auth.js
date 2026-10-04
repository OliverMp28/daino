// Chip de identidad arriba-derecha. Refleja sesión Vout.
//
// Doc 06 §4.1: "Esquina superior derecha: avatar + username (clic →
// perfil/logout)". §7: "El HUD de usuario (avatar/username) se oculta en
// iframe — Vout ya muestra ese dato en su propio chrome".
//
// API:
//   - mount(container)  Crea el chip dentro de `container` (típicamente el
//                       header del menú o un anchor en HUD). Idempotente.
//   - dispose()         Quita el chip + listeners.
//
// El render reacciona a eventos `daino:auth:login` / `daino:auth:logout`
// (dispatcheados por client.js). No suscribe a onAuthChange porque queremos
// que cualquier punto del UI pueda escuchar el mismo canal.

import { getUser, takeSessionLost } from '../api/client.js';
import { isBridgeEmbedded } from '../iframe/bridge.js';
import { openProfileModal } from './modals.js';
import { renderAvatar } from './avatar.js';
import { linkButton } from './kit.js';
import { showToast } from './toast.js';

let chipEl = null;
let onLogin = null;
let onLogout = null;
let onExpired = null;

export function mount(container) {
    if (chipEl !== null) return chipEl;

    // La sesión puede acabarse sin que nadie la cierre (30 días sin entrar, o
    // acceso retirado desde Vout). Se dice, también dentro del portal: quedarse
    // sin sesión sin más parece un fallo. Puede haber ocurrido al arrancar,
    // antes de montar esto.
    if (onExpired === null) {
        onExpired = () => announceSessionLost();
        window.addEventListener('daino:auth:expired', onExpired);
        announceSessionLost();
    }

    if (isBridgeEmbedded()) {
        // Modo iframe: NO renderizamos chip. Vout ya lo muestra.
        return null;
    }

    chipEl = document.createElement('div');
    chipEl.className = 'daino-auth-chip';
    container.appendChild(chipEl);
    render();

    onLogin = () => render();
    onLogout = () => render();
    window.addEventListener('daino:auth:login', onLogin);
    window.addEventListener('daino:auth:logout', onLogout);

    return chipEl;
}

function announceSessionLost() {
    if (!takeSessionLost()) return;
    // Dentro del portal no hay "Iniciar sesión" que ofrecer: la sesión es la de Vout.
    showToast(isBridgeEmbedded()
        ? 'Tu sesión de Vout ha terminado. Tus marcas ya no se guardan.'
        : 'Tu sesión ha caducado. Inicia sesión otra vez para guardar tus marcas.', 'info', 6000);
}

export function dispose() {
    if (onLogin) window.removeEventListener('daino:auth:login', onLogin);
    if (onLogout) window.removeEventListener('daino:auth:logout', onLogout);
    if (onExpired) window.removeEventListener('daino:auth:expired', onExpired);
    onLogin = null;
    onLogout = null;
    onExpired = null;
    if (chipEl !== null) {
        chipEl.remove();
        chipEl = null;
    }
}

function render() {
    if (chipEl === null) return;
    chipEl.innerHTML = '';
    const user = getUser();

    if (user === null) {
        // Anónimo — botón LOGIN. Es navegación a /auth/login, así que <a>.
        // Discreto: el único bloque rosa del menú es JUGAR.
        chipEl.appendChild(linkButton('Iniciar sesión', '/auth/login', 'daino-btn daino-btn--sm'));
        return;
    }

    // Logueado — avatar + username, click abre PERFIL.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'daino-btn daino-btn--sm daino-auth-chip__button';
    button.dataset.interactive = 'true';
    button.setAttribute('aria-label', `Perfil de ${user.username}`);

    const avatar = renderAvatar(user.avatar_url, user.username, 24);
    const username = document.createElement('span');
    username.className = 'daino-auth-chip__name';
    username.textContent = user.username;

    button.appendChild(avatar);
    button.appendChild(username);
    button.addEventListener('click', () => openProfileModal());

    chipEl.appendChild(button);
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        dispose();
    });
}
