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
//   - ARCO del ambiente (`arc`, weather.js): lo que le pasa con la canción, en
//     curvas por hora del cielo (la tormenta que estalla con el clímax, las
//     ventanas de la ciudad que se encienden al caer la noche). Cualquier nivel lo
//     tiene sin que nadie programe nada.
//   - HISTORIA DE AUTOR (`kind: 'story'`, T02.6): momentos coreografiados para
//     UNA canción oficial. Nunca `selectable`.
// La escena no toca el juego (ni el chart, ni las marcas): por eso su autor la
// puede cambiar siempre.
//
// Por dentro, lugar y clima se componen: la lluvia es una capa que vale para la
// Costa y para la Cordillera. A quien sube se le enseñan ambientes ya probados.
//
// Puro y sin Pixi: los tests validan el registro entero (paletas, ciclos, capas
// y legibilidad de cada escena).

import { SKY_CYCLES, SKY_RULES } from './skyClock.js';
import { SKY_PALETTES } from './palettes.js';
import { STORY_DEFS, bindStory } from './stories/index.js';

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
 * @property {keyof typeof SKY_CYCLES | 'story'} cycle  `story`: el ciclo de su historia (T02.6).
 * @property {number} menuHour      Hora del cielo en el menú (y de la muestra del selector).
 * @property {number} horizonRise   Altura del horizonte del cielo sobre el suelo, en
 *   unidades de mundo. 0: el horizonte es la línea del suelo (la cordillera lo tapa
 *   entero). La Costa lo sube para que el mar llegue hasta él y el sol se ponga en
 *   el agua a la vista.
 * @property {{ deep: string }} [sea]  Color del agua profunda; el resto del mar lo
 *   pone el cielo que refleja (skyModel.js). Solo en escenas con capa `sea`.
 * @property {{ tint: string, mix: number, dark: number }} [overcast]  El cielo
 *   cubierto de la escena: hacia qué color va (`tint`), cuánto (`mix`) y cuánto se
 *   oscurece (`dark`) con el arco `overcast` a tope.
 * @property {Partial<Record<'overcast' | 'rain' | 'lightning' | 'snow' | 'windows', Array<[number, number]>>>} [arc]
 *   El arco del ambiente: curvas `[hora, valor]` en horas continuas (weather.js).
 * @property {{ rise: number, set: number, maxElev: number, maxDepth: number, riseX: number, setX: number, peak: number, curve: number }} sun
 *   Recorrido del sol: horas de salida y puesta, elevación máxima (y profundidad
 *   a medianoche) en grados, x de salida y de puesta en [0,1], `peak` = y en
 *   fracción del cielo en su punto más alto y `curve` < 1 para que se quede alto
 *   la mayor parte de la tarde.
 * @property {{ rise: number, set: number, riseX: number, setX: number, peak: number, curve: number, radius: number }} moon
 * @property {number} starRotPerHour  Giro del cielo estrellado (radianes por hora).
 * @property {Array<{ from: number, to: number, x0: number, x1: number, y0: number, y1: number, fadeIn: number, fadeOut: number, size: number }>} luceros
 *   Lucero de la tarde y del alba: horas (continuas), recorrido y fundidos.
 * @property {object} [story]      Historia de autor ligada a la escena (stories/, T02.6).
 * @property {boolean} [greenFlash] El destello verde al ponerse y al salir el sol (T02.6).
 * @property {Array<{ type: string, id: string, label: string, color?: string, rim?: number, snowRim?: number, parts?: Array<{ id: string, label: string }>, params?: object }>} layers
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
const SKY = { sun: SUN, moon: MOON, starRotPerHour: STAR_ROT_PER_HOUR, luceros: LUCEROS };

// ---------------------------------------------------------------------------
// Capas que comparten los ambientes (lugar y clima se componen).

