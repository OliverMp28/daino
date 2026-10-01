// Paletas del cielo (T01): cómo se ve cada hora.
//
// Una paleta son dos listas de keyframes indexados por la ELEVACIÓN DEL SOL en
// grados (no por la hora): la luz depende de lo alto que está el sol, y así la
// misma paleta vale para cualquier recorrido del sol que declare una escena.
// La tarde (el sol bajando) y el alba (subiendo) tienen listas propias porque
// no se ven igual: el ocaso es más cálido y el alba más rosa y fría. Las dos
// comparten los keyframes de pleno día y de noche cerrada, así que pasar de una
// a otra (a mediodía o a medianoche) no da saltos.
//
// Los colores se interpolan en OKLab (color.js) y los números en lineal.
//
// Restricciones medidas, que vigila scenes/readability.js (guardián):
//   - El cielo de la franja donde se juega (40-364 unidades sobre el suelo) y
//     las montañas dejan leer el Dino (≥ 4.5:1), el cactus (≥ 3:1) y los
//     obstáculos de color (≥ 2.5:1). Por eso el día es AZUL INTENSO (decisión
//     del user): con un cielo pastel el cactus queda a 1.02:1.
//   - Los brillos fuertes (disco y halo del sol, neblina pegada al horizonte)
//     viven fuera de esa franja o son locales.
//   - La neblina del horizonte, a la mitad en las horas cálidas y en las de luz
//     baja (T02.2). El guardián creía que la cordillera tapaba el cielo hasta 40
//     unidades; mide la forma real desde la T02.2 y sus valles lo dejan ver casi
//     hasta el suelo (y en la Costa el horizonte está a la vista). Con la neblina
//     entera, el cristal afilado y el orbe se perdían contra el horizonte al
//     amanecer y al atardecer. Las noches conservan la suya: es oscura.

import { hexToRgb, oklabToRgb, rgbToOklab } from './color.js';

/** Campos de color de un keyframe: se interpolan en OKLab. */
export const COLOR_FIELDS = Object.freeze([
    'top', 'mid', 'horizon', 'haze',
    'sunCore', 'sunEdge', 'sunGlow',
    'cloudBody', 'cloudRimTop', 'cloudRimBottom',
    'far', 'near', 'rim',
    'ground',
]);

/** Campos numéricos de un keyframe: se interpolan en lineal. */
export const NUMBER_FIELDS = Object.freeze([
    'hazeAmt',          // fuerza de la neblina del horizonte
    'sunSize',          // radio del disco, en unidades del alto de pantalla
    'sunSlits',         // [0,1] rendijas synthwave en la mitad baja del disco
    'sunHalo',          // halo cercano (escenario)
    'sunGlowAmt',       // resplandor ancho alrededor del sol
    'stars',            // [0,1] cuánto cielo estrellado se ve
    'cloudRimTopAmt', 'cloudRimBottomAmt',
    'cloudCover',       // [0,1] fracción de nubes presentes
    'cloudAlpha',       // opacidad de las nubes presentes
    'rimAmt',           // filo de luz en las crestas
    'vignette',         // oscurecimiento de las esquinas
]);

// ---------------------------------------------------------------------------
// Keyframes compartidos por la tarde y el alba.

/** Pleno día: sol alto, cielo azul intenso, nubes blancas. */
const NOON = {
    elev: 60,
    top: '#3a78e0', mid: '#1f47c2', horizon: '#25449e', haze: '#a9ccff', hazeAmt: 0.05,
    sunCore: '#fffaf0', sunEdge: '#fff0c2', sunGlow: '#fff3d6', sunSize: 0.05, sunSlits: 0, sunHalo: 0.45, sunGlowAmt: 0.16,
    stars: 0,
    cloudBody: '#eef3ff', cloudRimTop: '#ffffff', cloudRimTopAmt: 0.9, cloudRimBottom: '#9fb0e2', cloudRimBottomAmt: 0.35, cloudCover: 0.75, cloudAlpha: 0.92,
    far: '#25398c', near: '#182a6c', rim: '#cfe0ff', rimAmt: 0,
    ground: '#ffffff',
    vignette: 0.12,
};

