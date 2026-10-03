// La identidad de los efectos de una canción (T03.3, doc 11): qué PALETA y qué
// FIRMA le pegan por cómo suena.
//
// Mismo motor que el escenario Automático (levels/portraits.js): retratos hechos
// de condiciones sobre los rasgos de la canción (levels/songTraits.js), encaje
// mínimo, ventaja sobre el segundo y, si no, LA RED: la paleta de siempre (Neón)
// y ninguna firma. Una propuesta equivocada es peor que ninguna.
//
// LA PALETA sale del ánimo de la canción, en dos ejes (energía y luz):
//
//                 sombría / dramática        luminosa
//   con energía   Ultravioleta (bucle)       —  (Neón: la red)
//                 Fucsia (contrastes)
//   tranquila     Hielo (quieta, triste      Rosa (cálida, se mueve)
//                 o cristalina)
//
// LA FIRMA (como mucho una) sale de cómo se mueve:
//   aurora    la canción FLUYE: tranquila, y quieta o luminosa.
//   meteors   la canción ESTALLA: con energía y grandes contrastes.
// Lo demás no lleva firma. Una firma es una luz del cielo nocturno: de día no se
// ve, y bajo un cielo cerrado (Lluvia, Tormenta) tampoco: la firma de ese nivel
// es su clima. Eso lo decide el director al jugar (la hora y la política de la
// escena), no este reparto, que es de la canción y vale para cualquier
// escenario que elija su autor.
//
// Se calcula donde está el análisis del servidor (scripts/lib/chartFromAnalysis.mjs:
// el worker del analizador y el horneado de oficiales) y se guarda en
// `levels.fx_auto`. NO VIAJA EN EL BUNDLE: el cliente solo lee el resultado
// (fx/identity.js). No toca el chart: un nivel público también lo recibe.
//
// Añadir una paleta = su entrada en fx/palettes.js y aquí su retrato (o ninguno:
// nunca se propone). Añadir una firma = su efecto en fx/registry.js (familia
// `signature`), su pintor y aquí su retrato. Cambiar una regla cambia la
// identidad de los niveles: sube FX_CASTING_VERSION y vuelve a repartir (`cast`).
//
// Puro: mismo análisis ⇒ misma propuesta.

import { pickPortrait, rankPortraits, route, traitsOfAnalysis } from '../levels/portraits.js';

export const FX_CASTING_VERSION = 1;

export const FX_CASTING_RULES = Object.freeze({
    /** Encaje mínimo de la mejor entrada [0,1]. */
    minFit: 0.45,
    /** Ventaja mínima sobre la segunda. */
    minMargin: 0.15,
});

/**
 * Retratos de cada paleta (condición `[rasgo, from, to]`: rampa de 0 en `from` a
 * 1 en `to`). Neón no tiene: es la red.
 */
export const PALETTE_CASTING = Object.freeze({
    ultra: Object.freeze([
        // Electrónica, hip-hop, reguetón, trap: un bucle con pulso de máquina, oscuro.
        route('loop', 'rítmica, en bucle y oscura', [
            ['arousal', 0.5, 0.8],
            ['groove', 0.4, 0.8],
            ['valence', 0.6, 0.35],
        ]),
    ]),
    fucsia: Object.freeze([
        // Épica, tráiler, rock dramático: sombría y con grandes contrastes.
        route('drama', 'intensa, sombría y con grandes contrastes', [
            ['arousal', 0.2, 0.5],
            ['drama', 0.45, 0.8],
            ['valence', 0.55, 0.3],
        ]),
    ]),
    ice: Object.freeze([
        // Lenta, sostenida y casi quieta.
        route('still', 'tranquila y pausada', [
            ['arousal', 0.5, 0.2],
            ['stillness', 0.5, 0.85],
        ]),
        // Brillo que suena entre golpes (campanas, pads) y sin bucle de club.
        route('crystal', 'brillante y cristalina', [
            ['shimmer', 0.4, 0.8],
            ['valence', 0.5, 0.7],
            ['groove', 0.7, 0.4],
        ]),
        // Triste y suave, sin estallidos ni brillo.
        route('melancholy', 'melancólica y suave', [
            ['arousal', 0.6, 0.3],
            ['valence', 0.4, 0.2],
            ['sparkle', 0.5, 0.2],
            ['drama', 0.9, 0.5],
        ]),
    ]),
    rose: Object.freeze([
        // Balada o pieza tranquila en modo mayor que se mueve.
        route('warm', 'tranquila y cálida', [
            ['arousal', 0.5, 0.2],
            ['valence', 0.6, 0.8],
            ['stillness', 0.7, 0.4],
        ]),
    ]),
});

