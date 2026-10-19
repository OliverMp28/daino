// Escenas por nivel (T02, doc 11): el registro, la lista elegible del servidor, el
// selector de quien sube, la Costa (mar, reflejos, islas) y el guardián de
// legibilidad con los fondos de cualquier capa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_SCENE, SCENES, SCENE_ID_PATTERN, SELECTABLE_SCENES, autoSceneId, playSceneId, sceneElements,
} from '../../resources/js/game/scenes/registry.js';
import { LAYER_BACKDROPS, sceneBackdrops } from '../../resources/js/game/scenes/backdrops.js';
import { createSkyState, seaColorAt, skyStateAt } from '../../resources/js/game/scenes/skyModel.js';
import { relativeLuminance, rgbToOklab } from '../../resources/js/game/scenes/color.js';
import { checkReadability } from '../../resources/js/game/scenes/readability.js';
import { ridgeHeights } from '../../resources/js/game/entities/scenery/ridgeShape.js';
import {
    WINDOW_STEPS, buildingWindows, skylineBuildings, skylineCells, skylineGapless,
} from '../../resources/js/game/entities/scenery/skylineShape.js';
import { PIXEL_SCALE, WORLD_VIEW } from '../../resources/js/game/config.js';
import { sceneChoiceView } from '../../resources/js/ui/catalogModel.js';
import { sceneCoverSpec } from '../../resources/js/ui/coverModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const coast = SCENES.coast;

test('registro: ids con la forma de la BD, ambientes elegibles con su descripción, historias nunca elegibles', () => {
    for (const sc of Object.values(SCENES)) {
        assert.match(sc.id, SCENE_ID_PATTERN, `${sc.id}: id que no cabe en levels.scene`);
        assert.ok(sc.kind === 'ambient' || sc.kind === 'story', `${sc.id}: kind ${sc.kind}`);
        if (sc.kind === 'story') assert.equal(sc.selectable, false, `${sc.id}: una historia de autor no se elige`);
        if (sc.selectable) assert.ok(sc.blurb.length > 10, `${sc.id}: sin descripción para el selector`);
        assert.ok(Number.isFinite(sc.horizonRise) && sc.horizonRise >= 0, `${sc.id}: horizonRise`);
        // Con mar, el horizonte está por encima del suelo y el agua tiene color.
        if (sc.layers.some((l) => l.type === 'sea')) {
            assert.ok(sc.horizonRise > 0 && typeof sc.sea?.deep === 'string', `${sc.id}: mar sin horizonte o sin color`);
        }
    }
    assert.ok(SELECTABLE_SCENES.some((s) => s.id === DEFAULT_SCENE), 'la de siempre se puede elegir');
    assert.ok(SELECTABLE_SCENES.length >= 2);
});

test('la lista de ambientes elegibles del servidor es la del registro', () => {
    const php = readFileSync(path.join(ROOT, 'app/Services/SceneCatalog.php'), 'utf8');
    const list = /SELECTABLE\s*=\s*\[([^\]]*)\]/.exec(php);
    assert.ok(list, 'SceneCatalog::SELECTABLE no encontrada');
    const ids = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(ids, SELECTABLE_SCENES.map((s) => s.id));
    // Y la misma forma de id que el CHECK de la migración 012.
    const migration = readFileSync(path.join(ROOT, 'database/migrations/012_add_level_scene.sql'), 'utf8');
    assert.ok(migration.includes(`'${SCENE_ID_PATTERN.source}'`), 'el CHECK de levels.scene usa otro patrón');
});

test('cada capa dice qué pone detrás del juego y tiene implementación (en el bundle o bajo demanda)', () => {
    const index = readFileSync(path.join(ROOT, 'resources/js/game/entities/scenery/index.js'), 'utf8');
    for (const sc of Object.values(SCENES)) {
        assert.doesNotThrow(() => sceneBackdrops(sc), `${sc.id}: una capa sin fondo declarado`);
        for (const l of sc.layers) {
            assert.ok(l.type in LAYER_BACKDROPS, `${sc.id}: la capa ${l.type} no está en LAYER_BACKDROPS`);
            assert.match(index, new RegExp(`\\b${l.type}: (create|\\(\\) => import\\()`), `${sc.id}: sin implementación para la capa "${l.type}"`);
        }
        const ids = sceneElements(sc).map((e) => e.id);
        assert.equal(new Set(ids).size, ids.length, `${sc.id}: ids repetidos en el panel dev`);
    }
    const coastIds = sceneElements(coast).map((e) => e.id);
    for (const id of ['sea', 'seaCrests', 'seaGlint', 'islands', 'lighthouse', 'lighthouseLight']) {
        assert.ok(coastIds.includes(id), `la Costa enseña "${id}" en el panel dev`);
    }
});