/** Tarde (el nivel empieza hacia las 14:30, con el sol a ~50°). */
const AFTERNOON = {
    ...NOON,
    elev: 30,
    top: '#3571da', mid: '#1e44bb', horizon: '#27459f', hazeAmt: 0.06,
    sunSize: 0.052, sunGlowAmt: 0.18,
    cloudCover: 0.7,
    far: '#24388a', near: '#182a6a',
};

/**
 * Noche cerrada (el sol a 18° o más bajo): el cielo de siempre del juego. Top y
 * horizonte son COLOR_BG_DEEP y COLOR_BG_LIFTED del shader v2; las montañas y el
 * suelo, los colores con los que se diseñó el pixel art.
 */
const NIGHT = {
    elev: -18,
    top: '#04050f', mid: '#0a0b1f', horizon: '#1d1433', haze: '#3a1f55', hazeAmt: 0.30,
    sunCore: '#ffc46b', sunEdge: '#ff3a8a', sunGlow: '#ff5a8a', sunSize: 0.108, sunSlits: 1, sunHalo: 0, sunGlowAmt: 0,
    stars: 1,
    // El filo de arriba de nubes y crestas es la luz de la luna: skyModel lo
    // multiplica por lo alta que está.
    cloudBody: '#161a36', cloudRimTop: '#8f9ce0', cloudRimTopAmt: 0.35, cloudRimBottom: '#5a4a8a', cloudRimBottomAmt: 0, cloudCover: 0.5, cloudAlpha: 0.9,
    far: '#14172e', near: '#0e1024', rim: '#8f9ce0', rimAmt: 0.25,
    ground: '#ffffff',
    vignette: 0.28,
};

// ---------------------------------------------------------------------------
// La tarde: del sol alto a la noche.

/** Última tarde (~17:30): la luz empieza a dorarse. */
const LATE_AFTERNOON = {
    ...AFTERNOON,
    elev: 16,
    top: '#2e62c8', mid: '#2141ab', horizon: '#30429a', haze: '#ffd9a0', hazeAmt: 0.05,
    sunCore: '#fff4d8', sunEdge: '#ffd98a', sunGlow: '#ffe2a8', sunSize: 0.058, sunHalo: 0.5, sunGlowAmt: 0.24,
    cloudBody: '#e6e3f5', cloudRimTop: '#fff6e0', cloudRimTopAmt: 0.8, cloudRimBottom: '#ffc58a', cloudRimBottomAmt: 0.5, cloudCover: 0.8,
    far: '#2a3886', near: '#1c2966', rim: '#ffd9a0', rimAmt: 0.15,
    ground: '#fff2f2',
};

/** Hora dorada: el sol crece, se calienta y le empiezan a salir las rendijas. */
const GOLDEN = {
    ...LATE_AFTERNOON,
    elev: 9,
    top: '#2a4bab', mid: '#352f8e', horizon: '#5a2f78', haze: '#ffb070', hazeAmt: 0.11,
    sunCore: '#ffe7a0', sunEdge: '#ffae52', sunGlow: '#ffb366', sunSize: 0.075, sunSlits: 0.3, sunHalo: 0.55, sunGlowAmt: 0.32,
    stars: 0,
    cloudBody: '#c4acd8', cloudRimTop: '#ffe8c0', cloudRimTopAmt: 0.45, cloudRimBottom: '#ffb36b', cloudRimBottomAmt: 0.85, cloudCover: 0.9,
    far: '#352c78', near: '#241f58', rim: '#ffb36b', rimAmt: 0.45,
    ground: '#ffe6ee',
    vignette: 0.16,
};

/**
 * Ocaso: el sol synthwave asomando sobre la cordillera, con la mitad baja ya
 * detrás de las crestas (que miden hasta 130 unidades: a 0° el disco entero
 * queda tapado). Es el cielo del menú.
 */
