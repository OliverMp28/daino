// Background shader audio-reactivo de Daino — v2 (rediseño visual Jul 2026).
//
// Capa 1 del z-stack visual (doc 06 §3): cubre el 100% del viewport, debajo
// del scenery pixel-art, del gameplay y del HUD. Estética synthwave: cielo
// oscuro con estrellas, sol de rejilla sobre el horizonte que late al beat,
// glow de horizonte alimentado por los graves y espectro FFT que sube desde
// el suelo. En idle (menú) la escena respira sola con uTime — nunca "nada".
//
// Recibe FFT como textura 256x1 (sampler2D uFFT), no como uniforms
// individuales — saturaría el bus uniform (doc 07 §D.2, doc 09 §2.4).
//
// Uniforms agrupados en `audioUniforms` (Pixi v8 los compila a un UBO):
//   uShaderMode — 0=idle (menú), 1=reactive (partida con audio). En idle el
//                 shader NO LEE los uniforms de audio: escena base + respiración.
//   uTime      — segundos de reloj global; siempre avanza, también en idle.
//   uRMS/uBass/uMid/uHigh — energía por bandas [0,1].
//   uBpmPulse  — exp-decay [0,1] re-disparado en cada beat (lo calcula
//                GameSession desde el BPM detectado + audioTime).
//   uHorizon   — Y del horizonte en uv (v=0 arriba). Derivada de
//                GROUND_OFFSET_PX; el sol, el glow y las barras FFT se anclan
//                aquí para casar con la línea del suelo pixel-art del scenery.

in vec2 vTextureCoord; // uv sobre la TEXTURA del pool (¡su 1.0 cae fuera de pantalla!)
in vec2 vFrameCoord;   // uv [0,1] sobre el FRAME VISIBLE — usar este para
                       // todo lo anclado a pantalla (sol, horizonte, vignette).
                       // Lo emite background.vert (descubrimiento Jul 2026:
                       // el shader v1 anclaba a vTextureCoord y los efectos
                       // cercanos a uv=1 quedaban fuera del viewport).
out vec4 finalColor;

uniform sampler2D uTexture; // input del filtro (lo inyecta Pixi). Lo ignoramos
                            // a propósito: pintamos el fondo desde cero.
uniform sampler2D uFFT;     // textura 256x1, formato r8unorm.

uniform float uShaderMode;  // 0=idle, 1=reactive
uniform float uTime;
uniform float uRMS;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBpmPulse;
uniform float uDebugMode;   // 0=normal, 1=fft crudo, 2=uv coords, 3=uniforms
uniform float uHorizon;