test('los escenarios del manifiesto de oficiales existen en el registro', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'database/seeds/official/manifest.json'), 'utf8'));
    for (const level of manifest.levels) {
        if (level.scene === undefined || level.scene === null) continue;
        assert.ok(Object.hasOwn(SCENES, level.scene), `${level.slug}: escena "${level.scene}" desconocida`);
    }
});

test('con qué escena se juega un nivel: la elegida; si no, la de Automático; si no, la de siempre', () => {
    assert.equal(playSceneId(null), DEFAULT_SCENE);
    assert.equal(playSceneId({ scene: null }), DEFAULT_SCENE);
    assert.equal(playSceneId({ scene: 'coast' }), 'coast');
    // Una escena más nueva que el cliente (o un valor raro) no rompe la partida.
    assert.equal(playSceneId({ scene: 'volcano' }), DEFAULT_SCENE);
    assert.equal(playSceneId({ scene: 'toString' }), DEFAULT_SCENE);
    // T02.5: Automático propone por cómo suena la canción; lo elegido manda.
    assert.equal(playSceneId({ scene: null, scene_auto: 'storm' }), 'storm');
    assert.equal(playSceneId({ scene: 'coast', scene_auto: 'storm' }), 'coast');
    assert.equal(playSceneId({ scene: 'volcano', scene_auto: 'snow' }), 'snow', 'una elegida desconocida cae en Automático');
    // Automático solo propone ambientes elegibles que este cliente conoce.
    assert.equal(autoSceneId({ scene_auto: 'volcano' }), null);
    assert.equal(autoSceneId({ scene_auto: 'toString' }), null);
    assert.equal(playSceneId({ scene: null, scene_auto: 'volcano' }), DEFAULT_SCENE);
});

test('selector del escenario: solo en niveles propios, Automático primero y la elegida marcada', () => {
    assert.equal(sceneChoiceView({ id: 1, is_mine: false, scene: 'coast' }), null);
    const auto = sceneChoiceView({ id: 1, is_mine: true, scene: null });
    assert.equal(auto.current, 'auto');
    assert.deepEqual(auto.options.map((o) => o.value), ['auto', ...SELECTABLE_SCENES.map((s) => s.id)]);
    assert.ok(auto.options[0].label.includes(SCENES[DEFAULT_SCENE].label), 'dice qué es Automático para este nivel');
    // La muestra de cada opción es la portada de su ambiente, a su hora de siempre.
    for (const o of auto.options.slice(1)) assert.deepEqual(o.cover, sceneCoverSpec(SCENES[o.value]));
    assert.equal(sceneChoiceView({ id: 1, is_mine: true, scene: 'coast' }).current, 'coast');
    // Una historia de autor o un id desconocido no son una opción: se ve Automático.
    assert.equal(sceneChoiceView({ id: 1, is_mine: true, scene: 'volcano' }).current, 'auto');
});

test('selector del escenario: Automático enseña su propuesta, o por qué no la hay', () => {
    const mine = { id: 1, is_mine: true, scene: null };
    const proposed = sceneChoiceView({ ...mine, scene_auto: 'storm', difficulty_ceiling: 4 }).options[0];
    assert.equal(proposed.label, `Automático: ${SCENES.storm.label}`);
    assert.match(proposed.hint, /cómo suena/);
    assert.deepEqual(proposed.cover, sceneCoverSpec(SCENES.storm), 'la muestra es la del ambiente propuesto');

    const hints = {
        analizando: sceneChoiceView({ ...mine, scene_auto: null, analysis: { status: 'running' } }).options[0].hint,
        'sin encaje': sceneChoiceView({ ...mine, scene_auto: null, difficulty_ceiling: 3 }).options[0].hint,
        'sin análisis del servidor': sceneChoiceView({ ...mine, scene_auto: null, difficulty_ceiling: null }).options[0].hint,
        // Despliegue con ANALYZER_ENABLED=false: no se promete que el servidor la escuchará.
        'analizador apagado': sceneChoiceView({ ...mine, scene_auto: null, difficulty_ceiling: null }, { serverAnalysis: false }).options[0].hint,
    };
    assert.equal(new Set(Object.values(hints)).size, 4, JSON.stringify(hints));
    assert.doesNotMatch(hints['analizador apagado'], /escuchará/);
    assert.equal(sceneChoiceView({ ...mine, scene_auto: null }).options[0].label, `Automático: ${SCENES[DEFAULT_SCENE].label}`);
});

