// La interfaz hecha de celdas (T04, doc 12): la letra del juego, la rejilla de
// píxeles enteros y las portadas de los niveles. Todo puro, sin DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FONT, glyphChars, glyphOf, measureText, normalizeText, supportsText, textPath } from '../../resources/js/ui/pixel/font.js';
import { GRID_UNITS, snapUnit } from '../../resources/js/ui/pixel/grid.js';
import { COVER, COVER_PAINTERS, renderCover } from '../../resources/js/ui/pixel/cover.js';
import { COVER_HOURS, COVER_PANS, coverHour, coverKey, coverPan, coverSpec, sceneCoverSpec } from '../../resources/js/ui/coverModel.js';
import { DEFAULT_SCENE, SCENES, SELECTABLE_SCENES } from '../../resources/js/game/scenes/registry.js';
import { PALETTE } from '../../resources/js/game/assets/palette.js';
import { DIFFICULTY_NAMES } from '../../resources/js/game/levels/difficulty.js';
import { cardView, emptyView, sceneChoiceView, tabsFor } from '../../resources/js/ui/catalogModel.js';
import { runPanelView } from '../../resources/js/ui/runPanelModel.js';
import { publishView } from '../../resources/js/ui/publishModel.js';

// --------------------------- Los colores ---------------------------

