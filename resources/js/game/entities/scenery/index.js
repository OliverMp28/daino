// Tipos de capa del escenario (T01): el `type` de cada capa de una escena
// (scenes/registry.js) elige aquí su implementación. Una capa nueva es un módulo
// con la misma forma y una entrada en este mapa:
//
//   create(def, { width, height, groundY, horizonRise, still }) → {
//       container,                        Pixi, en unidades de mundo
//       tick(dt, worldSpeed),             scroll y animación propia
//       resize(width, height, groundY),
//       light(skyState),                  color de la hora y arco (scenes/skyModel.js)
//       setVisible(elementId, on),        interruptores del panel dev
//       setPulse?(pulse, intensity),      efectos que laten (solo si los tiene)
//       setDetail?(ratio),                presupuesto de render: lluvia y nieve
//       setFlashes?(on),                  "Reducir efectos visuales": relámpagos
//       dispose(),
//   }
//
// Y su entrada en scenes/backdrops.js: qué pone detrás del juego, para el
// guardián de legibilidad.
//
// Carga bajo demanda (T02.1): las capas de la escena de siempre van en el bundle
// (`LAYER_TYPES`); las de las escenas nuevas (`LAZY_LAYER_TYPES`) se descargan al
// preparar un nivel que las usa, con el `import()` literal que Vite parte en su
// propio chunk. Así cada escena nueva no engorda la carga del juego.

import { createCloudLayer } from './Clouds.js';
import { createGroundLayer } from './Ground.js';
import { createRidgeLayer } from './Ridge.js';

export const LAYER_TYPES = Object.freeze({
    ridge: createRidgeLayer,
    clouds: createCloudLayer,
    ground: createGroundLayer,
});

export const LAZY_LAYER_TYPES = Object.freeze({
    sea: () => import('./Sea.js').then((m) => m.createSeaLayer),
    lighthouse: () => import('./Lighthouse.js').then((m) => m.createLighthouseLayer),
    rain: () => import('./Rain.js').then((m) => m.createRainLayer),
    snow: () => import('./Snow.js').then((m) => m.createSnowLayer),
    lightning: () => import('./Lightning.js').then((m) => m.createLightningLayer),
    skyline: () => import('./Skyline.js').then((m) => m.createSkylineLayer),
});

/** Implementaciones disponibles ya (las del bundle y las que se han cargado). */
const ready = new Map(Object.entries(LAYER_TYPES));
/** Cargas en curso, para no pedir dos veces el mismo chunk. */
const loading = new Map();

/** Implementación de un tipo de capa, o null si aún no se ha cargado. */
export function layerFactory(type) {
    return ready.get(type) ?? null;
}

/** Si todas las capas de una escena se pueden montar ya. */
export function layerTypesReady(scene) {
    return scene.layers.every((l) => ready.has(l.type));
}

/**
 * Carga las capas que le falten a una escena. Idempotente; rechaza si un tipo
 * no existe o su chunk no llega (sin red, por ejemplo).
 *
 * @param {import('../../scenes/registry.js').SceneDef} scene
 */
export async function loadLayerTypes(scene) {
    await Promise.all(scene.layers.map((l) => {
        if (ready.has(l.type)) return undefined;
        const load = LAZY_LAYER_TYPES[l.type];
        if (load === undefined) return Promise.reject(new Error(`escenario: tipo de capa desconocido "${l.type}" (escena "${scene.id}")`));
        if (!loading.has(l.type)) {
            loading.set(l.type, load()
                .then((create) => { ready.set(l.type, create); })
                .finally(() => { loading.delete(l.type); }));
        }
        return loading.get(l.type);
    }));
}
