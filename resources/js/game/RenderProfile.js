// Presupuestos de render por estado de la app (Ola 1; rehechos en la T05).
//
// El problema que resuelve
// ------------------------
// Daino comparte UNA escena entre el menú y la partida, y eso es deliberado:
// mantiene la continuidad (el dino ambiente trota en el mismo punto donde
// aparece el Dino real, el suelo no da un salto) y evita reconstruir el scene
// graph en cada transición. Lo que hace falta no es separar escenas, sino
// reconocer que el menú no necesita lo mismo que una partida.
//
// El modelo
// ---------
// Una tabla declarativa estado → presupuesto. `engine.setRenderProfile(name)`
// la aplica; `AppController.setState()` la invoca en el mismo punto de
// conmutación que ya usa para el dino ambiente. Añadir un estado nuevo es
// añadir una fila, no tocar el bucle de render.
//
// Qué cuesta de verdad (T05, medido con la GPU real: Intel UHD 620, 1080p)
// -------------------------------------------------------------------------
//   - El cielo (el shader del fondo, píxel a píxel): 7,5 ms de los 8 de GPU de un
//     fotograma. En 4K, 24-33 FPS; sin él, 60.
//   - TODO lo demás (capas del escenario, lluvia, nieve, mar, sprites, motas):
//     0,5 ms. Los efectos de la música, nada medible.
//
// Por eso las palancas son dos, y las dos son del cielo:
//   - `skyTexels` (del nivel de calidad): a cuántos texeles por celda del arte se
//     pinta (systems/skyGrid.js). Con 6 y con 4 no se distingue de la resolución
//     completa; con 2 el sol queda pixelado, como la luna.
//   - `skyHz` (del estado): cuántas imágenes del cielo por segundo. Cada una se
//     pinta por bandas, una por fotograma, y se enseña al estar entera
//     (shaders/skyBuffer.js): a 60 fotogramas y 30 Hz, medio cielo en cada uno.
//     El cielo no se desplaza con el mundo: 30 en partida y 10 en el menú bastan;
//     el juego sigue a su ritmo.
//
// Hasta la T05 la palanca era `filter.resolution`, y no hacía nada: con un solo
// filtro Pixi lo pinta directo a pantalla, a resolución completa, y esa propiedad
// solo cambia una textura de entrada que el shader no lee. Tampoco quita ya
// efectos ni partículas la calidad: no ahorraban nada, y los efectos solo los
// reduce el jugador ("Efectos visuales").

/**
 * @typedef {Object} RenderBudget
 * @property {number} maxFPS            Fotogramas por segundo del estado; 0 = los de la pantalla.
 * @property {'native'|'half'|'steady'} pace  Ritmo que pide la calidad (ver PACES).
 * @property {number} skyTexels         Texeles del cielo por celda del arte.
 * @property {number} skyHz             Veces por segundo que se repinta el cielo.
 * @property {number} particleRatio     Fracción del pool de motas que se anima [0,1].
 * @property {boolean} sceneryAnimated  Si el scenery avanza este frame.
 * @property {'cheap'|'mid'|'heavy'} fxCost  Hasta qué coste se pintan los efectos (fx/registry.js).
 */

/**
 * @typedef {'MENU'|'LOADING'|'PLAYING'|'PAUSED'|'RESULTS'|'GAME_OVER'} ProfileName
 */

/**
 * Presupuesto por estado. Los nombres coinciden con `STATE` de AppController
 * a propósito: así el mapeo es directo y no hace falta una tabla de traducción
 * que se pueda desincronizar.
 */