test('colores: los de la interfaz son los de la paleta del juego', () => {
    const css = readFileSync(new URL('../../resources/css/ui/tokens.css', import.meta.url), 'utf8');
    const token = (name) => css.match(new RegExp(`--d-${name}:\\s*(#[0-9a-f]{6})`))?.[1];
    // Cada papel de la interfaz, con el color del dibujo del que sale.
    const roles = { ground: 'D', speck: 's', edge: 'E', bone: 'W', belly: 'w', beat: 'P', 'beat-lit': 'Z', 'beat-deep': 'p', spike: 'C', gold: 'F', cactus: 'G', warn: 'R' };
    for (const [name, ch] of Object.entries(roles)) {
        assert.equal(token(name), PALETTE[ch], `--d-${name} es el color "${ch}" de la paleta`);
    }
    // Sin lo que el pixel art no tiene: ni degradados de adorno, ni desenfoques, ni esquinas redondas.
    for (const file of ['components', 'menu', 'dialogs', 'catalog', 'run']) {
        const sheet = readFileSync(new URL(`../../resources/css/ui/${file}.css`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal(/backdrop-filter|filter:\s*(blur|drop-shadow|brightness)/.test(sheet), false, `${file}.css: sin filtros`);
        assert.equal(/border-radius:\s*[1-9.]/.test(sheet), false, `${file}.css: sin esquinas redondas`);
        assert.equal(/radial-gradient|text-shadow:[^;]*\d+px\s+\d+px\s+[1-9]/.test(sheet), false, `${file}.css: sin resplandores`);
    }
});

// --------------------------- La letra ---------------------------

test('letra: cada dibujo es una rejilla regular y cabe en su línea', () => {
    const chars = glyphChars();
    assert.ok(chars.length > 70, `${chars.length} caracteres dibujados`);
    for (const ch of chars) {
        const g = glyphOf(ch);
        assert.ok(g.w >= 1 && g.w <= 8, `"${ch}": ancho ${g.w}`);
        for (const row of g.rows) {
            assert.equal(row.length, g.w, `"${ch}": todas sus filas miden lo mismo`);
            assert.match(row, /^[#.]+$/, `"${ch}": solo celdas encendidas o apagadas`);
        }
        assert.ok(g.rows.some((r) => r.includes('#')), `"${ch}": no está vacío`);
        assert.ok(g.y0 >= -FONT.ascent, `"${ch}": no sube más que una tilde`);
        assert.ok(g.y0 + g.rows.length <= FONT.capHeight + FONT.descent, `"${ch}": no baja más que una coma`);
    }
    // Las cifras miden lo mismo: un marcador no baila al cambiar.
    const widths = new Set('0123456789'.split('').map((d) => glyphOf(d).w));
    assert.equal(widths.size, 1, 'cifras del mismo ancho');
    // El 0 y la O se distinguen en un dibujo de celdas solo si se quiere; aquí no se
    // tacha el cero (tachado se leía un 8): lo que no puede pasar es que 0 y 8 coincidan.
    assert.notDeepEqual(glyphOf('0').rows, glyphOf('8').rows);
});

test('letra: mayúsculas, tildes encima y un trazo por racha de celdas', () => {
    assert.equal(normalizeText('Canción'), 'CANCIÓN');
    assert.equal(normalizeText('niño'), 'NIÑO');
    // Las tildes se dibujan por encima de la mayúscula, con una fila de aire.
    for (const ch of 'ÁÉÍÓÚÜÑ') {
        const g = glyphOf(ch);
        assert.ok(g.y0 < 0, `"${ch}" sube de la línea`);
        assert.ok(!g.rows[-g.y0 - 1].includes('#'), `"${ch}": aire entre la tilde y la letra`);
    }
    // La I: tres rachas (arriba, el asta de cinco filas como cinco rachas, abajo).
    const { d, width } = textPath('i');
    assert.equal(width, glyphOf('I').w);
    assert.equal(d.match(/M/g).length, 7, 'una racha por fila');
    assert.ok(d.startsWith('M0 0h4v1h-4z'), d.slice(0, 20));
    // El ancho de un texto: sus letras, un hueco entre ellas y el espacio.
    assert.equal(measureText('AB'), glyphOf('A').w + FONT.gap + glyphOf('B').w);
    assert.equal(measureText('A B'), glyphOf('A').w + FONT.gap + FONT.space + FONT.gap + glyphOf('B').w);
    assert.equal(textPath('A B').width, measureText('A B'));
    assert.equal(textPath('').d, '');
});

test('letra: todo lo que dice el juego está dibujado; un título cualquiera cae a la letra del sistema', () => {
    const said = [
        'DAINO', 'Cada nivel es una canción', 'Jugar', 'Subir mi canción', 'Ranking', 'Perfil', 'Ajustes',
        'Iniciar sesión', 'Iniciar sesión con Vout', 'Cerrar sesión', 'Cerrando…', 'Volver al portal',
        'Niveles', 'Volver', 'Elegir MP3', 'Elegir MP3 y jugar', 'Ver detalles', 'Publicar…', 'Publicar de nuevo…', 'Subiendo…',
        'Reintentar análisis', 'Cargar más (12)', 'Cargando…', 'Sin jugar', 'Juega con tu MP3', 'Tu marca', '16.023 puntos',
        'Dificultad', 'Tempo', '107 BPM', 'Duración', '2:40', 'Escenario', 'Jugadores', '—', 'Ranking del nivel', 'Ranking global',
        'Dificultad al publicar', 'Automática', 'Analizando 45 %', 'En cola', '100 %', '★', '▶', '♪', '←', '+', '×', 'ℹ',
        'Puntos', '000000', '0:00 / 0:00', '¡Superado!', 'Intento 12', 'Saltar', 'Agacharse', 'Pausa', 'Espacio', 'Esc', '↓', 'Toca', 'R',
        'Volumen', 'Personaje', 'Calidad gráfica', 'Auto', 'Alta', 'Media', 'Baja', 'Efectos visuales', 'Completos', 'Suaves', 'Mínimos',
        'Reintentar al chocar', 'Datos locales', 'Borrar', 'Gira el móvil', 'Jugar en vertical', 'Ahora no', 'Mejor',
        'Leyendo tu canción…', 'Preparando nivel…', 'Preparando el audio…', 'Colocando obstáculos…', 'Analizando tu canción… 45 %',
        'Antigravedad', 'Propulsor', 'Doble salto', 'Tu perfil', '±82 ms (+26)', 'Clásico', 'Rosa Beat', 'Dorado',
        ...Object.values(DIFFICULTY_NAMES),
        ...Object.values(SCENES).map((s) => s.label),
        ...SELECTABLE_SCENES.map((s) => `Automático: ${s.label}`),
        ...tabsFor(true).map((t) => t.label),
        emptyView('mine').title, emptyView('public').title,
    ];
    // Lo que dice el panel de partida en cada caso.
    const base = { title: 'x', durationSec: 160, points: 16023, reachedSec: 107, attempt: 7, sections: [] };
    for (const run of [
        { ...base, mode: 'pause', percentage: 43 },
        { ...base, mode: 'results', kind: 'win', percentage: 100, previousBest: null },
        { ...base, mode: 'results', kind: 'collision', percentage: 67, previousBest: { points: 1, percentage: 41 } },
        { ...base, mode: 'results', kind: 'collision', percentage: 21, previousBest: null, timing: { presses: 9, biasMs: -12, sigmaMs: 31 } },
    ]) {
        const view = runPanelView(run);
        said.push(view.heading, view.percentLabel, view.primary.label, ...view.secondary.map((a) => a.label));
        for (const s of view.stats) said.push(s.label, s.value);
        for (const a of [view.primary, ...view.secondary]) if (a.key) said.push(a.key);
    }
    // Las etiquetas de un nivel propio en cada estado.
    for (const level of [
        { is_mine: true }, { is_mine: true, pending_public: true }, { is_mine: true, publish_ready: true },
        { is_mine: true, has_audio: true, analysis: { status: 'failed' } },
    ]) {
        const badge = publishView(level).badge;
        if (badge) said.push(badge);
    }
    const missing = said.filter((text) => !supportsText(text));
    assert.deepEqual(missing, [], 'textos del juego con algún carácter sin dibujar');

    // El contenido no es del juego: lo que no esté dibujado no se pinta a medias.
    assert.equal(supportsText('夜に駆ける'), false);
    assert.equal(supportsText('Beyoncé & Jay-Z'), false, 'la letra no tiene &: se pinta entero en la del sistema');
});

// --------------------------- La rejilla ---------------------------

test('rejilla: cada unidad mide un número entero de píxeles de pantalla, a cualquier zoom', () => {
    for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.625, 3]) {
        for (const rem of [16, 18, 20, 24, 28, 30]) {
            let previous = 0;
            for (const n of GRID_UNITS) {
                const css = snapUnit(n, rem, dpr);
                const device = css * dpr;
                assert.ok(Math.abs(device - Math.round(device)) < 1e-9, `u${n} a ${rem}px ×${dpr}: ${device} px de pantalla`);
                assert.ok(device >= 1, `u${n}: nunca cero`);
                assert.ok(css >= previous, `u${n}: no es menor que la unidad anterior`);
                // Ni mucho más pequeña que su diseño ni más de un píxel de pantalla por encima.
                const design = (n * rem) / 16;
                assert.ok(css >= design * 0.88 - 1e-9, `u${n} a ${rem}px ×${dpr}: ${css} frente a ${design}`);
                assert.ok(css <= design + 1 / dpr + 1e-9, `u${n} a ${rem}px ×${dpr}: ${css} frente a ${design}`);
                previous = css;
            }
        }
    }
    // El caso que motivó la regla: un portátil al 125 %. Una celda de 1 px de pantalla
    // serían 0,8 px de CSS y la letra pequeña no se leería: sube a 2.
    assert.equal(snapUnit(1, 16, 1.25), 1.6);
    assert.equal(snapUnit(2, 16, 1), 2);
});

// --------------------------- Las portadas ---------------------------

/** Capas que son solo efecto: a propósito, no salen en la portada. */
const NOT_ON_COVER = new Set(['spectrum', 'lightning']);

test('portada: cada escena se dibuja entera, a cualquiera de sus horas', () => {
    for (const scene of Object.values(SCENES)) {
        const hours = COVER_HOURS[scene.cycle] ?? [scene.menuHour];
        for (const hour of [...hours, scene.menuHour]) {
            const img = renderCover({ scene, hour, pan: 31 });
            assert.equal(img.cols, COVER.cols);
            assert.equal(img.rows, COVER.rows);
            assert.equal(img.data.length, COVER.cols * COVER.rows * 4);
            let holes = 0;
            for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) holes++;
            assert.equal(holes, 0, `${scene.id} a las ${hour}: celdas sin pintar`);
            assert.equal(img.top.length, 3);
        }
    }
});

test('portada: toda capa de una escena tiene pintor o se deja fuera a propósito', () => {
    for (const scene of Object.values(SCENES)) {
        for (const layer of scene.layers) {
            assert.ok(Object.hasOwn(COVER_PAINTERS, layer.type) || NOT_ON_COVER.has(layer.type),
                `${scene.id}: la capa "${layer.type}" no sale en la portada; añade su pintor a COVER_PAINTERS o apúntala como efecto`);
        }
    }
    // Una capa desconocida no rompe la portada: sale sin ella.
    const odd = { ...SCENES[DEFAULT_SCENE], layers: [...SCENES[DEFAULT_SCENE].layers, { type: 'volcano', id: 'v', label: 'V' }] };
    assert.deepEqual(renderCover({ scene: odd, hour: 13 }).data, renderCover({ scene: SCENES[DEFAULT_SCENE], hour: 13 }).data);
});

test('portada: es la misma siempre, cambia con la hora y con el encuadre, y el suelo es el del juego', () => {
    const scene = SCENES[DEFAULT_SCENE];
    const day = renderCover({ scene, hour: 13, pan: 0 });
    assert.deepEqual(renderCover({ scene, hour: 13, pan: 0 }).data, day.data, 'determinista');
    const night = renderCover({ scene, hour: 23.5, pan: 0 });
    const other = renderCover({ scene, hour: 13, pan: 87 });
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
    assert.ok(differ(day.data, night.data) > day.data.length * 0.5, 'de día y de noche no se parecen');
    assert.ok(differ(day.data, other.data) > 200, 'otro encuadre, otra silueta');
    // El cielo de arriba es igual con otro encuadre: solo se desplaza el paisaje.
    assert.deepEqual(other.data.slice(0, COVER.cols * 4 * 3), day.data.slice(0, COVER.cols * 4 * 3));
    // La fila de la línea del suelo es un solo color (la línea periwinkle, teñida por la hora).
    const y = COVER.rows - COVER.groundRows;
    const line = new Set();
    for (let x = 0; x < COVER.cols; x++) line.add(day.data.slice((y * COVER.cols + x) * 4, (y * COVER.cols + x) * 4 + 3).join(','));
    assert.equal(line.size, 1, 'la línea del suelo, de punta a punta');
    // De noche el cielo es más oscuro que de día.
    const luma = (d) => d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
    assert.ok(luma(night.data) < luma(day.data));
    // La Costa tiene el horizonte más alto que la Cordillera: su mar ocupa esas filas.
    const sea = renderCover({ scene: SCENES.coast, hour: 13, pan: 0 });
    const row = COVER.rows - COVER.groundRows - 4;
    const at = (img, x) => Array.from(img.data.slice((row * COVER.cols + x) * 4, (row * COVER.cols + x) * 4 + 3));
    assert.notDeepEqual(at(sea, 10), at(day, 10));
});

test('portada de un nivel: su escenario, más tarde cuanto más difícil, y un encuadre propio y estable', () => {
    // La hora avanza con la dificultad en cada ciclo.
    for (const [cycle, hours] of Object.entries(COVER_HOURS)) {
        assert.equal(hours.length, 5, `${cycle}: una hora por dificultad`);
        for (let i = 1; i < hours.length; i++) assert.ok(hours[i] > hours[i - 1], `${cycle}: cada dificultad, más tarde`);
    }
    for (const scene of Object.values(SCENES)) {
        if (scene.kind === 'story') {
            // Una historia enseña su hora, sea cual sea la dificultad.
            assert.equal(coverHour(scene, 1), scene.menuHour);
            assert.equal(coverHour(scene, 5), scene.menuHour);
        } else {
            assert.ok(Object.hasOwn(COVER_HOURS, scene.cycle), `${scene.id}: su ciclo tiene horas de portada`);
            assert.ok(coverHour(scene, 5) > coverHour(scene, 1));
        }
    }
    assert.equal(coverHour(SCENES.mountains, undefined), COVER_HOURS.journey[2], 'sin dificultad, la de en medio');
    assert.equal(coverHour(SCENES.mountains, 99), COVER_HOURS.journey[4]);

    // El escenario es el que se juega: el elegido, el propuesto o el de siempre.
    assert.equal(coverSpec({ id: 1, difficulty: 3, scene: 'coast', scene_auto: 'snow' }).scene, 'coast');
    assert.equal(coverSpec({ id: 1, difficulty: 3, scene: null, scene_auto: 'snow' }).scene, 'snow');
    assert.equal(coverSpec({ id: 1, difficulty: 3, scene: 'volcano' }).scene, DEFAULT_SCENE);

    // El encuadre: estable por nivel, distinto entre niveles y dentro de lo que hay.
    const a = { id: 7, audio_sha256: 'ab12'.padEnd(64, '0'), difficulty: 2 };
    assert.equal(coverPan(a), coverPan({ ...a }));
    assert.equal(coverKey(coverSpec(a)), coverKey(coverSpec({ ...a })));
    const pans = new Set();
    for (let id = 1; id <= 40; id++) {
        const pan = coverPan({ id });
        assert.ok(pan >= 0 && pan < COVER_PANS.count * COVER_PANS.stepCells && pan % COVER_PANS.stepCells === 0);
        pans.add(pan);
    }
    assert.ok(pans.size >= 8, `${pans.size} encuadres distintos en 40 niveles`);

    // El selector de escenario enseña cada ambiente a su hora de siempre.
    assert.deepEqual(sceneCoverSpec(SCENES.city), { scene: 'city', hour: SCENES.city.menuHour, pan: 0 });
    const choice = sceneChoiceView({ id: 1, is_mine: true, scene: null, scene_auto: 'storm' });
    assert.equal(choice.options[0].cover.scene, 'storm');
});

test('tarjeta: lleva su portada, su línea de datos y cuánto de la canción se alcanzó', () => {
    const level = { id: 3, title: 'T', artist: 'Aurora', bpm: 82, duration_sec: 164, difficulty: 3, is_public: true, has_audio: true, is_official: true, scene: null, my_best: { points: 16367, percentage: 100 } };
    const view = cardView(level);
    assert.deepEqual(view.cover, coverSpec(level));
    assert.equal(view.meta, 'Aurora · 82 BPM · 2:44');
    assert.equal(view.best.ratio, 1);
    assert.equal(view.best.completed, true);
    assert.equal(cardView({ ...level, artist: null, my_best: { points: 10, percentage: 37 } }).meta, '82 BPM · 2:44');
    assert.equal(cardView({ ...level, my_best: { points: 10, percentage: 37 } }).best.ratio, 0.37);
    assert.equal(cardView({ ...level, my_best: null }).best, null);
});
