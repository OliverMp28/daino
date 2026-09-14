#!/usr/bin/env node
// Charter como proceso: lee {analysis, sha256, difficulty?} en JSON por stdin y
// escribe {chart, stats, difficulty, difficultyCeiling, ...} por stdout.
// `difficulty`: 'auto' (por defecto) o 1-5, la que pidió quien subió la canción.
//
// Lo invoca el worker del analizador (Python) para no tener una segunda
// implementación del charting: la jugabilidad vive en un solo sitio, en JS, y la
// usan igual el navegador, el horneado de oficiales y el servidor.
//
// Salida con código 1 y el motivo en stderr si la entrada no es válida.

import { chartFromAnalysis } from './lib/chartFromAnalysis.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const out = chartFromAnalysis(input.analysis, input.sha256, { difficulty: input.difficulty ?? 'auto' });
    process.stdout.write(JSON.stringify(out));
} catch (err) {
    process.stderr.write(`chart-from-analysis: ${err?.message ?? err}\n`);
    process.exit(1);
}
