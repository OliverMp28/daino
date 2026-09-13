// Caché persistente de niveles en el navegador (Ola 3).
//
// Responde a "¿por qué a la segunda vez vuelve a descargarse?". Guarda, por
// hash del audio:
//   - audio    Bytes del MP3 de niveles del catálogo (no de archivos locales:
//              esos ya están en el disco del usuario y no los duplicamos).
//   - analysis Resultado del análisis — lo caro. Reanalizar el mismo archivo
//              pasa de ~1 s a 0.
//   - charts   Charts descargados del servidor, por nivel y versión.
//
// Decisiones:
//   - IndexedDB para todo, audio incluido (como Blob). El roadmap mencionaba
//     Cache API para el audio, pero un único almacén permite llevar la
//     contabilidad LRU (tamaño y último uso) en la misma transacción que los
//     datos: nunca quedan metadatos de un audio que ya no existe ni al revés.
//     Los navegadores guardan los Blobs de IndexedDB como archivos, sin copiar
//     los bytes dentro de la base de datos.
//   - Presupuesto con desalojo LRU. La cuota del navegador es generosa pero
//     no infinita, y una caché que crece sin techo acaba desalojada entera por
//     el navegador en el peor momento.
//   - NUNCA lanza. Modo privado, cuota agotada, IndexedDB bloqueado: la caché
//     es una optimización y su fallo solo significa volver a descargar o
//     analizar. Jamás debe impedir jugar.

const DB_NAME = 'daino';
const DB_VERSION = 1;

export const DEFAULT_LIMITS = Object.freeze({
    /** ~40 canciones de 5-6 MB. */
    audioMaxBytes: 250 * 1024 * 1024,
    audioMaxEntries: 60,
    analysisMaxEntries: 300,
    chartMaxEntries: 500,
});

/**
 * @typedef {Object} LevelCache
 * @property {(sha: string) => Promise<ArrayBuffer|null>} getAudio
 * @property {(sha: string, bytes: ArrayBuffer|Uint8Array) => Promise<void>} putAudio
 * @property {(sha: string, analyzerKey: string) => Promise<object|null>} getAnalysis
 * @property {(sha: string, analyzerKey: string, analysis: object) => Promise<void>} putAnalysis
 * @property {(key: string) => Promise<object|null>} getChart
 * @property {(key: string, chart: object) => Promise<void>} putChart
 * @property {string} kind  'indexeddb' | 'memory'
 */

/** Clave de chart de un nivel del servidor. Una versión nueva no pisa la vieja. */
export function catalogChartKey(levelId, chartVersion) {
    return `level:${levelId}:v${chartVersion}`;
}

/**
 * La mejor caché disponible: IndexedDB si existe, memoria si no.
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS> }} [opts]
 * @returns {LevelCache}
 */
export function createLevelCache(opts = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
    if (typeof indexedDB === 'undefined') return createMemoryLevelCache({ limits });
    return createIdbLevelCache({ limits });
}

// --------------------------- Memoria ---------------------------

/**
 * Caché en memoria con la misma interfaz y el mismo desalojo LRU. Se usa donde
 * no hay IndexedDB y en los tests.
 *
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS> }} [opts]
 * @returns {LevelCache}
 */
export function createMemoryLevelCache(opts = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
    const stores = { audio: new Map(), analysis: new Map(), charts: new Map() };
    let clock = 0;

    function touch(store, key) {
        const rec = stores[store].get(key);
        if (rec === undefined) return undefined;
        rec.lastUsed = ++clock;
        return rec;
    }

    function evict(store, maxEntries, maxBytes) {
        const map = stores[store];
        const byAge = [...map.values()].sort((a, b) => a.lastUsed - b.lastUsed);
        let bytes = byAge.reduce((s, r) => s + (r.bytes ?? 0), 0);
        for (const rec of byAge) {
            if (map.size <= maxEntries && bytes <= maxBytes) break;
            map.delete(rec.key);
            bytes -= rec.bytes ?? 0;
        }
    }

    return {
        kind: 'memory',
        async getAudio(sha) {
            const rec = touch('audio', sha);
            // Copia: quien decodifique el buffer lo desengancha (detach) y
            // dejaría inservible la entrada cacheada.
            return rec === undefined ? null : rec.bytes === 0 ? new ArrayBuffer(0) : rec.data.slice(0);
        },
        async putAudio(sha, bytes) {
            const data = toArrayBuffer(bytes);
            stores.audio.set(sha, { key: sha, data, bytes: data.byteLength, lastUsed: ++clock });
            evict('audio', limits.audioMaxEntries, limits.audioMaxBytes);
        },
        async getAnalysis(sha, analyzerKey) {
            return touch('analysis', `${sha}|${analyzerKey}`)?.value ?? null;
        },
        async putAnalysis(sha, analyzerKey, analysis) {
            const key = `${sha}|${analyzerKey}`;
            stores.analysis.set(key, { key, value: analysis, lastUsed: ++clock });
            evict('analysis', limits.analysisMaxEntries, Infinity);
        },
        async getChart(key) {
            return touch('charts', key)?.value ?? null;
        },
        async putChart(key, chart) {
            stores.charts.set(key, { key, value: chart, lastUsed: ++clock });
            evict('charts', limits.chartMaxEntries, Infinity);
        },
    };
}

