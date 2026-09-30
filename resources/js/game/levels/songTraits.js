// Rasgos de la canción ENTERA, comparables entre canciones (T02.5, doc 11).
//
// songCharacter.js mide cada tramo frente a lo típico de SU canción: dónde está
// el momento que suena distinto. Esto mide la canción frente a todas las demás:
// cuánta energía transmite, si suena luminosa o sombría, si tiene grandes
// contrastes, si es un bucle de máquina… Lo usa el reparto de escenarios
// (scenes/sceneCasting.js) para proponer el ambiente que pega con cómo suena.
//
// Los dos primeros ejes son los del modelo circumplejo de las emociones en la
// música (activación y valencia), el más usado para describir el ánimo de una
// canción a partir del audio. Los demás separan lo que esos dos no distinguen:
// una pieza épica de un tema de club, las campanas de una canción de invierno de
// la percusión de una latina.
//
//   arousal     [0,1] activación: golpes percusivos, pulso marcado, cuántos
//               golpes fuertes, tempo y sonoridad.
//   valence     [0,1] luminosa (1) o sombría (0): el modo de la tonalidad y
//               cuánto tiempo suenan acordes menores.
//   drama       [0,1] contrastes: rango dinámico y cuánto se separan sus pasajes
//               suaves de los fuertes (sostenidos, no un golpe suelto).
//   groove      [0,1] bucle de máquina: armonía que no se mueve (un loop) o
//               graves que dominan la mezcla (808, bajo sintetizado).
//   sparkle     [0,1] brillo: nivel de los agudos en la mezcla.
//   brightHits  [0,1] brillo que llega con los golpes (percusión, charles).
//   shimmer     [0,1] brillo que suena entre golpes (campanas, pads, cuerdas).
//   stillness   [0,1] quietud: tempo lento y pocos sucesos por minuto.
//
// Solo con análisis del servidor de analizador 2 o posterior (percusividad,
// bandas y armonía): con el del navegador devuelve null y el escenario queda en
// la Cordillera. Los umbrales se calibraron con los 8 oficiales y 2 niveles de
// la comunidad (doc 11, T02.5); `bun run scenes:report` los enseña.
//
// Puro: mismo modelo musical ⇒ mismos rasgos.

