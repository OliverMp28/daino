// Publicaciones en curso de la sesión (Ola 4): conecta el seguimiento del
// análisis (`api/analysisWatcher.js`) con el navegador y el resto de la UI.
//
//   - Publicar → `trackPublish(level)`. Al terminar se actualiza la caché del
//     catálogo, se emite `daino:level-updated` (la vista abierta se repinta) y se
//     avisa con un toast.
//   - Recargar la página a mitad de un análisis no lo pierde: al iniciar sesión
//     se piden "Míos" y se retoma el seguimiento de los pendientes.
//   - Un aviso no interrumpe una partida: si llega jugando, espera a que se
//     vuelva al menú.
//   - Cerrar sesión detiene todo.

import { request as apiRequest } from '../api/client.js';
import { createAnalysisWatcher } from '../api/analysisWatcher.js';
import { getLevels, invalidateLevels, markLevelsStale, patchCachedLevel } from '../api/levelsCache.js';
import { failureView } from './publishModel.js';
import { showToast } from './toast.js';

/**
 * Evento en window cuando termina la publicación de un nivel:
 * `detail: { levelId, outcome, level: object|null, status: object|null }`.
 */
export const LEVEL_UPDATED_EVENT = 'daino:level-updated';

/** Estados de la app en los que un aviso molestaría (body[data-app-state]). */
const QUIET_STATES = new Set(['LOADING', 'PLAYING', 'PAUSED']);

/** Avisos ya dados, por trabajo: un mismo desenlace no se anuncia dos veces. */
const announced = new Set();
/** @type {Array<{ message: string, severity: 'info' | 'error' }>} */
const pendingToasts = [];

const watcher = createAnalysisWatcher({
    fetchStatus: (id) => apiRequest('GET', `/api/levels/${id}/analysis`),
    fetchLevel: (id) => apiRequest('GET', `/api/levels/${id}`),
    isHidden: () => typeof document !== 'undefined' && document.hidden === true,
    onSettled: handleSettled,
});

/**
 * Sigue la publicación de un nivel (idempotente).
 * @param {{ id: number, title?: string }} level
 */
export function trackPublish(level) {
    watcher.track(level.id, { title: level.title });
}

/**
 * Retoma el seguimiento de los niveles de una lista que siguen pendientes.
 * @param {object[]} levels
 */
export function trackPending(levels) {
    for (const level of levels) {
        if (level?.pending_public === true && level.is_mine === true) trackPublish(level);
    }
}

/**
 * Estado del análisis de un nivel, en vivo.
 * @param {number} levelId
 * @param {(status: object) => void} fn
 * @returns {() => void}
 */
export function subscribeAnalysis(levelId, fn) {
    return watcher.subscribe(levelId, fn);
}

/**
 * Reintenta el análisis de un nivel propio cuyo análisis falló.
 * @param {{ id: number, title?: string }} level
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function retryAnalysis(level) {
    const res = await apiRequest('POST', `/api/levels/${level.id}/analysis`);
    if (res.ok) {
        // El nivel vuelve a estar pendiente: la caché lo refleja ya, sin esperar.
        patchCachedLevel({ id: level.id, pending_public: true, analysis: res.data?.analysis ?? null });
        trackPublish(level);
        return { ok: true };
    }
    if (res.status === 409 && res.data?.error === 'already_active') {
        trackPublish(level);
        return { ok: true };
    }
    return { ok: false, message: res.data?.message ?? `No se pudo reintentar (error ${res.status}).` };
}

function handleSettled({ levelId, outcome, level, status, title }) {
    if (level !== null) {
        patchCachedLevel(level);
    } else if (status !== null) {
        // Sin el nivel completo (fallo de red puntual): al menos que la caché no
        // lo siga dando por pendiente, o una vista volvería a seguirlo.
        patchCachedLevel({ id: levelId, is_public: status.is_public, pending_public: false, analysis: status.analysis });
    }
    if (outcome === 'published') invalidateLevels('community');
    markLevelsStale();
    window.dispatchEvent(new CustomEvent(LEVEL_UPDATED_EVENT, { detail: { levelId, outcome, level, status } }));

    const jobKey = `${levelId}:${status?.analysis?.created_at ?? ''}:${outcome}`;
    if (announced.has(jobKey)) return;
    announced.add(jobKey);
    const name = title ? `«${title}»` : 'Tu nivel';
    if (outcome === 'published') notify(`${name} ya está publicado. Aparece en «De la comunidad».`, 'info');
    else if (outcome === 'failed') {
        const { retryable } = failureView(status?.analysis?.error?.code);
        notify(`No se pudo analizar ${name}. ${retryable ? 'Puedes reintentarlo desde «Míos».' : 'Revisa el archivo en «Míos».'}`, 'error');
    }
}

function notify(message, severity) {
    if (QUIET_STATES.has(document.body?.dataset.appState ?? '')) {
        pendingToasts.push({ message, severity });
        return;
    }
    showToast(message, severity, 6000);
}

function flushToasts() {
    if (QUIET_STATES.has(document.body?.dataset.appState ?? '')) return;
    while (pendingToasts.length > 0) {
        const { message, severity } = pendingToasts.shift();
        showToast(message, severity, 6000);
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('daino:auth:login', () => {
        void getLevels('mine').then((res) => {
            if (res.ok) trackPending(res.data.items);
        });
    });
    window.addEventListener('daino:auth:logout', () => {
        watcher.stopAll();
        pendingToasts.length = 0;
    });
    document.addEventListener('visibilitychange', () => {
        // Al volver a la pestaña, el estado real ya, no dentro de 15 s.
        if (!document.hidden) watcher.refresh();
    });
    const observeState = () => {
        new MutationObserver(flushToasts).observe(document.body, { attributes: true, attributeFilter: ['data-app-state'] });
    };
    if (document.body) observeState();
    else document.addEventListener('DOMContentLoaded', observeState, { once: true });
}
