// La identidad de los efectos por el carácter de la canción (T03.3, doc 11).
//
// Los oficiales son la regresión: la paleta y la firma que les tocan y, sobre
// todo, que los errores típicos del analizador (tempo al doble o a la mitad, la
// tonalidad relativa, un máster más alto) nunca les den una que no les pega. Una
// propuesta equivocada es peor que ninguna (Neón y sin firma).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
    FX_CASTING_RULES, FX_CASTING_VERSION, PALETTE_CASTING, SIGNATURE_CASTING, castFx, castFxFromTraits, fxAutoOf,
} from '../../resources/js/game/fx/casting.js';
import { fxIdentityOf, SIGNATURE_IDS } from '../../resources/js/game/fx/identity.js';
import { DEFAULT_PALETTE, FX_PALETTES } from '../../resources/js/game/fx/palettes.js';
import { FX } from '../../resources/js/game/fx/registry.js';
import { pickPortrait, rankPortraits, route, traitsOfAnalysis } from '../../resources/js/game/levels/portraits.js';
import { SCENE_ID_PATTERN } from '../../resources/js/game/scenes/registry.js';
import { TRAIT_NAMES, castScene } from '../../resources/js/game/scenes/sceneCasting.js';
import { chartFromAnalysis } from '../../scripts/lib/chartFromAnalysis.mjs';

const BAKED = new URL('../../database/seeds/official/baked/', import.meta.url);
const official = (slug) => JSON.parse(readFileSync(new URL(`${slug}.json`, BAKED), 'utf8'));
const SLUGS = readdirSync(BAKED).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

/**
 * Lo que le pega a cada oficial: [paletas], [firmas] (null = lo de siempre, que
 * siempre vale). Juicio escuchándolas; la propuesta real va en EXPECTED.
 */
const ACCEPTABLE = {
    'dawn-of-faith': [['fucsia', null], ['meteors', null]],            // épica orquestal en menor
    hope: [['rose', 'ice', null], ['aurora', null]],                   // tranquila, en mayor
    'last-christmas': [['ice', 'rose', null], [null]],                 // pop con campanas
    'mi-fiesta': [['ultra', null], ['meteors', null]],                 // reguetón en menor
    'one-day': [['ice', 'rose', null], ['aurora', null]],              // orquestal tranquila (juega su historia: no la usa)
    'running-with-the-wolves': [['fucsia', null], ['meteors', null]],  // épica con tambores
    'sugar-red': [['ultra', null], ['meteors', null]],                 // electrónica de club
    time: [['ice', 'rose', null], ['aurora', null]],                   // lenta y sostenida
    'whats-up-danger': [['ultra', 'fucsia', null], ['meteors', null]], // hip-hop/rock con graves
};

/** [paleta, ruta, firma, ruta]. */
const EXPECTED = {
    'dawn-of-faith': ['fucsia', 'drama', null, null],
    hope: ['rose', 'warm', 'aurora', 'serene'],
    'last-christmas': ['ice', 'crystal', null, null],
    'mi-fiesta': ['ultra', 'loop', null, null],
    'one-day': ['ice', 'still', 'aurora', 'still'],
    'running-with-the-wolves': [null, null, 'meteors', 'burst'],
    'sugar-red': ['ultra', 'loop', null, null],
    time: ['ice', 'still', 'aurora', 'still'],
    'whats-up-danger': ['ultra', 'loop', 'meteors', 'burst'],
};

test('los oficiales como regresión: cada uno con su paleta y su firma, por su ruta', () => {
    assert.deepEqual(new Set(SLUGS), new Set(Object.keys(EXPECTED)), 'un oficial nuevo necesita su entrada aquí');
    for (const slug of SLUGS) {
        const c = castFx(official(slug).analysis);
        const [palette, paletteRoute, signature, signatureRoute] = EXPECTED[slug];
        assert.equal(c.palette, palette, `${slug}: paleta ${c.palette} (${c.paletteCasting.reason}, ${JSON.stringify(c.paletteCasting.ranking.slice(0, 2))})`);
        assert.equal(c.signature, signature, `${slug}: firma ${c.signature} (${c.signatureCasting.reason}, ${JSON.stringify(c.signatureCasting.ranking)})`);
        if (palette !== null) {
            assert.equal(c.paletteCasting.route, paletteRoute, slug);
            assert.ok(c.paletteCasting.fit >= FX_CASTING_RULES.minFit + 0.1, `${slug}: paleta con encaje ${c.paletteCasting.fit}, al borde del mínimo`);
        }
        if (signature !== null) {
            assert.equal(c.signatureCasting.route, signatureRoute, slug);
            assert.ok(c.signatureCasting.fit >= FX_CASTING_RULES.minFit + 0.1, `${slug}: firma con encaje ${c.signatureCasting.fit}, al borde del mínimo`);
        }
        assert.equal(c.version, FX_CASTING_VERSION);
    }
    // No todos iguales: los nueve oficiales usan al menos cuatro paletas, y las dos firmas.
    const used = new Set(SLUGS.map((s) => EXPECTED[s][0] ?? DEFAULT_PALETTE));
    assert.ok(used.size >= 4, [...used].join(', '));
    assert.deepEqual(new Set(SLUGS.map((s) => EXPECTED[s][2]).filter(Boolean)), new Set(SIGNATURE_IDS));
});

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function relativeKey(key) {
    const [note, mode] = key.split(' ');
    const i = NOTES.indexOf(note);
    return mode === 'major' ? `${NOTES[(i + 9) % 12]} minor` : `${NOTES[(i + 3) % 12]} major`;
}

