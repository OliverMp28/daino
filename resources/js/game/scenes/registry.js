// Registro de escenas (T01, doc 11 §2.5): UNA ESCENA ES UNA ENTRADA.
//
// Una escena declara su paleta (palettes.js), su ciclo (skyClock.js), cómo se
// mueven sus astros y qué capas pinta el escenario (entities/scenery/). Añadir
// una escena nueva es una entrada aquí y, si hace falta, un tipo de capa nuevo;
// ni el juego ni el charter cambian.
//
// T02 (doc 11): un escenario tiene tres capas de personalidad.
//   - AMBIENTE (`kind: 'ambient'`): dónde pasa, genérico y reutilizable (la
//     Cordillera, la Costa…). Los `selectable` los puede elegir quien sube un
//     nivel; su lista se repite en app/Services/SceneCatalog.php (un test vigila
//     que coincidan).
//   - ARCO del ambiente: lo que le pasa con la canción (el cielo del T01, el faro
//     que se enciende al anochecer). Sale de la hora y la estructura del chart,
//     así que cualquier nivel lo tiene sin que nadie programe nada.
//   - HISTORIA DE AUTOR (`kind: 'story'`, T02.6): momentos coreografiados para
//     UNA canción oficial. Nunca `selectable`.
// La escena no toca el juego (ni el chart, ni las marcas): por eso su autor la
// puede cambiar siempre.
//
// Puro y sin Pixi: los tests validan el registro entero (paletas, ciclos, capas
// y legibilidad de cada escena).

import { SKY_CYCLES } from './skyClock.js';
import { SKY_PALETTES } from './palettes.js';

/** Forma de un id de escena: es lo que se guarda en `levels.scene` (migración 012). */
export const SCENE_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * @typedef {object} SceneDef
 * @property {string} id
 * @property {string} label         Nombre para quien sube un nivel y para el panel dev.
 * @property {'ambient' | 'story'} kind
 * @property {boolean} selectable   Se puede elegir para un nivel (solo ambientes).
 * @property {string} blurb         Una línea que describe el ambiente en el selector.
 * @property {keyof typeof SKY_PALETTES} palette
 * @property {keyof typeof SKY_CYCLES} cycle
 * @property {number} menuHour      Hora del cielo en el menú (y de la muestra del selector).
 * @property {number} horizonRise   Altura del horizonte del cielo sobre el suelo, en
 *   unidades de mundo. 0: el horizonte es la línea del suelo (la cordillera lo tapa
 *   entero). La Costa lo sube para que el mar llegue hasta él y el sol se ponga en
 *   el agua a la vista.
 * @property {{ deep: string }} [sea]  Color del agua profunda; el resto del mar lo
 *   pone el cielo que refleja (skyModel.js). Solo en escenas con capa `sea`. * @property {{ rise: number, set: number, maxElev: number, maxDepth: number, riseX: number, setX: number, peak: number, curve: number }} sun
 *   Recorrido del sol: horas de salida y puesta, elevación máxima (y profundidad
 *   a medianoche) en grados, x de salida y de puesta en [0,1], `peak` = y en
 *   fracción del cielo en su punto más alto y `curve` < 1 para que se quede alto
 *   la mayor parte de la tarde.
 * @property {{ rise: number, set: number, riseX: number, setX: number, peak: number, curve: number, radius: number }} moon
 * @property {number} starRotPerHour  Giro del cielo estrellado (radianes por hora).
 * @property {Array<{ from: number, to: number, x0: number, x1: number, y0: number, y1: number, fadeIn: number, fadeOut: number, size: number }>} luceros
 *   Lucero de la tarde y del alba: horas (continuas), recorrido y fundidos.
 * @property {Array<{ type: string, id: string, label: string, color?: string, rim?: number, parts?: Array<{ id: string, label: string }>, params?: object }>} layers
 *   Capas del escenario de atrás adelante; `type` elige la implementación
 *   (entities/scenery/index.js) y `parts` nombra lo que se puede apagar dentro
 *   de una capa (panel dev).
 */

// Lo que comparten las escenas con el cielo de siempre: el mismo sol, la misma
// luna y los mismos luceros. Una escena distinta cambia el paisaje, no el cielo.