// Alturas de `baseRise` a `baseRise + jag` (ridgeShape.js). Con el hash del T01,
// que devolvía [−0.5, 0.5), eran 40 ± 45 y 20 ± 30: estos números dibujan
// exactamente la cordillera que se aprobó (las crestas lejanas llegan a ~81 y sus
// valles bajan casi al suelo).
const FAR_RIDGE = { type: 'ridge', id: 'mountainsFar', label: 'Montañas lejanas', color: 'far', rim: 1,
    params: { baseRise: -5, jag: 90, step: 96, seed: 17, parallax: 0.072 } };
const NEAR_RIDGE = { type: 'ridge', id: 'mountainsNear', label: 'Montañas cercanas', color: 'near', rim: 0.45,
    params: { baseRise: -10, jag: 60, step: 64, seed: 91, parallax: 0.12 } };

// Las nubes viven por encima de todo lo que se juega (el Dino llega a 364 de
// alto con el doble salto): de día son blancas, y un Dino blanco delante de una
// nube blanca desaparece. `clearancePx` es la altura mínima sobre el suelo; el
// guardián comprueba que queda por encima.
const CLOUDS = { type: 'clouds', id: 'clouds', label: 'Nubes',
    params: { count: 6, band: [0.04, 0.24], scale: [0.7, 1.35], parallax: 0.25, driftPxS: 8, clearancePx: 380 } };
/** Con el cielo cubierto hacen falta más nubes para taparlo. */
const STORM_CLOUDS = { ...CLOUDS, params: { ...CLOUDS.params, count: 10 } };

const GROUND = { type: 'ground', id: 'ground', label: 'Suelo' };

// La Costa (T02.2). Islas: una cordillera baja, a trozos, apoyada en la línea del
// mar; las lejanas apenas se mueven. El faro, tan lejos que cruza la pantalla en
// unos 3-4 minutos: entra por la derecha al empezar y sigue a la vista cuando
// anochece y se enciende (a 0.012 salía por la izquierda a mitad de un nivel rápido).
const COAST_HORIZON = 120;
const COAST_SEA = { deep: '#061634' };
const ISLANDS = { type: 'ridge', id: 'islands', label: 'Islas', color: 'far', rim: 0.8,
    params: { anchor: 'horizon', baseRise: 6, jag: 34, step: 36, seed: 53, parallax: 0.03, gaps: 0.5, gapRun: 3 } };
const LIGHTHOUSE = { type: 'lighthouse', id: 'lighthouse', label: 'Faro',
    parts: [{ id: 'lighthouseLight', label: 'Luz del faro' }],
    params: { parallax: 0.008, every: 2400, startX: 0.92 } };
const SEA = { type: 'sea', id: 'sea', label: 'Mar',
    parts: [
        { id: 'seaCrests', label: 'Crestas de las olas' },
        { id: 'seaGlint', label: 'Reflejo del sol y la luna' },
    ],
    params: { bands: 7, crestRows: 6, parallax: [0.03, 0.42] } };
const SAND = { type: 'ground', id: 'ground', label: 'Arena', params: { sprite: 'groundSand' } };

// El clima (T02.3): capas que caen delante del paisaje y detrás del juego. La
// lluvia, en dos profundidades; los relámpagos, detrás de las montañas (el cielo
// se ilumina y las crestas quedan en silueta).
const RAIN = { type: 'rain', id: 'rain', label: 'Lluvia',
    params: { count: 170, fallPxS: 760, slant: 0.17, nearShare: 0.45 } };
const LIGHTNING = { type: 'lightning', id: 'lightning', label: 'Relámpagos', params: { seed: 23 } };
const SNOW = { type: 'snow', id: 'snow', label: 'Nieve',
    params: { count: 150, fallPxS: [26, 64], swayPxS: 14, parallax: [0.12, 0.5], nearShare: 0.4 } };

