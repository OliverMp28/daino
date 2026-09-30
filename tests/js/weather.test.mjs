// El arco de los ambientes y los relámpagos (T02.3/T02.4, doc 11): curvas por hora
// que, como la hora sigue a la canción, suben hacia el clímax; y un reloj de rayos
// que nunca destella más de lo que permite la WCAG 2.3.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIGHTNING, arcAt, createLightningClock, flashAt, sampleCurve } from '../../resources/js/game/scenes/weather.js';
import { SCENES, sceneCycle } from '../../resources/js/game/scenes/registry.js';
import { planSky } from '../../resources/js/game/scenes/skyClock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BAKED = path.join(ROOT, 'database/seeds/official/baked');

function official(slug) {
    const j = JSON.parse(readFileSync(path.join(BAKED, `${slug}.json`), 'utf8'));
    return { sections: j.chart.events.filter((e) => e.type === 'section'), durationSec: j.audio.durationSec };
}

test('una curva del arco: lineal entre puntos, plana fuera y con las horas de la noche seguidas', () => {
    const curve = [[18, 0], [20, 1], [29, 0.5]];
    assert.equal(sampleCurve(curve, 12), 0);
    assert.equal(sampleCurve(curve, 19), 0.5);
    assert.equal(sampleCurve(curve, 20), 1);
    // Las 5:00 son las 29 de la noche continua: 5 y 29 valen lo mismo.
    assert.equal(sampleCurve(curve, 5), sampleCurve(curve, 29));
    assert.ok(Math.abs(sampleCurve(curve, 3.5) - (1 - 0.5 * (27.5 - 20) / 9)) < 1e-9);
    assert.equal(sampleCurve(curve, 31), 0.5);
    assert.equal(sampleCurve([], 20), 0);
    const out = arcAt(SCENES.mountains, 20, {});
    assert.deepEqual(Object.values(out), [0, 0, 0, 0, 0], 'la Cordillera no tiene clima');
});

test('la tormenta estalla con el clímax y escampa con el alba (oficiales como regresión)', () => {
    const storm = SCENES.storm;
    const out = {};
    for (const slug of ['whats-up-danger', 'dawn-of-faith', 'mi-fiesta', 'time']) {
        const plan = planSky(official(slug), sceneCycle(storm));
        const { nightfall } = plan.events;
        arcAt(storm, plan.hourAt(5), out);
        assert.ok(out.rain < 0.4 && out.lightning === 0, `${slug}: al empezar, llovizna y sin rayos (${out.rain})`);
        arcAt(storm, plan.hourAt(nightfall + 1), out);
        assert.ok(out.rain > 0.95 && out.lightning > 0.95, `${slug}: en el drop del clímax, la tormenta entera`);
        arcAt(storm, plan.hourAt(plan.durationSec), out);
        assert.ok(out.rain < 0.1 && out.lightning === 0, `${slug}: al acabar con el alba, escampa (${out.rain})`);
    }
});

test('la nieve y la lluvia siguen el mismo arco; la ciudad enciende sus ventanas al caer la noche', () => {
    const out = {};
    arcAt(SCENES.snow, 15, out);
    const afternoon = out.snow;
    arcAt(SCENES.snow, 21, out);
    assert.ok(out.snow > afternoon + 0.4, 'la nevada arrecia de noche');
    arcAt(SCENES.rain, 21, out);
    assert.ok(out.rain > 0.6 && out.lightning === 0, 'la Lluvia no tiene relámpagos');
    arcAt(SCENES.city, 18.5, out);
    assert.equal(out.windows, 0, 'de día, apagada');
    arcAt(SCENES.city, 24, out);
    assert.ok(out.windows >= 0.85, 'a medianoche, casi entera');
    arcAt(SCENES.city, 30.6, out);
    assert.ok(out.windows < 0.1, 'al amanecer, se apaga');
});

test('relámpagos: nunca más de 3 destellos en un segundo (WCAG 2.3.1), ni dos rayos seguidos', () => {
    const dt = 1 / 60;
    const clock = createLightningClock(23);
    const strikes = [];
    for (let t = 0; t < 1800; t += dt) {
        if (clock.tick(dt, 1)) strikes.push(t);
    }
    // Un destello empieza en cada subida de flashAt: al caer el rayo y en cada destello siguiente.
    const onsets = strikes.flatMap((t) => LIGHTNING.flashes.map(([a]) => t + a));
    let worst = 0;
    for (let i = 0, j = 0; i < onsets.length; i++) {
        while (onsets[i] - onsets[j] >= 1) j++;
        worst = Math.max(worst, i - j + 1);
    }
    assert.ok(worst <= 3, `${worst} destellos en un segundo`);
    for (let i = 1; i < strikes.length; i++) {
        assert.ok(strikes[i] - strikes[i - 1] >= LIGHTNING.minGapS - dt, `dos rayos a ${strikes[i] - strikes[i - 1]} s`);
    }
    // A tope, un rayo cada pocos segundos: la tormenta se nota sin ser un estroboscopio.
    const mean = 1800 / strikes.length;
    assert.ok(mean > 2 && mean < 4.5, `un rayo cada ${mean.toFixed(2)} s`);
});

test('relámpagos: sin tormenta no cae ninguno; con poca, pocos; y la misma semilla cae igual', () => {
    const count = (intensity, seed = 5) => {
        const clock = createLightningClock(seed);
        let n = 0;
        for (let t = 0; t < 600; t += 1 / 30) if (clock.tick(1 / 30, intensity)) n++;
        return n;
    };
    assert.equal(count(0), 0);
    assert.equal(count(LIGHTNING.minIntensity / 2), 0);
    assert.ok(count(0.3) < count(1) * 0.7, 'menos tormenta, menos rayos');
    assert.equal(count(1, 9), count(1, 9));
});

test('el destello de un rayo: dos golpes de luz y una cola que se apaga', () => {
    assert.equal(flashAt(-0.1), 0);
    assert.equal(flashAt(0.01), 1);
    assert.ok(flashAt(0.1) < 0.3, 'entre los dos destellos, casi a oscuras');
    assert.ok(flashAt(0.15) > 0.5, 'el segundo destello');
    assert.ok(flashAt(0.3) > 0 && flashAt(0.3) < flashAt(0.2), 'la cola se apaga');
    assert.equal(flashAt(1), 0);
    assert.equal(flashAt(Infinity), 0);
});
