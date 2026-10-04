// resources/js/iframe/soundGate.js
//
// Dentro del portal de Vout, la música puede no arrancar: el navegador solo deja
// sonar a una página que ha tenido un gesto DE VERDAD (un clic, una tecla, un
// toque). El portal le cede el suyo al juego (`allow="autoplay"`), y casi siempre
// lo tiene: se llega al juego con un clic y la cámara se activa con otro. Pero no
// si alguien abre `/play/daino` por su dirección o recarga y sigue jugando solo
// con gestos: los clics que hace un gesto no cuentan.
//
// Sin música no hay partida (su reloj es el de la canción): el juego se quedaría
// quieto sin decir por qué. Aquí se vigila eso: si se está jugando y el audio
// sigue parado sin que nadie lo haya pausado, se dice qué hace falta, y se vuelve
// a intentar hasta que el navegador deja (un clic en cualquier parte de la página
// del portal basta; no hace falta que caiga en el juego).
//
// Solo se carga dentro del portal (main.js): por su cuenta, a Daino se entra
// siempre con un clic de verdad.

import { getAudioEngine } from '../game/audio/sharedEngine.js';

const CHECK_MS = 500;
/** Comprobaciones seguidas con el audio parado antes de avisar: al empezar tarda un momento. */
const CHECKS_BEFORE_NOTICE = 2;

const NOTICE = 'La música no puede empezar todavía: el navegador pide un clic de verdad en la página (con el ratón o tocando la pantalla; un gesto no le vale). Haz clic en cualquier parte.';

export function startSoundGate() {
    const audio = getAudioEngine();
    let stuck = 0;
    let notice = null;

    const hide = () => {
        notice?.remove();
        notice = null;
    };
    const show = () => {
        if (notice !== null) return;
        notice = document.createElement('div');
        notice.className = 'daino-toast daino-cut';
        notice.dataset.severity = 'info';
        notice.setAttribute('role', 'alert');
        notice.textContent = NOTICE;
        if (typeof notice.showPopover === 'function') notice.popover = 'manual';
        document.body.appendChild(notice);
        try { notice.showPopover?.(); } catch { /* sin capa de arriba: se queda en la página */ }
    };

    const check = () => {
        const playing = document.body.dataset.appState === 'PLAYING';
        if (!playing || !audio.blocked) {
            stuck = 0;
            hide();
            return;
        }
        // Parado sin que nadie lo pidiera: se vuelve a intentar (si la página del
        // portal ya ha tenido su clic, ahora arranca) y, si sigue así, se avisa.
        audio.retry();
        if (++stuck >= CHECKS_BEFORE_NOTICE) show();
    };
    setInterval(check, CHECK_MS);

    // Un gesto de verdad dentro del juego lo arregla al momento.
    const onRealInput = (ev) => {
        if (ev.isTrusted && audio.blocked) audio.retry();
    };
    for (const type of ['pointerdown', 'keydown', 'touchend']) {
        window.addEventListener(type, onRealInput, { capture: true, passive: true });
    }
}
