#!/usr/bin/env node
// Reparto de escenarios como proceso (T02.5): lee {items: [{id, analysis}]} en
// JSON por stdin y escribe {version, items: [{id, scene, reason, fit, route}]}
// por stdout. `scene` es el ambiente propuesto o null (la Cordillera).
//
// Lo invoca `python -m daino_analyzer cast-scenes` para volver a repartir los
// niveles que ya tienen análisis del servidor (al cambiar las reglas de
// scenes/sceneCasting.js). Los niveles nuevos no pasan por aquí: el worker
// recibe su escenario junto al chart (scripts/lib/chartFromAnalysis.mjs).
//
// Salida con código 1 y el motivo en stderr si la entrada no es válida.

import { SCENE_CASTING_VERSION, castScene } from '../resources/js/game/scenes/sceneCasting.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(input?.items)) throw new Error('falta items');
    const items = input.items.map(({ id, analysis }) => {
        const c = castScene(analysis ?? null);
        return { id, scene: c.scene, reason: c.reason, fit: c.fit, route: c.route };
    });
    process.stdout.write(JSON.stringify({ version: SCENE_CASTING_VERSION, items }));
} catch (err) {
    process.stderr.write(`cast-scenes: ${err?.message ?? err}\n`);
    process.exit(1);
}
