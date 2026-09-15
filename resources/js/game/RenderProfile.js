// Presupuestos de render por estado de la app (Ola 1).
//
// El problema que resuelve
// ------------------------
// Daino comparte UNA escena entre el menú y la partida, y eso es deliberado:
// mantiene la continuidad (el dino ambiente trota en el mismo punto donde
// aparece el Dino real, el suelo no da un salto) y evita reconstruir el scene
// graph en cada transición. Lo que faltaba no era separar escenas, sino
// reconocer que el menú no necesita lo mismo que una partida.
//
// Hasta la Ola 1 todo corría siempre al máximo:
//   - El shader de fondo es un pase de fragment sobre CADA píxel, con 6-8
//     transcendentales por píxel, a `devicePixelRatio` completo y 60 fps.
//     En una pantalla 2× son 4× los píxeles del viewport CSS — pagados igual
//     en un menú donde no se mira el detalle fino.
//   - Las 80 motas ambientales hacían un `Math.sin` cada una y resubían el
//     buffer entero a GPU cada frame, para un movimiento de 8-26 px/s.
//   - Con un modal abierto, el juego seguía renderizándose detrás a 60 fps.
//
// El modelo
// ---------
// Una tabla declarativa estado → presupuesto. `engine.setRenderProfile(name)`
// la aplica; `AppController.setState()` la invoca en el mismo punto de
// conmutación que ya usa para el dino ambiente. Añadir un estado nuevo es
// añadir una fila, no tocar el bucle de render.
//
// Sobre `filterResolution`: es la palanca de mayor impacto individual. Un
// filtro full-screen escala con el número de píxeles, así que bajar de 1.0 a
// 0.6 recorta ~64% del trabajo de fragment. Se nota poquísimo en una escena
// de degradados suaves como esta, y nada en un menú.

/**
 * @typedef {Object} RenderBudget
 * @property {number} maxFPS            0 = sin límite (usa el rAF nativo).
 * @property {number} filterResolution  Multiplicador sobre la resolución de la app.
 * @property {number} particleRatio     Fracción del pool de motas que se anima [0,1].
 * @property {boolean} sceneryAnimated  Si el scenery avanza este frame.
 */

/**
 * @typedef {'MENU'|'LOADING'|'PLAYING'|'PAUSED'|'RESULTS'|'GAME_OVER'} ProfileName
 */

/**
 * Presupuesto por estado. Los nombres coinciden con `STATE` de AppController
 * a propósito: así el mapeo es directo y no hace falta una tabla de traducción
 * que se pueda desincronizar.
 *
 * @type {Record<ProfileName, RenderBudget>}
 */
export const RENDER_PROFILES = Object.freeze({
    // Pantalla de reposo. 30 fps es de sobra para nubes que se mueven a 60 px/s
    // y un dino trotando a 3.3 fotogramas por segundo de animación.
    MENU: Object.freeze({
        maxFPS: 30,
        filterResolution: 0.6,
        particleRatio: 0.3,
        sceneryAnimated: true,
    }),

    // Durante el análisis el ticker está PARADO del todo (setRenderPaused).
    // La fila existe igualmente para que el mapeo sea total y para que, si
    // algún día se deja render durante la carga, el presupuesto ya esté dicho.
    LOADING: Object.freeze({
        maxFPS: 15,
        filterResolution: 0.5,
        particleRatio: 0,
        sceneryAnimated: false,
    }),

    // Lo único que se juega. Aquí no se escatima: 60 fps y el shader a
    // resolución plena (con el techo de dpr que aplica el engine).
    PLAYING: Object.freeze({
        maxFPS: 0,
        filterResolution: 1,
        particleRatio: 1,
        sceneryAnimated: true,
    }),

    // Congelado tras un modal. Se sigue pintando para que el fondo no sea un
    // rectángulo muerto, pero a coste casi nulo.
    PAUSED: Object.freeze({
        maxFPS: 15,
        filterResolution: 0.5,
        particleRatio: 0.3,
        sceneryAnimated: false,
    }),

    // Panel de resultados sobre la escena (reintentos, Sep 2026): el choque se
    // queda quieto y, tras una victoria, el Dino trota. Detrás de un panel con
    // desenfoque no hace falta más que el menú.
    RESULTS: Object.freeze({
        maxFPS: 30,
        filterResolution: 0.6,
        particleRatio: 0.3,
        sceneryAnimated: true,
    }),

    // Transición de salida (a otra partida o al menú): dura un fundido.
    GAME_OVER: Object.freeze({
        maxFPS: 30,
        filterResolution: 0.75,
        particleRatio: 0.5,
        sceneryAnimated: true,
    }),
});

/**
 * Niveles de calidad que el usuario puede forzar desde AJUSTES. Multiplican
 * el presupuesto del estado, así que la relación entre estados se mantiene:
 * "Baja" sigue dando más a PLAYING que a MENU.
 *
 * @type {Record<string, { label: string, resolutionScale: number, particleScale: number, fpsCap: number }>}
 */
export const QUALITY_TIERS = Object.freeze({
    high:   Object.freeze({ label: 'Alta',  resolutionScale: 1,    particleScale: 1,   fpsCap: 0 }),
    medium: Object.freeze({ label: 'Media', resolutionScale: 0.7,  particleScale: 0.6, fpsCap: 60 }),
    low:    Object.freeze({ label: 'Baja',  resolutionScale: 0.45, particleScale: 0.25, fpsCap: 30 }),
});

/** Orden de degradación del tier adaptativo, de mejor a peor. */
export const TIER_ORDER = Object.freeze(['high', 'medium', 'low']);

/**
 * Techo de resolución del filtro en píxeles de dispositivo.
 *
 * `devicePixelRatio` llega a 3 en móviles y a 2 en portátiles Retina. Un pase
 * full-screen a 3× cuesta 9 veces lo que a 1×, y la diferencia visible en un
 * fondo de degradados es nula. 1.5 es el punto donde deja de notarse.
 */
export const MAX_FILTER_DPR = 1.5;

/**
 * Combina el presupuesto de un estado con el tier de calidad activo.
 *
 * @param {ProfileName} name
 * @param {string} tier  Clave de {@link QUALITY_TIERS}.
 * @returns {RenderBudget}
 */
export function resolveBudget(name, tier = 'high') {
    const base = RENDER_PROFILES[name] ?? RENDER_PROFILES.MENU;
    const q = QUALITY_TIERS[tier] ?? QUALITY_TIERS.high;

    // Un tope de fps de 0 significa "sin tope", así que combinarlos no es un
    // `Math.min` directo: hay que tratar el 0 como infinito.
    const caps = [base.maxFPS, q.fpsCap].filter((v) => v > 0);

    return {
        maxFPS: caps.length > 0 ? Math.min(...caps) : 0,
        filterResolution: base.filterResolution * q.resolutionScale,
        particleRatio: base.particleRatio * q.particleScale,
        sceneryAnimated: base.sceneryAnimated,
    };
}
