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
//
// Ola 5 — la estructura de la canción, no solo su volumen:
//   uIntensity — [0,1] intensidad del tramo (calma … clímax), suavizada. Aviva
//                el glow del horizonte, el halo del sol, el ecualizador y el
//                destello de cada beat.
//   uProgress  — [0,1] cuánto va de canción. EL SOL SE PONE con ella: empieza
//                alto y al final toca el horizonte mientras el cielo se
//                oscurece y salen más estrellas. El final se ve llegar.
//   uClimax    — [0,1] el clímax: tinte del cielo y ecualizador encendidos.
//   uFlash     — [0,1] destello de un drop, decae en unas décimas.
//
// Ola 6c — los efectos del plan del charter (levels/fxPlan.js, systems/songDirector.js):
//   uBuild     — [0,1] la subida hacia un drop: el horizonte y el halo del sol se
//                cargan y cada beat pega más fuerte hasta el golpe.
//   uCalm      — [0,1] un break: el color se apaga y se enfría (el mundo contiene
//                la respiración) hasta que vuelve la música.
//   uHue       — vueltas de color del cielo por los cambios de tonalidad: el rosa
//                del beat y el cian de los agudos giran juntos.

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
uniform vec2  uFrame;       // tamaño del frame en px CSS
uniform float uCell;        // px CSS por celda del arte (vista del mundo)
uniform float uIntensity;
uniform float uProgress;
uniform float uClimax;
uniform float uFlash;
uniform float uBuild;
uniform float uCalm;
uniform float uHue;

// Paleta — espejo de los tokens de @theme en main.css y de PALETTE en
// assets/pixelart.js (mantener sincronizados).
const vec3 COLOR_BG_DEEP   = vec3(0.020, 0.022, 0.048);
const vec3 COLOR_BG_LIFTED = vec3(0.105, 0.070, 0.180);
const vec3 COLOR_BEAT      = vec3(0.880, 0.220, 0.380);
const vec3 COLOR_HIGH      = vec3(0.560, 0.880, 1.000);

