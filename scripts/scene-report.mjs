#!/usr/bin/env node
// Informe de los repartos por el carácter de la canción: los rasgos de cada una,
// el escenario Automático (T02.5) y la identidad de sus efectos (T03.3: paleta y
// firma), con sus encajes. Para ajustar las reglas de scenes/sceneCasting.js,
// fx/casting.js y levels/songTraits.js mirando canciones reales.
//
//     bun run cast:report                      los oficiales horneados
//     bun run cast:report -- a.json b.json     análisis sueltos (o horneados)
// (`scenes:report` es el mismo informe.)
//
// Un análisis de cualquier MP3 sale del servicio del analizador:
//     docker compose exec -T analyzer python -m daino_analyzer analyze /ruta/x.mp3 --out /tmp/x.json

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FX_CASTING_RULES, FX_CASTING_VERSION, castFx } from '../resources/js/game/fx/casting.js';
import { FX_PALETTES } from '../resources/js/game/fx/palettes.js';
import { FX } from '../resources/js/game/fx/registry.js';
import { traitsOfAnalysis } from '../resources/js/game/levels/portraits.js';
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
const fxRows = [];
const second = (p) => p.ranking.slice(p.reason === 'clear' ? 1 : 0, 3).filter((r) => r.fit > 0).map((r) => `${r.id} ${r.fit}`).join(', ');
for (const file of sources) {
    const json = JSON.parse(await readFile(file, 'utf8'));
    // Un horneado trae el análisis dentro; un análisis suelto es el propio archivo.
    const analysis = json.analysis ?? json;
    const name = json.slug ?? path.basename(file, '.json');
    const measured = traitsOfAnalysis(analysis);
    const c = castScene(analysis, measured);
    const fx = castFx(analysis, measured);
    fxRows.push({
        canción: name.slice(0, 22),
        paleta: FX_PALETTES[fx.palette]?.label ?? 'Neón',
        'por qué': fx.palette !== null ? fx.paletteCasting.why : (REASONS[fx.paletteCasting.reason] ?? '').replace('ningún ambiente', 'ninguna'),
        encaje: fx.paletteCasting.fit,
        'otras paletas': second(fx.paletteCasting),
        firma: fx.signature !== null ? FX[fx.signature].label : '—',
        'por qué la firma': fx.signature !== null ? fx.signatureCasting.why : '',
        'encaje ': fx.signatureCasting.fit,
        'otras firmas': second(fx.signatureCasting),
    });
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
console.log(`\nIdentidad de los efectos v${FX_CASTING_VERSION} (encaje mínimo ${FX_CASTING_RULES.minFit}, ventaja ${FX_CASTING_RULES.minMargin}). Una firma solo se ve con noche despejada.`);
console.table(fxRows);