/** Errores típicos del analizador y diferencias de máster, uno a uno (los de scene-casting.test.mjs). */
const PERTURBATIONS = {
    'tempo al doble': (a) => { a.bpm *= 2; },
    'tempo a la mitad': (a) => { a.bpm /= 2; },
    'tonalidad relativa': (a) => { a.tonal.key = relativeKey(a.tonal.key); },
    'tonalidad con menos confianza': (a) => { a.tonal.keyConfidence = Math.max(0, a.tonal.keyConfidence - 0.15); },
    'máster 3 dB más alto': (a) => { a.features.loudnessDbfs += 3; },
    'máster 3 dB más bajo': (a) => { a.features.loudnessDbfs -= 3; },
    'más rango dinámico': (a) => { a.features.dynamicRangeDb += 3; },
    'menos rango dinámico': (a) => { a.features.dynamicRangeDb -= 3; },
    'agudos +2 dB': (a) => { a.energy.bandLevelDb[2] += 2; },
    'agudos −2 dB': (a) => { a.energy.bandLevelDb[2] -= 2; },
    'graves +1.5 dB': (a) => { a.energy.bandLevelDb[0] += 1.5; },
    'graves −1.5 dB': (a) => { a.energy.bandLevelDb[0] -= 1.5; },
    '20 % más sucesos': (a) => { a.features.eventsPerMin *= 1.2; a.features.strongEventsPerMin *= 1.2; },
    '20 % menos sucesos': (a) => { a.features.eventsPerMin *= 0.8; a.features.strongEventsPerMin *= 0.8; },
};

test('los errores típicos del analizador nunca dan una paleta ni una firma que no pega', () => {
    for (const slug of SLUGS) {
        const analysis = official(slug).analysis;
        const [palettes, signatures] = ACCEPTABLE[slug];
        for (const [name, perturb] of Object.entries(PERTURBATIONS)) {
            const a = structuredClone(analysis);
            perturb(a);
            const c = castFx(a);
            assert.ok(palettes.includes(c.palette), `${slug} con ${name}: paleta ${c.palette}`);
            assert.ok(signatures.includes(c.signature), `${slug} con ${name}: firma ${c.signature}`);
        }
    }
});

test('cada paleta menos Neón y cada firma tiene su retrato; sus condiciones tienen sentido', () => {
    assert.deepEqual(Object.keys(PALETTE_CASTING).sort(), Object.keys(FX_PALETTES).filter((id) => id !== DEFAULT_PALETTE).sort());
    assert.ok(!(DEFAULT_PALETTE in PALETTE_CASTING), 'Neón es la red: no se propone');
    assert.deepEqual(Object.keys(SIGNATURE_CASTING).sort(), [...SIGNATURE_IDS].sort(), 'una firma sin retrato no la tendría ninguna canción');
    for (const [kind, table] of [['paleta', PALETTE_CASTING], ['firma', SIGNATURE_CASTING]]) {
        for (const [id, routes] of Object.entries(table)) {
            assert.match(id, SCENE_ID_PATTERN, `${kind} ${id}: se guarda con la forma de un id`);
            if (kind === 'firma') assert.equal(FX[id]?.family, 'signature', id);
            assert.ok(routes.length > 0, id);
            const ids = new Set();
            for (const r of routes) {
                assert.ok(!ids.has(r.id), `${id}: ruta repetida ${r.id}`);
                ids.add(r.id);
                assert.ok(typeof r.why === 'string' && r.why.length > 0, `${id}/${r.id}: sin why`);
                // Un solo rasgo no basta para proponer nada.
                assert.ok(r.when.length >= 2, `${id}/${r.id}: necesita al menos dos condiciones`);
                for (const [trait, from, to] of r.when) {
                    assert.ok(TRAIT_NAMES.includes(trait), `${id}/${r.id}: rasgo desconocido ${trait}`);
                    assert.ok(from !== to && from >= 0 && from <= 1 && to >= 0 && to <= 1, `${id}/${r.id}: ${trait} ${from}→${to}`);
                }
            }
        }
    }
});

