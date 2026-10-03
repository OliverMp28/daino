// El escenario "Automático" de un nivel: qué ambiente pega con cómo suena su
// canción (T02.5, doc 11 §3).
//
// Decisión del user al diseñar el T02: Automático = por el carácter de la
// canción, CON RED. El análisis del servidor propone un ambiente solo si el
// encaje es claro; si no, la Cordillera (el escenario de siempre). El audio no
// dice "piratas" ni "Navidad": dice si una canción es intensa, sombría, un bucle
// de club o una pieza quieta, y eso es lo que se usa (levels/songTraits.js).
//
// Cada ambiente declara en SCENE_CASTING una o varias RUTAS: un retrato de las
// canciones que le pegan, hecho de condiciones sobre los rasgos. Cómo se mide el
// encaje y cuándo se propone algo (encaje mínimo, ventaja sobre el segundo, y si
// no la red: la Cordillera) está en levels/portraits.js, el motor que comparten
// todos los repartos. Una propuesta equivocada es peor que ninguna.
//
// Quien sube un nivel ve la propuesta en el selector de su ficha y la cambia si
// quiere; el escenario no toca el juego (§2.9). Se calcula donde se chartea con
// el análisis del servidor (scripts/lib/chartFromAnalysis.mjs: worker del
// analizador y horneado de oficiales) y se guarda en `levels.scene_auto`.
//
// Añadir un ambiente = su entrada en el registro (registry.js) y aquí sus rutas
// (o ninguna: nunca se propone). Cambiar una regla cambia el escenario de los
// niveles: sube SCENE_CASTING_VERSION y vuelve a repartir (`cast-scenes`).
//
// Puro: mismo análisis ⇒ misma propuesta.

import { pickPortrait, rankPortraits, route, routeFit, traitsOfAnalysis } from '../levels/portraits.js';

export { routeFit };

export const SCENE_CASTING_VERSION = 1;

export const CASTING_RULES = Object.freeze({
    /** Encaje mínimo del mejor ambiente [0,1]. */
    minFit: 0.45,
    /** Ventaja mínima sobre el segundo. */
    minMargin: 0.15,
});

/** Rasgos de songTraits.js que pueden usar las condiciones. */
export const TRAIT_NAMES = Object.freeze(['arousal', 'valence', 'drama', 'groove', 'sparkle', 'brightHits', 'shimmer', 'stillness']);

/**
 * Rutas de cada ambiente. Condición `[rasgo, from, to]`: rampa de 0 en `from` a
 * 1 en `to` (bajando si `from > to`). `why`: cómo suena la canción cuando entra
 * por esa ruta (informe y horneado).
 *
 * La Cordillera no tiene rutas: es la red, lo que queda cuando nada encaja.
 */
