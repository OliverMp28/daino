// One Day (Piratas del Caribe: En el fin del mundo, Hans Zimmer) — la primera
// historia de autor (T02.6, doc 11).
//
// La historia de Will y Elizabeth, contada con el cielo de la Costa, sin
// personajes ni logos: un barco, un cabo, una figura y el destello verde.
//
//   EL DÍA          Una tarde dorada. El barco, fondeado frente al cabo de una
//                   isla con su faro, su casa y sus palmeras; en el borde, ella.
//   LA PARTIDA      Con la primera subida de la música, el barco leva anclas y
//                   navega hacia el sol, que baja.
//   LA DESPEDIDA    El sol toca el mar y el barco se hunde en el horizonte con él.
//                   En su último instante, el DESTELLO VERDE (en la película, el
//                   alma que deja este mundo). Cae con el drop de la canción.
//   DIEZ AÑOS       Una noche que son diez años: la luna cruza el cielo, las
//                   estrellas giran y en el cabo arde un farol.
//   EL REGRESO      Al alba, el primer filo del sol vuelve a ser verde (el alma
//                   que vuelve) y el barco EMERGE del mar junto a él. En el cabo ya
//                   son dos: ella y el hijo que él todavía no conoce.
//   RUMBO A CASA    El barco navega hacia el cabo con la luz de la mañana y la
//                   música se resuelve de re menor a re mayor.
//
// Los momentos se anclan a la estructura de la canción (secciones y efectos del
// chart), así que la historia sigue en su sitio si el charter cambia. Cada uno
// dice también dónde caería con OTRA canción (lo prueba un test): una historia
// no rompe nunca un nivel, aunque solo se ofrezca para el suyo.

/** @type {(o: ReturnType<typeof import('./index.js').songOutline>) => number} */
function farewellAt(o) {
    // El drop de la primera mitad; si no, el arranque del clímax en esa franja;
    // si no, el límite de sección más cercano al 43 %.
    const inFirstHalf = (t) => t >= 0.25 * o.D && t <= 0.6 * o.D;
    const drop = o.drops.find(inFirstHalf);
    if (drop !== undefined) return drop;
    if (o.climax !== null && inFirstHalf(o.climax.start)) return o.climax.start;
    return o.nearest(o.bounds, 0.43 * o.D, 0.3 * o.D, 0.55 * o.D) ?? 0.43 * o.D;
}

