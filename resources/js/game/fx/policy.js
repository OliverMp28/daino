// La escena manda sobre los efectos (T03.1, doc 11).
//
// Cada escena puede declarar en su entrada del registro (scenes/registry.js) qué
// hacen los efectos en ella, en `fx`:
//
//   allow    lista cerrada: solo esos efectos (lo que declara una historia de autor,
//            que es dueña de su horizonte, su sol y su mar);
//   deny     efectos vetados (el resto, como siempre);
//   temper   cuánto se atenúan los efectos en esta escena [0,1]: un número para
//            todos, o por familia (`{ pulse: 0.6 }`: las demás, enteras);
//   colors   los colores de los efectos en esta escena (`warm`, `cool`): con ellos
//            la canción no elige paleta ni la gira un cambio de tonalidad;
//   hush     familias que se apartan en los instantes clave de su historia
//            (la cámara lenta del destello, un rótulo). Por defecto, el aire.
//
// Sin `fx`, todos los efectos valen. Los de la familia `game` no los toca ninguna
// escena: son parte de lo que se juega.
//
// Así una historia no necesita casos especiales en el shader ni en la partida: lo
// declara, y el director lo cumple.
//
// Puro.

import { hexToRgb } from '../scenes/color.js';
import { FX, FX_FAMILIES } from './registry.js';

const DEFAULT_HUSH = Object.freeze(['air']);

/**
 * @typedef {object} FxPolicy
 * @property {(id: string) => boolean} allows
 * @property {(family: string) => number} temperOf
 * @property {{ warm: number[], cool: number[] } | null} colors
 * @property {(family: string) => boolean} hushes
 */

/**
 * @param {{ fx?: { allow?: string[], deny?: string[], temper?: number | Record<string, number>, colors?: { warm: string, cool: string }, hush?: string[] } } | null | undefined} scene
 * @returns {FxPolicy}
 */
export function sceneFxPolicy(scene) {
    const fx = scene?.fx ?? {};
    const allow = fx.allow ? new Set(fx.allow) : null;
    const deny = new Set(fx.deny ?? []);
    const hush = new Set(fx.hush ?? DEFAULT_HUSH);
    const clamp = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
    return {
        allows(id) {
            const def = FX[id];
            if (def === undefined) return false;
            if (FX_FAMILIES[def.family].fixed) return true;
            if (deny.has(id)) return false;
            return allow === null || allow.has(id);
        },
        temperOf: (family) => (typeof fx.temper === 'object' && fx.temper !== null ? clamp(fx.temper[family]) : clamp(fx.temper)),
        colors: fx.colors ? { warm: hexToRgb(fx.colors.warm), cool: hexToRgb(fx.colors.cool) } : null,
        hushes: (family) => hush.has(family),
    };
}

/**
 * Lo que está mal en la política de una escena (para los tests del registro):
 * ids o familias que no existen, colores mal escritos.
 *
 * @returns {string[]}
 */
export function policyIssues(scene) {
    const fx = scene?.fx;
    if (fx === undefined) return [];
    const out = [];
    for (const id of [...(fx.allow ?? []), ...(fx.deny ?? [])]) {
        if (FX[id] === undefined) out.push(`efecto desconocido "${id}"`);
        else if (FX_FAMILIES[FX[id].family].fixed) out.push(`"${id}" es de la familia game: la escena no lo decide`);
    }
    for (const f of fx.hush ?? []) if (FX_FAMILIES[f] === undefined) out.push(`familia desconocida "${f}"`);
    if (fx.allow && fx.deny) out.push('allow y deny a la vez');
    const tempers = typeof fx.temper === 'object' && fx.temper !== null ? Object.entries(fx.temper) : fx.temper !== undefined ? [['', fx.temper]] : [];
    for (const [family, v] of tempers) {
        if (family !== '' && (FX_FAMILIES[family] === undefined || FX_FAMILIES[family].fixed)) out.push(`temper de una familia que la escena no decide: "${family}"`);
        if (!(v >= 0 && v <= 1)) out.push(`temper ${v}`);
    }
    if (fx.colors) {
        for (const k of ['warm', 'cool']) {
            if (!/^#[0-9a-f]{6}$/i.test(fx.colors[k] ?? '')) out.push(`color ${k} "${fx.colors[k]}"`);
        }
    }
    return out;
}
