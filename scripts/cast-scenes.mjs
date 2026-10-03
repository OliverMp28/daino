#!/usr/bin/env node
// Los repartos como proceso (T02.5, T03.3): lee {items: [{id, analysis}]} en JSON
// por stdin y escribe por stdout
//   {version, fxVersion, items: [{id, scene, reason, fit, route, fx}]}
// `scene` es el ambiente propuesto o null (la Cordillera); `fx`, la identidad de
// los efectos (`{ palette?, signature? }`) o null (lo de siempre).
//
// Lo invoca `python -m daino_analyzer cast` para volver a repartir los niveles
// que ya tienen análisis del servidor (al cambiar las reglas de
// scenes/sceneCasting.js o de fx/casting.js). Los niveles nuevos no pasan por
// aquí: el worker recibe su reparto junto al chart (scripts/lib/chartFromAnalysis.mjs).
//
// Salida con código 1 y el motivo en stderr si la entrada no es válida.

import { FX_CASTING_VERSION, castFx, fxAutoOf } from '../resources/js/game/fx/casting.js';
import { traitsOfAnalysis } from '../resources/js/game/levels/portraits.js';
import { SCENE_CASTING_VERSION, castScene } from '../resources/js/game/scenes/sceneCasting.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(input?.items)) throw new Error('falta items');
    const items = input.items.map(({ id, analysis }) => {
        const measured = traitsOfAnalysis(analysis ?? null);
        const c = castScene(analysis ?? null, measured);
        return { id, scene: c.scene, reason: c.reason, fit: c.fit, route: c.route, fx: fxAutoOf(castFx(analysis ?? null, measured)) };
    });
    process.stdout.write(JSON.stringify({ version: SCENE_CASTING_VERSION, fxVersion: FX_CASTING_VERSION, items }));
} catch (err) {
    process.stderr.write(`cast-scenes: ${err?.message ?? err}\n`);
    process.exit(1);
}