const SUNSET = {
    ...GOLDEN,
    elev: 4.5,
    top: '#1b1250', mid: '#3d176a', horizon: '#721c54', haze: '#ff7a4a', hazeAmt: 0.13,
    sunCore: '#ffd36b', sunEdge: '#ff3f8e', sunGlow: '#ff6a8a', sunSize: 0.105, sunSlits: 1, sunHalo: 0.5, sunGlowAmt: 0.34,
    stars: 0.10,
    cloudBody: '#56306f', cloudRimTop: '#ff9ad0', cloudRimTopAmt: 0.12, cloudRimBottom: '#ffae6b', cloudRimBottomAmt: 0.95, cloudCover: 0.95,
    far: '#371e5a', near: '#24143e', rim: '#ff8a5a', rimAmt: 0.7,
    ground: '#ffd6e6',
    vignette: 0.2,
};

/** El sol ya detrás de las montañas: queda el resplandor. */
const SUN_DOWN = {
    ...SUNSET,
    elev: 0,
    top: '#171049', mid: '#35166a', horizon: '#681a50', haze: '#ff6a5a', hazeAmt: 0.12,
    sunCore: '#ffc46b', sunEdge: '#ff3a8a', sunGlow: '#ff5a8a', sunSize: 0.108, sunHalo: 0.45, sunGlowAmt: 0.34,
    stars: 0.22,
    cloudBody: '#43245e', cloudRimBottom: '#ff8a6b', cloudRimBottomAmt: 0.8, cloudRimTopAmt: 0.1, cloudCover: 0.85,
    far: '#2e1a50', near: '#1f1236', rim: '#ff7a6a', rimAmt: 0.5,
    ground: '#ffd0e0',
};

/** Hora azul: queda el resplandor rosa en el horizonte y salen las estrellas. */
const BLUE_HOUR = {
    ...SUN_DOWN,
    elev: -4,
    top: '#100c38', mid: '#28145a', horizon: '#561a4e', haze: '#d8506a', hazeAmt: 0.12,
    sunHalo: 0, sunGlowAmt: 0,
    stars: 0.5,
    cloudBody: '#2c1d4c', cloudRimTop: '#9a8ad8', cloudRimTopAmt: 0.1, cloudRimBottom: '#e0607a', cloudRimBottomAmt: 0.45, cloudCover: 0.75,
    far: '#221640', near: '#170f2e', rim: '#d8607a', rimAmt: 0.25,
    ground: '#e8dcff',
    vignette: 0.24,
};

/** Crepúsculo náutico: casi de noche. */
const DUSK = {
    ...NIGHT,
    elev: -9,
    top: '#080a24', mid: '#140f3a', horizon: '#2e1646', haze: '#7a3a8a', hazeAmt: 0.22,
    stars: 0.85,
    cloudBody: '#1c1a3c', cloudRimTop: '#8f9ce0', cloudRimTopAmt: 0.2, cloudRimBottom: '#7a4a9a', cloudRimBottomAmt: 0.2, cloudCover: 0.6,
    far: '#171a38', near: '#0f1228', rim: '#8f9ce0', rimAmt: 0.15,
    ground: '#e4e8ff',
};

// ---------------------------------------------------------------------------
// El alba: de la noche al sol alto. Más fría y más rosa que la tarde.

/** Primera luz: el horizonte se aclara en azul. */
const FIRST_LIGHT = {
    ...NIGHT,
    elev: -12,
    top: '#060a22', mid: '#0e1640', horizon: '#1e2a5a', haze: '#3a5aa0', hazeAmt: 0.25,
    stars: 0.7,
    cloudBody: '#1a2244', cloudRimTop: '#7a8ad0', cloudRimTopAmt: 0.2, cloudRimBottom: '#5a6ab0', cloudRimBottomAmt: 0.2, cloudCover: 0.55,
    far: '#151c3c', near: '#0e1430', rim: '#6a7ac8', rimAmt: 0.15,
    ground: '#e4eaff',
};

