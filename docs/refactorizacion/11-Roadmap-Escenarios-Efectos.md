# Roadmap — Escenarios y efectos visuales (Sep 2026)

> **Qué es este documento.** El user quiere trabajar dos frentes visuales, cada uno con su propia sesión para darle el enfoque que merece:
>
> 1. **Escenario** (trabajos **T01** y **T02**): el cielo y el paisaje. Que el paso del tiempo se sienta (día → atardecer → noche con luna → amanecer) y que la arquitectura permita, más adelante, **escenas con personalidad e historia** por nivel (el ejemplo del user: un nivel con "One Day" de Piratas del Caribe con el mar en el horizonte, un barco que aparece y el destello verde).
> 2. **Efectos al ritmo de la música** (trabajo **T03**): varios efectos, progresivos, que no aparezcan todos en todos los niveles, que se integren en el escenario sin estorbar la vista, que den a cada canción su identidad de color, y un **panel dev** para activarlos por nombre ("el efecto X quítalo").
>
> Se trabaja primero el escenario. Los efectos, en otra sesión.
>
> **Autoridad.** Por debajo de 04, 05, 06, 07, `vout-integration/`, 09 y 10. Refina el doc 06 §3: la Capa 1 deja de ser "el fondo audio-reactivo" y pasa a ser **el cielo del escenario con los efectos encima** (ver §2.4). Para todo lo que es nivel, charter o sincronía, manda el 10.
>
> **Cómo se lee.** Los trabajos de este documento tienen **número global de proyecto** (índice único en [`TRABAJOS.md`](TRABAJOS.md)): **T01** escenario vivo, **T02** escenas por nivel, **T03** efectos con la música. Cada trabajo se hace en **olas** (entregas) con el número del trabajo delante: **T01.2** es la segunda ola del T01. Esos identificadores no se repiten nunca en el proyecto, así que un `T01.2` en un comentario del código solo puede ser esto. Cada ola tiene su casilla en la lista de §3: se marca `[x]` al completarla, y un trabajo se marca cuando están todas sus olas.
>
> **Estado:** T01 casi terminado (T01.1, T01.2 y T01.3 ✅; falta el playtest, T01.4). T02 en curso: diseñado entero con el user (§3, T02); T02.1 (escena por nivel), T02.2 (la Costa), T02.3 (lluvia, tormenta y nieve), T02.4 (ciudad de noche) y T02.5 (Automático por el carácter de la canción) ✅; faltan las historias (T02.6+). T03 sin empezar.

---

## Índice

