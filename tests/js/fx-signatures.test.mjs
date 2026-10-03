// Las firmas del cielo: aurora y lluvia de estrellas (T03.3, doc 11).
//
// Una firma es la luz del cielo nocturno que solo tienen las canciones a las que
// les pega. El director decide si se ve (solo la de la canción, solo con noche
// despejada); aquí se prueba lo que ponen: cuánta luz, con qué reloj y sin llegar
// a ser un destello, y que el shader pinta lo que dicen los números de JS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFxDirector } from '../../resources/js/game/fx/director.js';
import { FLASH_RULES } from '../../resources/js/game/fx/flashSafety.js';
import { FX_PALETTES } from '../../resources/js/game/fx/palettes.js';
import { FX, FX_COSTS, FX_IDS } from '../../resources/js/game/fx/registry.js';
import { createFxSignals, readSkySignals } from '../../resources/js/game/fx/signals.js';
import {
    SKY_FX, VIVID_LIGHT, advanceSkyClocks, createSkyAmounts, createSkyClocks, resetSkyClocks, skyAmounts, vividLight,
} from '../../resources/js/game/fx/skyAmounts.js';
import { harmonize } from '../../resources/js/game/fx/tones.js';
import { relativeLuminance } from '../../resources/js/game/scenes/color.js';
import { SCENES } from '../../resources/js/game/scenes/registry.js';
import { createSkyState, skyColorAt, skyStateAt } from '../../resources/js/game/scenes/skyModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frag = readFileSync(path.join(ROOT, 'resources/js/game/shaders/background.frag'), 'utf8');
const code = frag.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

function skyAt(sceneId, hour) {
    const state = createSkyState();
    const s = createFxSignals();
    skyStateAt(hour, SCENES[sceneId], state);
    readSkySignals(state, SCENES[sceneId], s);
    s.playing = true;
    s.song.intensity = 0.76;
    return { s, state };
}

function settle(director, s, seconds = 12) {
    for (let t = 0; t < seconds; t += 1 / 60) director.update(s, 1 / 60);
}

test('las firmas son luces del cielo que reparte la canción: una como mucho, y sin reparto, ninguna', () => {
    const ids = FX_IDS.filter((id) => FX[id].family === 'signature');
    assert.deepEqual(ids, ['aurora', 'meteors']);
    for (const id of ids) {
        assert.equal(FX[id].plane, 'sky', id);
        assert.notEqual(FX[id].base, true, `${id}: una firma no es esencial`);
        assert.notEqual(FX[id].screen, true, `${id}: una firma no cambia la pantalla entera`);
        assert.equal(typeof FX[id].when, 'function', `${id}: necesita la noche`);
    }
    assert.equal(FX.aurora.cost, 'mid', 'la aurora, fuera en calidad baja');
    assert.equal(FX.aurora.guard, 'limiter', 'su borde entra en la franja jugable: pasa por el limitador');

    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains });
    const night = skyAt('mountains', 22).s;
    settle(d, night);
    assert.equal(d.levels.aurora, 0);
    assert.equal(d.levels.meteors, 0);
    assert.match(d.reasonOf('aurora'), /no tiene firma/);
    assert.equal(d.levels.spectrum, 1, 'el espectro es de la escena: el reparto de la canción no lo toca');

    d.configure({ signature: 'aurora' });
    settle(d, night);
    assert.equal(d.levels.aurora, 1);
    assert.equal(d.levels.meteors, 0);
    assert.match(d.reasonOf('meteors'), /no es la firma/);
    assert.equal(d.levels.spectrum, 1);

    d.configure({ signature: 'meteors' });
    settle(d, night);
    assert.equal(d.levels.aurora, 0);
    assert.equal(d.levels.meteors, 1);

    d.configure({ signature: null });
    settle(d, night);
    assert.equal(d.levels.aurora + d.levels.meteors, 0);
});