/** Alba azul que se vuelve rosa. */
const BLUE_DAWN = {
    ...FIRST_LIGHT,
    elev: -6,
    top: '#0e1a48', mid: '#1c2864', horizon: '#4e3474', haze: '#ff8aa8', hazeAmt: 0.12,
    stars: 0.3,
    cloudBody: '#3a3a70', cloudRimTop: '#b0b8f0', cloudRimTopAmt: 0.2, cloudRimBottom: '#ffa0b8', cloudRimBottomAmt: 0.6, cloudCover: 0.65,
    far: '#22285a', near: '#161c44', rim: '#ff9ab0', rimAmt: 0.3,
    ground: '#f0e4ff',
    vignette: 0.22,
};

/** Alba rosa: el sol está a punto de salir. */
const PINK_DAWN = {
    ...BLUE_DAWN,
    elev: -1.5,
    top: '#172868', mid: '#302f7a', horizon: '#632a5e', haze: '#ffb09a', hazeAmt: 0.13,
    sunCore: '#ffe6a8', sunEdge: '#ff7a9a', sunGlow: '#ffb0a0', sunSize: 0.1, sunSlits: 0.6, sunHalo: 0.3, sunGlowAmt: 0.25,
    stars: 0.08,
    cloudBody: '#6a5a98', cloudRimTop: '#ffd6e0', cloudRimTopAmt: 0.3, cloudRimBottom: '#ffc0a0', cloudRimBottomAmt: 0.9, cloudCover: 0.75,
    far: '#2c2a66', near: '#1c1c4a', rim: '#ffb09a', rimAmt: 0.55,
    ground: '#ffe6ee',
    vignette: 0.18,
};

/** Sale el sol por encima de las crestas: disco rosa-dorado con rendijas finas. */
const SUNRISE = {
    ...PINK_DAWN,
    elev: 3.5,
    top: '#2140a0', mid: '#332f8c', horizon: '#5c2a62', haze: '#ffc08a', hazeAmt: 0.12,
    sunCore: '#ffd98c', sunEdge: '#ff6f8a', sunGlow: '#ffb098', sunSize: 0.098, sunSlits: 0.55, sunHalo: 0.4, sunGlowAmt: 0.24,
    stars: 0,
    cloudBody: '#a896c8', cloudRimTop: '#fff0e0', cloudRimTopAmt: 0.4, cloudRimBottom: '#ffd0a0', cloudRimBottomAmt: 0.9, cloudCover: 0.8,
    far: '#30327a', near: '#20225a', rim: '#ffc08a', rimAmt: 0.6,
    ground: '#fff0f0',
    vignette: 0.16,
};

/** Primera mañana: el sol ya brilla blanco y dorado. */
const MORNING = {
    ...NOON,
    elev: 14,
    top: '#2b5cc4', mid: '#2442aa', horizon: '#343c8e', haze: '#ffd0a0', hazeAmt: 0.06,
    sunCore: '#fff2cc', sunEdge: '#ffcc84', sunGlow: '#ffe0b0', sunSize: 0.07, sunSlits: 0.15, sunHalo: 0.45, sunGlowAmt: 0.16,
    cloudBody: '#dcdcf5', cloudRimTop: '#ffffff', cloudRimTopAmt: 0.6, cloudRimBottom: '#ffd8b0', cloudRimBottomAmt: 0.6, cloudCover: 0.75,
    far: '#2a3880', near: '#1c2a62', rim: '#ffd8b0', rimAmt: 0.25,
    ground: '#fff6f6',
    vignette: 0.14,
};

/** Mañana (el sol ya alto). */
const LATE_MORNING = {
    ...AFTERNOON,
    elev: 24,
    top: '#3068d0', mid: '#2045b8', horizon: '#2a459c', haze: '#cfe0ff', hazeAmt: 0.035,
};