// Gira un color alrededor del eje gris (conserva su brillo). a en radianes.
vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

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
    // Estructura (Ola 5). En idle todo a 0: el menú se ve como siempre.
    float intensity = uIntensity * reactive;
    float progress  = clamp(uProgress, 0.0, 1.0) * reactive;
    float climax    = uClimax * reactive;
    float flash     = uFlash * reactive;
    // Efectos del plan (Ola 6c). En idle, 0: el menú tiene sus colores de siempre.
    float build = uBuild * reactive;
    float calm  = uCalm * reactive;
    vec3 beatCol = hueShift(COLOR_BEAT, uHue * reactive * 6.2831853);
    vec3 highCol = hueShift(COLOR_HIGH, uHue * reactive * 6.2831853);
    // El atardecer avanza despacio al principio y se acelera hacia el final.
    float dusk = progress * progress * (3.0 - 2.0 * progress);

    // ---------- Cielo ----------
    // Muy oscuro arriba, levantándose hacia el horizonte (atardecer synth).
    // Con la canción avanzando, la franja clara se estrecha y se calienta: se
    // hace de noche por arriba mientras el horizonte arde.
    float toHorizon = smoothstep(0.05 + 0.25 * dusk, uHorizon, uv.y);
    vec3 lifted = mix(COLOR_BG_LIFTED, vec3(0.20, 0.06, 0.16), dusk * 0.6);
    vec3 col = mix(COLOR_BG_DEEP * (1.0 - 0.35 * dusk), lifted, toHorizon * toHorizon);
    // Tinte del clímax, más fuerte arriba y latiendo con el beat.
    col += beatCol * climax * (0.035 + 0.05 * pulse) * (1.0 - toHorizon);

    // ---------- Estrellas ----------
    // Grid-hash barato. Titilan con uTime; los agudos las excitan en partida.
    // Salen más cuanto más de noche.
    // Tamaños de pantalla (Sep 2026): antes la rejilla era de 220 × 130 celdas
    // sobre la pantalla, así que una estrella medía lo que una celda (17 px en
    // un 4K, rectangular en un móvil vertical). Ahora la rejilla es cuadrada, del
    // alto de la pantalla, y cada estrella es UNA celda del arte en su centro:
    // el mismo cielo en cualquier formato, a juego con el pixel art.
    vec2 px = uv * uFrame;
    float starCell = max(uCell * 1.25, uFrame.y / 130.0);
    if (uv.y < uHorizon - 0.02) {
        vec2 cell = floor(px / starCell);
        vec2 inCell = abs(px - (cell + 0.5) * starCell);
        float pix = step(max(inCell.x, inCell.y), uCell * 0.5 + 0.5);
        float n = hash21(cell);
        float star = smoothstep(0.9972 - 0.0012 * dusk, 1.0, n) * pix;
        float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * fract(n * 7.31)) + n * 41.0);
        col += vec3(0.85, 0.92, 1.0) * star * tw * (0.35 + high * 0.9) * (1.0 + 0.9 * dusk);
    }

    // ---------- Sol synthwave ----------
    // Disco con degradado beat→cian y rendijas horizontales en la mitad baja.
    // Late con el beat en partida; en idle respira lento con uTime. Baja hacia
    // el horizonte con la canción y crece un poco (los soles al ponerse
    // parecen más grandes); lo que queda bajo el horizonte no se pinta.
    //
    // Tamaños de pantalla (Sep 2026): antes la distancia se medía en uv, que se
    // estira con la pantalla, y el sol era un óvalo ancho en 16:9 y una píldora
    // en un móvil vertical. Ahora se mide en px y en unidades de `sunUnit` (el
    // alto de la pantalla, sin pasar de 0.62 del ancho): siempre es un círculo.
    vec2 sunPos = vec2(0.76, uHorizon - 0.30 + 0.27 * dusk);
    float breathe = 0.5 + 0.5 * sin(uTime * 0.6);
    float sunR = 0.105 + 0.022 * dusk + pulse * (0.013 + 0.013 * intensity) + (1.0 - reactive) * breathe * 0.0055;
    float sunUnit = min(uFrame.y, uFrame.x * 0.62);
    vec2 toSun = (uv - sunPos) * uFrame / sunUnit;
    float d = length(toSun);
    float sunRy = sunR * sunUnit / uFrame.y;   // radio del sol en uv verticales (rendijas y degradado)
    // OJO: smoothstep exige edge0 < edge1 (edges invertidos = undefined en
    // GLSL — en ANGLE/D3D devuelve 0 y el disco desaparece). Invertimos con 1-.
    float disc = (1.0 - smoothstep(sunR - 0.008, sunR, d)) * (1.0 - step(uHorizon, uv.y));
    // Rendijas: solo por debajo del centro del sol, más densas hacia abajo.
    float below = step(sunPos.y, uv.y);
    float slit = 1.0 - below * smoothstep(0.32, 0.5, abs(fract((uv.y - sunPos.y) / sunRy * 6.6) - 0.5));
    vec3 sunCol = mix(highCol, beatCol, smoothstep(sunPos.y - sunRy, sunPos.y + sunRy, uv.y));
    col = mix(col, sunCol, disc * slit * 0.9);
    // Halo del sol — en partida lo hinchan los graves, la intensidad y los drops.
    col += beatCol * exp(-d * 9.0) * (0.10 + 0.05 * breathe + bass * 0.22 + pulse * (0.06 + 0.10 * intensity) + 0.12 * dusk + 0.25 * flash);

    // ---------- Glow del horizonte ----------
    float hd = abs(uv.y - uHorizon);
    float horizonGlow = exp(-hd * (26.0 - 8.0 * intensity));
    col += beatCol * horizonGlow * (0.10 + 0.06 * breathe + bass * 0.55 + pulse * (0.15 + 0.30 * intensity + 0.35 * build) + 0.10 * dusk + 0.45 * flash + 0.30 * build);
    col += highCol * exp(-hd * 60.0) * (0.06 + high * 0.35 + 0.25 * flash);

    // ---------- Ondas senoidales tenues (idle y reactive) ----------
    float wave = sin(uv.x * 14.0 + uTime * 1.1) * 0.5 + 0.5;
    wave += sin(uv.y * 22.0 - uTime * 0.6) * 0.25;
    col += vec3(wave) * (0.018 + mid * 0.10 + rms * 0.06);

    // ---------- Ecualizador pixel desde el horizonte (solo partida) ----------
    // v1 pintaba el espectro bin-a-bin: el ruido entre bins vecinos formaba
    // un "peine" de púas con bordes claros y centros oscuros que ensuciaba
    // el horizonte (feedback user Jul 2026). v2: barras DISCRETAS con hueco
    // entre ellas, 3 taps promediados por barra, altura contenida y alpha
    // que se desvanece hacia la punta — lee como un EQ retro intencional.
    if (uShaderMode > 0.5 && uv.y < uHorizon) {
        const float BARS = 40.0;
        float slot = floor(uv.x * BARS);
        float cx = (slot + 0.5) / BARS;
        float b0 = texture(uFFT, vec2(cx, 0.5)).r;
        float b1 = texture(uFFT, vec2(cx - 1.0 / BARS, 0.5)).r;
        float b2 = texture(uFFT, vec2(cx + 1.0 / BARS, 0.5)).r;
        float bin = (b0 * 2.0 + b1 + b2) * 0.25;
        // ² para que el silencio sea plano; más alto cuanto más empuja el tramo.
        float h = bin * bin * (0.11 + 0.09 * intensity);
        float top = uHorizon - h;
        float gap = step(fract(uv.x * BARS), 0.68);   // 68% barra, 32% hueco
        if (uv.y > top && h > 0.004) {
            float t = (uHorizon - uv.y) / max(h, 1e-4);   // 0 en la base, 1 en la punta
            vec3 barCol = mix(mix(beatCol, highCol, cx), beatCol, climax * 0.5);
            col += barCol * gap * (1.0 - t) * (0.12 + 0.10 * intensity + bass * 0.10);
        }
    }

    // ---------- Flash global al beat y destello de drop ----------
    col *= 1.0 + pulse * (0.05 + 0.10 * intensity + 0.12 * build);
    col += highCol * flash * 0.10;

    // Break: el color se apaga hacia un gris frío, sin llegar a negro.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(luma) * vec3(0.78, 0.84, 1.0), 0.6 * calm) * (1.0 - 0.22 * calm);

    // Vignette suave para dar foco al gameplay (capa 3 vive encima).
    float dx = uv.x - 0.5;
    float dy = uv.y - 0.5;
    float vignette = 1.0 - smoothstep(0.4, 0.95, sqrt(dx * dx + dy * dy));
    col *= mix(0.72, 1.0, vignette);

    finalColor = vec4(col, 1.0);
}