// Paleta — espejo de los tokens de @theme en main.css y de PALETTE en
// assets/pixelart.js (mantener sincronizados).
const vec3 COLOR_BG_DEEP   = vec3(0.020, 0.022, 0.048);
const vec3 COLOR_BG_LIFTED = vec3(0.105, 0.070, 0.180);
const vec3 COLOR_BEAT      = vec3(0.880, 0.220, 0.380);
const vec3 COLOR_HIGH      = vec3(0.560, 0.880, 1.000);

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main(void) {
    // uv en [0,1] SOBRE EL FRAME VISIBLE (no sobre la textura del pool).
    vec2 uv = vFrameCoord;

    // ---------- MODOS DEBUG (activables con ?debug=N en la URL) ----------
    // Mode 1 — sample crudo del uFFT como rojo (diagnóstico de textura).
    if (uDebugMode > 0.5 && uDebugMode < 1.5) {
        float bin = texture(uFFT, vec2(uv.x, 0.5)).r;
        finalColor = vec4(bin, bin * 0.4, 0.0, 1.0);
        return;
    }
    // Mode 2 — uv.x rojo, uv.y verde (orientación de coordenadas).
    if (uDebugMode > 1.5 && uDebugMode < 2.5) {
        finalColor = vec4(uv.x, uv.y, 0.0, 1.0);
        return;
    }
    // Mode 3 — uniforms escalares como bandas verticales.
    if (uDebugMode > 2.5) {
        float v = 0.0;
        if      (uv.x < 0.2) v = mod(uTime, 1.0);
        else if (uv.x < 0.4) v = uRMS;
        else if (uv.x < 0.6) v = uBass;
        else if (uv.x < 0.8) v = uMid;
        else                 v = uHigh;
        finalColor = vec4(v, v * 0.5, 1.0 - v, 1.0);
        return;
    }
    // ---------- /DEBUG ----------

    // Valores reactivos, forzados a 0 en idle — así la escena base jamás
    // depende de uniforms de audio cuando no hay partida (invariante Bloque 6).
    float reactive = step(0.5, uShaderMode);
    float pulse = uBpmPulse * reactive;
    float bass  = uBass * reactive;
    float mid   = uMid * reactive;
    float high  = uHigh * reactive;
    float rms   = uRMS * reactive;

    // ---------- Cielo ----------
    // Muy oscuro arriba, levantándose hacia el horizonte (atardecer synth).
    float toHorizon = smoothstep(0.05, uHorizon, uv.y);
    vec3 col = mix(COLOR_BG_DEEP, COLOR_BG_LIFTED, toHorizon * toHorizon);

    // ---------- Estrellas ----------
    // Grid-hash barato. Titilan con uTime; los agudos las excitan en partida.
    if (uv.y < uHorizon - 0.02) {
        vec2 cell = floor(uv * vec2(220.0, 130.0));
        float n = hash21(cell);
        float star = smoothstep(0.9972, 1.0, n);
        float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * fract(n * 7.31)) + n * 41.0);
        col += vec3(0.85, 0.92, 1.0) * star * tw * (0.35 + high * 0.9);
    }

    // ---------- Sol synthwave ----------
    // Disco con degradado beat→cian y rendijas horizontales en la mitad baja.
    // Late con el beat en partida; en idle respira lento con uTime.
    vec2 sunPos = vec2(0.76, uHorizon - 0.30);
    float breathe = 0.5 + 0.5 * sin(uTime * 0.6);
    float sunR = 0.095 + pulse * 0.018 + (1.0 - reactive) * breathe * 0.005;
    float d = distance(uv, sunPos);
    // OJO: smoothstep exige edge0 < edge1 (edges invertidos = undefined en
    // GLSL — en ANGLE/D3D devuelve 0 y el disco desaparece). Invertimos con 1-.
    float disc = 1.0 - smoothstep(sunR - 0.008, sunR, d);
    // Rendijas: solo por debajo del centro del sol, más densas hacia abajo.
    float below = step(sunPos.y, uv.y);
    float slit = 1.0 - below * smoothstep(0.32, 0.5, abs(fract((uv.y - sunPos.y) * 70.0) - 0.5));
    vec3 sunCol = mix(COLOR_HIGH, COLOR_BEAT, smoothstep(sunPos.y - sunR, sunPos.y + sunR, uv.y));
    col = mix(col, sunCol, disc * slit * 0.9);
    // Halo del sol — en partida lo hinchan los graves.
    col += COLOR_BEAT * exp(-d * 9.0) * (0.10 + 0.05 * breathe + bass * 0.22 + pulse * 0.10);

    // ---------- Glow del horizonte ----------
    float hd = abs(uv.y - uHorizon);
    float horizonGlow = exp(-hd * 26.0);
    col += COLOR_BEAT * horizonGlow * (0.10 + 0.06 * breathe + bass * 0.55 + pulse * 0.30);
    col += COLOR_HIGH * exp(-hd * 60.0) * (0.06 + high * 0.35);

    // ---------- Ondas senoidales tenues (idle y reactive) ----------
    float wave = sin(uv.x * 14.0 + uTime * 1.1) * 0.5 + 0.5;
    wave += sin(uv.y * 22.0 - uTime * 0.6) * 0.25;
    col += vec3(wave) * (0.018 + mid * 0.10 + rms * 0.06);

    // ---------- Espectro FFT subiendo desde el horizonte (solo partida) ----------
    if (uShaderMode > 0.5 && uv.y < uHorizon) {
        float bin = texture(uFFT, vec2(uv.x, 0.5)).r;
        float h = bin * bin * 0.30;              // ² para que el silencio sea plano
        float top = uHorizon - h;
        if (uv.y > top && h > 0.002) {
            float t = (uHorizon - uv.y) / max(h, 1e-4);   // 0 en la base, 1 en la punta
            vec3 barCol = mix(COLOR_BEAT, COLOR_HIGH, uv.x);
            col += barCol * (0.10 + (1.0 - t) * 0.45);
        }
    }

    // ---------- Flash global al beat ----------
    col *= 1.0 + pulse * 0.10;

    // Vignette suave para dar foco al gameplay (capa 3 vive encima).
    float dx = uv.x - 0.5;
    float dy = uv.y - 0.5;
    float vignette = 1.0 - smoothstep(0.4, 0.95, sqrt(dx * dx + dy * dy));
    col *= mix(0.72, 1.0, vignette);

    finalColor = vec4(col, 1.0);
}