// ---------------------------------------------------------------------------
// La paleta "dorada" de One Day (T02.6): la luz de una película de piratas.
//
// Teal y oro en vez de neón: el día es un azul marino algo verdoso, el ocaso es
// ámbar y óxido con un sol de oro SIN rendijas (las rendijas son synthwave), la
// noche es azul petróleo y el alba, rosa y oro. Las mismas restricciones que la
// synthwave (el guardián las mide): la franja jugable del cielo se queda oscura
// y la luz dorada la ponen el disco, su halo, las nubes y el reflejo del mar.
// Por eso el horizonte del ocaso es óxido profundo y no naranja claro.

/** Pleno día: azul marino con un punto verdoso, nubes de un blanco cálido. */
const G_NOON = {
    ...NOON,
    top: '#2f6cc0', mid: '#1b4a9a', horizon: '#244c7e', haze: '#d9ecff', hazeAmt: 0.04,
    sunCore: '#fffbf0', sunEdge: '#fff2c8', sunGlow: '#fff1d0',
    cloudBody: '#f4f1ea', cloudRimBottom: '#b9b0a0', cloudCover: 0.6,
    far: '#20406e', near: '#152c4c', rim: '#ffe9c0',
};

/** Tarde: el oro empieza en la neblina. */
const G_AFTERNOON = {
    ...G_NOON,
    elev: 30,
    top: '#2c66b8', mid: '#1b4794', horizon: '#2a4a78', haze: '#ffdcaa', hazeAmt: 0.06,
    sunGlow: '#ffe6b8', sunSize: 0.052, sunGlowAmt: 0.24,
    cloudRimBottom: '#e8c8a0', cloudRimBottomAmt: 0.45,
    far: '#22406a', near: '#16304e', rim: '#ffe2b0', rimAmt: 0.05,
};

/** Media mañana: como la tarde, con la neblina aún fría. */
const G_LATE_MORNING = {
    ...G_AFTERNOON,
    elev: 24,
    haze: '#d9ecff', hazeAmt: 0.035, rimAmt: 0,
};

/** Última tarde: la luz se vuelve oro; nubes color crema con los bajos encendidos. */
const G_LATE_AFTERNOON = {
    ...G_AFTERNOON,
    elev: 16,
    top: '#2b5ca8', mid: '#23448a', horizon: '#3c4870', haze: '#ffc880', hazeAmt: 0.07,
    sunCore: '#fff4d0', sunEdge: '#ffd27a', sunGlow: '#ffd88c', sunSize: 0.06, sunHalo: 0.5, sunGlowAmt: 0.32,
    cloudBody: '#e8dcc8', cloudRimTop: '#fff4dc', cloudRimTopAmt: 0.8, cloudRimBottom: '#ffbf70', cloudRimBottomAmt: 0.55, cloudCover: 0.7,
    far: '#2c3f66', near: '#1d2c48', rim: '#ffcf8a', rimAmt: 0.2,
    ground: '#fff4e6',
};

/** Hora dorada: el sol crece y se vuelve oro viejo; el horizonte se calienta. */
const G_GOLDEN = {
    ...G_LATE_AFTERNOON,
    elev: 9,
    top: '#2a4c94', mid: '#3c3a78', horizon: '#5c3438', haze: '#ffa65a', hazeAmt: 0.07,
    sunCore: '#ffefb0', sunEdge: '#ffb04a', sunGlow: '#ffb860', sunSize: 0.078, sunHalo: 0.55, sunGlowAmt: 0.36,
    cloudBody: '#c9a690', cloudRimTop: '#ffe2b0', cloudRimTopAmt: 0.45, cloudRimBottom: '#ffa85a', cloudRimBottomAmt: 0.85, cloudCover: 0.8,
    far: '#3b3354', near: '#272238', rim: '#ffae5a', rimAmt: 0.5,
    ground: '#fff0e0',
    vignette: 0.16,
};