/** Rampa [0,1] de `from` a `to`; si `from > to`, baja (1 en `from`, 0 en `to`). */
export function ramp(v, from, to) {
    const x = (v - from) / (to - from);
    return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/**
 * Escalas de cada rasgo: [valor con el que empieza a contar, valor con el que
 * cuenta del todo]. Cambiarlas cambia el escenario automático de los niveles:
 * sube `SCENE_CASTING_VERSION` (scenes/sceneCasting.js) y vuelve a repartir
 * (`cast-scenes`, ver analyzer/README.md).
 */
export const TRAIT_RULES = Object.freeze({
    /** Por debajo, no hay canción bastante para juzgarla (un clip de pocos segundos). */
    minDurationS: 20,
    /** Por debajo de esta fuerza un golpe no cuenta (la misma que la rejilla del charter). */
    hitFloor: 0.12,
    arousal: Object.freeze({
        /** Percusividad media de los golpes, ponderada por fuerza. */
        attack: Object.freeze({ from: 0.35, to: 0.85, weight: 1 }),
        /** Fracción de beats con un golpe real debajo. */
        pulse: Object.freeze({ from: 0.3, to: 0.85, weight: 1 }),
        /** Golpes fuertes por minuto. */
        activity: Object.freeze({ from: 20, to: 120, weight: 1 }),
        tempo: Object.freeze({ from: 70, to: 135, weight: 0.5 }),
        /** Sonoridad media en dBFS: depende del máster (una grabación antigua es más baja), pesa poco. */
        loudness: Object.freeze({ from: -24, to: -12, weight: 0.5 }),
    }),
    drama: Object.freeze({
        /** Rango dinámico (p95 − p10 de los fotogramas audibles, dB). */
        rangeDb: Object.freeze({ from: 12, to: 20 }),
        /**
         * Separación entre los pasajes fuertes y los suaves: energía media en
         * ventanas de `windowS`, sin el principio ni el final (`trim`), percentil
         * 90 menos 25. Un fundido de salida o una intro no bastan (HOPE: 24 dB de
         * rango, casi todos por su final en silencio, y 0.10 de separación).
         */
        spread: Object.freeze({ from: 0.15, to: 0.45 }),
        windowS: 4,
        stepS: 1,
        trim: 0.05,
    }),
    groove: Object.freeze({
        /** Cambios de acorde por compás: un loop no cambia (reguetón 0.10, tema orquestal 0.31). */
        stasis: Object.freeze({ from: 0.45, to: 0.1 }),
        /** Graves sobre medios en la mezcla, dB (trap y EDM: +7; una banda: 0-3). */
        bass: Object.freeze({ from: 1, to: 6.5 }),
    }),
    /** Nivel de los agudos respecto a la mezcla, dB (−28 muy apagado, −16 muy brillante). */
    sparkle: Object.freeze({ from: -25, to: -16 }),
    /** Parte aguda media de los golpes: con más, el brillo es de la percusión. */
    hitsHigh: Object.freeze({ from: 0.3, to: 0.45 }),
    stillness: Object.freeze({
        tempo: Object.freeze({ from: 88, to: 68 }),
        /** Sucesos por minuto (golpes y notas). */
        events: Object.freeze({ from: 160, to: 110 }),
    }),
});

/**
 * @param {ReturnType<import('./musicModel.js').buildMusicModel>} model
 * @param {typeof TRAIT_RULES} [rules]
 * @returns {{ arousal: number, valence: number, drama: number, groove: number, sparkle: number,
 *   brightHits: number, shimmer: number, stillness: number, inputs: Record<string, number> } | null}
 *   null si el análisis no trae lo necesario (navegador, analizador 1) o la canción es muy corta.
 */
export function songTraits(model, rules = TRAIT_RULES) {
    const f = model.features;
    const bands = model.bandLevelDb;
    const tonal = model.tonal;
    const D = model.durationSec;
    if (!(D >= rules.minDurationS) || f === null || bands === null || tonal === null || tonal.key === null) return null;
    if (model.onsets.perc === null || !model.onsets.hasColor) return null;
    const need = ['beatSupport', 'strongEventsPerMin', 'eventsPerMin', 'loudnessDbfs', 'dynamicRangeDb'];
    if (!need.every((k) => Number.isFinite(f[k]))) return null;

    const attack = model.percussiveness(0, D) ?? 0;
    const hitsHigh = highShareOfHits(model.onsets, rules.hitFloor);
    const minorShare = minorChordShare(tonal.chords, D);
    const spread = energySpread(model, rules.drama);
    const bassOverMid = bands.low - bands.mid;

    const a = rules.arousal;
    const parts = [
        [ramp(attack, a.attack.from, a.attack.to), a.attack.weight],
        [ramp(f.beatSupport, a.pulse.from, a.pulse.to), a.pulse.weight],
        [ramp(f.strongEventsPerMin, a.activity.from, a.activity.to), a.activity.weight],
        [ramp(model.bpm, a.tempo.from, a.tempo.to), a.tempo.weight],
        [ramp(f.loudnessDbfs, a.loudness.from, a.loudness.to), a.loudness.weight],
    ];
    const arousal = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0);

    // Modo: la tonalidad dice "menor" con una confianza; los acordes, cuánto rato
    // suenan menores. Por separado se equivocan a menudo (relativa y paralela son
    // los errores típicos, CLAUDE.md); juntos, menos.
    const minorKey = / minor$/.test(tonal.key);
    const mode = minorKey ? 0.5 + 0.5 * tonal.keyConfidence : 0.5 - 0.5 * tonal.keyConfidence;
    const minorness = minorShare === null ? mode : 0.5 * mode + 0.5 * minorShare;

    const d = rules.drama;
    const drama = 0.5 * ramp(f.dynamicRangeDb, d.rangeDb.from, d.rangeDb.to) + 0.5 * ramp(spread, d.spread.from, d.spread.to);

    const g = rules.groove;
    const stasis = tonal.harmonicRhythm === null ? 0 : ramp(tonal.harmonicRhythm, g.stasis.from, g.stasis.to);
    const groove = Math.max(stasis, ramp(bassOverMid, g.bass.from, g.bass.to));

    const sparkle = ramp(bands.high, rules.sparkle.from, rules.sparkle.to);
    const fromHits = ramp(hitsHigh, rules.hitsHigh.from, rules.hitsHigh.to);

    const s = rules.stillness;
    const stillness = 0.5 * ramp(model.bpm, s.tempo.from, s.tempo.to) + 0.5 * ramp(f.eventsPerMin, s.events.from, s.events.to);

    return {
        arousal: round3(arousal),
        valence: round3(1 - minorness),
        drama: round3(drama),
        groove: round3(groove),
        sparkle: round3(sparkle),
        brightHits: round3(sparkle * fromHits),
        shimmer: round3(sparkle * (1 - fromHits)),
        stillness: round3(stillness),
        /** Lo medido, para el informe (`bun run scenes:report`). */
        inputs: {
            bpm: round3(model.bpm),
            attack: round3(attack),
            beatSupport: f.beatSupport,
            strongEventsPerMin: round3(f.strongEventsPerMin),
            eventsPerMin: round3(f.eventsPerMin),
            loudnessDbfs: f.loudnessDbfs,
            dynamicRangeDb: f.dynamicRangeDb,
            energySpread: round3(spread),
            keyMinor: minorKey ? 1 : 0,
            keyConfidence: tonal.keyConfidence,
            minorChordShare: minorShare === null ? -1 : round3(minorShare),
            harmonicRhythm: tonal.harmonicRhythm ?? -1,
            bassOverMidDb: round3(bassOverMid),
            highDb: bands.high,
            hitsHigh: round3(hitsHigh),
        },
    };
}

