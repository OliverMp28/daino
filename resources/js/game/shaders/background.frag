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
//     uSunFlash            [0,1] el destello verde (T02.6, historias con greenFlash)
//     uShow0/uShow1        interruptores del panel dev (1 = se ve):
//                          sol, halo del sol, luna, estrellas | lucero,
//                          estrellas fugaces, neblina, destello verde
//   Las posiciones del sol, la luna y el lucero llegan en FRACCIÓN DEL CIELO:
//   y = 0 arriba, 1 en el horizonte (uHorizon las pasa a uv).
//
//   EFECTOS (audioUniforms, T03.1) — lo que reacciona a la música. El shader no
//   decide nada: recibe CANTIDADES ya calculadas (fx/skyAmounts.js: señales ×
//   coeficientes × el nivel que da el director de efectos) y solo compone.
//     uFxA  x tinte del clímax · y avivado de las estrellas · z radio extra del
//           sol · w halo del sol
//     uFxB  x brillo del horizonte · y línea fría del horizonte · z caída del
//           brillo · w bombeo del cielo (cuánto se oscurece ahora: solo oscurece)
//     uFxC  x destello · y calma del break · z aurora · w lluvia de estrellas
//     uFxD  relojes de las firmas (T03.3): x fase de la aurora · y vaivén de sus
//           cortinas · z tanda de la lluvia de estrellas (+0.5 si es de primer
//           tiempo) · w segundos desde que empezó
//     uFxWarm/uFxCool   los dos colores de los efectos (de la escena o de la canción)
//     uFxBand           x: uv del techo de la franja jugable · y: fundido del
//                       limitador por encima (uv) · z: techo de luminancia
//   Con todo a cero (el menú) el shader pinta el escenario y nada más.
//
//   LIMITADOR (fxLimit, espejo de fx/limiter.js): dentro de la franja jugable la
//   luz de los efectos nunca sube el fondo por encima del techo: lo que se juega
//   se lee siempre. Todo lo que SUMA luz pasa por él.
//
// El FFT (sampler2D uFFT, 256x1) ya solo lo lee el modo de depuración ?debug=fft:
// el espectro se pinta en el paisaje (T03.2), no aquí.

in vec2 vTextureCoord; // uv sobre la TEXTURA del pool (¡su 1.0 cae fuera de pantalla!)
in vec2 vFrameCoord;   // uv [0,1] sobre el FRAME VISIBLE — usar este para todo
                       // lo anclado a pantalla (lo emite background.vert).
out vec4 finalColor;

uniform sampler2D uTexture; // input del filtro (lo inyecta Pixi). Lo ignoramos
                            // a propósito: pintamos el fondo desde cero.
uniform sampler2D uFFT;     // textura 256x1, formato r8unorm.

// ---- Efectos (audioUniforms) ----
uniform float uShaderMode;  // 0=idle (el sol respira despacio), 1=hay música
uniform float uTime;
uniform float uDebugMode;   // 0=normal, 1=fft crudo, 2=uv coords
uniform float uHorizon;     // horizonte del cielo (T02.2: la Costa lo sube hasta la línea del mar)
uniform vec2  uFrame;       // tamaño del frame en px CSS
uniform float uCell;        // px CSS por celda del arte (vista del mundo)
uniform vec4  uFxA;
uniform vec4  uFxB;
uniform vec4  uFxC;
uniform vec4  uFxD;
uniform vec3  uFxWarm;
uniform vec3  uFxCool;
uniform vec3  uFxBand;

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
uniform float uSunFlash;
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

// Forma del degradado del cielo: SKY_SHAPE de scenes/skyModel.js (mismos números).
const float SKY_MID_AT = 0.5;
const float SKY_HAZE_K = 14.0;