test('una firma necesita la noche: de día no hay; bajo la lluvia y la tormenta la firma es el clima; en la nieve, la aurora sí', () => {
    for (const signature of ['aurora', 'meteors']) {
        const d = createFxDirector();
        const expect = (sceneId, hour, seen, why) => {
            d.configure({ scene: SCENES[sceneId], signature });
            settle(d, skyAt(sceneId, hour).s);
            assert.equal(d.levels[signature] > 0.5, seen, `${signature} en ${sceneId} a las ${hour}: ${d.levels[signature]} (${why})`);
            if (!seen) {
                assert.equal(d.levels[signature], 0);
                assert.match(d.reasonOf(signature), why);
            }
        };
        // Los ambientes de cielo abierto, con la noche cerrada.
        for (const sceneId of ['mountains', 'coast', 'city']) {
            expect(sceneId, 22, true);
            expect(sceneId, 14.5, false, /no es de noche/);
            expect(sceneId, 18.2, false, /no es de noche/);
        }
        // Lluvia y Tormenta cierran el cielo: lo declara su política.
        for (const sceneId of ['rain', 'storm']) {
            for (const hour of [19.5, 22, 24, 27]) expect(sceneId, hour, false, /la escena no lo permite/);
        }
        // La Nieve esconde las estrellas (y con ellas las fugaces), no el cielo: la
        // aurora se ve sobre las montañas nevadas, entre la nevada.
        for (const hour of [20.5, 22, 24, 27]) {
            if (signature === 'aurora') expect('snow', hour, true);
            else expect('snow', hour, false, /cubierto/);
        }
        expect('snow', 14.5, false, /no es de noche/);
    }
    // La política de las dos escenas veta la familia entera: una firma nueva queda
    // vetada sin tocar nada.
    for (const sceneId of ['rain', 'storm']) assert.deepEqual(SCENES[sceneId].fx, { denyFamilies: ['signature'] });
    assert.equal(SCENES.snow.fx, undefined);
    // La aurora entra con el cuerpo de la canción, no en un tramo de reposo.
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains, signature: 'aurora' });
    const calm = skyAt('mountains', 22).s;
    calm.song.intensity = 0.08;
    settle(d, calm);
    assert.equal(d.levels.aurora, 0);
    assert.match(d.reasonOf('aurora'), /tranquilo/);
});

test('el equipo y el jugador: en calidad baja no hay aurora; con Mínimos, ninguna firma', () => {
    const night = skyAt('mountains', 22).s;
    const d = createFxDirector();
    d.configure({ scene: SCENES.mountains, signature: 'aurora', costRank: FX_COSTS.indexOf('cheap') });
    settle(d, night);
    assert.equal(d.levels.aurora, 0);
    assert.match(d.reasonOf('aurora'), /calidad/);
    d.configure({ costRank: FX_COSTS.indexOf('mid') });
    settle(d, night);
    assert.equal(d.levels.aurora, 1);
    d.configure({ signature: 'meteors', costRank: FX_COSTS.indexOf('cheap') });
    settle(d, night);
    assert.equal(d.levels.meteors, 1, 'la lluvia de estrellas es barata');
    d.configure({ pref: 'min' });
    settle(d, night);
    assert.equal(d.levels.meteors, 0);
    d.configure({ pref: 'soft' });
    settle(d, night);
    assert.ok(d.levels.meteors > 0 && d.levels.meteors < 1, 'con Suaves, más tenue');
});

/**
 * Una canción a `bpm` con compases de `beatsPerBar`, como la da la partida
 * (GameSession): el pulso a 1 en el primer tiempo y a 0.7 en los demás, cayendo;
 * el acento, solo en el primer tiempo. Devuelve las tandas: instante y si es mayor.
 */