/** Parte aguda media de los golpes (color del ataque), ponderada por fuerza. */
function highShareOfHits(onsets, floor) {
    let ws = 0;
    let wh = 0;
    for (let i = 0; i < onsets.count; i++) {
        if (onsets.s[i] < floor) continue;
        ws += onsets.s[i];
        wh += onsets.s[i] * onsets.high[i];
    }
    return ws > 0 ? wh / ws : 0;
}

/** Fracción del tiempo con acorde en que el acorde es menor; null sin acordes con modo. */
function minorChordShare(chords, durationSec) {
    let minor = 0;
    let major = 0;
    for (let i = 0; i < chords.length; i++) {
        const label = chords[i][1];
        const end = i + 1 < chords.length ? chords[i + 1][0] : durationSec;
        const dur = Math.max(0, end - chords[i][0]);
        if (label.endsWith(':min')) minor += dur;
        else if (label.endsWith(':maj')) major += dur;
    }
    return minor + major > 0 ? minor / (minor + major) : null;
}

/** Percentil 90 − 25 de la energía media en ventanas, sin los extremos de la canción. */
function energySpread(model, rules) {
    const D = model.durationSec;
    const means = [];
    for (let t = 0; t + rules.windowS <= D; t += rules.stepS) means.push(model.energyMean(t, t + rules.windowS));
    if (means.length < 4) return 0;
    const cut = Math.floor(means.length * rules.trim);
    const body = means.slice(cut, means.length - cut).sort((x, y) => x - y);
    const q = (p) => body[Math.min(body.length - 1, Math.floor(p * (body.length - 1)))];
    return Math.max(0, q(0.9) - q(0.25));
}

function round3(v) {
    return Math.round(v * 1000) / 1000;
}
