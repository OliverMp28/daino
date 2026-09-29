# Roadmap — Escenarios y efectos visuales (Sep 2026)

> **Qué es este documento.** El user quiere trabajar dos frentes visuales, cada uno con su propia sesión para darle el enfoque que merece:
>
> 1. **Escenario** (fases **E**): el cielo y el paisaje. Que el paso del tiempo se sienta (día → atardecer → noche con luna → amanecer) y que la arquitectura permita, más adelante, **escenas con personalidad e historia** por nivel (el ejemplo del user: un nivel con "One Day" de Piratas del Caribe con el mar en el horizonte, un barco que aparece y el destello verde).
> 2. **Efectos al ritmo de la música** (fases **V**): varios efectos, progresivos, que no aparezcan todos en todos los niveles, que se integren en el escenario sin estorbar la vista, que den a cada canción su identidad de color, y un **panel dev** para activarlos por nombre ("el efecto X quítalo").
>
> Se trabaja primero el escenario. Los efectos, en otra sesión.
>
> **Autoridad.** Por debajo de 04, 05, 06, 07, `vout-integration/`, 09 y 10. Refina el doc 06 §3: la Capa 1 deja de ser "el fondo audio-reactivo" y pasa a ser **el cielo del escenario con los efectos encima** (ver §2.4). Para todo lo que es nivel, charter o sincronía, manda el 10.
>
> **Estado:** E0 ✅ y E1 ✅ (Sep 2026). Siguiente: playtest humano del ciclo; después V1 (efectos) o E2 (escenas por nivel), en sesiones aparte.

---

## Índice

