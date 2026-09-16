// Carácter de cada tramo de la canción (Ola 6b): lo que decide qué modo va dónde.
//
// Se protege que la lectura musical sea la que el reparto de modos necesita:
// un puente sostenido suena pasivo y sostenido, un break de batería rítmico y
// épico, los dos contrastan y una estrofa que vuelve no; la percusividad, las
// bandas y la armonía suman cuando existen, y sin ellas (análisis del navegador)
// todo sigue siendo un número en [0,1]. Tras el playtest de la 6b, la LLEGADA:
// un tramo que entra de golpe hacia lo más intenso (o se vacía hacia la calma)
// es un momento aunque lo que suena no sea raro en la canción.

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
    /**
     * Carácter del tramo del arco donde suena la sección de ese papel (la
     * n-ésima): el que empieza con ella o, si la sección no cambia el sonido y no
     * parte ningún tramo, el que la contiene.
     */
    const at = (role, nth = 0) => {
        const start = analysis.sections.filter((s) => s.role === role)[nth].startSec;
        const seg = arc.segments.find((s) => Math.abs(s.t0 - start) < 0.6) ?? arc.segments.find((s) => s.t0 <= start && start < s.t1);
        assert.ok(seg !== undefined, `hay un tramo con ${role} ${nth}`);
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

test('la percusividad distingue lo que la energía no: un tramo igual de intenso pero sostenido es un tramo y contrasta', () => {
    const sections = [
        { bars: 16, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A', perc: 0.7 },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'B', perc: 0.7 },
        { bars: 16, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A', perc: 0.7 },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'B', perc: 0.1 },
        { bars: 8, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A', perc: 0.7 },
    ];
    const analysis = makeSyntheticSong({ bpm: 120, sections });
    const { at, arc } = characterOf(analysis);
    const padStart = analysis.sections[3].startSec;
    assert.ok(arc.segments.some((seg) => Math.abs(seg.t0 - padStart) < 0.6), 'cambiar de golpes a notas sostenidas parte el tramo');
    const pad = at('chorus', 1);
    const typical = at('chorus', 0);
    assert.ok(pad.contrast > typical.contrast + 0.2, `${pad.contrast} vs ${typical.contrast}`);
    assert.ok(pad.sustain > typical.sustain + 0.4, `${pad.sustain} vs ${typical.sustain}`);
});

test('llegada: lo que entra de golpe hacia lo más intenso sube, lo que se vacía hacia la calma baja, y una estrofa tras el estribillo no es un momento', () => {
    const analysis = makeSyntheticSong({ bpm: 120, sections: CONTRAST_SONG_SECTIONS });
    const { at } = characterOf(analysis);

    const finale = at('chorus', 2);
    assert.ok(finale.arrival >= 0.9 && finale.rises && finale.epic === 1, JSON.stringify(finale));
    assert.ok(MODE_CASTING.flip.event(finale) >= 0.9, 'el estribillo final llega como un momento de antigravedad');
    assert.equal(MODE_CASTING.fly.event(finale), finale.contrast, 'y no de vuelo: sube');

    const bridge = at('bridge');
    assert.ok(bridge.arrival >= 0.6 && !bridge.rises && bridge.passive === 1, JSON.stringify(bridge));
    assert.ok(MODE_CASTING.fly.event(bridge) >= 0.6);

    // La estrofa tras el primer estribillo también baja, pero a lo típico.
    const verse = at('verse', 1);
    assert.ok(verse.arrival >= 0.6 && !verse.rises && verse.passive <= 0.55, JSON.stringify(verse));
    for (const [mode, cast] of Object.entries(MODE_CASTING)) {
        assert.ok(cast.event(verse) < 0.4, `${mode}: ${cast.event(verse)}`);
    }
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
            for (const key of ['contrast', 'arrival', 'passive', 'epic', 'sustain', 'rhythmic']) {
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
