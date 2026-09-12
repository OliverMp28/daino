// Tests del pipeline completo de generación de niveles.
//
// El invariante que protegen: `generate()` es DETERMINISTA. Misma entrada +
// misma seed ⇒ misma timeline, byte a byte. Es lo que permitirá, a partir de
// la Ola 3, persistir un chart y confiar en que se reproduce igual.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generate } from '../../resources/js/game/levels/LevelGenerator.js';
import { detectBpm } from '../../resources/js/game/levels/Bpm.js';
import { computeOnsetEnvelope } from '../../resources/js/game/levels/SpectralFlux.js';
import { OBSTACLE_KIND, SPAWN_WINDOW_S, FALLBACK_BPM } from '../../resources/js/game/config.js';
import { makeClickTrack, makeDrone } from './helpers/synthetic-audio.mjs';

const OPTS = { yieldEvery: 0 };

test('detecta el BPM de un click track con alta confianza', async () => {
    for (const bpm of [90, 128, 160]) {
        const buf = makeClickTrack({ bpm, durationSec: 20 });
        const env = await computeOnsetEnvelope(buf, OPTS);
        const res = detectBpm(env);

        // El detector aplica sesgo de octava, así que aceptamos el tempo o su
        // doble/mitad: musicalmente son la misma pulsación.
        const candidatos = [bpm, bpm / 2, bpm * 2];
        const acierto = candidatos.some((c) => Math.abs(res.bpm - c) < 3);
        assert.ok(acierto, `bpm real ${bpm}, detectado ${res.bpm.toFixed(1)}`);
        assert.ok(res.confidence > 0.3, `confianza baja (${res.confidence.toFixed(3)}) para un click track limpio`);
    }
});

test('un drone sin pulso cae al BPM de fallback reportando confianza baja', async () => {
    const buf = makeDrone({ durationSec: 15 });
    const env = await computeOnsetEnvelope(buf, OPTS);
    const res = detectBpm(env);

    assert.equal(res.bpm, FALLBACK_BPM, 'sin pulso claro debe usar el fallback');

    // El fallback por correlación baja devuelve la confianza REAL medida, no 0.
    // Es deliberado y es el diseño correcto: permite a quien llama distinguir
    // "no había datos suficientes" (confidence === 0, guardas de longitud o
    // energía nula) de "medí y salió débil". La Ola 4 se apoyará en esto para
    // calcular el techo de dificultad de cada canción.
    assert.ok(res.confidence < 0.1, `esperaba confianza por debajo del umbral, fue ${res.confidence}`);

    // Contraste: una pista con pulso claro debe dar confianza alta.
    const click = await computeOnsetEnvelope(makeClickTrack({ bpm: 128, durationSec: 15 }), OPTS);
    assert.ok(detectBpm(click).confidence > 0.5);
});

test('misma seed ⇒ timeline idéntica', async () => {
    const buf = makeClickTrack({ bpm: 130, durationSec: 25 });
    const a = await generate(buf, { seed: 4242, sourceName: 'test.mp3', ...OPTS });
    const b = await generate(buf, { seed: 4242, sourceName: 'test.mp3', ...OPTS });

    assert.equal(JSON.stringify(a.timeline), JSON.stringify(b.timeline));
    assert.equal(a.bpm, b.bpm);
    assert.equal(a.gameSpeed, b.gameSpeed);
    assert.equal(a.seed, 4242);
});

test('seeds distintas ⇒ timelines distintas', async () => {
    const buf = makeClickTrack({ bpm: 130, durationSec: 25 });
    const a = await generate(buf, { seed: 1, ...OPTS });
    const b = await generate(buf, { seed: 999, ...OPTS });

    // Los instantes salen del audio (iguales); lo que cambia son los kinds.
    assert.deepEqual(a.timeline.map((e) => e.tAt), b.timeline.map((e) => e.tAt));
    assert.notEqual(
        a.timeline.map((e) => e.kind).join(','),
        b.timeline.map((e) => e.kind).join(','),
        'con seeds distintas los tipos de obstáculo deben diferir',
    );
});

test('la timeline respeta el catálogo, el orden y las ventanas de espaciado', async () => {
    const durationSec = 40;
    const buf = makeClickTrack({ bpm: 140, durationSec });
    const level = await generate(buf, { seed: 7, sourceName: 'x.mp3', ...OPTS });

    assert.ok(level.timeline.length > 0, 'la timeline no puede salir vacía');

    for (let i = 0; i < level.timeline.length; i++) {
        const e = level.timeline[i];
        assert.ok(OBSTACLE_KIND[e.kind] !== undefined,
            `kind desconocido "${e.kind}" — reventaría en Obstacle.js al leer .w de undefined`);
        assert.ok(e.tAt >= 0 && e.tAt <= durationSec, `tAt fuera de rango: ${e.tAt}`);
        if (i > 0) {
            const gap = e.tAt - level.timeline[i - 1].tAt;
            assert.ok(gap >= SPAWN_WINDOW_S.min - 1e-6,
                `hueco de ${gap.toFixed(3)}s por debajo del mínimo ${SPAWN_WINDOW_S.min}s`);
        }
    }
});

test('los kinds con availableFromS no aparecen antes de su tiempo de gracia', async () => {
    const buf = makeClickTrack({ bpm: 150, durationSec: 40 });
    const level = await generate(buf, { seed: 3, ...OPTS });

    for (const e of level.timeline) {
        const gracia = OBSTACLE_KIND[e.kind].availableFromS ?? 0;
        assert.ok(e.tAt >= gracia,
            `"${e.kind}" apareció en t=${e.tAt.toFixed(2)}s, antes de su gracia de ${gracia}s`);
    }
});

test('el Level devuelto cumple el contrato que consume GameSession', async () => {
    // Estos son exactamente los campos que GameSession lee. Si alguno cambia
    // de nombre o de tipo, la partida revienta en runtime, no al compilar.
    const buf = makeClickTrack({ bpm: 120, durationSec: 15 });
    const level = await generate(buf, { seed: 11, sourceName: 'cancion.mp3', ...OPTS });

    assert.equal(typeof level.bpm, 'number');
    assert.equal(typeof level.gameSpeed, 'number');
    assert.equal(typeof level.durationSec, 'number');
    assert.equal(level.sourceName, 'cancion.mp3');
    assert.ok(Array.isArray(level.timeline));
    assert.equal(typeof level.stats.confidence, 'number');
    assert.ok(level.gameSpeed >= 250 && level.gameSpeed <= 600, `gameSpeed fuera de clamp: ${level.gameSpeed}`);
});
