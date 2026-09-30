// Escenario Automático por el carácter de la canción (T02.5, doc 11).
//
// Los oficiales son la regresión: el ambiente que les toca y, sobre todo, que los
// errores típicos del analizador (tempo al doble o a la mitad, la tonalidad
// relativa, un máster más alto) nunca los lleven a un ambiente que no les pega.
// Una propuesta equivocada es peor que ninguna (la Cordillera).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
    CASTING_RULES, SCENE_CASTING, SCENE_CASTING_VERSION, TRAIT_NAMES, castFromTraits, castScene,
} from '../../resources/js/game/scenes/sceneCasting.js';
import { DEFAULT_SCENE, SCENES, SELECTABLE_SCENES } from '../../resources/js/game/scenes/registry.js';
import { chartFromAnalysis } from '../../scripts/lib/chartFromAnalysis.mjs';

const BAKED = new URL('../../database/seeds/official/baked/', import.meta.url);
const official = (slug) => JSON.parse(readFileSync(new URL(`${slug}.json`, BAKED), 'utf8'));
const SLUGS = readdirSync(BAKED).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

/**
 * Lo que le pega a cada oficial (null = la Cordillera, que siempre vale). Juicio
 * escuchándolas; la propuesta real va en EXPECTED.
 */
const ACCEPTABLE = {
    'dawn-of-faith': ['storm', null],                       // épica orquestal en menor
    hope: ['coast', 'snow', 'rain', null],                  // tranquila, en mayor
    'last-christmas': ['snow', 'city', 'coast', null],      // pop con campanas
    'mi-fiesta': ['city', 'coast', null],                   // reguetón en menor
    'running-with-the-wolves': ['storm', 'snow', null],     // épica con tambores
    'sugar-red': ['city', 'storm', null],                   // electrónica de club
    time: ['snow', 'rain', 'coast', null],                  // lenta y sostenida
    'whats-up-danger': ['city', 'storm', null],             // hip-hop/rock con graves
};

const EXPECTED = {
    'dawn-of-faith': ['storm', 'drama'],
    hope: ['coast', 'warm'],
    'last-christmas': ['snow', 'shimmer'],
    'mi-fiesta': ['city', 'urban'],
    'running-with-the-wolves': [null, null],
    'sugar-red': ['city', 'urban'],
    time: ['snow', 'still'],
    'whats-up-danger': ['city', 'urban'],
};

test('los oficiales como regresión: cada uno en su ambiente y por su ruta', () => {
    assert.deepEqual(new Set(SLUGS), new Set(Object.keys(EXPECTED)), 'un oficial nuevo necesita su entrada aquí');
    for (const slug of SLUGS) {
        const c = castScene(official(slug).analysis);
        const [scene, route] = EXPECTED[slug];
        assert.equal(c.scene, scene, `${slug}: ${c.scene} (${c.reason}, ${JSON.stringify(c.ranking.slice(0, 2))})`);
        if (scene !== null) {
            assert.equal(c.route, route, slug);
            assert.ok(c.fit >= CASTING_RULES.minFit + 0.1, `${slug}: encaje ${c.fit} al borde del mínimo`);
        }
        assert.equal(c.version, SCENE_CASTING_VERSION);
    }
});

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function relativeKey(key) {
    const [note, mode] = key.split(' ');
    const i = NOTES.indexOf(note);
    return mode === 'major' ? `${NOTES[(i + 9) % 12]} minor` : `${NOTES[(i + 3) % 12]} major`;
}

/** Errores típicos del analizador y diferencias de máster, uno a uno. */
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

test('los errores típicos del analizador nunca llevan a un ambiente que no pega', () => {
    for (const slug of SLUGS) {
        const analysis = official(slug).analysis;
        for (const [name, perturb] of Object.entries(PERTURBATIONS)) {
            const a = structuredClone(analysis);
            perturb(a);
            const { scene } = castScene(a);
            assert.ok(ACCEPTABLE[slug].includes(scene), `${slug} con ${name}: ${scene}`);
        }
    }
});

test('la tonalidad relativa (el error típico del modo) deja sin propuesta, nunca en otra', () => {
    // Relativa y paralela son los errores típicos de la tonalidad (CLAUDE.md): con
    // el modo cambiado, la canción ya no suena "clara" a nada.
    for (const slug of SLUGS) {
        const a = structuredClone(official(slug).analysis);
        const before = castScene(a).scene;
        a.tonal.key = relativeKey(a.tonal.key);
        const after = castScene(a).scene;
        assert.ok(after === before || after === null, `${slug}: ${before} → ${after}`);
    }
});

test('cada ambiente elegible, menos la Cordillera, tiene su retrato; sus condiciones tienen sentido', () => {
    const selectable = SELECTABLE_SCENES.map((s) => s.id).filter((id) => id !== DEFAULT_SCENE).sort();
    assert.deepEqual(Object.keys(SCENE_CASTING).sort(), selectable);
    assert.ok(!(DEFAULT_SCENE in SCENE_CASTING), 'la Cordillera es la red: no se propone');
    for (const [scene, routes] of Object.entries(SCENE_CASTING)) {
        assert.ok(SCENES[scene]?.selectable, scene);
        assert.ok(routes.length > 0, scene);
        const ids = new Set();
        for (const r of routes) {
            assert.ok(!ids.has(r.id), `${scene}: ruta repetida ${r.id}`);
            ids.add(r.id);
            assert.ok(typeof r.why === 'string' && r.why.length > 0, `${scene}/${r.id}: sin why`);
            // Un solo rasgo no basta para proponer un ambiente.
            assert.ok(r.when.length >= 2, `${scene}/${r.id}: necesita al menos dos condiciones`);
            for (const [trait, from, to] of r.when) {
                assert.ok(TRAIT_NAMES.includes(trait), `${scene}/${r.id}: rasgo desconocido ${trait}`);
                assert.ok(from !== to && from >= 0 && from <= 1 && to >= 0 && to <= 1, `${scene}/${r.id}: ${trait} ${from}→${to}`);
            }
        }
    }
});