export const RENDER_PROFILES = Object.freeze({
    // Pantalla de reposo. 30 fps es de sobra para nubes que se mueven a 60 px/s
    // y un dino trotando a 3.3 fotogramas por segundo de animación; el cielo solo
    // respira (el sol, las estrellas que titilan): 10 veces por segundo le bastan.
    // Medido: el menú gastaba el 37 % de una Intel UHD 620; así, el 15 %.
    MENU: Object.freeze({
        maxFPS: 30,
        skyHz: 10,
        particleRatio: 0.3,
        sceneryAnimated: true,
    }),

    // Durante el análisis el render está PARADO del todo (setRenderPaused).
    // La fila existe igualmente para que el mapeo sea total y para que, si
    // algún día se deja render durante la carga, el presupuesto ya esté dicho.
    LOADING: Object.freeze({
        maxFPS: 15,
        skyHz: 5,
        particleRatio: 0,
        sceneryAnimated: false,
    }),

    // Lo único que se juega: los fotogramas de la pantalla. El cielo, a 30: lo que
    // late con la música (el bombeo, el sol) son envolventes de décimas de segundo.
    PLAYING: Object.freeze({
        maxFPS: 0,
        skyHz: 30,
        particleRatio: 1,
        sceneryAnimated: true,
    }),

    // Congelado tras un modal. Se sigue pintando para que el fondo no sea un
    // rectángulo muerto, pero a coste casi nulo.
    PAUSED: Object.freeze({
        maxFPS: 15,
        skyHz: 5,
        particleRatio: 0.3,
        sceneryAnimated: false,
    }),

    // Panel de resultados sobre la escena (reintentos, Sep 2026): el choque se
    // queda quieto y, tras una victoria, el Dino trota y el cielo sigue su epílogo.
    RESULTS: Object.freeze({
        maxFPS: 30,
        skyHz: 15,
        particleRatio: 0.3,
        sceneryAnimated: true,
    }),

    // Transición de salida (a otra partida o al menú): dura un fundido.
    GAME_OVER: Object.freeze({
        maxFPS: 30,
        skyHz: 15,
        particleRatio: 0.5,
        sceneryAnimated: true,
    }),
});

/**
 * Niveles de calidad (los que se eligen en AJUSTES y los que recorre la calidad
 * automática, systems/frameGovernor.js): el detalle del cielo.
 *
 * `fxCost`: el efecto más caro que se pinta (cada efecto declara su coste en
 * fx/registry.js). Desde la T05 todos los niveles los pintan todos: medido, quitar
 * efectos no ahorra nada.
 *
 * @type {Record<string, { label: string, skyTexels: number, fxCost: 'cheap'|'mid'|'heavy' }>}
 */
export const QUALITY_TIERS = Object.freeze({
    high:   Object.freeze({ label: 'Alta',  skyTexels: 6, fxCost: 'heavy' }),
    medium: Object.freeze({ label: 'Media', skyTexels: 4, fxCost: 'heavy' }),
    low:    Object.freeze({ label: 'Baja',  skyTexels: 2, fxCost: 'heavy' }),
});

/** Los niveles de calidad, de mejor a peor. */
export const TIER_ORDER = Object.freeze(['high', 'medium', 'low']);

/**
 * Ritmos de fotogramas que puede pedir la calidad automática:
 *   native  los de la pantalla.
 *   half    la mitad (una pantalla de 120 Hz que no llega: 60, parejos).
 *   steady  `STEADY_FPS` estables: lo último, o lo primero si lo que falta es
 *           procesador (ahí bajar el cielo no sirve de nada).
 */
export const PACES = Object.freeze(['native', 'half', 'steady']);

/** Fotogramas por segundo del ritmo estable. */
export const STEADY_FPS = 30;

/**
 * Combina el presupuesto de un estado con el nivel de calidad y el ritmo activos.
 *
 * @param {ProfileName} name
 * @param {string} tier  Clave de {@link QUALITY_TIERS}.
 * @param {'native'|'half'|'steady'} [pace]
 * @returns {RenderBudget}
 */
export function resolveBudget(name, tier = 'high', pace = 'native') {
    const base = RENDER_PROFILES[name] ?? RENDER_PROFILES.MENU;
    const q = QUALITY_TIERS[tier] ?? QUALITY_TIERS.high;
    return {
        maxFPS: base.maxFPS,
        pace: PACES.includes(pace) ? pace : 'native',
        skyTexels: q.skyTexels,
        skyHz: base.skyHz,
        particleRatio: base.particleRatio,
        sceneryAnimated: base.sceneryAnimated,
        fxCost: q.fxCost,
    };
}