function shower({ bpm, beatsPerBar = 4, seconds = 24, fps = 60, climax = 1, level = 1 }) {
    const clocks = createSkyClocks();
    const s = createFxSignals();
    s.playing = true;
    s.song.climax = climax;
    const levels = Object.fromEntries(FX_IDS.map((id) => [id, 0]));
    levels.meteors = level;
    const beat = 60 / bpm;
    const tandas = [];
    let last = clocks.showerIndex;
    for (let t = 0; t < seconds; t += 1 / fps) {
        const n = Math.floor(t / beat);
        const phase = (t - n * beat) / beat;
        const onAccent = n % beatsPerBar === 0;
        s.beat.pulse = Math.exp(-phase * 4.5) * (onAccent ? 1 : 0.7);
        s.beat.accent = onAccent ? s.beat.pulse : 0;
        advanceSkyClocks(clocks, levels, s, 1 / fps);
        if (clocks.showerIndex !== last) {
            last = clocks.showerIndex;
            tandas.push({ t, big: clocks.showerBig, onBeat: Math.abs(t - n * beat) < 1.5 / fps, downbeat: onAccent });
        }
    }
    return { tandas, clocks, beat, bar: beat * beatsPerBar };
}

test('la lluvia de estrellas cae sobre el pulso: en cada primer tiempo y, si el compás es largo, a mitad de compás', () => {
    const M = SKY_FX.meteors;
    for (const fps of [60, 30]) {
        for (const bpm of [64, 82, 100, 120, 128, 150, 174, 190]) {
            const { tandas, bar } = shower({ bpm, fps });
            assert.ok(tandas.length >= 8, `${bpm} BPM: ${tandas.length} tandas`);
            for (const x of tandas) {
                assert.ok(x.onBeat, `${bpm} BPM a ${fps} FPS: una tanda fuera del golpe (${x.t.toFixed(2)} s)`);
                assert.equal(x.big, x.downbeat, 'las de primer tiempo son las mayores');
            }
            // Pasado el primer compás (que es el que mide el compás), una cada 1-2 s.
            const steady = tandas.filter((x) => x.t > bar * 1.5);
            for (let i = 1; i < steady.length; i++) {
                const gap = steady[i].t - steady[i - 1].t;
                assert.ok(gap >= M.minGapS && gap < 2 * M.halfBarMinS + 0.05, `${bpm} BPM: ${gap.toFixed(2)} s entre tandas`);
            }
            // (Un compás justo en el umbral cae a un lado u otro según el fotograma.)
            const long = bar >= M.halfBarMinS;
            if (Math.abs(bar - M.halfBarMinS) > 0.08) {
                assert.equal(steady.some((x) => !x.downbeat), long, `${bpm} BPM (compás de ${bar.toFixed(2)} s): tandas a mitad de compás`);
            }
            assert.ok(steady.filter((x) => x.downbeat).length >= Math.floor((24 - bar * 1.5) / bar) - 1, `${bpm} BPM: una en cada primer tiempo`);
        }
    }
    // Un compás de tres no tiene mitad: solo sus primeros tiempos.
    const waltz = shower({ bpm: 90, beatsPerBar: 3 });
    assert.ok(waltz.tandas.every((x) => x.downbeat));
    // Un compás rapidísimo (dos golpes a 200 BPM: 0.6 s) no encadena tandas: una fugaz dura 0.65 s.
    const fast = shower({ bpm: 200, beatsPerBar: 2 });
    for (let i = 1; i < fast.tandas.length; i++) assert.ok(fast.tandas[i].t - fast.tandas[i - 1].t >= M.minGapS);
});

