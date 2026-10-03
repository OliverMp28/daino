// Lectura y herramientas de rendimiento en pantalla (T05.4): solo se carga con
// `?perf=1` (main.js), también en el build de producción. En un móvil no hay
// consola ni panel de desarrollo a mano, y esto es lo que quien prueba necesita:
//
//   - Una línea en la esquina con lo que mide el engine (`engine.getPerf()`).
//   - Un botón (🛠, abajo a la izquierda) que abre un panel táctil con "Sin
//     colisiones" (para medir un nivel entero sin tener que esquivar nada) y con
//     los selectores de Calidad, Cielo y Ritmo del cielo (ui/devPerfPanel.js).
//
// "Sin colisiones" es `window.__daino.godMode`, que `GameSession._physicsStep`
// lee en vivo: un choque se detecta (destello y demás) pero no termina el nivel.
// No toca nada más del juego, y sin `?perf=1` nada de esto se descarga.

import { perfLine } from './perfModel.js';
import { mountPerfPanel } from './devPerfPanel.js';

const ID = 'daino-perf';
const TOOLS_ID = 'daino-perf-tools';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function mountTools() {
    if (document.getElementById(TOOLS_ID) !== null) return;
    window.__daino = window.__daino ?? {};
    window.__daino.godMode = window.__daino.godMode ?? false;

    const root = el('div', 'daino-devtools');
    root.id = TOOLS_ID;

    const handle = el('button', 'daino-devtools__handle', '🛠');
    handle.type = 'button';
    handle.title = 'Herramientas de rendimiento';
    handle.setAttribute('aria-label', 'Herramientas de rendimiento');
    handle.setAttribute('aria-expanded', 'false');

    const panel = el('div', 'daino-devtools__panel');
    panel.hidden = true;
    panel.appendChild(el('p', 'daino-devtools__heading', 'PRUEBA'));

    const row = el('label', 'daino-devtools__row');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = window.__daino.godMode === true;
    check.addEventListener('change', () => {
        window.__daino.godMode = check.checked;
        root.dataset.godmode = check.checked ? 'on' : 'off';
    });
    row.append(check, document.createTextNode(' Sin colisiones'));
    panel.appendChild(row);

    const perf = mountPerfPanel(panel, { el });

    let timer = 0;
    handle.addEventListener('click', () => {
        const opening = panel.hidden;
        panel.hidden = !opening;
        handle.setAttribute('aria-expanded', String(opening));
        clearInterval(timer);
        if (opening) {
            perf.refresh();
            timer = setInterval(perf.refresh, 500);
        }
    });

    root.dataset.godmode = check.checked ? 'on' : 'off';
    root.append(handle, panel);
    document.body.appendChild(root);
}

/**
 * @param {{ getPerf: () => object }} engine
 */
export function mountPerfReadout(engine) {
    if (typeof document === 'undefined' || document.getElementById(ID) !== null) return;
    const node = el('p', 'daino-perf');
    node.id = ID;
    node.setAttribute('aria-hidden', 'true');
    document.body.appendChild(node);
    const refresh = () => { node.textContent = perfLine(engine.getPerf()); };
    refresh();
    setInterval(refresh, 500);
    mountTools();
}
