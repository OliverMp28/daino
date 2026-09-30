// Guardián de legibilidad del escenario (T01, doc 11 §2.3).
//
// El cielo cambia con la hora, pero lo que se juega no puede perderse delante
// de él. Para cada altura donde puede haber juego, compara el color de lo que
// está ahí (el Dino, cada obstáculo del registro, los portales) con lo que
// tiene detrás a esa altura: el cielo y, más abajo, las montañas.
//
// Umbrales (contraste WCAG de luminancia):
//   dino      4.5:1  el jugador se lee siempre sin esfuerzo;
//   cactus    3:1    WCAG 1.4.11 (gráficos que hay que percibir);
//   colored   2.5:1  rosa, violeta, naranja y los portales. Calibrado con una
//                    maqueta de tres cielos de día con los sprites reales: con 3:1
//                    el cielo de la franja jugable tendría que ser más oscuro que
//                    el azul puro (#0000ff tiene luminancia 0.072) y el día se lee
//                    como tarde avanzada; con 2.5:1 el ptero rosa sobre azul real
//                    se lee sin problema por la diferencia de tono.
// No se miden el disco y el halo del sol ni la luna: son locales y un obstáculo
// los cruza en décimas.
//
// Las alturas y los colores salen del registro de obstáculos (config.js) y de la
// paleta del pixel art (assets/palette.js): un obstáculo nuevo entra solo en la
// prueba, y si su sprite no tiene color asignado aquí, la prueba lo dice.
//
// Lo que hay detrás lo declara cada tipo de capa (backdrops.js, T02.2): montañas,
// mar, islas, el faro… Y el cielo empieza en el horizonte de la escena
// (`horizonRise`), no siempre en el suelo.

import { PALETTE } from '../assets/palette.js';
import { CORRIDOR_HEIGHT_PX, GROUND_OFFSET_PX, MODE_COLORS, OBSTACLE_KIND, WORLD_VIEW } from '../config.js';
import { sceneBackdrops } from './backdrops.js';
import { contrastRatio, hexToRgb } from './color.js';
import { skyColorAt } from './skyModel.js';

export const READABILITY_RULES = Object.freeze({
    dino: 4.5,
    cactus: 3,
    colored: 2.5,
    /** Techo de la cabeza del Dino: doble salto medido ≤ 280 de pies + 84 de cuerpo. */
    dinoTopPx: 364,
    /** Cada cuántas unidades de altura se muestrea. */
    stepPx: 8,
});

/** Carácter de la paleta que domina cada sprite de obstáculo (su cuerpo). */
export const SPRITE_BODY = Object.freeze({
    cactusSmall: 'G',
    cactusWide: 'G',
    pteroA: 'P',
    crystal: 'V',
    crystalSharp: 'P',
    orbA: 'r',
});

/** Carácter del cuerpo de un sprite (las hileras de cactus son cactus). */
export function spriteBody(sprite) {
    if (sprite.startsWith('cactusRow')) return 'G';
    return SPRITE_BODY[sprite] ?? null;
}

/**
 * Lo que se juega: color, umbral y franja de alturas sobre el suelo (unidades
 * de mundo). Sale del registro de obstáculos.
 *
 * @returns {Array<{ id: string, color: number[], min: number, from: number, to: number }>}
 */
export function playSubjects() {
    const R = READABILITY_RULES;
    const out = [{ id: 'Dino', color: hexToRgb(PALETTE.W), min: R.dino, from: 0, to: R.dinoTopPx }];
    const seen = new Set();
    for (const [kind, def] of Object.entries(OBSTACLE_KIND)) {
        const sprite = def.sprites[0];
        const ch = spriteBody(sprite);
        if (ch === null) throw new Error(`readability: el sprite "${sprite}" (${kind}) no tiene color en SPRITE_BODY`);
        const from = def.surface === 'ceiling' ? CORRIDOR_HEIGHT_PX - def.altitude - def.h : def.altitude;
        const to = def.surface === 'ceiling' ? CORRIDOR_HEIGHT_PX - def.altitude : def.altitude + def.h;
        const key = `${ch}:${from}:${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: kind, color: hexToRgb(PALETTE[ch]), min: ch === 'G' ? R.cactus : R.colored, from, to });
    }
    // Los portales de modo, del suelo a lo alto del pasillo.
    for (const [mode, color] of Object.entries(MODE_COLORS)) {
        const hex = `#${color.toString(16).padStart(6, '0')}`;
        out.push({ id: `portal:${mode}`, color: hexToRgb(hex), min: R.colored, from: 0, to: CORRIDOR_HEIGHT_PX });
    }
    return out;
}

/**
 * Fracción del cielo (0 arriba, 1 el horizonte) de una altura sobre el suelo.
 * `horizonRise`: el horizonte de la escena sobre el suelo (0 en la Cordillera).
 */
export function heightToSkyFrac(heightPx, viewHeight = WORLD_VIEW.targetHeight, horizonRise = 0) {
    return 1 - (heightPx - horizonRise) / (viewHeight - GROUND_OFFSET_PX - horizonRise);
}

/**
 * Fallos de legibilidad de un estado del cielo. Vacío = todo se lee.
 *
 * @param {ReturnType<import('./skyModel.js').createSkyState>} state
 * @param {import('./registry.js').SceneDef} scene
 * @returns {Array<{ subject: string, heightPx: number, backdrop: string, ratio: number, min: number }>}
 */
export function checkReadability(state, scene) {
    const R = READABILITY_RULES;
    const rise = scene.horizonRise ?? 0;
    const spans = sceneBackdrops(scene);
    // Por debajo del horizonte, o de lo que alguna capa tapa siempre, no asoma el cielo.
    const skyFrom = Math.max(rise, ...spans.map((b) => b.solid));
    const failures = [];
    const tmp = [0, 0, 0];
    for (const s of playSubjects()) {
        for (let h = s.from; h <= s.to; h += R.stepPx) {
            const backdrops = [];
            if (h >= skyFrom) backdrops.push(['cielo', skyColorAt(state, heightToSkyFrac(h, undefined, rise), tmp).slice()]);
            for (const b of spans) {
                if (h >= b.from && h <= b.to) backdrops.push([b.id, Array.from(b.colorAt(state, h, tmp))]);
            }
            for (const [name, color] of backdrops) {
                const ratio = contrastRatio(s.color, color);
                if (ratio < s.min) failures.push({ subject: s.id, heightPx: h, backdrop: name, ratio, min: s.min });
            }
        }
    }
    return failures;
}
