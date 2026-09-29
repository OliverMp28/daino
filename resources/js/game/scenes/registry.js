// Registro de escenas (T01, doc 11 §2.5): UNA ESCENA ES UNA ENTRADA.
//
// Una escena declara su paleta (palettes.js), su ciclo (skyClock.js), cómo se
// mueven sus astros y qué capas pinta el escenario (entities/scenery/). Añadir
// una escena nueva (la "Costa" del T02, con el mar, el barco y el destello
// verde) es una entrada aquí y, si hace falta, un tipo de capa nuevo; ni el juego
// ni el charter cambian.
//
// Puro y sin Pixi: los tests validan el registro entero (paletas, ciclos, capas
// y legibilidad de cada escena).

import { SKY_CYCLES } from './skyClock.js';
import { SKY_PALETTES } from './palettes.js';

/**
 * @typedef {object} SceneDef
 * @property {string} id
 * @property {string} label         Nombre para el panel dev (y, con el T02, para quien sube).
 * @property {keyof typeof SKY_PALETTES} palette
 * @property {keyof typeof SKY_CYCLES} cycle
 * @property {number} menuHour      Hora del cielo en el menú.
 * @property {{ rise: number, set: number, maxElev: number, maxDepth: number, riseX: number, setX: number, peak: number, curve: number }} sun
 *   Recorrido del sol: horas de salida y puesta, elevación máxima (y profundidad
 *   a medianoche) en grados, x de salida y de puesta en [0,1], `peak` = y en
 *   fracción del cielo en su punto más alto y `curve` < 1 para que se quede alto
 *   la mayor parte de la tarde.
 * @property {{ rise: number, set: number, riseX: number, setX: number, peak: number, curve: number, radius: number }} moon
 * @property {number} starRotPerHour  Giro del cielo estrellado (radianes por hora).
 * @property {Array<{ from: number, to: number, x0: number, x1: number, y0: number, y1: number, fadeIn: number, fadeOut: number, size: number }>} luceros
 *   Lucero de la tarde y del alba: horas (continuas), recorrido y fundidos.
 * @property {Array<{ type: string, id: string, label: string, color?: string, rim?: number, params?: object }>} layers
 *   Capas del escenario de atrás adelante; `type` elige la implementación
 *   (entities/scenery/index.js).
 */

/** @type {Record<string, SceneDef>} */
export const SCENES = deepFreeze({
    mountains: {
        id: 'mountains',
        label: 'Cordillera',
        palette: 'synthwave',
        cycle: 'journey',
        // Ocaso synthwave: el sol con rendijas asomando sobre las crestas, el cielo
        // rosa y violeta y las primeras estrellas arriba (decisión del user).
        menuHour: 18.2,
        // Vive a la derecha: se pone donde siempre estuvo el sol synthwave (el Dino
        // corre hacia el atardecer) y sale un poco a su izquierda. Con la salida al
        // este de verdad (x ≈ 0.3), el sol del amanecer caía en la zona que se lee
        // justo delante del Dino y su halo lavaba a los obstáculos que llegan; y
        // saliendo en 0.62 el epílogo lo escondía tras el panel de resultados
        // (que ocupa ~0.33-0.67). Descartados por las capturas del E2E.
        sun: { rise: 6.25, set: 18.5, maxElev: 62, maxDepth: 40, riseX: 0.72, setX: 0.82, peak: 0.3, curve: 0.55 },
        // Sale por la izquierda pero fuera de la columna del Dino (x ≈ 0.1-0.19).
        moon: { rise: 19.25, set: 30.5, riseX: 0.3, setX: 0.86, peak: 0.16, curve: 0.6, radius: 0.05 },
        // ~1.2° por hora: en una noche de doce horas el cielo gira unos 15°.
        starRotPerHour: 0.021,
        luceros: [
            // El lucero de la tarde sale sobre el ocaso y se pone en unas horas: el
            // aviso de que llega la noche.
            { from: 18.4, to: 21.6, x0: 0.72, x1: 0.8, y0: 0.5, y1: 1.02, fadeIn: 0.25, fadeOut: 0.3, size: 1 },
            // El del alba, al este, se apaga cuando sale el sol.
            { from: 27.8, to: 30.3, x0: 0.44, x1: 0.42, y0: 0.95, y1: 0.6, fadeIn: 0.4, fadeOut: 0.35, size: 1 },
        ],
        layers: [
            { type: 'ridge', id: 'mountainsFar', label: 'Montañas lejanas', color: 'far', rim: 1,
                params: { baseRise: 40, jag: 90, step: 96, seed: 17, parallax: 0.072 } },
            { type: 'ridge', id: 'mountainsNear', label: 'Montañas cercanas', color: 'near', rim: 0.45,
                params: { baseRise: 20, jag: 60, step: 64, seed: 91, parallax: 0.12 } },
            // Las nubes viven por encima de todo lo que se juega (el Dino llega a
            // 364 de alto con el doble salto): de día son blancas, y un Dino blanco
            // delante de una nube blanca desaparece. `clearancePx` es la altura
            // mínima sobre el suelo; el guardián comprueba que queda por encima.
            { type: 'clouds', id: 'clouds', label: 'Nubes',
                params: { count: 6, band: [0.04, 0.24], scale: [0.7, 1.35], parallax: 0.25, driftPxS: 8, clearancePx: 380 } },
            { type: 'ground', id: 'ground', label: 'Suelo' },
        ],
    },
});

export const DEFAULT_SCENE = 'mountains';

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

/** Todo lo que se puede apagar de una escena, con su nombre (panel dev). */
export function sceneElements(scene) {
    const layers = scene.layers.map((l) => ({ id: l.id, label: l.label }));
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
