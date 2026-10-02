// Limitador de la franja jugable (T03.1, doc 11).
//
// El Dino, los obstáculos y los portales son colores neón sin contorno: se leen
// porque lo que tienen detrás es oscuro (scenes/readability.js). El cielo de cada
// hora ya pasa ese guardián; los efectos son luz que se suma encima, y sin tope
// lo borrarían (medido: de día el cielo de la franja jugable ya está en el límite,
// 0.075-0.095 de luminancia frente a un máximo de 0.092 para el ptero).
//
// En vez de vigilar la fórmula de cada efecto, todos pasan por un limitador, como
// en audio: dentro de la franja jugable, la luz de los efectos nunca sube el fondo
// por encima de un techo. Si el cielo ya está en el techo (de día), ahí los efectos
// no se ven; cuando oscurece, hay sitio. Las luces se ven cuando cae la noche.
//
// La luminancia se mide con un sustituto barato, sin potencias: Σ w·c² sobre el
// color sRGB. Queda siempre por encima de la luminancia real en el rango que
// importa (c² ≥ la curva sRGB para c ≥ 0.1), así que limitar el sustituto limita
// la real, con margen. Es convexo: mezclar hacia el fondo nunca se pasa del techo.
//
// La misma fórmula vive en el shader (`fxLimit`, background.frag) y aquí, para
// los tests. Las capas Pixi que pintan luz en la franja (las barras del espectro)
// usan `capColor`: un color ya bajado al techo, pintado con mezcla normal.
//
// Puro.

export const FX_LIMIT = Object.freeze({
    /**
     * Techo del sustituto de luminancia en la franja jugable. El fondo más claro
     * que aún deja leer lo que se juega tiene luminancia real 0.092 (el ptero y
     * los cristales afilados, a 2.5:1; lo comprueba un test): 0.085 del sustituto
     * son ≤ 0.072 reales.
     */
    cap: 0.085,
    /** Hasta dónde llega la franja jugable sobre el suelo (la cabeza del Dino en un doble salto). */
    playTopPx: 364,
    /** Por encima, el limitador se va soltando en esta distancia: sin costura a la vista. */
    softPx: 56,
});

const W = [0.2126, 0.7152, 0.0722];

/** Sustituto de la luminancia de un color sRGB [0,1]: Σ w·c². */
export function proxyLuma(c) {
    return W[0] * c[0] * c[0] + W[1] * c[1] * c[1] + W[2] * c[2] * c[2];
}

/**
 * El color con efectos, limitado: no más claro que el techo (o que el propio
 * fondo, si ya lo pasaba). `weight` [0,1] es cuánto actúa (1 dentro de la franja
 * jugable, 0 por encima).
 *
 * @param {ArrayLike<number>} base  Lo que hay sin efectos.
 * @param {ArrayLike<number>} lit   Lo que habría con ellos.
 * @param {number[]} out
 * @param {number} [weight]
 * @param {number} [cap]
 */
export function limitFx(base, lit, out, weight = 1, cap = FX_LIMIT.cap) {
    const lb = proxyLuma(base);
    const ll = proxyLuma(lit);
    const target = Math.max(lb, cap);
    // Si con el efecto no se pasa del techo (o el efecto oscurece), entero.
    const k = ll <= target ? 1 : (target - lb) / (ll - lb);
    // Dentro de la franja: mezcla hacia el fondo; fuera, el color tal cual.
    const m = 1 - weight * (1 - k);
    for (let i = 0; i < 3; i++) out[i] = base[i] + (lit[i] - base[i]) * m;
    return out;
}

/**
 * Cuánto actúa el limitador a una altura sobre el suelo (unidades de mundo): 1 en
 * la franja jugable, 0 pasado el fundido.
 */
export function limiterWeight(heightPx, rules = FX_LIMIT) {
    const x = (heightPx - rules.playTopPx) / rules.softPx;
    const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
    return 1 - t * t * (3 - 2 * t);
}

/**
 * Un color de efecto bajado hasta el techo (mismo tono, menos brillo), para las
 * capas Pixi que pintan luz DENTRO de la franja jugable (las barras del espectro).
 *
 * Pintado con mezcla normal (no aditiva) sobre lo que haya, con cualquier
 * opacidad, el resultado queda entre el fondo y este color: nunca más claro que
 * el techo (o que el propio fondo). No hace falta saber qué hay debajo ni qué han
 * sumado ya los efectos del cielo: es seguro por construcción.
 *
 * @param {ArrayLike<number>} color
 * @param {number[]} out
 * @param {number} [cap]
 */
export function capColor(color, out, cap = FX_LIMIT.cap) {
    const p = proxyLuma(color);
    const s = p > cap ? Math.sqrt(cap / p) : 1;
    for (let i = 0; i < 3; i++) out[i] = color[i] * s;
    return out;
}