test('la Costa: el mar refleja el cielo, es más oscuro en la orilla y cambia sin saltos', () => {
    const s = createSkyState();
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let prev = null;
    let worst = 0;
    for (let h = 0; h <= 31; h += 1 / 60) {
        skyStateAt(h, coast, s);
        const far = relativeLuminance(s.sea.far);
        const near = relativeLuminance(s.sea.near);
        assert.ok(near <= far + 1e-6, `a las ${h.toFixed(2)} la orilla es más clara que el horizonte`);
        const now = [rgbToOklab(s.sea.far), rgbToOklab(s.sea.near), rgbToOklab(seaColorAt(s, 0.5))];
        if (prev) for (let i = 0; i < 3; i++) worst = Math.max(worst, dist(prev[i], now[i]));
        prev = now;
    }
    assert.ok(worst < 0.03, `el mar salta ${worst.toFixed(4)} en un minuto`);
    // De día, azul; en el ocaso, el agua toma el color del cielo.
    skyStateAt(12, coast, s);
    assert.ok(s.sea.far[2] > s.sea.far[0], 'de día el mar es azul');
    skyStateAt(18.2, coast, s);
    assert.ok(s.sea.far[0] > s.sea.far[1], 'en el ocaso el mar se tiñe de rosa');
});

test('el reflejo del sol: largo con el sol bajo, apagado cuando se ha puesto; el de la luna, solo de noche', () => {
    const s = createSkyState();
    skyStateAt(12.4, coast, s);
    const noon = s.sea.sunGlint[3];
    assert.equal(s.sea.moonGlint[3], 0, 'sin luna de día');
    skyStateAt(18.2, coast, s);
    assert.ok(s.sea.sunGlint[3] > noon + 0.3, 'el sol bajo deja un reflejo mucho más fuerte');
    skyStateAt(19, coast, s);
    assert.equal(s.sea.sunGlint[3], 0, 'puesto el sol, no hay reflejo');
    skyStateAt(23, coast, s);
    assert.ok(s.sea.moonGlint[3] > 0.5, 'de noche, el reflejo de la luna');
});

test('las islas: sueltas, con los huecos en rachas; la cordillera de siempre no cambia', () => {
    const far = SCENES.mountains.layers.find((l) => l.id === 'mountainsFar').params;
    const heights = ridgeHeights(40, far);
    heights.forEach((h, i) => assert.ok(h >= far.baseRise && h <= far.baseRise + far.jag, `punto ${i}`));

    const islands = coast.layers.find((l) => l.id === 'islands').params;
    const n = 600;
    const hs = ridgeHeights(n, islands);
    const sunk = hs.map((h) => h < 0);
    const share = sunk.filter(Boolean).length / n;
    assert.ok(share > islands.gaps - 0.15 && share < islands.gaps + 0.15, `huecos: ${share}`);
    for (let i = 0; i < n; i++) {
        assert.equal(sunk[i], sunk[Math.floor(i / islands.gapRun) * islands.gapRun], 'un hueco dura su racha entera');
    }
    // Determinista: el paisaje no cambia al redimensionar.
    assert.deepEqual(ridgeHeights(n, islands), hs);
});

test('el guardián mide el mar: un mar claro detrás de los cactus no pasa', () => {
    const s = createSkyState();
    skyStateAt(15, coast, s);
    assert.deepEqual(checkReadability(s, coast), []);
    s.sea.far.set([0.3, 0.9, 0.55]);
    s.sea.near.set([0.3, 0.9, 0.55]);
    const fails = checkReadability(s, coast);
    assert.ok(fails.some((f) => f.backdrop === 'sea' && f.subject.startsWith('CACTUS')), JSON.stringify(fails[0]));
});

