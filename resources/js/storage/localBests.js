// Mejores marcas locales por nivel del catálogo (Ola 2).
//
// Daino se juega sin cuenta. Sin sesión el progreso no llega al servidor, pero
// un jugador anónimo que reintenta un nivel quiere ver su mejor marca en la
// tarjeta. Aquí se guarda en el navegador, por id de nivel del catálogo.
//
// Con sesión, la tarjeta muestra la mayor entre la del servidor y la local: una
// partida hecha antes de iniciar sesión no desaparece de la vista (aunque no
// cuente para el ranking, que solo recoge lo que el servidor valida).
//
// localStorage y no IndexedDB: son unos pocos bytes por nivel, se leen de forma
// síncrona al pintar la rejilla y comparten el prefijo `daino:` que "Borrar
// datos locales" de AJUSTES ya sabe limpiar. El almacenamiento se inyecta para
// probarlo en Node y porque puede lanzar (modo privado, cuota, bloqueado).

const STORAGE_KEY = 'daino:bests';

/** Techo de niveles recordados; al superarlo se olvidan los jugados hace más tiempo. */
export const MAX_ENTRIES = 500;

/**
 * @typedef {{ points: number, percentage: number, at: number }} LocalBest
 */

/**
 * @param {{ storage?: Storage | null, now?: () => number }} [deps]
 */
export function createLocalBests(deps = {}) {
    const storage = deps.storage !== undefined ? deps.storage : safeLocalStorage();
    const now = deps.now ?? (() => Date.now());

    function readAll() {
        if (storage === null) return {};
        try {
            const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
            return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};   // corrupto: se empieza de cero en vez de romper la rejilla
        }
    }

    function writeAll(map) {
        if (storage === null) return;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(map));
        } catch {
            // Cuota o almacenamiento bloqueado: la marca local es una comodidad.
        }
    }

    return {
        /**
         * @param {number} levelId
         * @returns {LocalBest | null}
         */
        get(levelId) {
            const entry = readAll()[String(levelId)];
            return isBest(entry) ? entry : null;
        },

        /**
         * Guarda la partida si mejora la marca. Mismo criterio que el servidor
         * (`Progress::upsert`): puntos y porcentaje suben por separado, nunca bajan.
         *
         * @param {number} levelId
         * @param {{ points: number, percentage: number }} run
         * @returns {{ best: LocalBest, improved: boolean }}
         */
        record(levelId, run) {
            if (!Number.isInteger(levelId) || levelId <= 0) throw new Error('localBests: levelId inválido');
            const points = Math.max(0, Math.floor(Number(run.points) || 0));
            const percentage = Math.min(100, Math.max(0, Math.round(Number(run.percentage) || 0)));

            const map = readAll();
            const key = String(levelId);
            const prev = isBest(map[key]) ? map[key] : null;
            const improved = prev === null || points > prev.points;
            const best = {
                points: Math.max(points, prev?.points ?? 0),
                percentage: Math.max(percentage, prev?.percentage ?? 0),
                // `at` = última vez jugado: decide qué se olvida primero.
                at: now(),
            };
            map[key] = best;

            const keys = Object.keys(map);
            if (keys.length > MAX_ENTRIES) {
                keys.sort((a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0));
                for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
            }
            writeAll(map);
            return { best, improved };
        },

        /**
         * Olvida la marca de un nivel cuyo chart cambió (su autor eligió otra
         * dificultad antes de publicarlo): era de un nivel que ya no existe.
         *
         * @param {number} levelId
         */
        forget(levelId) {
            const map = readAll();
            const key = String(levelId);
            if (!Object.hasOwn(map, key)) return;
            delete map[key];
            writeAll(map);
        },
    };
}

/**
 * La marca que enseña una tarjeta: la mayor entre servidor y local.
 *
 * @param {{ points: number, percentage: number } | null | undefined} server
 * @param {{ points: number, percentage: number } | null | undefined} local
 * @returns {{ points: number, percentage: number } | null}
 */
export function mergeBest(server, local) {
    if (!server && !local) return null;
    return {
        points: Math.max(server?.points ?? 0, local?.points ?? 0),
        percentage: Math.max(server?.percentage ?? 0, local?.percentage ?? 0),
    };
}

function isBest(v) {
    return v !== null && typeof v === 'object' && Number.isFinite(v.points) && Number.isFinite(v.percentage);
}

function safeLocalStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}
