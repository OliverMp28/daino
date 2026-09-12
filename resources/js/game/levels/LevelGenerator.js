// LevelGenerator — orquesta el análisis offline y produce la ObstacleTimeline
// que el spawner consumirá durante el gameplay.
//
// Flujo:
//   1. computeOnsetEnvelope(audioBuffer)    → Float32Array de onsets por hop.
//   2. detectBpm(envelope)                  → BPM determinista.
//   3. pickPeaks(envelope)                  → timestamps de onsets fuertes.
//   4. Filtro de spaciado (descarta onsets muy seguidos).
//   5. Relleno de gaps (inserta obstáculos en tramos vacíos).
//   6. Cada timestamp recibe un `kind` decidido por el PRNG seeded.
//   7. Devuelve un objeto Level con todo lo que la GameSession necesita.
//
// Determinismo verificable: dos llamadas con el mismo (audioBuffer, seed)
// producen el mismo `JSON.stringify(level.timeline)`. Smoke 2 del plan.

import { computeOnsetEnvelope, pickPeaks } from './SpectralFlux.js';
import { detectBpm } from './Bpm.js';
import { Seeded } from './Seed.js';
import { speedFromBpm, SPAWN_WINDOW_S, OBSTACLE_KIND } from '../config.js';

/**
 * @typedef {Object} ObstacleSpawn
 * @property {number} tAt    Tiempo en segundos donde el obstáculo entra al viewport.
 * @property {string} kind   Clave de OBSTACLE_KIND ('CACTUS_SMALL' | 'CACTUS_WIDE' | 'PTERO').
 */

/**
 * @typedef {Object} Level
 * @property {ObstacleSpawn[]} timeline   Lista ordenada por tAt ascendente.
 * @property {number}          bpm        BPM detectado (o FALLBACK_BPM).
 * @property {number}          gameSpeed  Velocidad de scroll en px/s, derivada de BPM.
 * @property {number}          seed       Seed usado (preservar para reproducir).
 * @property {number}          durationSec  Duración total del audio en segundos.
 * @property {string}          sourceName Nombre del archivo MP3 (para HUD/persistencia).
 * @property {{ confidence: number, onsetsRaw: number, onsetsKept: number }} stats
 */

/**
 * @param {AudioBuffer} audioBuffer
 * @param {{ seed?: number, sourceName?: string, onProgress?: (msg:string)=>void }} [opts]
 * @returns {Promise<Level>}
 */
export async function generate(audioBuffer, opts = {}) {
    const sourceName = opts.sourceName ?? 'unknown.mp3';

    if (opts.onProgress) opts.onProgress('Analizando audio…');
    const env = await computeOnsetEnvelope(audioBuffer);

    if (opts.onProgress) opts.onProgress('Detectando BPM…');
    const { bpm, confidence } = detectBpm(env);
    const gameSpeed = speedFromBpm(bpm);

    if (opts.onProgress) opts.onProgress('Generando obstáculos…');
    const onsetsRaw = pickPeaks(env, { thresholdRatio: 1.5, windowSec: 0.4 });
    const onsetsSpaced = filterSpacing(onsetsRaw, SPAWN_WINDOW_S.min);
    const onsetsFilled = fillGaps(onsetsSpaced, audioBuffer.duration, SPAWN_WINDOW_S.max);

    // PRNG seeded para elegir kind de cada obstáculo. Si no se pasa seed,
    // Seeded usa crypto y deja `prng.seed` accesible para guardarlo.
    const prng = new Seeded(opts.seed);

    /** @type {ObstacleSpawn[]} */
    const timeline = onsetsFilled.map((t) => ({
        tAt: t,
        kind: pickKind(prng, t),
    }));

    return {
        timeline,
        bpm,
        gameSpeed,
        seed: prng.seed,
        durationSec: audioBuffer.duration,
        sourceName,
        stats: {
            confidence,
            onsetsRaw: onsetsRaw.length,
            onsetsKept: timeline.length,
        },
    };
}

