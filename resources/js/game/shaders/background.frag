// Fondo de Daino — v3 (T01): el CIELO DEL ESCENARIO con los
// efectos de la música encima.
//
// Capa 1 del z-stack visual (doc 06 §3): cubre el 100% del viewport, debajo del
// escenario pixel art, del gameplay y del HUD.
//
// Dos familias de uniforms, que no se mezclan (doc 11 §2.4):
//
//   ESCENARIO (skyUniforms) — lo que existe aunque no suene nada. Depende de la
//   hora del cielo, nunca del audio. Lo calcula scenes/skyModel.js a partir de la
//   paleta (scenes/palettes.js) y el engine lo sube cada frame:
//     uSkyTop/Mid/Horizon  degradado del cielo (forma: SKY_SHAPE de skyModel.js)
//     uHaze                neblina del horizonte (rgb + cantidad)
//     uSunPos/Radius/Core/Edge/Slits/Glow/Halo   el sol: blanco-dorado de día,
//                          disco synthwave con rendijas en el ocaso
//     uMoonPos/Radius/Color  la luna (rgb + alpha), pixelada como las estrellas
//     uStarVis/Rot         cielo estrellado y su giro (el paso del tiempo)
//     uLucero              lucero de la tarde/alba (x, y, alpha, tamaño)
//     uNight               [0,1] noche cerrada (estrellas fugaces)
//     uVignette            oscurecimiento de las esquinas
//     uShow0/uShow1        interruptores del panel dev (1 = se ve):
//                          sol, halo del sol, luna, estrellas | lucero,
//                          estrellas fugaces, neblina, (libre)
//   Las posiciones del sol, la luna y el lucero llegan en FRACCIÓN DEL CIELO:
//   y = 0 arriba, 1 en el horizonte (uHorizon las pasa a uv).
//
//   EFECTOS (audioUniforms) — lo que reacciona a la música: FFT (uFFT), bandas,
//   pulso del beat y la estructura de la canción (Olas 5 y 6c). En idle (menú)
//   uShaderMode = 0 y el shader no los lee. Los registrará la T03.1.
//
// Recibe el FFT como textura 256x1 (sampler2D uFFT), no como uniforms
// individuales — saturaría el bus uniform (doc 07 §D.2, doc 09 §2.4).

in vec2 vTextureCoord; // uv sobre la TEXTURA del pool (¡su 1.0 cae fuera de pantalla!)
in vec2 vFrameCoord;   // uv [0,1] sobre el FRAME VISIBLE — usar este para todo
                       // lo anclado a pantalla (lo emite background.vert).
out vec4 finalColor;

uniform sampler2D uTexture; // input del filtro (lo inyecta Pixi). Lo ignoramos
                            // a propósito: pintamos el fondo desde cero.
uniform sampler2D uFFT;     // textura 256x1, formato r8unorm.

// ---- Efectos (audioUniforms) ----
uniform float uShaderMode;  // 0=idle, 1=reactive
uniform float uTime;
uniform float uRMS;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBpmPulse;
uniform float uDebugMode;   // 0=normal, 1=fft crudo, 2=uv coords, 3=uniforms
uniform float uHorizon;     // horizonte del cielo (T02.2: la Costa lo sube hasta la línea del mar)
uniform float uGround;      // línea del suelo: donde se anclan los efectos
uniform vec2  uFrame;       // tamaño del frame en px CSS
uniform float uCell;        // px CSS por celda del arte (vista del mundo)
uniform float uIntensity;
uniform float uClimax;
uniform float uFlash;
uniform float uBuild;
uniform float uCalm;
uniform float uHue;

// ---- Escenario (skyUniforms) ----
uniform vec3  uSkyTop;
uniform vec3  uSkyMid;
uniform vec3  uSkyHorizon;
uniform vec4  uHaze;
uniform vec2  uSunPos;
uniform float uSunRadius;
uniform vec3  uSunCore;
uniform vec3  uSunEdge;
uniform float uSunSlits;
uniform vec4  uSunGlow;
uniform float uSunHalo;
uniform vec2  uMoonPos;
uniform float uMoonRadius;
uniform vec4  uMoonColor;
uniform float uStarVis;
uniform float uStarRot;
uniform vec4  uLucero;
uniform float uNight;
uniform float uVignette;
uniform vec4  uShow0;
uniform vec4  uShow1;

