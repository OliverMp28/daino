// Seguimiento del análisis de los niveles que se están publicando (Ola 4).
//
// Publicar devuelve 202: el servidor analiza la canción en segundo plano y la
// deja lista para que su autor elija la dificultad y la publique. Mientras tanto
// la UI consulta GET /api/levels/{id}/analysis. Este módulo es el ÚNICO que consulta:
//
//   - Un solo sondeo por nivel, lo miren una tarjeta, la ficha o nadie. Varias
//     vistas suscritas no multiplican las peticiones.
//   - El ritmo se adapta a lo que pasa: rápido mientras analiza (hay progreso que
//     enseñar), más lento en cola, mucho más lento con la pestaña oculta, y con
//     espera creciente si la red falla. Nunca un intervalo fijo.
//   - Sigue aunque se cierre el catálogo: quien publica y se va a jugar otra
//     cosa recibe el aviso igualmente (`onSettled`).
//   - Termina solo: al quedar listo, publicarse, fallar o cancelarse deja de consultar.
//
// Sin DOM ni fetch directos: todo se inyecta, así se prueba en Node con un
// reloj falso (tests/js/analysis-watcher.test.mjs).

import { publishOutcome } from '../ui/publishModel.js';

/** Intervalos en ms. */
export const POLL_MS = Object.freeze({
    running: 1500,
    queued: 4000,
    hidden: 15000,
    errorBase: 3000,
    errorMax: 30000,
});

/**
 * @typedef {Object} WatcherDeps
 * @property {(levelId: number) => Promise<{ ok: boolean, status: number, data: any }>} fetchStatus
 *           GET /api/levels/{id}/analysis
 * @property {(levelId: number) => Promise<{ ok: boolean, status: number, data: any }>} fetchLevel
 *           GET /api/levels/{id} (el nivel ya terminado, para refrescar el catálogo)
 * @property {(fn: () => void, ms: number) => any} [schedule]
 * @property {(handle: any) => void} [cancel]
 * @property {() => boolean} [isHidden]
 * @property {(event: SettledEvent) => void} [onSettled]
 */

/**
 * @typedef {Object} SettledEvent
 * @property {number} levelId
 * @property {'ready' | 'published' | 'failed' | 'cancelled' | 'gone'} outcome
 * @property {object | null} level   El nivel actualizado (null si ya no existe o no se pudo leer).
 * @property {object | null} status  Última respuesta de /analysis.
 * @property {string | null} title
 */

/**
 * @param {WatcherDeps} deps
 */
export function createAnalysisWatcher(deps) {
    const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    const cancel = deps.cancel ?? ((h) => clearTimeout(h));
    const isHidden = deps.isHidden ?? (() => false);
    const onSettled = deps.onSettled ?? (() => {});

    /**
     * @type {Map<number, { title: string | null, timer: any, inFlight: boolean, failures: number,
     *                      last: object | null, listeners: Set<Function>, stopped: boolean }>}
     */
    const entries = new Map();

    function ensure(levelId, title) {
        let entry = entries.get(levelId);
        if (entry === undefined) {
            entry = { title: title ?? null, timer: null, inFlight: false, failures: 0, last: null, listeners: new Set(), stopped: false };
            entries.set(levelId, entry);
            void poll(levelId, entry);
        } else if (title && !entry.title) {
            entry.title = title;
        }
        return entry;
    }

    function nextDelay(entry) {
        if (entry.failures > 0) return Math.min(POLL_MS.errorMax, POLL_MS.errorBase * 2 ** (entry.failures - 1));
        if (isHidden()) return POLL_MS.hidden;
        return entry.last?.analysis?.status === 'running' ? POLL_MS.running : POLL_MS.queued;
    }

    function plan(levelId, entry, ms = nextDelay(entry)) {
        if (entry.stopped) return;
        entry.timer = schedule(() => {
            entry.timer = null;
            void poll(levelId, entry);
        }, ms);
    }

    async function poll(levelId, entry) {
        if (entry.stopped || entry.inFlight) return;
        entry.inFlight = true;
        let res;
        try {
            res = await deps.fetchStatus(levelId);
        } catch {
            res = { ok: false, status: 0, data: null };
        } finally {
            entry.inFlight = false;
        }
        if (entry.stopped) return;

        if (!res.ok) {
            // 404: el nivel se borró o ya no es de esta sesión. No hay nada que seguir.
            if (res.status === 404 || res.status === 403) {
                finish(levelId, entry, 'gone', null);
                return;
            }
            entry.failures++;
            plan(levelId, entry);
            return;
        }

        entry.failures = 0;
        entry.last = res.data;
        for (const fn of [...entry.listeners]) safeCall(fn, res.data);

        const outcome = publishOutcome(res.data);
        if (outcome === null) {
            plan(levelId, entry);
            return;
        }
        let level = null;
        try {
            const fresh = await deps.fetchLevel(levelId);
            level = fresh.ok ? fresh.data : null;
        } catch {
            level = null;
        }
        if (!entry.stopped) finish(levelId, entry, outcome, level);
    }

    function finish(levelId, entry, outcome, level) {
        stopEntry(levelId, entry);
        safeCall(onSettled, { levelId, outcome, level, status: entry.last, title: entry.title ?? level?.title ?? null });
    }

    function stopEntry(levelId, entry) {
        entry.stopped = true;
        if (entry.timer !== null) cancel(entry.timer);
        entry.timer = null;
        entry.listeners.clear();
        if (entries.get(levelId) === entry) entries.delete(levelId);
    }

    return {
        /**
         * Empieza a seguir un nivel (idempotente). La primera consulta sale ya.
         * @param {number} levelId
         * @param {{ title?: string }} [opts]
         */
        track(levelId, opts = {}) {
            ensure(levelId, opts.title);
        },

        /**
         * Recibe cada estado nuevo de ese nivel. Si ya hay uno, llega al momento.
         * Suscribirse también empieza a seguirlo.
         * @param {number} levelId
         * @param {(status: object) => void} fn
         * @returns {() => void}  cancela la suscripción (el seguimiento continúa)
         */
        subscribe(levelId, fn) {
            const entry = ensure(levelId);
            entry.listeners.add(fn);
            if (entry.last !== null) safeCall(fn, entry.last);
            return () => { entry.listeners.delete(fn); };
        },

        /**
         * Consulta ya, sin esperar al siguiente turno (p. ej. al volver a la pestaña).
         * @param {number} [levelId]  sin él, todos
         */
        refresh(levelId) {
            const targets = levelId === undefined ? [...entries] : [[levelId, entries.get(levelId)]];
            for (const [id, entry] of targets) {
                if (entry === undefined || entry.inFlight) continue;
                if (entry.timer !== null) cancel(entry.timer);
                entry.timer = null;
                void poll(id, entry);
            }
        },

        /** @param {number} levelId */
        isTracking(levelId) {
            return entries.has(levelId);
        },

        /** @param {number} levelId */
        latest(levelId) {
            return entries.get(levelId)?.last ?? null;
        },

        /** Deja de seguir todo sin avisar (cierre de sesión). */
        stopAll() {
            for (const [id, entry] of [...entries]) stopEntry(id, entry);
        },

        /** @returns {number} niveles en seguimiento */
        get size() {
            return entries.size;
        },
    };
}

function safeCall(fn, arg) {
    try {
        fn(arg);
    } catch (err) {
        console.error('[analysisWatcher]', err);
    }
}