// One Day (T02.6): la primera historia de autor, sobre la Costa. Sus horas salen
// del cielo de esta escena (el último instante del sol en SU horizonte), así que
// se liga aquí, con el sol y el horizonte que va a tener.
// La luz de una película de piratas (paleta `golden`: teal y oro), el mar del
// Caribe en azul petróleo, y una luna que cruza la noche de la espera y se pone
// antes del alba: el regreso es del sol.
const ONE_DAY_SKY = {
    id: 'one-day',
    palette: 'golden',
    horizonRise: COAST_HORIZON,
    ...SKY,
    moon: { ...MOON, rise: 19.6, set: 28.6 },
};
const ONE_DAY = bindStory(STORY_DEFS['one-day'], ONE_DAY_SKY);

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
        ...SKY,
        layers: [FAR_RIDGE, NEAR_RIDGE, CLOUDS, GROUND],
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
        horizonRise: COAST_HORIZON,
        sea: COAST_SEA,
        ...SKY,
        layers: [ISLANDS, LIGHTHOUSE, SEA, CLOUDS, SAND],
    },
    // Lluvia (T02.3): la Costa bajo una lluvia mansa, sin relámpagos. Arrecia al
    // anochecer (con el clímax) y escampa con el alba. El mar refleja el cielo
    // gris y el faro se enciende entre la lluvia.
    rain: {
        id: 'rain',
        label: 'Lluvia',
        kind: 'ambient',
        selectable: true,
        blurb: 'La costa bajo una lluvia mansa que arrecia al anochecer y escampa con el alba.',
        palette: 'synthwave',
        cycle: 'journey',
        menuHour: 18.2,
        horizonRise: COAST_HORIZON,
        sea: COAST_SEA,
        overcast: { tint: '#2e3a52', mix: 0.5, dark: 0.15 },
        arc: {
            overcast: [[13, 0.6], [18.85, 0.75], [19.5, 0.85], [28, 0.7], [30.6, 0.3]],
            rain: [[13, 0.3], [17.25, 0.4], [19.5, 0.7], [27, 0.6], [29, 0.3], [30.6, 0.04]],
        },
        ...SKY,
        layers: [ISLANDS, LIGHTHOUSE, SEA, STORM_CLOUDS, RAIN, SAND],
    },
    // Tormenta (T02.3): la Cordillera bajo una tormenta. Llovizna por la tarde,
    // relámpagos desde el ocaso, la tormenta entera con la noche (que cae con el
    // clímax) y escampa con el alba.
    storm: {
        id: 'storm',
        label: 'Tormenta',
        kind: 'ambient',
        selectable: true,
        blurb: 'Montañas bajo una tormenta que estalla con el clímax, entre relámpagos, y escampa al amanecer.',
        palette: 'synthwave',
        cycle: 'journey',
        menuHour: 18.2,
        horizonRise: 0,
        overcast: { tint: '#262b3d', mix: 0.6, dark: 0.22 },
        arc: {
            overcast: [[13, 0.65], [17.25, 0.8], [19.5, 1], [28, 0.85], [30.6, 0.4]],
            rain: [[13, 0.25], [17.25, 0.45], [18.85, 0.7], [19.5, 1], [27, 0.85], [29, 0.4], [30.6, 0.06]],
            lightning: [[17.5, 0], [18.85, 0.35], [19.5, 1], [27, 0.7], [28.5, 0.15], [29.2, 0]],
        },
        ...SKY,
        layers: [LIGHTNING, FAR_RIDGE, NEAR_RIDGE, STORM_CLOUDS, RAIN, GROUND],
    },
    // Nieve (T02.3): la Cordillera nevada. El filo de las crestas es nieve a
    // cualquier hora; la nevada empieza suave, arrecia hacia el clímax y amaina
    // con el alba, que llega sobre la nieve recién caída.
    snow: {
        id: 'snow',
        label: 'Nieve',
        kind: 'ambient',
        selectable: true,
        blurb: 'Montañas nevadas y una nevada que arrecia hacia el clímax y amaina con el alba.',
        palette: 'synthwave',
        cycle: 'journey',
        menuHour: 18.2,
        horizonRise: 0,
        overcast: { tint: '#46506c', mix: 0.35, dark: 0.08 },
        // De noche, con la nevada entera, el cielo se cierra: los copos no se
        // confunden con las estrellas.
        arc: {
            overcast: [[13, 0.45], [18.85, 0.6], [19.5, 0.9], [27, 0.8], [29, 0.45], [30.6, 0.15]],
            snow: [[13, 0.3], [17.25, 0.45], [19.5, 1], [27, 0.7], [29, 0.3], [30.6, 0.06]],
        },
        ...SKY,
        layers: [
            { ...FAR_RIDGE, snowRim: 0.9, parts: [{ id: 'ridgeSnow', label: 'Nieve de las crestas' }] },
            { ...NEAR_RIDGE, snowRim: 0.7, parts: [{ id: 'ridgeSnow', label: 'Nieve de las crestas' }] },
            CLOUDS,
            SNOW,
            { type: 'ground', id: 'ground', label: 'Suelo nevado', params: { sprite: 'groundSnow' } },
        ],
    },
    // Ciudad de noche (T02.4): una noche entera (ciclo `nocturne`). La canción
    // empieza en la hora azul y la ciudad enciende sus ventanas; su medianoche, la
    // hora más viva, cae con el clímax; de madrugada se va apagando y amanece.
    city: {
        id: 'city',
        label: 'Ciudad de noche',
        kind: 'ambient',
        selectable: true,
        blurb: 'La noche entera en la ciudad: se enciende al empezar, vive su medianoche en el clímax y amanece.',
        palette: 'synthwave',
        cycle: 'nocturne',
        menuHour: 21.5,
        horizonRise: 0,
        arc: {
            windows: [[18.6, 0], [19.6, 0.5], [24, 0.9], [27, 0.55], [29, 0.3], [30.6, 0.06]],
        },
        ...SKY,
        layers: [
            // Los lejanos, pegados unos a otros: tapan el cielo de punta a punta
            // hasta el más bajo (el horizonte, con su neblina, no asoma cerca del
            // suelo, y el guardián lo sabe). Los cercanos dejan huecos.
            { type: 'skyline', id: 'cityFar', label: 'Edificios lejanos', color: 'far',
                parts: [
                    { id: 'cityWindows', label: 'Ventanas' },
                    { id: 'cityBeacons', label: 'Luces de las antenas' },
                ],
                params: { seed: 5, minW: 5, maxW: 12, minH: 24, maxH: 50, gapMax: 0, antennaChance: 0.5, stepChance: 0.25, parallax: 0.05, windowAlpha: 0.72 } },
            { type: 'skyline', id: 'cityNear', label: 'Edificios cercanos', color: 'near',
                parts: [{ id: 'cityWindows', label: 'Ventanas' }],
                params: { seed: 41, minW: 6, maxW: 14, minH: 9, maxH: 22, gapMax: 2, antennaChance: 0, stepChance: 0.3, parallax: 0.1, windowAlpha: 1 } },
            CLOUDS,
            { type: 'ground', id: 'ground', label: 'Calle', params: { sprite: 'groundCity' } },
        ],
    },
    // One Day (T02.6), historia de autor de UN oficial: la de Will y Elizabeth.
    // La Costa con el horizonte abierto (sin islas ni faro: las islas pasan y
    // podrían tapar justo el punto donde el sol se pone o sale, y los dos
    // destellos no pueden depender del azar), un barco que se va con el sol y
    // vuelve con él, el destello verde y el cabo donde ella espera con su farol.
    // Solo llega por el manifiesto del catálogo oficial: nunca se puede elegir.
    'one-day': {
        ...ONE_DAY_SKY,
        label: 'El destello verde',
        kind: 'story',
        selectable: false,
        blurb: 'One Day: la despedida en el mar, diez años de espera y el regreso con el destello verde.',
        cycle: 'story',
        story: ONE_DAY,
        greenFlash: true,
        // Sin partida (panel dev): la despedida, con el barco en el sol.
        menuHour: 18.7,
        sea: { deep: '#03222b' },
        // El barco va detrás del mar (se hunde tras el horizonte); el cabo, delante:
        // está más cerca, con el pie en el agua.
        layers: [
            { type: 'storyShip', id: 'storyShip', label: 'El barco',
                parts: [{ id: 'storySpray', label: 'Agua y estela' }, { id: 'storyShipLamp', label: 'Luces de popa' }],
                params: { tracks: ONE_DAY.tracks.ship } },
            SEA,
            { type: 'storyCliff', id: 'storyCliff', label: 'El cabo',
                parts: [{ id: 'storyFigures', label: 'Ella y el hijo' }, { id: 'storyLantern', label: 'El farol' }],
                params: { tracks: ONE_DAY.tracks.cliff } },
            CLOUDS,
            SAND,
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
    // Solo en escenas con `greenFlash` (las historias que lo usan).
    Object.freeze({ id: 'greenFlash', label: 'Destello verde', slot: 7 }),
]);

