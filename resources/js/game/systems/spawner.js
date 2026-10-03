// Spawner — pone en escena los obstáculos del chart en el instante justo.
//
// Invariante (doc 08 § Bloque 5): este módulo NO importa el AudioEngine. Solo
// recibe el tiempo de canción como parámetro, lo que permite probarlo en
// aislamiento y mantiene separados generación offline y consumo online.
//
// Ola 3 — rediseño completo. Antes: cada obstáculo NACÍA en el borde derecho
// en su instante musical y avanzaba integrando `x -= speed * dt`. Eso hacía
// que llegara al Dino 3-7 s tarde (dependiendo del ancho de la ventana) y que
// fuera acumulando error con cada tirón de frames.
//
// Ahora la posición de cada obstáculo es una FUNCIÓN del tiempo de canción
// (`physics.obstacleLeftX`): su centro cruza al Dino exactamente
// `actionLeadS` después de su evento, en cualquier monitor y con cualquier
// framerate. El spawner solo decide cuándo un obstáculo entra en el campo de
// visión, lo coloca cada frame y lo recicla al salir.
//
// Eficiencia:
//   - Pool por kind: reutiliza objetos en lugar de crear y destruir Pixi
//     Containers durante la partida (cero basura para el GC en el bucle).
//   - Cola ordenada por instante de aparición + cursor monótono: decidir qué
//     entra cuesta O(1) amortizado por frame.
//   - `getActive()` devuelve siempre el mismo array, sin copias.

import { DINO_CENTER_X, FIGURE, aabbHit, obstacleHit, obstacleTopY, triggerZone } from './physics.js';
import { toSimObstacles, toSimTriggers } from './playability.js';
import { asSpeedProfile } from './speedProfile.js';

/** Un obstáculo entra en cola cuando su borde izquierdo está a este margen del borde derecho. */
const SPAWN_MARGIN_PX = 80;

/** Se recicla cuando su borde derecho sale este margen por la izquierda. */
const CULL_MARGIN_PX = 100;

/**
 * @typedef {Object} SpawnerObstacle
 * @property {(fadeIn: boolean) => void} activate
 * @property {() => void} deactivate
 * @property {(x: number, groundY: number) => void} placeAt
 * @property {(dt: number) => void} animate
 * @property {() => { x: number, y: number, w: number, h: number }} getHitbox
 */

/**
 * @param {object} cfg
 * @param {Array<{ t: number, type: string, kind?: string }>} cfg.events  Eventos del chart.
 * @param {number} [cfg.speedPxS]  Velocidad constante (API de la Ola 3).
 * @param {import('./speedProfile.js').SpeedProfile} [cfg.speed]
 *        Perfil de velocidad del nivel (Ola 5). Tiene prioridad sobre `speedPxS`.
 * @param {{ addChild: Function, removeChild: Function }} cfg.layer
 * @param {(kind: string) => SpawnerObstacle} cfg.createObstacle
 *        Fábrica de obstáculos. GameSession pasa `kind => new Obstacle(kind)`;
 *        los tests pasan objetos planos, sin Pixi.
 */