/** Rasgos de una canción de libro (el resto, neutros). */
function traits(over) {
    return { arousal: 0.5, valence: 0.5, drama: 0.3, groove: 0.3, sparkle: 0.2, brightHits: 0.1, shimmer: 0.1, stillness: 0.2, ...over };
}

test('retratos de libro: cada paleta y cada firma reconoce la canción que es claramente suya', () => {
    const cases = [
        ['club en menor', { arousal: 0.95, valence: 0.2, drama: 0.15, groove: 0.95 }, 'ultra', null],
        ['épica en menor que estalla', { arousal: 0.75, valence: 0.15, drama: 0.9, groove: 0.2 }, 'fucsia', 'meteors'],
        ['ambient casi quieta', { arousal: 0.05, valence: 0.6, drama: 0.3, groove: 0.1, stillness: 0.95 }, 'ice', 'aurora'],
        ['canción de campanas', { arousal: 0.6, valence: 0.8, drama: 0.1, groove: 0.2, sparkle: 0.9, brightHits: 0.05, shimmer: 0.85, stillness: 0.1 }, 'ice', null],
        ['balada triste de piano', { arousal: 0.2, valence: 0.1, drama: 0.4, groove: 0.2, sparkle: 0.05, stillness: 0.45 }, 'ice', null],
        ['balada en mayor', { arousal: 0.1, valence: 0.9, drama: 0.4, stillness: 0.3 }, 'rose', 'aurora'],
        ['himno de rock en mayor', { arousal: 0.9, valence: 0.8, drama: 0.7, groove: 0.3 }, null, 'meteors'],
        ['latina luminosa', { arousal: 0.9, valence: 0.85, drama: 0.1, sparkle: 0.95, brightHits: 0.85, stillness: 0 }, null, null],
    ];
    for (const [name, over, palette, signature] of cases) {
        const c = castFxFromTraits(traits(over));
        assert.equal(c.palette, palette, `${name}: paleta ${c.palette} ${JSON.stringify(c.paletteCasting.ranking.slice(0, 2))}`);
        assert.equal(c.signature, signature, `${name}: firma ${c.signature} ${JSON.stringify(c.signatureCasting.ranking)}`);
    }
});

test('con la red: lo que no encaja claramente, o encaja igual con dos, se queda en lo de siempre', () => {
    const neutral = castFxFromTraits(traits({}));
    assert.equal(neutral.palette, null);
    assert.equal(neutral.signature, null);
    assert.equal(neutral.paletteCasting.reason, 'weak');
    assert.equal(fxAutoOf(neutral), null, 'sin nada propio no se guarda nada');

    // Épica Y de club a la vez: Fucsia y Ultravioleta empatan.
    const both = castFxFromTraits(traits({ arousal: 1, valence: 0.1, drama: 0.95, groove: 0.95 }));
    assert.equal(both.palette, null);
    assert.equal(both.paletteCasting.reason, 'ambiguous');
    assert.ok(both.paletteCasting.fit >= FX_CASTING_RULES.minFit, 'encajaba, pero no con una sola');

    // Un rasgo extremo solo no basta (todas las rutas piden al menos dos).
    for (const name of TRAIT_NAMES) {
        for (const v of [0, 1]) {
            const c = castFxFromTraits(traits({ [name]: v }));
            assert.equal(c.palette, null, `${name}=${v} → paleta ${c.palette}`);
            assert.equal(c.signature, null, `${name}=${v} → firma ${c.signature}`);
        }
    }
    // Las dos firmas no se pisan: una pide calma y la otra energía.
    for (let arousal = 0; arousal <= 1.001; arousal += 0.05) {
        const c = castFxFromTraits(traits({ arousal, valence: 0.9, drama: 0.9, stillness: 0.9 }));
        assert.notEqual(c.signatureCasting.reason, 'ambiguous', `arousal ${arousal.toFixed(2)}`);
    }
});

