// Publicaciones en curso de la sesión (Ola 4): conecta el seguimiento del
// análisis (`api/analysisWatcher.js`) con el navegador y el resto de la UI.
//
//   - Publicar → `trackPublish(level)`. Al terminar el análisis se actualiza la
//     caché del catálogo, se emite `daino:level-updated` (la vista abierta se
//     repinta) y se avisa con un toast: el nivel está LISTO para que su autor
//     elija la dificultad y lo publique.
//   - Elegir dificultad (`changeDifficulty`) y publicar (`confirmPublish`) son
//     inmediatos: el servidor ya generó el chart de cada dificultad al analizar.
//   - Recargar la página a mitad de un análisis no lo pierde: al iniciar sesión
//     se piden "Míos" y se retoma el seguimiento de los pendientes.
//   - Un aviso no interrumpe una partida: si llega jugando, espera a que se
//     vuelva al menú.
//   - Cerrar sesión detiene todo.

import { request as apiRequest } from '../api/client.js';
import { createAnalysisWatcher } from '../api/analysisWatcher.js';
import { getLevels, invalidateLevels, markLevelsStale, patchCachedLevel } from '../api/levelsCache.js';
import { createLocalBests } from '../storage/localBests.js';
import { DIFFICULTY_NAMES } from '../game/levels/difficulty.js';
import { failureView } from './publishModel.js';
import { showToast } from './toast.js';

/**
 * Evento en window cuando termina el análisis de un nivel que se publica:
 * `detail: { levelId, outcome, level: object|null, status: object|null }`.
 */
export const LEVEL_UPDATED_EVENT = 'daino:level-updated';

/** Estados de la app en los que un aviso molestaría (body[data-app-state]). */
const QUIET_STATES = new Set(['LOADING', 'PLAYING', 'PAUSED']);

/** Avisos ya dados, por trabajo: un mismo desenlace no se anuncia dos veces. */
const announced = new Set();
/** @type {Array<{ message: string, severity: 'info' | 'error' }>} */
const pendingToasts = [];

const localBests = createLocalBests();

const watcher = createAnalysisWatcher({
    fetchStatus: (id) => apiRequest('GET', `/api/levels/${id}/analysis`),
    fetchLevel: (id) => apiRequest('GET', `/api/levels/${id}`),
    isHidden: () => typeof document !== 'undefined' && document.hidden === true,
    onSettled: handleSettled,
});

/**
 * Sigue el análisis de un nivel que se publica (idempotente).
 * @param {{ id: number, title?: string }} level
 */
export function trackPublish(level) {
    watcher.track(level.id, { title: level.title });
}

/**
 * Retoma el seguimiento de los niveles de una lista que siguen analizándose.
 * @param {object[]} levels
 */
export function trackPending(levels) {
    for (const level of levels) {
        if (level?.is_mine === true && level.pending_public === true) trackPublish(level);
    }
}

/**
 * Elige la dificultad de un nivel propio listo para publicar. Inmediato.
 *
 * @param {{ id: number }} level
 * @param {'auto' | number} difficulty
 * @returns {Promise<{ ok: true, level: object } | { ok: false, message: string }>}
 */
export async function changeDifficulty(level, difficulty) {
    const res = await apiRequest('POST', `/api/levels/${level.id}/difficulty`, { body: { difficulty } });
    if (res.ok && res.data?.level) {
        const fresh = res.data.level;
        patchCachedLevel(fresh);
        // El servidor borró la marca de prueba (era de otro chart): la local también.
        localBests.forget(level.id);
        return { ok: true, level: fresh };
    }
    const message = res.data?.message
        ?? res.data?.fields?.difficulty
        ?? `No se pudo cambiar la dificultad (error ${res.status}).`;
    return { ok: false, message };
}

/**
 * Publica un nivel propio listo, con la dificultad elegida. Inmediato.
 *
 * @param {{ id: number }} level
 * @returns {Promise<{ ok: true, level: object } | { ok: false, message: string }>}
 */
export async function confirmPublish(level) {
    const res = await apiRequest('POST', `/api/levels/${level.id}/visibility`, { body: { is_public: true } });
    if (res.ok && res.data?.is_public === true) {
        patchCachedLevel(res.data);
        invalidateLevels('public');
        markLevelsStale();
        return { ok: true, level: res.data };
    }
    const message = res.status === 409 && res.data?.error === 'duplicate_title'
        ? 'Ya tienes un nivel público con ese título.'
        : (res.data?.message ?? `No se pudo publicar (error ${res.status}).`);
    return { ok: false, message };
}

/**
 * Renuncia a publicar un nivel listo (o retira uno publicado): vuelve a ser
 * privado y su audio se borra del servidor.
 *
 * @param {{ id: number }} level
 * @returns {Promise<{ ok: true, level: object } | { ok: false, message: string }>}
 */
export async function withdrawPublish(level) {
    const res = await apiRequest('POST', `/api/levels/${level.id}/visibility`, { body: { is_public: false } });
    if (res.ok && res.data?.id === level.id) {
        patchCachedLevel({ ...res.data, analysis: null });
        invalidateLevels('public');
        return { ok: true, level: res.data };
    }
    return { ok: false, message: res.data?.message ?? `No se pudo cancelar la publicación (error ${res.status}).` };
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
        patchCachedLevel({ id: level.id, pending_public: true, publish_ready: false, analysis: res.data?.analysis ?? null });
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
        patchCachedLevel({
            id: levelId, is_public: status.is_public, pending_public: false,
            publish_ready: status.publish_ready === true, analysis: status.analysis,
        });
    }
    if (outcome === 'published') invalidateLevels('public');
    markLevelsStale();
    window.dispatchEvent(new CustomEvent(LEVEL_UPDATED_EVENT, { detail: { levelId, outcome, level, status } }));

    const jobKey = `${levelId}:${status?.analysis?.created_at ?? ''}:${outcome}`;
    if (announced.has(jobKey)) return;
    announced.add(jobKey);
    const name = title ? `«${title}»` : 'Tu nivel';
    if (outcome === 'ready') {
        notify(`${name} está analizado: elige su dificultad en «Míos» y publícalo.`, 'info');
    } else if (outcome === 'published') {
        notify(`${name} ya está publicado${level?.difficulty ? ` en ${DIFFICULTY_NAMES[level.difficulty]}` : ''}.`, 'info');
    } else if (outcome === 'failed') {
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
