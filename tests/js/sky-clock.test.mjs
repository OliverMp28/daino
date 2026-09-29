// Reloj del cielo (fase E1, doc 11 §2.1): el cielo cuenta la canción. Sin Pixi ni
// DOM: mismo chart, mismas horas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKY_HOURS, SKY_RULES, planSky } from '../../resources/js/game/scenes/skyClock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BAKED = path.join(ROOT, 'database/seeds/official/baked');

function official(slug) {
    const j = JSON.parse(readFileSync(path.join(BAKED, `${slug}.json`), 'utf8'));
    return { sections: j.chart.events.filter((e) => e.type === 'section'), durationSec: j.audio.durationSec };
}

const near = (actual, expected, tol = 0.05) => assert.ok(
    actual !== null && Math.abs(actual - expected) <= tol,
    `esperaba ${expected} ± ${tol}, salió ${actual}`,
);

test('los oficiales largos: atardecer antes del clímax, noche en su drop, amanecer en el outro', () => {
    // [slug, atardecer, noche (= inicio del clímax), alba | null]
    const cases = [
        ['whats-up-danger', 119.27, 157.171, 202.652],
        ['dawn-of-faith', 88.832, 120.689, 177.946],
        ['mi-fiesta', 114.987, 156.436, 184.098],
        // Time: su outro deja 30 s (más que dawnMaxS): alba en los últimos 20 s.
        ['time', 75.189, 105.664, 166.114 - SKY_RULES.dawnFallbackS],
        // Running With the Wolves: el clímax dura hasta el final; acaba de noche.
        ['running-with-the-wolves', 120.314, 146.649, null],
    ];
    for (const [slug, evening, night, dawn] of cases) {
        const input = official(slug);
        const plan = planSky(input);
        near(plan.events.eveningStart, evening);
        near(plan.events.nightfall, night);
        if (dawn === null) {
            assert.equal(plan.events.dawnStart, null, slug);
            assert.equal(plan.events.sunrise, null, slug);
            // La luna sigue su curso: de noche cerrada, sin llegar a la primera luz.
            const end = plan.hourAt(input.durationSec);
            assert.ok(end > SKY_HOURS.nightfall && end < SKY_HOURS.firstLight, `${slug}: ${end}`);
        } else {
            near(plan.events.dawnStart, dawn);
            // El sol asoma sobre las crestas justo al terminar la canción.
            near(plan.hourAt(input.durationSec), SKY_HOURS.sunrise, 1e-9);
        }
        // Petición del user: nada "dentro del minuto 1".
        assert.ok(plan.events.eveningStart >= 60, slug);
    }
});

test('los oficiales cortos: el sol se pone en su última sección y termina de ponerse al final', () => {
    // [slug, atardecer]: HOPE en su outro; los clips de 40 s en su última sección.
    for (const [slug, evening] of [['hope', 62.703], ['sugar-red', 16.36], ['last-christmas', 10.247]]) {
        const input = official(slug);
        const plan = planSky(input);
        near(plan.events.eveningStart, evening);
        assert.equal(plan.events.nightfall, null, slug);
        near(plan.hourAt(input.durationSec), SKY_HOURS.sunDown, 1e-9);
        near(plan.events.sunDown, input.durationSec, 1e-6);
    }
});

test('el sol baja siempre al mismo ritmo: un día más corto empieza más tarde', () => {
    const wud = planSky(official('whats-up-danger'));
    const time = planSky(official('time'));
    assert.ok(Math.abs(wud.anchors[0].hour - 14.5) < 0.05, `What's Up Danger empieza a las ${wud.anchors[0].hour}`);
    assert.ok(time.anchors[0].hour > wud.anchors[0].hour, 'Time tiene menos día: empieza más tarde');
    for (const plan of [wud, time]) {
        const rate = (SKY_HOURS.golden - plan.anchors[0].hour) / plan.events.eveningStart;
        near(rate, (SKY_HOURS.golden - 14.5) / SKY_RULES.dayNominalS, 1e-9);
    }
});

/** Estructura sintética de canción: secciones cada 8-30 s, clímax en la segunda mitad (o ninguno). */
function syntheticSong(seed) {
    let s = seed >>> 0 || 1;
    const rnd = () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >> 17;
        s ^= s << 5; s >>>= 0;
        return s / 4294967296;
    };
    const durationSec = 20 + rnd() * 380;
    const sections = [];
    for (let t = 0; t < durationSec; t += 8 + rnd() * 22) sections.push({ t, level: Math.floor(rnd() * 5), climax: false });
    if (rnd() < 0.85 && sections.length > 1) {
        const i = Math.floor(sections.length / 2 + rnd() * (sections.length / 2));
        if (sections[i]) sections[i].climax = true;
    }
    return { sections, durationSec };
}

