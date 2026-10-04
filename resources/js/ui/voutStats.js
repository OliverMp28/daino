// Medidas de los gestos del control facial de Vout, a partir de lo que apunta la
// depuración (iframe/bridge.js). Puro: lo enseña ui/voutDebug.js y se prueba en Node.
//
// Es lo que el equipo de Vout necesita para afinar su detector, y lo que Daino
// necesita para afinar el salto mantenido con un gesto (GESTURE_JUMP):
//
//   1. Retraso de los inicios: cuánto tarda en llegar el aviso desde que la cámara
//      vio empezar el gesto (llegada menos `at`).
//   2. Duración de los gestos: `at` del final menos `at` del inicio. Dice cuánto
//      dura de verdad un gesto rápido de cejas o de boca.
//   3. Retraso de los finales.
//   4. Lo raro: finales sin inicio, inicios que se repiten sin final, y un final
//      seguido al instante de otro inicio del mismo gesto (un gesto mantenido que
//      se cortó solo).
//   5. Con qué mapeo se jugó: teclas y ratón (el del usuario) o acciones (preset).
//
// Un gesto se identifica por lo que pulsa: `key:Space`, `action:JUMP`, `pointer:left`.

/** Un final y un inicio del mismo gesto más juntos que esto: probablemente un corte. */
const CUT_MS = 150;
/** Un retraso fuera de aquí no es un retraso: relojes que no cuadran. */
const MAX_LAG_MS = 5000;
/** Cuántos valores sueltos de cada gesto se enseñan (los últimos). */
const SAMPLES = 40;

/**
 * Qué es un mensaje para las medidas.
 *
 * @param {import('../iframe/bridge.js').TraceEntry} entry
 * @returns {{ id: string, kind: 'key' | 'action' | 'pointer', phase: 'start' | 'end' } | null}
 */
function classify({ dir, type, data }) {
    if (dir !== 'in') return null;
    if (type === 'VOUT_KEY' && (data.state === 'down' || data.state === 'up')) {
        return { id: `key:${String(data.code)}`, kind: 'key', phase: data.state === 'down' ? 'start' : 'end' };
    }
    if (type === 'VOUT_POINTER' && (data.state === 'down' || data.state === 'up')) {
        return { id: `pointer:${String(data.button)}`, kind: 'pointer', phase: data.state === 'down' ? 'start' : 'end' };
    }
    if (type === 'VOUT_ACTION' || type === 'VOUT_ACTION_END') {
        return { id: `action:${String(data.event)}`, kind: 'action', phase: type === 'VOUT_ACTION' ? 'start' : 'end' };
    }
    return null;
}

const round = (v) => Math.round(v);

/** Mínimo, mediana, media y máximo de una lista (null si está vacía). */
export function spread(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return {
        n: sorted.length,
        min: sorted[0],
        median: sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
        mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        max: sorted[sorted.length - 1],
    };
}

function lagLine(label, values) {
    const s = spread(values);
    return s === null ? `${label}: sin datos` : `${label}: media ${round(s.mean)} ms, peor ${round(s.max)} ms (${s.n} mensajes)`;
}

/**
 * @param {{ holdThresholdMs?: number }} [opts]  `holdThresholdMs`: desde cuánto cuenta
 *        Daino un salto de gesto como mantenido (GESTURE_JUMP.afterS).
 */