test('sin clímax o sin la firma no hay tandas; y al terminar la partida los relojes vuelven a cero', () => {
    assert.equal(shower({ bpm: 120, climax: 0 }).tandas.length, 0, 'fuera del clímax');
    assert.equal(shower({ bpm: 120, level: 0 }).tandas.length, 0, 'otra canción');
    const { clocks } = shower({ bpm: 120 });
    assert.ok(clocks.showerIndex > 5);
    resetSkyClocks(clocks);
    assert.deepEqual(clocks, createSkyClocks());

    // Lo que llega al shader: la cantidad sigue al clímax, y la tanda lleva su tamaño.
    const levels = Object.fromEntries(FX_IDS.map((id) => [id, 0]));
    levels.meteors = 1;
    const s = createFxSignals();
    const out = createSkyAmounts();
    s.song.climax = 0.5;
    const c = createSkyClocks();
    c.showerIndex = 7;
    c.showerBig = true;
    c.showerSince = 0.2;
    skyAmounts(levels, s, out, c);
    assert.ok(Math.abs(out.c[3] - 0.5 * SKY_FX.meteors.amount) < 1e-6);
    assert.equal(out.d[2], 7.5);
    assert.ok(Math.abs(out.d[3] - 0.2) < 1e-6);
    c.showerBig = false;
    skyAmounts(levels, s, out, c);
    assert.equal(out.d[2], 7);
});

test('la aurora fluye con la música, la mecen los graves y respira con el pulso hacia abajo', () => {
    const A = SKY_FX.aurora;
    const levels = Object.fromEntries(FX_IDS.map((id) => [id, 0]));
    levels.aurora = 1;
    const run = (mid, intensity, bass) => {
        const clocks = createSkyClocks();
        const s = createFxSignals();
        s.live.mid = mid;
        s.live.bass = bass;
        s.song.intensity = intensity;
        for (let i = 0; i < 600; i++) advanceSkyClocks(clocks, levels, s, 1 / 60);
        return clocks;
    };
    const still = run(0, 0, 0);
    const busy = run(0.8, 0.9, 0.7);
    assert.ok(Math.abs(still.auroraPhase - 10 * A.flow) < 1e-6, 'en silencio fluye sola, despacio');
    assert.ok(busy.auroraPhase > still.auroraPhase * 3, 'con la música, más deprisa');
    assert.equal(still.auroraSway, 0);
    assert.ok(Math.abs(busy.auroraSway - A.sway * 0.7) < 0.01, 'los graves mecen las cortinas');
    // Sin aurora, su reloj no corre (y no gasta nada).
    const off = createSkyClocks();
    advanceSkyClocks(off, Object.fromEntries(FX_IDS.map((id) => [id, 0])), createFxSignals(), 1);
    assert.equal(off.auroraPhase, 0);

    const s = createFxSignals();
    const out = createSkyAmounts();
    s.song.intensity = 0.5;
    s.beat.world = 1;
    skyAmounts(levels, s, out, busy);
    const full = A.base + A.intensity * 0.5;
    assert.ok(Math.abs(out.c[2] - full) < 1e-6, 'en el golpe, entera');
    s.beat.world = 0;
    skyAmounts(levels, s, out, busy);
    assert.ok(Math.abs(out.c[2] - full * (1 - A.pulse)) < 1e-6, 'entre golpes, algo más tenue');
    assert.ok(Math.abs(out.d[0] - busy.auroraPhase) < 1e-3 && Math.abs(out.d[1] - busy.auroraSway) < 1e-6);
    // Otra canción (nivel 0): nada.
    skyAmounts({ ...levels, aurora: 0 }, s, out, busy);
    assert.equal(out.c[2], 0);
});

test('destellos: la aurora, con cualquier paleta, respira muy por debajo de un destello', () => {
    const A = SKY_FX.aurora;
    const light = [0, 0, 0];
    const seen = [0, 0, 0];
    const top = [0, 0, 0];
    let worst = 0;
    for (const sceneId of ['mountains', 'coast', 'city', 'snow']) {
        for (let h = 18.9; h <= 30; h += 0.3) {
            const { s, state } = skyAt(sceneId, h);
            if (FX.aurora.when(s) <= 0) continue;
            skyColorAt(state, 0.12, top);
            for (const [id, p] of Object.entries(FX_PALETTES)) {
                for (const c of [p.warm, p.cool]) {
                    vividLight(harmonize(c, s.sky.band, seen), light);
                    // Lo más que pone: su rayo más vivo, en el tramo más intenso (las
                    // cortinas no se suman: donde se cruzan se ve la de más luz).
                    const amount = A.base + A.intensity;
                    const at = (k) => relativeLuminance(top.map((v, i) => Math.min(1, v + light[i] * amount * k)));
                    const delta = at(1) - at(1 - A.pulse);
                    worst = Math.max(worst, delta);
                    assert.ok(delta < FLASH_RULES.maxBeatDelta, `${id} en ${sceneId} a las ${h.toFixed(1)}: el golpe cambia la luminancia ${delta.toFixed(3)}`);
                }
            }
        }
    }
    assert.ok(worst > 0.005, 'pero respira');
});

