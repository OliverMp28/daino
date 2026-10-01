// Arco de la canción (Ola 5): tramos, niveles, clímax, subidas y momentos.
//
// Con canciones sintéticas de estructura conocida: el arco debe leer la forma
// que la canción tiene, sin inventarse picos en un tema plano. Tras el playtest
// de la 6b, los tramos empiezan donde el sonido cambia (songChanges.js) y el
// clímax que entra de golpe empieza en el golpe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMusicModel } from '../../resources/js/game/levels/musicModel.js';
import { ARC_LEVEL, ARC_RULES, buildSongArc } from '../../resources/js/game/levels/songArc.js';
import { DEFAULT_SONG_SECTIONS, makeSyntheticSong } from './helpers/synthetic-audio.mjs';

const arcOf = (analysis) => buildSongArc(buildMusicModel(analysis));

test('forma pop: intro calma, estrofa groove, estribillos empujan, puente respira, último estribillo clímax', () => {
    for (const bpm of [72, 118, 150]) {
        const analysis = makeSyntheticSong({ bpm });
        const arc = arcOf(analysis);
        assert.equal(arc.segments.length, DEFAULT_SONG_SECTIONS.length, `${bpm} BPM: un tramo por sección`);
        assert.deepEqual(arc.segments.map((s) => s.level), [1, 2, 3, 2, 3, 1, 4, 0], `${bpm} BPM`);
        assert.equal(arc.climax, 6, 'el clímax es el estribillo final');
        assert.deepEqual(arc.segments.map((s) => s.drop), [false, false, false, false, false, false, true, false], 'drop al entrar al clímax tras el puente');
        assert.deepEqual(arc.segments.map((s) => s.lift), [false, false, true, false, true, false, false, false], 'lift al entrar en cada estribillo desde la estrofa');
    }
});

test('subida: los dos compases antes de un drop se marcan (1 y 2), y solo esos', () => {
    const arc = arcOf(makeSyntheticSong({ bpm: 120 }));
    const climax = arc.segments[arc.climax];
    const marked = arc.bars.map((b, i) => [i, b.build]).filter(([, build]) => build > 0);
    assert.deepEqual(marked, [[climax.bar0 - 2, 1], [climax.bar0 - 1, 2]]);
});

test('escalada: el mismo material suena más intenso cada vez que vuelve', () => {
    // Tres estribillos con la MISMA energía: sin escalada serían el mismo nivel.
    const analysis = makeSyntheticSong({
        bpm: 110,
        sections: [
            { bars: 8, energy: 0.5, hits: 0.5, role: 'verse', cluster: 'V' },
            { bars: 8, energy: 0.62, hits: 0.62, role: 'chorus', cluster: 'C' },
            { bars: 8, energy: 0.5, hits: 0.5, role: 'verse', cluster: 'V' },
            { bars: 8, energy: 0.62, hits: 0.62, role: 'chorus', cluster: 'C' },
            { bars: 8, energy: 0.5, hits: 0.5, role: 'verse', cluster: 'V' },
            { bars: 8, energy: 0.62, hits: 0.62, role: 'chorus', cluster: 'C' },
        ],
    });
    const arc = arcOf(analysis);
    const choruses = arc.segments.filter((s) => s.role === 'chorus');
    assert.deepEqual(choruses.map((s) => s.occurrence), [0, 1, 2]);
    assert.ok(choruses[0].level < choruses[2].level, `niveles de los estribillos: ${choruses.map((s) => s.level)}`);
    assert.equal(choruses[2].climax, true, 'el último estribillo es el clímax');
});