export function createGestureStats({ holdThresholdMs = 360 } = {}) {
    const startLags = { key: [], action: [], pointer: [] };
    const endLags = { key: [], action: [], pointer: [] };
    /** @type {Map<string, { at: number | null, arrived: number }>}  Gestos empezados y sin terminar. */
    const open = new Map();
    /** @type {Map<string, { durations: number[], heldInGame: number[], cuts: number, orphanEnds: number, repeatedStarts: number, lastEndAt: number | null }>} */
    const gestures = new Map();
    const kinds = { key: 0, action: 0, pointer: 0 };

    const of = (id) => {
        let g = gestures.get(id);
        if (g === undefined) {
            g = { durations: [], heldInGame: [], cuts: 0, orphanEnds: 0, repeatedStarts: 0, lastEndAt: null };
            gestures.set(id, g);
        }
        return g;
    };
    const validLag = (lag) => typeof lag === 'number' && lag >= 0 && lag < MAX_LAG_MS;

    return {
        /** @param {import('../iframe/bridge.js').TraceEntry} entry */
        add(entry) {
            const what = classify(entry);
            if (what === null) return;
            const at = typeof entry.data.at === 'number' && Number.isFinite(entry.data.at) ? entry.data.at : null;
            const g = of(what.id);

            if (what.phase === 'start') {
                kinds[what.kind]++;
                if (validLag(entry.lagMs)) startLags[what.kind].push(entry.lagMs);
                if (open.has(what.id)) {
                    // Otro inicio sin haber terminado: dos gestos que mantienen la misma
                    // acción (normal en el preset runner), o un final que no llegó.
                    g.repeatedStarts++;
                    return;
                }
                if (at !== null && g.lastEndAt !== null && at - g.lastEndAt < CUT_MS) g.cuts++;
                open.set(what.id, { at, arrived: entry.at });
                return;
            }

            if (validLag(entry.lagMs)) endLags[what.kind].push(entry.lagMs);
            const started = open.get(what.id);
            if (started === undefined) {
                g.orphanEnds++;
                return;
            }
            open.delete(what.id);
            if (at !== null && started.at !== null && at >= started.at) g.durations.push(at - started.at);
            g.heldInGame.push(entry.at - started.arrived);
            g.lastEndAt = at;
        },

        /** Para la línea corta del recuadro. */
        brief() {
            const starts = spread([...startLags.key, ...startLags.action, ...startLags.pointer]);
            const ends = spread([...endLags.key, ...endLags.action, ...endLags.pointer]);
            const durations = spread([...gestures.values()].flatMap((g) => g.durations.filter((d) => d > 0)));
            return [
                starts === null ? null : `inicio ${round(starts.mean)} ms`,
                ends === null ? null : `final ${round(ends.mean)} ms`,
                durations === null ? null : `gesto ${round(durations.median)} ms`,
            ].filter(Boolean).join(' · ');
        },

        /** Las medidas, en líneas listas para pegar. */
        lines() {
            const out = ['MEDICIONES'];
            const mapping = [
                kinds.key + kinds.pointer > 0 ? `teclas y ratón, el mapeo del usuario (${kinds.key} teclas, ${kinds.pointer} pulsaciones del botón)` : null,
                kinds.action > 0 ? `acciones, el preset runner (${kinds.action})` : null,
            ].filter(Boolean);
            out.push(`5. Mapeo usado: ${mapping.length > 0 ? mapping.join(' y ') : 'no ha llegado ningún gesto'}`);

            out.push('1. Retraso de los inicios (llegada menos at):');
            out.push(`   ${lagLine('VOUT_KEY down', startLags.key)}`);
            out.push(`   ${lagLine('VOUT_ACTION', startLags.action)}`);
            out.push(`   ${lagLine('VOUT_POINTER down', startLags.pointer)}`);

            out.push(`2. Duración de los gestos (at del final menos at del inicio) y cuánto los vio mantenidos el juego (de llegada a llegada). Daino cuenta un salto como mantenido desde ${holdThresholdMs} ms:`);
            if (gestures.size === 0) out.push('   sin datos');
            for (const [id, g] of gestures) {
                const d = spread(g.durations);
                if (d === null) {
                    out.push(`   ${id}: ningún gesto completo`);
                    continue;
                }
                const instant = g.durations.filter((v) => v === 0).length;
                const held = spread(g.heldInGame);
                const long = g.heldInGame.filter((v) => v >= holdThresholdMs).length;
                out.push(`   ${id}: ${d.n} gestos · duración mín ${round(d.min)}, mediana ${round(d.median)}, máx ${round(d.max)} ms`
                    + (instant > 0 ? ` · ${instant} de duración 0 (tecla en modo toque)` : '')
                    + ` · en el juego: mediana ${round(held.median)} ms, ${long} de ${held.n} de ${holdThresholdMs} ms o más`);
                out.push(`      duraciones: ${g.durations.slice(-SAMPLES).map(round).join(' ')}`);
            }

            out.push('3. Retraso de los finales (llegada menos at):');
            out.push(`   ${lagLine('VOUT_KEY up', endLags.key)}`);
            out.push(`   ${lagLine('VOUT_ACTION_END', endLags.action)}`);
            out.push(`   ${lagLine('VOUT_POINTER up', endLags.pointer)}`);

            out.push('4. Lo raro:');
            const odd = [];
            for (const [id, g] of gestures) {
                if (g.cuts > 0) odd.push(`   ${id}: ${g.cuts} veces un final y, menos de ${CUT_MS} ms después, otro inicio (¿un gesto mantenido que se cortó solo?)`);
                if (g.orphanEnds > 0) odd.push(`   ${id}: ${g.orphanEnds} finales sin inicio (Daino no hace nada con ellos)`);
                if (g.repeatedStarts > 0) odd.push(`   ${id}: ${g.repeatedStarts} inicios con el gesto ya empezado (dos gestos en la misma acción, o un final que no llegó)`);
            }
            for (const id of open.keys()) odd.push(`   ${id}: sigue mantenido al copiar esto`);
            out.push(...(odd.length > 0 ? odd : ['   nada']));
            return out;
        },
    };
}