// --------------------------- IndexedDB ---------------------------

/**
 * @param {{ limits: typeof DEFAULT_LIMITS }} opts
 * @returns {LevelCache}
 */
function createIdbLevelCache({ limits }) {
    let dbPromise = null;
    let disabled = false;

    function openDb() {
        if (dbPromise !== null) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                for (const name of ['audio', 'analysis', 'charts']) {
                    if (!db.objectStoreNames.contains(name)) {
                        const store = db.createObjectStore(name, { keyPath: 'key' });
                        store.createIndex('lastUsed', 'lastUsed');
                    }
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            // Otra pestaña con una versión vieja abierta: no esperar para siempre.
            req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
        });
        return dbPromise;
    }

    /**
     * Ejecuta una operación y convierte cualquier fallo en `fallback`.
     *
     * Un error inesperado (no poder abrir la base de datos, navegador en modo
     * privado estricto) desactiva la caché el resto de la sesión: reintentar
     * en cada partida solo añadiría latencia. Quedarse sin cuota NO la
     * desactiva — las lecturas siguen sirviendo y el desalojo LRU libera sitio.
     */
    async function safely(label, fallback, fn) {
        if (disabled) return fallback;
        try {
            const db = await openDb();
            return await fn(db);
        } catch (err) {
            if (err?.name !== 'QuotaExceededError') disabled = true;
            console.warn(`[levelCache] ${label} falló — se continúa sin caché:`, err);
            return fallback;
        }
    }

    async function getRecord(db, storeName, key) {
        // readwrite: la lectura actualiza el "último uso" en la misma transacción.
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const rec = await reqToPromise(store.get(key));
        if (rec !== undefined) {
            rec.lastUsed = Date.now();
            store.put(rec);
        }
        await txDone(tx);
        return rec;
    }

    async function putAndEvict(db, storeName, record, maxEntries, maxBytes) {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(record);

        // Desalojo LRU en la MISMA transacción: recorre por último uso
        // ascendente y borra hasta volver al presupuesto.
        const total = await reqToPromise(store.count());
        let bytes = 0;
        if (Number.isFinite(maxBytes)) {
            const all = await reqToPromise(store.getAll());
            bytes = all.reduce((s, r) => s + (r.bytes ?? 0), 0);
        }
        let count = total;
        if (count > maxEntries || bytes > maxBytes) {
            await new Promise((resolve, reject) => {
                const cursorReq = store.index('lastUsed').openCursor();
                cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (cursor === null || (count <= maxEntries && bytes <= maxBytes)) {
                        resolve();
                        return;
                    }
                    if (cursor.value.key !== record.key) {
                        bytes -= cursor.value.bytes ?? 0;
                        count--;
                        cursor.delete();
                    }
                    cursor.continue();
                };
                cursorReq.onerror = () => reject(cursorReq.error);
            });
        }
        await txDone(tx);
    }

    return {
        kind: 'indexeddb',
        getAudio(sha) {
            return safely('getAudio', null, async (db) => {
                const rec = await getRecord(db, 'audio', sha);
                return rec === undefined ? null : await rec.blob.arrayBuffer();
            });
        },
        putAudio(sha, bytes) {
            // El Blob se crea YA, de forma síncrona: copia los bytes antes de
            // cualquier `await`. Quien llama suele decodificar el audio justo
            // después, y `decodeAudioData` desengancha (detach) el ArrayBuffer —
            // si el Blob se creara tras abrir la base de datos, copiaría un
            // buffer ya vacío.
            const blob = new Blob([bytes], { type: 'audio/mpeg' });
            return safely('putAudio', undefined, (db) => {
                return putAndEvict(db, 'audio', {
                    key: sha, blob, bytes: blob.size, lastUsed: Date.now(),
                }, limits.audioMaxEntries, limits.audioMaxBytes);
            });
        },
        getAnalysis(sha, analyzerKey) {
            return safely('getAnalysis', null, async (db) => {
                const rec = await getRecord(db, 'analysis', `${sha}|${analyzerKey}`);
                return rec?.value ?? null;
            });
        },
        putAnalysis(sha, analyzerKey, analysis) {
            return safely('putAnalysis', undefined, (db) => putAndEvict(db, 'analysis', {
                key: `${sha}|${analyzerKey}`, value: analysis, lastUsed: Date.now(),
            }, limits.analysisMaxEntries, Infinity));
        },
        getChart(key) {
            return safely('getChart', null, async (db) => (await getRecord(db, 'charts', key))?.value ?? null);
        },
        putChart(key, chart) {
            return safely('putChart', undefined, (db) => putAndEvict(db, 'charts', {
                key, value: chart, lastUsed: Date.now(),
            }, limits.chartMaxEntries, Infinity));
        },
    };
}

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('transacción abortada'));
    });
}

function toArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes.slice(0);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