test('tema plano: groove sin reposo inventado, sin partir tramos donde el sonido no cambia, y aun así un clímax en la segunda mitad', () => {
    const analysis = makeSyntheticSong({
        bpm: 124,
        sections: Array.from({ length: 6 }, (_, i) => ({ bars: 8, energy: 0.64 + (i % 2) * 0.03, hits: 0.7, cluster: i % 2 ? 'B' : 'A' })),
    });
    const arc = arcOf(analysis);
    const levels = arc.segments.map((s) => s.level);
    assert.ok(!levels.includes(ARC_LEVEL.REST), `sin reposo en un tema plano: ${levels}`);
    assert.ok(arc.segments.filter((s) => !s.climax).every((s) => s.level === ARC_LEVEL.GROOVE || s.level === ARC_LEVEL.DRIVE), `niveles ${levels}`);
    assert.ok(arc.segments.length <= 2, `seis secciones que suenan igual no son seis tramos: ${arc.segments.length}`);
    const climax = arc.segments[arc.climax];
    assert.ok((climax.t0 + climax.t1) / 2 > analysis.durationSec * 0.45);
});

test('clímax largo que entra de golpe: empieza en el golpe (≤ 16 compases y ≤ 40 s); lo que sigue conserva su nivel', () => {
    // What's Up Danger: el final entra a las 2:37 y dura 45 s. Antes el clímax
    // eran sus últimos compases y empezaba a las 2:52, donde no cambia nada.
    for (const bpm of [70, 95, 128]) {
        const analysis = makeSyntheticSong({
            bpm,
            sections: [
                { bars: 8, energy: 0.4, hits: 0.4, role: 'verse' },
                { bars: 24, energy: 0.9, hits: 0.95, role: 'chorus' },
            ],
        });
        const arc = arcOf(analysis);
        const climax = arc.segments[arc.climax];
        assert.equal(climax.bar0, 8, `${bpm} BPM: el clímax empieza donde entra el estribillo`);
        assert.ok(climax.drop, `${bpm} BPM: y entra como drop`);
        assert.ok(climax.bar1 - climax.bar0 <= ARC_RULES.climaxMaxBars && climax.t1 - climax.t0 <= ARC_RULES.climaxMaxS + 1e-6, `${bpm} BPM: clímax de ${(climax.t1 - climax.t0).toFixed(1)} s`);
        assert.equal((32 - climax.bar1) % ARC_RULES.phraseBars, 0, `${bpm} BPM: termina en una frase contada desde el final del tramo`);
        const rest = arc.segments[arc.climax + 1];
        assert.equal(rest.role, 'chorus', `${bpm} BPM: el resto del estribillo queda como tramo propio`);
        assert.ok(rest.level < ARC_LEVEL.CLIMAX);
        assert.equal(arc.segments.filter((s) => s.drop).length, 1);
    }
});

test('clímax largo al que no se llega de golpe: se queda con su final; lo anterior conserva su nivel', () => {
    const analysis = makeSyntheticSong({
        bpm: 70,
        sections: [
            { bars: 8, energy: 0.95, hits: 0.95, role: 'chorus', cluster: 'A' },
            { bars: 24, energy: 0.85, hits: 0.9, role: 'chorus', cluster: 'B' },
        ],
    });
    const arc = arcOf(analysis);
    const climax = arc.segments[arc.climax];
    assert.ok(climax.bar1 - climax.bar0 <= ARC_RULES.climaxMaxBars);
    assert.ok(climax.t1 - climax.t0 <= ARC_RULES.climaxMaxS + 1e-6, `clímax de ${(climax.t1 - climax.t0).toFixed(1)} s`);
    assert.equal(climax.bar1, arc.bars.length, 'el clímax es el final del tramo');
    const head = arc.segments[arc.climax - 1];
    assert.equal(head.bar0, 8, 'el principio del tramo largo queda como tramo propio');
    assert.ok(head.level < ARC_LEVEL.CLIMAX);
});

