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

import { getUser } from '../api/client.js';
import { isBridgeEmbedded } from '../iframe/bridge.js';
import { openProfileModal } from './modals.js';
import { renderAvatar } from './avatar.js';
import { linkButton } from './kit.js';

let chipEl = null;
let onLogin = null;
let onLogout = null;

export function mount(container) {
    if (chipEl !== null) return chipEl;
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

export function dispose() {
    if (onLogin) window.removeEventListener('daino:auth:login', onLogin);
    if (onLogout) window.removeEventListener('daino:auth:logout', onLogout);
    onLogin = null;
    onLogout = null;
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
