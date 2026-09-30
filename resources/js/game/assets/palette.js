// Paleta global del pixel art. Cada carácter de los sprites de pixelart.js es un
// color de aquí ('.' = transparente).
//
// Vive aparte de pixelart.js (que importa Pixi) para que el guardián de
// legibilidad del escenario (scenes/readability.js) mida los mismos colores
// que se dibujan, en Node y sin Pixi.
//
// Sincronía: P/C espejan COLOR_BEAT/COLOR_HIGH de background.frag.

export const PALETTE = Object.freeze({
    // Dino
    W: '#f2f5ff', // cuerpo — blanco frío que destaca sobre el fondo oscuro
    w: '#b9c6ea', // panza/sombra — periwinkle suave
    K: '#0d0f1c', // ojo / detalles oscuros
    C: '#7fe6ff', // púas del lomo — cian (COLOR_HIGH)
    // Cactus
    G: '#3ddc84', // cuerpo cactus — verde neón (guiño al verde del legacy)
    g: '#1f9e58', // sombra cactus
    L: '#b6ffd9', // brillo/espina
    // Ptero
    P: '#ff5d7e', // cuerpo ptero — rosa beat (COLOR_BEAT): peligro aéreo
    p: '#c73a5c', // sombra ptero
    // Suelo
    E: '#8b9aff', // línea de borde superior — periwinkle brillante
    D: '#12152e', // relleno tierra
    s: '#333b66', // motas
    // Arena de la Costa (T02.2): el mismo papel que el suelo (oscuro, el fondo de
    // contraste de lo que se juega) en tonos de arena mojada; la hora la tiñe.
    A: '#ffd9a0', // línea de la orilla
    a: '#221a2c', // arena mojada
    b: '#5c4a5e', // conchas y guijarros
    // Nube (T01): en claros, porque la hora la tiñe (Sprite.tint). El cuerpo
    // es blanco y su sombra un gris azulado: de día queda blanca con volumen, al
    // atardecer toma el color del cielo y de noche es una silueta.
    n: '#ffffff', // cuerpo de la nube
    N: '#c9d0e6', // sombra inferior de la nube
    // Antigravedad (Ola 6): cristales y techo en el violeta del modo (MODE_COLORS.flip)
    V: '#c08bff', // cristal
    v: '#7d4fd6', // sombra cristal
    Y: '#f3e6ff', // brillo cristal
    H: '#ffd6e2', // brillo del cristal afilado (acento: el rosa del ptero, peligro)
    U: '#b58cff', // línea del techo
    // Vuelo (Ola 6b): techo en el oro del modo (MODE_COLORS.fly)
    F: '#ffd166', // línea del techo
    // Orbe de doble salto (Ola 6c): naranja, un color que no usa ningún portal
    // ni obstáculo (los portales son cian, violeta y oro; el peligro, rosa).
    R: '#ffb057', // borde del orbe y chevrón encendido
    r: '#ff6f2c', // cuerpo del orbe y chevrón apagado
    Q: '#ffffff', // brillo
    // Mochila propulsora del modo vuelo (Ola 6c): acero oscuro con la franja del
    // oro del modo (F); la llama usa Q · F · R · r. Los skins no la tocan.
    M: '#8e9ad6', // borde de la mochila
    m: '#3d4577', // cuerpo de la mochila y correa
    k: '#171a30', // tobera
    // Portal: en grises para teñirlo con el color de cada modo (Sprite.tint)
    O: '#ffffff', // aro
    o: '#a6a6a6', // aro interior
    q: '#5c5c5c', // destellos del interior
});