- [1. Diagnóstico](#1-diagnóstico)
- [2. Decisiones vinculantes](#2-decisiones-vinculantes)
- [3. Los trabajos y sus olas](#3-los-trabajos-y-sus-olas)
- [4. Orden y dependencias](#4-orden-y-dependencias)
- [5. Riesgos](#5-riesgos)
- [6. Ideas descartadas (con motivo)](#6-ideas-descartadas-con-motivo)

---

## 1. Diagnóstico

### 1.A Qué hay hoy en el fondo

Inventario antes del T01. La última columna es la clave de todo este documento: hoy **escenario y efectos viven mezclados en las mismas fórmulas**.

| Elemento | Dónde | Qué lo mueve | ¿Escenario o efecto? |
|---|---|---|---|
| Degradado del cielo (oscuro arriba, violeta en el horizonte) | `background.frag` | `uProgress`: se oscurece con la canción | escenario |
| Estrellas (celdas hash que titilan) | `background.frag` | `uTime`; los agudos las avivan | escenario + efecto |
| Sol synthwave (cian→rosa con rendijas) | `background.frag` | baja con `uProgress`; late con el beat | escenario + efecto |
| Halo del sol | `background.frag` | base constante + graves, pulso, drops | escenario + efecto |
| Glow del horizonte (rosa y cian) | `background.frag` | base constante + graves, pulso, build, flash, agudos | escenario + efecto |
| **Ondas senoidales** | `background.frag` | medios + RMS | efecto — **quitado en la T01.1** |
| Ecualizador pixel (40 barras) | `background.frag` | FFT, intensidad del tramo | efecto |
| Tinte del clímax, destello al beat, break desaturado, giro por cambio de tonalidad | `background.frag` | estructura de la canción (Olas 5 y 6c) | efecto |
| Viñeta | `background.frag` | fija | escenario |
| Montañas (2 crestas en parallax) | `entities/Scenery.js` | scroll | escenario |
| Nubes (4 siluetas oscuras) | `entities/Scenery.js` | deriva propia + parallax | escenario |
| Suelo y su línea de luz | `entities/Scenery.js` | scroll; la línea late con el beat | escenario + efecto |
| Motas (80) | `entities/ParticleLayer.js` | RMS × intensidad | efecto |
| Líneas de velocidad | `entities/SpeedLines.js` | `speedCues` | efecto de juego |
| Drop, lift y marcha: destello, golpe de cámara, ola de partículas | `GameSession.js` | eventos del chart | efecto de juego |

### 1.B El efecto borroso eran las "ondas senoidales" (quitado en la T01.1)

Lo que el user describió ("una especie de nube o difuminación con formas circulares en todo el fondo, se mueve de derecha a izquierda y palpita con el ritmo") era un resto del shader v1 del Bloque 4 que sobrevivió al rediseño:

```glsl
float wave = sin(uv.x * 14.0 + uTime * 1.1) * 0.5 + 0.5;
wave += sin(uv.y * 22.0 - uTime * 0.6) * 0.25;
col += vec3(wave) * (0.018 + mid * 0.10 + rms * 0.06);
```

- La suma de un seno horizontal y otro vertical dibuja un **cartón de huevos**: manchas redondas y difusas. La fase `14x + 1.1t` avanza hacia la izquierda.
- Es **gris** (`vec3(wave)`) y **aditivo** sobre toda la pantalla: lava los colores y emborrona el cielo.
- En el menú suma 0.018 (no se ve). En partida, con medios a 0.5 y RMS a 0.3, llega a ~0.11, y hasta ~0.18 con la música a tope, sobre un cielo de 0.02-0.18: **multiplica el brillo por zonas y late con la canción**.

Verificado con capturas de What's Up Danger en 0:24 y 0:44 (bandas de niebla gris en el tercio superior y la franja media) y después del cambio en 1:07 (cielo limpio). `uMid` y `uRMS` siguen declarados: son parte del bus de audio que usará el T03.

### 1.C Las barras del ecualizador se esconden detrás de las montañas

El user: "se ve bien, solo que a veces parece escondido". Es literal: las barras suben desde el horizonte `bin² × (0.11 + 0.09 · intensidad)` de la altura, 0.03-0.13 con la música típica y como mucho 0.20. La cordillera lejana tiene crestas de hasta ~81 unidades de 620 (0.13; se creía que 130: ver la T02.2) y **se dibuja encima** (el escenario va sobre el shader). Solo asoman por los valles. Es trabajo de la T03.1: el ecualizador necesita su propio plano, no el fondo del fondo. Desde la T02.2 las barras salen de la línea del suelo en cualquier escena (`uGround`): en la Costa el mar las tapa igual que la cordillera.

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
- **Efecto**: lo que reacciona a lo que suena o a la estructura. Tiene **nombre**, vive en un registro (T03.1) y se puede apagar.
- Las bases constantes del halo del sol y del glow del horizonte pasan a la paleta del cielo. Lo que late se queda como efecto, igual que está, hasta la T03.1.

### 2.5 Una escena es un registro

Una escena declara su paleta, su ciclo, sus astros (dónde sale y se pone el sol, cómo es la luna) y sus capas (`ridge`, `clouds`, `ground`… y en el T02 `sea`, props y cues). Añadir una escena es una entrada del registro más, si hace falta, un tipo de capa nuevo. Nada del juego ni del charter cambia.

### 2.6 El menú, al atardecer synthwave

Elegido por el user frente a "hora real del jugador" y "noche con luna": sol con rendijas tocando el horizonte, cielo rosa y violeta, primeras estrellas arriba. Es el aspecto de siempre del menú, ahora coherente con el ciclo. El paso menú → partida va por el fundido a negro que ya existe.

### 2.7 Todo lo que se ve tiene nombre

Cada elemento del escenario (y, desde la T03.1, cada efecto) tiene un id y una etiqueta en español, y un interruptor en el panel dev. Así el user y el desarrollo hablan de lo mismo ("la neblina del horizonte", "el filo de las crestas") en vez de adivinar.

### 2.8 Un escenario tiene tres capas (T02, con el user)

1. **Ambiente** (dónde pasa): genérico y reutilizable (la Cordillera, la Costa, la lluvia…). Está en un **inventario cerrado y probado**: quien sube un nivel elige entre los ambientes curados (pasan el guardián y se ven bien). Por dentro, lugar y clima se componen (una capa de lluvia sirve para cualquier lugar); fuera se enseña una lista de ambientes.
2. **Arco del ambiente** (qué le pasa con la canción): automático. Lee la hora y la estructura del chart, **nunca la señal en vivo** (eso son efectos, §2.4): el cielo del T01, el faro que se enciende al anochecer, la tormenta que arrecia hacia el clímax. Es la personalidad que reciben los niveles de la comunidad sin que nadie programe nada.
3. **Historia de autor** (de UNA canción): momentos coreografiados y props propios, hechos en código, montados sobre un ambiente (One Day = Costa + su historia). Solo en oficiales (o, en el futuro, en un nivel de la comunidad destacado a mano). **Nunca en el inventario**: el barco pirata no puede acabar en un reguetón.

### 2.9 La escena no toca el juego

Ni el chart, ni las marcas, ni los obstáculos. Por eso el autor de un nivel puede cambiar su ambiente **siempre**, también publicado (a diferencia de la dificultad). Un id que un cliente no conozca (una escena más nueva que él) se juega con la de siempre.

### 2.10 Una historia se ancla a su canción

A eventos de la canción (`planSky(...).events`, el clímax, los drops, el final), nunca a segundos puestos a mano: sobrevive a un re-charteo y a un analizador nuevo. Nada con forma de obstáculo en el escenario (§6: los pájaros).

---

## 3. Los trabajos y sus olas

### Lista de control

- [ ] **T01 — Escenario vivo**: el cielo y el paisaje cuentan la canción.
  - [x] T01.1 — Quitar la niebla borrosa del fondo (Sep 2026).
  - [x] T01.2 — Ciclo del cielo (día, atardecer, noche con luna, amanecer) anclado a la canción, escenario en capas y panel dev "Cielo" (Sep 2026).
  - [x] T01.3 — Luna con más detalle y magia (Sep 2026).
  - [ ] T01.4 — Playtest humano del ciclo y ajustes de tablas.
- [ ] **T02 — Escenas con personalidad e historia**: cada nivel puede tener su escenario (§2.8-2.10).
  - [x] T02.1 — Escena por nivel: base de datos, manifest, selector de quien sube, runtime y carga bajo demanda (Sep 2026).
  - [x] T02.2 — La Costa: horizonte despejado, mar con reflejos, islas, faro y arena (Sep 2026).
  - [x] T02.3 — Clima como capa: lluvia/tormenta y nieve, y ambientes compuestos (Sep 2026).
  - [x] T02.4 — Ciudad de noche (Sep 2026).
  - [x] T02.5 — Automático por el carácter de la canción (Sep 2026).
  - [ ] T02.6 — Historias de autor, empezando por One Day.
  - [ ] T02.7+ — Una ola por cada historia nueva.
- [ ] **T03 — Efectos al ritmo de la música**: lo que reacciona a lo que suena.
  - [ ] T03.1 — Registro de efectos con nombre, panel "Efectos" y ecualizador fuera de las montañas.
  - [ ] T03.2 — Efectos nuevos, progresivos y repartidos por canción.
  - [ ] T03.3 — Legibilidad y presupuesto de los efectos.

---

### T01 — Escenario vivo

#### ✅ T01.1 — Quitar la niebla borrosa (Sep 2026)

Ver §1.B.

#### ✅ T01.2 — Ciclo del cielo y escenario vivo (Sep 2026)

##### Qué se construyó (y en qué se desvió del plan, con motivo)

- **Núcleo puro** `resources/js/game/scenes/`, sin Pixi y probado en Node:
  - `color.js`: hex↔sRGB, OKLab (para interpolar sin grises sucios: del azul del día al naranja del ocaso en sRGB sale un marrón) y contraste WCAG.
  - `palettes.js`: `SKY_PALETTES.synthwave`, keyframes por **elevación del sol** (tarde y alba con listas propias, que comparten el pleno día y la noche cerrada: pasar de una a otra no da saltos), `samplePalette` sin asignaciones por frame.
  - `skyModel.js`: `skyStateAt(hora, escena, out)` → sol (posición, tamaño, colores, rendijas, halo), luna, estrellas (visibilidad y giro), lucero, colores de cielo, nubes, montañas y suelo; `skyColorAt` (el mismo degradado que el shader, para el guardián y el CSS); `SKY_PHASES`.
  - `skyClock.js`: `planSky` (§2.1) con `SKY_HOURS`, `SKY_RULES` y `SKY_CYCLES` (`journey`, y `fixed` para escenas de hora quieta); `hourAt`, `timeAtHour`, `phaseAt`, `events` (`eveningStart`, `sunDown`, `nightfall`, `dawnStart`, `sunrise`: los anclajes para los cues del T02) y `epilogue`.
  - `registry.js`: `SCENES` (la "Cordillera"), `SKY_ELEMENTS` (lo que pinta el shader, con su hueco en `uShow0/uShow1`), `sceneElements`, `resolveScene`, `sceneCycle`.
  - `readability.js`: el guardián (§2.3).
- **`assets/palette.js`**: la paleta del pixel art sale de `pixelart.js` (que importa Pixi) para que el guardián mida los mismos colores que se dibujan.
- **Shader v3** (`background.frag`, `audioFilter.js`): grupo `skyUniforms` aparte de `audioUniforms`. Cielo de tres paradas con neblina pegada al horizonte; sol blanco-dorado de día que en la hora dorada crece, se calienta y gana las rendijas; luna pixelada con mares y halo frío; estrellas de una celda que salen de arriba abajo (las brillantes antes) y **giran** alrededor de un polo fuera de pantalla (~15° en una noche: el paso del tiempo); lucero de la tarde y del alba; estrella fugaz rara (una franja de 7 s de cada ~3). Lo que late (halo del beat, glow del horizonte, ecualizador, tinte del clímax, destello, break, giro de tonalidad) sigue igual como efecto. Las bases constantes del halo y del glow pasaron a la paleta. `uProgress` ya no existe (y `songDirector.progress`, que solo servía para poner el sol, tampoco).
- **Escenario en capas** (`entities/scenery/`: `Ridge.js`, `Clouds.js`, `Ground.js`, `index.js` con `LAYER_TYPES`); `entities/Scenery.js` pasa a compositor. Crestas dibujadas en blanco y teñidas por la hora, con un **filo** de luz en la cresta (el sol bajo al atardecer, la luna de noche). Nubes redibujadas en claros (dos formas) con filos de arriba y de abajo derivados del propio sprite (`edgeRows`): blancas de día, doradas por debajo al atardecer, siluetas con filo plateado de noche; su **cobertura** depende de la hora (pocas a mediodía, muchas en el ocaso, cielo despejado de noche): una que sobra se deshace donde está y una que falta entra por la derecha. Los números del escenario salieron de `config.js` (`SCENERY` solo conserva `menuSpeed`) a la escena.
- **Cableado**: el engine es dueño de la escena y de la hora (`setSkyHour`, `setScene`, `getSky`, `getScene`, `setSkyElementVisible`, `setAudioFxEnabled`); la `GameSession` calcula su plan al construirse, empuja la hora cada frame y, tras ganar, reproduce el **epílogo** bajo el panel (desde la hora que se estaba viendo); `AppController` devuelve el cielo del menú al entrar en MENU. Con `prefers-reduced-motion`, el engine vuelca el cielo en `--daino-sky-top/mid/horizon` (≤ 2 Hz) y el degradado del body los usa.
- **Panel dev "Cielo"** (`ui/devTools.js`): hora y fase, anclas del nivel en curso, fijar hora con un deslizador, "Recorrer el ciclo" (de 14:30 a 7:00 en 24 s), efectos del audio sí/no, selector de escena y un interruptor por elemento con nombre.

Desviaciones del plan:
- **El momento synthwave, a 4.5° y no en el horizonte.** Con el sol a 0° el disco queda detrás de la cordillera. El keyframe `SUNSET` se puso con el sol asomando sobre las crestas (ajustado con capturas), y el menú a esa hora (18:12). *(Corrección de la T02.2: aquí se escribió que la cordillera lejana "tapa hasta 130 unidades". Sus crestas llegan a ~81 y sus valles bajan casi al suelo: el hash de las alturas devolvía [−0.5, 0.5) y no [0, 1). El dibujo no cambió; los números y el guardián, sí.)*
- **El sol vive a la derecha: sale en x 0.72 y se pone en 0.82.** Con la salida al este de verdad (x ≈ 0.3), el sol del amanecer caía en la zona que se lee justo delante del Dino y su halo lavaba a los obstáculos. Y saliendo en 0.62, el panel de resultados (que ocupa ~0.33-0.67) tapaba el epílogo. La luna sí cruza el cielo entero.
- **El halo del sol, antes que el disco.** Sumado encima quemaba el disco a blanco y se perdía el degradado dorado→rosa del ocaso; con máscara aparecía un anillo oscuro. Ahora se pinta el resplandor y el disco encima, como un objeto delante de su propia luz.
- **Neblina de día casi nula y horizonte más oscuro de lo previsto.** La franja de 40-58 unidades (justo sobre la cordillera) es donde vuela el ptero: con la neblina prevista bajaba de 2.5:1. El brillo del día lo dan el sol, las nubes y la parte alta del cielo.
- **Umbral de 2.5:1 para los obstáculos de color** en vez de 3:1 (§2.3, con la maqueta).
- **Halo ancho del sol de día reducido** (0.30 → 0.16): las primeras capturas mostraban medio cielo lavado.

##### Verificación — hecha, con medidas reales

- **Tests**: `tests/js/sky-clock.test.mjs` (8: los 8 oficiales como regresión, 500 estructuras sintéticas con hora monótona y continua, noche en el drop, sin estructura, epílogo, ciclo fijo) y `tests/js/sky-model.test.mjs` (10: sol, luna, estrellas y lucero por hora, la luna cruza y el cielo gira, el menú synthwave, continuidad del color, **guardián a 620 horas** — cada 3 minutos de 0:00 a 7:00 del día siguiente — sin un fallo, el guardián detecta un cielo pastel, nubes por encima del juego, registro completo, degradado CSS). **295 JS** en verde; PHP y Python sin tocar.
- **Continuidad**: el minuto de cielo que más cambia (el ocaso, 18:13) se mueve 0.0126 en OKLab; un salto visible es del orden de 0.05.
- **E2E** con Playwright contra el servidor de Vite, What's Up Danger entero sin colisiones y sin forzar la hora. Hora medida en la partida: 0:30 → 15:12 · 1:40 → 16:49 · 1:58 → 17:13 · 2:08 → 17:46 (hora dorada) · 2:22 → 18:36 (ocaso) · 2:32 → 19:11 (crepúsculo) · 2:38 → 19:41 (noche, el drop del clímax cae en 2:37) · 2:55 → 23:14 · 3:15 → 3:25 · 3:27 → 5:32 (alba) · 3:34 → 6:28; fin 6:36 y, tras el epílogo, 7:00 bajo el panel. **60 FPS en todas las fases** (media 16.67 ms, p95 17.1 ms, en 1280×720). La pausa congela el cielo. Sin errores de consola.
- Capturas a cada hora en el menú y en partida (con obstáculos y HUD); `prefers-reduced-motion` emulado: el degradado CSS y los tintes siguen la hora; el panel dev apaga cada elemento por su nombre.
- **Bundle**: 185.46 KB gzip (176.04 antes, umbral 200). Los módulos nuevos pesan 9.87 KB gzip frente a 1.54 del `Scenery.js` anterior; el resto es el texto del shader, que crece 3.4 KB porque sus comentarios viajan en el bundle (`vite-plugin-glsl` con `compress: false`).

##### Limitaciones que quedan

- **Falta el playtest humano** del reparto de horas (¿se siente la calma antes de la noche?, ¿el amanecer del final llega a tiempo?). Todo está en tablas: `SKY_HOURS`, `SKY_RULES`, las paletas y la escena, y el panel dev deja ver cualquier hora al momento.
- **Alba rápida si el outro es corto**: en What's Up Danger dura 13 s (de noche a sol asomando).
- **Si el clímax dura hasta el final** (Running With the Wolves) el nivel acaba de noche; el amanecer solo se ve en el epílogo, tras ganar.
- El disco del sol cruza el carril de los obstáculos en el ocaso y el amanecer (pequeño y en décimas; ya pasaba con el sol de antes).
- Con `prefers-reduced-motion` no hay sol, luna ni estrellas: solo el degradado y los tintes.
- En pantallas de muy poca altura de mundo (< ~450) las nubes no caben por encima del juego y no salen.
- La luna siempre llena: las fases (una por nivel, por ejemplo) son personalidad del T02.
- Los comentarios del shader viajan en el bundle: `compress: true` de `vite-plugin-glsl` solo en build ahorraría ~2-3 KB gzip (probarlo con el bundle real antes; T03.3 o Bloque 8).

#### ✅ T01.3 — Luna con más detalle y magia (Sep 2026)

Tras ver la T01.2, el user: la luna "se ve muy simple al moverse con esos píxeles grandes… poco mágica". Sigue siendo pixel art, pero:
- A **media celda del arte** (solo la luna): más detalle sin salirse del estilo.
- **Volumen**: esfera iluminada desde arriba a la derecha con el brillo en 5 escalones (como un sprite con su paleta); sombra fría y luz cálida.
- **Mares** con ruido suave y **5 cráteres** con el borde encendido.
- **Magia alrededor**: corona cercana, luz ancha que baña el cielo, halo lunar tenue en anillo (~3.4 radios) y un destello que titila en su borde.
- Radio de 0.042 a 0.05 del alto de pantalla. El resplandor usa el mismo borde pixelado que el disco: con el círculo exacto quedaba un contorno de celdas oscuras.

#### ⬜ T01.4 — Playtest humano del ciclo

Jugar niveles largos y cortos y ajustar las tablas (`SKY_HOURS`, `SKY_RULES`, `palettes.js`, la escena): ¿se siente la calma antes de la noche?, ¿el amanecer final llega a tiempo?, ¿el día se lee como día? El panel dev "Cielo" enseña cualquier hora al momento. Con esto se marca el T01.

### T02 — Escenas con personalidad e historia

#### Diseño (con el user, Sep 2026)

El user abrió el T02 con preguntas antes de construir nada: ¿es solo para One Day (aún no está en el catálogo)?, ¿para qué canciones y cómo se eligen?, ¿cómo se desarrolla un escenario propio?, y sobre todo: ¿cómo encaja con que la gente suba sus canciones y cree niveles sin código? Un inventario de escenarios le parecía bien para lo genérico (lluvia, playa), pero no para la personalidad de un nivel. La respuesta es el modelo de tres capas (§2.8).

**Qué es viable y qué no:**

| Opción | ¿Viable? | Por qué |
|---|---|---|
| Inventario de ambientes, elegido por quien sube | ✅ | No toca chart ni marcas: se puede cambiar siempre (§2.9) |
| Arco automático de cada ambiente | ✅ | Es el mecanismo del cielo del T01, generalizado |
| Historias de autor en los oficiales | ✅ | En código, ancladas a eventos de la canción (§2.10) |
| "Automático" por el carácter de la canción | ⚠️ | Como el reparto de modos; el audio no dice "piratas" ni "triste" con fiabilidad: solo encajes claros y, si no, la Cordillera |
| Historia de autor para un nivel destacado de la comunidad | ⏳ | Viable, pero es trabajo a mano |
| Momentos genéricos colocados por quien sube | ⏳ | Solo con el editor (Ola 7, aplazada) |
| Subir imágenes o dibujar escenarios | ❌ | Moderación, derechos, estilo pixel y guardián de legibilidad |
| Elegir por título o letra, o con IA | ❌ | Sin modelos pesados (servidor pequeño), derechos, fiabilidad |
| Historias de autor en el inventario | ❌ | Lo que el user descarta: pierden su sentido |

**Qué canciones tienen historia y cómo se eligen:** un oficial con imágenes reconocibles que se puedan contar en el cielo evocándolas (sin logos ni personajes), con momentos donde anclarlas (clímax, drop, final), y solo si aporta. Candidatas del catálogo actual, por confirmar: Running With the Wolves (lobos y aurora), Time (si es la de Origen: la ciudad que se pliega), What's Up Danger (si es la de Spider-Verse: la ciudad y el salto de fe, que ya coincide con la antigravedad).

**Decisiones del user:**
- **Automático = por el carácter de la canción, con red** (T02.5): el análisis del servidor propone un ambiente solo si el encaje es claro, se mide con los oficiales antes de encenderlo y quien sube ve la propuesta. Si no hay encaje claro, la Cordillera.
- **One Day primero**; las demás historias, una ola cada una.
- **Aún no hay MP3 de One Day**: la historia se construye y se prueba con otra canción, y se hornea como oficial cuando llegue.
- **Primera tanda de ambientes: Costa, lluvia/tormenta, nieve y ciudad de noche.**

#### ✅ T02.1 — Escena por nivel (Sep 2026)

- **Registro** (`scenes/registry.js`): cada escena declara `kind` (`ambient`/`story`), `selectable`, `blurb` (su línea del selector) y `horizonRise`. `SELECTABLE_SCENES`, `AUTO_SCENE`, `SCENE_ID_PATTERN` y `playSceneId(level)`: la elegida si este cliente la conoce; si no, la de siempre (hasta la T02.5).
- **Servidor**: migración `012_add_level_scene.sql` (`levels.scene VARCHAR(32)`, NULL = Automático, CHECK del formato con `BINARY`: con la colación de la tabla, `REGEXP` no distingue mayúsculas); `Services/SceneCatalog.php` (ambientes elegibles, espejo del registro vigilado por un test JS); `Level` (`scene` en `LIST_COLUMNS`, `create` y `updateMetadata`); `LevelPresenter` lo expone; `POST /api/levels/{id}/scene` (`changeScene`: solo el autor, 404 a los demás, 422 si no es elegible, en cualquier estado); el seeder de oficiales lee `scene` del manifiesto (una historia de autor solo llega así).
- **Cliente**: selector "Escenario" en la ficha de los niveles propios (Automático + ambientes, con una muestra del cielo de cada uno calculada con el modelo del cielo: `catalogModel.sceneChoiceView`/`sceneSwatch`); en los ajenos, "Escenario: Costa" entre los datos. `publishTracker.changeScene`.
- **Runtime**: `AppController` carga la escena del nivel (`request.level`, o el nivel propio de una canción local) con `engine.loadScene` mientras sigue el aviso de carga, la pone en `startAttempt` ANTES de crear la sesión (su plan del cielo usa el ciclo de la escena) y el menú vuelve a la de siempre bajo el fundido.
- **Carga bajo demanda**: `entities/scenery/index.js` separa `LAYER_TYPES` (en el bundle: cordillera, nubes, suelo) de `LAZY_LAYER_TYPES` (`import()` literal: mar y faro, 2.7 KB gzip en sus chunks). `engine.loadScene` (async, cae a la Cordillera si el chunk no llega) y `setScene` (síncrona con la escena cargada; desde el panel dev, la carga y la pone al llegar salvo que se pida otra).
- **Panel dev**: el selector de escena carga la que se elija y sigue a la escena vigente (la del nivel en partida).

#### ✅ T02.2 — La Costa (Sep 2026)

- **Horizonte por escena**: `horizonRise` (120 en la Costa). El engine pasa al shader `uHorizon` (el horizonte del cielo) y `uGround` (la línea del suelo, donde se anclan los efectos: el ecualizador sigue saliendo del suelo, tapado por el mar como por la cordillera). Sol, luna, estrellas, lucero y neblina ya iban en fracciones del cielo: el sol se pone en el agua a la vista. Con reduced motion, el degradado CSS termina en la línea del mar (`--daino-sky-horizon-offset`).
- **El mar** (`entities/scenery/Sea.js`, bajo demanda): pixel art en 7 bandas más finas cuanto más lejos, cada una con el color del agua a su distancia (`skyModel.seaColorAt`: refleja el cielo, más a ras del horizonte y menos en la orilla, y se oscurece; el agua profunda la pone la escena, `sea.deep`); crestas en 6 filas con parallax por profundidad que cabecean en dos fotogramas; **reflejo del sol y de la luna** (`seaGlint`): una columna de guiones que titila bajo el astro, larga y encendida con el sol bajo, apagada al ponerse, y plateada de noche. Capa Pixi y no shader: el mar se ve también con reduced motion (sin el reflejo, porque tampoco hay sol ni luna).
- **Islas**: la capa `ridge` gana `anchor: 'horizon'` y `gaps`/`gapRun` (tramos hundidos en rachas): islas y cabos sobre la línea del mar, con el filo de luz de las crestas.
- **El faro** (`entities/scenery/Lighthouse.js` + `lighthouseArt.js`, bajo demanda): torre a rayas en un cabo, teñida con el color de lo lejano. Su arco: la lámpara se enciende al anochecer (con la elevación del sol) y gira toda la noche (el haz se estira y se encoge al girar y la lámpara destella cuando apunta hacia quien mira); al amanecer se apaga. Tan lejos que cruza la pantalla en 3-4 minutos: entra por la derecha al empezar y sigue a la vista cuando anochece.
- **Arena**: `Ground` gana `params.sprite`; tira `groundSand` (paleta `A`/`a`/`b`) en `pixelart.js`, que también gana `artTexture(key, rows)` para que las capas bajo demanda traigan su propio arte.
- **Guardián de legibilidad con cualquier capa**: `scenes/backdrops.js` dice qué pone detrás del juego cada tipo de capa (montañas e islas, mar, faro; nubes y suelo nada) y a qué alturas; un tipo sin entrada hace fallar la prueba. `readability.js` lo usa y el cielo empieza en el horizonte de la escena.

**Hallazgos (y lo que cambió fuera de la Costa):**
- **El hash de las crestas devolvía [−0.5, 0.5), no [0, 1)**: el último `^=` deja un entero con signo. La cordillera se dibujaba con alturas `baseRise ± jag/2` (crestas lejanas de ~1 a ~81, no de 40 a 130). Arreglado (`entities/scenery/ridgeShape.js`) y la cordillera reescrita con `baseRise` −5 y −10: **se dibuja idéntica** (diferencia 0 medida en 4 anchos de vista). Las islas y el mar, que usan el hash como [0, 1), dependían del arreglo.
- **El guardián del T01 medía una cordillera que no existía**: daba por tapado el cielo por debajo de 40 unidades, pero los valles bajan casi al suelo. Ahora mide la forma real (la de la vista más ancha, que contiene a las demás). Con la forma real, la Cordillera fallaba **439 veces** entre el atardecer y el alba: la neblina del horizonte borraba el cristal afilado, el cristal y el portal de la antigravedad a 8-32 unidades; y en la Costa, con el horizonte a la vista, el orbe. **La neblina de las horas cálidas y de luz baja quedó a la mitad** (`GOLDEN`, `SUNSET`, `SUN_DOWN`, `BLUE_HOUR`, `BLUE_DAWN`, `PINK_DAWN`, `SUNRISE`, `LATE_AFTERNOON`, `MORNING` y `LATE_MORNING`; las noches conservan la suya, que es oscura). Las dos escenas pasan con 0 fallos a 620 horas. En el menú el cambio casi no se ve (comparado con una captura del menú del T01).
- **En producción, un chunk bajo demanda que importa Pixi rompía el juego entero**: el reparto por defecto de Rolldown partió Pixi en varios chunks que se importaban en círculo y el build no arrancaba ("Class extends value undefined" en el chunk del CanvasRenderer). En desarrollo no pasa (Vite no parte nada). `vite.config.js` pone **Pixi entero en su propio chunk** (`advancedChunks`). Verificado con el build real: menú, un oficial en la Costa (el mar y el faro se descargan al empezarlo) y una canción local (análisis en el Worker y charter bajo demanda).

**Desviaciones del plan:**
- El cargador de escenas vive en `entities/scenery/index.js` (junto a los tipos de capa), no en `scenes/sceneLoader.js`: el núcleo `scenes/` es puro y sin Pixi.
- La neblina se tocó en la paleta y no con un factor por escena: la necesitaban las dos escenas.
- El brillo del horizonte que late con los graves (un efecto) ahora se ve entero sobre el mar, como una línea de neón; en la Cordillera asomaba por los valles. Se deja como está: su plano y su fuerza son de la T03.1.

**Verificación — hecha, con medidas reales:**
- **Tests**: `tests/js/scenes.test.mjs` (11: registro, lista elegible igual en PHP y JS y mismo patrón que la migración, cada capa con fondo declarado e implementación, escenas del manifiesto, `playSceneId`, selector, el mar sin saltos y más oscuro en la orilla, el reflejo, las islas y la cordillera idéntica, el guardián mide el mar, el guardián mide la forma real y la neblina cabe justa); guardián a 620 horas en las dos escenas. `tests/php/SceneTest.php` (6) y el seeder con escenario en `CatalogTest`. **306 JS, 78 PHP.**
- **E2E** con Playwright y una sesión de prueba: el autor elige Costa en la ficha de su nivel privado (petición, respuesta y BD), lo juega con su MP3 y la partida va en la Costa; un oficial con `scene = coast` en la BD se juega en la Costa desde el catálogo (el mar y el faro se descargan al empezar), acaba bajo el panel con el epílogo en el mar y el menú vuelve a la Cordillera. **60 FPS** en partida en la Costa de día (media 16.64 ms, p95 17.0) y de noche (16.89, p95 17.1), 1280×720. Capturas a cada hora con obstáculos y HUD; reduced motion con el degradado hasta el mar. Sin errores de consola.
- **Bundle** (build real): el chunk principal pasa de 186.1 a 77.9 KB gzip porque Pixi va aparte (140.7 KB); lo que se carga al arrancar suma 220.8 KB frente a 219.2 (principal + Geometry, +1.6). La Costa, 2.7 KB aparte, solo al empezar un nivel con ella.

#### ✅ T02.3 — Clima como capa: lluvia, tormenta y nieve (Sep 2026)

**El arco del ambiente** (§2.8, capa 2), ya como mecanismo general:
- `scenes/weather.js` (puro): una escena declara `arc`, curvas `[[hora, valor]]` en horas continuas (12:00 a 36:00; las 5:00 son 29) para `overcast`, `rain`, `lightning`, `snow` y `windows` (`ARC_KEYS`). `arcAt(escena, hora, out)` las muestrea. **Van por hora, no por segundos**: como la hora ya sigue la estructura de la canción (la noche cae con el clímax y el alba llega con el final), una curva que sube hacia la noche sube hacia el clímax. La tormenta estalla con él sin leer nada más del chart y sin tocar el charter.
- **Cielo encapotado**: `scene.overcast {tint, mix, dark}`. `skyModel.overcastStateAt` vela en OKLab, con la fuerza del arco `overcast`, el cielo, el sol (el disco hacia el color del cielo, halo y brillo apagados), la luna, las estrellas y el lucero, las nubes (más cobertura y más opacas), las montañas, su filo y el suelo. `state.arc` lleva además los colores de la lluvia y de la nieve, sacados del cielo de esa hora: las gotas y los copos se tiñen con la luz.

**Tres ambientes compuestos** (lugar + clima), elegibles en el selector (`SceneCatalog.php` al día):
- **Lluvia**: la Costa bajo una lluvia mansa que arrecia al anochecer y escampa con el alba. Nubes de tormenta (10) y cielo gris azulado.
- **Tormenta**: la Cordillera con relámpagos. La lluvia sube hasta el clímax y los relámpagos empiezan en el ocaso, llegan al máximo con la noche y paran antes del alba.
- **Nieve**: cordillera con las crestas nevadas, suelo nevado ("Suelo nevado") y una nevada que arrecia hacia el clímax y amaina con el alba.

**Capas nuevas** (bajo demanda, cada una en su chunk):
- `entities/scenery/Rain.js`: gotas en dos profundidades, sesgadas por el viento. Las cercanas salpican en el suelo.
- `entities/scenery/Snow.js`: copos de media celda (lejos) y de una celda (cerca) que se mecen y se van hacia atrás con el mundo, más deprisa cuanto más cerca.
- `entities/scenery/Lightning.js`: destello del cielo (aditivo, alfa 0.2, hasta el horizonte) y rayo quebrado con ramas. Va detrás de las montañas y las nubes: las crestas quedan en silueta.
- `Ridge` gana `snowRim`, la nieve de las crestas (elemento "Nieve de las crestas" en el panel dev). `Ground` usa los sprites nuevos `groundSnow` y `groundCity` de `pixelart.js`.

**Los relámpagos y la seguridad:**
- El reloj de relámpagos (`createLightningClock`, `LIGHTNING` en `weather.js`) decide cuándo cae un rayo con la frecuencia del arco: de ~10 s entre rayos a 2.8 s con la tormenta a tope. Nunca sigue al beat: es escenario, no efecto (§2.4).
- Límite WCAG 2.3.1 (≤ 3 destellos por segundo): un rayo son dos destellos y entre dos rayos pasan ≥ 1.4 s. Lo prueba un test sobre 30 minutos de tormenta a tope.
- Apagados con reduced motion y con **"Reducir efectos visuales"** de AJUSTES. Hasta ahora ese interruptor no hacía nada visible: `settings.setReduceEffects` emite `daino:reduceeffectschange` y `AppController` llama `engine.setSceneryFlashes`.

**Presupuesto:** `Scenery.setDetail(particleRatio)` desde `applyBudget` del engine. El tier bajo, y los modales abiertos, tienen menos gotas y copos.

**Guardián:** lluvia, nieve y relámpagos no ponen fondo opaco detrás del juego (`backdrops.js` → `null`). El velo del encapotado sí cambia el cielo, y el guardián lo mide: **0 fallos a 620 horas en las seis escenas**.

**Ajustes tras las capturas:**
- Gotas de una celda de ancho: parecían barrotes. Pasan a media celda y en vertical.
- Copos de 2×2: parecían bloques. Pasan a media celda y una celda.
- De noche los copos se confundían con las estrellas: la Nieve se encapota a 0.9 de noche y las estrellas no salen.
- La nieve de las crestas, fina, se leía como un contorno: ahora mide dos celdas.
- Bajo la tormenta la luna se veía demasiado: el velo la apaga más (alfa × (1 − 0.8 · encapotado)).

**Verificación:**
- **Tests**: `tests/js/weather.test.mjs` (6):
  - las curvas;
  - la tormenta con los oficiales como regresión (estalla con el clímax y escampa con el alba);
  - los arcos de la lluvia, la nieve y la ciudad;
  - el límite WCAG y el hueco entre rayos;
  - sin tormenta no cae ningún rayo y la misma semilla cae igual;
  - la forma del destello.

  En `scenes.test.mjs`, además, el encapotado vela el sol, la luna y las estrellas, y la muestra del selector usa el color de la nieve.
- **E2E**, en 1280×720:
  - 60 FPS en partida: tormenta de noche 16.64 ms (p95 16.9), lluvia 16.65, nieve 16.65.
  - Relámpagos vistos en partida.
  - Con "Reducir efectos visuales", 0 muestras con destello en 12 s, frente a 56 con el interruptor apagado.
  - Con reduced motion no hay relámpagos y la lluvia se queda quieta.

#### ✅ T02.4 — Ciudad de noche (Sep 2026)

- **Ciclo `nocturne`** (`skyClock.js`, `NOCTURNE_RULES`): la ciudad vive la noche entera.
  - Empieza a las 19:00 (hora azul) y anochece hacia el segundo 20 (entre 10 y 32 s, y nunca pasado el 35 % de la canción).
  - La medianoche cae con el clímax (al menos 20 s después del anochecer).
  - El alba y la salida del sol siguen las reglas del ciclo de siempre, pero **el alba nunca antes de que acabe el clímax**. En un clip corto caía encima de él (Last Christmas).
  - Si no cabe el alba, el nivel acaba de noche: una canción muy corta, como mucho a las 23:00; una a la que el clímax no le deja sitio, de madrugada y sin llegar a la primera luz.
  - El menú de la Ciudad, a las 21:30.
- **Skyline** (`entities/scenery/Skyline.js`, bajo demanda, + `skylineShape.js`, puro):
  - Dos filas de edificios en parallax, rasterizadas una vez por tamaño de vista (una celda por píxel) y dibujadas como tiras que se repiten.
  - Teñidas con el color de lo lejano y de lo cercano (el de las montañas).
  - Ventanas en 4 colores y 6 escalones: el arco `windows` las enciende al caer la noche, las tiene casi todas a medianoche y las apaga de madrugada. Tienen luz propia y no se tiñen.
  - Luces rojas en las antenas que parpadean de noche.
  - Suelo "Calle" (`groundCity`).
- **Guardián**: el tipo `skyline` tiene su entrada en `backdrops.js`. Con huecos entre edificios lejanos fallaba **113 veces**: el cristal afilado a ras de suelo quedaba contra el cielo claro de la hora azul. La fila lejana va **sin huecos** (`gapMax: 0`, y `skylineBuildings` llena hasta el borde), y el guardián la da por opaca hasta la altura del edificio más bajo. 0 fallos.
- **Verificación**:
  - `sky-clock.test.mjs` (+2): el ciclo nocturno de los oficiales como regresión (What's Up Danger anochece a 20.7 s, medianoche en 157.2 s y alba en 202.7 s; Running With the Wolves, sin alba porque el clímax llega al final), los clips de 40 s acaban de noche, y 500 estructuras sintéticas empiezan a las 19:00, no retroceden ni saltan y, si tienen alba, dura lo que dicen las reglas.
  - `scenes.test.mjs` (+1): la fila lejana sin huecos, los edificios y las ventanas.
  - E2E con HOPE en la Ciudad: empieza a las 19:00, anochece a 26.7 s, alba a 62.7 s y sol asomando a 79 s. 60 FPS (16.63 ms). El menú vuelve a la Cordillera.

**T02.3 y T02.4 juntas:**
- **Build real** (`bun run build`, verificado en el navegador con `VITE_DEV_SERVER` vacío):
  - Chunk principal 80.0 KB gzip (77.9 tras la T02.2): el arco y el velo van en el modelo del cielo, que se calcula siempre.
  - Aparte, bajo demanda: lluvia 1.25, nieve 1.04, relámpagos 0.77 y ciudad 1.67 KB.
  - Un oficial en la Tormenta descarga los chunks de la lluvia y los relámpagos al empezar; uno en la Ciudad, el del skyline. Sin errores (solo el 404 del favicon).
- **Tests: 316 JS y 78 PHP.**

**Limitaciones:**
- El destello de un relámpago no lo mide el guardián: dura décimas y queda detrás de las montañas.
- Con reduced motion la lluvia y la nieve se ven quietas, y no hay relámpagos.
- La lluvia no moja nada: ni charcos ni el Dino.
- Clima sobre la Ciudad (lluvia de neón): el registro ya lo permite, pero no está entre los ambientes probados.

#### ✅ T02.5 — Automático por el carácter de la canción (Sep 2026)

Lo pedido (§3, decisiones del user): Automático propone un ambiente por cómo suena la canción solo si el encaje es claro; si no, la Cordillera. Se mide con los oficiales antes de encenderlo, y quien sube ve la propuesta. El audio no dice "piratas" ni "Navidad". Sí dice si una canción es intensa, sombría, un bucle de club o una pieza quieta, y eso es lo que se usa.

**Cómo decide:**
- **`levels/songTraits.js`** (puro) mide la canción ENTERA frente a todas las demás. (`songCharacter.js` mide cada tramo frente a su propia canción.) Son ocho rasgos en [0,1], comparables entre canciones:

  | Rasgo | Qué es | De qué sale |
  |---|---|---|
  | `arousal` | Activación | Percusividad de los golpes, pulso marcado, golpes fuertes por minuto, tempo y sonoridad |
  | `valence` | Luminosa (1) o sombría (0) | Modo de la tonalidad (con su confianza) y cuánto rato suenan acordes menores |
  | `drama` | Contrastes | Rango dinámico, y separación entre pasajes fuertes y suaves (ventanas de 4 s, p90 − p25, sin los extremos) |
  | `groove` | Bucle de máquina | Armonía que no se mueve (cambios de acorde por compás) o graves que dominan la mezcla |
  | `sparkle` | Brillo | Nivel de los agudos en la mezcla |
  | `brightHits` / `shimmer` | Brillo de los golpes / brillo entre golpes | El brillo, repartido según la parte aguda del ataque de los golpes |
  | `stillness` | Quietud | Tempo lento y pocos sucesos por minuto |

  `arousal` y `valence` son los dos ejes del modelo circumplejo de las emociones en música. Los demás separan lo que esos dos no distinguen. Todo sale del análisis del servidor de analizador ≥ 2 y de canciones de al menos 20 s. Con el análisis del navegador, un analizador 1 o un clip corto no hay propuesta.
- **`scenes/sceneCasting.js`**: en `SCENE_CASTING`, cada ambiente declara uno o varios **retratos** (rutas) de las canciones que le pegan, con dos o más condiciones sobre los rasgos.
  - El encaje de un retrato es el **producto** de sus condiciones: un solo rasgo nunca basta.
  - Se propone el mejor ambiente si encaja (`minFit` 0.45) y le saca ventaja al segundo (`minMargin` 0.15). Un empate es la Cordillera: una propuesta equivocada es peor que ninguna.
  - La Cordillera no tiene retrato: es la red.
  - `castScene(analysis)` nunca lanza: el escenario no puede impedir chartear un nivel.
  - `SCENE_CASTING_VERSION` 1.

  | Ambiente | Retrato (`why`) | Condiciones |
  |---|---|---|
  | Tormenta | intensa, sombría y con grandes contrastes | activación ≥ media, drama alto, valencia baja |
  | Ciudad de noche | rítmica, en bucle y oscura | activación alta, bucle, valencia no luminosa |
  | Costa | luminosa y bailable | activación alta, brillo de los golpes, valencia luminosa |
  | Costa | tranquila y cálida | calma, valencia muy luminosa, que se mueva (no quieta) |
  | Nieve | tranquila y pausada | calma, quietud, valencia no sombría |
  | Nieve | brillante y cristalina | brillo entre golpes, valencia luminosa, sin bucle de club |
  | Lluvia | melancólica y suave | calma de verdad, valencia sombría, sin brillo ni estallidos |

**Dónde se calcula:**
- **En el servidor**, junto al chart y con el mismo análisis: `scripts/lib/chartFromAnalysis.mjs` devuelve `sceneAuto` y `sceneCasting` (el porqué).
  - El worker lo guarda en **`levels.scene_auto`** (migración `013`). Con el chart de un nivel publicado congelado no cambia: la propuesta es la de su análisis guardado.
  - Los oficiales lo llevan en el horneado (`sceneAuto` y `sceneCasting` con rasgos y encajes) y el seeder lo importa como metadata.
  - `python -m daino_analyzer cast-scenes [--dry-run] [--level=IDS]` (con `scripts/cast-scenes.mjs`) reparte de nuevo los niveles que ya tienen análisis cuando cambian las reglas.
  - `bun run scenes:report [-- x.json]` enseña rasgos y encajes de los oficiales o de cualquier análisis.
- **En el cliente**, solo `scene_auto`: el reparto no viaja en el bundle.
  - `registry.playSceneId`: la elegida, si no la de Automático, si no la Cordillera. `autoSceneId` solo acepta ambientes elegibles que el cliente conoce.
  - Selector de la ficha propia (`catalogModel.sceneChoiceView`): "Automático: Tormenta", con la muestra de ese cielo y "Elegido por cómo suena tu canción". Si no hay propuesta, dice por qué: no encaja con otro ambiente, se está analizando, o se decidirá al publicarla (análisis del navegador).
  - En la ficha ajena: "Escenario: Ciudad de noche".

**Medido con los 8 oficiales y 2 niveles de la comunidad** (`bun run scenes:report`):

| Canción | Automático | Por qué | Encaje | Lo que le pega (juicio) |
|---|---|---|---|---|
| Dawn of Faith | Tormenta | intensa, sombría y con grandes contrastes | 0.70 | Tormenta o Cordillera |
| HOPE | Costa | tranquila y cálida | 0.98 | Costa, Nieve, Lluvia o Cordillera |
| Last Christmas | Nieve | brillante y cristalina | 0.64 | Nieve, Ciudad, Costa o Cordillera |
| Mi Fiesta | Ciudad de noche | rítmica, en bucle y oscura | 1.00 | Ciudad, Costa o Cordillera |
| Running With the Wolves | Cordillera | ningún ambiente encaja | 0 | Tormenta, Nieve o Cordillera |
| Sugar Red | Ciudad de noche | rítmica, en bucle y oscura | 1.00 | Ciudad, Tormenta o Cordillera |
| Time | Nieve | tranquila y pausada | 1.00 | Nieve, Lluvia, Costa o Cordillera |
| What's Up Danger | Ciudad de noche | rítmica, en bucle y oscura (Tormenta 0.05) | 0.60 | Ciudad, Tormenta o Cordillera |
| conga (comunidad) | Costa | luminosa y bailable | 0.81 | — |
| Instrumental (comunidad) | Cordillera | ningún ambiente encaja | 0 | — |

**Robustez:** se aplicaron 14 alteraciones, una a una, a los 8 oficiales, y **ninguno acabó en un ambiente que no le pega**.
- Las alteraciones cubren los errores típicos del analizador y las diferencias de máster: tempo al doble y a la mitad, tonalidad relativa, confianza −0.15, máster ±3 dB, rango ±3 dB, agudos ±2 dB, graves ±1.5 dB y sucesos ±20 %.
- La tonalidad relativa (el error típico del modo) deja siempre sin propuesta, nunca en otra.
- Tempo al doble o a la mitad solo mueve entre Costa y Nieve, que les pegan a las dos.

**Hallazgos:**
- **El brillo solo no distingue una canción de invierno de una latina: brillan las dos.** Las separa de dónde viene. En conga sale de los golpes (congas, timbales: el 44 % del ataque es agudo); en Last Christmas suena entre golpes (campanas, pads: el 27 %). De ahí `brightHits` y `shimmer`.
- **El rango dinámico engaña.** HOPE tiene 24 dB, casi todos por su final en silencio. Lo que cuenta es la separación entre pasajes: 0.10 en HOPE y 0.52 en Dawn of Faith.
- **Un test lo pilló: con energía media, cualquier canción muy en menor salía Lluvia.** Las otras condiciones de su retrato ("sin brillo, sin estallidos") las cumple una canción neutra. Lluvia pide ahora calma de verdad (activación de 0.6 a 0.3).
- **La valencia es el rasgo más frágil** (relativa, paralela, acordes de quinta): nunca decide sola.

**Decisiones (vinculantes):**
- **Automático sale de rasgos absolutos de la canción entera y de retratos de al menos dos condiciones.** Un solo rasgo nunca propone un ambiente.
- **Una propuesta equivocada es peor que ninguna.** Pide encaje y ventaja sobre el segundo; si no, la Cordillera.
- **Se calcula en el servidor con su análisis, junto al chart.** El cliente solo lee `scene_auto`, y lo elegido por el autor (o el `scene` del manifiesto) manda.
- **Cambiar las reglas no re-chartea**: sube `SCENE_CASTING_VERSION`, re-hornea, siembra y `cast-scenes`.

**Verificación:**
- **Tests JS**: `tests/js/scene-casting.test.mjs` (9):
  - los oficiales como regresión;
  - las 14 alteraciones;
  - la tonalidad relativa;
  - la tabla completa y con sentido;
  - un retrato de libro por ambiente, Lluvia incluida;
  - la red: neutro, empate y un rasgo extremo solo;
  - sin análisis del servidor;
  - determinismo;
  - el charter devuelve la propuesta sin cambiar el chart, igual que el horneado.

  En `scenes.test.mjs`, además, el orden de la escena al jugar y los tres textos del selector.
- **Tests PHP**: la API enseña `scene_auto`, ninguna petición lo escribe, CHECK de la BD, y el seeder importa, actualiza y rechaza lo que no es un ambiente elegible.
- **Tests Python**: se guarda con su análisis (también un id malformado y un chart congelado), el contrato con Node usando un análisis real, y `cast-scenes` (dry-run, idempotente, análisis del navegador).
- **Totales**: 326 JS, 81 PHP y 112 Python.
- **Charts idénticos** tras re-hornear: solo se añaden `sceneAuto` y `sceneCasting`.
- **Bundle**: chunk principal 80.26 KB gzip (+0.22). El reparto no viaja al cliente (comprobado en el build: sus textos no están).
- **E2E**:
  - las fichas de los 8 oficiales enseñan su escenario;
  - el selector de un nivel propio muestra los tres estados;
  - Time se juega en la Nieve y Dawn of Faith en la Tormenta, y el menú vuelve a la Cordillera;
  - sin errores.

**Limitaciones:**
- **Calibrado con 10 canciones.** Los retratos se afinarán con más; `cast-scenes --dry-run` y `scenes:report` dicen qué cambiaría.
- **Lluvia no le toca a ninguna de las 10** (ninguna es triste y tranquila): está probada solo con un retrato de libro.
- **Géneros sin datos** (reggae, lo-fi, metal) quedan en la Cordillera salvo encaje claro.
- **Una canción local sin publicar se juega en la Cordillera**: el análisis del navegador no sirve para esto, como para la dificultad.
- **La ficha no enseña el porqué** ("intensa, sombría…"), solo el ambiente. El porqué está en el horneado y en el informe.

#### ⬜ T02.6 — Historias de autor, empezando por One Day

- Sistema de historias: `kind: 'story'` sobre un ambiente, **cues** anclados a eventos de la canción (`planSky(...).events`, clímax, drops, final) → props o momentos; un ciclo propio si la historia lo pide (la puesta del sol en el clímax); panel dev "Historia" (saltar a cada momento, apagar cada prop). Todo cue tiene que resolverse en su canción (test).
- **One Day** (Piratas del Caribe: En el fin del mundo): la escena post-créditos. La Costa, un acantilado a un lado; el sol se pone en el mar y en su último instante, el **destello verde** (el "rayo verde" real); tras él, **el barco emerge del mar** en el horizonte. Barco genérico en pixel art que evoca sin copiar (sin logos ni personajes). A afinar con la estructura real de la canción: se prueba con otra y se hornea y se siembra como oficial cuando llegue el MP3 (`scene` en el manifiesto).

#### ⬜ T02.7+ — Una historia más por ola

- Cuando se elija la canción (candidatas arriba). Cada una, con su ambiente y sus cues.

### T03 — Efectos al ritmo de la música

#### ⬜ T03.1 — Registro de efectos y panel "Efectos" (siguiente sesión de efectos)

- Registro `EFFECTS` con id, etiqueta, qué señal lo mueve (bandas, FFT, pulso, estructura, tonalidad), qué capa pinta y su ganancia. Migrar lo que ya late: ecualizador, pulso del sol, glow de graves, estrellas por agudos, motas, línea del suelo, tinte del clímax, giro de tonalidad, destello del drop.
- Panel dev: por efecto, encendido, **solo** (ver ese efecto sin los demás) e intensidad. Así el user puede decir "el ecualizador del horizonte, bájale intensidad".
- **Sacar el ecualizador de detrás de las montañas** (§1.C): su propio plano entre crestas o sobre la cordillera.

#### ⬜ T03.2 — Efectos nuevos, progresivos y repartidos por canción

Ideas del user y propuestas, a decidir en su sesión:
- **Estrellas vivas**: las estrellas del escenario vibran con los golpes y en el clímax se alargan hacia el espectador (salto a la velocidad de la luz). Solo existen de noche, así que no aparecen en todos los niveles por construcción.
- **Partículas de espectro**, como el legacy con p5.js: color según lo grave o agudo del sonido, nacidas en el horizonte y nunca en la franja jugable.
- **Identidad de color por canción**: la tonalidad (analizador 2) fija el tono de los efectos. Mayor más cálido, menor más frío, rueda de quintas → rueda de color.
- Anillos del sol en los primeros tiempos del clímax; aurora en tramos de calma nocturnos.
- **Reparto**: qué efectos tiene un nivel lo decide el carácter de la canción (`EFFECT_CASTING`, como los modos), y se desbloquean con el arco (intro mínima, clímax máximo). Un nivel enseña 2-4 efectos, no todos.

#### ⬜ T03.3 — Legibilidad y presupuesto de los efectos

El guardián de legibilidad también para los efectos (brillo máximo en la franja jugable), coste de cada efecto en `RenderProfile` (el tier bajo apaga los caros) y efectos apagados con `prefers-reduced-motion`, como hoy.

---

## 4. Orden y dependencias

```
T01 (escenario vivo) ──► T02: T02.1 ──► T02.2 (Costa) ──► T02.3 (clima) ─┐
                    │                    │                T02.4 (ciudad) ─┴─► T02.5 (automático)
                    │                    └──────────────────────────────────► T02.6 (historias, One Day) ──► T02.7+
                    └─► T03 (efectos): T03.1 ──► T03.2 ──► T03.3
```

- El T01 va primero porque separa escenario y efectos (§1.F): la T03.1 registra efectos sobre un cielo que ya no los necesita.
- T02 y T03 no dependen entre sí: se pueden hacer en cualquier orden. El T02 necesita el T01 (registro de escenas, eventos del cielo). La T03.2 necesita la T03.1 (registro) y aprovecha el T01 (estrellas, luna y hora como lienzo).
- Dentro del T02: el automático (T02.5) necesita varios ambientes entre los que elegir; One Day (T02.6) necesita la Costa y, para hornearse, su MP3. T02.3 y T02.4 no dependen entre sí.

---

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| El día azul intenso no se lee como "día" | Sol blanco-dorado grande con halo, nubes blancas y neblina clara en el horizonte (detrás de las montañas, fuera de la franja jugable). Revisión con capturas a cada hora. |
| Un obstáculo cruza el sol del atardecer (rosa sobre disco rosa) | Ya pasaba (captura de 1:07 en §1.B). El disco es pequeño y se cruza en décimas. El sol vive en la mitad derecha (T01.2): nunca delante del Dino. |
| Coste del shader (luna, estrellas giradas, estrella fugaz) | Sin bucles, cálculos locales con recorte por distancia, se quitan las ondas. Medido en la T01.2: 60 FPS en todas las fases de What's Up Danger (p95 17.1 ms). |
| Teñir `Graphics` cada frame rehace el lote | Tintes cuantizados a 8 bits por canal y aplicados solo cuando cambian. |
| `prefers-reduced-motion` no tiene shader | Variables CSS del cielo por hora (≤ 2 Hz); los tintes del escenario siguen la hora. Sol, luna y estrellas no se dibujan (limitación aceptada), y el mar tampoco pinta su reflejo. |
| Un chunk bajo demanda parte Pixi y el build de producción no arranca (visto en la T02.1) | Pixi entero en su chunk (`advancedChunks` en `vite.config.js`). Todo cambio en cómo se parte el bundle se verifica con el build real en el navegador, no con el servidor de Vite. |
| Cada escena nueva engorda el arranque | Sus capas van bajo demanda (`LAZY_LAYER_TYPES`) y traen su arte (`artTexture`). |
| Los relámpagos provocan una crisis fotosensible | Como mucho 2 destellos por rayo y ≥ 1.4 s entre rayos: nunca más de 3 destellos en un segundo (WCAG 2.3.1; lo prueba un test sobre 30 minutos de tormenta a tope). Apagados con reduced motion y con "Reducir efectos visuales" (AJUSTES). El destello solo aclara el cielo detrás de las montañas (alfa 0.2), no la pantalla (T02.3). |
| La lluvia o la nieve tapan el juego o cuestan FPS | Gotas de media celda y tenues, detrás del juego; cuántas caen lo multiplica el presupuesto de render (`setDetail`: el tier bajo y los modales, menos). Medido: 60 FPS con la tormenta a tope (T02.3). |
| "Automático" pone un ambiente que no pega | Solo encajes claros (retratos de ≥ 2 condiciones, encaje y ventaja mínimos), medido con los oficiales y con 14 alteraciones de su análisis sin un solo fallo, y quien sube lo cambia (T02.5). |

---

## 6. Ideas descartadas (con motivo)

- **Pájaros al atardecer volviendo a casa.** Serían un buen "aviso de la noche", pero son un animal que vuela: comparten forma con el ptero, y la regla del pulido de la 6c es que un elemento nuevo no comparte forma con otro que hace algo distinto.
- **Teñir los sprites del juego con la luz del cielo.** Rompe el código de colores (§2.2).
- **Día claro sin contorno.** El cactus queda a 1.02:1 (§1.D).
- **Día claro con contorno de 1 píxel en los sprites.** Posible, pero cambia el aspecto de todos los personajes y obstáculos; el user eligió el día azul intenso.
- **Reloj fijo** (atardecer siempre a las 2:00) y **ciclo proporcional**. El primero deja de día las canciones de menos de 2:00 y no sabe dónde está el clímax; el segundo mete una noche de 8 s en un clip de 40 s. El user eligió anclarlo a la música.
- **Gaviotas en la Costa.** Por lo mismo que los pájaros al atardecer: vuelan como el ptero.
- **Que quien sube suba imágenes o dibuje su escenario.** Moderación, derechos, un estilo que no casa con el pixel art y nada que garantice la legibilidad (T02).
- **Elegir el escenario por el título, la letra o con IA.** Sin modelos pesados en un servidor pequeño, con derechos de por medio y sin fiabilidad (T02).
- **Historias de autor en el inventario de ambientes.** Pierden su sentido: la historia de One Day es de One Day (T02, decisión del user).
- **El mar dentro del shader.** El reflejo sería más fácil, pero con reduced motion (sin shader) la Costa se quedaría sin mar, y el guardián no mediría su color. Es una capa Pixi (T02.2).