test('un break y la vuelta dentro de una misma sección del análisis: la vuelta abre el clímax y el break no es un tramo', () => {
    // What's Up Danger 2:24-3:22: el analizador ve una sola sección (mismo
    // material) con un break de 2 compases casi en silencio y la vuelta de golpe.
    for (const bpm of [95, 120, 150]) {
        const analysis = makeSyntheticSong({
            bpm,
            sections: [
                { bars: 8, energy: 0.3, hits: 0.35, role: 'intro', cluster: 'A' },
                { bars: 16, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'B' },
                { bars: 8, energy: 0.6, hits: 0.6, role: 'verse', cluster: 'C' },
                { bars: 2, energy: 0.15, hits: 0.15, role: 'verse', cluster: 'C' },
                { bars: 18, energy: 0.92, hits: 0.9, role: 'verse', cluster: 'C' },
                { bars: 4, energy: 0.2, hits: 0.2, role: 'outro', cluster: 'A' },
            ],
        });
        const s = analysis.sections;
        analysis.sections = [s[0], s[1], { ...s[2], endSec: s[4].endSec }, s[5]];
        const arc = arcOf(analysis);
        const climax = arc.segments[arc.climax];
        assert.equal(climax.bar0, 34, `${bpm} BPM: el clímax empieza en la vuelta`);
        assert.ok(climax.drop, `${bpm} BPM`);
        assert.ok(!arc.segments.some((seg) => seg.bar0 === 32), `${bpm} BPM: el break de 2 compases se queda con lo anterior`);
        assert.deepEqual(arc.bars.slice(32, 34).map((b) => b.build), [1, 2], `${bpm} BPM: el break es la subida al drop`);
    }
});

test('regresión: recortar el clímax nunca deja un tramo de 1-3 compases (dos drops seguidos)', () => {
    // Estribillo final de 17-19 compases: con recorte a 16 quedaría un trozo
    // de 1-3 compases convertido en tramo propio, con su propio drop.
    for (const bars of [17, 18, 19]) {
        const analysis = makeSyntheticSong({
            bpm: 142,
            sections: [
                { bars: 12, energy: 0.5, hits: 0.5, role: 'verse' },
                { bars: 8, energy: 0.25, hits: 0.2, role: 'bridge' },
                { bars, energy: 0.95, hits: 1, role: 'chorus' },
                { bars: 4, energy: 0.2, hits: 0.2, role: 'outro' },
            ],
        });
        const arc = arcOf(analysis);
        for (const seg of arc.segments) {
            assert.ok(seg.bar1 - seg.bar0 >= 4, `${bars} compases: tramo de ${seg.bar1 - seg.bar0} en ${seg.t0.toFixed(1)} s`);
        }
        assert.equal(arc.segments.filter((s) => s.drop).length, 1, `${bars} compases: un solo drop`);
    }
});

test('después del clímax nada iguala su nivel', () => {
    const analysis = makeSyntheticSong({
        bpm: 100,
        sections: [
            { bars: 8, energy: 0.4, hits: 0.4 },
            { bars: 8, energy: 0.95, hits: 1 },
            { bars: 8, energy: 0.95, hits: 1 },
        ],
    });
    const arc = arcOf(analysis);
    for (let i = arc.climax + 1; i < arc.segments.length; i++) {
        assert.ok(arc.segments[i].level < ARC_LEVEL.CLIMAX);
    }
});

test('los oficiales: un clímax por canción en la segunda mitad y los tramos cubren todos los compases', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/seeds/official/baked');
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
        const { analysis } = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        const model = buildMusicModel(analysis);
        const arc = buildSongArc(model);
        assert.equal(arc.segments.filter((s) => s.climax).length, 1, file);
        const c = arc.segments[arc.climax];
        assert.ok((c.t0 + c.t1) / 2 > analysis.durationSec * 0.45, `${file}: clímax en ${c.t0}-${c.t1}`);
        let bar = 0;
        for (const s of arc.segments) {
            assert.equal(s.bar0, bar, `${file}: tramos contiguos`);
            bar = s.bar1;
        }
        assert.equal(bar, model.bars.length, `${file}: cubren la canción`);
    }
});
