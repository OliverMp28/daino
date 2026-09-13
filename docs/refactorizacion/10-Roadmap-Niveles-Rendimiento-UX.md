# Roadmap — Rediseño de niveles, rendimiento y UX (Sep 2026)

> **Qué es este documento.** Tras retomar el proyecto y jugarlo de verdad, el resultado no convence. Este doc recoge el diagnóstico técnico completo y organiza el trabajo restante en **olas** entregables.
>
> **Por qué "olas" y no "bloques".** Los Bloques 0–7 del doc 08 son constructivos: cada uno añade una capa que antes no existía. Lo que viene ahora atraviesa código ya cerrado (engine, generador, modales, API de niveles). Llamarlos "Bloque 9, 10, 11…" daría a entender que se apilan encima; no es el caso. Una **ola** modifica lo que ya hay.
>
> **Autoridad.** Los docs 04, 05, 07 y `vout-integration/integration-guide.md` siguen por encima de este. Este doc **modifica el doc 06 §4.1** (ver Ola 2) y **sustituye** la descripción de generación de niveles del doc 08 § Bloque 5. Todo lo demás del 06 y del 08 sigue vigente.
>
> **Estado:** Olas 0, 1, 2 y 3 ✅ completas (Sep 2026). Olas 4-7 pendientes.

---

## Índice

