// Modelo del cielo (T01): de una HORA a todo lo que se ve.
//
// La hora es continua y puede pasar de 24 (5:00 del día siguiente = 29): así el
// reloj de un nivel nunca retrocede al cruzar la medianoche. De ella salen la
// elevación del sol (y con ella la paleta, palettes.js), dónde está el sol en
// pantalla, la luna, las estrellas, el lucero y la luz de nubes y montañas.
//
// Puro y sin Pixi: el engine lo llama cada frame con la hora del plan
// (skyClock.js) y reparte el resultado entre el shader y las capas; los tests y
// el guardián de legibilidad lo usan tal cual.
//
// Posiciones en "fracción del cielo": x en [0,1] del ancho; y en [0,1] de la
// altura del cielo (0 arriba, 1 el horizonte). El engine las pasa a uv con la
// línea del suelo de la vista, así que valen para cualquier pantalla.

import { hexToRgb, oklabToRgb, rgbToOklab } from './color.js';
import { SKY_PALETTES, createPaletteSample, samplePalette } from './palettes.js';

/** Fases del cielo, en orden, con su nombre para el panel dev. */
export const SKY_PHASES = Object.freeze({
    day: 'Día',
    golden: 'Hora dorada',
    sunset: 'Atardecer',
    dusk: 'Crepúsculo',
    night: 'Noche',
    dawn: 'Alba',
    sunrise: 'Amanecer',
});

/**
 * Forma del degradado del cielo. El shader (background.frag) usa los mismos
 * números: si cambian aquí, cambian allí.
 *   midAt   Fracción del cielo donde manda el color `mid`.
 *   hazeK   Caída de la neblina desde el horizonte (e^(−k·distancia)).
 */
export const SKY_SHAPE = Object.freeze({ midAt: 0.5, hazeK: 14 });

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Hora en [0, 24). */
export function wrapHour(hour) {
    return ((hour % 24) + 24) % 24;
}

/** Hora "de la noche continua": de 12:00 a 35:59 (las 5:00 son 29). */
function nightHour(hour) {
    const h = wrapHour(hour);
    return h < 12 ? h + 24 : h;
}

/** Fase del cielo de una hora (clave de SKY_PHASES). */
export function phaseOfHour(hour) {
    const h = wrapHour(hour);
    if (h >= 6.9 && h < 17.25) return 'day';
    if (h >= 17.25 && h < 18) return 'golden';
    if (h >= 18 && h < 18.8) return 'sunset';
    if (h >= 18.8 && h < 19.5) return 'dusk';
    if (h >= 5 && h < 6.3) return 'dawn';
    if (h >= 6.3 && h < 6.9) return 'sunrise';
    return 'night';
}

/**
 * Elevación del sol en grados para una hora: un arco de `maxElev` entre la
 * salida y la puesta, y bajo el horizonte hasta `maxDepth` a medianoche.
 *
 * @param {number} hour
 * @param {{ rise: number, set: number, maxElev: number, maxDepth: number }} sun
 */
export function sunElevation(hour, sun) {
    const h = wrapHour(hour);
    const day = sun.set - sun.rise;
    if (h >= sun.rise && h <= sun.set) return sun.maxElev * Math.sin(Math.PI * (h - sun.rise) / day);
    const t = ((h - sun.set + 24) % 24) / (24 - day);
    return -sun.maxDepth * Math.sin(Math.PI * t);
}

/** Si el sol va subiendo (de la medianoche solar al mediodía solar). */
export function sunRising(hour, sun) {
    const noon = (sun.rise + sun.set) / 2;
    const midnight = noon + 12;
    return (wrapHour(hour) - (midnight - 24) + 24) % 24 < 12;
}