/** Rasgos de una canción de libro para cada ambiente (el resto, neutros). */
function traits(over) {
    return { arousal: 0.5, valence: 0.5, drama: 0.3, groove: 0.3, sparkle: 0.2, brightHits: 0.1, shimmer: 0.1, stillness: 0.2, ...over };
}

test('retratos de libro: cada ambiente reconoce la canción que es claramente suya', () => {
    const cases = [
        ['storm', 'épica en menor que estalla', { arousal: 0.6, valence: 0.15, drama: 0.9, groove: 0.2 }],
        ['city', 'club en menor', { arousal: 0.95, valence: 0.2, drama: 0.15, groove: 0.95 }],
        ['coast', 'latina luminosa', { arousal: 0.9, valence: 0.85, drama: 0.1, sparkle: 0.95, brightHits: 0.85, shimmer: 0.1, stillness: 0 }],
        ['coast', 'balada en mayor', { arousal: 0.1, valence: 0.9, drama: 0.4, stillness: 0.3 }],
        ['snow', 'ambient casi quieta', { arousal: 0.05, valence: 0.6, drama: 0.3, groove: 0.1, stillness: 0.95 }],
        ['snow', 'canción de campanas', { arousal: 0.6, valence: 0.8, drama: 0.1, groove: 0.2, sparkle: 0.9, brightHits: 0.05, shimmer: 0.85, stillness: 0.1 }],
        ['rain', 'balada triste de piano', { arousal: 0.2, valence: 0.1, drama: 0.4, groove: 0.2, sparkle: 0.05, stillness: 0.6 }],
    ];
    for (const [scene, name, over] of cases) {
        const c = castFromTraits(traits(over));
        assert.equal(c.scene, scene, `${name}: ${c.scene} (${c.reason}) ${JSON.stringify(c.ranking.slice(0, 2))}`);
        assert.equal(c.reason, 'clear', name);
    }
});

test('con la red: lo que no encaja claramente, o encaja igual con dos, se queda en la Cordillera', () => {
    const neutral = castFromTraits(traits({}));
    assert.equal(neutral.scene, null);
    assert.equal(neutral.reason, 'weak');
    assert.equal(neutral.route, null, 'sin encaje, ninguna ruta dice nada');

    // Épica Y de club a la vez: tormenta y ciudad empatan.
    const both = castFromTraits(traits({ arousal: 1, valence: 0.1, drama: 0.95, groove: 0.95 }));
    assert.equal(both.scene, null);
    assert.equal(both.reason, 'ambiguous');
    assert.ok(both.fit >= CASTING_RULES.minFit, 'encajaba, pero no con uno solo');

    // Un rasgo extremo solo no basta (todas las rutas piden al menos dos).
    for (const name of TRAIT_NAMES) {
        for (const v of [0, 1]) {
            const c = castFromTraits(traits({ [name]: v }));
            assert.equal(c.scene, null, `${name}=${v} → ${c.scene}`);
        }
    }
});

test('sin análisis del servidor no hay propuesta: navegador, analizador antiguo, clip corto o análisis roto', () => {
    const base = official('hope').analysis;
    assert.equal(castScene(base).scene, 'coast', 'la base sí tiene propuesta');

    assert.equal(castScene(null).reason, 'no-analysis');
    assert.equal(castScene({ formatVersion: 1, durationSec: 60, bpm: 120, onsets: [[1, 1]] }).reason, 'no-analysis');

    const oldAnalyzer = structuredClone(base);
    delete oldAnalyzer.tonal;
    delete oldAnalyzer.onsetPercussive;
    delete oldAnalyzer.energy.bandLevelDb;
    assert.equal(castScene(oldAnalyzer).reason, 'no-analysis', 'analizador 1: sin armonía ni bandas');

    const clip = structuredClone(base);
    clip.durationSec = 12;
    assert.equal(castScene(clip).reason, 'no-analysis', 'un clip de 12 s no dice cómo es la canción');

    const broken = structuredClone(base);
    broken.onsets = 'no es una lista';
    const c = castScene(broken);
    assert.equal(c.scene, null, 'nunca lanza: el escenario no puede impedir chartear');
});

test('determinista y con los rasgos en [0,1]', () => {
    for (const slug of SLUGS) {
        const a = official(slug).analysis;
        const one = castScene(a);
        assert.deepEqual(castScene(structuredClone(a)), one, slug);
        for (const t of TRAIT_NAMES) assert.ok(one.traits[t] >= 0 && one.traits[t] <= 1, `${slug}.${t} = ${one.traits[t]}`);
    }
});

test('el charter del servidor devuelve la propuesta sin tocar el chart', () => {
    const b = official('hope');
    const out = chartFromAnalysis(b.analysis, b.audio.sha256, { difficulty: b.requestedDifficulty });
    assert.equal(out.sceneAuto, 'coast');
    assert.equal(out.sceneCasting.why, 'tranquila y cálida');
    assert.deepEqual(out.chart, b.chart, 'el escenario no cambia el nivel que se juega');
    // El horneado lleva lo mismo que calcula el charter.
    assert.equal(b.sceneAuto, out.sceneAuto, 'horneado desactualizado: bun run bake:official');
});