export function createSpawner(cfg) {
    const { events, layer, createObstacle } = cfg;
    const profile = asSpeedProfile(cfg.speed ?? cfg.speedPxS);

    // Posición de un obstáculo: DINO + (D(cruce) − D(ahora)) − w/2 (ver
    // speedProfile.js). Con velocidad constante, la fórmula exacta de la Ola 3.
    const leftX = (data, songTime, nowD) => DINO_CENTER_X
        + (profile.constant ? (data.cross - songTime) * profile.base : data.crossD - nowD)
        - data.def.w / 2;

    // Cola por DISTANCIA de aparición: un obstáculo entra cuando su borde
    // izquierdo alcanza el borde derecho, es decir, cuando D(ahora) llega a
    // D(cruce) − w/2 − (ancho − DINO). El término del viewport es común a
    // todos, así que el orden de la cola no cambia al redimensionar ni con la
    // velocidad (D es creciente).
    // Los activadores (anillos, Ola 6c) se ven y se colocan igual; no se chocan.
    const queue = [...toSimObstacles(events), ...toSimTriggers(events)]
        .map((o) => {
            const crossD = profile.distanceAt(o.cross);
            return { ...o, crossD, appearKey: crossD - o.def.w / 2, trigger: o.def.trigger !== undefined, used: false };
        })
        .sort((a, b) => a.appearKey - b.appearKey);

    const lastCross = queue.reduce((m, o) => Math.max(m, o.cross), -Infinity);

    /** @type {Map<string, SpawnerObstacle[]>} */
    const pools = new Map();
    /** @type {SpawnerObstacle[]} en paralelo con `activeData` */
    const active = [];
    /** @type {Array<typeof queue[number]>} */
    const activeData = [];
    /** Todo objeto creado alguna vez, para liberarlo en dispose. */
    const created = [];

    let cursor = 0;
    let lastSongTime = -Infinity;
    /** Activador iluminado ahora mismo (armTrigger). */
    let armedData = null;
    const scratchBox = { x: 0, y: 0, w: 0, h: 0 };

    function acquire(kind) {
        const pool = pools.get(kind);
        if (pool !== undefined && pool.length > 0) return pool.pop();
        const o = createObstacle(kind);
        layer.addChild(o);
        created.push(o);
        return o;
    }

    function release(o, kind) {
        o.deactivate();
        let pool = pools.get(kind);
        if (pool === undefined) {
            pool = [];
            pools.set(kind, pool);
        }
        pool.push(o);
    }

    return {
        /**
         * @param {number} songTime  Segundos de canción (puede ser ligeramente
         *                           negativo al arrancar por la latencia de salida).
         * @param {number} dt        Delta de frame en segundos (solo animación).
         * @param {{ width: number, groundY: number }} viewport
         */
        tick(songTime, dt, viewport) {
            // Si el reloj retrocede (no debería: el audio es monótono), se
            // ignora el frame en vez de reordenar la escena.
            if (songTime < lastSongTime) songTime = lastSongTime;
            lastSongTime = songTime;

            const nowD = profile.distanceAt(songTime);
            const horizon = nowD + (viewport.width + SPAWN_MARGIN_PX - DINO_CENTER_X);
            while (cursor < queue.length && queue[cursor].appearKey <= horizon) {
                const data = queue[cursor++];
                const x = leftX(data, songTime, nowD);
                // Ya había pasado (tirón muy largo, pestaña en segundo plano):
                // no tiene sentido mostrarlo un frame para reciclarlo al siguiente.
                if (x + data.def.w < -CULL_MARGIN_PX) continue;
                const o = acquire(data.kind);
                // Si nace dentro de la pantalla (ventana ancha + canción lenta,
                // o un resize), entra con fundido en vez de aparecer de golpe.
                o.activate(x < viewport.width);
                active.push(o);
                activeData.push(data);
            }

            for (let i = active.length - 1; i >= 0; i--) {
                const data = activeData[i];
                const x = leftX(data, songTime, nowD);
                if (x + data.def.w < -CULL_MARGIN_PX) {
                    if (data === armedData) armedData = null;
                    release(active[i], data.kind);
                    active.splice(i, 1);
                    activeData.splice(i, 1);
                    continue;
                }
                active[i].placeAt(x, viewport.groundY);
                active[i].animate(dt);
            }
        },

        /** Obstáculos en escena (mismo array cada vez — no mutar). */
        getActive() {
            return active;
        },

        /**
         * Crea ya un obstáculo de cada tipo que trae el nivel y lo deja en su
         * reserva, apagado (T05.3). Sin esto, el primero de cada tipo se construye
         * —y su dibujo se rasteriza— cuando asoma, a mitad de canción. Devuelve los
         * creados, para que quien llama los pinte una vez (systems/prewarm.js).
         *
         * @returns {SpawnerObstacle[]}
         */
        prewarm() {
            const made = [];
            for (const data of queue) {
                if (pools.has(data.kind)) continue;
                const o = createObstacle(data.kind);
                layer.addChild(o);
                created.push(o);
                release(o, data.kind);
                made.push(o);
            }
            return made;
        },

        /**
         * ¿Choca un hitbox con algún obstáculo activo en un instante dado?
         *
         * Calcula las posiciones analíticamente para ESE instante, sin mirar
         * dónde están los sprites. La física a paso fijo lo llama en cada paso
         * (varios por frame): así la colisión se evalúa en el mismo instante en
         * que se integró el Dino, no en el del último frame dibujado.
         *
         * @param {{ x: number, y: number, w: number, h: number }} box
         * @param {number} songTime
         * @param {number} groundY
         * @param {number} [figure]  Qué parte de la caja es cuerpo (physics.bodyFigure).
         *        Por defecto, la caja entera.
         * @returns {string | null} kind del obstáculo con el que choca, o null.
         */
        collisionAt(box, songTime, groundY, figure = FIGURE.BOX) {
            const nowD = profile.constant ? 0 : profile.distanceAt(songTime);
            for (let i = 0; i < activeData.length; i++) {
                const data = activeData[i];
                const x = leftX(data, songTime, nowD);
                // Descarte horizontal barato antes de construir el hitbox.
                if (data.trigger || x > box.x + box.w || x + data.def.w < box.x) continue;
                if (obstacleHit(figure, box, data.def, x, obstacleTopY(data.def, groundY), scratchBox)) return data.kind;
            }
            return null;
        },

        /**
         * Activador (anillo) sin usar cuya zona toca el hitbox en `songTime`, o null.
         * Quien llama aplica su efecto (physics.applyTrigger) y, si se activó, lo
         * marca con `markTriggerUsed`: cada anillo vale una vez, como en el simulador.
         *
         * @param {{ x: number, y: number, w: number, h: number }} box
         * @param {number} songTime
         * @param {number} groundY
         * @returns {{ kind: string, def: object } | null}
         */
        triggerAt(box, songTime, groundY) {
            const nowD = profile.constant ? 0 : profile.distanceAt(songTime);
            for (let i = 0; i < activeData.length; i++) {
                const data = activeData[i];
                if (!data.trigger || data.used) continue;
                const x = leftX(data, songTime, nowD);
                triggerZone(data.def, x, obstacleTopY(data.def, groundY), scratchBox);
                if (aabbHit(box, scratchBox)) return data;
            }
            return null;
        },

        /**
         * El activador al alcance del Dino (o null): su visual se ilumina
         * (`Obstacle.setArmed`) y el anterior se apaga. Solo visual: activarlo lo
         * decide la física con `triggerAt`.
         * @param {object | null} data  Lo que devolvió `triggerAt`.
         */
        armTrigger(data) {
            if (data === armedData) return;
            const prev = armedData === null ? -1 : activeData.indexOf(armedData);
            if (prev >= 0) active[prev].setArmed?.(false);
            armedData = data;
            const i = data === null ? -1 : activeData.indexOf(data);
            if (i >= 0) active[i].setArmed?.(true);
        },

        /** Marca un activador como usado (su visual lo refleja: `Obstacle.onTriggered`). */
        markTriggerUsed(data) {
            data.used = true;
            const i = activeData.indexOf(data);
            if (i >= 0) active[i].onTriggered?.();
        },

        /**
         * ¿Queda algún obstáculo por cruzar al Dino a partir de `songTime`?
         * La partida no se gana mientras sí: la canción puede acabar con el
         * último obstáculo todavía llegando.
         * @param {number} songTime
         */
        hasPendingCrossing(songTime) {
            return lastCross >= songTime;
        },

        /** Instante del último cruce, o -Infinity si el chart no tiene obstáculos. */
        get lastCrossTime() {
            return lastCross;
        },

        dispose() {
            for (const o of created) {
                layer.removeChild(o);
                if (typeof o.destroy === 'function') o.destroy({ children: true });
            }
            created.length = 0;
            active.length = 0;
            activeData.length = 0;
            pools.clear();
            cursor = 0;
        },
    };
}