/** Estado del cielo reutilizable (el engine lo rellena cada frame sin asignar). */
export function createSkyState() {
    const f2 = () => new Float32Array(2);
    const f3 = () => new Float32Array(3);
    const f4 = () => new Float32Array(4);
    return {
        hour: 0,
        phase: 'day',
        elev: 0,
        rising: false,
        /** [0,1] cuánto es noche cerrada (0 con el sol a −8°, 1 a −14°). */
        night: 0,
        sky: { top: f3(), mid: f3(), horizon: f3(), haze: f4() },
        sun: { pos: f2(), radius: 0, core: f3(), edge: f3(), slits: 0, glow: f4(), halo: 0 },
        moon: { pos: f2(), radius: 0, color: f4(), light: 0 },
        stars: { vis: 0, rot: 0 },
        /** Lucero: x, y (fracción del cielo), alpha, tamaño en celdas del arte. */
        lucero: f4(),
        vignette: 0,
        clouds: { body: f3(), rimTop: f3(), rimTopAmt: 0, rimBottom: f3(), rimBottomAmt: 0, cover: 0, alpha: 0 },
        mountains: { far: f3(), near: f3(), rim: f3(), rimAmt: 0 },
        ground: f3(),
        /**
         * El mar (T02.2, solo escenas con `sea`): `far` en la línea del horizonte,
         * `near` en la orilla (seaColorAt interpola entre los dos), las crestas de
         * las olas y el reflejo del sol y de la luna (rgb + fuerza).
         */
        sea: { far: f3(), near: f3(), crest: f3(), crestAmt: 0, sunGlint: f4(), moonGlint: f4() },
        _p: createPaletteSample(),
    };
}

const MOON_LOW = rgbToOklab(hexToRgb('#ffc890'));
const MOON_HIGH = rgbToOklab(hexToRgb('#e8ecff'));
const tmpLab = [0, 0, 0];

/** y en fracción del cielo para una "altura" en [0,1] del arco de un astro. */
function arcY(height, peak, curve) {
    return 1 - (1 - peak) * Math.pow(clamp01(height), curve);
}

/**
 * Todo el cielo para una hora.
 *
 * @param {number} hour
 * @param {import('./registry.js').SceneDef} scene
 * @param {ReturnType<typeof createSkyState>} out
 */