/** Ocaso: un sol de oro enorme sobre el mar; el cielo, de índigo a óxido. */
const G_SUNSET = {
    ...G_GOLDEN,
    elev: 4.5,
    top: '#1a1a4a', mid: '#461c3e', horizon: '#702a1c', haze: '#ff8a3a', hazeAmt: 0.07,
    sunCore: '#fff1b8', sunEdge: '#ff8a2e', sunGlow: '#ff9a40', sunSize: 0.105, sunHalo: 0.5, sunGlowAmt: 0.4,
    stars: 0.04,
    cloudBody: '#4a2a3e', cloudRimTop: '#ffb07a', cloudRimTopAmt: 0.15, cloudRimBottom: '#ffb050', cloudRimBottomAmt: 0.95, cloudCover: 0.85,
    far: '#3a2030', near: '#241420', rim: '#ff9a4a', rimAmt: 0.7,
    ground: '#ffe0cc',
    vignette: 0.2,
};

/** El sol ya en el agua: queda el oro del resplandor. */
const G_SUN_DOWN = {
    ...G_SUNSET,
    elev: 0,
    top: '#171640', mid: '#3c1a3a', horizon: '#622418', haze: '#ff7030', hazeAmt: 0.07,
    sunCore: '#ffe2a0', sunEdge: '#ff7a28', sunGlow: '#ff8a3a', sunSize: 0.108, sunHalo: 0.45, sunGlowAmt: 0.36,
    stars: 0.1,
    cloudBody: '#3a2034', cloudRimBottom: '#ff8a4a', cloudRimBottomAmt: 0.8, cloudRimTopAmt: 0.1, cloudCover: 0.8,
    far: '#301a28', near: '#1f121c', rim: '#ff8040', rimAmt: 0.5,
    ground: '#ffd8c8',
};

/** Brasas en el horizonte: aquí cae el destello verde, sobre su complementario. */
const G_BLUE_HOUR = {
    ...G_SUN_DOWN,
    elev: -4,
    top: '#10123a', mid: '#281838', horizon: '#4a1c1c', haze: '#d04a2a', hazeAmt: 0.09,
    sunHalo: 0, sunGlowAmt: 0,
    stars: 0.4,
    cloudBody: '#28182e', cloudRimTop: '#8a7ab0', cloudRimTopAmt: 0.1, cloudRimBottom: '#d0603a', cloudRimBottomAmt: 0.45, cloudCover: 0.7,
    far: '#24162a', near: '#170e1c', rim: '#d06040', rimAmt: 0.25,
    ground: '#eadcff',
    vignette: 0.24,
};

/** Noche cerrada: azul petróleo, la luz de la luna en los filos. */
const G_NIGHT = {
    ...NIGHT,
    top: '#03060f', mid: '#06101e', horizon: '#0c1c2c', haze: '#14324a', hazeAmt: 0.25,
    sunCore: '#ffd9a0', sunEdge: '#ff7a28', sunGlow: '#ff8a3a', sunSlits: 0,
    cloudBody: '#101828', cloudRimTop: '#8fa8d0', cloudRimTopAmt: 0.35, cloudRimBottom: '#3a4a6a', cloudCover: 0.45,
    far: '#0e1826', near: '#09101c', rim: '#8fb0d8', rimAmt: 0.25,
};

/** Crepúsculo: lo último del rojo, ya casi de noche. */
const G_DUSK = {
    ...G_NIGHT,
    elev: -9,
    top: '#08102a', mid: '#121a3a', horizon: '#2a1a2a', haze: '#6a2a3a', hazeAmt: 0.18,
    stars: 0.8,
    cloudBody: '#18182e', cloudRimTop: '#7a8ac0', cloudRimTopAmt: 0.2, cloudRimBottom: '#6a3a5a', cloudRimBottomAmt: 0.2, cloudCover: 0.55,
    far: '#141a32', near: '#0d1124', rim: '#7a8ac0', rimAmt: 0.15,
    ground: '#e4e8ff',
};

