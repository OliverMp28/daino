#!/usr/bin/env node
// Informe del escenario Automático (T02.5): rasgos de cada canción y encaje de
// cada ambiente, para ajustar las reglas de scenes/sceneCasting.js y
// levels/songTraits.js mirando canciones reales.
//
//     bun run scenes:report                      los oficiales horneados
//     bun run scenes:report -- a.json b.json     análisis sueltos (o horneados)
//
// Un análisis de cualquier MP3 sale del servicio del analizador:
//     docker compose exec -T analyzer python -m daino_analyzer analyze /ruta/x.mp3 --out /tmp/x.json

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASTING_RULES, SCENE_CASTING_VERSION, TRAIT_NAMES, castScene } from '../resources/js/game/scenes/sceneCasting.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAKED_DIR = path.join(ROOT, 'database/seeds/official/baked');

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sources = files.length > 0
    ? files.map((f) => path.resolve(f))
    : (await readdir(BAKED_DIR)).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(BAKED_DIR, f));

const REASONS = { weak: 'ningún ambiente encaja', ambiguous: 'encaja igual con dos', 'no-analysis': 'sin análisis del servidor' };
const short = { arousal: 'act', valence: 'val', drama: 'dra', groove: 'bucle', sparkle: 'brillo', brightHits: 'b.golpe', shimmer: 'b.suelto', stillness: 'quiet' };
const rows = [];
for (const file of sources) {
    const json = JSON.parse(await readFile(file, 'utf8'));
    // Un horneado trae el análisis dentro; un análisis suelto es el propio archivo.
    const analysis = json.analysis ?? json;
    const name = json.slug ?? path.basename(file, '.json');
    const c = castScene(analysis);
    const row = {
        canción: name.slice(0, 22),
        escenario: c.scene ?? 'Cordillera',
        motivo: REASONS[c.reason] ?? c.why,
        encaje: c.fit,
        siguientes: c.ranking.slice(1, 3).filter((r) => r.fit > 0).map((r) => `${r.scene} ${r.fit}`).join(', '),
    };
    for (const t of TRAIT_NAMES) row[short[t]] = c.traits?.[t] ?? '—';
    rows.push(row);
}
console.log(`Reparto de escenarios v${SCENE_CASTING_VERSION} (encaje mínimo ${CASTING_RULES.minFit}, ventaja ${CASTING_RULES.minMargin})`);
console.table(rows);