// --------------------------- Helpers ---------------------------

/**
 * Elige el kind del spawn iterando el REGISTRO OBSTACLE_KIND: filtra los
 * kinds disponibles a ese tAt (`availableFromS` — p. ej. el ptero no sale
 * hasta que el jugador ha aprendido a saltar), normaliza sus `weight` y
 * hace ruleta acumulativa. Añadir un kind al registro basta para que entre
 * en la rotación — este código no cambia.
 *
 * Determinismo: consume exactamente UNA llamada al PRNG por spawn en todas
 * las ramas, y el orden de iteración del registro es estable (insertion
 * order de Object.freeze), así la misma seed produce la misma timeline.
 *
 * @param {Seeded} prng
 * @param {number} tAt
 * @returns {string}
 */
function pickKind(prng, tAt) {
    const r = prng.next();

    const available = Object.entries(OBSTACLE_KIND)
        .filter(([, def]) => tAt >= (def.availableFromS ?? 0));
    if (available.length === 0) return Object.keys(OBSTACLE_KIND)[0];

    let total = 0;
    for (const [, def] of available) total += def.weight ?? 1;

    let acc = 0;
    for (const [key, def] of available) {
        acc += def.weight ?? 1;
        if (r < acc / total) return key;
    }
    return available[available.length - 1][0];
}

/**
 * Elimina onsets que estén a menos de `minGapSec` del último aceptado.
 * Mantiene el primero de cada grupo denso.
 */
function filterSpacing(onsets, minGapSec) {
    if (onsets.length === 0) return [];
    const out = [onsets[0]];
    for (let i = 1; i < onsets.length; i++) {
        if (onsets[i] - out[out.length - 1] >= minGapSec) {
            out.push(onsets[i]);
        }
    }
    return out;
}

/**
 * Si entre dos onsets aceptados hay un hueco mayor que `maxGapSec`, inserta
 * spawns artificiales cada `maxGapSec` para que el nivel no quede vacío en
 * tramos largos sin onsets fuertes.
 */
function fillGaps(onsets, durationSec, maxGapSec) {
    const out = [];
    // Inicio: nada spawnea antes de firstSafeTime — canciones que arrancan
    // con un beat en t=0 generaban un obstáculo inmediato imposible de
    // reaccionar (visto con el WAV sintético del rediseño Jul 2026). Se
    // descartan onsets demasiado tempranos Y se garantiza el margen.
    const firstSafeTime = 1.5;
    onsets = onsets.filter((t) => t >= firstSafeTime);
    if (onsets.length === 0 || onsets[0] > firstSafeTime + maxGapSec) {
        out.push(firstSafeTime);
    }

    for (let i = 0; i < onsets.length; i++) {
        const t = onsets[i];
        if (out.length > 0) {
            const prev = out[out.length - 1];
            const gap = t - prev;
            if (gap > maxGapSec) {
                // Inserta uno cada maxGapSec hasta acercarse a t.
                let cursor = prev + maxGapSec;
                while (cursor < t - 0.1) {  // 0.1s de margen para no pegar al siguiente
                    out.push(cursor);
                    cursor += maxGapSec;
                }
            }
        }
        out.push(t);
    }

    // Cola: si la canción dura más allá del último onset por un margen
    // grande, también rellena. Pero NO insertamos pasados durationSec - 2s
    // (el user ya está cerca del final, deja descansar).
    if (out.length > 0) {
        const last = out[out.length - 1];
        const tailLimit = durationSec - 2;
        if (tailLimit - last > maxGapSec) {
            let cursor = last + maxGapSec;
            while (cursor < tailLimit) {
                out.push(cursor);
                cursor += maxGapSec;
            }
        }
    }

    return out;
}

// Re-export para conveniencia del caller.
export { OBSTACLE_KIND };