- [1. Diagnóstico](#1-diagnóstico)
- [2. Decisiones vinculantes](#2-decisiones-vinculantes)
- [3. Las fases](#3-las-fases)
- [4. Orden y dependencias](#4-orden-y-dependencias)
- [5. Riesgos](#5-riesgos)
- [6. Ideas descartadas (con motivo)](#6-ideas-descartadas-con-motivo)

---

## 1. Diagnóstico

### 1.A Qué hay hoy en el fondo

Inventario antes de E1. La última columna es la clave de todo este documento: hoy **escenario y efectos viven mezclados en las mismas fórmulas**.

| Elemento | Dónde | Qué lo mueve | ¿Escenario o efecto? |
|---|---|---|---|
| Degradado del cielo (oscuro arriba, violeta en el horizonte) | `background.frag` | `uProgress`: se oscurece con la canción | escenario |
| Estrellas (celdas hash que titilan) | `background.frag` | `uTime`; los agudos las avivan | escenario + efecto |
| Sol synthwave (cian→rosa con rendijas) | `background.frag` | baja con `uProgress`; late con el beat | escenario + efecto |
| Halo del sol | `background.frag` | base constante + graves, pulso, drops | escenario + efecto |
| Glow del horizonte (rosa y cian) | `background.frag` | base constante + graves, pulso, build, flash, agudos | escenario + efecto |
| **Ondas senoidales** | `background.frag` | medios + RMS | efecto — **quitado en E0** |
| Ecualizador pixel (40 barras) | `background.frag` | FFT, intensidad del tramo | efecto |
| Tinte del clímax, destello al beat, break desaturado, giro por cambio de tonalidad | `background.frag` | estructura de la canción (Olas 5 y 6c) | efecto |
| Viñeta | `background.frag` | fija | escenario |
| Montañas (2 crestas en parallax) | `entities/Scenery.js` | scroll | escenario |
| Nubes (4 siluetas oscuras) | `entities/Scenery.js` | deriva propia + parallax | escenario |
| Suelo y su línea de luz | `entities/Scenery.js` | scroll; la línea late con el beat | escenario + efecto |
| Motas (80) | `entities/ParticleLayer.js` | RMS × intensidad | efecto |
| Líneas de velocidad | `entities/SpeedLines.js` | `speedCues` | efecto de juego |
| Drop, lift y marcha: destello, golpe de cámara, ola de partículas | `GameSession.js` | eventos del chart | efecto de juego |

### 1.B El efecto borroso eran las "ondas senoidales" (quitado en E0)

Lo que el user describió ("una especie de nube o difuminación con formas circulares en todo el fondo, se mueve de derecha a izquierda y palpita con el ritmo") era un resto del shader v1 del Bloque 4 que sobrevivió al rediseño:

```glsl
float wave = sin(uv.x * 14.0 + uTime * 1.1) * 0.5 + 0.5;
wave += sin(uv.y * 22.0 - uTime * 0.6) * 0.25;
col += vec3(wave) * (0.018 + mid * 0.10 + rms * 0.06);
```

- La suma de un seno horizontal y otro vertical dibuja un **cartón de huevos**: manchas redondas y difusas. La fase `14x + 1.1t` avanza hacia la izquierda.
- Es **gris** (`vec3(wave)`) y **aditivo** sobre toda la pantalla: lava los colores y emborrona el cielo.
- En el menú suma 0.018 (no se ve). En partida, con medios a 0.5 y RMS a 0.3, llega a ~0.11, y hasta ~0.18 con la música a tope, sobre un cielo de 0.02-0.18: **multiplica el brillo por zonas y late con la canción**.

Verificado con capturas de What's Up Danger en 0:24 y 0:44 (bandas de niebla gris en el tercio superior y la franja media) y después del cambio en 1:07 (cielo limpio). `uMid` y `uRMS` siguen declarados: son parte del bus de audio que usará la fase V.

### 1.C Las barras del ecualizador se esconden detrás de las montañas

El user: "se ve bien, solo que a veces parece escondido". Es literal: las barras suben desde el horizonte `bin² × (0.11 + 0.09 · intensidad)` de la altura, 0.03-0.13 con la música típica y como mucho 0.20. La cordillera lejana mide 40-130 unidades de 620 (0.065-0.21) y **se dibuja encima** (el escenario va sobre el shader). Solo asoman por los valles. Es trabajo de V1: el ecualizador necesita su propio plano, no el fondo del fondo.

### 1.D Legibilidad: los sprites están pensados para un cielo oscuro

El dino, los cactus, el ptero, los cristales y el orbe son colores neón **sin contorno**. La franja donde se juega no es solo el suelo: va del 40 % al 97 % de la altura (el doble salto sube hasta ≈0.51, el techo de la antigravedad cae en ≈0.40-0.48, el orbe entre 0.60 y 0.77). Un día "de verdad" los borraría. Contraste WCAG medido:

| Fondo | Dino | Cactus | Ptero | Cristal | Orbe |
|---|---|---|---|---|---|
| Noche actual `#1b1230` | 16.4 | 10.0 | 6.1 | 7.1 | 6.4 |
| Cielo pastel `#8ec5ff` | 1.66 | **1.02** | 1.63 | 1.38 | 1.53 |
| Azul medio `#4a7fd0` | 3.68 | 2.25 | 1.36 | 1.60 | 1.44 |
| Azul profundo `#2f5aa8` | 6.12 | 3.74 | 2.26 | 2.66 | 2.40 |
| Azul noche `#1d3470` | 10.9 | 6.62 | 4.01 | 4.71 | 4.25 |

Con un cielo pastel el cactus desaparece (1.02:1). Para que los obstáculos rosa, violeta y naranja (luminancia ≈0.30-0.36) lleguen al 3:1 de la WCAG 1.4.11 (gráficos que hay que percibir), el fondo que tienen detrás no puede pasar de una luminancia ≈0.067. El user eligió **día azul intenso** (§2.2): cielo en azules profundos y saturados, sin tocar los sprites.

### 1.E El sol no se entiende

El user: "no reconozco si es sol o luna". Un disco cian→rosa con rendijas en un cielo nocturno con estrellas, que siempre es el mismo, no es ni lo uno ni lo otro. Con el ciclo, el sol es un sol (blanco-dorado de día, el disco synthwave con rendijas justo en el ocaso) y la luna es una luna.

### 1.F Escenario y efectos están mezclados

El halo del sol es `0.10 + 0.05·respiración` (escenario) `+ graves·0.22 + pulso·… + flash·0.25` (efecto), en la misma línea. El glow del horizonte, igual. Mientras sea así, no se puede cambiar el cielo según la hora sin tocar los efectos, ni apagar un efecto sin apagar parte del cielo. Separarlos es la base de los dos frentes.

---

## 2. Decisiones vinculantes

### 2.1 El cielo cuenta la canción (anclado a la música)

Elegido por el user frente a "reloj fijo" y "proporcional". El ciclo se deriva **en runtime** de los eventos `section` del chart (`t`, `level`, `climax`), igual que `speedCues` deriva las marchas de `world.speedChanges`: **sin campos nuevos en el chart, sin tocar el charter ni `CHARTER_VERSION` y sin re-hornear**.

- Horas del viaje (con la cordillera delante, que tapa hasta 130 unidades): 14:30 inicio → 17:15 empieza la hora dorada → ~18:13 el sol synthwave asoma sobre las crestas → ~18:50 se ha hundido → 19:30 noche cerrada → 5:00 primera luz → 6:36 el sol asoma sobre las crestas. Un día más corto empieza más tarde: el sol baja siempre al mismo ritmo (120 s de 14:30 a la hora dorada).
- **Canción larga** (cabe el viaje completo): el atardecer empieza en el límite de sección de `[max(60 s, 35 % D), inicioClímax − 20 s]` más cercano a `inicioClímax − 36 s` ("la calma antes del anochecer"); **la noche cae con el drop del clímax**; el amanecer llega en el último límite de sección tras el clímax que deje 8-26 s hasta el final (si no lo hay, en `D − 20 s` si la noche ha durado ≥ 15 s; si tampoco, el nivel acaba de noche); el sol sale al terminar la canción.
- **Sin clímax utilizable** (ausente, antes de 1:00 o chart sin estructura): el atardecer empieza en el primer límite ≥ `max(60 s, 45 % D)` y la noche cae 36 s después.
- **Canción corta** (no cabe el viaje): el sol se pone en su última sección. Hasta hoy el sol ya se ponía con el progreso de cualquier canción (Ola 5): se conserva para las cortas.
- **Tras superar el nivel**, el cielo sigue unos segundos bajo el panel de resultados hasta el siguiente hito: termina de ponerse el sol o sale. Tras chocar, se congela con el mundo.
- Lo que sale para los oficiales (y queda como test de regresión, `tests/js/sky-clock.test.mjs`), atardecer / noche / alba: What's Up Danger 1:59 / 2:37 / 3:22 (canción de 3:35); Time 1:15 / 1:45 / 2:26; Dawn of Faith 1:28 / 2:00 / 2:57; Mi Fiesta 1:54 / 2:36 / 3:04; Running With the Wolves 2:00 / 2:26 / acaba de noche (el clímax dura hasta el final); HOPE atardecer en su outro (1:02-1:19); Sugar Red atardecer desde 0:16 y Last Christmas desde 0:10.

Por qué así: en una canción típica el día cubre intro, estrofas y estribillos; el atardecer cae en el puente o en la estrofa que prepara el final (la calma, el aviso de que llega la noche); la noche de neón es el clímax, y el amanecer es la resolución. Es el arco emocional de casi cualquier canción, y es la filosofía del proyecto desde la Ola 5: "la sensación de final sale de la canción, no de un temporizador".

### 2.2 Día azul intenso; la luz tiñe el escenario, nunca el juego

- Elegido por el user frente a "día claro + contorno en los sprites". De día el cielo es de azules profundos y saturados, con el sol blanco-dorado, las nubes blancas y las montañas en azul de sombra.
- Los colores del juego significan algo (rosa = peligro aéreo, violeta = antigravedad, oro = vuelo, naranja = orbe). **La hora tiñe cielo, nubes, montañas y suelo; nunca el Dino, los obstáculos, los portales ni el túnel.**

### 2.3 Todo cielo pasa el guardián de legibilidad

`scenes/readability.js` mide, para cada hora de cada escena y en cada altura donde puede haber juego, el contraste de los colores del juego con lo que tienen detrás (cielo a esa altura y montañas). Las alturas y los colores salen del registro de obstáculos y de la paleta del pixel art: un obstáculo nuevo entra solo en la prueba. Umbrales: **4.5:1 el Dino**, **3:1 el cactus** (WCAG 1.4.11) y **2.5:1 los obstáculos de color y los portales**. El último se calibró con una maqueta de tres cielos de día con los sprites reales: con 3:1 el cielo de la franja jugable tendría que ser más oscuro que el azul puro (`#0000ff` tiene luminancia 0.072) y el día se lee como tarde avanzada; con 2.5:1 el ptero rosa sobre azul intenso se lee sin problema por la diferencia de tono. No se miden el disco del sol ni la luna (locales, se cruzan en décimas). Es un test: una paleta nueva, o una escena nueva, que borre un obstáculo no pasa.

### 2.4 Escenario ≠ efectos

- **Escenario**: lo que existe aunque no suene nada. Depende de la hora (y de la escena), nunca del audio.
- **Efecto**: lo que reacciona a lo que suena o a la estructura. Tiene **nombre**, vive en un registro (fase V1) y se puede apagar.
- Las bases constantes del halo del sol y del glow del horizonte pasan a la paleta del cielo. Lo que late se queda como efecto, igual que está, hasta V1.

### 2.5 Una escena es un registro

Una escena declara su paleta, su ciclo, sus astros (dónde sale y se pone el sol, cómo es la luna) y sus capas (`ridge`, `clouds`, `ground`… y en E2 `sea`, props y cues). Añadir una escena es una entrada del registro más, si hace falta, un tipo de capa nuevo. Nada del juego ni del charter cambia.

### 2.6 El menú, al atardecer synthwave

Elegido por el user frente a "hora real del jugador" y "noche con luna": sol con rendijas tocando el horizonte, cielo rosa y violeta, primeras estrellas arriba. Es el aspecto de siempre del menú, ahora coherente con el ciclo. El paso menú → partida va por el fundido a negro que ya existe.

### 2.7 Todo lo que se ve tiene nombre

Cada elemento del escenario (y, en V1, cada efecto) tiene un id y una etiqueta en español, y un interruptor en el panel dev. Así el user y el desarrollo hablan de lo mismo ("la neblina del horizonte", "el filo de las crestas") en vez de adivinar.

---

## 3. Las fases

### E0 — Quitar las ondas ✅ (Sep 2026)

Ver §1.B.

### E1 — Ciclo del cielo y escenario vivo ✅ (Sep 2026)

#### Qué se construyó (y en qué se desvió del plan, con motivo)

- **Núcleo puro** `resources/js/game/scenes/`, sin Pixi y probado en Node:
  - `color.js`: hex↔sRGB, OKLab (para interpolar sin grises sucios: del azul del día al naranja del ocaso en sRGB sale un marrón) y contraste WCAG.
  - `palettes.js`: `SKY_PALETTES.synthwave`, keyframes por **elevación del sol** (tarde y alba con listas propias, que comparten el pleno día y la noche cerrada: pasar de una a otra no da saltos), `samplePalette` sin asignaciones por frame.
  - `skyModel.js`: `skyStateAt(hora, escena, out)` → sol (posición, tamaño, colores, rendijas, halo), luna, estrellas (visibilidad y giro), lucero, colores de cielo, nubes, montañas y suelo; `skyColorAt` (el mismo degradado que el shader, para el guardián y el CSS); `SKY_PHASES`.
  - `skyClock.js`: `planSky` (§2.1) con `SKY_HOURS`, `SKY_RULES` y `SKY_CYCLES` (`journey`, y `fixed` para escenas de hora quieta); `hourAt`, `timeAtHour`, `phaseAt`, `events` (`eveningStart`, `sunDown`, `nightfall`, `dawnStart`, `sunrise`: los anclajes para los cues de E2) y `epilogue`.
  - `registry.js`: `SCENES` (la "Cordillera"), `SKY_ELEMENTS` (lo que pinta el shader, con su hueco en `uShow0/uShow1`), `sceneElements`, `resolveScene`, `sceneCycle`.
  - `readability.js`: el guardián (§2.3).
- **`assets/palette.js`**: la paleta del pixel art sale de `pixelart.js` (que importa Pixi) para que el guardián mida los mismos colores que se dibujan.
- **Shader v3** (`background.frag`, `audioFilter.js`): grupo `skyUniforms` aparte de `audioUniforms`. Cielo de tres paradas con neblina pegada al horizonte; sol blanco-dorado de día que en la hora dorada crece, se calienta y gana las rendijas; luna pixelada con mares y halo frío; estrellas de una celda que salen de arriba abajo (las brillantes antes) y **giran** alrededor de un polo fuera de pantalla (~15° en una noche: el paso del tiempo); lucero de la tarde y del alba; estrella fugaz rara (una franja de 7 s de cada ~3). Lo que late (halo del beat, glow del horizonte, ecualizador, tinte del clímax, destello, break, giro de tonalidad) sigue igual como efecto. Las bases constantes del halo y del glow pasaron a la paleta. `uProgress` ya no existe (y `songDirector.progress`, que solo servía para poner el sol, tampoco).
- **Escenario en capas** (`entities/scenery/`: `Ridge.js`, `Clouds.js`, `Ground.js`, `index.js` con `LAYER_TYPES`); `entities/Scenery.js` pasa a compositor. Crestas dibujadas en blanco y teñidas por la hora, con un **filo** de luz en la cresta (el sol bajo al atardecer, la luna de noche). Nubes redibujadas en claros (dos formas) con filos de arriba y de abajo derivados del propio sprite (`edgeRows`): blancas de día, doradas por debajo al atardecer, siluetas con filo plateado de noche; su **cobertura** depende de la hora (pocas a mediodía, muchas en el ocaso, cielo despejado de noche): una que sobra se deshace donde está y una que falta entra por la derecha. Los números del escenario salieron de `config.js` (`SCENERY` solo conserva `menuSpeed`) a la escena.
- **Cableado**: el engine es dueño de la escena y de la hora (`setSkyHour`, `setScene`, `getSky`, `getScene`, `setSkyElementVisible`, `setAudioFxEnabled`); la `GameSession` calcula su plan al construirse, empuja la hora cada frame y, tras ganar, reproduce el **epílogo** bajo el panel (desde la hora que se estaba viendo); `AppController` devuelve el cielo del menú al entrar en MENU. Con `prefers-reduced-motion`, el engine vuelca el cielo en `--daino-sky-top/mid/horizon` (≤ 2 Hz) y el degradado del body los usa.
- **Panel dev "Cielo"** (`ui/devTools.js`): hora y fase, anclas del nivel en curso, fijar hora con un deslizador, "Recorrer el ciclo" (de 14:30 a 7:00 en 24 s), efectos del audio sí/no, selector de escena y un interruptor por elemento con nombre.

Desviaciones del plan:
- **El momento synthwave, a 4.5° y no en el horizonte.** La cordillera lejana tapa hasta 130 unidades: con el sol a 0° el disco entero queda detrás. El keyframe `SUNSET` se puso con el sol asomando sobre las crestas, y el menú a esa hora (18:12).
- **El sol vive a la derecha: sale en x 0.72 y se pone en 0.82.** Con la salida al este de verdad (x ≈ 0.3), el sol del amanecer caía en la zona que se lee justo delante del Dino y su halo lavaba a los obstáculos. Y saliendo en 0.62, el panel de resultados (que ocupa ~0.33-0.67) tapaba el epílogo. La luna sí cruza el cielo entero.
- **El halo del sol, antes que el disco.** Sumado encima quemaba el disco a blanco y se perdía el degradado dorado→rosa del ocaso; con máscara aparecía un anillo oscuro. Ahora se pinta el resplandor y el disco encima, como un objeto delante de su propia luz.
- **Neblina de día casi nula y horizonte más oscuro de lo previsto.** La franja de 40-58 unidades (justo sobre la cordillera) es donde vuela el ptero: con la neblina prevista bajaba de 2.5:1. El brillo del día lo dan el sol, las nubes y la parte alta del cielo.
- **Umbral de 2.5:1 para los obstáculos de color** en vez de 3:1 (§2.3, con la maqueta).
- **Halo ancho del sol de día reducido** (0.30 → 0.16): las primeras capturas mostraban medio cielo lavado.

#### Verificación — hecha, con medidas reales

- **Tests**: `tests/js/sky-clock.test.mjs` (8: los 8 oficiales como regresión, 500 estructuras sintéticas con hora monótona y continua, noche en el drop, sin estructura, epílogo, ciclo fijo) y `tests/js/sky-model.test.mjs` (10: sol, luna, estrellas y lucero por hora, la luna cruza y el cielo gira, el menú synthwave, continuidad del color, **guardián a 620 horas** — cada 3 minutos de 0:00 a 7:00 del día siguiente — sin un fallo, el guardián detecta un cielo pastel, nubes por encima del juego, registro completo, degradado CSS). **295 JS** en verde; PHP y Python sin tocar.
- **Continuidad**: el minuto de cielo que más cambia (el ocaso, 18:13) se mueve 0.0126 en OKLab; un salto visible es del orden de 0.05.
- **E2E** con Playwright contra el servidor de Vite, What's Up Danger entero sin colisiones y sin forzar la hora. Hora medida en la partida: 0:30 → 15:12 · 1:40 → 16:49 · 1:58 → 17:13 · 2:08 → 17:46 (hora dorada) · 2:22 → 18:36 (ocaso) · 2:32 → 19:11 (crepúsculo) · 2:38 → 19:41 (noche, el drop del clímax cae en 2:37) · 2:55 → 23:14 · 3:15 → 3:25 · 3:27 → 5:32 (alba) · 3:34 → 6:28; fin 6:36 y, tras el epílogo, 7:00 bajo el panel. **60 FPS en todas las fases** (media 16.67 ms, p95 17.1 ms, en 1280×720). La pausa congela el cielo. Sin errores de consola.
- Capturas a cada hora en el menú y en partida (con obstáculos y HUD); `prefers-reduced-motion` emulado: el degradado CSS y los tintes siguen la hora; el panel dev apaga cada elemento por su nombre.
- **Bundle**: 185.46 KB gzip (176.04 antes, umbral 200). Los módulos nuevos pesan 9.87 KB gzip frente a 1.54 del `Scenery.js` anterior; el resto es el texto del shader, que crece 3.4 KB porque sus comentarios viajan en el bundle (`vite-plugin-glsl` con `compress: false`).

#### Limitaciones que quedan

- **Falta el playtest humano** del reparto de horas (¿se siente la calma antes de la noche?, ¿el amanecer del final llega a tiempo?). Todo está en tablas: `SKY_HOURS`, `SKY_RULES`, las paletas y la escena, y el panel dev deja ver cualquier hora al momento.
- **Alba rápida si el outro es corto**: en What's Up Danger dura 13 s (de noche a sol asomando).
- **Si el clímax dura hasta el final** (Running With the Wolves) el nivel acaba de noche; el amanecer solo se ve en el epílogo, tras ganar.
- El disco del sol cruza el carril de los obstáculos en el ocaso y el amanecer (pequeño y en décimas; ya pasaba con el sol de antes).
- Con `prefers-reduced-motion` no hay sol, luna ni estrellas: solo el degradado y los tintes.
- En pantallas de muy poca altura de mundo (< ~450) las nubes no caben por encima del juego y no salen.
- La luna siempre llena: las fases (una por nivel, por ejemplo) son personalidad de E2.
- Los comentarios del shader viajan en el bundle: `compress: true` de `vite-plugin-glsl` solo en build ahorraría ~2-3 KB gzip (probarlo con el bundle real antes; V3 o Bloque 8).

### E2 — Escenas con personalidad e historia (futuro)

- **Escena por nivel**: columna `levels.scene` (NULL = la de siempre), `scene` en el manifest de oficiales, selector para quien sube la canción (junto a la dificultad) y lectura en el runtime.
- **Cues**: momentos de la historia de una escena anclados a eventos del cielo (`planSky(...).events`: `eveningStart`, `sunDown`, `nightfall`, `dawnStart`, `sunrise`; y `timeAtHour` para cualquier otra hora) o de la canción (inicio del clímax, drops, secciones, final). Un cue es `{ prop, from, to }` o `{ fx, at }`.
- **Primera escena propia, "Costa"** (el ejemplo del user): capa de mar en el horizonte con reflejo del sol y de la luna, costa o acantilado a un lado; el **barco** aparece en el horizonte al alba; el **destello verde** (el "rayo verde" real, que se ve sobre el mar en el último instante del ocaso o el primero del orto) en `sunDown`. Historia de Will y Elizabeth: se separan al anochecer y el barco vuelve con el amanecer del final del nivel.
- **Clima** como props de escena con su propia línea de tiempo: lluvia, niebla, nieve.
- **Elección de escena por el carácter de la canción**, como `MODE_CASTING` elige los modos: tonalidad, energía, bandas y percusividad del análisis del servidor proponen una escena, y quien sube puede cambiarla.
- Opcional: la hora real del jugador en el menú (descartada como menú por defecto en §2.6, puede ser un ajuste).

### V1 — Registro de efectos y panel "Efectos" (siguiente sesión de efectos)

- Registro `EFFECTS` con id, etiqueta, qué señal lo mueve (bandas, FFT, pulso, estructura, tonalidad), qué capa pinta y su ganancia. Migrar lo que ya late: ecualizador, pulso del sol, glow de graves, estrellas por agudos, motas, línea del suelo, tinte del clímax, giro de tonalidad, destello del drop.
- Panel dev: por efecto, encendido, **solo** (ver ese efecto sin los demás) e intensidad. Así el user puede decir "el ecualizador del horizonte, bájale intensidad".
- **Sacar el ecualizador de detrás de las montañas** (§1.C): su propio plano entre crestas o sobre la cordillera.

### V2 — Efectos nuevos, progresivos y repartidos por canción

Ideas del user y propuestas, a decidir en su sesión:
- **Estrellas vivas**: las estrellas del escenario vibran con los golpes y en el clímax se alargan hacia el espectador (salto a la velocidad de la luz). Solo existen de noche, así que no aparecen en todos los niveles por construcción.
- **Partículas de espectro**, como el legacy con p5.js: color según lo grave o agudo del sonido, nacidas en el horizonte y nunca en la franja jugable.
- **Identidad de color por canción**: la tonalidad (analizador 2) fija el tono de los efectos. Mayor más cálido, menor más frío, rueda de quintas → rueda de color.
- Anillos del sol en los primeros tiempos del clímax; aurora en tramos de calma nocturnos.
- **Reparto**: qué efectos tiene un nivel lo decide el carácter de la canción (`EFFECT_CASTING`, como los modos), y se desbloquean con el arco (intro mínima, clímax máximo). Un nivel enseña 2-4 efectos, no todos.

### V3 — Legibilidad y presupuesto de los efectos

El guardián de legibilidad también para los efectos (brillo máximo en la franja jugable), coste de cada efecto en `RenderProfile` (el tier bajo apaga los caros) y efectos apagados con `prefers-reduced-motion`, como hoy.

---

## 4. Orden y dependencias

```
E0 ──► E1 ──► E2 (escenas por nivel, cues, Costa)
         └──► V1 ──► V2 ──► V3
```

- E1 va primero porque separa escenario y efectos (§1.F): V1 registra efectos sobre un cielo que ya no los necesita.
- E2 y V1 no dependen entre sí. E2 necesita E1 (registro de escenas, eventos del cielo). V2 necesita V1 (registro) y aprovecha E1 (estrellas, luna y hora como lienzo).

---

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| El día azul intenso no se lee como "día" | Sol blanco-dorado grande con halo, nubes blancas y neblina clara en el horizonte (detrás de las montañas, fuera de la franja jugable). Revisión con capturas a cada hora. |
| Un obstáculo cruza el sol del atardecer (rosa sobre disco rosa) | Ya pasaba (captura de 1:07 en §1.B). El disco es pequeño y se cruza en décimas. El sol vive en la mitad derecha (E1): nunca delante del Dino. |
| Coste del shader (luna, estrellas giradas, estrella fugaz) | Sin bucles, cálculos locales con recorte por distancia, se quitan las ondas. Medido en E1: 60 FPS en todas las fases de What's Up Danger (p95 17.1 ms). |
| Teñir `Graphics` cada frame rehace el lote | Tintes cuantizados a 8 bits por canal y aplicados solo cuando cambian. |
| `prefers-reduced-motion` no tiene shader | Variables CSS del cielo por hora (≤ 2 Hz); los tintes del escenario siguen la hora. Sol, luna y estrellas no se dibujan (limitación aceptada). |

---

## 6. Ideas descartadas (con motivo)

- **Pájaros al atardecer volviendo a casa.** Serían un buen "aviso de la noche", pero son un animal que vuela: comparten forma con el ptero, y la regla del pulido de la 6c es que un elemento nuevo no comparte forma con otro que hace algo distinto.
- **Teñir los sprites del juego con la luz del cielo.** Rompe el código de colores (§2.2).
- **Día claro sin contorno.** El cactus queda a 1.02:1 (§1.D).
- **Día claro con contorno de 1 píxel en los sprites.** Posible, pero cambia el aspecto de todos los personajes y obstáculos; el user eligió el día azul intenso.
- **Reloj fijo** (atardecer siempre a las 2:00) y **ciclo proporcional**. El primero deja de día las canciones de menos de 2:00 y no sabe dónde está el clímax; el segundo mete una noche de 8 s en un clip de 40 s. El user eligió anclarlo a la música.
