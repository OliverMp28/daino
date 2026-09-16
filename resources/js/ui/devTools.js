// Panel flotante de herramientas de desarrollo — SOLO en `import.meta.env.DEV`.
//
// `main.js` monta esto únicamente en `bun run dev`; `bun run build` (producción)
// nunca lo importa (ver el `if` en main.js), así que no pesa nada en el bundle
// real ni aparece para un jugador.
//
// De momento un único interruptor, pensado para poder pasarse un nivel entero
// probando el charter, el reparto de modos o el vuelo sin que la primera
// colisión corte la partida:
//
//   Sin colisiones — un choque se sigue detectando (el destello y el resto del
//   feedback "en el golpe" siguen vivos) pero no termina el run.
//
// El estado vive en `window.__daino.godMode`, que `GameSession._physicsStep`
// lee en vivo cada paso de física. Así el panel no necesita conocer la sesión
// activa ni engancharse a AppController: activarlo funciona a mitad de partida,
// y el valor sobrevive a un reintento o a cambiar de nivel sin volver a tocarlo.
//
// Flotante en la esquina, colapsado por defecto (un botón redondo) para no
// estorbar la vista del juego ni la UI real; z-index por debajo de un `<dialog>`
// (que de todas formas manda por encima de cualquier z-index, top layer) pero
// por encima del HUD, así siempre es alcanzable durante una partida.

const PANEL_ID = 'daino-devtools';

/** Monta el panel una sola vez (llamadas repetidas son no-op). */
export function mountDevTools() {
    if (typeof document === 'undefined' || document.getElementById(PANEL_ID) !== null) return;

    if (typeof window !== 'undefined') {
        window.__daino = window.__daino ?? {};
        window.__daino.godMode = window.__daino.godMode ?? false;
    }

    const root = document.createElement('div');
    root.id = PANEL_ID;
    root.className = 'daino-devtools';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'daino-devtools__handle';
    handle.textContent = '🛠';
    handle.title = 'Herramientas de desarrollo';
    handle.setAttribute('aria-label', 'Herramientas de desarrollo');
    handle.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('div');
    panel.className = 'daino-devtools__panel';
    panel.hidden = true;

    const heading = document.createElement('p');
    heading.className = 'daino-devtools__heading';
    heading.textContent = 'DEV';
    panel.appendChild(heading);

    const row = document.createElement('label');
    row.className = 'daino-devtools__row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = window.__daino.godMode === true;
    check.addEventListener('change', () => {
        window.__daino.godMode = check.checked;
        root.dataset.godmode = check.checked ? 'on' : 'off';
    });
    row.append(check, document.createTextNode(' Sin colisiones'));
    panel.appendChild(row);

    handle.addEventListener('click', () => {
        const opening = panel.hidden;
        panel.hidden = !opening;
        handle.setAttribute('aria-expanded', String(opening));
    });

    root.dataset.godmode = check.checked ? 'on' : 'off';
    root.append(handle, panel);
    document.body.appendChild(root);
}
