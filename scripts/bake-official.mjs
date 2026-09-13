#!/usr/bin/env node
// Horneado de los niveles oficiales (Ola 2).
//
//     bun run bake:official                       lee los MP3 de storage/official/
//     bun run bake:official -- --from=docs/legacy/audios
//     bun run bake:official -- --only=hope,time --force
//     bun run bake:official -- --check            ¿están al día? (exit 1 si no)
//
// Para cada entrada de `database/seeds/official/manifest.json` produce
// `database/seeds/official/baked/<slug>.json` con el hash del audio, el análisis
// y el chart. Después `composer seed:official` (PHP) lo importa a la base de
// datos y enlaza el MP3.
//
// Por qué hornear y no dejar que el primer jugador analice: un jugador nuevo
// debe pulsar JUGAR y estar jugando al momento. Con el chart horneado, jugar un
// oficial es descargar el audio y decodificarlo; ningún navegador analiza nada.
//
// Usa EXACTAMENTE el mismo analizador y charter que el navegador (los módulos de
// resources/js), y un decodificador que produce las mismas muestras que Chrome
// (ver scripts/lib/ffmpegDecode.mjs). Así el chart horneado es el que el propio
// juego generaría con ese archivo, byte a byte.
//
// Los JSON horneados SÍ van al repo: son tiempos y metadatos, no audio. Un
// despliegue nuevo solo necesita copiar los MP3 y ejecutar el seed, sin Node
// ni ffmpeg. Este script solo hace falta al añadir canciones o al cambiar el
// analizador/charter. Si el analizador no cambió, re-chartea desde el análisis
// guardado sin decodificar (y sin necesitar los MP3): así `--check` sirve en CI.
//
// La Ola 4 sustituye el analizador por el servicio Python; este script es el
// punto donde se enchufará.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeAudio, ANALYZER_KEY, isUsableAnalysis } from '../resources/js/game/levels/analyze.js';
import { buildChart } from '../resources/js/game/levels/charter.js';
import { CHARTER_NAME, CHARTER_VERSION, normalizeChart, seedFromSha256 } from '../resources/js/game/levels/chartFormat.js';
import { chartStats, difficultyFromStats, difficultyScore } from '../resources/js/game/levels/chartStats.js';
import { sha256Hex } from '../resources/js/storage/hash.js';
import { decodeWithFfmpeg } from './lib/ffmpegDecode.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'database/seeds/official/manifest.json');
const BAKED_DIR = path.join(ROOT, 'database/seeds/official/baked');
export const BAKED_FORMAT_VERSION = 1;
const CHARTER_KEY = `${CHARTER_NAME}@${CHARTER_VERSION}`;

const args = parseArgs(process.argv.slice(2));
const fromDir = path.resolve(ROOT, args.from ?? 'storage/official');
const only = args.only ? new Set(String(args.only).split(',')) : null;

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
await mkdir(BAKED_DIR, { recursive: true });

let failures = 0;
let stale = 0;
for (const entry of manifest.levels) {
    if (only !== null && !only.has(entry.slug)) continue;
    const bakedPath = path.join(BAKED_DIR, `${entry.slug}.json`);
    const previousText = await readTextOrNull(bakedPath);
    const previous = previousText === null ? null : JSON.parse(previousText);
    const audioPath = path.join(fromDir, entry.file);

    try {
        // ¿Se puede reutilizar el análisis horneado? Solo si es del mismo audio
        // y del mismo analizador. El charting se rehace SIEMPRE: cuesta
        // milisegundos, y así un cambio de charter o de la escala de dificultad
        // se detecta sin tener que acordarse de versionar nada a mano.
        let sha = null;
        let bytes = 0;
        if (await exists(audioPath)) {
            const buf = await readFile(audioPath);
            bytes = buf.length;
            sha = await sha256Hex(buf);
        }
        const reusable = previous !== null
            && previous.formatVersion === BAKED_FORMAT_VERSION
            && (sha === null || previous.audio?.sha256 === sha)
            && previous.bakedWith?.analyzer === ANALYZER_KEY
            && isUsableAnalysis(previous.analysis);

        let analysis;
        const started = performance.now();
        if (reusable && !args.force) {
            analysis = previous.analysis;
            sha = previous.audio.sha256;
            bytes = previous.audio.bytes;
        } else if (args.check) {
            stale++;
            console.log(`  STALE ${entry.slug}: ${previous === null ? 'sin horneado' : 'hay que re-analizar'}`);
            continue;
        } else if (sha === null) {
            throw new Error(`falta el MP3 (${audioPath})`);
        } else {
            analysis = await analyzeAudio(await decodeWithFfmpeg(audioPath), { yieldEvery: 0 });
        }

        const baked = bake(entry, sha, bytes, analysis);
        const text = serializeBaked(baked);
        const ms = Math.round(performance.now() - started);

        if (text === previousText) {
            console.log(`  igual ${entry.slug}`);
            continue;
        }
        if (args.check) {
            stale++;
            console.log(`  STALE ${entry.slug}: el charter o la escala de dificultad dan otro resultado`);
            continue;
        }
        await writeFile(bakedPath, text);
        console.log(`  HECHO ${entry.slug}: ${baked.chart.events.length} eventos, ${analysis.bpm.toFixed(1)} BPM, `
            + `${baked.stats.actionsPerMin} acc/min, margen ${Math.round(baked.stats.meanWindowS * 1000)} ms, `
            + `${baked.difficulty}★ (score ${baked.stats.score}), ${ms} ms`);
    } catch (err) {
        failures++;
        console.error(`  FALLO ${entry.slug}: ${err.message}`);
    }
}

if (args.check && stale > 0) {
    console.error(`\n${stale} nivel(es) desactualizados: ejecuta bun run bake:official`);
    process.exit(1);
}
process.exit(failures === 0 ? 0 : 1);

/**
 * Horneado de un nivel. Misma seed que usa el navegador con ese archivo (la
 * derivada del hash), así que el chart es el que el juego generaría.
 */
function bake(entry, sha, bytes, analysis) {
    const { chart: built } = buildChart(analysis, { sha256: sha, seed: seedFromSha256(sha) });
    const { chart } = normalizeChart(built);
    const stats = chartStats(chart);
    return {
        formatVersion: BAKED_FORMAT_VERSION,
        slug: entry.slug,
        file: entry.file,
        bakedWith: { analyzer: ANALYZER_KEY, charter: CHARTER_KEY },
        audio: { sha256: sha, bytes, durationSec: analysis.durationSec },
        difficulty: difficultyFromStats(stats),
        stats: { ...stats, score: difficultyScore(stats) },
        chart: built,
        analysis,
    };
}

/**
 * Una clave de primer nivel por línea y cada valor compacto: diffs legibles
 * ("cambió el chart de hope") sin una línea por onset.
 */
function serializeBaked(baked) {
    const lines = Object.entries(baked).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `{\n${lines.join(',\n')}\n}\n`;
}

// --------------------------- Helpers ---------------------------

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
        if (m) out[m[1]] = m[2] ?? true;
    }
    return out;
}

async function readTextOrNull(file) {
    try {
        return await readFile(file, 'utf8');
    } catch {
        return null;
    }
}

async function exists(file) {
    try {
        await access(file);
        return true;
    } catch {
        return false;
    }
}
