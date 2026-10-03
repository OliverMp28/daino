// Vertex del shader del cielo (T05.1). Lo que se pinta es una BANDA del búfer del
// cielo (shaders/skyBuffer.js): un rectángulo que la llena.
//
// `aPosition` recorre [0,1] sobre la banda. Sin voltear: en una textura de
// render la fila 0 es la de arriba, y es la que queda en y = −1.
//
// `uFrameRect` dice qué trozo de la PANTALLA es esa banda (xy: la uv de su
// esquina; zw: lo que abarca). El búfer mide un número entero de texeles, así que
// sobra una fracción de texel por la derecha y por abajo de la pantalla: ahí la
// uv pasa de 1. Con eso un texel mide exactamente celda/N y las celdas que dibuja
// el fragment caen en fronteras de texel (systems/skyGrid.js).

in vec2 aPosition;
out vec2 vFrameCoord;

uniform vec4 uFrameRect;

void main(void) {
    gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
    vFrameCoord = uFrameRect.xy + aPosition * uFrameRect.zw;
}