// Vive a la derecha: se pone donde siempre estuvo el sol synthwave (el Dino corre
// hacia el atardecer) y sale un poco a su izquierda. Con la salida al este de
// verdad (x ≈ 0.3), el sol del amanecer caía en la zona que se lee justo delante
// del Dino y su halo lavaba a los obstáculos que llegan; y saliendo en 0.62 el
// epílogo lo escondía tras el panel de resultados (que ocupa ~0.33-0.67).
// Descartados por las capturas del E2E.
const SUN = { rise: 6.25, set: 18.5, maxElev: 62, maxDepth: 40, riseX: 0.72, setX: 0.82, peak: 0.3, curve: 0.55 };
// Sale por la izquierda pero fuera de la columna del Dino (x ≈ 0.1-0.19).
const MOON = { rise: 19.25, set: 30.5, riseX: 0.3, setX: 0.86, peak: 0.16, curve: 0.6, radius: 0.05 };
// ~1.2° por hora: en una noche de doce horas el cielo gira unos 15°.
const STAR_ROT_PER_HOUR = 0.021;
const LUCEROS = [
    // El lucero de la tarde sale sobre el ocaso y se pone en unas horas: el
    // aviso de que llega la noche.
    { from: 18.4, to: 21.6, x0: 0.72, x1: 0.8, y0: 0.5, y1: 1.02, fadeIn: 0.25, fadeOut: 0.3, size: 1 },
    // El del alba, al este, se apaga cuando sale el sol.
    { from: 27.8, to: 30.3, x0: 0.44, x1: 0.42, y0: 0.95, y1: 0.6, fadeIn: 0.4, fadeOut: 0.35, size: 1 },
];
// Las nubes viven por encima de todo lo que se juega (el Dino llega a 364 de
// alto con el doble salto): de día son blancas, y un Dino blanco delante de una
// nube blanca desaparece. `clearancePx` es la altura mínima sobre el suelo; el
// guardián comprueba que queda por encima.
const CLOUDS = { type: 'clouds', id: 'clouds', label: 'Nubes',
    params: { count: 6, band: [0.04, 0.24], scale: [0.7, 1.35], parallax: 0.25, driftPxS: 8, clearancePx: 380 } };

/** @type {Record<string, SceneDef>} */
export const SCENES = deepFreeze({
    mountains: {
        id: 'mountains',
        label: 'Cordillera',
        kind: 'ambient',
        selectable: true,
        blurb: 'Montañas en el horizonte y un cielo que va del día a la noche con la canción.',
        palette: 'synthwave',
        cycle: 'journey',
        // Ocaso synthwave: el sol con rendijas asomando sobre las crestas, el cielo
        // rosa y violeta y las primeras estrellas arriba (decisión del user).
        menuHour: 18.2,
        horizonRise: 0,
        sun: SUN,
        moon: MOON,
        starRotPerHour: STAR_ROT_PER_HOUR,
        luceros: LUCEROS,
        layers: [
            // Alturas de `baseRise` a `baseRise + jag` (ridgeShape.js). Con el hash
            // del T01, que devolvía [−0.5, 0.5), eran 40 ± 45 y 20 ± 30: estos
            // números dibujan exactamente la cordillera que se aprobó (las crestas
            // lejanas llegan a ~81 y sus valles bajan casi al suelo).
            { type: 'ridge', id: 'mountainsFar', label: 'Montañas lejanas', color: 'far', rim: 1,
                params: { baseRise: -5, jag: 90, step: 96, seed: 17, parallax: 0.072 } },
            { type: 'ridge', id: 'mountainsNear', label: 'Montañas cercanas', color: 'near', rim: 0.45,
                params: { baseRise: -10, jag: 60, step: 64, seed: 91, parallax: 0.12 } },
            CLOUDS,
            { type: 'ground', id: 'ground', label: 'Suelo' },
        ],
    },
    // La Costa (T02.2): el mar hasta un horizonte despejado. Sin cordillera
    // delante, el sol se pone en el agua a la vista y deja su reflejo; la luna
    // también. Islas y cabos lejanos sobre la línea del mar y, en uno, un faro que
    // se enciende al anochecer (su arco con la canción). El Dino corre por la arena.
    coast: {
        id: 'coast',
        label: 'Costa',
        kind: 'ambient',
        selectable: true,
        blurb: 'El mar hasta el horizonte, islas lejanas y un faro que se enciende al anochecer.',
        palette: 'synthwave',
        cycle: 'journey',
        menuHour: 18.2,
        // A la altura de lo que tapaba la cordillera: la franja donde vuela el
        // ptero (40-114) queda sobre el mar, oscuro, y el cielo jugable es el de
        // siempre (lo vigila el guardián).
        horizonRise: 120,
        sea: { deep: '#061634' },
        sun: SUN,
        moon: MOON,
        starRotPerHour: STAR_ROT_PER_HOUR,
        luceros: LUCEROS,
        layers: [
            // Islas: una cordillera baja, a trozos, apoyada en la línea del mar. Las
            // lejanas apenas se mueven.
            { type: 'ridge', id: 'islands', label: 'Islas', color: 'far', rim: 0.8,
                params: { anchor: 'horizon', baseRise: 6, jag: 34, step: 36, seed: 53, parallax: 0.03, gaps: 0.5, gapRun: 3 } },
            // Tan lejos que cruza la pantalla en unos 3-4 minutos: entra por la
            // derecha al empezar y sigue a la vista cuando anochece y se enciende.
            // (A 0.012 salía por la izquierda a mitad de un nivel rápido.)
            { type: 'lighthouse', id: 'lighthouse', label: 'Faro',
                parts: [{ id: 'lighthouseLight', label: 'Luz del faro' }],
                params: { parallax: 0.008, every: 2400, startX: 0.92 } },
            { type: 'sea', id: 'sea', label: 'Mar',
                parts: [
                    { id: 'seaCrests', label: 'Crestas de las olas' },
                    { id: 'seaGlint', label: 'Reflejo del sol y la luna' },
                ],
                params: { bands: 7, crestRows: 6, parallax: [0.03, 0.42] } },
            CLOUDS,
            { type: 'ground', id: 'ground', label: 'Arena', params: { sprite: 'groundSand' } },
        ],
    },
});

