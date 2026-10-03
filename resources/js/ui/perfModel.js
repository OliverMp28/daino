// Rendimiento, en palabras (T05.4): lo que mide el engine (`engine.getPerf()`)
// dicho en una línea que cualquiera puede leer en voz alta. La enseñan el panel de
// resultados, la lectura `?perf=1` y el panel dev.
//
// Para qué: un móvil no se puede medir desde el equipo de desarrollo. Quien juega
// abre el juego con `?perf=1`, termina un nivel y dice la línea; con eso se
// ajustan las reglas de la calidad automática (game/systems/frameGovernor.js),
// igual que la "Precisión" sirve para calibrar la dificultad.
//
// Puro: sin DOM. Se prueba en Node.

/** Nombres de los niveles de calidad (los de QUALITY_TIERS, game/RenderProfile.js). */
const TIER_NAMES = Object.freeze({ high: 'Alta', medium: 'Media', low: 'Baja' });

/** Un decimal, con coma. */
const dec = (n) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—');

/**
 * ¿Se enseña el rendimiento? En desarrollo siempre; en producción, con `?perf=1`.
 * @param {string} search  `location.search`.
 * @param {boolean} dev
 */
export function perfWanted(search, dev) {
    if (dev) return true;
    try {
        return new URLSearchParams(search).get('perf') === '1';
    } catch {
        return false;
    }
}

/**
 * La calidad en uso: "Alta", "Media a la mitad", "Baja a 30", "Alta (fija)".
 * @param {{ tier: string, pace: string, locked?: boolean }} p
 */
export function qualityLabel(p) {
    const name = TIER_NAMES[p.tier] ?? p.tier;
    const pace = p.pace === 'steady' ? ' a 30' : p.pace === 'half' ? ' a la mitad' : '';
    return `${name}${pace}${p.locked ? ' (fija)' : ''}`;
}

/**
 * La línea de un intento: fotogramas, tardíos, JS, calidad, cielo y pantalla.
 * Sin fotogramas medidos (el menú, un intento de un segundo) solo dice el equipo.
 *
 * @param {ReturnType<import('../game/engine.js').getPerf>} p
 */
export function perfLine(p) {
    const device = `${qualityLabel(p)} · cielo ${p.skyTexels} · ${Math.round(p.refreshHz)} Hz`;
    if (!(p.frames >= 30)) return device;
    return `${Math.round(p.fps)} FPS · ${dec(p.lateRatio * 100)} % tardíos · JS ${dec(p.cpuMs)} ms · ${device}`;
}

/**
 * La fila "Rendimiento" del panel de resultados, o `null` si no hay nada medido.
 * Corta (va en la letra grande del panel): fotogramas por segundo y tardíos. La
 * línea entera la enseña la lectura de la esquina.
 *
 * @param {ReturnType<import('../game/engine.js').getPerf> | null | undefined} p
 */
export function perfStat(p) {
    if (!p || !(p.frames >= 30)) return null;
    return { label: 'Rendimiento', value: `${Math.round(p.fps)} FPS · ${dec(p.lateRatio * 100)} %` };
}