test('el shader pinta lo que dicen los números: color vivo, cruce de cortinas, limitador y altura de la lluvia', () => {
    // El color vivo de las firmas: el mismo en GLSL y en JS.
    assert.ok(code.includes(`vec3(${VIVID_LIGHT.level}) + d * (${VIVID_LIGHT.level} / max(m, ${VIVID_LIGHT.floor}))`), 'fxVivid distinto de su espejo (skyAmounts.js)');
    for (const v of vividLight([0.5, 0.5, 0.5], [0, 0, 0])) assert.ok(Math.abs(v - 0.55) < 1e-9, 'un gris no tiene tono que avivar');
    const pale = vividLight(FX_PALETTES.rose.cool, [0, 0, 0]);
    assert.ok(Math.max(...pale) - Math.min(...pale) > 0.6, `un rosa pálido, vivo: ${pale.map((v) => v.toFixed(2))}`);

    // La aurora: sus dos cortinas no se suman (la luz que pone tiene un máximo, el
    // que usa el test de destellos); toda pasa por el limitador.
    assert.match(code, /aurora = max\(aurora, mix\(warm, cool/, 'donde se cruzan dos cortinas se ve la de más luz');
    assert.ok(!/aurora \+=/.test(code));
    assert.match(code, /col = fxLimit\(col, col \+ aurora \* uFxC\.z, fxW\)/, 'la aurora pasa por el limitador');
    // El borde, del color cálido; el cuerpo, del frío (lo que entra en la franja
    // jugable tiene que brillar bajo el techo: del añil al magenta).
    assert.match(code, /mix\(warm, cool, smoothstep\(0\.0, 0\.17, up\)\)/);
    assert.ok(code.indexOf('aurora * uFxC.z') < code.indexOf('uMoonColor.a > 0.001'), 'la luna queda delante de la aurora');

    // La lluvia: el mismo trazo que la fugaz del escenario (que no cambia), y
    // siempre por encima de la franja jugable y del fundido del limitador.
    assert.ok(code.includes('meteor(px, slot, slot, tIn, 0.04 * uHorizon, 0.26 * uHorizon, 1.0) * 0.85 * uNight'), 'la fugaz del escenario, como siempre');
    const m = /meteor\(px, seed, tanda \+ 0\.5, tIn, 0\.02, fxSkyBottom - ([\d.]+), ([\d.]+)\) \* uFxC\.w/.exec(code);
    assert.ok(m, 'la lluvia de estrellas');
    const room = Number(m[1]);
    const travel = 0.22 * Number(m[2]) * (0.5 / Math.hypot(0.86, 0.5));
    assert.ok(travel < room, `un trazo baja ${travel.toFixed(3)} de la pantalla y nace a ${room} del límite`);
    assert.match(code, /float fxSkyBottom = uFxBand\.x - uFxBand\.y;/);

    // Los relojes llegan en uFxD.
    const filter = readFileSync(path.join(ROOT, 'resources/js/game/shaders/audioFilter.js'), 'utf8');
    assert.match(frag, /uniform vec4\s+uFxD;/);
    assert.ok(filter.includes('uFxD:') && filter.includes('u.uFxD.set(amounts.d)'));
});