/** Retratos de cada firma. */
export const SIGNATURE_CASTING = Object.freeze({
    aurora: Object.freeze([
        route('still', 'tranquila y casi quieta: fluye', [
            ['arousal', 0.5, 0.2],
            ['stillness', 0.4, 0.8],
        ]),
        route('serene', 'tranquila y luminosa: fluye', [
            ['arousal', 0.5, 0.2],
            ['valence', 0.6, 0.8],
        ]),
    ]),
    meteors: Object.freeze([
        route('burst', 'con energía y grandes contrastes: estalla', [
            ['arousal', 0.5, 0.8],
            ['drama', 0.3, 0.55],
        ]),
    ]),
});

/**
 * @typedef {object} FxPick
 * @property {'clear' | 'weak' | 'ambiguous' | 'no-analysis' | 'error'} reason
 * @property {number} fit            Encaje de la mejor entrada [0,1].
 * @property {string | null} route   Ruta por la que entra la mejor.
 * @property {string | null} why     Cómo suena por esa ruta.
 * @property {Array<{ id: string, fit: number, route: string }>} ranking
 */

/**
 * @typedef {object} FxCasting
 * @property {number} version            FX_CASTING_VERSION.
 * @property {string | null} palette     Paleta propuesta, o null (Neón).
 * @property {string | null} signature   Firma propuesta, o null (ninguna).
 * @property {FxPick} paletteCasting
 * @property {FxPick} signatureCasting
 */

const NOTHING = (reason) => ({ reason, fit: 0, route: null, why: null, ranking: [] });

/**
 * @param {Record<string, number> | null} traits  De songTraits.js, o null sin análisis del servidor.
 * @param {{ palettes?: typeof PALETTE_CASTING, signatures?: typeof SIGNATURE_CASTING, rules?: typeof FX_CASTING_RULES }} [opts]
 * @returns {FxCasting}
 */
export function castFxFromTraits(traits, opts = {}) {
    if (traits === null) {
        return { version: FX_CASTING_VERSION, palette: null, signature: null, paletteCasting: NOTHING('no-analysis'), signatureCasting: NOTHING('no-analysis') };
    }
    const rules = opts.rules ?? FX_CASTING_RULES;
    const one = (table) => {
        const ranking = rankPortraits(traits, table);
        const pick = pickPortrait(ranking, rules);
        return {
            id: pick.id,
            casting: { reason: pick.reason, fit: pick.fit, route: pick.route, why: pick.why, ranking: ranking.map(({ id, fit, route: r }) => ({ id, fit, route: r })) },
        };
    };
    const palette = one(opts.palettes ?? PALETTE_CASTING);
    const signature = one(opts.signatures ?? SIGNATURE_CASTING);
    return {
        version: FX_CASTING_VERSION,
        palette: palette.id,
        signature: signature.id,
        paletteCasting: palette.casting,
        signatureCasting: signature.casting,
    };
}

/**
 * La identidad de los efectos para un análisis (el del servidor; con el del
 * navegador, nada: lo de siempre). Nunca lanza: los efectos no pueden impedir
 * chartear un nivel.
 *
 * @param {object | null} analysis
 * @param {ReturnType<typeof traitsOfAnalysis>} [measured]  Los rasgos, si ya se midieron.
 * @returns {FxCasting & { error?: string }}
 */
export function castFx(analysis, measured = traitsOfAnalysis(analysis)) {
    if (measured.error !== null) {
        return { ...castFxFromTraits(null), paletteCasting: NOTHING('error'), signatureCasting: NOTHING('error'), error: measured.error };
    }
    return castFxFromTraits(measured.traits);
}

/**
 * Lo que se guarda en `levels.fx_auto`: solo lo que la canción tiene de propio.
 * Sin paleta ni firma, null (lo de siempre).
 *
 * @param {{ palette: string | null, signature: string | null }} casting
 * @returns {{ palette?: string, signature?: string } | null}
 */
export function fxAutoOf(casting) {
    const out = {};
    if (casting.palette !== null) out.palette = casting.palette;
    if (casting.signature !== null) out.signature = casting.signature;
    return Object.keys(out).length > 0 ? out : null;
}
