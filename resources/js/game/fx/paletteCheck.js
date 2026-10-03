// Las tres medidas de una paleta de efectos (T03.3, doc 11).
//
// Una paleta es una intención: lo que se pinta es lo que queda tras ponerla a
// juego con el cielo de detrás (tones.js). Así que se mide ESO, en todas las
// escenas y a todas las horas:
//
//   ESTABLE   su tono no salta entre dos horas vecinas. Un color casi opuesto al
//             cielo cae a un lado u otro según la hora: el oro pasaba de cian a
//             rosa a media tarde, un cambio de color a mitad de canción.
//   VIVA      conserva su croma: un color muy claro, girado, puede no caber en
//             sRGB y quedarse en un pastel sin color.
//   DISTINTA  se distingue de todas las demás, a cualquier hora. Dos paletas que
//             el cielo deja iguales son una sola.
//
// Solo medidas (no viaja en el bundle): las usan los tests y quien diseñe una
// paleta nueva.
//
// Puro.

import { rgbToOklab } from '../scenes/color.js';
import { SCENES } from '../scenes/registry.js';
import { createSkyState, skyStateAt } from '../scenes/skyModel.js';
import { createFxSignals, readSkySignals } from './signals.js';
import { harmonize, hueOf } from './tones.js';

export const PALETTE_RULES = Object.freeze({
    /** Horas que se recorren (continuas) y su paso: 0.05 h son unos 0.8 s de un atardecer. */
    hours: Object.freeze([13, 30.6]),
    stepH: 0.05,
    /** Salto de tono máximo entre dos horas vecinas (grados). */
    maxHueJumpDeg: 15,
    /** Croma mínima que conserva cada color, frente a la de su intención. */
    minChromaKept: 0.6,
    /** Distancia mínima entre dos paletas (OKLab, media de sus dos colores; 0.02 ya se nota). */
    minDistance: 0.09,
});

const lab = (c) => rgbToOklab(c, [0, 0, 0]);
const chromaOf = (c) => {
    const l = lab(c);
    return Math.hypot(l[1], l[2]);
};
const distance = (a, b) => {
    const x = lab(a);
    const y = lab(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const hueGap = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/**
 * Mide las paletas en los ambientes (las historias fijan sus colores).
 *
 * @param {Record<string, { warm: ArrayLike<number>, cool: ArrayLike<number> }>} palettes
 * @param {{ scenes?: string[], rules?: typeof PALETTE_RULES }} [opts]
 * @returns {{
 *   palettes: Record<string, { hueJump: number, hueJumpAt: string, chromaKept: number, chromaKeptAt: string }>,
 *   pairs: Array<{ a: string, b: string, distance: number, at: string }>,
 * }}  Lo peor de cada paleta y la distancia mínima de cada pareja, con dónde ocurre.
 */
export function measurePalettes(palettes, opts = {}) {
    const rules = opts.rules ?? PALETTE_RULES;
    const scenes = opts.scenes ?? Object.values(SCENES).filter((s) => s.kind === 'ambient').map((s) => s.id);
    const ids = Object.keys(palettes);
    const out = Object.fromEntries(ids.map((id) => [id, { hueJump: 0, hueJumpAt: '', chromaKept: 1, chromaKeptAt: '' }]));
    const pairs = new Map();
    const intent = Object.fromEntries(ids.map((id) => [id, [chromaOf(palettes[id].warm), chromaOf(palettes[id].cool)]]));

    for (const sceneId of scenes) {
        const scene = SCENES[sceneId];
        const state = createSkyState();
        const signals = createFxSignals();
        const before = {};
        for (let h = rules.hours[0]; h <= rules.hours[1] + 1e-9; h += rules.stepH) {
            skyStateAt(h, scene, state);
            readSkySignals(state, scene, signals);
            const at = `${sceneId} ${h.toFixed(2)} h`;
            const seen = {};
            for (const id of ids) {
                const colors = [
                    harmonize(palettes[id].warm, signals.sky.band, [0, 0, 0]),
                    harmonize(palettes[id].cool, signals.sky.band, [0, 0, 0]),
                ];
                seen[id] = colors;
                colors.forEach((c, k) => {
                    const hue = hueOf(c);
                    const last = before[`${id}:${k}`];
                    if (last !== undefined && hueGap(hue, last) > out[id].hueJump) {
                        out[id].hueJump = hueGap(hue, last);
                        out[id].hueJumpAt = at;
                    }
                    before[`${id}:${k}`] = hue;
                    const kept = intent[id][k] > 1e-4 ? chromaOf(c) / intent[id][k] : 1;
                    if (kept < out[id].chromaKept) {
                        out[id].chromaKept = kept;
                        out[id].chromaKeptAt = at;
                    }
                });
            }
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = seen[ids[i]];
                    const b = seen[ids[j]];
                    // Dos colores son un conjunto: cálido con cálido, o cruzados, lo que se parezca más.
                    const d = Math.min(
                        (distance(a[0], b[0]) + distance(a[1], b[1])) / 2,
                        (distance(a[0], b[1]) + distance(a[1], b[0])) / 2,
                    );
                    const key = `${ids[i]}~${ids[j]}`;
                    const worst = pairs.get(key);
                    if (worst === undefined || d < worst.distance) pairs.set(key, { a: ids[i], b: ids[j], distance: d, at });
                }
            }
        }
    }
    return { palettes: out, pairs: [...pairs.values()].sort((x, y) => x.distance - y.distance) };
}

/**
 * Lo que una paleta no cumple (vacío si todo va bien).
 *
 * @param {ReturnType<typeof measurePalettes>} measured
 * @param {typeof PALETTE_RULES} [rules]
 * @returns {string[]}
 */
export function paletteIssues(measured, rules = PALETTE_RULES) {
    const issues = [];
    for (const [id, m] of Object.entries(measured.palettes)) {
        if (m.hueJump > rules.maxHueJumpDeg) issues.push(`${id}: su tono salta ${m.hueJump.toFixed(0)}° (${m.hueJumpAt})`);
        if (m.chromaKept < rules.minChromaKept) issues.push(`${id}: se queda en el ${(m.chromaKept * 100).toFixed(0)} % de su croma (${m.chromaKeptAt})`);
    }
    for (const p of measured.pairs) {
        if (p.distance < rules.minDistance) issues.push(`${p.a} y ${p.b} se confunden: ${p.distance.toFixed(3)} (${p.at})`);
    }
    return issues;
}
