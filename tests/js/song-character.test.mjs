// Carácter de cada tramo de la canción (Ola 6b): lo que decide qué modo va dónde.
//
// Se protege que la lectura musical sea la que el reparto de modos necesita:
// un puente sostenido suena pasivo y sostenido, un break de batería rítmico y
// épico, los dos contrastan y una estrofa que vuelve no; la percusividad, las
// bandas y la armonía suman cuando existen, y sin ellas (análisis del navegador)
// todo sigue siendo un número en [0,1].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { describeSegments } from '../../resources/js/game/levels/songCharacter.js';
import { MODE_CASTING } from '../../resources/js/game/levels/modePlan.js';
import { CONTRAST_SONG_SECTIONS, makeSyntheticAnalysis, makeSyntheticSong } from './helpers/synthetic-audio.mjs';

function characterOf(analysis) {
    const model = buildMusicModel(analysis);
    const arc = buildSongArc(model);
    const chars = describeSegments(model, arc);
    /** Carácter del tramo del arco que empieza con la sección de ese papel (la n-ésima). */
    const at = (role, nth = 0) => {
        const start = analysis.sections.filter((s) => s.role === role)[nth].startSec;
        const seg = arc.segments.find((s) => Math.abs(s.t0 - start) < 0.6);
        assert.ok(seg !== undefined, `hay un tramo que empieza con ${role} ${nth}`);
        return chars[seg.index];
    };
    return { model, arc, chars, at };
}

test('puente sostenido: pasivo, sostenido y contrasta; break de batería: rítmico, épico y contrasta; la estrofa que vuelve no contrasta', () => {
    const { at } = characterOf(makeSyntheticSong({ bpm: 120, sections: CONTRAST_SONG_SECTIONS }));
    const bridge = at('bridge');
    assert.ok(bridge.contrast >= 0.8 && bridge.passive >= 0.8 && bridge.sustain >= 0.8 && bridge.rhythmic < 0.3, JSON.stringify(bridge));
    assert.deepEqual(bridge.traits, { rare: true, bridge: true, keyChange: false });

    const drums = at('break');
    assert.ok(drums.contrast >= 0.8 && drums.rhythmic >= 0.9 && drums.epic >= 0.9 && drums.sustain < 0.1, JSON.stringify(drums));

    const verse = at('verse', 1);
    assert.ok(verse.contrast < 0.1, `estrofa repetida: ${verse.contrast}`);

    // El reparto lee lo mismo: cada modo encaja mejor con el suyo.
    assert.ok(MODE_CASTING.flip.affinity(drums) > MODE_CASTING.fly.affinity(drums));
    assert.ok(MODE_CASTING.fly.affinity(bridge) > MODE_CASTING.flip.affinity(bridge));
    assert.ok(MODE_CASTING.flip.affinity(verse) < 0.5 && MODE_CASTING.fly.affinity(verse) < 0.5, 'una estrofa típica no encaja con ningún modo');
});

test('la percusividad distingue lo que la energía no: un tramo igual de intenso pero sostenido contrasta', () => {
    const sections = [
        { bars: 16, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A', perc: 0.7 },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'B', perc: 0.7 },
        { bars: 16, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A', perc: 0.7 },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'B', perc: 0.1 },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A', perc: 0.7 },
    ];
    const { at } = characterOf(makeSyntheticSong({ bpm: 120, sections }));
    const pad = at('chorus', 1);
    const typical = at('chorus', 0);
    assert.ok(pad.contrast > typical.contrast + 0.2, `${pad.contrast} vs ${typical.contrast}`);
    assert.ok(pad.sustain > typical.sustain + 0.4, `${pad.sustain} vs ${typical.sustain}`);
});

test('un cambio de tonalidad suma contraste', () => {
    const base = makeSyntheticSong({ bpm: 120, sections: CONTRAST_SONG_SECTIONS });
    const withKeys = structuredClone(base);
    withKeys.tonal = { key: 'C:maj', keyConfidence: 0.8, chords: [], chordConfidence: 0.5, modulations: [] };
    withKeys.sections.forEach((s) => { s.key = 'C:maj'; });
    const plain = characterOf(withKeys);
    const verseIndex = withKeys.sections.findIndex((s, i) => s.role === 'verse' && i > 2);
    withKeys.sections[verseIndex].key = 'D:maj';
    const modulated = characterOf(withKeys);
    const role = withKeys.sections[verseIndex].role;
    const nth = withKeys.sections.slice(0, verseIndex).filter((s) => s.role === role).length;
    assert.equal(modulated.at(role, nth).traits.keyChange, true);
    assert.ok(modulated.at(role, nth).contrast > plain.at(role, nth).contrast + 0.1);
});

test('sin percusividad, bandas ni armonía (formato 1 o análisis antiguo) todo es un número en [0,1]', () => {
    for (const analysis of [makeSyntheticSong({ bpm: 128 }), makeSyntheticAnalysis({ bpm: 128, durationSec: 90 })]) {
        const { chars, arc } = characterOf(analysis);
        assert.equal(chars.length, arc.segments.length);
        for (const c of chars) {
            for (const key of ['contrast', 'passive', 'epic', 'sustain', 'rhythmic']) {
                assert.ok(Number.isFinite(c[key]) && c[key] >= 0 && c[key] <= 1, `${key} = ${c[key]}`);
            }
            assert.ok(Number.isFinite(c.density) && c.density >= 0);
        }
    }
});

test('modelo musical: percusividad ponderada por fuerza, bandas y ritmo armónico solo si el análisis los trae', () => {
    const analysis = makeSyntheticSong({ bpm: 120, sections: CONTRAST_SONG_SECTIONS });
    const model = buildMusicModel(analysis);
    const drums = analysis.sections.find((s) => s.role === 'break');
    const bridge = analysis.sections.find((s) => s.role === 'bridge');
    assert.ok(Math.abs(model.percussiveness(drums.startSec, drums.endSec) - 0.95) < 1e-6);
    assert.ok(Math.abs(model.percussiveness(bridge.startSec, bridge.endSec) - 0.12) < 1e-6);
    assert.equal(model.bandsMean(0, 10), null);
    assert.equal(model.chordChangeRate(0, 10), null);
    assert.equal(buildMusicModel(makeSyntheticSong({ bpm: 120 })).percussiveness(0, 30), null, 'sin onsetPercussive no se inventa');

    const rich = structuredClone(analysis);
    const n = rich.energy.values.length;
    rich.energy.bands = { low: new Array(n).fill(0.6), mid: new Array(n).fill(0.3), high: new Array(n).fill(0.1) };
    rich.tonal = { key: 'A:min', keyConfidence: 0.7, chords: [[0, 'A:min'], [2, 'F:maj'], [4, 'F:maj'], [6, 'C:maj'], [8, 'G:maj']], chordConfidence: 0.6, modulations: [] };
    const richModel = buildMusicModel(rich);
    const bands = richModel.bandsMean(0, 10);
    assert.ok(Math.abs(bands.low - 0.6) < 1e-6 && Math.abs(bands.mid - 0.3) < 1e-6 && Math.abs(bands.high - 0.1) < 1e-6);
    assert.equal(richModel.chordChangeRate(0, 10), 3 / 10, 'tres cambios en 10 s (F→F no cuenta)');
    assert.equal(richModel.tonal.key, 'A:min');
});