export const SCENE_CASTING = Object.freeze({
    storm: Object.freeze([
        // Épica, tráiler, rock dramático: estalla con el clímax, como la tormenta.
        route('drama', 'intensa, sombría y con grandes contrastes', [
            ['arousal', 0.2, 0.5],
            ['drama', 0.45, 0.8],
            ['valence', 0.55, 0.3],
        ]),
    ]),
    city: Object.freeze([
        // Electrónica, hip-hop, reguetón, trap: un bucle con pulso de máquina, de noche.
        route('urban', 'rítmica, en bucle y oscura', [
            ['arousal', 0.5, 0.8],
            ['groove', 0.4, 0.8],
            ['valence', 0.6, 0.35],
        ]),
    ]),
    coast: Object.freeze([
        // Latina, verano, bailable y luminosa; el brillo es de la percusión.
        route('sunny', 'luminosa y bailable', [
            ['arousal', 0.5, 0.8],
            ['brightHits', 0.35, 0.7],
            ['valence', 0.5, 0.7],
        ]),
        // Balada o pieza tranquila en modo mayor que se mueve: el mar al atardecer.
        route('warm', 'tranquila y cálida', [
            ['arousal', 0.5, 0.2],
            ['valence', 0.6, 0.8],
            ['stillness', 0.7, 0.4],
        ]),
    ]),
    snow: Object.freeze([
        // Lenta, sostenida y casi quieta: la nevada.
        route('still', 'tranquila y pausada', [
            ['arousal', 0.5, 0.2],
            ['stillness', 0.5, 0.85],
            ['valence', 0.3, 0.5],
        ]),
        // Brillo que suena entre golpes (campanas, pads) en modo mayor y sin bucle
        // de club: cristalina, como las canciones de invierno.
        route('shimmer', 'brillante y cristalina', [
            ['shimmer', 0.4, 0.8],
            ['valence', 0.5, 0.7],
            ['groove', 0.7, 0.4],
        ]),
    ]),
    rain: Object.freeze([
        // Triste y suave, sin estallidos (lo dramático es tormenta) ni brillo. Tiene
        // que ser tranquila de verdad: con energía media, casi cualquier canción en
        // menor sería lluvia.
        route('melancholy', 'melancólica y suave', [
            ['arousal', 0.6, 0.3],
            ['valence', 0.4, 0.2],
            ['sparkle', 0.5, 0.2],
            ['drama', 0.9, 0.5],
        ]),
    ]),
});

/**
 * @typedef {Object} Casting
 * @property {number} version       SCENE_CASTING_VERSION.
 * @property {string | null} scene  Ambiente propuesto, o null (la Cordillera).
 * @property {'clear' | 'weak' | 'ambiguous' | 'no-analysis' | 'error'} reason
 *   'weak': ningún ambiente encaja; 'ambiguous': dos encajan casi igual;
 *   'no-analysis': análisis del navegador, de un analizador antiguo o canción muy
 *   corta; 'error': el análisis no se pudo leer (nunca rompe quien lo llama).
 * @property {number} fit           Encaje del mejor ambiente [0,1] (0 sin análisis).
 * @property {string | null} route  Ruta por la que entra el mejor ambiente.
 * @property {string | null} why    Cómo suena por esa ruta.
 * @property {Array<{ scene: string, fit: number, route: string }>} ranking  Todos, de más a menos encaje.
 * @property {ReturnType<typeof import('../levels/songTraits.js').songTraits>} traits
 */

/**
 * Propuesta de escenario a partir de los rasgos.
 *
 * @param {ReturnType<typeof import('../levels/songTraits.js').songTraits>} traits
 * @param {{ casting?: typeof SCENE_CASTING, rules?: typeof CASTING_RULES }} [opts]
 * @returns {Casting}
 */
export function castFromTraits(traits, opts = {}) {
    const casting = opts.casting ?? SCENE_CASTING;
    const rules = opts.rules ?? CASTING_RULES;
    if (traits === null) {
        return { version: SCENE_CASTING_VERSION, scene: null, reason: 'no-analysis', fit: 0, route: null, why: null, ranking: [], traits: null };
    }
    const ranking = rankPortraits(traits, casting);
    const pick = pickPortrait(ranking, rules);
    return {
        version: SCENE_CASTING_VERSION,
        scene: pick.id,
        reason: pick.reason,
        fit: pick.fit,
        route: pick.route,
        why: pick.why,
        ranking: ranking.map(({ id, fit, route: r }) => ({ scene: id, fit, route: r })),
        traits,
    };
}

/**
 * Propuesta de escenario para un análisis (el del servidor; con el del
 * navegador, null: la Cordillera). Nunca lanza: el escenario no puede impedir
 * chartear un nivel.
 *
 * @param {object} analysis
 * @param {ReturnType<typeof traitsOfAnalysis>} [measured]  Los rasgos, si ya se midieron (se calculan una vez por canción).
 * @returns {Casting & { error?: string }}
 */
export function castScene(analysis, measured = traitsOfAnalysis(analysis)) {
    if (measured.error !== null) return { ...castFromTraits(null), reason: 'error', error: measured.error };
    return castFromTraits(measured.traits);
}
