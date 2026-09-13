// Techo de dificultad de una canción (Ola 4, doc 10 §2.3).
//
// "Una balada tranquila no ofrece Extremo." El techo dice hasta qué dificultad
// la MÚSICA sostiene un nivel: un nivel extremo necesita golpes densos y claros
// que seguir; en una canción suave, obstáculos a ese ritmo no tendrían nada en
// la música que los justifique y se sentirían aleatorios.
//
// Se calcula del análisis del servidor (formato 2) y se guarda con el nivel. Es
// una decisión de JUEGO (qué significa "Extremo"), por eso vive en JS junto al
// charter y no en el analizador. La Ola 5 generará cada dificultad de verdad y
// el formulario de subida solo ofrecerá hasta el techo; hoy se calcula y se
// guarda, pero no se ofrece elegir dificultad: el charter todavía no genera
// niveles distintos por dificultad y ofrecerlo sería una etiqueta con calzador.
//
// Densidad musical efectiva = golpes fuertes por minuto + ¼ de los eventos por
// minuto que caen sobre beats con golpe. Los golpes fuertes dicen cuánto
// "empuja" la canción; los eventos apoyados en el pulso, cuánto material rítmico
// hay aunque sea suave. Calibrado con los 10 temas reales disponibles (Sep 2026):
//
//   HOPE 15 · Time 15              → 2 (suaves: pulso claro, casi sin golpes)
//   Dawn of Faith 85 · Instrumental 78 → 4
//   Last Christmas 148 · Wolves 142 · What's Up Danger 164 · Mi Fiesta 186 · Sugar Red 191 → 5
//
// Son pocos temas: los umbrales se revisarán con el catálogo de la comunidad.

export const CEILING_THRESHOLDS = Object.freeze([12, 35, 70, 120]);

/**
 * @param {object} analysis  Análisis de formato 2.
 * @returns {{ ceiling: number, density: number } | null}  null si el análisis
 *          no trae los rasgos necesarios (formato 1, analizador JS local).
 */
export function difficultyCeiling(analysis) {
    const f = analysis?.features;
    if (analysis?.formatVersion !== 2 || f === null || typeof f !== 'object') return null;
    const strong = Number(f.strongEventsPerMin);
    const events = Number(f.eventsPerMin);
    const support = Number(f.beatSupport);
    if (![strong, events, support].every(Number.isFinite)) return null;

    const density = strong + 0.25 * events * Math.min(1, Math.max(0, support));
    let ceiling = 1;
    for (const threshold of CEILING_THRESHOLDS) {
        if (density >= threshold) ceiling++;
    }
    return { ceiling, density: Math.round(density * 10) / 10 };
}