/** El filo de luz de las crestas: un elemento propio dentro de las capas `ridge`. */
export const RIDGE_RIM_ELEMENT = Object.freeze({ id: 'ridgeRim', label: 'Filo de las crestas' });

/** Escena por id; cualquier id desconocido cae a la de siempre. */
export function resolveScene(id) {
    return Object.prototype.hasOwnProperty.call(SCENES, id) ? SCENES[id] : SCENES[DEFAULT_SCENE];
}

/**
 * Escena con la que se juega un nivel: la que eligió su autor (o la de su
 * historia, en un oficial); si no eligió ninguna, la que propone Automático por
 * cómo suena la canción (T02.5, `scene_auto`: scenes/sceneCasting.js); y si no
 * hay propuesta, la de siempre. Una escena que este cliente no conoce (más nueva
 * que él) se salta.
 *
 * @param {{ scene?: string | null, scene_auto?: string | null } | null | undefined} level  Fila de la API.
 * @returns {string}
 */
export function playSceneId(level) {
    for (const id of [level?.scene, autoSceneId(level)]) {
        if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(SCENES, id)) return id;
    }
    return DEFAULT_SCENE;
}

/**
 * Lo que propone Automático para un nivel: un ambiente elegible que este cliente
 * conoce, o null (la de siempre).
 *
 * @param {{ scene_auto?: string | null } | null | undefined} level
 * @returns {string | null}
 */