export function skyStateAt(hour, scene, out) {
    const { sun, moon } = scene;
    const elev = sunElevation(hour, sun);
    const rising = sunRising(hour, sun);
    const p = samplePalette(SKY_PALETTES[scene.palette], elev, rising, out._p);
    const hc = nightHour(hour);

    out.hour = hour;
    out.phase = phaseOfHour(hour);
    out.elev = elev;
    out.rising = rising;
    out.night = clamp01((-8 - elev) / 6);

    // ---------- Cielo ----------
    out.sky.top.set(p.top);
    out.sky.mid.set(p.mid);
    out.sky.horizon.set(p.horizon);
    out.sky.haze.set(p.haze);
    out.sky.haze[3] = p.hazeAmt;
    out.vignette = p.vignette;

    // ---------- Sol ----------
    // Sube y baja por un arco de salida (riseX) a puesta (setX). Con la curva < 1
    // se queda alto buena parte de la tarde y cae deprisa hacia el horizonte: la
    // franja donde se juega solo lo tiene detrás en la hora dorada.
    const dayT = (wrapHour(hour) - sun.rise) / (sun.set - sun.rise);
    out.sun.pos[0] = sun.riseX + (sun.setX - sun.riseX) * Math.max(-0.05, Math.min(1.05, dayT));
    out.sun.pos[1] = elev >= 0 ? arcY(elev / sun.maxElev, sun.peak, sun.curve) : 1 + (-elev / 10) * 0.32;
    out.sun.radius = p.sunSize;
    out.sun.core.set(p.sunCore);
    out.sun.edge.set(p.sunEdge);
    out.sun.slits = p.sunSlits;
    // Bajo el horizonte no hay halo: se apaga entre −1° y −6°.
    const presence = clamp01((elev + 6) / 5);
    out.sun.glow[0] = p.sunGlow[0] * presence;
    out.sun.glow[1] = p.sunGlow[1] * presence;
    out.sun.glow[2] = p.sunGlow[2] * presence;
    out.sun.glow[3] = p.sunGlowAmt;
    out.sun.halo = p.sunHalo;

    // ---------- Luna ----------
    // Sale tras el ocaso por la izquierda (fuera de la columna del Dino), cruza
    // y se pone al alba por la derecha. Dorada cerca del horizonte, plateada
    // arriba; la luz del día la apaga.
    const mt = (hc - moon.rise) / (moon.set - moon.rise);
    const mh = mt > 0 && mt < 1 ? Math.sin(Math.PI * mt) : 0;
    out.moon.pos[0] = moon.riseX + (moon.setX - moon.riseX) * clamp01(mt);
    out.moon.pos[1] = mh > 0 ? arcY(mh, moon.peak, moon.curve) : 1.2;
    out.moon.radius = moon.radius;
    const k = clamp01((mh - 0.1) / 0.35);
    for (let i = 0; i < 3; i++) tmpLab[i] = MOON_LOW[i] + (MOON_HIGH[i] - MOON_LOW[i]) * k;
    oklabToRgb(tmpLab, out.moon.color);
    const moonAlpha = mh > 0 ? clamp01((2 - elev) / 8) : 0;
    out.moon.color[3] = moonAlpha;
    out.moon.light = mh > 0 ? Math.min(1, mh * 1.6) * moonAlpha : 0;

    // ---------- Estrellas ----------
    // El cielo gira despacio alrededor de un polo fuera de pantalla: es el paso
    // del tiempo de la noche (medido desde las 18:00).
    out.stars.vis = p.stars;
    out.stars.rot = (hc - 18) * scene.starRotPerHour;

    // ---------- Lucero ----------
    out.lucero[2] = 0;
    for (const l of scene.luceros) {
        if (hc < l.from || hc > l.to) continue;
        const t = (hc - l.from) / (l.to - l.from);
        const fade = Math.min(clamp01((hc - l.from) / l.fadeIn), clamp01((l.to - hc) / l.fadeOut));
        // Solo con el cielo ya oscuro: de 0 con el sol a 0.5° a 1 con el sol a −3.5°.
        const dark = clamp01((0.5 - elev) / 4);
        out.lucero[0] = l.x0 + (l.x1 - l.x0) * t;
        out.lucero[1] = l.y0 + (l.y1 - l.y0) * t;
        out.lucero[2] = fade * dark;
        out.lucero[3] = l.size;
        break;
    }

    // ---------- Nubes, montañas, suelo ----------
    // De noche, el filo de arriba es la luz de la luna: tanto como alta esté.
    const moonlit = 1 + (out.moon.light - 1) * out.night;
    out.clouds.body.set(p.cloudBody);
    out.clouds.rimTop.set(p.cloudRimTop);
    out.clouds.rimTopAmt = p.cloudRimTopAmt * moonlit;
    out.clouds.rimBottom.set(p.cloudRimBottom);
    out.clouds.rimBottomAmt = p.cloudRimBottomAmt;
    out.clouds.cover = p.cloudCover;
    out.clouds.alpha = p.cloudAlpha;
    out.mountains.far.set(p.far);
    out.mountains.near.set(p.near);
    out.mountains.rim.set(p.rim);
    out.mountains.rimAmt = p.rimAmt * moonlit;
    out.ground.set(p.ground);

    if (scene.sea) seaStateAt(out, scene.sea);
    return out;
}

// ---------------------------------------------------------------------------
// El mar (T02.2)

/**
 * Cuánto se parece el mar al cielo que refleja: casi todo en el horizonte (a
 * ras del agua refleja mucho) y poco en la orilla, donde se ve el agua de verdad.
 * Y cuánto se oscurece (L de OKLab): el mar es el fondo de contraste de la franja
 * del ptero y los cactus, como las montañas en la Cordillera (el guardián lo mide).
 */
const SEA_SHAPE = Object.freeze({
    reflectFar: 0.62,
    reflectNear: 0.3,
    darkFar: 0.8,
    darkNear: 0.66,
    /** Las crestas: la luz del cielo bajo sobre el agua, más tenue de noche. */
    crestDay: 0.5,
    crestNight: 0.24,
});

const labA = [0, 0, 0];
const labB = [0, 0, 0];
const deepCache = new Map();
const skyTmp = [0, 0, 0];

/** OKLab de un hex, una vez por color (las escenas declaran pocos). */
function deepLab(hex) {
    let lab = deepCache.get(hex);
    if (!lab) {
        lab = rgbToOklab(hexToRgb(hex));
        deepCache.set(hex, lab);
    }
    return lab;
}