export const ONE_DAY_STORY = Object.freeze({
    id: 'one-day',
    label: 'One Day',
    minGapS: 2,
    moments: Object.freeze([
        { id: 'day', label: 'El día', hour: 16.9, at: () => 0 },
        {
            // La primera subida de la música (35.4 s en One Day).
            id: 'departure', label: 'La partida', hour: 17.45,
            at: (o, m) => o.last(o.bounds, m('farewell') - 36, m('farewell') - 18) ?? m('farewell') - 28,
        },
        {
            // El disco toca el mar: la subida hacia el drop (55 s) o 8 s antes.
            id: 'touch', label: 'El sol toca el mar', hour: 18.3,
            at: (o, m) => o.last(o.builds, m('farewell') - 14, m('farewell') - 5) ?? m('farewell') - 8,
        },
        { id: 'farewell', label: 'La despedida', hour: { limb: 'set' }, at: farewellAt },
        {
            // Primera luz, y el rótulo "Diez años después…".
            id: 'dawn', label: 'Diez años después', hour: 29,
            at: (o, m) => m('return') - 11,
        },
        {
            // El primer límite de sección tras la despedida con canción por delante
            // (99.2 s: la última gran subida de la orquesta).
            id: 'return', label: 'El regreso', hour: { limb: 'rise' },
            at: (o, m) => o.first(o.bounds, m('farewell') + 25, o.D - 30) ?? m('farewell') + 0.43 * (o.D - m('farewell')),
        },
        {
            // La coda: el último tramo en calma (132.3 s, termina en re mayor).
            id: 'home', label: 'Rumbo a casa', hour: 31,
            at: (o, m) => o.last(o.bounds, m('return') + 15, o.D - 8) ?? (m('return') + o.D) / 2,
        },
        { id: 'end', label: 'Fin', hour: 31.6, at: (o) => o.D },
    ]),
    // El destello dura unos segundos de canción: la hora casi se para a su alrededor.
    holds: Object.freeze([
        { at: 'farewell', beforeS: 2.5, afterS: 3, dhBefore: 0.03, dhAfter: 0.06 },
        { at: 'return', beforeS: 2, afterS: 3.5, dhBefore: 0.03, dhAfter: 0.05 },
    ]),
    captions: Object.freeze([
        { at: 'day', afterS: 5, holdS: 5.5, text: 'Un día en tierra cada diez años.' },
        { at: 'dawn', afterS: 0, holdS: 5, text: 'Diez años después…' },
    ]),
    tracks: Object.freeze({
        /**
         * El barco, siempre en el horizonte (lejos: no crece, se hunde y emerge).
         *   x      centro, en fracción del ancho de la vista.
         *   sink   cuánto de su alto queda bajo el horizonte (0 a flote, 1 hundido).
         *   dir    1 proa a la derecha (se va hacia el sol), −1 a la izquierda (vuelve).
         *   spray  agua que cae de sus velas al emerger [0,1].
         *   lamp   el farol de popa: vuelve con él encendido, y se apaga con el día.
         */
        ship: {
            x: [['day', 0.6], ['departure', 0.6], ['touch', 0.79], ['farewell', 0.818],
                [{ moment: 'farewell', dh: 0.01 }, 0.66], ['return', 0.66], ['home', 0.59], ['end', 0.545], [32.1, 0.52]],
            sink: [['touch', 0], ['farewell', 1], ['return', 1], [{ moment: 'return', dh: 0.12 }, 0]],
            dir: [['day', 1], [{ moment: 'farewell', dh: 0.01 }, 1], [{ moment: 'farewell', dh: 0.01 }, -1]],
            spray: [['return', 0], [{ moment: 'return', dh: 0.02 }, 1], [{ moment: 'return', dh: 0.12 }, 0.7], [{ moment: 'return', dh: 0.3 }, 0]],
            lamp: [[{ moment: 'return', dh: 0.04 }, 0], [{ moment: 'return', dh: 0.12 }, 1], [{ moment: 'return', dh: 0.5 }, 1], [{ moment: 'return', dh: 0.85 }, 0]],
        },
        /**
         * La isla, con ella en el borde del cabo mirando al mar.
         *   x        el borde del cabo (la pared del mar), en fracción del ancho.
         *            Se aleja muy despacio: la tierra sigue hasta fuera de pantalla.
         *   child    el hijo, a su lado desde "Diez años después".
         *   lantern  el farol encendido de la espera (de noche).
         *   flare    el farol se aviva cuando ve el barco.
         *   lights   las ventanas de la casa, el humo y el faro: del ocaso a la mañana.
         */
        cliff: {
            x: [['day', 0.47], ['farewell', 0.455], ['dawn', 0.445], ['end', 0.425], [32.1, 0.42]],
            lights: [[{ limb: 'set', dh: -0.35 }, 0], [{ limb: 'set', dh: 0.1 }, 1], [{ limb: 'rise', dh: 0.25 }, 1], [{ limb: 'rise', dh: 0.7 }, 0]],
            child: [['dawn', 0], ['dawn', 1]],
            lantern: [[{ limb: 'set', dh: 0.3 }, 0], [{ limb: 'set', dh: 0.9 }, 1], [{ limb: 'rise', dh: 0.25 }, 1], [{ limb: 'rise', dh: 0.6 }, 0]],
            flare: [['return', 0], [{ moment: 'return', dh: 0.06 }, 1], [{ moment: 'return', dh: 0.3 }, 0]],
        },
    }),
    /** Tras superar el nivel, el barco llega junto al cabo con la mañana ya alta. */
    epilogueHour: 32.1,
});