// Limitador de la franja jugable (espejo exacto de limitFx, fx/limiter.js).
// `base`: lo que hay sin el efecto; `lit`: lo que habría con él; `w`: cuánto
// actúa (1 en la franja jugable, 0 por encima). La luminancia se mide con un
// sustituto sin potencias (Σ w·c²), que queda por encima de la real.
float fxLuma(vec3 c) {
    return dot(c * c, vec3(0.2126, 0.7152, 0.0722));
}
vec3 fxLimit(vec3 base, vec3 lit, float w) {
    float lb = fxLuma(base);
    float ll = fxLuma(lit);
    float target = max(lb, uFxBand.z);
    // Si con el efecto no se pasa del techo (o el efecto oscurece), entero.
    float k = ll <= target ? 1.0 : (target - lb) / (ll - lb);
    return mix(base, lit, 1.0 - w * (1.0 - k));
}

// Un color de efecto, tan vivo como cabe: su mismo tono, llevado a una viveza y
// una claridad fijas. Para la luz que se suma sobre un cielo oscuro: un color
// pálido sumado a medias no se lee como luz, sino como polvo (la aurora de una
// paleta de rosas claros salía gris).
vec3 fxVivid(vec3 c) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 d = c - l;
    float m = max(max(abs(d.r), abs(d.g)), abs(d.b));
    return clamp(vec3(0.55) + d * (0.55 / max(m, 0.04)), 0.0, 1.0);
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

