// Tiras tileables ancladas al mundo (Ola 6b).
//
// Un techo de pasillo, un muro… es una tira con textura repetida que empieza y
// acaba en dos distancias del mundo. Solo se dibuja la parte visible, así que
// la tira se RECORTA a la pantalla; y al recortarla por la izquierda la textura
// debe desplazarse lo mismo que el mundo, o el dibujo resbala sobre la tira
// como una cinta de correr (defecto del techo de la antigravedad en la Ola 6a:
// el desplazamiento tenía el signo cambiado y el techo corría hacia el lado
// contrario, al doble de velocidad aparente).
//
// Convención de Pixi (TilingSprite): el píxel local `p` muestra la textura en
// `p − tilePosition.x`. Para que un punto del mundo `x` muestre siempre la
// misma parte de la textura, `(x − stripX) − tileX` debe valer `x − x0` (x0 =
// inicio de la tira): `tileX = x0 − stripX`.
//
// Puro, sin Pixi: se prueba en Node.

/**
 * @param {number} x0         Inicio de la tira en pantalla (unidades de mundo).
 * @param {number} x1         Fin de la tira.
 * @param {number} left       Borde izquierdo de lo que se dibuja.
 * @param {number} right      Borde derecho.
 * @param {number} tileWidth  Ancho de una repetición de la textura (unidades de mundo).
 * @returns {{ x: number, width: number, tileX: number } | null}  null si no se ve.
 */
export function clipTiledStrip(x0, x1, left, right, tileWidth) {
    const a = Math.max(x0, left);
    const b = Math.min(x1, right);
    if (!(b - a >= 1)) return null;
    // Módulo positivo: el desplazamiento se queda en [0, tileWidth).
    const tileX = (((x0 - a) % tileWidth) + tileWidth) % tileWidth;
    return { x: a, width: b - a, tileX };
}