/** Primera luz: el horizonte se aclara en azul petróleo. */
const G_FIRST_LIGHT = {
    ...G_NIGHT,
    elev: -12,
    top: '#050c1e', mid: '#0a1a34', horizon: '#16304e', haze: '#2a5a7a', hazeAmt: 0.2,
    stars: 0.7,
    cloudBody: '#14203a', cloudRimTop: '#7a90c0', cloudRimTopAmt: 0.2, cloudRimBottom: '#4a6a9a', cloudRimBottomAmt: 0.2, cloudCover: 0.5,
    far: '#121c34', near: '#0c1428', rim: '#6a8ac0', rimAmt: 0.15,
    ground: '#e4eaff',
};

/** Alba que se vuelve rosa: aquí vuelve el destello verde. */
const G_BLUE_DAWN = {
    ...G_FIRST_LIGHT,
    elev: -6,
    top: '#0c1a40', mid: '#1c2a58', horizon: '#46304c', haze: '#ff9a8a', hazeAmt: 0.09,
    stars: 0.3,
    cloudBody: '#34345e', cloudRimTop: '#a8b4e0', cloudRimTopAmt: 0.2, cloudRimBottom: '#ffa898', cloudRimBottomAmt: 0.6, cloudCover: 0.6,
    far: '#202650', near: '#151a3c', rim: '#ffa0a0', rimAmt: 0.3,
    ground: '#f0e4ff',
    vignette: 0.22,
};

/** Alba rosa y oro: el sol está a punto de salir. */
const G_PINK_DAWN = {
    ...G_BLUE_DAWN,
    elev: -1.5,
    top: '#16285e', mid: '#33306e', horizon: '#62303e', haze: '#ffb08a', hazeAmt: 0.09,
    sunCore: '#ffeab0', sunEdge: '#ff9a6a', sunGlow: '#ffb890', sunSize: 0.1, sunSlits: 0, sunHalo: 0.3, sunGlowAmt: 0.26,
    stars: 0.06,
    cloudBody: '#6a5a8a', cloudRimTop: '#ffd8d0', cloudRimTopAmt: 0.3, cloudRimBottom: '#ffc090', cloudRimBottomAmt: 0.9, cloudCover: 0.7,
    far: '#2c2a5a', near: '#1c1c42', rim: '#ffb08a', rimAmt: 0.55,
    ground: '#ffe8ee',
    vignette: 0.18,
};

/** Sale el sol: un disco de oro limpio. */
const G_SUNRISE = {
    ...G_PINK_DAWN,
    elev: 3.5,
    top: '#203c94', mid: '#38347e', horizon: '#643a40', haze: '#ffc080', hazeAmt: 0.09,
    sunCore: '#fff0c0', sunEdge: '#ffa860', sunGlow: '#ffc080', sunSize: 0.098, sunHalo: 0.4, sunGlowAmt: 0.26,
    stars: 0,
    cloudBody: '#b0a0c0', cloudRimTop: '#fff2e0', cloudRimTopAmt: 0.4, cloudRimBottom: '#ffd0a0', cloudRimBottomAmt: 0.9, cloudCover: 0.75,
    far: '#30366e', near: '#20264e', rim: '#ffc080', rimAmt: 0.6,
    ground: '#fff0f0',
    vignette: 0.16,
};

/** Primera mañana: luz blanca y dorada. */
const G_MORNING = {
    ...G_NOON,
    elev: 14,
    top: '#2a5cb4', mid: '#24449a', horizon: '#34467a', haze: '#ffd8a8', hazeAmt: 0.05,
    sunCore: '#fff6dc', sunEdge: '#ffd48c', sunGlow: '#ffe4b8', sunSize: 0.07, sunHalo: 0.45, sunGlowAmt: 0.18,
    cloudBody: '#e4e0f0', cloudRimTop: '#ffffff', cloudRimTopAmt: 0.6, cloudRimBottom: '#ffd8b8', cloudRimBottomAmt: 0.6, cloudCover: 0.65,
    far: '#2a3c70', near: '#1c2c56', rim: '#ffd8b0', rimAmt: 0.25,
    ground: '#fff6f6',
    vignette: 0.14,
};

