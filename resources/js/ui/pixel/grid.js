// La rejilla de la interfaz (T04, doc 12): sus medidas, en píxeles ENTEROS de pantalla.
//
// La letra, los marcos y las portadas están hechos de celdas, y una celda que mide
// 2,6 píxeles de pantalla se pinta unas veces de 2 y otras de 3: columnas desiguales,
// el defecto que delata un pixel art mal escalado. La UI crece con la pantalla (el
// rem es fluido, main.css) y el zoom del navegador o un portátil al 125 % dan
// píxeles de pantalla que no coinciden con los de CSS, así que el CSS solo no puede
// garantizarlo.
//
// Aquí se calculan las unidades `--u1`, `--u2`… (`--uN` ≈ N/16 de rem) redondeadas a
// píxeles de pantalla enteros, y se vuelven a calcular cuando cambia el tamaño de la
// ventana o el zoom. Sin este módulo la interfaz se ve igual, con las unidades en rem
// (tokens.css): solo pierde la nitidez exacta.
//
// El mundo del juego hace lo mismo por su lado (systems/worldView.js).

/** Las unidades que existen. Si hace falta otra, se añade aquí y en tokens.css. */
export const GRID_UNITS = Object.freeze([1, 2, 3, 4, 5, 6, 8, 10, 12, 16]);

/** Por debajo de esta parte de su tamaño de diseño, una unidad sube un píxel de pantalla. */
const MIN_SCALE = 0.88;

/**
 * Tamaño en px de CSS de la unidad `n` para un rem y una densidad de pantalla: un
 * número entero de píxeles de pantalla, nunca cero, y nunca mucho más pequeño que
 * su diseño (al 125 %, una celda de 1 px de pantalla mediría 0,8 px de CSS y la
 * letra pequeña no se leería: sube a 2).
 *
 * @param {number} n
 * @param {number} remPx  Tamaño del rem, en px de CSS.
 * @param {number} dpr    Píxeles de pantalla por px de CSS.
 */
export function snapUnit(n, remPx, dpr) {
    const design = (n * remPx) / 16;
    let device = Math.max(1, Math.round(design * dpr));
    if (device / dpr < design * MIN_SCALE) device += 1;
    return device / dpr;
}

let started = false;

/** Recalcula las unidades y las deja en `<html>`. */
export function syncPixelGrid() {
    const root = document.documentElement;
    const remPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
    const dpr = window.devicePixelRatio || 1;
    for (const n of GRID_UNITS) root.style.setProperty(`--u${n}`, `${snapUnit(n, remPx, dpr).toFixed(4)}px`);
}

/** Arranca la rejilla: ahora y cada vez que cambie la ventana o el zoom. Idempotente. */
export function startPixelGrid() {
    if (started) return;
    started = true;
    syncPixelGrid();
    window.addEventListener('resize', syncPixelGrid);
    window.addEventListener('orientationchange', syncPixelGrid);
    // El zoom o mover la ventana a otro monitor cambian la densidad sin `resize`.
    const watchDensity = () => {
        matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
            syncPixelGrid();
            watchDensity();
        }, { once: true });
    };
    if (typeof matchMedia === 'function') watchDensity();
}
