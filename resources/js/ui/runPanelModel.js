// Modelo del panel de partida: pausa y resultados (reintentos, Sep 2026).
//
// Antes, al chocar, un "GAME OVER" de medio segundo y vuelta al menú: para
// reintentar había que pulsar JUGAR y buscar la canción otra vez. Ahora la
// partida termina en un panel sobre la escena congelada (donde caíste, como en
// Geometry Dash) con REINTENTAR como acción principal —una tecla o un toque, sin
// cargar nada—, lo lejos que llegaste en el mapa de la canción, tu marca y el
// número de intento. La pausa usa el mismo panel con Reanudar delante.
//
// Aquí se decide QUÉ enseña (textos, acciones, teclas, la marca); la vista
// (`runPanel.js`) solo lo pinta. Puro: se prueba en Node.

import { formatDuration, formatPoints } from './catalogModel.js';

export const RUN_ACTION = Object.freeze({
    RESUME: 'resume',
    RETRY: 'retry',
    LEVELS: 'levels',
    MENU: 'menu',
});

/**
 * @typedef {Object} RunInfo
 * @property {'pause' | 'results'} mode
 * @property {'win' | 'collision'} [kind]      Solo en resultados.
 * @property {number} percentage               0-100: lo jugado (pausa) o lo alcanzado.
 * @property {number} points
 * @property {number} reachedSec
 * @property {number} durationSec
 * @property {number} attempt
 * @property {{ points: number, percentage: number } | null} [previousBest]  Marca ANTES de esta partida.
 * @property {string} title
 * @property {Array<{ t: number, level?: number, climax?: boolean }>} [sections]
 * @property {boolean} [rotate]                Móvil en vertical: sugerir girarlo.
 */

/**
 * @param {RunInfo} run
 */
export function runPanelView(run) {
    const pct = clampPct(run.percentage);
    const prev = run.previousBest ?? null;
    const prevPct = prev === null ? 0 : clampPct(prev.percentage);
    const results = run.mode === 'results';
    const win = results && run.kind === 'win';
    // Récord = superar una marca que ya había (la primera partida no "bate" nada).
    const newBest = results && prevPct > 0 && pct > prevPct;

    // El porcentaje es el protagonista; el rótulo solo lo introduce.
    let tone = 'pause';
    let heading = 'Pausa';
    if (win) {
        tone = 'win';
        heading = '¡Nivel superado!';
    } else if (results) {
        tone = newBest ? 'record' : 'fail';
        heading = newBest ? '¡Nuevo récord!' : 'Llegaste al';
    }

    /** @type {string | null} */
    let note = null;
    if (run.rotate) {
        note = 'Gira el móvil: Daino se juega en horizontal.';
    } else if (win) {
        note = prevPct < 100 ? 'Primera vez que lo completas.' : null;
    } else if (results) {
        const inClimax = sectionAt(run.sections ?? [], run.reachedSec)?.climax === true;
        if (newBest) note = `Superas tu marca del ${prevPct} %.`;
        else if (pct >= 90) note = '¡Te faltaba muy poco!';
        else if (inClimax) note = 'Caíste en pleno clímax.';
        else if (prevPct > 0) note = `Tu mejor marca: ${prevPct} %.`;
    }

    const primary = run.mode === 'pause'
        ? { action: RUN_ACTION.RESUME, label: 'Reanudar', key: 'Esc' }
        : { action: RUN_ACTION.RETRY, label: win ? 'Otra vez' : 'Reintentar', key: 'Espacio' };
    const secondary = run.mode === 'pause'
        ? [
            { action: RUN_ACTION.RETRY, label: 'Reintentar', key: 'R' },
            { action: RUN_ACTION.LEVELS, label: 'Niveles', key: null },
            { action: RUN_ACTION.MENU, label: 'Menú', key: null },
        ]
        : [
            { action: RUN_ACTION.LEVELS, label: 'Niveles', key: 'Esc' },
            { action: RUN_ACTION.MENU, label: 'Menú', key: null },
        ];

    return {
        mode: run.mode,
        tone,
        heading,
        title: run.title ?? '',
        percentage: pct,
        percentLabel: `${pct} %`,
        newBest,
        note,
        bar: {
            fill: pct / 100,
            best: prevPct > 0 && prevPct < 100 ? prevPct / 100 : null,
            segments: roadSegments(run.sections ?? [], run.durationSec),
        },
        stats: [
            { label: 'Puntos', value: formatPoints(run.points) },
            { label: 'Tiempo', value: `${formatDuration(run.reachedSec)} / ${formatDuration(run.durationSec)}` },
            { label: 'Intento', value: String(Math.max(1, Math.floor(run.attempt || 1))) },
        ],
        primary,
        secondary,
        /** Solo tras chocar: el interruptor de reintento automático (estilo Geometry Dash). */
        offerAutoRetry: results && !win,
    };
}

/**
 * Qué acción dispara una tecla en el panel. `null` = la tecla hace lo suyo
 * (Tab, Enter sobre un botón con el foco…).
 *
 * @param {'pause' | 'results'} mode
 * @param {{ key: string, code?: string, repeat?: boolean }} ev
 * @param {{ focusedSecondary?: boolean }} [ctx]  El foco está en un botón que no
 *        es el principal: Espacio y Enter lo pulsan a él, no reintentan.
 */
export function keyAction(mode, ev, ctx = {}) {
    if (ev.repeat) return null;
    const code = ev.code ?? '';
    if (code === 'KeyR') return RUN_ACTION.RETRY;
    if (ev.key === 'Escape') return mode === 'pause' ? RUN_ACTION.RESUME : RUN_ACTION.LEVELS;
    if (mode === 'results' && !ctx.focusedSecondary && (code === 'Space' || code === 'ArrowUp' || ev.key === 'Enter')) {
        return RUN_ACTION.RETRY;
    }
    return null;
}

/**
 * Número de intento de un nivel en esta visita (como el "Attempt N" de Geometry
 * Dash). En memoria: se cuenta lo que se reintenta ahora, no un histórico.
 */
export function createAttemptCounter() {
    const counts = new Map();
    return {
        /** @param {string} key  Id del nivel o hash del audio. */
        next(key) {
            const n = (counts.get(key) ?? 0) + 1;
            counts.set(key, n);
            return n;
        },
        peek(key) {
            return counts.get(key) ?? 0;
        },
    };
}

function clampPct(v) {
    return Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
}

function sectionAt(sections, t) {
    let found = null;
    for (const s of sections) {
        if (s.t <= t) found = s;
        else break;
    }
    return found;
}

/** Tramos de la canción como fracciones [0,1] para el mapa de la barra. */
function roadSegments(sections, durationSec) {
    if (!(durationSec > 0)) return [];
    const out = [];
    for (let i = 0; i < sections.length; i++) {
        const from = Math.max(0, sections[i].t / durationSec);
        const to = Math.min(1, (sections[i + 1]?.t ?? durationSec) / durationSec);
        if (to <= from) continue;
        out.push({ from, to, level: sections[i].level ?? 0, climax: sections[i].climax === true });
    }
    return out;
}