export const DEFAULT_SCENE = 'mountains';

/** Escena de un nivel que no eligió ninguna (`levels.scene` NULL). */
export const AUTO_SCENE = null;

/** Ambientes que se pueden elegir para un nivel, en el orden del selector. */
export const SELECTABLE_SCENES = Object.freeze(Object.values(SCENES).filter((s) => s.selectable));

/**
 * Lo que pinta el shader, con su hueco en `uShow0`/`uShow1`: el panel dev los
 * apaga uno a uno por su nombre.
 */
export const SKY_ELEMENTS = Object.freeze([
    Object.freeze({ id: 'sun', label: 'Sol', slot: 0 }),
    Object.freeze({ id: 'sunGlow', label: 'Halo del sol', slot: 1 }),
    Object.freeze({ id: 'moon', label: 'Luna', slot: 2 }),
    Object.freeze({ id: 'stars', label: 'Estrellas', slot: 3 }),
    Object.freeze({ id: 'lucero', label: 'Lucero', slot: 4 }),
    Object.freeze({ id: 'meteors', label: 'Estrellas fugaces', slot: 5 }),
    Object.freeze({ id: 'haze', label: 'Neblina del horizonte', slot: 6 }),
]);

/** El filo de luz de las crestas: un elemento propio dentro de las capas `ridge`. */
export const RIDGE_RIM_ELEMENT = Object.freeze({ id: 'ridgeRim', label: 'Filo de las crestas' });

/** Escena por id; cualquier id desconocido cae a la de siempre. */
export function resolveScene(id) {
    return Object.prototype.hasOwnProperty.call(SCENES, id) ? SCENES[id] : SCENES[DEFAULT_SCENE];
}

/**
 * Escena con la que se juega un nivel: la que eligió su autor (o la de su
 * historia, en un oficial) si este cliente la conoce; si no, la automática.
 * Hasta la T02.5 (reparto por el carácter de la canción) la automática es la de
 * siempre.
 *
 * @param {{ scene?: string | null } | null | undefined} level  Fila de la API.
 * @returns {string}
 */
export function playSceneId(level) {
    const id = level?.scene;
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SCENES, id) ? id : DEFAULT_SCENE;
}

/** Todo lo que se puede apagar de una escena, con su nombre (panel dev). */
export function sceneElements(scene) {
    const layers = scene.layers.flatMap((l) => [{ id: l.id, label: l.label }, ...(l.parts ?? []).map(({ id, label }) => ({ id, label }))]);
    const rims = scene.layers.some((l) => l.type === 'ridge') ? [RIDGE_RIM_ELEMENT] : [];
    return [...SKY_ELEMENTS.map(({ id, label }) => ({ id, label })), ...layers, ...rims];
}

/** Ciclo de una escena (o el de siempre). */
export function sceneCycle(scene) {
    return SKY_CYCLES[scene.cycle] ?? SKY_CYCLES.journey;
}

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}
