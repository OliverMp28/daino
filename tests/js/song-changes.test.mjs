// Dónde cambia la canción (tras el playtest de la Ola 6b): las fronteras que parten los tramos.
//
// Se protege que las fronteras sean las que se oyen, también dentro de una misma
// sección del analizador (que agrupa por material: un break y la vuelta tras él
// son el mismo material a otro volumen):
//   - un break y la vuelta de golpe se detectan en su compás, con su dirección;
//   - una parada de un compás, una canción uniforme o un cambio de sección que no
//     cambia el sonido no son cambios que partan nada;
//   - "se llena" y "sube de energía" no son lo mismo (un break de solo bajo sube
//     de energía y se vacía);
//   - determinista.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { ARC_RULES, buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { detectChanges } from '../../resources/js/game/levels/songChanges.js';
import { makeSyntheticSong } from './helpers/synthetic-audio.mjs';

/** Funde en una sola sección del análisis las secciones [from, to], como un analizador que agrupa por material. */
function mergeSections(analysis, from, to) {
    const s = analysis.sections;
    analysis.sections = [...s.slice(0, from), { ...s[from], endSec: s[to].endSec }, ...s.slice(to + 1)];
    return analysis;
}

/** Estrofa, y en UNA sección: groove, break de 2 compases casi en silencio y la vuelta de golpe (What's Up Danger, 2:24-3:22). */
function breakSong(bpm) {
    return mergeSections(makeSyntheticSong({
        bpm,
        sections: [
            { bars: 8, energy: 0.3, hits: 0.35, role: 'intro', cluster: 'A' },
            { bars: 16, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'B' },
            { bars: 8, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'C' },
            { bars: 2, energy: 0.15, hits: 0.15, role: 'verse', cluster: 'C' },
            { bars: 18, energy: 0.92, hits: 0.9, role: 'verse', cluster: 'C' },
            { bars: 4, energy: 0.2, hits: 0.2, role: 'outro', cluster: 'A' },
        ],
    }), 2, 4);
}

test('un break y la vuelta de golpe dentro de una misma sección del análisis: dos cambios en su compás, uno que baja y otro que sube', () => {
    for (const bpm of [95, 120, 150]) {
        const analysis = breakSong(bpm);
        assert.equal(analysis.sections.length, 4, 'el analizador ve una sola sección del compás 24 al 52');
        const { boundaries } = detectChanges(buildMusicModel(analysis));
        const at = (bar) => boundaries.find((b) => b.bar === bar);
        const fall = at(32);
        const back = at(34);
        assert.ok(fall !== undefined && back !== undefined, `${bpm} BPM: ${JSON.stringify(boundaries)}`);
        assert.ok(fall.rise < -0.3 && fall.strength >= ARC_RULES.splitStrength, `${bpm} BPM: el break ${JSON.stringify(fall)}`);
        assert.ok(back.rise > 0.5 && back.strength > fall.strength, `${bpm} BPM: la vuelta ${JSON.stringify(back)}`);
        assert.equal(boundaries.filter((b) => b.bar > 24 && b.bar < 52).length, 2, `${bpm} BPM: nada más dentro de la sección`);
    }
});

test('una parada de un compás no es un cambio; una canción uniforme no tiene ninguno', () => {
    const stop = mergeSections(makeSyntheticSong({
        bpm: 120,
        sections: [
            { bars: 12, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' },
            { bars: 1, energy: 0.1, hits: 0.1, role: 'verse', cluster: 'A' },
            { bars: 12, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' },
        ],
    }), 0, 2);
    assert.deepEqual(detectChanges(buildMusicModel(stop)).boundaries, []);
    assert.ok(buildSongArc(buildMusicModel(stop)).segments.every((s) => s.bar0 < 11 || s.bar0 > 14), 'ningún tramo empieza en la parada');

    const uniform = makeSyntheticSong({ bpm: 120, sections: [{ bars: 40, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' }] });
    assert.deepEqual(detectChanges(buildMusicModel(uniform)).boundaries, []);
});

test('un cambio de sección que no cambia el sonido es débil y no parte el tramo; uno que lo cambia, sí', () => {
    const analysis = makeSyntheticSong({
        bpm: 120,
        sections: [
            { bars: 8, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' },
            { bars: 8, energy: 0.6, hits: 0.6, role: 'chorus', cluster: 'B' },
            { bars: 8, energy: 0.9, hits: 0.9, role: 'chorus', cluster: 'C' },
            { bars: 8, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' },
        ],
    });
    const model = buildMusicModel(analysis);
    const { boundaries } = detectChanges(model);
    assert.deepEqual(boundaries.map((b) => b.bar), [8, 16, 24]);
    assert.ok(boundaries.every((b) => b.section), 'las tres son de sección');
    assert.ok(boundaries[0].strength < ARC_RULES.splitStrength, `sin cambio de sonido: ${boundaries[0].strength}`);
    assert.ok(boundaries[1].strength >= ARC_RULES.splitStrength && boundaries[1].rise > 0);
    assert.ok(boundaries[2].strength >= ARC_RULES.splitStrength && boundaries[2].rise < 0);
    assert.deepEqual(buildSongArc(model).segments.map((s) => s.bar0), [0, 16, 24]);
});

test('llenarse no es subir de energía: un break de solo bajo sube de energía y se vacía', () => {
    const analysis = makeSyntheticSong({
        bpm: 110,
        sections: [
            { bars: 12, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' },
            { bars: 8, energy: 0.72, hits: 0.3, role: 'break', cluster: 'B' },
            { bars: 12, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'A' },
        ],
    });
    // Bandas: en la estrofa suena todo; en el break, solo los graves.
    const breakSpan = analysis.sections[1];
    const n = analysis.energy.values.length;
    const band = (inBreak) => Array.from({ length: n }, (_, k) => {
        const t = k * analysis.energy.hopSec;
        return t >= breakSpan.startSec && t < breakSpan.endSec ? inBreak : 0.6;
    });
    analysis.energy.bands = { low: band(0.95), mid: band(0.15), high: band(0.1) };

    const { boundaries } = detectChanges(buildMusicModel(analysis));
    const into = boundaries.find((b) => b.bar === 12);
    const out = boundaries.find((b) => b.bar === 20);
    assert.ok(into.rise > 0 && into.fill < -0.1, `entrada al break: ${JSON.stringify(into)}`);
    assert.ok(out.rise < 0 && out.fill > 0.1, `salida: ${JSON.stringify(out)}`);
});

test('determinista: mismo análisis, mismas fronteras', () => {
    const analysis = breakSong(128);
    assert.deepEqual(detectChanges(buildMusicModel(analysis)).boundaries, detectChanges(buildMusicModel(structuredClone(analysis))).boundaries);
});