// Paleta de los efectos — espejo de los tokens de @theme en main.css y de
// assets/palette.js (P y C).
const vec3 COLOR_BEAT = vec3(0.880, 0.220, 0.380);
const vec3 COLOR_HIGH = vec3(0.560, 0.880, 1.000);

// Forma del degradado del cielo: SKY_SHAPE de scenes/skyModel.js (mismos números).
const float SKY_MID_AT = 0.5;
const float SKY_HAZE_K = 14.0;

// Gira un color alrededor del eje gris (conserva su brillo). a en radianes.
vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Ruido de valor suave (para los mares de la luna).
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Cráter: hundido oscuro con el borde de arriba-derecha iluminado (la luz viene
// de ahí). m y c en radios de la luna; r = radio del cráter.
vec2 crater(vec2 m, vec2 c, float r) {
    vec2 d = (m - c) / r;
    float l = length(d);
    float pit = 1.0 - step(0.78, l);
    float rim = step(0.78, l) * (1.0 - step(1.08, l)) * clamp(dot(normalize(d + 1e-4), vec2(0.6, -0.8)), 0.0, 1.0);
    return vec2(pit, rim);
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

    // Valores de los efectos, forzados a 0 en idle: el escenario jamás depende
    // de uniforms de audio cuando no hay partida (invariante Bloque 6).
    float reactive = step(0.5, uShaderMode);
    float pulse = uBpmPulse * reactive;
    float bass  = uBass * reactive;
    float high  = uHigh * reactive;
    float intensity = uIntensity * reactive;
    float climax    = uClimax * reactive;
    float flash     = uFlash * reactive;
    float build = uBuild * reactive;
    float calm  = uCalm * reactive;
    vec3 beatCol = hueShift(COLOR_BEAT, uHue * reactive * 6.2831853);
    vec3 highCol = hueShift(COLOR_HIGH, uHue * reactive * 6.2831853);

    vec2 px = uv * uFrame;
    // Unidad del sol y la luna: el alto de la pantalla (sin pasar de 0.62 del
    // ancho), medido en px — siempre son círculos, en cualquier formato.
    float sunUnit = min(uFrame.y, uFrame.x * 0.62);
    float yf = uv.y / uHorizon;          // fracción del cielo: 0 arriba, 1 horizonte
    float aboveHorizon = 1.0 - step(uHorizon, uv.y);

    // ================== ESCENARIO ==================

    // ---------- Cielo ----------
    vec3 col = mix(uSkyTop, uSkyMid, smoothstep(0.0, SKY_MID_AT, yf));
    float toH = smoothstep(SKY_MID_AT, 1.0, yf);
    col = mix(col, uSkyHorizon, toH * toH);
    // Neblina del horizonte: pegada al horizonte del cielo (en la Cordillera, la
    // línea del suelo, y las crestas tapan casi todo lo que queda por debajo de 40
    // unidades; en la Costa, la línea del mar, a la vista).
    col += uHaze.rgb * uHaze.a * exp(-(1.0 - min(yf, 1.0)) * SKY_HAZE_K) * uShow1.z;

    // (efecto) Tinte del clímax, más fuerte arriba y latiendo con el beat.
    col += beatCol * climax * (0.035 + 0.05 * pulse) * (1.0 - toH);

    // ---------- Estrellas ----------
    // Una estrella es UNA celda del arte, cuadrada, en una rejilla de 3 × 3 celdas
    // con su posición dentro al azar. La rejilla GIRA despacio alrededor de un polo
    // fuera de pantalla (arriba a la izquierda): el paso del tiempo de la noche.
    // Se gira el sitio de cada estrella, no la celda: siguen siendo cuadradas, y
    // en una celda de 3 × 3 una estrella nunca se sale de la suya al girar.
    // Salen de arriba abajo y las más brillantes primero.
    if (uStarVis > 0.001 && uShow0.w > 0.5 && uv.y < uHorizon - 0.02) {
        float starCell = uCell * 3.0;
        vec2 pivot = vec2(-0.25 * uFrame.x, -1.2 * uFrame.y);
        float cr = cos(uStarRot);
        float sr = sin(uStarRot);
        vec2 q = px - pivot;
        vec2 qs = vec2(cr * q.x + sr * q.y, -sr * q.x + cr * q.y);   // pantalla → cielo
        vec2 cell = floor(qs / starCell);
        float n = hash21(cell);
        if (n > 0.9767) {
            vec2 jitter = (vec2(fract(n * 17.13), fract(n * 29.71)) - 0.5) * (uCell * 1.4);
            vec2 cq = (cell + 0.5) * starCell + jitter;
            vec2 cp = vec2(cr * cq.x - sr * cq.y, sr * cq.x + cr * cq.y) + pivot;   // cielo → pantalla
            vec2 d = abs(px - cp);
            float pix = step(max(d.x, d.y), uCell * 0.5 + 0.5);
            float bright = fract(n * 91.7);   // brillo propio de la estrella
            // Visibilidad por altura: arriba antes que abajo; y por brillo.
            float visY = clamp(uStarVis * 1.8 - yf * 0.8 + 0.1, 0.0, 1.0);
            float appear = smoothstep(1.0 - visY, 1.12 - visY, bright * 0.85 + 0.15);
            float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * fract(n * 7.31)) + n * 41.0);
            // (efecto) los agudos las avivan en partida.
            col += vec3(0.85, 0.92, 1.0) * pix * appear * tw * (0.42 + 0.33 * bright) * (1.0 + high * 2.6);
        }
    }

    // ---------- Lucero ----------
    // Una cruz de cinco celdas con un brillo suave: el primer punto del cielo que
    // se enciende al atardecer, el aviso de que llega la noche.
    if (uLucero.z > 0.001 && uShow1.x > 0.5) {
        vec2 lp = vec2(uLucero.x, uLucero.y * uHorizon) * uFrame;
        vec2 cellPx = floor((px - lp) / uCell + 0.5);   // celdas del arte desde su centro
        float s = uLucero.w;
        float plus = (abs(cellPx.x) <= 0.0 && abs(cellPx.y) <= s) || (abs(cellPx.y) <= 0.0 && abs(cellPx.x) <= s) ? 1.0 : 0.0;
        float core = (cellPx.x == 0.0 && cellPx.y == 0.0) ? 1.0 : 0.55;
        float glow = exp(-length(px - lp) / (uCell * 2.5)) * 0.35;
        col += vec3(1.0, 0.95, 0.85) * (plus * core + glow) * uLucero.z * aboveHorizon;
    }

    // ---------- Estrellas fugaces ----------
    // Solo con noche cerrada y rara vez: en cada franja de 7 s hay una con
    // probabilidad 0.34 (una cada ~20 s de media). Un trazo de celdas con cola que
    // se apaga, en el cielo alto.
    if (uNight > 0.01 && uShow1.y > 0.5 && uv.y < uHorizon * 0.62) {
        const float PERIOD = 7.0;
        const float LIFE = 0.65;
        float slot = floor(uTime / PERIOD);
        if (hash21(vec2(slot, 17.0)) < 0.34) {
            float tIn = mod(uTime, PERIOD) - hash21(vec2(slot, 3.0)) * (PERIOD - LIFE);
            if (tIn > 0.0 && tIn < LIFE) {
                float prog = tIn / LIFE;
                vec2 start = vec2(0.12 + 0.76 * hash21(vec2(slot, 5.0)), (0.04 + 0.22 * hash21(vec2(slot, 9.0))) * uHorizon) * uFrame;
                float dirx = hash21(vec2(slot, 11.0)) < 0.5 ? -1.0 : 1.0;
                vec2 dir = normalize(vec2(dirx * 0.86, 0.5));
                float len = 0.22 * uFrame.y;
                vec2 head = start + dir * len * prog;
                vec2 pc = (floor(px / uCell) + 0.5) * uCell;   // pixelado a celdas del arte
                vec2 rel = pc - head;
                float along = dot(rel, -dir);
                float across = abs(dot(rel, vec2(-dir.y, dir.x)));
                float tail = len * 0.45;
                if (along > -uCell && along < tail && across < uCell * 0.75) {
                    float fade = (1.0 - clamp(along, 0.0, tail) / tail) * sin(prog * 3.14159);
                    col += vec3(0.9, 0.95, 1.0) * fade * 0.85 * uNight;
                }
            }
        }
    }

    // ---------- Luna ----------
    // Pixel art a MEDIA celda del arte (más detalle que el resto sin perder el
    // estilo): una esfera iluminada desde arriba a la derecha, mares con ruido
    // suave, cráteres con el borde encendido y el brillo en 5 escalones (como un
    // sprite con su paleta). Alrededor, la magia: corona cercana, luz ancha que
    // baña el cielo, un halo lunar tenue en anillo y un destello que titila.
    if (uMoonColor.a > 0.001 && uShow0.z > 0.5) {
        vec2 mp = vec2(uMoonPos.x, uMoonPos.y * uHorizon) * uFrame;
        float mr = uMoonRadius * sunUnit;
        float a = uMoonColor.a * aboveHorizon;
        float dm = length(px - mp) / mr;
        float outR = max(dm - 1.0, 0.0);
        float cellM = uCell * 0.5;
        vec2 m = ((floor(px / cellM) + 0.5) * cellM - mp) / mr;
        float r = length(m);
        // Fuera = fuera del disco PIXELADO: con el círculo exacto quedaba un borde
        // de celdas sin luna ni resplandor.
        float outside = step(1.0, r);
        vec3 glowCol = mix(uMoonColor.rgb, vec3(0.62, 0.72, 1.0), 0.45);
        col += glowCol * (0.34 * exp(-outR * 3.2) + 0.11 * exp(-outR * 0.55)) * outside * a;
        // Halo de 22° (un anillo muy tenue a ~3.4 radios).
        col += glowCol * 0.045 * exp(-pow((dm - 3.4) / 0.28, 2.0)) * a;

        if (r < 1.0) {
            vec3 nrm = vec3(m.x, -m.y, sqrt(1.0 - r * r));
            float lit = clamp(dot(nrm, normalize(vec3(0.45, 0.35, 0.82))), 0.0, 1.0);
            float nn = vnoise(m * 2.2 + 3.1) * 0.65 + vnoise(m * 5.3 + 7.7) * 0.35;
            float maria = smoothstep(0.5, 0.6, nn);
            vec2 c1 = crater(m, vec2(-0.42, 0.30), 0.20);
            vec2 c2 = crater(m, vec2(0.30, -0.40), 0.14);
            vec2 c3 = crater(m, vec2(0.12, 0.52), 0.11);
            vec2 c4 = crater(m, vec2(0.55, 0.18), 0.09);
            vec2 c5 = crater(m, vec2(-0.18, -0.10), 0.08);
            float pits = max(max(max(c1.x, c2.x), max(c3.x, c4.x)), c5.x);
            float rims = max(max(max(c1.y, c2.y), max(c3.y, c4.y)), c5.y);
            float b = 0.66 + 0.32 * lit - 0.17 * maria - 0.13 * pits + 0.16 * rims;
            b *= 1.0 - 0.1 * smoothstep(0.85, 1.0, r);
            b = floor(clamp(b, 0.0, 1.2) * 5.0 + 0.5) / 5.0;
            // Sombra fría y luz cálida: la luna no es gris plano.
            vec3 mc = mix(uMoonColor.rgb * vec3(0.55, 0.62, 0.9), uMoonColor.rgb * vec3(1.04, 1.02, 0.96), clamp(b, 0.0, 1.0)) * max(b, 0.55);
            col = mix(col, mc, a);
        }
        // Destello: una cruz fina de celdas que titila en el borde encendido.
        vec2 gp = mp + vec2(0.62, -0.62) * mr;
        vec2 gc = floor((px - gp) / cellM + 0.5);
        float tw = 0.5 + 0.5 * sin(uTime * 1.7);
        float glint = ((gc.x == 0.0 && abs(gc.y) <= 2.0) || (gc.y == 0.0 && abs(gc.x) <= 2.0)) ? (gc == vec2(0.0) ? 1.0 : 0.45) : 0.0;
        col += vec3(0.95, 0.97, 1.0) * glint * tw * 0.8 * a * outside;
    }

    // ---------- Sol ----------
    // De día un disco blanco-dorado limpio; en la hora dorada crece, se calienta
    // y le salen las rendijas de la mitad baja: el sol synthwave es el del ocaso.
    // Lo que queda bajo el horizonte no se pinta (y la cordillera lo tapa antes).
    {
        vec2 sunPos = vec2(uSunPos.x, uSunPos.y * uHorizon);
        vec2 toSun = (uv - sunPos) * uFrame / sunUnit;
        float d = length(toSun);
        float breathe = 0.5 + 0.5 * sin(uTime * 0.6);
        // (efecto) late con el beat; en el menú respira despacio.
        float sunR = uSunRadius + pulse * (0.013 + 0.013 * intensity) + (1.0 - reactive) * breathe * 0.0055;
        float sunRy = sunR * sunUnit / uFrame.y;   // radio en uv verticales (rendijas y degradado)
        // Primero el halo cercano y el resplandor ancho (escenario; uSunGlow ya
        // viene a 0 con el sol bajo el horizonte) y lo que late (efecto: graves,
        // pulso, drops); después el disco ENCIMA. Sumados sobre el disco lo
        // quemaban a blanco y se perdía su degradado (el dorado→rosa del ocaso).
        col += uSunGlow.rgb * (uSunHalo * exp(-d * 9.0) + uSunGlow.a * exp(-d * 3.2)) * uShow0.y;
        col += uSunGlow.rgb * exp(-d * 9.0) * (bass * 0.22 + pulse * (0.06 + 0.10 * intensity) + 0.25 * flash);
        if (uShow0.x > 0.5) {
            // OJO: smoothstep exige edge0 < edge1 (edges invertidos = undefined en
            // GLSL — en ANGLE/D3D devuelve 0 y el disco desaparece). Invertimos con 1-.
            float disc = (1.0 - smoothstep(sunR - 0.008, sunR, d)) * aboveHorizon;
            float below = step(sunPos.y, uv.y);
            float slit = 1.0 - uSunSlits * below * smoothstep(0.32, 0.5, abs(fract((uv.y - sunPos.y) / sunRy * 6.6) - 0.5));
            vec3 sunCol = mix(uSunCore, uSunEdge, smoothstep(sunPos.y - sunRy, sunPos.y + sunRy, uv.y));
            col = mix(col, sunCol, disc * slit * 0.95);
        }
    }

    // ================== EFECTOS ==================

    // ---------- Glow del horizonte ----------
    // Solo lo que late: la base del horizonte ya la pone la neblina de la paleta.
    float hd = abs(uv.y - uHorizon);
    float horizonGlow = exp(-hd * (26.0 - 8.0 * intensity));
    col += beatCol * horizonGlow * (bass * 0.55 + pulse * (0.15 + 0.30 * intensity + 0.35 * build) + 0.45 * flash + 0.30 * build);
    col += highCol * exp(-hd * 60.0) * (high * 0.35 + 0.25 * flash);

    // ---------- Ecualizador pixel desde el suelo (solo partida) ----------
    // Barras DISCRETAS con hueco entre ellas, 3 taps promediados por barra, altura
    // contenida y alpha que se desvanece hacia la punta. Anclado a la línea del
    // suelo en cualquier escena (la cordillera o el mar tapan buena parte: la
    // T03.1 le da su propio plano, doc 11 §1.C).
    if (uShaderMode > 0.5 && uv.y < uGround) {
        const float BARS = 40.0;
        float slot = floor(uv.x * BARS);
        float cx = (slot + 0.5) / BARS;
        float b0 = texture(uFFT, vec2(cx, 0.5)).r;
        float b1 = texture(uFFT, vec2(cx - 1.0 / BARS, 0.5)).r;
        float b2 = texture(uFFT, vec2(cx + 1.0 / BARS, 0.5)).r;
        float bin = (b0 * 2.0 + b1 + b2) * 0.25;
        // ² para que el silencio sea plano; más alto cuanto más empuja el tramo.
        float h = bin * bin * (0.11 + 0.09 * intensity);
        float top = uGround - h;
        float gap = step(fract(uv.x * BARS), 0.68);   // 68% barra, 32% hueco
        if (uv.y > top && h > 0.004) {
            float t = (uGround - uv.y) / max(h, 1e-4);   // 0 en la base, 1 en la punta
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

    // Viñeta suave para dar foco al gameplay (capa 3 vive encima). Más suave de día.
    float dx = uv.x - 0.5;
    float dy = uv.y - 0.5;
    float vignette = 1.0 - smoothstep(0.4, 0.95, sqrt(dx * dx + dy * dy));
    col *= mix(1.0 - uVignette, 1.0, vignette);

    finalColor = vec4(col, 1.0);
}