/**
 * Paletas por nombre (el `palette` de una escena).
 *   synthwave  La de siempre: día azul intenso, ocaso synthwave y noche de neón.
 *   golden     La de One Day (T02.6): teal y oro, sol sin rendijas.
 */
export const SKY_PALETTES = Object.freeze({
    synthwave: compilePalette({
        evening: [NIGHT, DUSK, BLUE_HOUR, SUN_DOWN, SUNSET, GOLDEN, LATE_AFTERNOON, AFTERNOON, NOON],
        morning: [NIGHT, FIRST_LIGHT, BLUE_DAWN, PINK_DAWN, SUNRISE, MORNING, LATE_MORNING, AFTERNOON, NOON],
    }),
    golden: compilePalette({
        evening: [G_NIGHT, G_DUSK, G_BLUE_HOUR, G_SUN_DOWN, G_SUNSET, G_GOLDEN, G_LATE_AFTERNOON, G_AFTERNOON, G_NOON],
        morning: [G_NIGHT, G_FIRST_LIGHT, G_BLUE_DAWN, G_PINK_DAWN, G_SUNRISE, G_MORNING, G_LATE_MORNING, G_AFTERNOON, G_NOON],
    }),
});

// ---------------------------------------------------------------------------

/**
 * Pasa los keyframes a OKLab una sola vez y los ordena por elevación.
 * @param {{ evening: object[], morning: object[] }} def
 */
export function compilePalette(def) {
    const compile = (list) => list
        .map((k) => {
            const lab = {};
            for (const f of COLOR_FIELDS) {
                if (typeof k[f] !== 'string') throw new Error(`paleta: falta el color "${f}" en el keyframe ${k.elev}°`);
                lab[f] = rgbToOklab(hexToRgb(k[f]));
            }
            const num = {};
            for (const f of NUMBER_FIELDS) {
                if (!Number.isFinite(k[f])) throw new Error(`paleta: falta el número "${f}" en el keyframe ${k.elev}°`);
                num[f] = k[f];
            }
            return { elev: k.elev, lab, num, hex: k };
        })
        .sort((a, b) => a.elev - b.elev);
    return Object.freeze({ evening: compile(def.evening), morning: compile(def.morning) });
}

/** Un contenedor de muestra reutilizable (sin asignaciones por frame). */
export function createPaletteSample() {
    const out = {};
    for (const f of COLOR_FIELDS) out[f] = new Float32Array(3);
    for (const f of NUMBER_FIELDS) out[f] = 0;
    return out;
}

const tmpLab = [0, 0, 0];

/**
 * Colores y números del cielo para una elevación del sol.
 *
 * @param {ReturnType<typeof compilePalette>} palette
 * @param {number} elev    Elevación del sol en grados.
 * @param {boolean} rising Mañana (el sol sube) o tarde.
 * @param {ReturnType<typeof createPaletteSample>} out
 */
export function samplePalette(palette, elev, rising, out) {
    const keys = rising ? palette.morning : palette.evening;
    let i = 0;
    while (i < keys.length - 2 && elev > keys[i + 1].elev) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = Math.max(0, Math.min(1, (elev - a.elev) / (b.elev - a.elev)));
    for (const f of COLOR_FIELDS) {
        const la = a.lab[f];
        const lb = b.lab[f];
        tmpLab[0] = la[0] + (lb[0] - la[0]) * t;
        tmpLab[1] = la[1] + (lb[1] - la[1]) * t;
        tmpLab[2] = la[2] + (lb[2] - la[2]) * t;
        oklabToRgb(tmpLab, out[f]);
    }
    for (const f of NUMBER_FIELDS) out[f] = a.num[f] + (b.num[f] - a.num[f]) * t;
    return out;
}