- [1. Diagnóstico](#1-diagnóstico)
  - [1.A El juego no está sincronizado con la música](#1a-el-juego-no-está-sincronizado-con-la-música)
  - [1.B Dónde está realmente la lentitud](#1b-dónde-está-realmente-la-lentitud)
  - [1.C Sobre "separar las animaciones por pantalla"](#1c-sobre-separar-las-animaciones-por-pantalla)
  - [1.D Defectos concretos del flujo de niveles](#1d-defectos-concretos-del-flujo-de-niveles)
- [2. Decisiones vinculantes](#2-decisiones-vinculantes)
- [3. Las olas](#3-las-olas)
- [4. Orden y dependencias](#4-orden-y-dependencias)
- [5. Trazabilidad de defectos](#5-trazabilidad-de-defectos)

---

## 1. Diagnóstico

### 1.A El juego no está sincronizado con la música

**Este es el hallazgo principal y explica la sensación de "los niveles se sienten simplones" mejor que ninguna otra cosa.**

`LevelGenerator` guarda en `timeline[].tAt` el instante del **onset musical detectado**. Pero `systems/spawner.js:35` lo interpreta como el instante en que el obstáculo debe **aparecer en el borde derecho del viewport**:

```js
// spawner.js
const SPAWN_OFFSET_PX = 50;
const spawnX = viewportWidth + SPAWN_OFFSET_PX;
while (timeline[cursor].tAt <= audioTime) { /* spawn en spawnX */ }
```

El obstáculo tarda en recorrer la distancia hasta el Dino:

```
tViaje = (viewportWidth + 50 − DINO_X) / gameSpeed
       = (1920 + 50 − 120) / 437  ≈  4.2 s
```

Rango real: **3.1 s** (a 600 px/s) hasta **7.4 s** (a 250 px/s) en un viewport de 1920.

> Un onset en el segundo 30 de la canción se convierte en un salto en el segundo ~34.
> **Cada salto ocurre entre 3 y 7 segundos tarde respecto al beat que lo generó.**

No es que la sincronía sea imprecisa: es que no existe. Y como `tViaje` depende de `viewportWidth`, **dos jugadores con monitores de distinto ancho juegan niveles distintos a partir de la misma seed** — lo que invalida el invariante de determinismo que el Bloque 5 dio por bueno.

Efectos colaterales del mismo defecto:

- Los primeros 4–9 s de toda canción están vacíos (`fillGaps` ya descarta onsets < 1.5 s, y encima hay que sumar el viaje).
- La victoria salta en `audioTime >= durationSec` (`GameSession.js:260`) mientras quedan 3–7 s de obstáculos en pantalla que nunca llegan a ser alcanzables.

**Consecuencia para el roadmap:** esto se arregla en la Ola 3, **antes** de invertir un solo minuto en mejorar la generación. Con el desfase presente, un charter musicalmente perfecto seguiría sintiéndose desacoplado.

---

### 1.B Dónde está realmente la lentitud

#### El 93 % del análisis es una tabla de senos que no existe

`levels/SpectralFlux.js:210-214`, dentro del bucle de mariposas de la FFT:

```js
for (let i = start; i < start + half; i++) {
    const angle = -Math.PI * (i - start) / half;
    const wr = Math.cos(angle);   // ← recalculado para cada i
    const wi = Math.sin(angle);   // ← idem
    ...
}
```

El twiddle factor depende solo de `(size, k)`, no del bloque `i`. Cuentas para una canción de 3:30 @44.1 kHz:

| Magnitud | Valor |
|---|---|
| Hops (`FRAME_SIZE 2048`, `HOP_SIZE 512`) | ~18 080 |
| Mariposas por FFT (`1024 × log₂2048`) | 11 264 |
| Llamadas trigonométricas por hop | 22 528 |
| **Total `Math.cos` + `Math.sin`** | **~407 millones** |

Precomputar la tabla una vez da **3–10×** sin cambiar el resultado numérico. El comentario de cabecera del archivo (`"<1s para un MP3 de 4min"`) es optimista: la medida real es **1.5–6 s en escritorio, 5–15 s en móvil de gama media**.

#### ~280 ms muertos en los yields

`SpectralFlux.js:93` cede el hilo cada 256 hops con `await new Promise(r => setTimeout(r, 0))`. `setTimeout(0)` anidado se clampa a **4 ms** en todos los navegadores tras 5 niveles de anidamiento. Son ~70 yields × 4 ms = **~280 ms de reloj de pared puro**, sin trabajo útil.

#### Las etiquetas de progreso engañan

| Fase | Mensaje | Coste real |
|---|---|---|
| `computeOnsetEnvelope` | `"Analizando audio…"` | **90–95 %** |
| `detectBpm` | `"Detectando BPM…"` | **< 1 %** |
| `pickPeaks` + `filterSpacing` + `fillGaps` + `pickKind` | `"Generando obstáculos…"` | **< 0.1 %** |

Las etiquetas son correctas. Lo que confunde es que la fase cara se anuncia *antes* de empezar y no reporta progreso: se ve "Analizando audio…" fijo durante toda la espera y luego dos parpadeos. Y sí, "generar obstáculos" es literalmente instantáneo — son ~200 iteraciones.

> Comparación con el Daino viejo: allí la espera era por los efectos visuales; aquí es por el chart. El coste se ha movido de sitio pero no ha desaparecido, y el jugador no nota la diferencia.

#### No existe ningún caché

Búsqueda exhaustiva en `resources/js/`: **cero** apariciones de `caches`, `indexedDB` o `serviceWorker`. `localStorage` solo se usa en `ui/settings.js` para volumen/skin/efectos.

Volver a jugar el mismo nivel público repite **todo**: descarga completa del MP3, `decodeAudioData` completo y análisis FFT completo. Lo único que amortigua algo es la cabecera `Cache-Control: private, max-age=300` de `FileUploadService::streamLevelMp3` — la caché de disco del navegador puede servir los bytes durante 5 minutos, pero la decodificación y el análisis nunca se saltan.

Eso responde exactamente a *"¿descargando dónde? ¿y por qué a la segunda vez vuelve a descargarse?"*: se descarga a memoria volátil, y se descarta al volver al menú.

#### El modal tarda 1–1.5 s en abrir

Tres causas sumadas:

1. `openLevelsModal()` abre el `<dialog>` y **después** lanza el fetch. No hay precarga.
2. `Level::findPublic()` hace `WHERE is_public = TRUE ORDER BY created_at DESC` y **no hay índice sobre `is_public`** → full scan + filesort.
3. Cada apertura de pestaña re-consulta; no se cachea nada entre aperturas.

---

### 1.C Sobre "separar las animaciones por pantalla"

> *"el fondo con animaciones se comparte en toda la interfaz y no sé si eso es bueno para el rendimiento […] o si debe ser por separado, cada una especializada u optimizada para su contexto."*

La intuición señala un problema real, pero la solución propuesta lo empeoraría:

- Reconstruir el scene graph en cada transición cuesta más que mantenerlo vivo.
- Se pierde la continuidad menú→partida (el dino ambiente trotando en el mismo punto donde aparece el Dino real, el suelo que no da un salto), que es de lo mejor que tiene el rediseño de Jul 2026.
- Triplica el código de escena para mantener tres variantes de lo mismo.

**El coste real no es compartir. Es que no hay presupuesto por estado.** Hoy todo corre siempre al máximo:

| Problema | Dónde | Por qué importa |
|---|---|---|
| El shader fullscreen corre a `devicePixelRatio` completo y 60 fps **también en MENU**. Ni `filter.resolution` ni `ticker.maxFPS` se fijan en ningún sitio | `engine.js:68-78`, `background.frag:87-171` | Es un pase de fragment shader sobre **cada píxel** con 6–8 transcendentales por píxel. En una pantalla 2× son 4× los píxeles del viewport CSS. **Es el mayor coste de toda la app, y se paga igual en un menú estático.** |
| 80 partículas hacen un `Math.sin` cada una **+ subida completa del buffer a GPU** cada frame, también en MENU | `ParticleLayer.js:70-87`, llamado sin condición desde `engine.js:186` | Movimiento de 8–26 px/s que apenas se ve, al precio íntegro |
| Con un modal abierto, el juego entero se sigue renderizando detrás a 60 fps | `AppController.js:255-290` (PAUSED no toca el engine) | Suspende el `AudioContext`, que congela el tick del engine — pero el ticker de Pixi sigue corriendo y re-renderizando el stage |
| `new Uint8Array(256)` alocado en **cada frame** de partida | `AudioEngine.js:183` | Presión de GC en el bucle de 60 fps |
| Dos caps de `dt` distintos sobre el mismo frame: engine `1/20`, GameSession `1/30` | `engine.js:152` vs `config.js:167` | Incoherencia física entre el mundo y el jugador ante un frame largo |
| Literal de array anidado alocado cada frame | `Scenery.js:141-144` | Menor, pero está en el bucle |

Lo único que hoy está realmente gateado por estado es la visibilidad del dino ambiente y la ruta de audio (FFT/bandas/RMS solo si hay `AudioEngine` atachado).

**La respuesta correcta es una sola escena con perfiles de render declarativos por estado** (Ola 1). Se obtiene lo que se pide — cada contexto optimizado para lo suyo — sin duplicar la escena ni perder la continuidad.

---

### 1.D Defectos concretos del flujo de niveles

| # | Defecto | Ubicación |
|---|---|---|
| **D1** | **Jugar un nivel público crea una fila `levels` nueva y duplicada, propiedad de quien rejuega.** El guard solo comprueba "hay sesión", no "es un nivel nuevo". Jugar 10 veces = 10 filas → el ranking agrega por partida en vez de por nivel | `AppController.js:196-216` |
| **D2** | Los títulos acumulan extensión: se manda `level.title + '.mp3'` → `cancion.mp3.mp3` tras cada rejugada | `modals.js:395` |
| **D3** | `title`/`artist` se validan hasta 200 chars pero la columna es `VARCHAR(120)` → error MySQL 1406 → **500 en vez de 422** | `LevelApiController.php:40-41` vs `002_create_levels_table.sql:14` |
| **D4** | El botón "Jugar" que falla queda **deshabilitado para siempre** con texto "Error"; hay que cerrar y reabrir el modal | `modals.js:350-351` |
| **D5** | `file_path` (ruta interna del servidor) se expone en cada nivel serializado | `LevelApiController.php:225` |
| **D6** | `difficulty: 3` hardcodeado; nunca influye en la generación | `AppController.js:204` |
| **D7** | `?public=1` se parsea y no se usa nunca (público es el fallthrough) | `LevelApiController.php:83` |
| **D8** | **Sin índice en `is_public`** → `findPublic()` es full scan + filesort | `002_create_levels_table.sql` |
| **D9** | El modal abre y *después* pide los datos; nada se precarga al montar el menú | `modals.js:259-263` |
| **D10** | `sampleRate` no se fija al crear el `AudioContext` → el envelope va a 44.1k o 48k según la máquina. **"Misma seed ⇒ misma timeline" solo se cumple por dispositivo** | `AudioEngine.js:48-50` |
| **D11** | Un nivel privado en "Mis niveles" no se puede jugar desde el modal — solo publicar | `modals.js:337-365` |
| **D12** | En modo iframe `client.js` nunca rellena `user`, así que "Mis niveles" y el guardado de progreso **no existen embebidos en Vout** | `api/client.js:80-83` |
| **D13** | `filterSpacing` corre *antes* del filtro `t >= 1.5`, así que onsets descartados consumen presupuesto de espaciado y pueden suprimir un onset legítimo en t=1.6 | `LevelGenerator.js:55` vs `:144` |
| **D14** | `SPAWN_WINDOW_S` está en **segundos**, no en píxeles: a 250 px/s el hueco mínimo son 175 px y a 600 px/s son 420 px. La dificultad efectiva varía **2.4×** según el BPM sin que nadie lo haya afinado | `config.js:158` |
| **D15** | Nada valida que un patrón sea superable: el salto completo dura `2 × 900 / 2500 = 0.72 s`, **más** que el hueco mínimo de 0.70 s | `config.js:15,18,158` |
| **D16** | `pickPeaks` umbraliza solo contra la mediana móvil, sin suelo de energía absoluto, y el envelope se normaliza por su máximo. En un tramo plano el ruido se amplifica y genera onsets: medido, un drone tonal de 10 s produce **237 onsets frente a los 112 de un click track percusivo**. Intros suaves y pistas ambientales reciben obstáculos sin relación con su contenido musical. Descubierto al escribir los tests de la Ola 0; cubierto por un test que documenta el comportamiento actual. **Mitigado en el charter en la Ola 3** (suelo local de fuerza: los picos de ruido ya no llegan a ser obstáculos); la causa en el detector sigue abierta | `SpectralFlux.js` |
| **D17** | `fillGaps` insertaba rellenos a `prev + 1.8 s` con solo 0.1 s de margen al siguiente onset: podía dejar **dos obstáculos a 0.15 s**, muy por debajo del hueco mínimo. Descubierto en la Ola 3 | `LevelGenerator.js` (sustituido por `charter.js`) |
| **D18** | El onset se fechaba **~23 ms antes** de sonar: el flujo espectral asigna al hop el inicio de su frame, pero con ventana Hann la energía pesa en el centro. Medido: mediana −23.0 a −23.4 ms a 90-174 BPM = `FRAME_SIZE/2/sampleRate`. Descubierto en la Ola 3 | `SpectralFlux.js` |
| **D19** | Con los obstáculos ya colocados desde el reloj de audio, la física del Dino integraba con `dt` capado a 33 ms: en cada tirón de frames el salto **se quedaba atrás del mundo** y un jugador que pulsó a tiempo chocaba. Descubierto en el E2E de la Ola 3 (frames de 90-160 ms con la máquina cargada) | `GameSession.js` |
| **D20** | `AudioContext.outputLatency` **vale 0 al empezar a sonar y salta a 40 ms** ~117 ms después (medido en Chrome). Restarla tal cual hacía retroceder el reloj de canción 40 ms de golpe. Descubierto en el E2E de la Ola 3 | `AudioEngine.js` |
| **D21** | **Vout no podía embeber Daino.** Nginx envía `X-Frame-Options: SAMEORIGIN` a todas las respuestas, y Vout es otro origen: el navegador bloqueaba el iframe (`ERR_BLOCKED_BY_RESPONSE`, reproducido con Chrome). El modo embebido entero —bridge, `AUTH_TOKEN`, D12— era inalcanzable. Descubierto en el E2E de la Ola 2 | `docker/nginx/default.conf` |

---

## 2. Decisiones vinculantes

Tomadas explícitamente por el propietario del proyecto en la sesión de planificación (Sep 2026).

### 2.1 Análisis pesado en servidor; charting compartido en JS

Se separan dos responsabilidades que hoy están fundidas en `LevelGenerator`:

| | **ANÁLISIS** | **CHARTING** |
|---|---|---|
| Qué hace | DSP: onsets, beats, downbeats, secciones, energía | Decide qué obstáculo va dónde, con qué dificultad |
| Coste | Alto, segundos o minutos | Trivial, milisegundos |
| Dónde corre | **Sidecar Python** (`librosa`/`madmom` → en la Ola 4 `librosa` + `beat_this`), offline, una vez por canción | **JS puro, compartido**, en el navegador |
| Salida | `analysis.json` | `chart.json` |

Ventaja de la separación: **el charting, que es donde vive la jugabilidad, tiene una sola implementación**. No hay riesgo de que un nivel se comporte distinto según dónde se generó. Y re-chartear (otra dificultad, mejor algoritmo, edición manual) no exige re-analizar.

Se añade un servicio `analyzer` a `docker-compose.yml`. Es el primer servicio no-PHP del stack; se justifica porque el ecosistema MIR de Python (beat tracking, detección de estribillo, separación armónico/percusivo, segmentación estructural) no tiene equivalente realista en PHP ni en JS, y es exactamente el techo que hace falta para el objetivo de "niveles épicos".

> **Lo que NO se hace:** portar la FFT a PHP. 407 M de operaciones trigonométricas en PHP son minutos, no segundos.

### 2.2 Catálogo de fábrica desde `docs/legacy/audios/`

El Daino nuevo no puede arrancar con el catálogo vacío. Se siembran como **niveles oficiales** las 8 pistas del Daino viejo:

```
Dawn of Faith - Eternal Eclipse.mp3      Running With the wolves - Aurora.mp3
HOPE.mp3                                 Sugar Red.mp3
Last Christmas - Cardi B.mp3             Time.mp3
Mi Fiesta.mp3                            What`s Up Danger.mp3
```

Excluidos: `pipipi.mp3` y `quebendicion.mp3` (efectos de inicio/fin de partida del Daino viejo) y `prueba.mp3` (archivo de test).

**Ubicación: `storage/official/` (gitignored), sembrado por script.** `docs/legacy/` ya está gitignored entero, así que los archivos no están en el repo hoy. Se mantiene así a propósito: el remote es un GitHub público y son pistas comerciales; servirlas desde un despliegue personal no comercial es una cosa, commitearlas a un repo público es redistribución. Si se prefiere lo contrario, es una línea del `.gitignore`.

Implicación operativa: un despliegue nuevo necesita copiar los MP3 a `storage/official/` una vez y ejecutar el seed. Paso manual único, documentado en el README de la Ola 4.

### 2.3 La dificultad la elige quien sube la canción, dentro de lo que la canción admite

- **El jugador no elige dificultad.** Cada nivel del catálogo tiene la suya, fija. Se descarta el modelo osu!/Geometry Dash de varias dificultades seleccionables por partida: complica esquema, ranking y UI sin aportar a lo que se busca ahora.
- **Quien sube elige**, entre "Automática" y las dificultades concretas que la pista admita.
- **El sistema calcula el techo de dificultad de cada canción** a partir del análisis (tempo, densidad de onsets, varianza de energía, contenido percusivo) y **solo ofrece el rango viable**. Una balada tranquila no ofrece "Extremo".
- **La generación debe estar realmente hecha para esa dificultad**, no ser un multiplicador aplicado con calzador sobre un chart único. El charter recibe la dificultad como parámetro de primera clase y cambia patrones, densidad y vocabulario de obstáculos, no solo el espaciado.

El charter puede generar cualquier dificultad desde el mismo `analysis.json`, así que si algún día se quiere exponer la elección al jugador, es una migración de `progress`/`rankings` y nada más.

---

## 3. Las olas

### Ola 0 — Quick wins ✅

**Objetivo.** Recoger todo lo que mejora de forma inmediata y medible sin condicionar ninguna decisión de arquitectura posterior. Sesión corta.

**Alcance.**

*Rendimiento del análisis:*
- Tabla de twiddle factors precomputada en `fftRadix2` (`levels/SpectralFlux.js:191-220`). Es el 93 % del coste.
- Subir `YIELD_EVERY` y hacer el yield condicional al entorno (en Node no aporta nada y en el navegador 70 yields cuestan ~280 ms).
- Fijar `sampleRate: 44100` al crear el `AudioContext` (`audio/AudioEngine.js:48-50`) → arregla **D10**.

*Rendimiento del frame loop:*
- Reusar un `Uint8Array` preasignado en `AudioEngine.getFrequencyData` (`:183`).
- Unificar el cap de `dt`: `engine.js:152` pasa a leer `DT_CAP_S` de `config.js:167`.
- Sacar el literal de array del bucle de `Scenery.tick` (`:141-144`).

*Defectos:*
- **D2** (título `.mp3.mp3`), **D3** (validación 200 vs columna 120), **D4** (botón "Jugar" bloqueado tras error), **D5** (`file_path` filtrado), **D7** (`?public=1` muerto).

*Catálogo:*
- Migración `006_add_levels_indexes.sql` con `idx_levels_public_created (is_public, created_at)` → **D8**.
- Precargar `GET /api/levels?public=1` al montar el menú y pintar filas esqueleto en vez de `"Cargando…"` → **D9**.

**Verificación — hecha, con medidas reales.**

| Qué | Antes | Después |
|---|---|---|
| Bucle de mariposas de la FFT, 18 080 hops (Chrome 153) | 21 881 ms | **1 821 ms** — 12× |
| Apertura del modal NIVELES con el menú ya montado | ~1 333 ms + 1 petición | **31,5 ms, 0 peticiones** |
| `EXPLAIN` de `findPublic()` | `type: ALL` + filesort | `type: ref`, `key: idx_levels_public_created`, **sin filesort** |
| Análisis completo de un MP3 real (`HOPE.mp3`), LOADING→PLAYING | — | **1 302 ms** (incluye decode y los 300 ms del fundido) |

Equivalencia numérica de la FFT verificada de tres formas: idéntica **bit a bit** a la implementación anterior sobre 9 tamaños × 5 entradas aleatorias; contrastada contra una DFT ingenua (error máximo 1.86e-6, picos espectrales en los bins esperados); y determinismo del pipeline completo confirmado en Node y en el navegador.

**Suite de tests nueva:** `tests/js/` con `node --test` (built-in de Node 22, **cero dependencias nuevas**), 13 tests, `bun run test`. Cubre corrección de la FFT, determinismo del envelope, invariancia frente al yield, detección de BPM, contrato del objeto Level que consume GameSession, y validez de los `kind` generados contra el registro. Era la primera suite automatizada del repo.

> Hallazgo durante los tests: el defecto **D16** (`pickPeaks` sin suelo de energía absoluto). Documentado con un test que fija el comportamiento actual y falla a propósito cuando la Ola 5 lo corrija.

---

### Ola 1 — Perfiles de render por estado ✅

**Objetivo.** Que cada estado de la app pague solo lo que necesita, manteniendo una única escena continua.

**Alcance.**

- **`resources/js/game/RenderProfile.js`** — tabla declarativa estado → presupuesto:

| Estado | `maxFPS` | `filter.resolution` | Partículas | Barras EQ | Scenery |
|---|---|---|---|---|---|
| `MENU` | 30 | 0.6 | 24 | off | completo |
| `LOADING` | ticker parado *(ya)* | — | — | — | — |
| `PLAYING` | 60 | `min(dpr, 1.5)` | 80 | on | completo |
| `PAUSED` / modal abierto | 15 | 0.5 | congeladas | off | congelado |
| `GAME_OVER` | 30 | 0.75 | 40 | off | completo |

- `engine.js` expone `setRenderProfile(name)`. `AppController.setState()` lo aplica en el punto de conmutación único que ya existe (`:354-364`), junto a `setAmbientDinoVisible`.
- Cap global de `resolution` de la app a `min(devicePixelRatio, 2)`, y resolución propia del filtro por perfil. **Es la palanca de mayor impacto individual**: el pase fullscreen deja de correr a 4× píxeles en un menú.
- Gatear el perfil también por "hay un `<dialog open>`", no solo por estado — hoy un modal abierto no baja nada.
- **Tier adaptativo:** media móvil del tiempo de frame; si supera el presupuesto N frames seguidos, baja un escalón. Cubre el riesgo de doc 06 §11 y absorbe la tarea diferida del Bloque 8 sobre `hardwareConcurrency`.
- Selector **"Calidad: Auto / Alta / Media / Baja"** en el modal AJUSTES, persistido en `daino:quality` siguiendo el patrón ya establecido en `ui/settings.js`.

**Verificación — hecha, con medidas reales.**

Presupuesto aplicado en cada estado, comprobado recorriendo el ciclo completo con un MP3 real:

| Estado | fps | `filter.resolution` | Motas activas | Ticker |
|---|---|---|---|---|
| MENU | 30 | 0.60 | 24 / 80 | activo |
| LOADING | 15 | 0.50 | 0 | **parado** |
| PLAYING | 60 (sin tope) | 1.00 | 80 / 80 | activo |
| PLAYING + modal abierto | 15 | 0.50 | 24 | activo |
| GAME_OVER | 30 | 0.75 | 40 | activo |

Coste de rasterizado medido con renders síncronos forzados (`readPixels` para sincronizar la GPU), viewport 1536×674 @dpr 1.25:

| `filter.resolution` | ms/frame | vs. plena |
|---|---|---|
| 1.00 | 2.78 | 100 % |
| 0.75 | 1.65 | 59 % |
| **0.60** | **1.58** | **57 %** |
| 0.45 | 1.57 | 56 % |

**43 % menos coste de frame** en el menú; combinado con el tope de 30 fps, el menú pasa a costar **~28 %** de lo que costaba. La curva se aplana por debajo de 0.75 en esta GPU (el cuello deja de ser el relleno), pero el tier `low` a 0.45 sí rinde en hardware limitado por fill rate.

Tiers forzados desde AJUSTES verificados (`medium` → 0.70 / 48 motas / 60 fps; `low` → 0.45 / 20 motas / 30 fps) y captura del menú comparada con el estado previo: **sin degradación visible** — el filtro solo afecta al shader de fondo, los sprites pixel-art se rasterizan aparte.

---

### Ola 2 — UX: menú, catálogo y "subir mi canción" ✅

**Objetivo.** Que un jugador nuevo entre, pulse JUGAR y esté jugando, sin tener que pensar en archivos. Y que subir música propia sea una acción evidente y voluntaria.

**Modifica el doc 06 §4.1**, donde JUGAR se describía como "abre el selector/upload de MP3 → lanza nivel".

**Alcance.**

- **JUGAR abre el catálogo de niveles**, no el selector de archivos.
- El catálogo deja de ser un panel lateral estrecho y pasa a ser una **rejilla a pantalla casi completa con tarjetas grandes**: título, artista, estrellas de dificultad, BPM, duración, tu mejor marca, nº de partidas. Los niveles tienen que tener la presencia que tienen en Geometry Dash, no ser una lista de archivos en un cajón lateral.
- **Acción nueva y explícita: "Subir mi canción"**, separada visualmente del bloque de juego. Que se entienda de antemano que ahí es donde pruebas tu propia música — nadie debe pulsar JUGAR y encontrarse un diálogo de archivos por sorpresa.
- Drag & drop sobre la ventana se mantiene como atajo para quien ya lo conoce.
- Pestañas del catálogo: **Oficiales** / **De la comunidad** / **Míos**. Las dos primeras visibles sin sesión.
- Ficha de nivel: reproducir, tu mejor marca, ranking de ese nivel concreto.
- Arreglar **D11** (los niveles privados propios deben poder jugarse) y **D12** (identidad en modo iframe, para que "Míos" y el progreso existan embebidos en Vout).

**Verificación.** Un usuario anónimo en una sesión limpia entra, pulsa JUGAR y está jugando en ≤ 2 s sin haber tocado ningún archivo. Un usuario con sesión ve sus niveles y su mejor marca en las tarjetas.

#### Qué se construyó (y en qué se desvió del plan, con motivo)

**Catálogo de fábrica ya en esta ola (el plan lo dejaba para la Ola 4).** Sin niveles oficiales el criterio de verificación era imposible: JUGAR abriría un catálogo vacío. En vez de esperar al analizador Python, los 8 oficiales se **hornean** con el analizador y el charter JS que ya existen:

- `bun run bake:official` (Node + `ffmpeg`) decodifica cada MP3, lo analiza y genera su chart → `database/seeds/official/baked/<slug>.json` (**sí va al repo**: son tiempos y metadatos, 12-68 KB por canción).
- `composer seed:official -- --from=docs/legacy/audios` verifica el hash de cada MP3 contra su horneado, lo copia a `storage/official/` (**gitignored**) y crea los niveles. Idempotente; un chart de un oficial ya sembrado no se sustituye sin `--rechart` (hay marcas registradas sobre él).
- **Por qué ffmpeg sirve:** el chart solo vale si el decodificador produce las mismas muestras que el del navegador. Medido: ffmpeg 8.1 y Chrome dan **la misma longitud y desfase 0 muestras** (diferencia cuadrática ~2e-10) en 3 MP3 con y sin cabecera LAME. Y de extremo a extremo: el chart que el navegador genera al soltar `Sugar Red.mp3` es **idéntico byte a byte** al horneado.
- La Ola 4 sustituye el horneado por el analizador Python; el script y el seed son el punto de enganche.

**Oficiales sin autor.** `levels.user_id` pasa a admitir NULL (solo si `is_official`) y la identidad estable es `official_slug` (clave del manifiesto). Se descartó un usuario "sistema" (ensucia `users` y el ranking, `vout_id` inventado) y una columna generada `IF(is_official, audio_sha256, NULL)` (MariaDB la rechaza sobre columnas CHAR, error 1901).

**"Nº de partidas" → "jugadores".** No se registran partidas, y un contador anónimo sería trivial de inflar sin rate limiting (Bloque 8). Se muestra el número de jugadores con marca guardada, que sale de `progress` sin coste ni abuso posible.

**Dificultad MEDIDA del chart (D6 a medias).** Las estrellas no podían ser un "3" fijo. `chartStats.js` puntúa densidad de acciones, pasajes apretados, cuota de aéreos y **margen de error de cada acción simulado con la física real**. La dificultad elegida por quien sube sigue siendo de la Ola 5.

> **Hallazgo al medirlo:** la velocidad importa, y al revés de lo intuitivo. A menos px/s el obstáculo tarda más en atravesar al Dino y **el margen se estrecha**: `CACTUS_WIDE` pasa de 398 ms a 600 px/s a **116 ms a 250 px/s**. Las canciones lentas son las más exigentes en timing. Es un dato directo para D14 en la Ola 5.

**Ficha de nivel con ranking propio** (`GET /api/levels/{id}/ranking`: top N + la posición de quien mira aunque no esté en el top).

**NIVELES desaparece del menú**: era la misma lista que ahora abre JUGAR. El menú queda JUGAR / SUBIR MI CANCIÓN / (RANKING · PERFIL · AJUSTES).

**Marcas locales para jugadores sin sesión** (`storage/localBests.js`): la tarjeta muestra la mayor entre servidor y navegador. Daino se juega sin cuenta y reintentar un nivel sin ver tu marca no tiene sentido.

**Precarga al abrir la ficha.** Abrir la ficha de un nivel descarga audio y chart **en paralelo** y decodifica el audio en un `OfflineAudioContext` (sin tocar el AudioContext del juego, que fuera de un gesto quedaría suspendido). Solo se decodifica la última ficha abierta. JUGAR se engancha a la precarga en curso en vez de repetirla.

**D12 — identidad embebida.** `GET /api/me` (Bearer) y `client.js` suscrito a cada `AUTH_TOKEN` del bridge (primero y renovaciones, sin sondeo). Embebido, un 401 ya no intenta `/auth/refresh` (no hay cookie): espera al token siguiente de Vout.

**D21 — descubierto al probar D12.** El iframe ni siquiera cargaba: `X-Frame-Options: SAMEORIGIN` de nginx. La shell envía ahora `Content-Security-Policy: frame-ancestors 'self' <VOUT_ORIGIN>` (validado como origen para no inyectar nada en la cabecera); los navegadores que lo entienden ignoran X-Frame-Options, y el resto sigue protegido por él.

**D11 — niveles privados jugables.** Su audio está en el equipo del autor (Local-First): la ficha ofrece "Elegir MP3 y jugar", el cargador comprueba el hash **antes de decodificar**, usa el chart guardado y guarda el progreso en ESE nivel (no crea otro).

**Avisos en la top layer.** Un `<dialog>` modal tapa cualquier z-index, así que los toasts quedaban debajo del catálogo. `toast.js` los abre como `popover`, y quien abre un diálogo y avisa lo hace en ese orden.

#### Verificación — hecha, con medidas reales

Tests: **108 JS** (+31) y **36 PHP** (+18). Los arreglos clave se comprobaron por mutación (precarga sin enganche, seed sin congelar el chart, pestaña comunidad con oficiales: el test falla). Migraciones 001-008 aplicadas sobre una base vacía sin errores.

| Qué | Resultado |
|---|---|
| JUGAR → rejilla pintada (menú ya montado) | **29-38 ms**, 0 peticiones |
| Tarjeta → ficha | **4-7 ms** |
| Sesión limpia: ficha 1.5 s y JUGAR → partida | **956-1 043 ms** (antes de la precarga con decodificado: 1 802 ms) |
| Sesión limpia: JUGAR nada más abrir la ficha (2:46) | **2 257 ms** (antes: 3 608 ms) — ver limitaciones |
| Decodificado del navegador ffmpeg vs Chrome | misma longitud, **0 muestras** de desfase |
| Chart generado en el navegador vs horneado (Sugar Red) | **idéntico byte a byte** |
| Anónimo: partida de un oficial | **0 POST**; marca local en la tarjeta |
| Embebido (iframe desde el origen de Vout, JWT RS256 real verificado contra JWKS) | carga (D21), `READY → AUTH_TOKEN → /api/me` → usuario, pestaña «Míos», progreso 200, tarjeta y ranking actualizados |
| D11: MP3 correcto / incorrecto | correcto: progreso al nivel, **sin crear otro**; incorrecto: rechazado antes de decodificar, vuelve a la ficha con el aviso visible |
| Publicar desde la ficha | pasa a «De la comunidad» |
| `EXPLAIN` pestaña comunidad / ranking de nivel | `idx_levels_catalog` / `idx_progress_level_points`, **sin filesort** |
| Horneado al día (`bake:official --check` y test JS) | 8/8 |

**PHPStan nivel 6:** 13 errores, todos anteriores (eran 14; la reescritura de `RankingApiController` quitó uno). **Bundle: 149.53 KB gzip** (+5.7 KB).

#### Limitaciones que quedan

- **JUGAR nada más abrir la ficha puede pasar de 2 s** en este entorno: el decodificado de MP3 de Chrome tarda **~1.2 s para una canción de 3 min** en esta máquina (cargada) y el servidor de desarrollo responde en 0.6-1.5 s por petición (Docker Desktop con bind mount en Windows: hasta `/api/health` tarda eso). Con que el jugador mire la ficha un segundo y medio, o con el nivel ya jugado, baja de 1 s.
- El E2E embebido usó una clave RSA de prueba en la caché JWKS y un JWT firmado con ella, no un login real en Vout. La renovación del token confía en que Vout reenvíe `AUTH_TOKEN`; la guía de integración no lo documenta.
- En «De la comunidad» siguen las filas duplicadas que D1 creó antes de la Ola 3 (no se borran datos).
- Con el charter v1 casi todo sale de 3-5★: todavía no sabe generar niveles suaves (Ola 5).

---

### Ola 3 — Motor de niveles I: formato Chart y sincronía real ✅

> **Ola bisagra.** Sin esto, las olas 4–7 no tienen sobre qué apoyarse. Cambia el *contrato*, no todavía el algoritmo.

**Objetivo.** Que el juego esté sincronizado con la música, que el chart sea un artefacto de primera clase persistible y versionado, y que rejugar no cueste nada.

**Alcance.**

**1. Arreglar el desfase (§1.A).**
- La timeline pasa a guardar **`tHit`** — el instante en que el obstáculo alcanza al Dino — en lugar de `tAt` (instante de aparición).
- El spawner posiciona por `x = DINO_X + (tHit − audioTime) × gameSpeed`, **independiente del ancho de ventana**. Deja de haber "momento de spawn"; hay una posición derivada del tiempo.
- Corregir la condición de victoria (`GameSession.js:260`) para que espere a que el último obstáculo salga de pantalla.
- Corregir **D13** (orden de `filterSpacing` vs el filtro de tiempo seguro).

**2. Formato `chart.json` versionado.** Un flujo único de eventos ordenados y discriminados por `type`, para que añadir tipos nuevos no obligue a migrar el esquema ni rompa clientes viejos:

```jsonc
{
  "formatVersion": 1,
  "generator": { "name": "daino-charter", "version": "0.1.0" },
  "audio":  { "durationSec": 212.4, "sampleRate": 44100, "offsetSec": 0.0 },

  // Hechos del análisis. Re-charteable sin re-analizar.
  "music": {
    "bpm": 128.0, "bpmConfidence": 0.93,
    "beatGrid": [0.21, 0.68, 1.15],
    "downbeats": [0.21, 2.08],
    "sections": [{ "startSec": 0, "endSec": 16.2, "label": "intro", "energy": 0.21 }]
  },

  // Decisiones de jugabilidad.
  "difficulty": { "rating": 3, "ceiling": 4, "curve": [{ "tSec": 0, "value": 0.2 }] },
  "world": { "baseSpeedPxS": 420, "speedChanges": [] },
  "events": [
    { "t": 12.34, "type": "obstacle", "kind": "CACTUS_SMALL" },
    { "t": 12.80, "type": "obstacle", "kind": "PTERO" },
    { "t": 64.00, "type": "section",  "label": "chorus" },
    { "t": 64.00, "type": "mode",     "mode": "flight", "untilSec": 88.0 },
    { "t": 80.00, "type": "fx",       "fx": "flash", "intensity": 0.8 }
  ]
}
```

Separar `music` (qué es la canción) de `events` (qué se juega) es lo que permite regenerar el chart con un algoritmo mejor sin volver a analizar, generar otra dificultad al instante, y superponer ediciones manuales (Ola 7).

**3. Persistencia.** Migración `007_add_chart_to_levels.sql`:

| Columna | Tipo | Para qué |
|---|---|---|
| `chart_json` | `MEDIUMTEXT NULL` | El chart. ~8–12 KB crudo, 2–4 KB gz |
| `analysis_json` | `MEDIUMTEXT NULL` | Los hechos musicales, reusables |
| `chart_status` | `ENUM('none','analyzing','ready','failed')` | Estado del pipeline (Ola 4) |
| `chart_version` | `SMALLINT UNSIGNED` | Invalidación cuando cambia el charter |
| `bpm_exact` | `DECIMAL(6,2) NULL` | `bpm` es `SMALLINT`, pierde el decimal |
| `game_speed` | `SMALLINT UNSIGNED NULL` | Congelado con el chart; si se retunea `SPEED_BY_BPM`, los charts publicados no se desincronizan |
| `duration_ms` | `INT UNSIGNED NULL` | `duration_sec INT` pierde precisión que el chart necesita |
| `audio_sha256` | `CHAR(64) NULL` | Identidad del audio: dedupe, ETag, clave de caché |
| `difficulty_ceiling` | `TINYINT UNSIGNED NULL` | Techo calculado (§2.3) |
| `is_official` | `BOOLEAN DEFAULT FALSE` | Catálogo de fábrica |
| `updated_at` | `TIMESTAMP` | — |

Endpoint aparte `GET /api/levels/{id}/chart`: **`chart_json` no puede ir en el listado** (20 filas × 10 KB = 200 KB por apertura del catálogo).

**4. Caché en cliente.**
- MP3 en **Cache API**, clave `audio_sha256`.
- `chart.json` en **IndexedDB**, misma clave.
- Segunda partida del mismo nivel: **cero red, cero decodificación redundante, cero análisis**. Resuelve la queja de "¿por qué vuelve a descargarse?".
- Para la ruta local ("subir mi canción"), cachear el chart por hash del archivo → arrastrar el mismo MP3 dos veces no re-analiza.

**5. Arreglar D1.** `POST /api/levels` deja de dispararse al rejugar. Con `audio_sha256` el endpoint pasa a ser un upsert por `(user_id, audio_sha256)`.

**6. Detalles de serialización.** Redondear `tHit` a 3 decimales (1 ms): los floats crudos son `i / 86.1328125` y se serializan con 17 dígitos significativos — **~30 % del payload es ruido**. Validar `kind` al cargar: un kind desconocido hace que `Obstacle.js:29` lea `.w` de `undefined` y reviente a mitad de partida.

#### Qué se construyó (y en qué se desvió del plan, con motivo)

**Semántica del tiempo: `event.t` = instante de ACCIÓN, no "tHit".** El plan decía guardar el instante de impacto. Antes de escribirlo se midió con la física real: la pulsación que maximiza el margen de error ante un cactus cae **0.355-0.36 s antes** del cruce a 250, 350, 450 y 600 px/s — exactamente el tiempo al ápice del salto. Guardando el instante de acción, **pulsar sobre el beat es la jugada correcta**, y el adelanto (`actionLeadS`) se deriva de la física en runtime: retocar el salto no invalida ningún chart publicado.

**Separación análisis / charting ya en esta ola.** `analyze.js` (hechos musicales, caro, cacheable por hash) y `charter.js` (decisiones de juego, puro, milisegundos). El plan la dejaba implícita para la Ola 4; hacerla ahora es lo que permite cachear el análisis y re-chartear gratis, y que el analizador Python de la Ola 4 produzca el mismo esquema sin tocar el charter.

**Sin cuantización a rejilla global — deliberado.** Medido: el BPM detectado tiene 0.7-1.3 % de error, que son 1.3-2.4 s de deriva en 3 minutos. Cuantizar a una rejilla global habría sacado los obstáculos del beat. Los rellenos se anclan localmente al último golpe real (error ≤ 20 ms); la rejilla global robusta queda para el beat tracking de la Ola 4.

**Física a paso fijo sincronizada con el reloj de audio + pulsaciones fechadas.** No estaba en el plan; lo exigió el E2E (D19). La física avanza en pasos de 1/120 s hasta alcanzar la canción, con la colisión evaluada en el instante exacto de cada paso. Cada pulsación lleva su `event.timeStamp`, se convierte a tiempo de canción y se aplica en su paso. Resultado: el mismo nivel se completa a 144, 60, 30 y **1 FPS**. Además el simulador de jugabilidad usa el mismo paso: lo que valida el charter es exactamente lo que se juega.

**Validación de jugabilidad en el charter.** Simulador headless (`playability.js`) que juega cada chart con la física real y un jugador de ±40 ms; lo imposible se elimina. Adelanta parte de la Ola 5 (D15) porque sin él la sincronía correcta no garantizaba justicia.

**Caché: IndexedDB para todo (no Cache API para el audio).** Un único almacén permite llevar la contabilidad LRU en la misma transacción que los datos. Presupuesto 250 MB / 60 audios, desalojo por último uso, y nunca lanza: una caché rota solo significa volver a descargar.

**Latencia de salida con velocidad de ajuste limitada** (D20): el reloj es siempre monótono.

**SHA-256 con fallback propio.** `crypto.subtle` solo existe en contextos seguros; abrir Daino por `http://IP-de-la-red:8090` lo deja `undefined`. Fallback verificado contra los vectores FIPS 180-2.

**Servidor.** Migración `007` (columnas del plan + CHECKs de formato de hash, `JSON_VALID` y coherencia `ready ⇒ chart`), `ChartValidator` (estructura y límites; el cliente valida la semántica), `POST /api/levels` como upsert por `(usuario, audio_sha256)` con congelado del chart de niveles públicos, `GET /api/levels/{id}/chart` con ETag/304, ETag = hash en `/file`, y **al publicar se rechaza un MP3 cuyo hash no coincide con el del chart**. Los listados ya no traen `chart_json` ni `analysis_json` del modelo.

#### Verificación — hecha, con medidas reales

Tests: **77 JS** (`bun run test`) y **18 PHP** (`docker compose exec -T php composer test`, dentro de una transacción que se revierte). Cada arreglo de defecto tiene un test de regresión, y los críticos se comprobaron por mutación (romper el código hace fallar el test).

| Qué | Resultado |
|---|---|
| Eventos del chart sobre el golpe real (click tracks 90/128/150 BPM, 4 min) | **176/177, 250/250, 294/294 a ±15 ms; error mediano 0.0 ms** |
| Picos de ruido convertidos en obstáculo (tras el suelo local) | **0** en 5 pistas; golpes reales conservados 134/134 … 346/347 |
| Cruce real del obstáculo con el Dino vs. instante del chart (navegador) | **0 ms** de error, a 1536 y a 1024 px |
| Charter de una canción de 4 min | **16.5 ms** (lineal: ×8 de duración → ×8.1 de tiempo) |
| Nivel completo con un jugador que actúa en el beat (navegador, 40 s) | **Victoria**, 35/35 eventos, a ~50 FPS y a **1 FPS** |
| Nivel del catálogo, 1ª partida | descarga audio + chart, **no analiza** |
| Mismo nivel tras recargar la página | **0 peticiones**, audio y chart desde IndexedDB |
| Mismo nivel sin recargar | **0 peticiones, 0 decodificación, 0 análisis** — solo "Preparando nivel…" |
| MP3 local ya jugado antes | sin fase de análisis (análisis desde IndexedDB) |
| Hash del navegador vs. `sha256sum` del archivo | **idénticos** |
| Revalidación HTTP de chart y audio | **304, 0 bytes** |
| Latencia de salida medida en Chrome | 0 → 40 ms a los 117 ms (D20) |

**Bundle: 143.81 KB gzip** (+9.8 KB sobre la Ola 1: charter, simulador, caché, SHA-256, cargador). Holgado bajo 200 KB.

#### Limitaciones que quedan

- **Guardar niveles locales exige sesión con Vout**, que en desarrollo está apagado: el camino `POST /api/levels` está probado en PHP en proceso, no de extremo a extremo con un JWT real.
- Niveles publicados antes de la Ola 3 (sin chart) se juegan generando el chart en el cliente con su `generator_seed`, así que el primer jugador de cada uno sí analiza. Se regenerarán en servidor con la Ola 4.
- `difficulty` sigue fija en 3 (D6, Ola 5). Las filas duplicadas que D1 creó antes de esta ola siguen en la BD; no se han borrado datos.
- Un tirón de frames muy largo con una tecla pulsada durante él se aplica bien gracias al sellado temporal, pero el jugador no ha podido VER nada en ese intervalo: a partir de cierto nivel de carga el juego no es jugable para una persona, aunque el motor siga en sincronía.

---

### Ola 4 — Motor de niveles II: analizador en servidor ✅

**Objetivo.** Mover el coste del análisis al momento de publicar, de una vez y para siempre. A partir de aquí, **el jugador no analiza nada nunca**.

**Alcance.**

- **Servicio `analyzer`** en `docker-compose.yml`: Python + `ffmpeg` + `librosa`/`madmom`. API interna en la red `daino`:
  - `POST /analyze` → `{ job_id }`
  - `GET /jobs/{id}` → `{ status, progress, result? }`

  Asíncrono de verdad: PHP-FPM no bloquea un worker durante el análisis, y **el tiempo de análisis puede crecer sin límite** sin que nadie lo sufra. Ese es justamente el punto — abre la puerta a análisis mucho más caros en el futuro.

- **Flujo de publicación:** subir MP3 → `chart_status = 'analyzing'` → el frontend hace poll sobre `GET /api/levels/{id}` → `ready`. El que sube ve una barra de progreso honesta; el que juega después no espera nada.

- **`analysis.json` guarda:** beats, downbeats, secciones estructurales con etiqueta, curva de energía, onsets separados por banda, contenido percusivo vs armónico, confianza de tempo.

- **Techo de dificultad** (§2.3): se deriva del análisis y se guarda en `difficulty_ceiling`. El formulario de subida solo ofrece el rango viable más "Automática".

- **Ruta local conservada.** El generador JS actual sigue existiendo para "subir mi canción" sin publicar — es el invariante *Local-First* del `CLAUDE.md` y lo que permite jugar música propia sin sesión. Se mueve a un **Web Worker** para que deje de congelar la UI, y produce el **mismo esquema** `analysis.json` con menos riqueza. El charter, compartido, funciona igual con ambos.

- **Seed del catálogo oficial:** ✅ adelantado a la Ola 2 con el analizador JS (`bun run bake:official` + `composer seed:official`). Aquí queda re-hornear los 8 oficiales con el analizador Python (`--rechart`) y enganchar el script de horneado al servicio.

**Notas técnicas que no se pueden pasar por alto:**
- **Desfase del decodificador.** `ffmpeg` y el decodificador MP3 del navegador tratan el encoder delay/padding de forma distinta (~26 ms, a veces hasta ~100 ms). El reloj del juego es `ctx.currentTime − _playStartedAt` sobre el buffer decodificado *por el navegador*. Por eso `chart.json` lleva `audio.offsetSec`: permite corregirlo sin regenerar nada.
- **Duración.** Guardar la del servidor pero dejar que el cliente prefiera `audioBuffer.duration` para la condición de victoria.

**Verificación.** Publicar una canción, ver progreso de análisis real, y que otro usuario (otra sesión, otro navegador) la juegue **sin ninguna fase de análisis**. Ejecutar el seed en una BD limpia y comprobar 8 niveles oficiales jugables.

#### Qué se construyó (y en qué se desvió del plan, con motivo)

**Cola en la base de datos, no una API HTTP interna.** El plan pedía `POST /analyze` + `GET /jobs/{id}`. Se hizo una tabla `analysis_jobs` (migración `009`) que PHP rellena y el worker Python consume con `SELECT … FOR UPDATE SKIP LOCKED`. Motivos: encolar va **en la misma transacción** que marcar el nivel como pendiente (no hay nivel "analizándose" sin trabajo, ni trabajo sin nivel); los trabajos sobreviven a reinicios de cualquiera de los dos servicios; escalar es `docker compose up --scale analyzer=N` sin coordinación; y no se abre ninguna superficie HTTP nueva. El worker renueva una reserva de 90 s (por tiempo, no solo al llegar progreso), se reintenta con espera exponencial ante fallos transitorios, falla sin reintentar ante los permanentes, detecta cancelaciones al renovar y un `docker stop` devuelve el trabajo sin gastar intento. `audio_analyses` cachea el análisis por `(sha256, analizador)`: la misma canción subida por otra persona no se vuelve a analizar.

**Publicación diferida.** `POST /api/levels/{id}/upload` guarda el MP3 y, con `ANALYZER_ENABLED=true`, responde **202**: el nivel queda `pending_public` y **no aparece en el catálogo hasta que el servidor lo ha analizado** (así todo nivel público se juega con el chart del servidor, no con el del navegador de quien lo subió). `GET /api/levels/{id}/analysis` da estado, etapa, progreso y posición en la cola; `POST` reintenta tras un fallo. Con `ANALYZER_ENABLED=false` se publica al instante como en la Ola 3: el sistema degrada, no se rompe. Retirar un nivel cancela su análisis; un nivel ya público conserva su chart salvo reanálisis explícito (`composer analysis:enqueue -- --level=…`).

**beat_this en vez de madmom.** madmom está sin mantenimiento (última versión en 2018) y no instala en Python 3.12 con NumPy 2. beat_this (CPJKU, ISMIR 2024, MIT) es el estado del arte en beats y downbeats. Su rejilla es de 20 ms, así que cada beat se afina al pico de ataque real en ±35 ms. Encima: normalización del nivel métrico (una canción no salta de 80 a 160 BPM a mitad), relleno de beats en huecos sin percusión y ninguno en los silencios, onsets en dB con suelo absoluto (**D16 resuelto en el servidor**: un acorde sostenido da ≤ 3 onsets; el JS daba 237 en un drone), latencia del detector corregida (−9 ms, medida por instrumento) y "color" de cada ataque (graves/medios/agudos) en vez de clasificar bandas con umbrales. Secciones por segmentación laplaciana (McFee & Ellis 2014) con rol heurístico (intro, estrofa, estribillo, puente, break, outro), curva de energía y rasgos (`percussiveRatio`, eventos fuertes por minuto, estabilidad del tempo…). Todo en `analysis.json` formato 2, validado igual en Python (`schema.py`) y en PHP (`ChartValidator`).

**El charting sigue siendo JS, uno solo.** El worker llama a `node scripts/chart-from-analysis.mjs`, que usa el mismo `charter.js` que el navegador. **Charter v2**: con beats reales los rellenos caen en ESOS beats (no en una extrapolación), y la velocidad sale del pulso jugable (`gameplayTempo`: una canción a 63 BPM se juega con la velocidad de 126). Hacía falta porque el servidor reporta el tempo que marcaría una persona, que en las canciones lentas es la mitad del que daba el analizador JS; sin ello pasarían a scroll lento, que es donde **menos** margen hay (hallazgo de la Ola 2).

**Techo de dificultad calculado y guardado, pero el selector se aplaza a la Ola 5.** `difficultyCeiling.js` lo deriva de la densidad musical efectiva, calibrado con 10 temas reales, y se guarda en `difficulty_ceiling`. **No se ofrece elegir dificultad todavía**: el charter aún no genera un nivel distinto por dificultad, y ofrecer la etiqueta sería exactamente el "añadido con calzador" que la decisión §2.3 prohíbe. La prueba de que hace falta: HOPE y Time tienen techo 2 y su chart actual mide 4★.

**Sin `audio.offsetSec`.** El plan temía un desfase entre ffmpeg y el navegador. Medido: el ffmpeg 7.1 de Debian trixie (el de la imagen) decodifica **bit a bit** igual que ffmpeg 8.1, que ya coincidía con Chrome (Ola 2), en los 13 MP3 disponibles (los 11 del legacy y 2 subidos por usuarios). Por eso la imagen es trixie y no hace falta corregir nada.

**Catálogo oficial re-horneado con el servidor.** `docker compose run … analyzer bake-official` analiza en Python y chartea con `bake-official.mjs`; `composer seed:official -- --rechart` lo aplica. El test de horneados exige ahora análisis de formato 2 y comprueba techo y densidad.

**Interfaz de publicación.** La ficha enseña el progreso real con palabras de jugador ("Buscando el pulso", "Reconociendo estrofas y estribillos"), la posición en la cola, y ante un fallo un texto comprensible con "Reintentar análisis" solo si reintentar puede salir bien (un archivo que no es audio pide publicar otro). `api/analysisWatcher.js` hace un solo sondeo por nivel con ritmo adaptado (1.5 s analizando, 4 s en cola, 15 s con la pestaña oculta, espera creciente ante errores) y sigue aunque se cierre el catálogo: al terminar avisa con un toast, que espera si se está jugando. Recargar a mitad de un análisis lo retoma. La caché de charts del cliente usa `chart_hash` en la clave: un chart sustituido en la misma versión del charter no se sirve viejo.

**Ruta local en un Web Worker.** "Subir mi canción" analiza en `analysisWorker.js`. El hilo principal solo mezcla a mono y transfiere el buffer; el resultado es **idéntico bit a bit** al del hilo principal (misma caché), y si el Worker no puede crearse o se cae se analiza en el hilo principal. El render ya no se congela durante el análisis.

**Limpieza de D1.** `composer levels:dedupe-legacy` (simulación por defecto, `--apply`) fusiona las filas duplicadas anteriores a la Ola 3: conserva una por canción y mueve progreso (la mejor marca gana) y comentarios. Aplicado sobre la BD de desarrollo.

**Defectos encontrados en la verificación de esta ola, corregidos antes de cerrarla:**
- En desarrollo, el Worker no arrancaba: el script llega del servidor de Vite (otro origen) y el navegador lo prohíbe. Arranque desde un Blob solo en desarrollo.
- En producción tampoco habría arrancado, por dos motivos que el E2E en desarrollo no podía ver: Vite solo empaqueta un Worker si ve la expresión `new Worker(new URL(…))` literal (con la URL construida en otra función lo metía como `data:` sin sus imports), y sin `base` en `vite.config.js` la URL salía como `/assets/…` en vez de `/build/assets/…`. Ambos fallos acababan analizando en el hilo principal **sin ningún error visible**. Verificado después con el bundle real en Chrome.
- `GET /analysis` devolvía el mensaje del worker, que incluye la salida de ffmpeg y rutas internas del servidor. Ahora solo el código; la UI lo traduce.
- La reserva del trabajo solo se renovaba al llegar progreso: la etapa del pulso de una canción muy larga podía superar los 90 s sin mensajes y otro worker habría repetido el trabajo.
- Un `docker stop` gastaba un intento y retrasaba 30 s el trabajo: tres despliegues seguidos habrían dado por fallida una canción buena.
- Un fallo de hash detectado al completar dejaba el nivel pendiente para siempre.
- El contenedor montaba la raíz del proyecto: no recibía secretos por entorno, pero podía leer `.env`, las sesiones y el volcado del legacy. Ahora monta solo lo que usa.
- `torchaudio` iba sin versión (la imagen instalaba 2.11 con torch 2.14 mientras el comentario decía "misma versión"). Fijado y explicado.

#### Verificación — hecha, con medidas reales

Tests: **136 JS** (+28), **53 PHP** (+17) y **70 Python** (50 de análisis contra música sintética con verdad conocida y `mir_eval`, 20 de cola y worker contra una BD real desechable). Los arreglos clave se comprobaron por mutación (renovación de la reserva, mezcla a mono del Worker: el test falla).

| Qué | Resultado |
|---|---|
| Beats / downbeats (sintético, F-measure) | **≥ 0.95 / ≥ 0.90**; sesgo mediano ≤ 3 ms, p90 ≤ 6 ms, peor beat ≤ 25 ms; tempo ±1 %; accelerando seguido (F ≥ 0.9) |
| Onsets | sesgo ≤ 3 ms; bombo, caja y hi-hat, en silencio y sobre colchón, ≤ 5.5 ms; acorde sostenido ≤ 3 onsets (D16) |
| Secciones (sintético) | fronteras con F ≥ 0.8 dentro de un compás; el estribillo repetido se reconoce como el mismo material |
| Tempo en temas reales, JS → servidor | HOPE 161.5 → **79.9**, Time 126 → **63.0**, Dawn of Faith 132.5 → **65.0** (el JS doblaba las lentas); el resto igual ±1 BPM |
| Decodificado ffmpeg de la imagen vs ffmpeg 8.1 | **PCM idéntico bit a bit** en 13/13 MP3 (hash del float32 decodificado) |
| Horneado de los 8 oficiales | 2 min 36 s (6.5-28 s por canción, el primero con carga del modelo) |
| Publicar Time (2:46) desde la ficha | 202 → progreso en vivo → **publicado en ~20 s** → toast → la ficha pasa a "Jugar" |
| Publicar HOPE (1:19) | etapas visibles (11 % pulso → 76 % secciones) → **publicado en 13 s** |
| Reanálisis de una canción ya analizada | **1.65 s** (análisis de caché), chart idéntico |
| Archivo que no es audio | fallo en 3 s, "Sin publicar", texto comprensible, sin "Reintentar"; reintento de un fallo transitorio → vuelve a la cola → aviso |
| Niveles sin chart anteriores a la Ola 3 (backfill) | 2/2 analizados y charteados (20-26 s) |
| Oficial y nivel de comunidad desde el catálogo | juegan con el chart del servidor; claves de caché con `chart_hash`; **0 errores de consola** |
| "Subir mi canción" con Time (2:46) | análisis en el Worker **2.8 s** con el hilo principal a **61 FPS** (antes: render congelado) |
| Worker del bundle de producción en Chrome | carga desde `/build/assets/`, 120.2 BPM sobre un metrónomo de 120, buffer transferido |
| `docker stop` durante un análisis / etapa larga sin progreso | trabajo de vuelta a la cola sin gastar intento / reserva renovada |

**PHPStan nivel 6:** 13 errores, todos anteriores. **Bundle: 153.58 KB gzip** (+4.05 KB) + Worker de 5 KB aparte. Imagen del analizador: 2.16 GB (PyTorch CPU y modelo dentro).

#### Limitaciones que quedan

- **El charter todavía no usa secciones, downbeats ni el techo.** Todos los oficiales salen a 3-4★ con 50-64 acciones/min, incluidas canciones suaves de techo 2. Es el trabajo de la Ola 5, que ahora sí tiene los hechos musicales que necesita.
- **Quien sube no elige dificultad todavía** (ver arriba, Ola 5).
- La etapa del pulso (la más larga, ~60 % del tiempo) no informa de progreso intermedio: la barra se queda en ~11 % con un brillo que indica que sigue vivo.
- Los roles de sección son heurísticos: comprobados con verdad conocida en sintético y plausibles en los 10 temas reales, sin anotación humana de esos temas.
- El charter importa `pixi.js` en Node (vía `physics.js → Dino.js`): el contenedor necesita `node_modules` y cada chart paga ese arranque. Candidato a separar en la Ola 5.
- El primer trabajo tras arrancar el servicio carga el modelo (~10 s más).
- Seguimiento por sondeo adaptativo, no por eventos del servidor: suficiente a esta escala.
- Los niveles privados guardados con el análisis JS no se reanalizan hasta que se publican.
- El E2E volvió a usar una clave RSA de prueba en la caché JWKS con un usuario desechable (borrado al terminar), no un login real en Vout.

---

### Ola 5 — Motor de niveles III: charter musical

**Objetivo.** Que los niveles dejen de sentirse simplones. Todo lo de esta ola es **lógica pura sobre `analysis.json`, sin DSP** — por eso se puede iterar rápido y testear sin audio.

**Alcance.**

- **Cuantización a la rejilla de beats.** Colocar obstáculos en subdivisiones (1/1, 1/2, 1/4, tresillos) en lugar de en picos crudos de onset. Es el cambio individual que más hace por la sensación de ir al ritmo: los picos crudos son ruidosos y no coinciden con cómo se percibe el pulso. Es también el estándar en charting de juegos de ritmo — los charters humanos "snapean" a la rejilla, no a la forma de onda.
- **Patrones en vez de colocación uno-a-uno.** Un vocabulario de figuras rítmicas cortas (síncopa, tresillo, ráfaga, respiración, llamada-respuesta) seleccionadas según la sección y la dificultad. Un obstáculo por onset es exactamente lo que hace que un chart automático se sienta a "test de aporrear botones" en vez de a interpretar la canción.
- **Curva de dificultad guiada por la estructura.** Intro suave, escalada hacia el estribillo, respiro en el puente, clímax final. Sale directo de `music.sections`.
- **Validación de jugabilidad.** Nada valida hoy que un patrón sea superable (**D15**). El charter debe simular la física antes de emitir: `systems/physics.js` ya son funciones puras sin dependencia de Pixi, así que se ejecuta headless. Rechazar y re-generar lo imposible.
- **Separación en píxeles, no en segundos** (**D14**): la dificultad efectiva deja de variar 2.4× con el BPM.
- **Dificultad como parámetro de primera clase** (**D6**): cambia patrones, densidad y vocabulario, no solo el espaciado. Cualquier dificultad generable desde el mismo análisis.

**Verificación.** Smoke de determinismo (misma entrada + misma seed ⇒ mismo `chart.json` byte a byte). Validador automático que garantice **0 patrones imposibles** sobre las 8 canciones oficiales en todas sus dificultades. Playtest manual — este es el criterio que manda.

---

### Ola 6 — Vocabulario de juego ampliado

**Objetivo.** Que no todo sea saltar. Que un nivel pueda tener momentos.

**Alcance.**

- **Abstracción de modos de movimiento.** Hoy `physics.js::integrateDino` asume correr/saltar. Pasa a despachar por modo, lo que abre la puerta a vuelo, gravedad invertida, o lo que se decida. El refactor es limpio porque `physics.js` ya es puro y está separado de las entidades.
- **Eventos `mode` y `fx` del chart cableados al runtime.**
- Obstáculos y momentos especiales anclados a la estructura musical (un cambio de modo al entrar al estribillo, un obstáculo especial en un golpe fuerte).
- El registro `OBSTACLE_KIND` ya es extensible desde el rediseño de Jul 2026: añadir un tipo es un sprite en `pixelart.js` y una entrada en el registro, cero código.

**Nota de alcance.** Los ejemplos concretos que motivaron esta ola (naves, portales, esquivar tres aves en tres agudos) son *ilustrativos*, no compromisos. Lo que la ola entrega es la **capacidad** de expresarlos; qué se implementa se decide al arrancarla.

---

### Ola 7 — Overrides manuales y editor

**Objetivo.** Poder tocar a mano un momento concreto sin perder la generación automática.

**Alcance.**

- Capa **`chart_overrides`** separada de `chart_json`: mover, añadir, borrar o fijar elementos concretos. Se aplica *después* de generar, así que **regenerar el chart no destruye las ediciones**.
- Editor visual sobre el propio runtime: scrub por la canción, colocar, previsualizar en el sitio.

---

## 4. Orden y dependencias

```
Ola 0 (quick wins) ──┬──> Ola 1 (perfiles de render)
                     └──> Ola 2 (UX menú + catálogo)
                                    │
Ola 3 (chart + sincronía) ◀─────────┘
        │
        └──> Ola 4 (analizador Python)
                    │
                    └──> Ola 5 (charter musical)
                                │
                                ├──> Ola 6 (modos y eventos)
                                └──> Ola 7 (editor y overrides)
```

- **Olas 0, 1 y 2** son independientes entre sí y de todo lo demás. Sesiones cortas, resultado visible inmediato.
- **Ola 3 es la bisagra.** Arregla la sincronía (que es el problema real de fondo) y define el artefacto sobre el que se apoyan las demás.
- **Olas 4–7** son el trabajo grande. Cada una es una o varias sesiones y todas presuponen la 3.

Si hay que elegir una sola cosa: **Ola 3**. Es la que cambia cómo se siente el juego.

---

## 5. Trazabilidad de defectos

| Defecto | Ola | Defecto | Ola |
|---|---|---|---|
| D1 fila duplicada por partida | 3 ✅ (filas antiguas fusionadas en 4) | D9 modal sin precarga | 0 ✅ |
| D2 título `.mp3.mp3` | 0 ✅ | D10 `sampleRate` no fijado | 0 ✅ |
| D3 validación 200 vs col 120 | 0 ✅ | D11 nivel privado no jugable | 2 ✅ |
| D4 botón "Jugar" bloqueado | 0 ✅ | D12 identidad en iframe | 2 ✅ |
| D5 `file_path` expuesto | 0 ✅ | D13 orden `filterSpacing` | 3 ✅ |
| D6 `difficulty` hardcodeada | 5 (medida en 2) | D14 espaciado en s, no en px | 5 |
| D7 `?public=1` muerto | 0 ✅ | D15 sin validación de jugabilidad | 5 |
| D8 sin índice `is_public` | 0 ✅ | D16 sin suelo de energía en `pickPeaks` | 4 ✅ en el servidor (JS local: mitigado en 3) |
| D17 relleno a 0.15 s del siguiente | 3 ✅ | D18 onsets 23 ms adelantados | 3 ✅ |
| D19 física detrás del reloj de audio | 3 ✅ | D20 salto de `outputLatency` | 3 ✅ |
| D21 `X-Frame-Options` impedía el iframe de Vout | 2 ✅ | | |

---

## 6. Cierre de cada ola

Mismo protocolo que los bloques (doc 08 § "Cómo cierra cada bloque"):

1. Verificación de la ola ejecutada y pasada.
2. Smokes temporales borrados.
3. Sección "Current state" del `CLAUDE.md` actualizada.
4. `.env.example` actualizado si aparecieron variables nuevas.
5. Commit en `rewrite/v2` con formato `feat: ola N — <título>`.
6. Ola marcada como ✅ en este documento.