// Una estrella fugaz: un trazo de celdas con cola que se apaga. `seed` decide
// dónde nace; `dirSeed`, hacia qué lado cae; `tIn`, los segundos que lleva; nace
// entre `y0` e `y1` (uv); `size` alarga el trazo. Devuelve cuánta luz pone en este
// píxel [0,1].
const float METEOR_LIFE = 0.65;
float meteor(vec2 px, float seed, float dirSeed, float tIn, float y0, float y1, float size) {
    if (tIn <= 0.0 || tIn >= METEOR_LIFE) return 0.0;
    float prog = tIn / METEOR_LIFE;
    vec2 start = vec2(0.12 + 0.76 * hash21(vec2(seed, 5.0)), mix(y0, y1, hash21(vec2(seed, 9.0)))) * uFrame;
    float dirx = hash21(vec2(dirSeed, 11.0)) < 0.5 ? -1.0 : 1.0;
    vec2 dir = normalize(vec2(dirx * 0.86, 0.5));
    float len = 0.22 * size * uFrame.y;
    vec2 head = start + dir * len * prog;
    vec2 pc = (floor(px / uCell) + 0.5) * uCell;   // pixelado a celdas del arte
    vec2 rel = pc - head;
    float along = dot(rel, -dir);
    float across = abs(dot(rel, vec2(-dir.y, dir.x)));
    float tail = len * 0.45;
    if (along <= -uCell || along >= tail || across >= uCell * 0.75) return 0.0;
    return (1.0 - clamp(along, 0.0, tail) / tail) * sin(prog * 3.14159);
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
    // ---------- /DEBUG ----------

    // Sin música (el menú) las cantidades de los efectos llegan a cero: el
    // escenario jamás depende del audio (invariante Bloque 6). `reactive` solo
    // decide si el sol respira por su cuenta.
    float reactive = step(0.5, uShaderMode);
    // Cuánto actúa el limitador: entero en la franja jugable, nada por encima.
    float fxW = smoothstep(uFxBand.x - uFxBand.y, uFxBand.x, uv.y);

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

    // (efecto) Tinte del clímax, más fuerte arriba.
    col = fxLimit(col, col + uFxWarm * uFxA.x * (1.0 - toH), fxW);

    // (efecto) Bombeo del cielo: respira con el golpe, hacia abajo. Entre golpes se
    // oscurece un poco y en el golpe vuelve a su brillo. Oscurecer nunca le quita
    // contraste a lo que se juega, así que se ve también de día y no pasa por el
    // limitador. Va ANTES de las estrellas, la luna y el sol: respira el cielo, no
    // los astros (un sol que se apaga entre golpes se veía sucio).
    col *= 1.0 - uFxB.w;

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
            // (efecto) estrellas vivas: titilan con los agudos y laten con el pulso.
            col += vec3(0.85, 0.92, 1.0) * pix * appear * tw * (0.42 + 0.33 * bright) * (1.0 + uFxA.y);
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
        float slot = floor(uTime / PERIOD);
        if (hash21(vec2(slot, 17.0)) < 0.34) {
            float tIn = mod(uTime, PERIOD) - hash21(vec2(slot, 3.0)) * (PERIOD - METEOR_LIFE);
            col += vec3(0.9, 0.95, 1.0) * meteor(px, slot, slot, tIn, 0.04 * uHorizon, 0.26 * uHorizon, 1.0) * 0.85 * uNight;
        }
    }

    // Lo más bajo donde pintan las firmas del cielo: por encima de la franja
    // jugable y del fundido del limitador.
    float fxSkyBottom = uFxBand.x - uFxBand.y;

    // ---------- (efecto) Lluvia de estrellas ----------
    // La firma de las canciones que estallan: en el clímax, tandas de fugaces
    // sobre el pulso (uFxD.z es el número de la tanda y uFxD.w los segundos que
    // lleva; fx/skyAmounts.js decide en qué golpes caen). En un primer tiempo son
    // dos o tres; a mitad de compás, una o dos. Las de una tanda caen hacia el
    // mismo lado. El mismo trazo que la fugaz del escenario, algo más largo y con
    // un punto del color frío de la canción, y siempre por encima de la franja
    // jugable (un trazo recorre 0.14 de la pantalla hacia abajo).
    if (uFxC.w > 0.004 && fxSkyBottom > 0.2) {
        vec3 streak = mix(vec3(0.92, 0.96, 1.0), uFxCool, 0.3);
        float tanda = floor(uFxD.z);
        float big = step(0.25, fract(uFxD.z));
        for (int k = 0; k < 3; k++) {
            float fk = float(k);
            float seed = tanda * 3.0 + fk + 0.5;
            float chance = k == 0 ? 1.0 : (k == 1 ? mix(0.4, 1.0, big) : 0.55 * big);
            if (hash21(vec2(seed, 31.0)) > chance) continue;
            float tIn = uFxD.w - fk * 0.09 - hash21(vec2(seed, 3.0)) * 0.1;
            col += streak * meteor(px, seed, tanda + 0.5, tIn, 0.02, fxSkyBottom - 0.17, 1.3) * uFxC.w;
        }
    }

    // ---------- (efecto) Aurora ----------
    // La firma de las canciones que fluyen: cortinas de luz sobre lo que se juega.
    // Pixel art, como la luna y las estrellas: columnas de dos celdas y filas de
    // una. Cada cortina es una hilera de RAYOS: su borde de abajo es una onda lenta
    // (se desplaza con la fase, uFxD.x, y los graves la mecen, uFxD.y) y cada rayo
    // sube desde él, cada uno con su altura y su brillo, apagándose en escalones.
    // Como en una aurora de verdad, el borde de abajo es el color cálido de la
    // canción y el cuerpo, el frío. No es casual: el borde es lo que entra en la
    // franja jugable, donde la luz tiene techo (fxLimit) y solo brillan los tonos
    // del añil al magenta; el frío vive arriba, donde no lo hay.
    // Dos cortinas a distinta profundidad, que NO se suman: donde se cruzan se ve
    // la de más luz (como dos sprites, y así su luz tiene un máximo conocido).
    // Va antes de la luna, que queda delante.
    float auroraBase = uFxBand.x;   // el techo de la franja jugable (uv)
    if (uFxC.z > 0.004 && uv.y < auroraBase + 0.09) {
        float colW = uCell * 2.0;
        float column = floor(px.x / colW);
        float cx = (column + 0.5) * colW / uFrame.y;                // x de la columna, en alturas de pantalla
        float cy = (floor(px.y / uCell) + 0.5) * uCell / uFrame.y;  // y de la fila (uv)
        float ph = uFxD.x;
        float sway = 1.0 + uFxD.y;
        vec3 warm = fxVivid(uFxWarm);
        vec3 cool = fxVivid(uFxCool);
        vec3 aurora = vec3(0.0);
        for (int k = 0; k < 2; k++) {
            float fk = float(k);
            float hem = auroraBase * (0.94 - 0.36 * fk)
                + auroraBase * 0.11 * sway * sin(cx * (2.1 + 1.3 * fk) + ph * (0.6 + 0.25 * fk) + fk * 2.1)
                + auroraBase * 0.04 * sway * sin(cx * 6.3 - ph * 0.9 + fk * 4.0);
            float reach = auroraBase * (0.78 - 0.26 * fk)
                * (0.4 + 0.45 * vnoise(vec2(cx * 9.0 + fk * 31.0, ph * 0.22 + fk * 5.0)) + 0.15 * hash21(vec2(column, fk + 9.0)));
            float up = (hem - cy) / reach;   // 0 en el borde, 1 en la punta del rayo
            if (up > 0.0 && up < 1.0) {
                // El brillo de cada rayo: el suyo (su columna) y el de su vecindad,
                // que cambia despacio.
                float ray = 0.42 + 0.58 * mix(hash21(vec2(column, fk + 3.0)), vnoise(vec2(cx * 13.0 + fk * 13.0, ph * 0.4 + fk * 7.0)), 0.55);
                float fall = floor(pow(1.0 - up, 1.25) * 8.0 + 0.5) / 8.0;
                aurora = max(aurora, mix(warm, cool, smoothstep(0.0, 0.17, up)) * fall * ray * (1.0 - 0.4 * fk));
            }
        }
        col = fxLimit(col, col + aurora * uFxC.z, fxW);
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
        // (efecto) late con el beat; en el menú respira despacio. Solo mientras
        // está entero sobre el horizonte: un sol que se pone no se hincha (al
        // latir, su filo volvía a asomar cuando ya se había ocultado, justo en el
        // destello verde).
        float sunClear = clamp((uHorizon - sunPos.y) * uFrame.y / (uSunRadius * sunUnit), 0.0, 1.0);
        float sunR = uSunRadius + sunClear * (uFxA.z + (1.0 - reactive) * breathe * 0.0055);
        float sunRy = sunR * sunUnit / uFrame.y;   // radio en uv verticales (rendijas y degradado)
        // Primero el halo cercano y el resplandor ancho (escenario; uSunGlow ya
        // viene a 0 con el sol bajo el horizonte) y lo que late (efecto: graves,
        // pulso, drops); después el disco ENCIMA. Sumados sobre el disco lo
        // quemaban a blanco y se perdía su degradado (el dorado→rosa del ocaso).
        col += uSunGlow.rgb * (uSunHalo * exp(-d * 9.0) + uSunGlow.a * exp(-d * 3.2)) * uShow0.y;
        col = fxLimit(col, col + uSunGlow.rgb * exp(-d * 9.0) * uFxA.w, fxW);
        if (uShow0.x > 0.5) {
            // OJO: smoothstep exige edge0 < edge1 (edges invertidos = undefined en
            // GLSL — en ANGLE/D3D devuelve 0 y el disco desaparece). Invertimos con 1-.
            float disc = (1.0 - smoothstep(sunR - 0.008, sunR, d)) * aboveHorizon;
            float below = step(sunPos.y, uv.y);
            float slit = 1.0 - uSunSlits * below * smoothstep(0.32, 0.5, abs(fract((uv.y - sunPos.y) / sunRy * 6.6) - 0.5));
            vec3 sunCol = mix(uSunCore, uSunEdge, smoothstep(sunPos.y - sunRy, sunPos.y + sunRy, uv.y));
            col = mix(col, sunCol, disc * slit * 0.95);
        }

        // ---------- Destello verde (T02.6: historias con greenFlash) ----------
        // En el último instante del sol al ponerse en el mar (y en el primero al
        // salir), lo que queda de él se vuelve verde, un rayo fino de celdas sube
        // sobre él y el horizonte se enciende en verde. uSunFlash llega a 0 fuera
        // de ese instante (scenes/skyModel.js), así que en el resto no cuesta nada.
        // El verde se MEZCLA con el cielo, no se suma: sumado al rojo del ocaso
        // salía amarillo (verde + rojo = amarillo) y sobre el rosa, blanco.
        if (uSunFlash > 0.001 && uShow1.w > 0.5) {
            const vec3 GREEN = vec3(0.30, 1.0, 0.55);       // FLASH_GREEN de skyModel.js
            const vec3 GREEN_DEEP = vec3(0.10, 0.62, 0.34);
            float f = uSunFlash;
            float discG = (1.0 - smoothstep(sunR - 0.008, sunR, d)) * aboveHorizon;
            col = mix(col, mix(GREEN, vec3(0.85, 1.0, 0.9), 0.25), discG * f * 0.95);
            vec2 base = vec2(sunPos.x, uHorizon) * uFrame;
            // El cielo a ras del agua se vuelve verde alrededor del punto.
            vec2 gq = (px - base) / vec2(uFrame.y * 0.16, uFrame.y * 0.05);
            float glow = exp(-dot(gq, gq)) * aboveHorizon;
            col = mix(col, GREEN_DEEP, glow * f * 0.7);
            col += GREEN * glow * f * 0.18;
            // La línea del horizonte se enciende en verde a los dos lados (una celda).
            float hy = (base.y - px.y) / uCell;
            if (hy >= 0.0 && hy < 1.0) {
                float along = abs(px.x - base.x) / (uFrame.x * 0.22);
                col = mix(col, GREEN, exp(-along * along * 3.0) * f * 0.85);
            }
            // El rayo: una columna de celdas del arte sobre el sol, tan alta como fuerte es el destello.
            float cx = abs(floor((px.x - base.x) / uCell + 0.5));
            float upCells = floor((base.y - px.y) / uCell);
            float lenCells = floor(0.3 * uFrame.y / uCell * f);
            if (upCells >= 0.0 && upCells < lenCells && cx <= 1.0) {
                float fade = 1.0 - upCells / max(lenCells, 1.0);
                float core = cx < 0.5 ? 1.0 : 0.35;
                col = mix(col, GREEN, core * fade * fade * f);
            }
        }
    }

    // ================== EFECTOS ==================

    // ---------- Brillo del horizonte ----------
    // Solo lo que late: la base del horizonte ya la pone la neblina de la paleta.
    // Una banda cálida y una línea fría pegada al horizonte. Lo que una escena no
    // quiera en su horizonte (una historia de autor) lo veta ella: llega a cero.
    float hd = abs(uv.y - uHorizon);
    vec3 lit = col + uFxWarm * exp(-hd * uFxB.z) * uFxB.x + uFxCool * exp(-hd * 60.0) * uFxB.y;
    col = fxLimit(col, lit, fxW);

    // ---------- Destello de un momento (drop) ----------
    // Dura décimas: no pasa por el limitador (fx/flashSafety.js).
    col += uFxCool * uFxC.x;

    // Break: el color se apaga hacia un gris frío, sin llegar a negro.
    float calm = uFxC.y;
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(luma) * vec3(0.78, 0.84, 1.0), 0.6 * calm) * (1.0 - 0.22 * calm);

    // Viñeta suave para dar foco al gameplay (capa 3 vive encima). Más suave de día.
    float dx = uv.x - 0.5;
    float dy = uv.y - 0.5;
    float vignette = 1.0 - smoothstep(0.4, 0.95, sqrt(dx * dx + dy * dy));
    col *= mix(1.0 - uVignette, 1.0, vignette);

    finalColor = vec4(col, 1.0);
}