/** Mezcla en OKLab `sky` (rgb) con `deep` (lab) y oscurece: el agua a una distancia. */
function waterColor(sky, deep, reflect, dark, out) {
    rgbToOklab(sky, labA);
    labB[0] = (deep[0] + (labA[0] - deep[0]) * reflect) * dark;
    labB[1] = deep[1] + (labA[1] - deep[1]) * reflect;
    labB[2] = deep[2] + (labA[2] - deep[2]) * reflect;
    oklabToRgb(labB, out);
}

/**
 * El mar de una hora: el cielo que refleja (con su neblina a ras del horizonte y
 * el cenit en la orilla), las crestas y el reflejo de los astros. El reflejo del
 * sol es más largo y fuerte con el sol bajo, y se apaga cuando se ha puesto.
 *
 * @param {ReturnType<typeof createSkyState>} out  Con el cielo ya calculado.
 * @param {{ deep: string }} sea
 */
function seaStateAt(out, sea) {
    const S = SEA_SHAPE;
    const deep = deepLab(sea.deep);
    waterColor(skyColorAt(out, 1, skyTmp), deep, S.reflectFar, S.darkFar, out.sea.far);
    waterColor(out.sky.top, deep, S.reflectNear, S.darkNear, out.sea.near);

    // Crestas: el color del cielo a ras del agua, aclarado.
    skyColorAt(out, 0.9, skyTmp);
    for (let i = 0; i < 3; i++) out.sea.crest[i] = Math.min(1, skyTmp[i] + (1 - skyTmp[i]) * 0.35);
    out.sea.crestAmt = S.crestDay + (S.crestNight * (0.4 + 0.6 * out.moon.light) - S.crestDay) * out.night;

    // Reflejo del sol: de −0.5° (puesto) a +1.5° aparece; con el sol alto se queda
    // en un brillo corto.
    const elev = out.elev;
    const sunIn = clamp01((elev + 0.5) / 2);
    const low = 1 - clamp01((elev - 6) / 29);
    const g = out.sea.sunGlint;
    for (let i = 0; i < 3; i++) g[i] = out.sun.core[i] + (out.sun.edge[i] - out.sun.core[i]) * 0.45;
    g[3] = sunIn * (0.3 + 0.62 * low);

    // Reflejo de la luna: tanto como la luz que da.
    const m = out.sea.moonGlint;
    m[0] = out.moon.color[0];
    m[1] = out.moon.color[1];
    m[2] = out.moon.color[2];
    m[3] = out.moon.light * 0.85;
}

/**
 * Color del mar a una distancia: 0 en la línea del horizonte, 1 en la orilla.
 * El mismo que pinta la capa `sea` (bandas) y el que mide el guardián.
 *
 * @param {ReturnType<typeof createSkyState>} state
 * @param {number} t
 * @param {number[] | Float32Array} [out]
 */
export function seaColorAt(state, t, out = [0, 0, 0]) {
    const k = Math.pow(clamp01(t), 0.7);
    rgbToOklab(state.sea.far, labA);
    rgbToOklab(state.sea.near, labB);
    for (let i = 0; i < 3; i++) labA[i] += (labB[i] - labA[i]) * k;
    return oklabToRgb(labA, out);
}

/**
 * Color del cielo a una altura, igual que lo pinta el shader (sin sol, luna ni
 * efectos). Lo usan el guardián de legibilidad y el degradado CSS de
 * `prefers-reduced-motion`.
 *
 * @param {ReturnType<typeof createSkyState>} state
 * @param {number} yFrac  0 arriba, 1 el horizonte.
 * @param {number[] | Float32Array} [out]
 */
export function skyColorAt(state, yFrac, out = [0, 0, 0]) {
    const smooth = (e0, e1, x) => {
        const t = clamp01((x - e0) / (e1 - e0));
        return t * t * (3 - 2 * t);
    };
    const { top, mid, horizon, haze } = state.sky;
    const a = smooth(0, SKY_SHAPE.midAt, yFrac);
    const b = smooth(SKY_SHAPE.midAt, 1, yFrac);
    const bb = b * b;
    const hazeK = haze[3] * Math.exp(-(1 - Math.min(yFrac, 1)) * SKY_SHAPE.hazeK);
    for (let i = 0; i < 3; i++) {
        const c = top[i] + (mid[i] - top[i]) * a;
        out[i] = Math.min(1, c + (horizon[i] - c) * bb + haze[i] * hazeK);
    }
    return out;
}
