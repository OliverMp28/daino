// Señales de los efectos (T03.1): todo a lo que un efecto puede reaccionar, en un
// solo objeto que se rellena cada fotograma. Quien pinta no pregunta al audio, a
// la partida ni al cielo: lee de aquí.
//
//   live   lo que suena ahora (el engine, del AnalyserNode).
//   beat   el pulso de la canción (la partida, de los beats del chart).
//   song   la estructura (la partida, de systems/songDirector.js).
//   speed  la velocidad que se ve (la partida, de systems/speedCues.js).
//   sky    la hora del cielo y el clima de la escena (el engine, de scenes/skyModel.js).
//   hush   [0,1] un instante clave de una historia de autor: los efectos se apartan.
//
// Puro: un objeto plano, sin asignaciones por fotograma.

import { GROUND_OFFSET_PX, WORLD_VIEW } from '../config.js';
import { relativeLuminance } from '../scenes/color.js';
import { skyColorAt } from '../scenes/skyModel.js';
import { FX_LIMIT } from './limiter.js';

/**
 * @typedef {ReturnType<typeof createFxSignals>} FxSignals
 */

const skyTmp = [0, 0, 0];

/**
 * El cielo como señal de los efectos: el sol late si hay sol, las estrellas si es
 * de noche, las motas se van si llueve. Se llama cuando cambia la hora.
 *
 * @param {ReturnType<import('../scenes/skyModel.js').createSkyState>} state
 * @param {{ horizonRise?: number }} scene
 * @param {FxSignals} s
 * @param {number} [viewHeight]  Alto de la vista en unidades de mundo.
 */
export function readSkySignals(state, scene, s, viewHeight = WORLD_VIEW.targetHeight) {
    const sky = s.sky;
    sky.night = state.night;
    sky.stars = state.stars.vis;
    sky.sunUp = Math.max(0, Math.min(1, (state.elev + 2) / 4));
    sky.precip = Math.max(state.arc.rain, state.arc.snow);
    // Lo más claro del cielo por encima de la franja jugable: el tope del bombeo
    // (flashSafety.js). Dentro de la franja manda el limitador.
    const rise = scene.horizonRise ?? 0;
    const skyH = Math.max(1, viewHeight - GROUND_OFFSET_PX - rise);
    const topFrac = Math.max(0, Math.min(1, 1 - (FX_LIMIT.playTopPx - rise) / skyH));
    let maxLuma = 0;
    for (let k = 0; k <= 4; k++) {
        const l = relativeLuminance(skyColorAt(state, (topFrac * k) / 4, skyTmp));
        if (l > maxLuma) maxLuma = l;
    }
    sky.maxLuma = maxLuma;
    return s;
}

export function createFxSignals() {
    return {
        /** Hay partida sonando (audio conectado). */
        playing: false,
        live: { bass: 0, mid: 0, high: 0, rms: 0 },
        beat: {
            /** [0,1] 1 en el golpe, cae hasta el siguiente. */
            pulse: 0,
            /** Como `pulse`, más el contratiempo en las subidas (lo que late en el mundo). */
            world: 0,
            /** El pulso solo en el primer tiempo del compás. */
            accent: 0,
        },
        song: {
            /** [0,1] intensidad del tramo, suavizada. */
            intensity: 0,
            /** [0,1] el clímax, con su fundido. */
            climax: 0,
            /** [0,1] subida hacia un drop. */
            build: 0,
            /** [0,1] el mundo contiene la respiración (un break). */
            calm: 0,
            /** Giro de color por los cambios de tonalidad, en vueltas. */
            hue: 0,
            /** [0,1] destello de un momento (drop, lift, marcha, portal), ya con su caída. */
            flash: 0,
        },
        speed: {
            /** [0,1] cuántas líneas de velocidad pide el nivel. */
            lines: 0,
        },
        sky: {
            /** [0,1] noche cerrada. */
            night: 0,
            /** [0,1] cuánto cielo estrellado se ve. */
            stars: 0,
            /** [0,1] el sol sobre el horizonte. */
            sunUp: 1,
            /** [0,1] lluvia o nieve de la escena a esta hora. */
            precip: 0,
            /** Luminancia del punto más claro del cielo por encima de la franja jugable. */
            maxLuma: 0,
        },
        hush: 0,
    };
}

/** Deja las señales de la música a cero (fin de la partida). El cielo no se toca. */
export function clearMusicSignals(s) {
    s.playing = false;
    s.live.bass = 0;
    s.live.mid = 0;
    s.live.high = 0;
    s.live.rms = 0;
    s.beat.pulse = 0;
    s.beat.world = 0;
    s.beat.accent = 0;
    s.song.intensity = 0;
    s.song.climax = 0;
    s.song.build = 0;
    s.song.calm = 0;
    s.song.hue = 0;
    s.song.flash = 0;
    s.speed.lines = 0;
    s.hush = 0;
}

/**
 * Lo que empuja la partida cada fotograma (engine.setMusic): solo las claves que
 * se pasan cambian.
 *
 * @param {FxSignals} s
 * @param {{ pulse?: number, worldPulse?: number, accent?: number, intensity?: number, climax?: number,
 *   build?: number, calm?: number, hue?: number, flash?: number, lines?: number, hush?: number }} f
 */
export function applyMusicFrame(s, f) {
    if (f.pulse !== undefined) s.beat.pulse = f.pulse;
    if (f.worldPulse !== undefined) s.beat.world = f.worldPulse;
    if (f.accent !== undefined) s.beat.accent = f.accent;
    if (f.intensity !== undefined) s.song.intensity = f.intensity;
    if (f.climax !== undefined) s.song.climax = f.climax;
    if (f.build !== undefined) s.song.build = f.build;
    if (f.calm !== undefined) s.song.calm = f.calm;
    if (f.hue !== undefined) s.song.hue = f.hue;
    if (f.flash !== undefined) s.song.flash = f.flash;
    if (f.lines !== undefined) s.speed.lines = f.lines;
    if (f.hush !== undefined) s.hush = f.hush;
}