test('sin análisis del servidor no hay identidad: navegador, analizador antiguo, clip corto o análisis roto', () => {
    const base = official('hope').analysis;
    assert.deepEqual(fxAutoOf(castFx(base)), { palette: 'rose', signature: 'aurora' }, 'la base sí tiene');

    for (const none of [null, { formatVersion: 1, durationSec: 60, bpm: 120, onsets: [[1, 1]] }]) {
        const c = castFx(none);
        assert.equal(c.paletteCasting.reason, 'no-analysis');
        assert.equal(fxAutoOf(c), null);
    }
    const oldAnalyzer = structuredClone(base);
    delete oldAnalyzer.tonal;
    delete oldAnalyzer.onsetPercussive;
    delete oldAnalyzer.energy.bandLevelDb;
    assert.equal(fxAutoOf(castFx(oldAnalyzer)), null, 'analizador 1: sin armonía ni bandas');

    const clip = structuredClone(base);
    clip.durationSec = 12;
    assert.equal(fxAutoOf(castFx(clip)), null, 'un clip de 12 s no dice cómo es la canción');

    const broken = structuredClone(base);
    broken.onsets = 'no es una lista';
    const c = castFx(broken);
    assert.equal(fxAutoOf(c), null, 'nunca lanza: los efectos no pueden impedir chartear');
    assert.ok(['error', 'no-analysis'].includes(c.paletteCasting.reason));
    // Y lo de siempre es lo que el juego pinta con null.
    assert.equal(fxIdentityOf(null).paletteId, DEFAULT_PALETTE);
});

test('determinista; lo que se guarda son ids que el juego conoce', () => {
    for (const slug of SLUGS) {
        const a = official(slug).analysis;
        const one = castFx(a);
        assert.deepEqual(castFx(structuredClone(a)), one, slug);
        const auto = fxAutoOf(one);
        if (auto === null) continue;
        assert.ok(Object.keys(auto).every((k) => k === 'palette' || k === 'signature'), slug);
        const identity = fxIdentityOf(auto);
        assert.equal(identity.paletteId, auto.palette ?? DEFAULT_PALETTE, slug);
        assert.equal(identity.signature, auto.signature ?? null, slug);
    }
    assert.deepEqual(fxAutoOf({ palette: null, signature: 'meteors' }), { signature: 'meteors' });
    assert.deepEqual(fxAutoOf({ palette: 'ice', signature: null }), { palette: 'ice' });
});

test('el motor de retratos es el mismo para escenarios y efectos; los rasgos se miden una vez', () => {
    const table = { a: [route('x', 'porque sí', [['arousal', 0.2, 0.8], ['valence', 0.2, 0.8]])], b: [route('y', 'porque no', [['arousal', 0.8, 0.2], ['valence', 0.8, 0.2]])] };
    const ranking = rankPortraits({ arousal: 0.9, valence: 0.9 }, table);
    assert.deepEqual(ranking.map((r) => r.id), ['a', 'b']);
    assert.deepEqual(pickPortrait(ranking, { minFit: 0.45, minMargin: 0.15 }), { id: 'a', reason: 'clear', fit: 1, route: 'x', why: 'porque sí' });
    assert.equal(pickPortrait(rankPortraits({ arousal: 0.5, valence: 0.5 }, table), { minFit: 0.45, minMargin: 0.15 }).id, null);

    const a = official('time').analysis;
    const measured = traitsOfAnalysis(a);
    assert.equal(measured.error, null);
    assert.deepEqual(castFx(a, measured), castFx(a));
    assert.deepEqual(castScene(a, measured), castScene(a));
    assert.deepEqual(traitsOfAnalysis(null), { traits: null, error: null });
});

test('el charter del servidor devuelve la identidad sin tocar el chart, y el horneado la lleva', () => {
    const b = official('hope');
    const out = chartFromAnalysis(b.analysis, b.audio.sha256, { difficulty: b.requestedDifficulty });
    assert.deepEqual(out.fxAuto, { palette: 'rose', signature: 'aurora' });
    assert.equal(out.fxCasting.paletteCasting.why, 'tranquila y cálida');
    assert.deepEqual(out.chart, b.chart, 'los efectos no cambian el nivel que se juega');
    for (const slug of SLUGS) {
        const baked = official(slug);
        const fresh = castFx(baked.analysis);
        assert.deepEqual(baked.fxAuto, fxAutoOf(fresh), `${slug}: horneado desactualizado (bun run bake:official)`);
        assert.deepEqual(baked.fxCasting, JSON.parse(JSON.stringify(fresh)), `${slug}: horneado desactualizado (bun run bake:official)`);
    }
});