test('invariantes en 500 estructuras: hora monótona y continua, anclas en orden, sin NaN', () => {
    for (let seed = 1; seed <= 500; seed++) {
        const input = syntheticSong(seed * 7919);
        const plan = planSky(input);
        const D = input.durationSec;
        let prev = -Infinity;
        for (let t = -1; t <= D + 1; t += 0.25) {
            const h = plan.hourAt(t);
            assert.ok(Number.isFinite(h), `seed ${seed}: hora no finita en ${t}`);
            assert.ok(h >= prev - 1e-9, `seed ${seed}: la hora retrocede en ${t}`);
            // Continua: en 0.25 s el cielo nunca salta más de 0.2 h (el tramo más rápido, una noche corta).
            if (prev !== -Infinity) assert.ok(h - prev <= 0.2, `seed ${seed}: salto de ${h - prev} h en ${t}`);
            prev = h;
        }
        const h0 = plan.anchors[0].hour;
        assert.ok(h0 >= SKY_HOURS.dayStartMin && h0 <= SKY_HOURS.golden, `seed ${seed}: empieza a las ${h0}`);
        const ev = plan.events;
        if (ev.nightfall !== null) {
            // Canción larga: atardecer nunca antes de 1:00 ni del 35 %, noche que cabe.
            assert.ok(ev.eveningStart >= Math.max(SKY_RULES.minDayS, SKY_RULES.minDayFraction * D) - 1e-9, `seed ${seed}`);
            assert.ok(ev.nightfall - ev.eveningStart >= SKY_RULES.eveningMinS - 1e-9, `seed ${seed}: atardecer corto`);
            assert.ok(ev.nightfall + SKY_RULES.nightMinS <= D + 1e-9, `seed ${seed}: la noche no cabe`);
            if (ev.dawnStart !== null) {
                assert.ok(ev.dawnStart - ev.nightfall >= SKY_RULES.nightMinS - 1e-9, `seed ${seed}: noche corta`);
                const dawnS = D - ev.dawnStart;
                assert.ok(dawnS >= SKY_RULES.dawnMinS - 1e-9 && dawnS <= SKY_RULES.dawnMaxS + 1e-9, `seed ${seed}: amanecer de ${dawnS} s`);
                near(plan.hourAt(D), SKY_HOURS.sunrise, 1e-9);
            }
        } else {
            near(plan.hourAt(D), SKY_HOURS.sunDown, 1e-9);
        }
    }
});

test('la noche cae en el drop del clímax cuando cabe el viaje', () => {
    const sections = [
        { t: 0, level: 1 }, { t: 30, level: 2 }, { t: 70, level: 2 }, { t: 100, level: 1 },
        { t: 130, level: 4, climax: true }, { t: 160, level: 3 }, { t: 185, level: 0 },
    ];
    const plan = planSky({ sections, durationSec: 200 });
    assert.equal(plan.events.nightfall, 130);
    // El límite más cercano a 130 − 36 = 94 entre 70 y 110: el de 100.
    assert.equal(plan.events.eveningStart, 100);
    // El amanecer: el último límite tras el clímax que deja 8-26 s → 185 (15 s).
    assert.equal(plan.events.dawnStart, 185);
    assert.equal(plan.phaseAt(10), 'day');
    assert.equal(plan.phaseAt(150), 'night');
    assert.equal(plan.phaseAt(199), 'sunrise');
});

test('sin estructura: atardecer desde el 45 % y noche 36 s después', () => {
    const plan = planSky({ sections: [], durationSec: 240 });
    near(plan.events.eveningStart, 0.45 * 240, 1e-9);
    near(plan.events.nightfall, 0.45 * 240 + SKY_RULES.eveningTargetS, 1e-9);
    near(plan.events.dawnStart, 240 - SKY_RULES.dawnFallbackS, 1e-9);
});

test('epílogo tras superar el nivel: termina de ponerse el sol, o sale', () => {
    const short = planSky(official('hope'));
    const e1 = short.epilogue(short.hourAt(short.durationSec));
    assert.ok(e1.to > SKY_HOURS.sunDown && e1.durationS >= SKY_RULES.epilogueMinS);
    const night = planSky(official('running-with-the-wolves'));
    const e2 = night.epilogue(night.hourAt(night.durationSec));
    assert.ok(e2.to > SKY_HOURS.sunrise, 'de noche, el epílogo trae el amanecer');
    assert.ok(e2.durationS <= SKY_RULES.epilogueMaxS);
    const dawn = planSky(official('whats-up-danger'));
    const e3 = dawn.epilogue(dawn.hourAt(dawn.durationSec));
    assert.ok(e3.to > SKY_HOURS.sunrise && e3.to - e3.from < 1, 'con el sol saliendo, sube un poco más');
});

test('ciclo fijo: el cielo no se mueve', () => {
    const plan = planSky({ sections: [], durationSec: 120 }, { kind: 'fixed', hour: 23 });
    assert.equal(plan.hourAt(0), 23);
    assert.equal(plan.hourAt(90), 23);
    assert.equal(plan.epilogue(23).durationS, 0);
});
