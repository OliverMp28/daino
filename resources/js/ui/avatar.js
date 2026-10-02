// Helpers compartidos para renderizar avatares de usuarios.
//
// Se separa porque el chip (auth.js) y el modal de perfil (modals.js) ambos
// pintan avatares con la misma forma — antes vivían duplicados. Cualquier
// otro punto de UI que muestre un user (rankings, comments, niveles públicos
// del Bloque 7+) reusará estos helpers.
//
// Por qué `resolveAvatarUrl`: el `avatar_url` que devuelve Vout es un path
// relativo a SU dominio (`/storage/avatars/X.png`). Si lo metemos crudo en
// `<img src>` el navegador lo resuelve contra el origin de Daino, dando 404.
// Aquí prefijeamos con `<meta name="daino:vout-origin">` cuando detectamos
// que el path es relativo.

import { pixelText } from './pixel/text.js';

const META_VOUT_ORIGIN = 'daino:vout-origin';

let cachedVoutOrigin = undefined;

function readVoutOrigin() {
    if (cachedVoutOrigin !== undefined) return cachedVoutOrigin;
    const meta = document.querySelector(`meta[name="${META_VOUT_ORIGIN}"]`);
    const value = meta?.getAttribute('content');
    if (typeof value === 'string' && value !== '' && value !== '*') {
        try {
            cachedVoutOrigin = new URL(value).origin;
        } catch {
            cachedVoutOrigin = null;
        }
    } else {
        cachedVoutOrigin = null;
    }
    return cachedVoutOrigin;
}

/**
 * Convierte un `avatar_url` recibido de la API en una URL cargable.
 *  - null/undefined → null
 *  - http(s)://… absoluta → tal cual
 *  - /path relativo → prefijado con el origin de Vout (si está configurado)
 *  - Cualquier otra cosa (data URL, blob, etc.) → tal cual
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function resolveAvatarUrl(url) {
    if (url === null || url === undefined || url === '') return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) {
        const origin = readVoutOrigin();
        if (origin === null) return null;   // sin origin no podemos resolver
        return origin + url;
    }
    return url;
}

/**
 * Avatar cuadrado, con las esquinas en escalón como el resto de la interfaz
 * (`.daino-avatar`, components.css), y la inicial del nombre en la letra del juego
 * si no hay imagen o no carga. El elemento devuelto es ya un `<span>` o `<div>`
 * listo para añadir al DOM — el caller decide el contenedor padre.
 *
 * @param {string | null | undefined} rawUrl
 * @param {string} username
 * @param {number} size  Lado, en px a 16 px de rem: crece con la interfaz.
 * @param {{ tag?: 'span' | 'div' }} [opts]
 * @returns {HTMLElement}
 */
export function renderAvatar(rawUrl, username, size, opts = {}) {
    const tag = opts.tag === 'div' ? 'div' : 'span';
    const wrap = document.createElement(tag);
    wrap.className = 'daino-avatar';
    wrap.style.setProperty('--avatar', `${size / 16}rem`);
    if (size >= 48) wrap.style.setProperty('--cell', 'var(--u4)');

    const initial = (username && username[0]) ? username[0].toUpperCase() : '?';
    const letter = pixelText(initial);
    letter.setAttribute('aria-hidden', 'true');
    wrap.appendChild(letter);

    const url = resolveAvatarUrl(rawUrl);
    if (url !== null) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.addEventListener('load', () => {
            wrap.replaceChildren(img);
        });
        // En 'error' dejamos el fallback (ya está pintado) — no hacemos nada
        // explícito. Esto cubre tanto 404 como CORS o assets bloqueados.
    }
    return wrap;
}
