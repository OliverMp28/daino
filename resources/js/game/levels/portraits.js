// Retratos: el motor de los repartos por el carácter de la canción.
//
// Un REPARTO elige, entre las entradas de una tabla (los ambientes de un
// escenario, las paletas de los efectos, las firmas del cielo), la que pega con
// cómo suena una canción. Lo usan scenes/sceneCasting.js (T02.5) y fx/casting.js
// (T03.3): las reglas son las mismas y viven aquí, una sola vez.
//
// Cada entrada declara una o varias RUTAS: un retrato de las canciones que le
// pegan, hecho de condiciones sobre los rasgos (levels/songTraits.js). El encaje
// de una ruta es el PRODUCTO de sus condiciones (todas tienen que cumplirse: un
// solo rasgo no basta para proponer nada), y el de una entrada, el de su mejor
// ruta. Se propone la mejor entrada si
//   - encaja de verdad (`minFit`), y
//   - le saca ventaja a la segunda (`minMargin`): una canción que pega igual con
//     dos entradas distintas no tiene un encaje claro.
// Si no, null: la red (lo de siempre). Una propuesta equivocada es peor que
// ninguna.
//
// Solo se ejecuta donde está el análisis del servidor (worker, horneado,
// `cast`): no viaja en el bundle del juego.
//
// Puro: mismos rasgos ⇒ misma propuesta.

import { buildMusicModel } from './musicModel.js';
import { ramp, songTraits } from './songTraits.js';

/**
 * Una ruta. Condición `[rasgo, from, to]`: rampa de 0 en `from` a 1 en `to`
 * (bajando si `from > to`). `why`: cómo suena la canción cuando entra por ella.
 *
 * @param {string} id
 * @param {string} why
 * @param {Array<[string, number, number]>} when
 */
export function route(id, why, when) {
    return Object.freeze({ id, why, when: Object.freeze(when.map((c) => Object.freeze(c))) });
}

/** Encaje de una ruta: producto de sus condiciones. */
export function routeFit(r, traits) {
    let fit = 1;
    for (const [name, from, to] of r.when) {
        fit *= ramp(traits[name], from, to);
        if (fit === 0) break;
    }
    return fit;
}

/**
 * Encaje de cada entrada de la tabla (el de su mejor ruta), de más a menos.
 * Orden estable: a igualdad, el de la tabla.
 *
 * @param {Record<string, number>} traits
 * @param {Record<string, ReadonlyArray<ReturnType<typeof route>>>} table
 * @returns {Array<{ id: string, fit: number, route: string, why: string }>}
 */
export function rankPortraits(traits, table) {
    const ranking = [];
    for (const [id, routes] of Object.entries(table)) {
        let best = null;
        for (const r of routes) {
            const fit = routeFit(r, traits);
            if (best === null || fit > best.fit) best = { fit, route: r };
        }
        if (best !== null) ranking.push({ id, fit: round3(best.fit), route: best.route.id, why: best.route.why });
    }
    ranking.sort((a, b) => b.fit - a.fit);
    return ranking;
}

/**
 * La entrada que se propone, con la red.
 *
 * @param {ReturnType<typeof rankPortraits>} ranking
 * @param {{ minFit: number, minMargin: number }} rules
 * @returns {{ id: string | null, reason: 'clear' | 'weak' | 'ambiguous', fit: number, route: string | null, why: string | null }}
 *   'weak': ninguna encaja; 'ambiguous': dos encajan casi igual. `fit`, `route`
 *   y `why` son los de la mejor, se proponga o no.
 */
export function pickPortrait(ranking, rules) {
    const [first, second] = ranking;
    // Sin ningún encaje, ninguna ruta dice nada de la canción.
    const top = first !== undefined && first.fit > 0 ? first : { id: null, fit: 0, route: null, why: null };
    let reason = 'clear';
    if (top.fit < rules.minFit) reason = 'weak';
    else if (second !== undefined && top.fit - second.fit < rules.minMargin) reason = 'ambiguous';
    return { id: reason === 'clear' ? top.id : null, reason, fit: top.fit, route: top.route, why: top.why };
}

/**
 * Rasgos de la canción de un análisis (el del servidor; con el del navegador o
 * el de un analizador antiguo, null). Nunca lanza: un reparto no puede impedir
 * chartear un nivel.
 *
 * @param {object | null} analysis
 * @returns {{ traits: ReturnType<typeof songTraits>, error: string | null }}
 */
export function traitsOfAnalysis(analysis) {
    if (analysis === null || typeof analysis !== 'object' || !(analysis.formatVersion >= 2)) return { traits: null, error: null };
    try {
        return { traits: songTraits(buildMusicModel(analysis)), error: null };
    } catch (err) {
        return { traits: null, error: String(err?.message ?? err) };
    }
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
