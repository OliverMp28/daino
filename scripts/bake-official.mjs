#!/usr/bin/env node
// Charting y serialización de los niveles oficiales horneados (Olas 2 y 4).
//
//     bun run bake:official                   re-chartea todos desde su análisis guardado
//     bun run bake:official -- --only=hope    solo algunos
//     bun run bake:official -- --check        ¿están al día? (exit 1 si no) — sirve en CI
//
// Cada `database/seeds/official/baked/<slug>.json` guarda el hash del audio, el
// ANÁLISIS y el CHART. Después `composer seed:official` (PHP) los importa.
//
// Desde la Ola 4 el análisis lo hace el servicio `analyzer` (Python), que es
// quien crea o renueva el horneado:
//
//     docker compose run --rm -v ./database/seeds/official/baked:/srv/daino/database/seeds/official/baked \
//         -v ./docs/legacy/audios:/audios:ro analyzer bake-official --from /audios
//
// Ese comando analiza y, para charter y escribir, llama a ESTE script. Así el
// charting tiene una sola implementación (la del navegador) y el JSON una sola
// forma canónica, y este script puede re-chartear sin audio, sin ffmpeg y sin
// Python cuando solo cambia el charter o la escala de dificultad.
//
// Los JSON horneados SÍ van al repo: son tiempos y metadatos, no audio.
//
// T02.5: cada horneado lleva también su escenario Automático (`sceneAuto`) y
// por qué (`sceneCasting`: rasgos y encaje de cada ambiente). Lo importa el
// seeder a `levels.scene_auto`. Un `scene` en el manifiesto manda sobre él.
//
// Alternativa sin Docker: `--reanalyze-js` analiza con el analizador JS del
// navegador (formato 1, menos rico: sin beats, secciones ni techo de dificultad).

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeAudio, isChartableAnalysis } from '../resources/js/game/levels/analyze.js';
import { CHARTER_NAME, CHARTER_VERSION } from '../resources/js/game/levels/chartFormat.js';
import { sha256Hex } from '../resources/js/storage/hash.js';
import { decodeWithFfmpeg } from './lib/ffmpegDecode.mjs';
import { chartFromAnalysis } from './lib/chartFromAnalysis.mjs';

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

    try {
        let analysis = usableAnalysis(previous, entry) ? previous.analysis : null;
        let sha = previous?.audio?.sha256 ?? null;
        let bytes = previous?.audio?.bytes ?? 0;

        if (args['reanalyze-js'] && !args.check) {
            const audioPath = path.join(fromDir, entry.file);
            if (!(await exists(audioPath))) throw new Error(`falta el MP3 (${audioPath})`);
            const buf = await readFile(audioPath);
            bytes = buf.length;
            sha = await sha256Hex(buf);
            analysis = await analyzeAudio(await decodeWithFfmpeg(audioPath), { yieldEvery: 0 });
        } else if (analysis === null) {
            stale++;
            console.log(`  FALTA ${entry.slug}: sin análisis horneado — analízalo con el servicio analyzer (ver cabecera)`);
            continue;
        }

        const baked = bake(entry, sha, bytes, analysis);
        const text = serializeBaked(baked);
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
        const obstacles = baked.chart.events.filter((e) => e.type === 'obstacle').length;
        const top = Math.max(baked.chart.world.speedPxS, ...(baked.chart.world.speedChanges ?? []).map((c) => c.speedPxS));
        console.log(`  HECHO ${entry.slug}: ${obstacles} obstáculos, ${analysis.bpm.toFixed(1)} BPM `
            + `(velocidad ${baked.chart.world.speedPxS}→${top} px/s), ${baked.stats.actionsPerMin} acc/min `
            + `(pico ${baked.stats.peakActionsPerMin}), ${baked.difficulty}★ (medida ${baked.measuredDifficulty}★), `
            + `techo ${baked.difficultyCeiling ?? '—'}, escenario ${baked.sceneAuto ?? 'Cordillera'} [${baked.bakedWith.analyzer}]`);
    } catch (err) {
        failures++;
        console.error(`  FALLO ${entry.slug}: ${err.message}`);
    }
}

if (args.check && stale > 0) {
    console.error(`\n${stale} nivel(es) desactualizados`);
    process.exit(1);
}
process.exit(failures === 0 ? 0 : 1);

// --------------------------- Helpers ---------------------------

/** Un análisis guardado vale si es de este archivo y tiene lo que el charter lee. */
function usableAnalysis(baked, entry) {
    return baked !== null
        && baked.file === entry.file
        && typeof baked.audio?.sha256 === 'string'
        && isChartableAnalysis(baked.analysis);
}

function bake(entry, sha, bytes, analysis) {
    // Ola 5: cada oficial se chartea con la dificultad elegida en el manifiesto
    // (nunca por encima de su techo).
    const out = chartFromAnalysis(analysis, sha, { difficulty: entry.difficulty ?? 'auto' });
    return {
        formatVersion: BAKED_FORMAT_VERSION,
        slug: entry.slug,
        file: entry.file,
        bakedWith: { analyzer: `${analysis.analyzer.name}@${analysis.analyzer.version}`, charter: CHARTER_KEY },
        audio: { sha256: sha, bytes, durationSec: analysis.durationSec },
        difficulty: out.difficulty,
        requestedDifficulty: out.requestedDifficulty,
        measuredDifficulty: out.measuredDifficulty,
        difficultyCeiling: out.difficultyCeiling,
        stats: { ...out.stats, musicalDensity: out.musicalDensity },
        chart: out.chart,
        sceneAuto: out.sceneAuto,
        sceneCasting: out.sceneCasting,
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
