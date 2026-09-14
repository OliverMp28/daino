// Perfil de velocidad del mundo — velocidad por tramos y distancia recorrida (Ola 5).
//
// Hasta la Ola 4 la velocidad de scroll era una constante por nivel. La Ola 5 la
// hace variar con la ESTRUCTURA de la canción (un estribillo corre más que una
// estrofa, el clímax es lo más rápido): el equivalente musical de los portales
// de velocidad de Geometry Dash y de la aceleración del Daino legacy, pero
// anclado a la música en lugar de a los puntos.
//
// La sincronía de la Ola 3 no se toca. La posición de un obstáculo sigue siendo
// una FUNCIÓN del tiempo de canción; solo cambia "velocidad × tiempo" por la
// distancia que el mundo recorre entre dos instantes:
//
//     x = DINO_CENTER_X + (D(cruce) − D(ahora)) − w/2
//
// Como D es continua y creciente, un obstáculo nunca salta de sitio al cambiar
// la velocidad y su centro sigue cruzando al Dino exactamente en su instante,
// sea cual sea el perfil. Con velocidad constante, D(b) − D(a) = (b − a) · v y
// todo es idéntico a la Ola 3.
//
// El perfil es una lista de nudos (instante, velocidad) con la velocidad lineal
// entre nudos: un cambio con `rampS = 0` es instantáneo (dos nudos en el mismo
// instante); con rampa, la velocidad sube o baja en línea recta. La distancia es
// la integral exacta (trapecios), sin pasos de integración que acumulen error.

/** Rango sensato de velocidades. Coincide con el de chartFormat.js. */
export const SPEED_LIMITS = Object.freeze({ min: 50, max: 2000 });

/** Rampa máxima admitida en un cambio de velocidad. */
export const MAX_RAMP_S = 10;

/**
 * @typedef {Object} SpeedChange
 * @property {number} t          Instante de canción en que empieza el cambio.
 * @property {number} speedPxS   Velocidad que se alcanza.
 * @property {number} [rampS=0]  Duración de la transición (0 = instantáneo).
 */

/**
 * @typedef {Object} SpeedProfile
 * @property {number} base        Velocidad al empezar.
 * @property {number} minSpeed
 * @property {number} maxSpeed
 * @property {boolean} constant   true si nunca cambia.
 * @property {(t: number) => number} speedAt
 * @property {(t: number) => number} distanceAt
 * @property {(a: number, b: number) => number} distanceBetween  D(b) − D(a).
 */

/**
 * @param {number} baseSpeedPxS
 * @param {SpeedChange[]} [changes]  En cualquier orden; se ordenan aquí.
 * @returns {SpeedProfile}
 */
export function createSpeedProfile(baseSpeedPxS, changes = []) {
    const base = baseSpeedPxS;
    const sorted = changes
        .filter((c) => Number.isFinite(c?.t) && Number.isFinite(c?.speedPxS))
        .map((c) => ({ t: c.t, speed: c.speedPxS, ramp: Math.max(0, Math.min(MAX_RAMP_S, c.rampS ?? 0)) }))
        .sort((a, b) => a.t - b.t);

    if (sorted.length === 0) {
        return {
            base,
            minSpeed: base,
            maxSpeed: base,
            constant: true,
            speedAt: () => base,
            distanceAt: (t) => t * base,
            distanceBetween: (a, b) => (b - a) * base,
        };
    }

    // Nudos (t, v) con velocidad lineal entre ellos. Una rampa que no termina
    // antes del siguiente cambio se corta en él, a la velocidad que llevaba.
    const kt = [0];
    const kv = [base];
    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        const start = Math.max(c.t, kt[kt.length - 1]);
        const from = valueAt(kt, kv, start);
        kt.push(start);
        kv.push(from);
        const nextT = i + 1 < sorted.length ? sorted[i + 1].t : Infinity;
        const end = start + c.ramp;
        if (end <= nextT) {
            kt.push(end);
            kv.push(c.speed);
        } else {
            const k = (nextT - start) / c.ramp;
            kt.push(nextT);
            kv.push(from + (c.speed - from) * k);
        }
    }

    // Distancia acumulada en cada nudo (integral por trapecios, exacta aquí).
    const kd = new Array(kt.length);
    kd[0] = 0;
    for (let i = 1; i < kt.length; i++) {
        kd[i] = kd[i - 1] + (kt[i] - kt[i - 1]) * (kv[i] + kv[i - 1]) / 2;
    }

    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    for (const v of kv) {
        minSpeed = Math.min(minSpeed, v);
        maxSpeed = Math.max(maxSpeed, v);
    }

    /** Índice del último nudo con t_k ≤ t (con nudos repetidos, el último). */
    function knotBefore(t) {
        let lo = 0;
        let hi = kt.length - 1;
        if (t < kt[0]) return -1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (kt[mid] <= t) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function speedAt(t) {
        const k = knotBefore(t);
        if (k < 0) return kv[0];
        if (k === kt.length - 1) return kv[k];
        const span = kt[k + 1] - kt[k];
        return span > 0 ? kv[k] + (kv[k + 1] - kv[k]) * ((t - kt[k]) / span) : kv[k + 1];
    }

    function distanceAt(t) {
        const k = knotBefore(t);
        if (k < 0) return (t - kt[0]) * kv[0];
        const v = speedAt(t);
        return kd[k] + (t - kt[k]) * (kv[k] + v) / 2;
    }

    return {
        base,
        minSpeed,
        maxSpeed,
        constant: false,
        speedAt,
        distanceAt,
        distanceBetween: (a, b) => distanceAt(b) - distanceAt(a),
    };
}

/**
 * Perfil de un chart: velocidad base y cambios de `world`. Acepta charts de
 * formato 1 (sin cambios) y 2.
 *
 * @param {{ world: { speedPxS: number, speedChanges?: SpeedChange[] } }} chart
 * @returns {SpeedProfile}
 */
export function speedProfileOf(chart) {
    return createSpeedProfile(chart.world.speedPxS, chart.world.speedChanges ?? []);
}

/**
 * Admite un número (velocidad constante, API de la Ola 3) o un perfil.
 *
 * @param {number | SpeedProfile} speed
 * @returns {SpeedProfile}
 */
export function asSpeedProfile(speed) {
    return typeof speed === 'number' ? createSpeedProfile(speed) : speed;
}

function valueAt(kt, kv, t) {
    let k = kt.length - 1;
    while (k > 0 && kt[k] > t) k--;
    if (k === kt.length - 1) return kv[k];
    const span = kt[k + 1] - kt[k];
    return span > 0 ? kv[k] + (kv[k + 1] - kv[k]) * ((t - kt[k]) / span) : kv[k + 1];
}
