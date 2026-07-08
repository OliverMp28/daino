// Vertex shader para el Filter custom de PixiJS v8.
// Base: ejemplo oficial pixijs.com/8.x/guides/components/filters — los
// uniforms uInputSize, uOutputFrame, uOutputTexture los inyecta Pixi
// automáticamente y son la única forma correcta de mapear el filterArea al
// quad del filtro.
//
// Añadido Jul 2026: `vFrameCoord` — uv normalizado [0,1] SOBRE EL FRAME
// VISIBLE. `vTextureCoord` normaliza sobre la textura del pool (más grande
// que la pantalla), así que su "1.0" cae fuera del viewport; todo efecto
// anclado a bordes/posiciones de pantalla (sol, horizonte, vignette) debe
// usar vFrameCoord. aPosition ya es el quad [0,1] del frame — passthrough.

in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFrameCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord() {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vFrameCoord = aPosition;
}