export function autoSceneId(level) {
    const id = level?.scene_auto;
    return typeof id === 'string' && SELECTABLE_SCENES.some((scene) => scene.id === id) ? id : null;
}

/**
 * Todo lo que se puede apagar de una escena, con su nombre (panel dev). Un id que
 * comparten varias capas (las ventanas de las dos filas de edificios) sale una
 * vez: su interruptor las apaga todas.
 */
export function sceneElements(scene) {
    const all = [
        ...SKY_ELEMENTS.filter((e) => e.id !== 'greenFlash' || scene.greenFlash === true).map(({ id, label }) => ({ id, label })),
        ...scene.layers.flatMap((l) => [{ id: l.id, label: l.label }, ...(l.parts ?? []).map(({ id, label }) => ({ id, label }))]),
        ...(scene.layers.some((l) => l.type === 'ridge') ? [RIDGE_RIM_ELEMENT] : []),
    ];
    const seen = new Set();
    return all.filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
}

/** Ciclo de una escena (o el de siempre). Una historia trae el suyo (T02.6). */
export function sceneCycle(scene) {
    if (scene.cycle === 'story' && scene.story) return { kind: 'story', rules: SKY_RULES, story: scene.story };
    return SKY_CYCLES[scene.cycle] ?? SKY_CYCLES.journey;
}

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}