test('el guardián mide la forma real de las crestas: sus valles dejan ver el horizonte, y la neblina es la que cabe', () => {
    // La cordillera NO tapa el cielo hasta 40 unidades (lo que se creía en el
    // T01): sus valles bajan casi al suelo. Y en la Costa el horizonte está a la
    // vista. Con la neblina de antes (el doble en las horas cálidas), el cristal
    // afilado y el orbe se perdían contra él (doc 11, T02.2).
    const far = sceneBackdrops(SCENES.mountains).find((b) => b.id === 'mountainsFar');
    assert.ok(far.solid < 5, `los valles lejanos bajan a ${far.solid}`);
    assert.ok(far.to < 90, `y las crestas no pasan de ${far.to}`);

    const s = createSkyState();
    for (const sc of [SCENES.mountains, coast]) {
        let fails = 0;
        for (let h = 17; h <= 31; h += 0.1) {
            skyStateAt(h, sc, s);
            s.sky.haze[3] *= 2;
            fails += checkReadability(s, sc).length;
        }
        assert.ok(fails > 0, `${sc.id}: con el doble de neblina el guardián ya no pasa`);
    }
});

test('la ciudad: los edificios lejanos tapan el cielo sin huecos a cualquier ancho; los cercanos dejan hueco', () => {
    const far = SCENES.city.layers.find((l) => l.id === 'cityFar').params;
    const nearP = SCENES.city.layers.find((l) => l.id === 'cityNear').params;
    for (const width of [520, 1000, 1066, 1100, 1333, WORLD_VIEW.maxWidth]) {
        const cells = skylineCells(width, PIXEL_SCALE);
        const farB = skylineBuildings(cells, far);
        assert.ok(skylineGapless(farB, cells), `a ${width} de ancho hay huecos en los lejanos`);
        for (const b of farB) {
            assert.ok(b.h >= far.minH && b.h <= far.maxH, `alto ${b.h}`);
            // Las ventanas, dentro de su edificio y con su escalón de encendido.
            for (const w of buildingWindows(b, 0, far.seed)) {
                assert.ok(w.x > b.x && w.x < b.x + b.w - 1 && w.y > 0 && w.y < b.h - 1, 'ventana fuera del edificio');
                assert.ok(w.step >= 0 && w.step < WINDOW_STEPS);
            }
        }
        const nearB = skylineBuildings(cells, nearP);
        assert.ok(nearB.at(-1).x + nearB.at(-1).w <= cells, 'ningún edificio cruza el borde del periodo');
    }
    // La misma ciudad cada vez (por hash): no cambia al redimensionar.
    const c = skylineCells(1100, PIXEL_SCALE);
    assert.deepEqual(skylineBuildings(c, far), skylineBuildings(c, far));
});

test('el cielo encapotado: vela el sol y la luna, esconde las estrellas y cubre de nubes', () => {
    const clear = createSkyState();
    const storm = createSkyState();
    skyStateAt(15, SCENES.mountains, clear);
    skyStateAt(15, SCENES.storm, storm);
    assert.ok(storm.sun.glow[3] === clear.sun.glow[3] && storm.sun.glow[0] < clear.sun.glow[0], 'el resplandor del sol, apagado');
    assert.ok(storm.clouds.cover > clear.clouds.cover, 'más nubes');
    assert.ok(relativeLuminance(storm.sky.top) < relativeLuminance(clear.sky.top), 'un cielo más oscuro');
    skyStateAt(23, SCENES.mountains, clear);
    skyStateAt(23, SCENES.storm, storm);
    assert.ok(storm.stars.vis < 0.1, 'casi sin estrellas en la tormenta');
    assert.ok(storm.moon.color[3] < clear.moon.color[3] * 0.5, 'la luna, velada');
    // La nieve y la lluvia se tiñen con la hora y son más claras que el cielo.
    skyStateAt(18.2, SCENES.snow, storm);
    assert.ok(relativeLuminance(storm.arc.snowColor) > relativeLuminance(storm.sky.horizon) * 2);
});
