# Roadmap — Rediseño de niveles, rendimiento y UX (Sep 2026)

> **Qué es este documento.** Tras retomar el proyecto y jugarlo de verdad, el resultado no convence. Este doc recoge el diagnóstico técnico completo y organiza el trabajo restante en **olas** entregables.
>
> **Por qué "olas" y no "bloques".** Los Bloques 0–7 del doc 08 son constructivos: cada uno añade una capa que antes no existía. Lo que viene ahora atraviesa código ya cerrado (engine, generador, modales, API de niveles). Llamarlos "Bloque 9, 10, 11…" daría a entender que se apilan encima; no es el caso. Una **ola** modifica lo que ya hay.
>
> **Autoridad.** Los docs 04, 05, 07 y `vout-integration/integration-guide.md` siguen por encima de este. Este doc **modifica el doc 06 §4.1** (ver Ola 2) y **sustituye** la descripción de generación de niveles del doc 08 § Bloque 5. Todo lo demás del 06 y del 08 sigue vigente.
>
> **Estado:** Olas 0, 1, 2, 3, 4 y 5 ✅ completas (Sep 2026), con los afinados tras el playtest de la Ola 5 (publicación, analizador, velocidad, y tamaños de pantalla con reintentos), la **Ola 6a** ✅ (bases de los modos de movimiento + antigravedad, con la progresión de velocidad más marcada) y la **Ola 6b** ✅ (reparto de modos por el carácter de cada tramo y vuelo), con sus ajustes tras el playtest (tramos en los cambios que se oyen, clímax desde su drop y modos que entran y salen con la música; y la dificultad que se siente: más densidad, menos silencios de juego y más velocidad; y la dificultad que se juega: acciones solo sobre golpes que suenan y acentos que exigen precisión, calibrados con un jugador de referencia), y la **Ola 6c** ✅ (anillos de salto, vuelo en frases encadenadas con la altura de la melodía, efectos nuevos del chart y exigencia por dificultad igual en cualquier canción). La Ola 7 (ediciones del autor y editor) queda **aplazada como futura actualización**.

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
- `difficulty` sigue fija en 3 (D6, resuelto en la Ola 5). Las filas duplicadas que D1 creó antes de esta ola siguen en la BD; no se han borrado datos.
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

- **El charter todavía no usa secciones, downbeats ni el techo.** Todos los oficiales salen a 3-4★ con 50-64 acciones/min, incluidas canciones suaves de techo 2. Es el trabajo de la Ola 5, que ahora sí tiene los hechos musicales que necesita. *(Resuelto en la Ola 5.)*
- **Quien sube no elige dificultad todavía** (ver arriba, Ola 5). *(Resuelto en la Ola 5.)*
- La etapa del pulso (la más larga, ~60 % del tiempo) no informa de progreso intermedio: la barra se queda en ~11 % con un brillo que indica que sigue vivo.
- Los roles de sección son heurísticos: comprobados con verdad conocida en sintético y plausibles en los 10 temas reales, sin anotación humana de esos temas.
- ~~El charter importa `pixi.js` en Node (vía `physics.js → Dino.js`): el contenedor necesita `node_modules` y cada chart paga ese arranque.~~ **Era falso** (corregido en la Ola 5): `physics.js` solo importa `config.js`, y recorridos los imports de `chart-from-analysis.mjs` y `bake-official.mjs` ningún módulo del charting toca un paquete npm. El contenedor deja de montar `node_modules`.
- El primer trabajo tras arrancar el servicio carga el modelo (~10 s más).
- Seguimiento por sondeo adaptativo, no por eventos del servidor: suficiente a esta escala.
- Los niveles privados guardados con el análisis JS no se reanalizan hasta que se publican.
- El E2E volvió a usar una clave RSA de prueba en la caché JWKS con un usuario desechable (borrado al terminar), no un login real en Vout.

---

### Ola 5 — Motor de niveles III: charter musical ✅

**Objetivo.** Que los niveles dejen de sentirse simplones. Todo lo de esta ola es **lógica pura sobre `analysis.json`, sin DSP** — por eso se puede iterar rápido y testear sin audio.

**Alcance.**

- **Cuantización a la rejilla de beats.** Colocar obstáculos en subdivisiones (1/1, 1/2, 1/4, tresillos) en lugar de en picos crudos de onset. Es el cambio individual que más hace por la sensación de ir al ritmo: los picos crudos son ruidosos y no coinciden con cómo se percibe el pulso. Es también el estándar en charting de juegos de ritmo — los charters humanos "snapean" a la rejilla, no a la forma de onda.
- **Patrones en vez de colocación uno-a-uno.** Un vocabulario de figuras rítmicas cortas (síncopa, tresillo, ráfaga, respiración, llamada-respuesta) seleccionadas según la sección y la dificultad. Un obstáculo por onset es exactamente lo que hace que un chart automático se sienta a "test de aporrear botones" en vez de a interpretar la canción.
- **Curva de dificultad guiada por la estructura.** Intro suave, escalada hacia el estribillo, respiro en el puente, clímax final. Sale directo de `music.sections`.
- **Validación de jugabilidad.** Nada valida hoy que un patrón sea superable (**D15**). El charter debe simular la física antes de emitir: `systems/physics.js` ya son funciones puras sin dependencia de Pixi, así que se ejecuta headless. Rechazar y re-generar lo imposible.
- **Separación en píxeles, no en segundos** (**D14**): la dificultad efectiva deja de variar 2.4× con el BPM.
- **Dificultad como parámetro de primera clase** (**D6**): cambia patrones, densidad y vocabulario, no solo el espaciado. Cualquier dificultad generable desde el mismo análisis.

**Verificación.** Smoke de determinismo (misma entrada + misma seed ⇒ mismo `chart.json` byte a byte). Validador automático que garantice **0 patrones imposibles** sobre las 8 canciones oficiales en todas sus dificultades. Playtest manual — este es el criterio que manda.

> **Lo que pidió el propietario al arrancarla.** Tras la Ola 4 el juego "ya va acorde a la música, pero no tanto": falta la conexión. En el Daino viejo las canciones largas aceleraban con el tiempo y eso construía emoción hacia el final. Lo que se pide **no** es "más velocidad cada N segundos", sino que conforme avanza la canción pase algo que haga sentir un **final inminente**, y que cada nivel siga a su canción "como un nivel de Geometry Dash".

#### Qué se construyó (y en qué se desvió del plan, con motivo)

**Primero se midió el charter v2.** En los 8 oficiales, la densidad era **plana** a lo largo de la canción (Time: 61, 56, 59 y 63 acciones/min en calma, groove, empuje y clímax; en What's Up Danger el clímax era *menos* denso que la intro), hasta un **34 % de los obstáculos caía fuera de la rejilla** de beats y contratiempos, la velocidad era la misma de principio a fin y ningún momento estaba preparado. Cada obstáculo caía sobre un golpe, pero el nivel no tenía la forma de la canción.

**Cinco piezas en vez de un generador.** `charter.js` v3 orquesta; cada decisión vive en un módulo puro, testeado por separado:

| Módulo | Decide |
|---|---|
| `levels/musicModel.js` | La canción en términos de diseño: compases y, en cada beat, dos huecos (**en el pulso** y **a contratiempo**, donde caiga el swing) con la fuerza, el color (graves/medios/agudos) y el peso métrico del golpe que suena. Es la única pieza que conoce los formatos de análisis. |
| `levels/songArc.js` | La **forma** del nivel, sin colocar nada: intensidad por compás, tramos, nivel de cada tramo (0 reposo · 1 calma · 2 groove · 3 empuje · 4 clímax) **relativo a la propia canción**, escalada del material que vuelve, un único clímax, subidas, drops y lifts. No depende de la dificultad. |
| `levels/difficulty.js` | Qué es cada dificultad: acciones/min por nivel del arco, error humano con el que debe superarse (±80 ms en Relajado … ±40 ms en Extremo), silencio máximo, en qué momento del arco se estrena cada mecánica, cuánto acelera el mundo y cuota de agachados. |
| `levels/patterns.js` | Compás a compás, qué huecos llevan acción y cuál, con memoria de frases y huecos mínimos medidos con la física. |
| `levels/charter.js` | Velocidad por tramos, silencios demasiado largos, tipo de obstáculo, validación jugando y eventos de estructura para el runtime. |

**La sensación de final sale de la canción, no de un temporizador.** Cinco cosas se suman conforme la canción avanza, todas ancladas a su estructura:

1. **La densidad sigue al arco, y lo que vuelve, vuelve más fuerte.** Cada repetición del mismo material suma intensidad (+0.05), así que el tercer estribillo se juega más lleno que el primero y el clímax es el tramo más denso.
2. **El mundo acelera donde la música empuja y al máximo en el clímax**: +8 % en los tramos de empuje y +16 % en el clímax (× la amplitud de la dificultad: de +8 % en Relajado a +21 % en Extremo). Sube **de golpe en el primer tiempo del drop** y baja en dos beats al soltar; nunca por debajo de la base, porque a menos velocidad hay *menos* margen (hallazgo de la Ola 2). Un tramo de menos de 8 s no cambia la velocidad, salvo el clímax.
3. **Las mecánicas se estrenan en momentos del arco.** En Normal: agacharse en el primer groove, cactus anchos y contratiempos al empezar a empujar, combinaciones rápidas salto↔agachado en el clímax. Más difícil = antes; más fácil = más tarde o nunca.
4. **La subida al drop se nota**: los dos compases previos se acercan a la densidad que viene (al 35 % y al 60 % del camino) y dejan el último beat en silencio, la respiración antes del golpe.
5. **El runtime lo hace visible** (`systems/songDirector.js` sigue los eventos `section` y `fx` con el reloj de la canción): **el sol se pone con el progreso de la canción** y el cielo se oscurece hacia el final; la intensidad del tramo (sube rápido, baja despacio) alimenta horizonte, espectro, partículas y un brillo del suelo que late con el beat, con acento en el primer tiempo; los obstáculos rebotan al pulso; el **drop** es destello + sacudida de cámara + oleada de partículas y el **lift** un destello suave; pulsar **sobre el golpe** (±60 ms) suelta chispas; el HUD entra en fase de clímax; y cuando no queda nada por cruzar aparece **"¡Superado!"** y la outro suena como vuelta de honor (salir desde la pausa en ese momento cuenta como victoria).

**Rejilla y puntuación, no un catálogo de figuras.** El plan hablaba de un vocabulario de figuras (síncopa, tresillo, ráfaga, respiración, llamada-respuesta). Un catálogo fijo pelea con la música: pone una síncopa donde no suena ninguna. Se hizo al revés y **las figuras salen de los golpes reales**: cada hueco puntúa por la fuerza del golpe y su peso métrico, con el siguiente primer tiempo reservado; una síncopa es un golpe fuerte a contratiempo que lo merece (solo si la dificultad la desbloquea), la respiración es la subida al drop, la ráfaga son las combinaciones del clímax y la llamada-respuesta es la **memoria de frases**: un compás que suena como uno anterior del mismo nivel repite su patrón, así que el jugador reconoce el riff y lo toca "de oído". Los decimales de densidad se reparten de forma periódica por posición en el tramo (2.5 acciones por compás = 2-3-2-3), para que la acción extra caiga siempre en el mismo compás de la frase. Qué acción: en el primer tiempo, salto; en los golpes brillantes (caja, palmas, charles), agacharse; en los graves, saltar (sin color de golpe, por backbeat: salto en 1 y 3, agachado en 2 y 4). El cactus ancho es un acento: primer tiempo fuerte y grave, con margen de sobra.

**Sin tresillos ni semicorcheas.** El salto completo dura 0.72 s y dos saltos seguidos necesitan ≥ 0.67 s (medido): una subdivisión más fina solo serviría para agacharse, y eso ya lo cubre el contratiempo, que además se coloca donde caen los golpes si la canción tiene swing (2/3 del beat en un shuffle).

**D14: huecos medidos con la física, por par de acciones y a la velocidad de ese instante.** Barriendo huecos de 0.10 a 2.0 s a 300-720 px/s con ±35-90 ms de error: salto→salto necesita 0.67-0.78 s sin depender de la velocidad; salto→agachado, de 0.49 s a 300 px/s a 0.24 s a 720 px/s; agachado→salto, de ~0.62 s a ~0.50 s; agachado→agachado, 0.10-0.18 s. `PAIR_GAP` (patterns.js) queda por encima de lo medido en todo el rango y con la tolerancia de la dificultad. `SPAWN_WINDOW_S`, en segundos, desaparece.

**D15: cada chart se juega antes de emitirse**, con la física real, su velocidad variable y **la tolerancia de su dificultad**. Si algo no se supera, un acento pasa a salto normal y, si no basta, se quita el menos importante del par (un relleno nunca se lleva un drop). El plan decía "rechazar y re-generar"; reparar localmente da lo mismo sin reintentos, y con los huecos medidos el reparador **no actúa en ninguna** de las 40 combinaciones oficiales.

**Velocidad variable: chart formato 2.** `world.speedChanges` (`{ t, speedPxS, rampS }`), `music.beats` y `downbeats` (el pulso visual se ancla a los beats reales) y `difficulty { level, requested, ceiling }`. `systems/speedProfile.js` integra la distancia recorrida **de forma exacta** por tramos, y la posición de cada obstáculo es la distancia entre dos instantes de canción: la sincronía de la Ola 3 se conserva con cualquier perfil (con velocidad constante, la fórmula es literalmente la de la Ola 3). Spawner, física y simulador aceptan número o perfil. `normalizeChart` y `ChartValidator.php` aceptan formatos 1 y 2 y descartan con aviso lo mal formado; un cliente viejo ignora lo que no conoce.

**Dificultad de primera clase (D6) y selector para quien sube.** Migración `010`: `levels.difficulty_requested` (`NULL` = Automática) y propósito `rechart` en la cola. `POST /api/levels/{id}/difficulty` (solo el autor; `auto` o de 1 al techo, y por encima 422 "Esta canción admite hasta N de 5"): con el análisis en caché, re-chart en menos de un segundo con prioridad interactiva. **Se bloquea (409) en cuanto otra persona tiene progreso en el nivel**, porque el ranking es por nivel y compararía partidas de niveles distintos. El worker lee la dificultad pedida **al chartear**, no al encolar, y si cambió entretanto encola otro re-chart. En la ficha del catálogo el autor ve el selector: "Automática (Normal)" y solo las dificultades que la canción admite, bloqueado con explicación, con aviso al aplicarse. Automática = Normal, o el techo si la canción no llega. Los 8 oficiales tienen su dificultad en el manifiesto, de Relajado a Extremo, en vez de salir todos a 3-4★.

Desviación: el plan ponía la elección "al subir". El techo solo se conoce **después** del análisis del servidor, así que la elección vive en la ficha del nivel publicado y cambiarla es un re-chart desde el análisis guardado.

**Las estrellas son la dificultad del nivel, no la medida.** `chartStats.js` sigue midiendo (densidad, pico en 20 s, margen simulado, cuota aérea; umbrales recalibrados) para las canciones locales sin servidor y como comprobación del horneado.

**Analizador local (formato 1).** Sin servidor no hay beats: el pulso se reconstruye por **programación dinámica** sobre los onsets (Ellis 2007, el método de `librosa.beat.beat_track`). Un bucle de fase probado antes perdía el pulso en las canciones suaves (Dawn of Faith: 34 % de beats sobre los del servidor). El compás se deduce de dónde caen los acentos y la energía, de la densidad de golpes. Charter y runtime funcionan igual con los dos formatos.

**`composer analysis:enqueue -- --charter-below=N`** re-chartea con su análisis guardado los niveles de la comunidad hechos con un charter anterior, con la dificultad que su autor tuviera pedida. Aplicado a los 2 niveles de la comunidad de la BD de desarrollo; los oficiales se re-hornearon.

**Defectos encontrados en la verificación de esta ola, corregidos antes de cerrarla:**
- beat_this da a veces compases irregulares ("2 2 2" o "3 1" beats en Dawn of Faith y Running With the Wolves): los de 1-2 beats se funden con su vecino.
- Los niveles del arco por **rango** inflaban las canciones planas (el último estribillo de Last Christmas salía en calma): ahora por desviación respecto a la mediana de la canción.
- Un clímax de 16 compases duraba 61 s a 63 BPM (Time): tope también en segundos.
- Una acción al final de un compás robaba el primer tiempo del siguiente (Mi Fiesta se jugaba "1, 4 | 2, 4"): el siguiente primer tiempo queda reservado.
- La subida al drop apenas se notaba: ahora se acerca a la densidad del nivel que viene.
- Canciones rápidas sin un solo agachado: la cuota aérea se calculaba de forma que el primero nunca cabía, y la memoria de frases propagaba el hueco.
- Un riff repetido se jugaba con patrones distintos: los decimales de densidad no tenían periodo (con arrastre, ninguno; con la fracción exacta, 5 compases).
- El puente de Running With the Wolves (5 compases, 14.6 s) se jugaba a la velocidad del estribillo: la duración mínima para cambiar de velocidad pasó de compases a segundos.
- Recortar un clímax largo podía dejar delante un tramo de 1-3 compases con **dos drops seguidos** (visto al re-chartear "Instrumental", de la comunidad): el clímax absorbe esa cabeza.
- Una canción que arranca empujando tenía un "cambio" de velocidad en el segundo 0: la velocidad base es la de ese tramo.
- `changeDifficulty` guardaba la dificultad antes de comprobar el bloqueo y dependía de deshacer la transacción al lanzar: ahora comprueba todo antes de escribir.
- El arnés de 1 FPS de los tests jugaba con velocidad constante y soltaba el agachado entre dos pteros seguidos.
- La limitación de la Ola 4 "el charter importa `pixi.js` en Node" era falsa (ver arriba): el contenedor del analizador deja de montar `node_modules`, verificado con la suite de Python y un re-chart real.

#### Verificación — hecha, con medidas reales

Tests: **166 JS** (+30), **60 PHP** (+7) y **72 Python** (+2). Nuevos `music-model`, `song-arc`, `speed-profile` y `song-director`, y `charter` reescrito: determinismo byte a byte, rejilla a cualquier tempo, densidad que sigue al arco, un único clímax en la segunda mitad que es el tramo más denso y el más rápido, estreno de mecánicas, memoria de frases, silencios, techo, regresiones de los defectos de arriba y los 8 oficiales × 5 dificultades. En PHP, el formato 2 y el cambio de dificultad (techo, bloqueo, re-chart, sin analizador); en Python, que un re-chart aplica la dificultad pedida aunque el nivel sea público y que un cambio a mitad encola otro.

Los 8 oficiales, charter v2 → v3, con la dificultad del manifiesto. La densidad del v2 se mide sobre los mismos tramos del arco:

| Oficial (dificultad) | Acciones/min por nivel del arco | En rejilla | Velocidad (px/s) | Medida |
|---|---|---|---|---|
| Time (Fácil, techo 2) | calma 61 · groove 56 · empuje 59 · clímax 63 → **17 · 30 · 37 · 51** | 76 % → **100 %** | 432 fija → 432-484 | 4★ → 2★ |
| HOPE (Fácil, techo 2) | reposo 42 · groove 61 · clímax 62 → **14 · 28 · 37** | 78 % → **100 %** | 500 → 500-560 | 4★ → 2★ |
| Running With the Wolves (Normal) | calma 49 · 63 · 55 · clímax 60 → **29 · 39 · 51 · 72** | 66 % → **100 %** | 508 → 508-589 | 4★ → 4★ |
| Dawn of Faith (Difícil) | calma 61 · 65 · 63 · clímax 65 → **28 · 51 · 63 · 65** | 89 % → **100 %** | 440 → 440-521 | 4★ → 3★ |
| Mi Fiesta (Difícil) | calma 50 · 56 · 51 · clímax 52 → **29 · 52 · 67 · 84** | 93 % → **100 %** | 389 → 389-460 | 3★ → 4★ |
| What's Up Danger (Extremo) | reposo 45 · 43 · 54 · 55 · clímax 47 → **18 · 33 · 58 · 61 · 81** | 78 % → **100 %** | 370 → 370-447 | 4★ → 5★ |
| Last Christmas (Relajado) | groove 45 · clímax 39 → **17 · 23** | 100 % → 100 % | 394 → 394-426 | 3★ → 1★ |
| Sugar Red (Normal) | groove 43 · clímax 46 → **37 · 51** | 100 % → 100 % | 472 → 472-547 | 3★ → 3★ |

| Qué | Resultado |
|---|---|
| 8 oficiales × 5 dificultades (40 charts) | jugables con la tolerancia de su dificultad, **0 reparaciones**, 100 % en rejilla, 1-48 ms por chart; acciones y velocidad crecen con la dificultad (What's Up Danger: 22 → 32 → 42 → 51 → 58 acciones/min y 400 → 447 px/s de máxima) |
| Determinismo | mismo análisis + seed + dificultad ⇒ mismo chart byte a byte |
| Analizador local: beats frente a los del servidor (±60 ms, contando la mitad) | Last Christmas y Mi Fiesta 100 %, Sugar Red 97 %, What's Up Danger 94 %, Dawn of Faith 89 % (34 % con el bucle de fase), Running With the Wolves 88 %, HOPE 86 %, Time 80 %; los 8 charts locales, jugables |
| E2E Sugar Red (oficial) | victoria, 27/27 a 60 FPS |
| E2E Running With the Wolves (2:44) | victoria, 120/120 pulsaciones "sobre el golpe"; 9 826 frames, mediana 16.7 ms, p95 18, p99 20.9 |
| E2E "Instrumental" (comunidad, 2:55, charter final: arranca empujando, 5 cambios de velocidad) | victoria al 100 %, 111/111 entradas; 10 530 frames, mediana 16.7 ms, p99 17.2; clímax a 539 px/s desde 1:47; "¡Superado!" en 2:48; 0 errores de consola |
| Momentos | drop, clímax y "¡Superado!" comprobados en capturas (destello, oleada, fase de clímax del HUD, sol poniéndose) |
| Publicar una canción ya analizada / cambiarle la dificultad desde la ficha | 632 ms / re-chart en **598 ms**, ficha y tarjeta al día en 4.9 s (ritmo del sondeo) con aviso |
| Ventana tapada (rAF a ~1 FPS) | HOPE superado con pulsaciones fechadas; salir desde la pausa tras "¡Superado!" cuenta como victoria (100 %) |

**PHPStan nivel 6:** 13 errores, todos anteriores. **Bundle: 165.89 KB gzip** (+12.31 KB), CSS 9.18 KB, Worker 5.13 KB.

#### Limitaciones que quedan

- **El playtest humano manda y está pendiente.** Todo lo anterior son medidas y bots. Lo que se ajusta tras jugarlo está en tablas: `difficulty.js` (acciones/min por nivel, tolerancias, estrenos, amplitud de velocidad), `CHARTER_RULES` en `charter.js` (aceleraciones, tope de velocidad) y `DROP_FX`/`ON_BEAT` en `config.js`. Cualquier cambio del charter exige subir `CHARTER_VERSION`, re-hornear y `--charter-below`.
- ~~El vocabulario sigue siendo saltar, agacharse y el cactus ancho: los momentos nuevos (modos, portales) son la Ola 6.~~ Resuelto en la Ola 6a: portales y antigravedad.
- Tramos, niveles y roles del arco son heurísticos: comprobados con canciones sintéticas de estructura conocida e inspeccionados en los 8 oficiales y 2 de la comunidad, sin anotación humana.
- Con el análisis local (sin servidor) no hay secciones ni color de golpe: el arco sale de la densidad de golpes y la dinámica es más plana.
- ~~Cambiar la dificultad queda bloqueado en cuanto otra persona juega el nivel.~~ Sustituido tras el playtest (abajo): un nivel publicado ya no cambia de dificultad.
- La dificultad medida se desvía una estrella de la elegida en 2 oficiales (Running With the Wolves y Dawn of Faith). Los umbrales de la medida están calibrados con estas 8 canciones.
- Más dificultad da más acciones en el conjunto de la canción, pero no siempre en cada tramo: a partir de ~85-90 BPM dos saltos no caben en beats consecutivos, las acciones seguidas alternan con agachados y la cuota aérea las limita. En What's Up Danger el clímax sale a 87 acciones/min en Difícil y a 81 en Extremo (que en conjunto es más denso, 58 frente a 51, y mide 5★).
- ~~Aceleración conservadora a propósito hasta el playtest: como mucho +21 % y nunca por encima de 690 px/s.~~ Sustituida tras el playtest: marchas hacia el clímax, hasta ×1.55 (ver "Afinado de velocidad").

#### Ajustes tras el primer playtest (Sep 2026)

El propietario jugó la Ola 5 y encontró cinco problemas de UX y de coherencia. No abren ola nueva: corrigen lo que había.

**1. Un nivel publicado cambiaba de dificultad.** Su autor podía hacerlo desde "De la comunidad", con un aviso de "aplicando" que apenas se veía y **Jugar pulsable mientras tanto**. Y la pregunta de fondo: ¿qué vale superar un nivel si su dificultad cambia? → **Un nivel publicado tiene una sola dificultad, para siempre.** Su autor la elige ANTES de publicarlo, y solo entre las que la canción admite.

**2. Elegir con sentido exige el análisis del servidor.** Antes de decidir dónde vive la elección se midió si el análisis del navegador (el de un nivel sin publicar) sirve para estimar el techo. **No sirve**: la fuerza de sus onsets es relativa al máximo de cada canción, así que no distingue una balada de un tema con batería. Con los 11 temas disponibles:

| Canción | Techo (servidor) | Onsets fuertes/min (navegador) | Golpes en la rejilla/min (navegador) |
|---|---|---|---|
| HOPE | 2 | 150 | 137 |
| Time | 2 | 30 | 113 |
| Instrumental | 4 | **3** | 55 |
| Dawn of Faith | 4 | 30 | 86 |
| Running With the Wolves | 5 | 59 | 128 |
| What's Up Danger | 5 | 62 | 120 |
| conga | 5 | 77 | 209 |
| Mi Fiesta | 5 | 91 | 196 |
| Sugar Red · Last Christmas | 5 | 100 · 117 | 249 · 201 |

HOPE, tranquila, suena "más fuerte" que tres temas de techo 5; Instrumental, de techo 4, es la más floja. Ningún umbral los ordena. Por eso **publicar pasa a dos pasos**:

1. **"Publicar…"** sube el MP3 y lo analiza (como en la Ola 4), pero al terminar el worker **ya no lo hace público**: lo deja **listo para publicar**, con el chart de **cada dificultad que la canción admite** ya generado por el servidor (`levels.chart_variants_json`, migración `011`; un CHECK impide que un nivel público conserve variantes).
2. En su ficha, su autor elige la dificultad (Automática y 1…techo). **Cambiar es instantáneo**: el servidor copia la variante, sin cola ni análisis (5-8 ms de trabajo medido). Mientras dura la petición, la opción elegida se marca al momento y **Jugar, Publicar y No publicar quedan bloqueados y lo parecen** (antes `.daino-btn` no tenía estilo deshabilitado). Puede probarlo con Jugar (su audio se sirve desde el servidor solo a él) y confirma con **"Publicar en Difícil"**. "No publicar" lo devuelve a privado y borra su audio del servidor.

Sin analizador (`ANALYZER_ENABLED=false`) se sigue publicando al instante en Automática: sin análisis del servidor no hay dificultades con sentido que ofrecer.

**3. Una marca vale para el chart con el que se hizo.** Si no, bastaría con superar un nivel en Relajado y publicarlo en Extremo para estrenar su ranking con un 100 %. Por eso: elegir otra dificultad en un nivel listo borra la marca de prueba de su autor (y la local); subir un nivel a publicar borra la de su versión privada (el nivel publicado se genera de nuevo en el servidor); y soltar otra vez el MP3 de un nivel propio juega **el chart de ese nivel**, no uno recién generado en Automática. Confirmar la publicación conserva la marca hecha probando: es el mismo chart.

**4. Los botones del menú seguían activos en plena partida.** El menú oculto tenía opacidad 0, pero `#menu-root [data-interactive]` reactivaba los eventos de sus botones: pulsar cerca del centro abría "Subir mi canción" en mitad del juego (y en táctil ese toque no llegaba al juego). Ahora la UI oculta es **inerte**: el menú con `inert` y `visibility: hidden` al terminar el fundido, y el chip de sesión también fuera del menú.

**5. Menos viaje hasta jugar.** Oficiales y comunidad van **en una sola vista** ("Todos"; "Míos" aparte, con sesión): primero los oficiales de menos a más difíciles y después lo más reciente de la comunidad, distinguidos por la insignia "Oficial" o su autor. Y **pulsar una tarjeta juega** (▶, o ♪ si pide tu MP3): antes eran JUGAR → nivel → ficha → Jugar. La ficha (ranking, publicar, dificultad) se abre con el botón de detalles de la tarjeta. Lo que aún no se puede jugar (analizándose) abre la ficha.

Decisiones que quedan sustituidas: la de la Ola 4 "el worker publica al terminar el análisis" (ahora lo deja listo y publica su autor); la de la Ola 5 "la elección de dificultad vive en la ficha del nivel publicado y se bloquea en cuanto otro tiene marca"; y las de la Ola 2 "pestañas Oficiales / De la comunidad / Míos" y "la ficha antes de jugar" (la precarga al abrir la ficha sigue igual).

Archivos: migración `011_add_publish_ready_variants.sql`; `Level` (`hasVariants`, `publishReady`, `chartVariants`, `applyVariant`, `confirmPublic`, orden de `scope=public`), `PublishService` (`changeDifficulty` por variantes, `confirmPublish`, marcas en `requestPublish`), `Progress::invalidateForLevel`, `LevelPresenter` (`publish_ready`, `difficulty_choice` solo en listos), `LevelApiController` (`changeDifficulty`, `visibility` que confirma, `streamFile` para el autor); worker (`charter.py`, `worker.py`, `jobs.py`: variantes, desenlace `ready`, sin re-chart de seguimiento); `scripts/lib/chartFromAnalysis.mjs` (`variants`); cliente: `catalog.js`, `catalogModel.js`, `publishModel.js` (estado `READY`), `publishTracker.js` (`changeDifficulty`, `confirmPublish`, `withdrawPublish`), `analysisWatcher.js`, `levelsCache.js` (`public`/`mine`), `client.js` (`fetchBinary`), `menu.js` y `AppController.js` (UI inerte, canción propia con su chart), `localBests.js` (`forget`), `main.css`.

**Verificación.** Tests: **166 JS**, **65 PHP** (+5) y **71 Python** (dos tests del re-chart de dificultad se sustituyen por uno). En el navegador:

| Qué | Resultado |
|---|---|
| Catálogo sin sesión | una vista sin pestañas: 8 oficiales de Relajado a Extremo y después la comunidad, de lo más reciente a lo más antiguo |
| Pulsar una tarjeta | partida en **1.5 s** con el fundido de 600 ms incluido; la ficha no aparece |
| Detalles de un nivel publicado | ranking y Jugar, sin selector de dificultad (también para su autor) |
| Clic en plena partida donde estaban "Subir mi canción" y "JUGAR" | lo que hay en ese punto es el canvas; ningún diálogo, sigue jugando, el reloj de la canción avanza y Tab no lleva el foco al menú |
| Canción local con sesión | queda en "Míos" como privada, sin selector (análisis del navegador) |
| "Publicar…" con HOPE | el worker la deja **lista** en 1.5 s (análisis en caché), no pública; se le borra la marca de la versión privada |
| Nivel listo | ofrece Automática (Fácil), Relajado y Fácil: **nada por encima de su techo 2** |
| Cambiar con la petición retenida 1.2 s | Relajado marcado al momento; Jugar, Publicar y No publicar bloqueados y atenuados; pulsar Jugar no hace nada |
| Cambiar de verdad | 0.6-0.9 s de principio a fin en este Docker Desktop de Windows, donde `/api/health` ya tarda 0.3-0.6 s; 5-8 ms de trabajo del servidor |
| Jugar un nivel listo | chart con dificultad 1, pedida 1 y techo 2; el audio lo recibe su autor (200, 1 265 008 bytes) y nadie más (404) |
| "Publicar en Relajado" | público al instante, aviso, sin selector; la API devuelve **409 `difficulty_fixed`** a su autor; en "Todos" es el primero de la comunidad |
| Volver a soltar el mismo MP3 | juega el chart del nivel publicado (Relajado), no uno nuevo en Automática |
| Móvil (412 px) | dos columnas; el botón de detalles no tapa la marca |

Limitaciones: en este entorno local cada petición a la API cuesta 0.3-0.6 s aunque no haga nada (Docker Desktop en Windows con el código montado y `opcache.revalidate_freq=0`), así que el bloqueo breve al cambiar la dificultad se nota más que en producción. Un nivel listo que su autor nunca publica conserva su audio en el servidor hasta que pulse "No publicar". Desde la ficha solo se puede retirar un nivel que todavía no se ha publicado.

#### Afinado del analizador: armonía, percusividad y bandas (Sep 2026)

El propietario preguntó si el analizador es "de verdad potente": notas, partes de la canción, graves y agudos, no solo BPM. Tras revisar el estado del arte (búsqueda propia y un informe de investigación externo) la conclusión fue doble. **beat_this es la elección correcta** para el pulso (ISMIR 2024, del mismo laboratorio que madmom, al que sustituye). Pero **faltaba toda la armonía** y la estructura es la segmentación clásica. Lo que ese informe recomendaba (separar pistas con Demucs, estructura con `all-in-one`) pide **6-12 GB de RAM de pico**, y el servidor previsto es un VPS de 1-2 GB compartido con otro proyecto: un solo análisis así lo tumbaría. Así que el afinado se hizo **sin dependencias nuevas**: todo sale de `librosa`, que ya estaba.

**Qué añade el analizador 2** (el formato del análisis sigue siendo el 2; los campos son nuevos y opcionales para quien lee):

| Campo | Qué es | Para qué sirve |
|---|---|---|
| `tonal.key`, `keyConfidence` | tonalidad global ("D minor") | color y ánimo de la escena |
| `tonal.tuningCents` | afinación de la grabación (−50…+50) | que una versión a 432 Hz o acelerada no salga un semitono corrida |
| `tonal.chords` | `[t, "B:min"]` por beat, "N" sin acorde | momentos en que la música cambia aunque no haya golpe |
| `tonal.chordConfidence` | cuánto explican los acordes la armonía [0,1] | no usar la armonía en rap sobre 808 o ruido |
| `tonal.harmonicRhythm` | cambios de acorde por compás | canción que "se mueve" frente a una estática |
| `tonal.modulations` | `{t, key, semitones}` | la subida de tono del estribillo final (momento épico) |
| `sections[].key` | tonalidad de cada sección | estrofa menor frente a estribillo mayor |
| `onsetPercussive` | por onset, >0.5 golpe de batería, <0.5 ataque de nota | seguir la melodía o la batería |
| `energy.bands` | curvas graves/medios/agudos a 10 Hz, relativas | cuándo entra el bajo (drop), cuándo se abre el brillo |
| `energy.bandLevelDb` | nivel de cada banda respecto a la mezcla | saber si una banda de verdad pesa |

**Cómo** (`analyzer/daino_analyzer/tonal.py`): CQT a 93 ms con un bin cada tercio de semitono → separación armónico/percusiva por medianas → afinación elegida probando desplazamientos y quedándose con el que mejor explica la armonía → croma agudo y grave → acordes por plantillas de las 24 tríadas con el bajo reforzando la fundamental y Viterbi por beat → tonalidad en el tiempo (croma de ±4 s, perfiles de Temperley, Viterbi muy estable) → bloques de armadura que solo se separan si su tonalidad los explica mejor que la de **ambos** vecinos. La percusividad (`onsets.py`) es la fracción del espectro que se enciende en el ataque, sobre el flujo que ya se calculaba.

**Decisiones tomadas midiendo, no suponiendo:**

- **La separación armónica en el CQT sí sirve para acordes** (90.8 % → 97.7 % de acierto con batería), **no para detectar notas aparte**: los bombos y cajas tienen tono, y entre el 39 y el 66 % de los golpes salían como "nota". Se descartó; filtrar los onsets por percusividad da las notas mejor.
- **Afinación por encaje armónico**, no por picos del espectro: en temas con voces procesadas los estimadores clásicos (`librosa.estimate_tuning` y picos del CQT) discrepaban hasta 30 cents entre sí; en temas limpios el encaje tiene un pico nítido en el valor correcto.
- **"Sin acorde" relativo a la canción**: un break de batería encajaba a 0.56 frente a 0.94 de sus acordes. Un umbral fijo no sirve (en música real el encaje típico es 0.6-0.8). Del 0 % pasó al 87 % "sin acorde" en el break.
- **Modulaciones con criterio de dos lados**: la primera versión medía la ganancia de la tonalidad nueva en su propio tramo, que siempre sale alta. Inventaba 3-5 modulaciones en What's Up Danger y Time. Además, los errores típicos (quinta, paralela) exigen más evidencia, y una modulación dura al menos 12 s.
- **Nivel de banda en dB, no cuota**: en los 8 oficiales los agudos son el 0.1-2 % de la potencia (−30 a −17 dB) aunque charles y platillos se oyen. Una cuota del 1 % engañaba.

**Verificación.**

| Qué | Resultado |
|---|---|
| Tonalidad, 5 canciones sintéticas (mayores, menores, sostenidos, batería ×3) | 5/5 exactas, confianza ≥ 0.8 |
| Acordes (mir_eval, mayor/menor) | ≥ 95 % en las 5; 87 % con acordes cada 2 beats |
| Grabación desafinada +35, −30, −45 cents | afinación a ≤ 12 cents, misma tonalidad y acordes |
| Volumen ×0.05 | acordes, tonalidad y afinación idénticos |
| Modulaciones Do→Re, La m→Do m, Sol→La♭→Sol, La m→La | todas, con su signo, a ≤ 4 s de la frontera |
| Sin modulación: dominante sin alterar, acordes de quinta sin tercera, estrofa en la relativa | 0 modulaciones falsas |
| Integración con beats seguidos por beat_this (`pop_song`) | el acorde de cada sección es el suyo |
| Percusividad golpe vs nota (AUC) | 0.96-1.00; 0.91 con la batería 9 dB por debajo |
| Energía por bandas (bajo 5 s + charles 5 s) | cada curva sube en su mitad |
| Real: Time | Am, Em, G, D, su progresión conocida |
| Real: Last Christmas (clip subido de tono) | los acordes {B♭, Fm, Cm, E♭} son I–vi–ii–V en Mi♭, la progresión de la canción transpuesta; afinación −32.5 cents. Tonalidad dada como B♭ (error de quinta) |
| Real: Dawn of Faith | Do menor con Cm, G, E♭, A♭, Fm |
| Real: What's Up Danger | Re, con acordes de quinta: mayor/menor ambiguo por naturaleza (documentado) |
| Re-horneado de los 8 oficiales | **charts, dificultad y estadísticas idénticos**; onsets, beats, secciones y energía idénticos; análisis 303 → 522 KB |
| `seed:official` | "análisis actualizado" en los 8: mismos `chart_hash`, marca existente conservada |
| Coste por canción de 3-4 min | etapa de tonalidad 0.3-1.4 s; **RAM pico 640-890 MB, −10 a +20 MB** respecto a antes (casi todo es PyTorch, como ya era) |
| Tests | 166 JS, 68 PHP (+3), 104 Python (+33: `test_tonal.py`, percusividad, bandas, integración, esquema) |

Operación: `ANALYZER_VERSION` pasa a 2, así que los análisis guardados en caché con la 1 se consideran obsoletos y un trabajo nuevo vuelve a analizar. Los niveles de la comunidad conservan su análisis de la versión 1 hasta que se reanalicen. Eso no afecta a nada: el charter todavía no usa la armonía. Cuando la use, `composer analysis:enqueue -- --level=…` y re-hornear los oficiales. El seeder ahora guarda un análisis nuevo aunque el chart no cambie, sin tocar chart ni marcas. Comprobarlo de oído: `sonify … --chords`.

Limitaciones: solo tríadas (una séptima sale como su tríada; un acorde de quinta, mayor o menor al azar); la confusión con la relativa (Do mayor / La menor) es inherente a los perfiles de tonalidad; en música sin armonía estable la confianza baja y no debe usarse para decisiones de juego. Queda fuera, por RAM: separación de pistas (voz/batería/bajo) y contorno melódico con red neuronal (Basic Pitch, ~1 GB). Esto último sería lo siguiente si el VPS tiene margen, medido antes en una máquina de su tamaño.

#### Afinado de velocidad: marchas hacia el clímax (Sep 2026)

> **Lo que pidió el propietario.** En What's Up Danger, el nivel que debería ser el más épico, no se siente nada inminente: "debería aumentar la velocidad llegando al 60-75 % del nivel, o escalonado". En el Daino legacy la velocidad solo subía, por escalones, y al final se jugaba mucho más rápido: más atención, adrenalina, y los obstáculos más separados para que siguiera siendo pasable. No se pide copiarlo, sino esa emoción, **sin romper la sincronía con la música** y sin cerrar la puerta a obstáculos, interacciones o modos nuevos.

**Primero se midió.** Con el charter v3, What's Up Danger (Extremo, 3:36) arrancaba a 370 px/s (el scroll **más lento de todo el catálogo**, por su pulso de 95 BPM), subía un 10 % en el minuto 1:42, **volvía a la base del 61 % al 80 % de la canción** y el clímax iba un 21 % por encima. En los 8 oficiales la velocidad máxima no pasaba de ×1.21 sobre la de arranque. El legacy iba de 427 a 1280 px/s (×3) en un contenedor de 1000 px: al final, cada obstáculo se veía 0.74 s antes de llegar. Aquí, en una ventana de 1536 px, se ve 3.7 s.

**Por qué acelerar no rompe la sincronía (y qué sí cambia).** Desde la Ola 3 un obstáculo se coloca por TIEMPO: su acción es un instante de la rejilla musical y su posición en pantalla es la distancia que el mundo recorre hasta ese instante. Con cualquier perfil de velocidad cruza al Dino exactamente en su golpe (`speedProfile.js`, con test). La velocidad solo cambia cuatro cosas, y se midieron:

| Qué cambia al acelerar | Medido | Consecuencia |
|---|---|---|
| Distancia entre obstáculos en pantalla | proporcional a la velocidad | la separación "más amplia a más velocidad" del legacy sale sola |
| Margen de error de cada acción | cactus ancho: −125/+145 ms a 370 px/s, −195/+215 a 650 | a más velocidad, **más** margen: no se vuelve injusto |
| Huecos mínimos entre acciones | salto→agachado y agachado→salto se acortan; salto→salto, igual | el charter ya los calcula a la velocidad de cada instante |
| Tiempo para leer lo que viene | (ancho − 157 px) / velocidad | manda el techo: 690 px/s = 1 s en un móvil apaisado de 844 px |

El riesgo real no es la velocidad sino **el instante del cambio**. Quien juega con el oído pulsa en el golpe y no le afecta. Quien juega con la VISTA pulsa cuando el obstáculo "está a la distancia de siempre": si el mundo acaba de acelerar, estima una velocidad menor y pulsa tarde. Se modeló (`playability.readerOffsetS`: velocidad percibida = media de los últimos 0.3 s, lo que tarda una persona en corregir una intercepción) y el charter v3 salía mal parado: **el portal caía en el primer tiempo del drop, justo donde va la acción obligatoria, y esa acción llegaba 41-58 ms tarde** en los 8 oficiales. Con dos saltos a 0.70 s (legal en Extremo) y un acelerón del 26 % encima del primero, quien juega con el oído pasa y quien juega con la vista choca con el segundo (test).

**Qué se construyó (charter v4, `CHARTER_VERSION = 4`; el formato no cambia).**

1. **Marchas** (`levels/speedPlan.js`, pieza nueva del charter). Una por cada ~36 s entre el arranque y el clímax, hasta 3, y la última ES el clímax: una canción de 40 s solo acelera en su clímax; una de 3 minutos llega a él bastante más rápida que empezó (la "canción larga = más épica" del legacy, anclada a la estructura). Cada una cae en el compás que abre un tramo o, si no hay uno cerca de su reparto, uno que abre frase (cada 8 compases).
2. **Trinquete hasta el clímax.** La velocidad no baja nunca antes de que termine el clímax: un puente tras un estribillo se juega igual de rápido, menos denso. La subida por nivel del arco (empuje +6 %, clímax +18 %) es la mayor alcanzada y cada marcha (+8 %) suma encima, todo × la amplitud de la dificultad (0.5 Relajado … 1.3 Extremo). Tras el clímax, **un único frenazo en rampa de 4 beats**. Primero se probó el trinquete sobre la velocidad: en "Instrumental" (comunidad, arranca empujando) la marcha intermedia caía en una estrofa, pedía menos que el tramo inicial y desaparecía; el nivel solo aceleraba en el clímax (test de regresión).
3. **El acelerón, en la anacrusa.** El mundo acelera en el hueco de la rejilla previo al primer tiempo que lo motiva, con ≥ 0.3 s de antelación (medio beat, o uno entero en tempos rápidos). La acción de ese primer tiempo ya se ve llegar a la velocidad nueva. Encaja con la respiración que el charter ya dejaba antes de cada drop.
4. **Validación para las dos maneras de jugar.** `validatePlayability` juega además cada chart con quien se guía por la vista (su error + la tolerancia de la dificultad), y el charter no coloca ninguna acción cuyo error de vista pase de 20 ms. Es genérico: usa el adelanto de cada kind, así que un obstáculo futuro con adelanto propio o un cambio de reglas de la Ola 6 queda cubierto sin tocar nada.
5. **Se ve venir** (runtime, `systems/speedCues.js` puro y testeado, derivado de `world.speedChanges`: sirve para cualquier chart con cambios de velocidad):
   - **Mapa de la canción en la barra de progreso**: cada tramo más claro cuanto más intenso, el clímax en rosa y una marca en cada acelerón. Lo que viene se ve venir.
   - **Marchas en el HUD**: chevrones junto al tiempo, uno por escalón sobre la velocidad de arranque (×1.06, ×1.18, ×1.32, ×1.46); el cuarto, en rosa.
   - **Aviso**: los dos compases previos a un acelerón, su chevrón parpadea al pulso y el suelo y el fondo laten también a contratiempo, cada vez más (una subida).
   - **Al llegar**: ráfaga de líneas de velocidad y marcha nueva; en el primer tiempo, un momento discreto si allí no hay ya un drop o un lift.
   - **Líneas de velocidad** (`entities/SpeedLines.js`): rayas de luz que cruzan el cielo más rápido que el suelo, más cuanto más por encima de su arranque va el nivel. Nunca bajan a los 200 px sobre el suelo (ahí salta el Dino y vuela el ptero). Pool fijo, limitado por el perfil de render; sin ellas con `prefers-reduced-motion`.

**Resultado en los 8 oficiales** (dificultad del manifiesto; "vista" = peor error de quien juega mirando):

| Oficial (dificultad) | Duración | v3: arranque → máx · al 60 % / 75 % | v4: arranque → máx · al 60 % / 75 % | Acelerones v4 | Vista v3 → v4 |
|---|---|---|---|---|---|
| Sugar Red (Normal) | 0:40 | 472 → 547 · 472 / 547 | 472 → 557 (×1.18) · 472 / 557 | 1 (clímax) | 42 → 0 ms |
| Last Christmas (Relajado) | 0:39 | 394 → 426 · 394 / 426 | 394 → 430 (×1.09) · 394 / 430 | 1 | 25 → 0 ms |
| HOPE (Fácil) | 1:19 | 500 → 560 · 560 / 560 | 500 → 567 (×1.13) · 567 / 567 | 1 | 34 → 0 ms |
| Running With the Wolves (Normal) | 2:44 | 508 → 589 · 548 / 508 | 508 → 690 (×1.36, techo) · 619 / 619 | 3 | 42 → 0 ms |
| Time (Fácil) | 2:46 | 432 → 484 · 458 / 484 | 432 → 542 (×1.25) · 477 / 542 | 3 | 19 → 2 ms |
| Mi Fiesta (Difícil) | 3:14 | 389 → 460 · 425 / 425 | 389 → 577 (×1.48) · 487 / 487 | 3 | 28 → 8 ms |
| Dawn of Faith (Difícil) | 3:17 | 440 → 521 · 440 / 521 | 440 → 652 (×1.48) · 521 / 652 | 3 | 47 → 3 ms |
| What's Up Danger (Extremo) | 3:36 | 370 → 447 · 409 / **370** | 370 → 572 (×1.55) · 476 / 476 | 3: 0:53, 1:41, 2:52 | 51 → 8 ms |

Mismas acciones que con v3 en los 8 (en 6 de las 40 combinaciones de oficial × dificultad hay 1 o 2 más), 0 reparaciones y la misma dificultad medida (en 2 de las 40 sube una estrella: Last Christmas en Normal y en Extremo, que no son la suya). En las 40 combinaciones (8 × 5 dificultades) el máximo va de ×1.09 (Relajado, canción corta) a ×1.55 (Extremo, larga), y el mayor escalón individual es de ×1.25 (Dawn of Faith en Difícil, al clímax).

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **183 JS** (+17: `speed-plan`, `speed-cues`, modelo de la vista en `speed-profile`), 68 PHP, 104 Python (un test del worker fijaba `chart_version == 3`: ahora comprueba la del chart) |
| Regresiones | What's Up Danger ≥ ×1.2 del 60 % al 80 % y ≥ ×1.5 en el clímax; canción que arranca empujando sube de marcha antes del clímax (falla con el trinquete sobre la velocidad); ninguna acción de canciones sintéticas a 66-174 BPM con error de vista > 20 ms |
| E2E What's Up Danger, Extremo, 1536×864 (bot con pulsaciones fechadas) | **victoria al 100 %**, 200 obstáculos; acelerones en 53.279, 101.28 y 172.029 s (chart: 53.278, 101.277, 172.017, dentro de un frame); frenazo de 572 a 485 px/s entre 202.66 y 205.18 s; marchas del HUD 1 → 2 → 4 → 3 → 2 en esos instantes; avisos desde 48.23 y 96.55 s con el chevrón parpadeando cada medio beat (0.32 s); 0 errores de JS; 12 756 frames, mediana 16.7 ms, p95 19, p99 23.7 (el máximo de 987 ms coincide con una captura de pantalla a resolución de dispositivo) |
| E2E Sugar Red, Normal, 1536×864 y móvil apaisado 844×390 | victoria al 100 % en ambos; mapa de 360 y 203 px; líneas de velocidad por encima de la franja de juego |
| Worker del analizador (`--charter-below=4` y `--level`) | los 3 niveles de la comunidad re-charteados en el contenedor: 37-49 s la primera vez (tenían análisis de la versión 1), 1.6-2.2 s con el análisis en caché. Instrumental: 478 → 497 → 543 (clímax) → 502; conga (4:16, Difícil): 425 → 454 → 493 → 532 → 630 (clímax) → 542 |
| Bundle | 169.86 KB gzip (+3.97 KB), CSS 10.26 KB |

**Decisiones (vinculantes):**

- **La velocidad escala por marchas hacia el clímax, con trinquete sobre el nivel hasta que termina y un único frenazo después.** Sustituye la de la Ola 5 "acelera solo en tramos de empuje (+8 %) y clímax (+16 %) y baja en 2 beats al terminar cada uno".
- **Un acelerón nunca cae encima de una acción: va en la anacrusa**, ≥ 0.3 s antes del primer tiempo. Sustituye "subida de golpe en el primer tiempo del drop (el portal es el drop)": el destello del drop sigue en el primer tiempo.
- **Un chart es justo si lo superan quien juega con el oído Y quien juega con la vista**, con la tolerancia de su dificultad. Vale para cualquier transición futura.
- **Cualquier cambio de reglas en mitad de un nivel es una transición** (hoy la velocidad; en la Ola 6, modos de movimiento o gravedad): cae en la anacrusa de un compás que abre tramo o frase, se avisa en el runtime antes de llegar y el validador la juega con quien se guía por la vista.
- **La velocidad se enseña, no solo se aplica**: mapa, marchas, aviso y líneas, derivados de `world.speedChanges` (sin campos nuevos en el chart).
- La velocidad de arranque sigue saliendo del pulso; la dificultad decide la amplitud. ~~El techo sigue en 690 px/s.~~ (Ola 6a: 820 px/s.)

**Limitaciones que quedan:**

- **El playtest humano manda.** Todo lo afinable está en tablas: `SPEED_RULES` (`speedPlan.js`), `speedAmp` en `difficulty.js`, `SPEED_CUES` (umbrales de marchas y aviso), `SPEED_LINES` y `GEAR_FX` en `config.js`. Cambiar las dos primeras exige subir `CHARTER_VERSION`, re-hornear y `--charter-below`; las visuales no.
- ~~**En ventanas anchas la velocidad se diluye.** El juego pinta el mundo a 1 px CSS por px, así que en 1920 px un obstáculo a 572 px/s se ve 3.1 s antes de llegar.~~ Resuelto: el propietario lo aprobó y la vista del mundo escala con la pantalla (ver "Tamaños de pantalla y reintentos").
- El modelo de la vista es una heurística (0.3 s de recalibración). Quien calcula "a ojo" con la distancia aprendida tarda más en recalibrar; lo amortiguan escalones de ≤ ×1.25 (≤ 72 ms de error) y el margen, que crece con la velocidad.
- Los huecos mínimos entre acciones (`PAIR_GAP`) estaban medidos hasta 720 px/s. Vueltos a medir hasta **900 px/s** al subir el techo en la Ola 6a: sigue valiendo la misma regla, no subirlo sin volver a medir.
- En producción, tras desplegar: re-hornear no hace falta (los horneados van en el repo), pero sí `seed:official -- --rechart` y `analysis:enqueue -- --charter-below=4` para la comunidad.

#### Tamaños de pantalla y reintentos (Sep 2026)

> **Lo que pidió el propietario.** Arreglar todo lo que tenga que ver con tamaños de pantalla (móviles, medianas, grandes y muy grandes) mirando la experiencia del jugador, incluida la velocidad que se diluía en pantallas anchas. Y un panel para repetir al terminar: al perder se volvía al menú y reintentar costaba pulsar JUGAR y buscar la canción otra vez. Referencia: la pausa de Geometry Dash (barra con el porcentaje, jugar, reintentar, lista de niveles), con la duda de si reiniciar solo al perder o enseñar un panel.

**Primero se midió**, con capturas en 390×844, 844×390, 667×375, 768×1024, 1366×768, 1536×864, 1920×1080, 2560×1440 y 3840×2160, jugando en cada una:

| Hallazgo | Dónde | Efecto |
|---|---|---|
| El mundo se dibujaba a 1 unidad = 1 px CSS | engine, scenery, spawner | cuánto se ve dependía de la pantalla: tabla de abajo. En 4K el juego era una franja al pie de un cielo vacío; en un móvil vertical, injugable |
| Menú en móvil apaisado desbordado | `.daino-menu` (título `9vw`, 4 rem de relleno) | RANKING, PERFIL y AJUSTES **fuera de la pantalla, sin forma de llegar** |
| En táctil no había forma de pausar | solo Esc | ni pausar ni salir de una partida en un móvil |
| Sol ovalado / en píldora, estrellas estiradas | `background.frag` medía en uv | óvalo ancho en 16:9, píldora en vertical, estrellas de 17 px en 4K |
| UI en px fijos | CSS | en 4K menú, catálogo y HUD eran sellos diminutos |
| Botón de cerrar del catálogo junto al título | cabecera sin pestañas (sin sesión) | la columna central vacía se colapsaba |
| Fila del volumen rota en AJUSTES | grid de `.daino-settings__row` | el slider tapaba el porcentaje y la etiqueta caía debajo |
| Tras la primera partida, Espacio y flechas secuestrados | `input.js` hacía `preventDefault` global para siempre | Espacio no pulsaba botones con foco; flechas sin scroll en el catálogo ni en los desplegables |
| El repintado del catálogo perdía el foco | `paintGrid` (la red refresca lo cacheado) | el teclado volvía a `<body>` |
| `100vh` en móviles | `#app`, raíces, modales | incluye la barra del navegador: el suelo quedaba debajo |
| Montañas nuevas en cada resize | `Scenery.buildRidge` con `Math.random` | en un móvil, al esconderse la barra, la cordillera cambiaba de golpe |

**1. Vista del mundo** (`systems/worldView.js`, puro y con test de matriz de dispositivos; `WORLD_VIEW` en `config.js`). Scenery, líneas de velocidad, juego y motas cuelgan de un `worldRoot` escalado; todo lo de dentro trabaja en unidades de mundo. La escala enseña 620 de alto (`targetHeight`) sin ver nunca menos de 1000 × 420 ni más de 1600 de ancho, y se redondea para que cada celda del arte ocupe un número **entero de píxeles de dispositivo** (con `devicePixelRatio` 1.25, 7 px; nunca emborronado). La sincronía no cambia: la posición de cada obstáculo sigue saliendo del reloj de la canción en unidades de mundo, y ni el charter ni la física leen la pantalla (re-hornear los 8 oficiales dio charts idénticos).

| Pantalla (CSS, dpr) | Mundo visible antes → ahora | Lectura a 572 px/s antes → ahora | Alto del Dino (px CSS) antes → ahora |
|---|---|---|---|
| Móvil vertical 390×844 @3 | 390 → 1170 × 2532 | 0.41 → 1.77 s | 84 → 28 (se sugiere girarlo) |
| Móvil apaisado 844×390 @3 | 844 → 1266 × 585 | 1.20 → 1.94 s | 84 → 56 |
| Portátil 1366×768 @1 | 1366 → 1093 × 614 | 2.11 → 1.64 s | 84 → 105 |
| Portátil 1536×864 @1.25 | 1536 → 1097 × 617 | 2.41 → 1.64 s | 84 → 118 |
| 1080p @1 | 1920 → 1097 × 617 | 3.08 → 1.64 s | 84 → 147 |
| 4K @1 | 3840 → 1097 × 617 | 6.44 → 1.64 s | 84 → 294 |
| Ultrapanorámico 3440×1440 @1 | 3440 → 1529 × 640 | 5.74 → 2.40 s | 84 → 189 |

A la velocidad máxima del charter (690) toda pantalla apaisada da ≥ 1.26 s de lectura (test). El fondo acompaña: `uFrame` y `uCell` en el shader hacen el sol redondo en cualquier formato y cada estrella del tamaño de una celda del arte; `uHorizon` sale del suelo del mundo. El menú en una pantalla vertical usa `WORLD_VIEW_PORTRAIT_MENU` (ancho mínimo 520) para que el dino de adorno no mida 21 px; en horizontal menú y partida comparten vista y la escena no cambia de escala al empezar. Si la vista cambia en plena partida (girar, redimensionar), el Dino se mueve con el suelo.

**2. UI que escala y respeta el dispositivo** (`main.css`).
- **`rem` fluido**: 16 px hasta 1080 de alto (en su equivalente 16:9, para que una ultrapanorámica no lo infle), 20 px en 1440p, 28 px en 4K. HUD, menú, catálogo, modales y paneles pasaron de px a rem.
- **Alturas bajas** (`max-height: 560px` y `480px`): menú compacto (título por `min(9vw, 15vh)`), catálogo a pantalla completa con portadas 2:1, HUD más fino, modales centrados con menos relleno, "Subir mi canción" con el botón a la vista.
- **Márgenes seguros** (notch, barra de gestos) en HUD, menú, chip de sesión, catálogo, modales y avisos; `dvh` en vez de `vh`.
- Arreglados: cabecera del catálogo sin sesión, fila del volumen, marcas que partían "100 %" en dos líneas, slider con medidas en rem.

**3. Pausa y resultados: un solo panel** (`ui/runPanel.js`; lo que enseña, `ui/runPanelModel.js`, puro y testeado).
- **Al terminar**, la escena se queda tal cual (el Dino caído junto al obstáculo; tras superar el nivel, trotando) y encima un panel: el **porcentaje** en grande, la **barra con el mapa de la canción** (tramos, clímax) y una marca en tu mejor intento, una nota ("¡Nuevo récord!", "¡Te faltaba muy poco!", "Caíste en pleno clímax", tu mejor marca), puntos, tiempo e **intento N**. **REINTENTAR** es el único botón de color (Espacio, Enter, ↑ o R); debajo, **Niveles** (Esc: vuelve al catálogo con ese nivel enfocado y resaltado) y **Menú**.
- **Reintentar no carga nada**: el nivel cargado se guarda mientras se juega (`run` en `AppController`) y un reintento es otra `GameSession` con el mismo audio decodificado y el mismo chart, tras un fundido de 0.36 s. Al arrancar, "Intento N" en el HUD.
- **Durante 0.42 s tras abrirse, el panel ignora teclas y toques**, y una tecla mantenida desde antes (repetición) nunca decide: quien choca suele seguir machacando saltar.
- **La pausa es el mismo panel** con Reanudar delante (Esc), Reintentar (R), Niveles, Menú y el volumen. Reintentar o salir desde la pausa no guarda progreso (igual que antes salir).
- **¿Reinicio automático o panel?** Panel por defecto: un nivel de Daino es una canción entera (no 30 s memorizables como en Geometry Dash), el panel enseña lo lejos que llegaste y deja salir, y reintentar sigue costando una tecla. Quien prefiere repetir sin pausa activa **"Reintentar al instante al chocar"** en el propio panel o en AJUSTES (`daino:auto_retry`): el nivel vuelve a empezar solo ~0.8 s después del choque; la pausa sigue dejando salir.

**4. Táctil.** Botón de **pausa** en el HUD (44 px, arriba a la derecha: el mismo canal que Esc). Las **primeras 3 partidas** enseñan los controles al empezar (en táctil, cada mitad de la pantalla con lo que hace; con teclado, las teclas). En un móvil vertical, antes de empezar se sugiere **girarlo** (se puede jugar en vertical igualmente) y girarlo a vertical en plena partida la pausa. `input.js` solo captura Espacio y flechas mientras hay una partida escuchando y ningún diálogo abierto.

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **200 JS** (+17: `world-view` con 16 pantallas reales, `run-panel`). PHP y Python no se tocaron; `bake:official -- --check`: los 8 oficiales idénticos |
| E2E 1536×864 (Sugar Red) | choque al 38 % → panel (38 %, mejor 100 %, intento 1) → Espacio → "Intento 2" → Esc → pausa (AudioContext suspendido) → R → intento 3 → choque → Esc → catálogo con Sugar Red enfocada. Estados: LOADING → PLAYING → RESULTS → GAME_OVER → PLAYING → PAUSED → GAME_OVER → PLAYING → RESULTS → GAME_OVER → MENU. 0 errores de JS |
| E2E 3840×2160 | victoria al 100 % ("¡Nivel superado!", "Otra vez"); Enter → otra vez; con el reintento automático, choque → PLAYING sin panel (intento 3) |
| E2E táctil emulado (`pointer: coarse`) | 390×844: "Gira el móvil" antes de empezar; al girar a 844×390 empieza sola (vista 1266 × 585); resultados a dos columnas; pausa con el botón del HUD; girar a vertical en partida → pausa con "Gira el móvil"; Reanudar sigue la canción donde estaba |
| Teclado tras una partida | Espacio pulsa JUGAR con foco y ↓ desplaza el catálogo (antes, bloqueados); la tarjeta del nivel jugado sigue resaltada tras el repintado de la red |
| Capturas antes/después | menú y catálogo en 8-9 tamaños; partida, pausa y resultados en 390×844, 844×390, 1536×864 y 3840×2160; ajustes, "Subir mi canción" y ficha en 844×390, 390×844 y 3840×2160. Sin desbordes horizontales (catálogo medido en 3 tamaños, página en 1536×864) |
| Bundle | 175.01 KB gzip (+5.15 KB), CSS 13.09 KB |

**Decisiones (vinculantes):**

- **Toda pantalla apaisada ve el mismo mundo** (`WORLD_VIEW`), con la celda del arte entera en píxeles de dispositivo. El tiempo de lectura no depende del monitor. Ni el charter ni la física leen la pantalla; el techo de 690 px/s se razona con `WORLD_VIEW.minWidth`.
- **La UI escala con la pantalla** (rem fluido) y respeta márgenes seguros y `dvh`.
- **Una partida termina en un panel sobre la escena, con Reintentar delante y sin cargar nada.** Esc en resultados = Niveles; en pausa = Reanudar. El reinicio automático es opcional y está apagado por defecto.
- **En táctil se puede pausar siempre** (botón del HUD) y se juega en horizontal (se sugiere, no se impone).
- **El juego solo captura teclas mientras se juega** y no hay un diálogo encima.

**Limitaciones que quedan:**

- Probado con emulación de Chrome (tamaño, `devicePixelRatio`, táctil), no en dispositivos reales: márgenes seguros de iOS Safari y la barra dinámica sin comprobar en un iPhone.
- En vertical se puede jugar, pero el mundo sale pequeño (el Dino mide 28 px en un móvil de 390 px): es la consecuencia de conservar el trecho de lectura.
- 4:3 (iPad apaisado) da la lectura más justa: 1.26 s a 690 px/s.
- Sin modo práctica ni checkpoints (el diamante de Geometry Dash): encajaría con reintentos desde el último tramo de la canción, pero cambia qué cuenta como marca.
- El contador de intentos vive en memoria (se reinicia al recargar); la nota "Gira el móvil" de la pausa se decide al abrirla.

---

### Ola 6 — Vocabulario de juego ampliado ✅

**Objetivo.** Que no todo sea saltar. Que un nivel pueda tener momentos.

**Alcance.**

- **Abstracción de modos de movimiento.** Hoy `physics.js::integrateDino` asume correr/saltar. Pasa a despachar por modo, lo que abre la puerta a vuelo, gravedad invertida, o lo que se decida. El refactor es limpio porque `physics.js` ya es puro y está separado de las entidades.
- **Eventos `mode` y `fx` del chart cableados al runtime.**
- Obstáculos y momentos especiales anclados a la estructura musical (un cambio de modo al entrar al estribillo, un obstáculo especial en un golpe fuerte).
- El registro `OBSTACLE_KIND` ya es extensible desde el rediseño de Jul 2026: añadir un tipo es un sprite en `pixelart.js` y una entrada en el registro, cero código.

**Nota de alcance.** Los ejemplos concretos que motivaron esta ola (naves, portales, esquivar tres aves en tres agudos) son *ilustrativos*, no compromisos. Lo que la ola entrega es la **capacidad** de expresarlos; qué se implementa se decide al arrancarla.

La ola se parte en dos por tamaño: **6a** monta las bases y el primer modo; **6b** añade los siguientes sobre esas bases.

---

#### Ola 6a — Bases de los modos + antigravedad ✅ (Sep 2026)

> **Lo que pidió el propietario.** Jugó la Ola 5, el afinado de velocidad y los tamaños de pantalla: todo bien, pero *"en el tema del aumento de velocidad al pasar el tiempo, no se siente tanto el aumento de velocidad y dificultad; un poquito, pero no tanto"*. Y para la Ola 6: como es grande, hacer **una primera parte** que siente bien las bases — eficiente, escalable y con buena experiencia de juego.

**1. La progresión se nota más (lo que el playtest pedía).** Se midió primero: con la vista del mundo escalada, el techo de 690 px/s dejaba ≥ 1.26 s de lectura en cualquier pantalla, así que sobraba margen para escalar más. Cambios en `SPEED_RULES` y en `speedAmp` (dificultad):

| Regla | Antes | Ahora |
|---|---|---|
| Subida por marcha | +8 % | **+11 %** |
| Subida del clímax · del empuje | +18 % · +6 % | **+24 % · +8 %** |
| Una marcha cada… | 36 s | **32 s** |
| Amplitud por dificultad (Relajado → Extremo) | 0.5 … 1.3 | **0.55 … 1.4** |
| Techo | 690 px/s | **820 px/s** (≥ 1.0 s de lectura en cualquier pantalla apaisada; el legacy acababa en 0.74 s) |

Los huecos mínimos entre acciones se volvieron a medir hasta **900 px/s**: `PAIR_GAP.jumpDuck` necesitaba 15 ms más para seguir por encima de lo medido; el resto aguantaba. Resultado en los 8 oficiales: de ×1.09-1.55 a **×1.13-1.80** (What's Up Danger, Extremo: 370 → 665 px/s).

**2. Modos de movimiento: la base.** Un modo es un conjunto de reglas del cuerpo durante un tramo de la canción. El registro (`systems/modes/index.js`) es a los modos lo que `OBSTACLE_KIND` a los obstáculos: **añadir uno es un archivo con su contrato + una entrada + sus kinds**, y todo lo demás (física, simulador, charter, runtime, formato) lo consume de forma genérica.

| Pieza | Qué aporta |
|---|---|
| `systems/modes/{run,flip}.js` | Un archivo por modo: `enter`, `integrate`, `input`, `hitbox`, `leadS`, `actions`, `settleS`. La física de correr sale de `physics.js` y se convierte en un modo más. |
| `systems/geometry.js` | Superficies (suelo, techo), hitboxes y posiciones, sin depender del despachador: los modos la usan sin ciclos de importación. |
| `systems/physics.js` | Pasa a **despachar** al modo del cuerpo: `integrateBody`, `applyInput`, `bodyHitbox`, `enterMode`, `actionLeadS`. Nadie más sabe qué modos existen. |
| `systems/modeTimeline.js` | Qué modo rige cada instante de un chart. La leen la partida, el simulador, el formato y el HUD: una sola interpretación. |
| `systems/virtualPlayer.js` | "Jugar bien" definido UNA vez (antes estaba duplicado entre el simulador y los tests del bucle de frame): pulsa en el golpe, mantiene el agachado mientras haga falta, invierte ante cada cristal. |
| `levels/modePlan.js` | Dónde van los modos en la canción y por qué portales se entra y se sale. |
| Formato de chart **3** | Eventos `{ t, type: 'mode', mode }`. Un cliente viejo se niega a cargarlo (cambia la semántica) en vez de jugar un nivel distinto; un obstáculo fuera de su modo se descarta con aviso. `ChartValidator.php` acepta 1, 2 y 3. |

**3. El primer modo: antigravedad.** Un pasillo con techo (300 unidades de mundo); cualquier pulsación invierte la gravedad y el Dino cae a la otra superficie en ~0.21 s. Los cristales del suelo obligan a subir y los del techo a bajar, así que un tramo se lee como un **zigzag** que se ve desde lejos.

Por qué este modo primero, y no la nave: es la mecánica nueva que **mejor encaja con "actúa sobre el golpe"**. Cada pulsación sigue siendo un gesto discreto (como un salto), así que toda la sincronía de la Ola 3, la validación de la Ola 5 y el modelo de la vista del afinado de velocidad valen tal cual; lo que cambia es *qué* se juega. Una nave (mantener para subir) es control continuo: necesita otro jugador virtual y otra forma de chartear, y es justo lo que las bases de 6a permiten añadir después sin tocar lo de ahora.

Medido con la física real (`tests/js/modes.test.mjs`): el adelanto del cristal sale de lo que tarda el Dino en despejarlo (0.075 s) más un margen de 0.24 s, lo que deja **90-210 ms para pulsar tarde** según la velocidad y de sobra para pulsar pronto; dos inversiones seguidas caben a 0.21-0.30 s, y `PAIR_GAP.flipFlip` queda por encima en todo el rango. **Aporrear no sirve**: pulsando cada 0.2 s se choca con algún cristal en las cuatro fases probadas.

**4. Dónde va un modo (y dónde no).** `modePlan.js`, con las mismas ideas que las marchas de velocidad:

- Tramos que **suenan con cuerpo** (groove o más), nunca en el primer 20 % de la canción ni antes del segundo 24: primero se aprende a correr.
- Frases completas de 4 compases, entre **12 y 24 s** (en un tema a 65 BPM, 16 compases son 44 s: sería media canción).
- Orden: **estreno**, luego el **clímax** si la dificultad lo permite, luego el material del primer tramo que empuja. Cuando ese material vuelve, vuelve su modo: "el estribillo es la antigravedad". Entre dos tramos, ≥ 16 s corriendo.
- **La dificultad decide**: Relajado no cambia de reglas nunca; Fácil un tramo; Normal hasta dos y **el clímax se corre** a toda velocidad; Difícil y Extremo hasta tres, el clímax incluido.
- **Transiciones como las de velocidad** (decisión vinculante del afinado): el portal cae en la **anacrusa** del primer compás, antes de él la última acción deja pasar su obstáculo y después el Dino tiene tiempo de asentarse. La **primera vez** que un modo aparece en la canción, sus dos primeras inversiones van en el pulso y separadas ≥ 1.1 s: se estrena, no se impone.

**5. Se ve venir, como todo lo demás.** El portal es un **objeto del mundo** (`entities/ModeGates.js`) que cruza al Dino exactamente en el instante del chart, con la misma fórmula que los obstáculos: un óvalo de neón con las flechas del modo y, tras él, el techo del pasillo, que aparece con el portal de entrada y termina en el de salida. Encima: el mapa de la canción marca los tramos con el color del modo; el HUD lo nombra dos compases antes (y un par de beats antes de volver a correr) y, las **tres primeras partidas** con un modo, explica sus controles ("Espacio: invertir la gravedad" / "Toca para invertir la gravedad"); al cruzar, destello del color del modo y columna de chispas; las líneas de velocidad se quedan por encima del pasillo (una raya a la altura del techo se leería como un obstáculo).

**Los 8 oficiales con el charter 5** (dificultad del manifiesto; lectura = segundos para ver venir un obstáculo a la velocidad máxima en una pantalla 16:9):

| Oficial (dificultad) | Duración | Velocidad (×) | Lectura a tope | Acciones | Tramos de antigravedad | Acciones/min | Estrellas |
|---|---|---|---|---|---|---|---|
| Sugar Red (Normal) | 0:40 | 472 → 585 (×1.24) | 1.61 s | 27 | — | 46 · pico 48 | 3★ (medida 3★) |
| Last Christmas (Relajado) | 0:39 | 394 → 446 (×1.13) | 2.11 s | 12 | — | 20 · pico 21 | 1★ (medida 1★) |
| HOPE (Fácil) | 1:19 | 500 → 640 (×1.28) | 1.47 s | 36 | — | 30 · pico 36 | 2★ (medida 2★) |
| Running With the Wolves (Normal) | 2:44 | 508 → 797 (×1.57) | 1.18 s | 119 (19 cristales) | 1: 1:31-1:54 | 46 · pico 72 | 3★ (medida 4★) |
| Time (Fácil) | 2:46 | 432 → 629 (×1.46) | 1.50 s | 88 (8) | 1: 1:15-1:30 | 33 · pico 51 | 2★ (medida 2★) |
| Mi Fiesta (Difícil) | 3:14 | 389 → 655 (×1.68) | 1.44 s | 169 (15) | 1: 1:18-1:36 | 55 · pico 75 | 4★ (medida 4★) |
| Dawn of Faith (Difícil) | 3:17 | 440 → 741 (×1.68) | 1.27 s | 130 (41) | 3: 0:44 · 2:00 · 2:32 | 44 · pico 60 | 4★ (medida 3★) |
| What's Up Danger (Extremo) | 3:36 | 370 → 665 (×1.80) | 1.42 s | 205 (79) | 3: 0:53 · 1:41 · 2:52 (clímax) | 59 · pico 90 | 5★ (medida 5★) |

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **219 JS** (+19: `modes.test.mjs` entero, antigravedad en el bucle de frame, umbrales nuevos), **69 PHP** (+1: formato 3), **104 Python** (sin cambios) |
| 8 oficiales × 5 dificultades (40 charts) | jugables con la tolerancia de su dificultad **y con los portales aplicados**, 0 reparaciones, sin avisos al normalizar, 10-350 ms por chart |
| Regresiones protegidas | Relajado nunca cambia de reglas; ningún tramo pasa de 24 s; alrededor de un portal no hay acciones; los cristales alternan suelo/techo desde el suelo; el estreno espera y va espaciado; determinismo byte a byte con modos |
| E2E Time (Fácil, 1536×864, bot con pulsaciones fechadas) | **victoria al 100 %**, 88 pulsaciones, 8 inversiones entre 77.2 y 88.6 s; aviso del modo desde 67.1 s (portal en 74.7), chip "on" a 74.8 y fuera a 90.0; 9 859 frames, mediana 16.7 ms, p95 20, p99 22.5 |
| E2E Dawn of Faith (Difícil, 3 tramos) | **victoria al 100 %**, 142 pulsaciones, **44 inversiones** en los tres pasillos (47-66, 120-133, 152-166 s); capturas del portal acercándose, del Dino cabeza abajo y del pasillo entero |
| E2E móvil apaisado (844×390, táctil emulado) | reintento desde el panel, mitad derecha agacha y mitad izquierda salta corriendo, y **en antigravedad cualquier mitad invierte**; panel de resultados legible (26 %, intento 2) |
| Consola | 0 errores de JS (solo el 401 del arranque anónimo y el favicon) |
| Bundle | **180.20 KB gzip** (+5.19), CSS 13.55 KB (+0.46); por debajo del límite de 200 KB |
| Oficiales y comunidad | los 8 re-horneados y re-sembrados; los 3 de la comunidad re-charteados por el worker en 2 s cada uno (análisis en caché) |

**Decisiones (vinculantes):**

- **Un modo de movimiento es una entrada de registro**, no un `if` en la física: `systems/modes/`. Quien añada uno escribe su archivo, sus kinds (con `mode` y `action`) y sus reglas de colocación; física, simulador, charter, formato y runtime no se tocan.
- **Todo chart empieza corriendo** y cambia de modo solo con eventos `mode`; un obstáculo fuera de su modo no se juega (se descarta con aviso).
- **Un cambio de modo es una transición**, con las reglas ya vinculantes del afinado de velocidad: anacrusa de un compás que abre tramo, sin acciones alrededor, avisado en el runtime y validado con el modelo de la vista.
- **Un modo es un momento, no la norma**: frases de 12-24 s, ≥ 16 s corriendo entre ellos, y nunca en el primer quinto de la canción.
- **La dificultad decide qué modos aparecen, cuántas veces y si el clímax es uno.** Relajado se juega entero corriendo.
- **"Jugar bien" se define una sola vez** (`virtualPlayer.js`): lo usan el validador del charter, los tests del bucle de frame y el bot de los E2E.
- La progresión de velocidad sube a ×1.13-1.80 con techo 820 px/s; cualquier cambio de esa tabla exige volver a medir `PAIR_GAP`, subir `CHARTER_VERSION`, re-hornear y `--charter-below`.

**Limitaciones que quedan:**

- ~~**El playtest humano manda y está pendiente**, sobre todo si tres tramos de antigravedad en un tema largo (79 de 205 acciones en What's Up Danger Extremo) son demasiados.~~ Lo eran: la Ola 6b pasa a un momento por modo donde la canción suena distinta. Todo lo afinable está en tablas: `MODE_RULES` (modePlan.js), `modes` por dificultad (difficulty.js), `FLIP_MODE` y `MODE_FX` (config.js). Las dos primeras exigen subir `CHARTER_VERSION`.
- El pasillo mide 300 unidades de mundo fijas: en pantallas muy bajas (32:9) cabe, pero el margen sobre el HUD es de ~50 unidades (test en `world-view.test.mjs`).
- En antigravedad no hay agachado ni salto: una sola acción. Las figuras salen del ritmo, no de combinar gestos.
- El bot de los E2E pulsa por el reloj de la canción, así que **no prueba la lectura visual** del zigzag: eso solo lo dice una persona jugando.
- `locator.tap()` sigue sin poder usarse (hace falta `hasTouch` en el contexto): el toque se comprueba con `TouchEvent` sintético, que ejerce nuestro manejador pero no la tubería táctil del navegador.

---

#### Ola 6b — Cada canción, sus momentos: reparto de modos y vuelo ✅ (Sep 2026)

> **Lo que pidió el propietario tras jugar la 6a.** (1) Al pasar el portal, *"el techo corre, parece una cinta de correr"*: se desplazaba más rápido que el mundo. (2) *"3 tramos de antigravedad en What's Up Danger son demasiados"*: mejor 1 o 2, como un evento, y **donde la canción suena distinta** (un puente, un tramo pasivo o uno épico, según la canción: *"cada canción es un mundo distinto"*). (3) Que los modos tengan sentido por nivel: según sus sonidos, su duración y su dificultad; que unos niveles tengan un modo que otros no y que las dificultades fáciles no tengan todo lo de las difíciles. Organizado, escalable, sin bugs y bien probado.

**1. El techo que resbalaba (bug).** Al recortar la tira del techo por la izquierda de la pantalla, el desfase de su textura tenía el signo cambiado, así que el dibujo avanzaba al doble de la velocidad del mundo. El recorte vive ahora en una función pura (`systems/tiling.js::clipTiledStrip`) con su test de regresión (`tests/js/tiling.test.mjs`: un punto del techo muestra siempre el mismo píxel de la textura, se recorte como se recorte), comprobada contra cómo `TilingSpriteShader` de Pixi v8 aplica `tilePosition`. En partida, medido en 455 frames de Time: la fase de la textura respecto al mundo no se mueve (±6 px de ruido del reloj en un periodo de 128); con el fallo habría recorrido el periodo varias veces por segundo.

**2. Qué suena distinto: el carácter de cada tramo** (`levels/songCharacter.js`). Para cada tramo del arco, frente a lo **típico de esa canción** (mediana ponderada por duración y dispersión robusta):

| Rasgo | De dónde sale |
|---|---|
| `contrast` | cuánto se aparta en energía, densidad de golpes, percusividad, graves/medios/agudos y ritmo armónico; más si su material suena una sola vez, si el análisis lo reconoce como puente o break, o si cambia de tonalidad |
| `passive` / `epic` | más tranquilo o más intenso que lo típico (el clímax es épico por definición) |
| `sustain` / `rhythmic` | notas sostenidas (pocos golpes, poco percusivos) o golpes marcados (densos y percusivos) |

Usa por primera vez en el charter lo que el analizador 2 ya medía (`onsetPercussive`, `energy.bands`, acordes y tonalidad por sección: `musicModel.js` gana `percussiveness`, `bandsMean`, `chordChangeRate`, `tonal`). Con un análisis sin esos campos (navegador, formato 1) usa lo que hay y el contraste sale más bajo: menos momentos, nunca inventados.

**3. El reparto de modos** (`levels/modePlan.js`, reescrito). Un modo es un **evento** de la canción:

- Cada modo declara con qué carácter encaja (`MODE_CASTING`): la **antigravedad**, que se juega a golpes, con tramos rítmicos y épicos; el **vuelo**, que se juega manteniendo, con los sostenidos y pasivos. Los dos piden contraste.
- Solo entran encajes claros (`minScore` 0.5) en tramos que contrastan (`minContrast` 0.4; el clímax, que ya es único, 0.28). **Una canción que suena igual de principio a fin no tiene momentos.**
- **Cada modo, como mucho una vez por nivel** (siempre es su estreno), separados ≥ 12 s, nunca en el primer quinto.
- **La dificultad** decide qué modos existen y cuántos momentos caben por duración (`difficulty.js`: `modes` y `moments`): Relajado ninguno; Fácil solo antigravedad (el vuelo pide mantener) y uno desde 75 s; Normal los dos, uno desde 75 s y dos desde 150 s, sin tocar el clímax; Difícil y Extremo, uno desde 60 s y dos desde 120 s, y el clímax puede ser uno.
- Entre todas las combinaciones posibles se elige la de mejor encaje total. El momento dura el tramo entero si cabe en 10-24 s; si no, sus frases.

Medido en la canción sintética con un break de batería y un puente sostenido (`CONTRAST_SONG_SECTIONS`): antigravedad en el break y vuelo en el puente a 90, 120 y 150 BPM; una canción uniforme, ninguno en ninguna dificultad; si solo el clímax suena distinto, Normal lo corre y Difícil lo cambia.

**4. El segundo modo: vuelo** (`systems/modes/fly.js`). Mantener cualquier botón sube; soltar, baja; **en línea recta a 300 unidades/s**, entre el suelo y el techo del pasillo, sin inercia. Por eso las notas mantenidas del chart determinan **un único camino**, y el nivel es un **túnel** que sigue ese camino con la holgura de la dificultad por arriba y por abajo (`systems/flightCourse.js`). Una sola geometría para todo: la partida la dibuja (`entities/FlightTunnel.js`, un `Graphics` por tramo construido una vez) y choca con ella, y el charter la valida. La colisión comprueba los muros en todo el intervalo de tiempo que ocupa el ancho del hitbox, así que una esquina no atraviesa al Dino entre dos pasos de física. Tras el portal, 0.5 s de **boca abierta** (el Dino puede cruzarlo al final de un salto).

Lo que el simulador enseñó al medirlo:

- **Los errores de tiempo se acumulan.** La altura es la suma de todo lo mantenido: empezar tarde y soltar pronto deja al Dino 2 × 300 × tolerancia por debajo, y la nota siguiente hereda el desvío. Con notas pegadas, quien juega con ±55 ms choca a la tercera nota. Regla: **entre notas el camino vuelve al suelo** (el suelo pone el error a cero), con un silencio de lo que tarda en bajar + 4 tolerancias (`flightCharter.js::restEnd`). Con ella, ninguna dificultad falla.
- La holgura necesaria es **3 × velocidad × tolerancia** (no 1×: soltar pronto baja mientras el camino aún sube) + lo que se inclina el camino a lo ancho del hitbox a la velocidad más lenta del tramo + 10 (`flightMargin`): 53-74 unidades entre Extremo y Normal.

**Notas mantenidas** (`levels/flightCharter.js`): empiezan en huecos de la rejilla con golpe (a contratiempo solo con golpe fuerte y la mecánica desbloqueada), duran hasta el siguiente golpe con cuerpo entre medio beat y dos beats (≤ 1.1 s; sin golpe, un beat), tantas como las acciones por minuto del nivel del arco, con memoria de frases, estreno en el pulso y aterrizaje antes del portal de salida. El validador del charter juega las notas con las tres pautas de tolerancia (el jugador virtual acorta y alarga cada nota) y, ante un choque con el túnel, quita la nota menos importante de las dos últimas.

**5. Formato de chart 4.** El portal del vuelo lleva `margin` (12-120) y hay eventos `{ t, type: 'hold', until }`. Una nota fuera de un tramo de vuelo, solapada o que sigue tras el portal de salida se descarta con aviso. **Un modo desconocido ya no se descarta: lanza `ChartError`** (el tramo se jugaría con otras reglas: sería otro nivel, o uno imposible). `ChartValidator.php` acepta 1-4 y valida `margin` y `until`. `chartStats` cuenta cada nota como una acción con el margen que le deja su túnel. `CHARTER_VERSION = 6`.

**6. En partida.** Portal con las flechas de su modo (antigravedad ↑↓, vuelo ↑↑, correr ↓) y techo del pasillo con la línea en el color de cada modo; muros del túnel con filo dorado que late con el beat; el Dino inclina el morro al subir y al bajar, suelta chispas doradas mientras mantiene y hace squash al posarse; el aviso del HUD usa el texto de cada modo del registro (`hint`: "Mantén Espacio para subir" / "Mantén el dedo en la pantalla para subir") y cada modo lleva su propia cuenta de las 3 primeras partidas; pulsar en el golpe de una nota da el destello de "en el golpe"; la victoria y "¡Superado!" esperan también a salir del túnel; al volver de una pausa nada se da por mantenido (una tecla soltada con la pestaña oculta no llega).

**Los 8 oficiales con el charter 6** (dificultad del manifiesto; velocidades y lectura como en la 6a):

| Oficial (dificultad) | Duración | Acciones | Momentos | Acciones/min | Estrellas |
|---|---|---|---|---|---|
| Sugar Red (Normal) | 0:40 | 27 | — (corta) | 46 · pico 48 | 3★ (medida 3★) |
| Last Christmas (Relajado) | 0:39 | 12 | — | 20 · pico 21 | 1★ (medida 1★) |
| HOPE (Fácil) | 1:19 | 36 | — (ningún tramo encaja) | 30 · pico 36 | 2★ (medida 2★) |
| Running With the Wolves (Normal) | 2:44 | 120 (7 cristales) | antigravedad en el **puente** (1:59) | 46 · pico 72 | 3★ (medida 4★) |
| Time (Fácil) | 2:46 | 88 (8) | antigravedad 1:14 | 33 · pico 51 | 2★ (medida 2★) |
| Mi Fiesta (Difícil) | 3:14 | 171 | — (suena uniforme) | 55 · pico 75 | 4★ (medida 4★) |
| Dawn of Faith (Difícil) | 3:17 | 126 (9) + 4 notas | **vuelo** 1:28 · antigravedad en el clímax 2:00 | 44 · pico 63 | 4★ (medida 3★) |
| What's Up Danger (Extremo) | 3:36 | 187 (26) + 4 notas | **vuelo** en el break de 2:11 · antigravedad en el clímax 2:52 | 55 · pico 78 | 5★ (medida 4★) |

What's Up Danger pasa de 3 tramos de antigravedad (79 de 205 acciones) a **dos momentos distintos**; en Normal, solo el vuelo del break. En las cinco dificultades de los 8 oficiales hay niveles sin modos, con uno y con los dos.

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **238 JS** (+19: `flight.test.mjs` 10, `song-character.test.mjs` 5, `tiling.test.mjs` 2; `modes.test.mjs` reescrito para el reparto; vuelo en el bucle de frame), **70 PHP** (+1: formato 4), **104 Python** (sin cambios) |
| 8 oficiales × 5 dificultades (40 charts) | jugables con la tolerancia de su dificultad, con portales y túneles, **0 reparaciones**, ≤ 2 momentos, cada modo una vez, ninguno fuera de su dificultad ni en un clímax que no le toca, 6-290 ms por chart |
| E2E What's Up Danger (Extremo, 1280×720, bot con pulsaciones y notas fechadas) | **victoria al 100 %**, 263 entradas; vuelo 131.6-144.2 s y antigravedad 172.1-192.3 s en su instante; aviso "Vuelo · Mantén Espacio para subir" antes del portal; capturas del túnel subiendo y bajando |
| E2E Dawn of Faith móvil (844×390, táctil emulado, notas con `TouchEvent` reales del manejador) | aviso "Mantén el dedo en la pantalla para subir"; tres notas tocadas 6-15 ms tarde, superadas; **la cuarta sin tocar choca con el muro** (98.7 s): la colisión del túnel está cableada |
| E2E Time (techo de la antigravedad) | fase de la textura del techo fija respecto al mundo en 455 frames, sin recortar y recortado |
| Consola | 0 errores de JS (solo el 401 del arranque anónimo y el favicon) |
| Bundle | **186.09 KB gzip** (+5.89); por debajo del límite de 200 KB, pero ya cerca |
| Oficiales y comunidad | los 8 re-horneados y re-sembrados; los 3 de la comunidad re-charteados por el worker (`--charter-below=6`) |

**Decisiones (vinculantes):**

- **Un modo es un evento de la canción, no una rutina**: aparece donde un tramo suena distinto y encaja con su forma de jugarse, como mucho una vez por nivel; una canción sin contraste no tiene momentos. Sustituye "hasta tres tramos donde vuelve el estribillo" de la 6a.
- **Qué modos existen lo decide la dificultad** (Fácil sin vuelo, clímax solo desde Difícil) y **cuántos momentos, la duración**.
- **Añadir un modo** = su archivo en `systems/modes/` + su entrada en `MODE_CASTING` (con qué carácter encaja) + su lugar en `modes` de cada dificultad + sus kinds o su propio charter. El reparto, el formato y el runtime genéricos no se tocan.
- **Los modos de control continuo se validan como túneles deterministas**: movimiento sin inercia, camino único derivado de las notas, muros con la holgura de la tolerancia, y vuelta a un estado de error cero (el suelo) entre notas.
- **Una misma geometría para dibujar, chocar y validar** (`flightCourse.js`).
- **Un modo desconocido en un chart es un error**, no un aviso.

**Limitaciones que quedan:**

- **El playtest humano manda**: si el vuelo (4 notas en 12-13 s en los oficiales) sabe a poco o a mucho, si la antigravedad en un puente pasivo (RWTW, 7 cristales) convence, y si los umbrales del reparto aciertan con canciones de la comunidad. Todo en tablas: `MODE_RULES` y `MODE_CASTING` (modePlan.js), `modes`/`moments` (difficulty.js), `FLY_RULES` (flightCharter.js), `CHARACTER_RULES` (songCharacter.js), `FLY_MODE`/`FLY_JET` (config.js). Cualquier cambio de charter sube `CHARTER_VERSION`.
- **La vuelta al suelo limita la densidad del vuelo** (una nota cada ~1.5-2 s). Un jugador humano corrige mirando el túnel y no acumula error como el jugador virtual de guion; tratar el vuelo con un jugador virtual que reacciona (política) permitiría frases encadenadas. Queda para una ola siguiente.
- El bot de los E2E juega por el reloj: no prueba si el túnel **se lee** bien a la velocidad real; eso solo lo dice una persona.
- A ~90-96 BPM el clímax de Difícil corriendo sale menos denso que el empuje (dos acciones de correr no caben en beats seguidos a ×1.68): en la 6a lo tapaba una antigravedad en el clímax. El test de densidad por arco usa 104 BPM y lo documenta.
- El bundle se acerca a los 200 KB: la siguiente ola con código de juego debería medir qué se puede partir.

---

#### Ajustes tras el playtest de la 6b: los momentos siguen a la música ✅ (Sep 2026)

> **Lo que se jugó.** Con la herramienta de dev "sin colisiones", tres niveles de principio a fin, anotando los minutos. **What's Up Danger** (Extremo): el vuelo entra con la calma de las 2:12 y termina a las 2:24, aunque la calma sigue un poco; hacia las 2:38 entra el bombo y a las 2:40 el cantante grita: *lo más emocionante del tema, y el Dino seguía corriendo* (solo los efectos visuales lo reflejaban); la antigravedad empezaba a las 2:52 y terminaba a las 3:12, con el coro. **Time** (Fácil): la antigravedad de la 1:15 encaja, pero terminaba a la 1:30 sin que la canción cambiase; a la 1:47 entran instrumentos y la zona roja, bien. **Dawn of Faith** (Difícil): el vuelo empieza justo en el cambio de la 1:28, pero termina a la 1:42 *y la canción sigue sonando casi igual*. Pidió averiguar si fallaba el analizador o el reparto, sin mover nada a mano: si hay que mover algo a mano, el sistema no está bien hecho.

**Diagnóstico.** Medido compás a compás con los datos del análisis y, para descartar al analizador, con un diagnóstico aparte de novedad espectral (6 bandas en dB, timbre MFCC, croma, densidad) sobre el audio real de las tres canciones.

- **El analizador tenía los cambios.** What's Up Danger: entre las 2:29.6 y las 2:34.7 la energía cae de 0.67 a 0.23 (un break casi en silencio), a las 2:37.2 vuelve de golpe a 0.73 y a las 2:39.7 a 0.90, y ahí se queda hasta la outro (3:22.7); en el audio, la banda de 2.5-6 kHz sube 4 dB con el grito. Dawn of Faith: a las 1:49.6 la energía pasa de 0.25 a 0.66 (el bajo, +25 dB en 20-150 Hz). Time: a la 1:45.7 medios y agudos +2.7 dB. Y donde se oyó que no cambiaba nada, no cambia nada: en Time 1:30 y Dawn of Faith 1:42 la novedad es de 0.3-0.5, frente a 1-3 en un cambio real.
- **Pero sus secciones son de material, no de sonido** (agrupación espectral por timbre y armonía: un estribillo se parece a los otros). Un break y la vuelta tras él son el mismo material a otro volumen: en What's Up Danger, de las 2:24.5 a las 3:22.7 es una sola sección de 58 s con el break y la vuelta dentro. Eso es correcto para lo que se pensó (qué se repite) y no se toca.
- **El charter no leía lo que había.** Tres causas:
  1. El arco solo partía una sección por un salto de intensidad compuesta a **≥ 8 compases** del último corte. La vuelta de What's Up Danger quedaba a 5 compases de la frontera anterior. Y la intensidad pesaba un 30 % la **actividad de golpes**, que en un muro de guitarras distorsionadas BAJA aunque suene más (estrofa de la 1:51: 4.4 golpes/s; final: 1.0-1.6), así que el final valía 0.66-0.72 frente a 0.83 de una estrofa.
  2. El clímax de un tramo largo eran sus **últimos** 12-16 compases: en What's Up Danger, 2:52.3-3:22.7, 15 s después de la vuelta.
  3. Un modo se cortaba en **frases de 4 compases desde su inicio hasta 24 s**, terminara la música o no: Time a la 1:30 y Dawn of Faith a la 1:42 son exactamente ese corte.
- **Lo que no se puede medir:** en What's Up Danger, de las 2:42 a las 3:20 el acompañamiento no cambia y el cantante alterna canto (2:52) y grito (3:05). En la mezcla eso no se ve (novedad 0.0-0.4 frente a 1-3 de un cambio real) y separar la voz exige un modelo de separación de pistas, descartado por memoria (afinado del analizador). Por suerte no hacía falta: lo que se pidió fue que el momento empiece donde la canción explota.

**Qué se construyó.** El analizador no cambia (ni su versión). Todo es del charter (`CHARTER_VERSION = 7`, formato de chart igual):

1. **`levels/songChanges.js` — dónde cambia la canción.** Cada compás es un vector de rasgos del análisis (energía, graves, medios, agudos, densidad y percusividad de los golpes; la densidad y la percusividad pesan poco porque el primer compás de un pasaje suele traer un redoble), cada uno en su escala en la canción. Se busca la **partición en pasajes homogéneos que mejor explica la canción** (mínimos cuadrados con un coste por frontera, exacta por programación dinámica, O(n²): 21 ms para una canción de 20 minutos y 896 compases). Un par de compases tras los que todo vuelve a sonar como antes (una parada, un redoble) no cuenta. Las fronteras de sección del analizador se conservan, y una de sonido a un compás de una de sección se lleva a su sitio. Cada frontera lleva su **fuerza** (distancia media en z entre los 4 compases de antes y los de después: la vuelta de What's Up Danger 1.82, el break de Dawn of Faith 1.42, Time 1:45.7 0.56, un cambio de sección que no cambia el sonido 0.2-0.4), su **subida de energía** y su **plenitud** (media de graves, medios y agudos): el break de las 2:11.9 de What's Up Danger sube de energía porque se queda solo el bajo, pero se vacía.
2. **`songArc.js`.**
   - **Tramos** donde el sonido cambia (fuerza ≥ 0.5), no en toda frontera de sección: los cambios de sección de Dawn of Faith a las 2:21 y 2:32 (0.21 y 0.33) partían su clímax en tres trozos.
   - Un tramo **corto** (< 4 compases **y** < 8 s; solo en compases, la vuelta de 11 s de Dawn of Faith a 65 BPM y 3/4 se perdía) se funde **por su frontera más débil**: el break de 2 compases antes de la vuelta de What's Up Danger se queda con lo anterior y la vuelta abre el tramo. El principio o el final de la canción separados por un cambio claro se quedan como tramo (el final de Mi Fiesta metía 5 s de silencio en su clímax).
   - **Intensidad** = 50 % energía, 20 % plenitud, 10 % actividad, 20 % energía de la sección (antes 50/0/30/20).
   - **Clímax** de un tramo largo (> 16 compases o 40 s, antes 34): si el tramo **entra de golpe** (subida de energía ≥ 0.1 en un cambio real) el clímax empieza en el golpe; si no, es su final. El corte va donde el tramo cambia algo por dentro (el cambio más marcado, aunque no llegue a partir un tramo) o, si no cambia nada, en una frase de 4 compases contada desde el final del tramo, que es donde una sección cambia aunque su entrada traiga una anacrusa o un compás de más. En What's Up Danger ese corte cae a las 3:12.5: el coro.
3. **`songCharacter.js`: la llegada.** `arrival` = cuánto sube o se vacía la canción al entrar en el tramo (±0.35 de energía o plenitud vale 1) y `rises` = si se llena. El final de What's Up Danger suena como sus estrofas fuertes (contraste con lo típico 0.30): lo que lo hace un momento es cómo llega.
4. **`modePlan.js`.**
   - **Un momento es un tramo entero, de 10 a 40 s:** entra donde la canción cambia y sale donde vuelve a cambiar, o en el borde del clímax (donde el nivel también cambia: la marcha sube o se suelta). Sin cortes por duración: un pasaje de más de 40 s no es un momento. Tampoco entra en un corte de clímax hecho por frase, donde no cambia nada.
   - `MODE_CASTING.event(c)`: cuánto es un momento **para cada modo**, el contraste con lo típico o la llegada **hacia su carácter**: una llegada que revienta hacia lo más intenso es de antigravedad (× `epic`), una que se vacía hacia la calma, de vuelo (× `passive`). Una estrofa corriente tras un estribillo también baja, pero a lo típico: no es un momento.
   - Al repartir, el clímax cuenta **+0.1** de encaje (donde la dificultad lo permite): es el momento más intenso. Sin eso, la antigravedad de Dawn of Faith se iba al tramo de después del clímax por 0.006.
   - Separación mínima entre momentos: **10 s** (antes 12): entre el vuelo y el clímax de Dawn of Faith suena la vuelta del bajo, 11.1 s, un tramo entero corriendo.

**Los tres niveles del playtest**, con la dificultad del manifiesto:

| Nivel | Lo que se oyó | Charter 6 | Charter 7 |
|---|---|---|---|
| What's Up Danger (Extremo) | calma 2:12; vuelve tras el break 2:37-2:40 (lo más intenso); coro 3:12; solo música 3:23 | vuelo 2:11.6-2:24.2 · antigravedad **2:52.0**-3:12.2 · clímax **2:52.3-3:22.7** · marcha al clímax 2:52.0, se suelta 3:22.7 | vuelo 2:11.6-2:24.2 · antigravedad **2:36.9-3:12.2** · clímax **2:37.2-3:12.5** · marcha **2:36.9**, se suelta **3:12.5** |
| Time (Fácil) | cambio 1:15; nada a la 1:30; instrumentos y zona roja 1:47; calma 2:16 | antigravedad 1:14.7-**1:30.0** · primera marcha **0:28.9** | antigravedad 1:14.7-**1:45.2** (sale al entrar el clímax) · primera marcha **0:44.2** (entran instrumentos) |
| Dawn of Faith (Difícil) | cambio 1:28; nada a la 1:42; (vuelve el bajo 1:49.6); cambio leve 2:00 | vuelo 1:28.4-**1:41.7** · antigravedad 2:00.2-**2:13.1** · clímax 2:00.7-2:32.0 | vuelo 1:28.4-**1:49.1** · antigravedad 2:00.2-**2:31.6** (el clímax entero) · clímax 2:00.7-2:32.0 |

(Los portales van en la anacrusa, unas décimas antes del primer tiempo del tramo.)

**Los 8 oficiales con el charter 7** (dificultad del manifiesto):

| Oficial (dificultad) | Acciones (cristales) + notas | Momentos | Acciones/min | Estrellas |
|---|---|---|---|---|
| Sugar Red (Normal) | 26 | — | 44 · pico 48 | 3★ (medida 3★) |
| Last Christmas (Relajado) | 13 | — | 22 · pico 21 | 1★ (medida 1★) |
| HOPE (Fácil) | 38 | — | 32 · pico 36 | 2★ (medida 2★) |
| Running With the Wolves (Normal) | 103 (9) + 3 | antigravedad en el primer estribillo (0:58.9, energía +0.35) · vuelo 2:14.9-2:26.6 | 41 · pico 57 | 3★ (medida 3★) |
| Time (Fácil) | 85 (19) | antigravedad 1:15.2-1:45.7 | 34 · pico 48 | 2★ (medida 2★) |
| Mi Fiesta (Difícil) | 180 | — (suena uniforme) | 58 · pico 81 | 4★ (medida 5★) |
| Dawn of Faith (Difícil) | 119 (29) + 8 | vuelo 1:28.8-1:49.6 · antigravedad en el clímax 2:00.7-2:32.0 | 43 · pico 63 | 4★ (medida 3★) |
| What's Up Danger (Extremo) | 177 (50) + 4 | vuelo 2:11.9-2:24.5 · antigravedad en el clímax 2:37.2-3:12.5 | 52 · pico 93 | 5★ (medida 5★) |

Cambian también niveles que no se jugaron: en Running With the Wolves la antigravedad pasa del puente (2:00) al primer estribillo, que entra de golpe, y el vuelo va al tramo sostenido que lleva al clímax; el clímax de HOPE empieza en su segunda sección (0:26.7, 36 s) y, al llegar antes del segundo 35, no hay marcha (velocidad máxima 596 px/s en vez de 640). Los momentos duran más: la antigravedad de What's Up Danger pasa de 26 a 50 cristales (pico de 93 acciones/min en 20 s, en el clímax de Extremo).

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **248 JS** (+10: `song-changes.test.mjs` 5; en `song-arc` el clímax que entra de golpe, el que no y el break dentro de una sección; en `song-character` la llegada; en `modes` el momento de tramo entero y **el playtest como regresión**: modos, clímax y marcha de What's Up Danger, Time y Dawn of Faith en los instantes medidos), **70 PHP**, **104 Python** |
| 8 oficiales × 5 dificultades | jugables con la tolerancia de su dificultad, 0 reparaciones, cada modo una vez, ≤ 2 momentos, todos los momentos de tramo entero |
| Oficiales y comunidad | re-horneados (`bun run bake:official`) y re-sembrados (`seed:official -- --rechart`); la comunidad, re-charteada por el worker (`--charter-below=7`) |
| E2E What's Up Danger (Extremo, 1280×720, "sin colisiones" del panel de dev) | el cliente carga el chart 7 del servidor; en partida: corriendo a las 2:11.1, **vuelo** a las 2:14, corriendo a las 2:26 y a las 2:36.5 (525 px/s), **antigravedad a las 2:39.5 con el clímax encendido en el HUD, a 665 px/s**, con el drop del chart a las 2:37.2; sigue en antigravedad y clímax a las 3:00 y a las 3:12.0; a las 3:14.5 corriendo, sin clímax y soltando (599 px/s); victoria al 100 % |
| Consola | 0 errores de JS (solo el 401 del arranque anónimo y el favicon) |
| Bundle | **187.86 KB gzip** (+1.77) |

**Decisiones (vinculantes):**

- **Un tramo empieza donde la canción cambia de verdad**, no en cada frontera de sección del analizador: sus secciones dicen qué material se repite, y un cambio de sección que no cambia el sonido no parte nada.
- **Un modo es un tramo entero: entra y sale con la música** (o en el borde del clímax). Nada de cortes por duración; un pasaje de más de 40 s no es un momento. Sustituye "12-24 s, frases de 4 compases" de la 6a/6b.
- **Un clímax largo que entra de golpe empieza en el golpe.**
- **La llegada cuenta**: un tramo que revienta hacia lo más intenso es un momento de antigravedad aunque suene como el resto de la canción; uno que se vacía hacia la calma, de vuelo.
- **La intensidad del arco es sobre todo energía y plenitud**; la actividad de golpes pesa poco.
- **El analizador no se toca** para esto: sus datos ya contenían los cambios. Detectar cambios solo de la voz (canto/grito sobre el mismo acompañamiento) queda fuera mientras no haya separación de pistas.

**Limitaciones que quedan:**

- Los cambios que están solo en la voz no se ven (What's Up Danger 2:52 y 3:05).
- La frontera puede caer un compás tarde cuando el primer compás de un pasaje trae un acento que se parece a lo anterior (Time 0:44.7 sale en el compás siguiente; es débil y no parte tramo, y la marcha cae ahí igualmente, en la frase de 8 compases de su tramo).
- Calibrado con los 8 oficiales y lo que se oyó en tres de ellos. Los umbrales están en tablas: `CHANGE_RULES` (songChanges.js), `ARC_RULES` (songArc.js, ahora exportado), `CHARACTER_RULES.arrivalFull`, `MODE_RULES` (`maxS`, `minGapS`, `climaxBonus`) y `MODE_CASTING.event`.
- La antigravedad de Time entra con encaje 0.526 (mínimo 0.5): un tema así de sostenido está en el borde, y un análisis algo distinto podría dejarlo sin momento.
- Momentos más largos (hasta 40 s): si 35 s de antigravedad en el clímax de Extremo se hacen largos, lo dirá el siguiente playtest.

#### La dificultad que se siente (tras el mismo playtest) ✅ (Sep 2026)

> **Lo que se jugó.** Tras los ajustes anteriores, los tres niveles "se sienten un poquito mejor". Pero un compañero jugó What's Up Danger, el nivel más difícil, y dijo que **"no se siente emoción en lo difícil"**: la sincronía no le dio problemas, pero no le pareció difícil. El propietario coincide: nos centramos tanto en que todo cayera con la música que se descuidó la dificultad. En la zona roja **no se nota que acelere**, los cambios de velocidad se sienten poco y **se siente muy fácil**, y eso en el nivel más difícil lo vuelve aburrido. Además, **momentos de 1 a casi 3 segundos sin nada que saltar** que se repiten por todo el nivel, no solo en pausas de la canción. Pidió que el más difícil sea difícil de verdad (no imposible), que los niveles en general dejen de ser tan fáciles y que todo siga sincronizado con la música.

**Lo que se midió** en What's Up Danger (Extremo, charter 7):

- **177 acciones**, 52 por minuto de media y **85 en la zona roja**.
- **31 huecos de 1.5 s o más** entre acciones, 16 de ellos de 2 s o más: compases enteros (2.5 s a 95 BPM) con una sola acción.
- La velocidad arrancaba a **370 px/s** y subía +15 %, +23 % y +27 % hasta **665 px/s** en la zona roja, con 1.4 s para ver venir cada obstáculo.

Las causas:

1. **Tablas de densidad bajas.** En Extremo un groove pedía 60 acciones por minuto, que a 95 BPM son 1.6 por compás, y el reparto dejaba compases de una sola acción.
2. **Silencio de juego máximo de 4.5 s en Extremo y 8 s en Relajado.** El relleno casi nunca actuaba.
3. **Contratiempos solo en síncopas fuertes**, un golpe muy por encima del pulso. En un muro de guitarras casi no hay, así que la zona roja (antigravedad) se quedaba en un cristal por beat.
4. **La velocidad base solo dependía del tempo**, igual en Normal que en Extremo, con marchas pequeñas y un techo único de 820 px/s.

**Qué cambió** (`CHARTER_VERSION = 8`, formato de chart igual, analizador igual):

- **Densidad** (`difficulty.js`, acciones por minuto por nivel del arco: reposo · calma · groove · empuje · clímax):

  | Dificultad | Antes | Ahora | Silencio máximo |
  |---|---|---|---|
  | Relajado | 0 · 12 · 20 · 27 · 34 | 0 · 16 · 26 · 34 · 42 | 8 → **3.2 s** |
  | Fácil | 6 · 18 · 30 · 40 · 50 | 8 · 26 · 42 · 54 · 66 | 7 → **2.6 s** |
  | Normal | 8 · 24 · 40 · 54 · 68 | 12 · 34 · 52 · 68 · 84 | 6 → **2.0 s** |
  | Difícil | 10 · 30 · 50 · 68 · 86 | 16 · 46 · 68 · 88 · 110 | 5 → **1.8 s** |
  | Extremo | 14 · 36 · 60 · 82 · 104 | 22 · 58 · 84 · 108 · 136 | 4.5 → **1.4 s** |

  Además:
  - Contratiempos más fáciles de jugar cuanto más difícil (`offbeat`: golpe mínimo de 0.40 a 0.25).
  - Tiempos débiles en calma (`calmBeatStrength`).
  - En el clímax de Difícil y Extremo **se juega la subdivisión** (`climaxOffbeat`): un contratiempo con golpe aunque no sea una síncopa o, en Extremo, con la música a tope alrededor.
  - Combinaciones y cactus anchos antes en el arco.
  - Hueco mínimo de Relajado de 1.15 a 1.0 s y de Fácil de 0.9 a 0.72 s: a 80 BPM, Fácil no podía saltar en beats seguidos.
  - Cuota de agachados 0.55-0.6 en Difícil y Extremo.
- **El relleno de silencios** (`charter.js::fillLongRests`):
  - Pone un agachado si un salto no cabe.
  - En los tramos de reposo el máximo se alarga ×1.6 (`restLevelFactor`).
  - Nunca rellena el tutorial del principio ni el estreno de un modo.
  - Donde la música calla de verdad (energía < 0.12), el nivel sigue callando.
- **Velocidad:**
  - **Base por dificultad** (`baseSpeed`, ×0.90 en Relajado … ×1.24 en Extremo).
  - Marcha +0.14 y clímax +0.34 (antes 0.11 y 0.24), empuje +0.12.
  - Amplitud de 0.60 a 1.5.
  - **Techo por dificultad** (`maxSpeedPxS`: 660, 760, 860, 940 y 1000 px/s). Si el clímax pasaría del techo, **todas las subidas se comprimen en la misma proporción** y el clímax llega justo al techo sin dejar de ser la marcha más alta. Solo recortando, una canción rápida en Extremo tocaba el techo antes del clímax.
  - Si al comprimir una marcha sube menos de un 12 % (`minGearStepRatio`), se ponen menos marchas y más grandes: en Running With the Wolves (Normal) pasan de cuatro escalones del 8-10 % a dos del 13 % y del 35 %.
- **Huecos físicos re-medidos hasta 1100 px/s** con el simulador (`PAIR_GAP`). Salto→salto pasa a 0.61 + 2·tolerancia y salto→agachado a 150/velocidad + tolerancia + 0.05; a 1000-1100 px/s la fórmula anterior quedaba hasta 20 ms por debajo.
- La modulación de densidad por lo lleno que suena cada compás va **en décimas**: con más acciones por compás, el ruido de la energía cruzaba el redondeo y un riff dejaba de repetir su patrón.
- **Dificultad medida recalibrada** (`chartStats.DIFFICULTY_THRESHOLDS`: 43, 61, 86 y 108; antes 33, 47, 66 y 82). En los 8 oficiales, las estrellas medidas coinciden con las del manifiesto salvo HOPE (Fácil, medida 3★).

**Los 8 oficiales**, dificultad del manifiesto, charter 7 → 8:

| Oficial (dificultad) | Acciones | Acciones/min · pico | Velocidad base → máxima | Huecos ≥ 1.5 s (≥ 2 s) |
|---|---|---|---|---|
| Sugar Red (Normal) | 26 → 33 | 44 · 48 → **56 · 60** | 472→585 → 500→687 | 15 (2) → **7 (0)** |
| Last Christmas (Relajado) | 12 → 21 | 22 · 21 → **37 · 39** | 394→446 → 355→427 | 12 (11) → **9 (8)** |
| HOPE (Fácil) | 36 → 60 | 32 · 36 → **50 · 66** | 500→596 → 485→633 | 28 (8) → **21 (3)** |
| Running With the Wolves (Normal) | 103 → 136 (+3 notas) | 41 · 57 → **53 · 63** | 508→797 → 538→822 | 24 (23) → **10 (9)** |
| Time (Fácil) | 85 → 113 | 34 · 48 → **45 · 63** | 432→629 → 419→705 | 54 (10) → **35 (6)** |
| Mi Fiesta (Difícil) | 171 → 228 | 58 · 81 → **74 · 102** | 389→655 → 443→881 | 5 (4) → **11 (1)** |
| Dawn of Faith (Difícil) | 119 → 174 (+8 notas) | 43 · 63 → **62 · 114** | 440→741 → 502→940 | 37 (11) → **7 (5)** |
| What's Up Danger (Extremo) | 177 → **255** (+4 notas) | 52 · 93 → **75 · 138** | 370→665 → **459→982** | 31 (16) → **8 (5)** |

En What's Up Danger la zona roja pasa de 85 a **122 acciones/min** y de 665 a **982 px/s**: en un 16:9 se ven venir los obstáculos 0.95 s antes, frente a 1.4 s. Las marchas suben **+21 %, +32 % y +34 %**. Los huecos que quedan están en portales, en el estreno de un modo, en el vuelo o en la outro.

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **250 JS** (+2: silencios de juego por dificultad en canciones sintéticas; **What's Up Danger en Extremo como regresión**: zona roja ≥ 110 acciones/min y ≥ 950 px/s, media ≥ 65, ningún hueco de más de 1.4 s mientras suena la música, y cada dificultad con más acciones, más base y más velocidad máxima que la anterior; y techo de cada dificultad en los 8 oficiales), **70 PHP**, **104 Python** |
| 8 oficiales × 5 dificultades | jugables con la tolerancia de su dificultad (el validador repara 1 acción en Running With the Wolves Difícil), en la rejilla y con un clímax |
| Lectura a velocidad máxima | 1000 px/s: 0.87-0.98 s en pantallas 16:10-16:9 (el test de la vista pasa de exigir ≥ 1.0 s a 820 px/s a ≥ 0.85 s a 1000); el legacy acababa en 0.74 s |
| E2E What's Up Danger (Extremo, 1280×720, bot con pulsaciones fechadas, colisiones activas) | el cliente carga el chart 8: 255 obstáculos y 4 notas; a las 2:00 corriendo a 734 px/s, a las 2:45 antigravedad en la zona roja a 982 px/s; **victoria al 100 %**; 12 884 frames en 3:36 (~60 FPS) |
| Consola | 0 errores de JS (solo el 401 del arranque anónimo y el favicon) |
| Oficiales y comunidad | re-horneados y re-sembrados; los 3 de la comunidad, re-charteados (`--charter-below=8`) |
| Bundle | **188.49 KB gzip** (+0.63) |

**Decisiones (vinculantes):**

- **La dificultad se siente en densidad y en velocidad, no solo en tolerancia.** Cada dificultad tiene su base de velocidad, su amplitud y su techo.
- **Mientras suena la música no hay silencios de juego largos**: de 3.2 s en Relajado a 1.4 s en Extremo. Callan solo los silencios de la canción, los portales, el estreno de un modo y el tutorial.
- **En el clímax de Difícil y Extremo se juega la subdivisión**, siempre en la rejilla de la canción.
- **Si el techo aprieta, se comprime la subida entera y el clímax sigue siendo la marcha más alta**; y mejor pocas marchas que se notan que muchas que no.
- **Todo sigue en la rejilla de la canción y validado jugando** con la tolerancia de su dificultad.

**Limitaciones que quedan:**

- **La sensación la dirá el próximo playtest.** Esto se midió; que Extremo sea difícil pero no frustrante, y Relajado accesible, solo lo dice jugarlo. Todo está en tablas: `DIFFICULTY_PROFILES` (densidades, silencios, contratiempos, velocidad), `SPEED_RULES` y `CHARTER_RULES.restLevelFactor`.
- **La antigravedad es más permisiva que correr**: cualquier pulsación invierte, con 0.3 s o más de margen por cristal. Su dificultad sale de la densidad y la velocidad.
- **En Fácil, a 63-80 BPM, siguen los huecos de 1.5-1.9 s** (dos beats): es el ritmo de la canción en esa dificultad. Bajar más su silencio máximo pondría una acción en cada beat.
- **En pantallas 16:10 (iPad, 720p) la velocidad máxima de Extremo da 0.87 s de lectura.**

---

#### La dificultad que se juega: música y precisión (segundo playtest) ✅ (Sep 2026)

> **Lo que se jugó.** Con el charter 8 "se siente más dificultad y está bien", pero sigue simple: **What's Up Danger en Extremo se pasó a la segunda**, y los demás niveles también se pasan. La antigravedad de What's Up Danger sí dio adrenalina ("hay partes donde debo moverme rápido"), con dos pegas. **Es la única parte así**: lo demás es "lo típico de esquivar y saltar". Y **no se sintió acorde a la canción**: no se pide que cada salto vaya al BPM, pero la música se tiene que notar. El propietario pidió analizar bien BPM, acordes, altos y bajos, y que cada dificultad se sienta más difícil que la anterior: un nivel Normal o Difícil no puede pasarse a la primera como uno Fácil.

**Lo que se midió.** Se construyó un **jugador de referencia**: pulsa sobre el golpe con un error gaussiano de ±45 ms y juega el nivel con la física real (Monte Carlo, 150 partidas por nivel, sin el vuelo, donde se corrige mirando el túnel). Con el charter 8 superaba What's Up Danger en Extremo el **70 %** de las veces, Mi Fiesta en Difícil el 57 % y Dawn of Faith en Difícil **el 100 %**. Las causas:

1. **Una acción suelta no exige nada.** Un cactus deja ±200 ms de margen a cualquier velocidad. Un cristal de la antigravedad perdona pulsar hasta ~200 ms tarde. Solo mataban las combinaciones rápidas (salto → agachado a una corchea), y en Dawn of Faith (65 BPM, saltos a un beat) no hay ninguna.
2. **La exigencia dependía de la canción, no de la dificultad.** Con las mismas tablas, Difícil iba del 57 % al 100 %.
3. **Relleno sin música en la zona roja.** El clímax de What's Up Danger es un muro de guitarras que golpea en negras (medido por bandas: bajo en cada beat, caja en 2 y 4, contratiempos casi callados). La regla de subdivisión por energía ponía cristales en contratiempos sin golpe: **17 de 72 inversiones** caían a más de 65 ms de cualquier golpe de fuerza ≥ 0.2. Y la memoria de frases llegaba a saltarse el golpe más fuerte (la caja del 4) por copiar esos contratiempos.
4. **La rejilla no tenía semicorcheas.** El bombo sincopado del hip-hop vive en la "e" y la "a" del beat: **30 %** de los golpes fuertes de What's Up Danger, **38 %** de los de Running With the Wolves.

**Qué cambió** (`CHARTER_VERSION = 9`, formato de chart igual, analizador igual):

- **Música primero** (`musicModel.js`, `patterns.js`):
  - Fuera del pulso **solo hay acción sobre un golpe que se oye** (fuerza ≥ 0.2). El clímax de Difícil y Extremo sigue jugando la subdivisión, pero solo la que suena. La regla por energía ya no existe.
  - **Semicorcheas**: cada compás lleva `sixteenths`, los golpes reales en la "e" y la "a". Solo en canciones rectas donde la semicorchea dura ≥ 0.13 s (≤ 115 BPM). Se juegan si el golpe manda sobre el pulso y el contratiempo de al lado (`sixteenth` por dificultad, desde el primer empuje en Normal).
  - **Groove del tramo**: cada posición del compás puntúa también por su fuerza media en los compases del tramo. El patrón sigue al bombo y la caja que se repiten, no a los golpes sueltos. La reserva del primer tiempo del compás siguiente cuenta con el mismo groove; sin eso, el riff perdía su "1".
  - **Acordes**: los pulsos donde cambia la armonía (análisis tonal del analizador 2) quedan marcados y puntúan más, al elegir el golpe y al elegir los acentos.
- **Acentos que exigen precisión** (`accents.js`, pieza nueva). Los golpes fuertes de cada tramo llevan una **variante** del obstáculo con menos margen. La acción sigue en su golpe: aprieta el obstáculo, no el ritmo.
  - Las variantes viven en el registro: un kind con **`accentOf: 'X'`** es variante de acento de X. `accents.js` no conoce ninguna por nombre, así que añadir una es una entrada de registro.
  - **Hileras de cactus** (`CACTUS_ROW_88` … `_328`, de 20 en 20, generadas en config.js y pixelart.js). Medido: 208 de largo dejan ±60-75 ms a 600 px/s; 328 dejan ±70-90 a 1000.
  - **Cristales afilados** (`CRYSTAL_FLOOR/CEIL_SHARP_190` … `_110`: menos `leadMarginS`, del rosa del ptero). Llegan antes tras el golpe: pulsar tarde deja +50-105 ms y pulsar pronto sigue libre. Quien sigue el golpe los clava; quien los ve venir no pierde nada.
  - **Qué golpes**: los que más suenan (fuerza × peso métrico, cambio de acorde, drop), hasta la cuota de la dificultad por nivel del arco y con sitio alrededor. **Se decide por frase**: las vueltas de un riff (enlazadas por la memoria de frases) llevan acento todas o ninguna.
  - **Cuánto**: cada acento pide un margen: el mínimo de la dificultad × su nivel del arco (reposo ×1.5 … clímax ×1) × la apertura (hasta ×1.3 al empezar la canción, ×1 al 35 %) × su golpe (el más flojo del tramo, ×1.5). Sin el nivel ni la apertura, la mitad de las muertes de What's Up Danger caían en los segundos 15-21.
  - **Encima, una escalera de holgura global** hasta la exigencia por minuto de la dificultad (`accent.hazardPerMin`), estimada para el jugador de referencia como Σ −ln(1 − p) de los acentos. Se queda el escalón más cercano. Así Dawn of Faith y Mi Fiesta piden lo mismo en Difícil: la primera, con acentos más estrechos.
  - Tabla por dificultad (`accent` en `difficulty.js`): Relajado sin acentos (desbloqueo NEVER); Fácil 0.18 · mín ±0.14 · 0.05/min; Normal 0.4 · ±0.085 · 0.3/min; Difícil 0.55 · ±0.07 · 0.55/min; Extremo 0.7 · ±0.058 · 0.85/min.
- **Exigencia medible** (`challenge.js`, pieza nueva): `REFERENCE_PLAYER` (±45 ms), `missChance`, `kindHazard` y **`referencePassRate(chart)`** (el Monte Carlo; lo usan tests y calibración, no se empaqueta: tree-shaking).
- **Márgenes de salto sin simular** (`run.js::marginsS`, gancho opcional del contrato de modos). Integra el salto una vez y cruza su altura con los hitboxes. Frente al barrido fino del simulador: sesgo < 1 ms y error máximo 6 ms. `playability.timingMarginsS(kind, v)` da los dos lados del margen (`timingWindowS` es su suma). El charter consulta miles de márgenes y sigue costando lo mismo que el charter 8 (el validador domina).
- **Densidades de Normal a Extremo algo más altas** (Extremo 24 · 66 · 98 · 126 · 160 acciones/min): con acciones solo sobre golpes, lo que limita la densidad es la música; la tabla deja de recortar donde sí los hay.
- `unlock.wide` pasa a **`unlock.accent`**. Una variante que a esa velocidad deja más margen que la acción normal no cuenta como acento: el cactus ancho es bajo y a partir de ~600 px/s perdona más. El validador devuelve a su `accentOf` un acento que no se deja jugar.

**Los 8 oficiales** (dificultad del manifiesto; jugador de referencia sin el vuelo, 150 partidas; charter 8 → 9):

| Oficial (dificultad) | Acciones | Acentos | Fuera del pulso sin golpe | Supera con ±45 ms |
|---|---|---|---|---|
| Sugar Red (Normal, 40 s) | 33 → 35 | 1 → 10 | 0 → 0 | 1.00 → **0.83** |
| Last Christmas (Relajado) | 21 → 21 | 0 → 0 | 0 → 0 | 1.00 → 1.00 |
| HOPE (Fácil) | 60 → 60 | 2 → 1 | 0 → 0 | 0.87 → 0.87 |
| Running With the Wolves (Normal) | 136 → 147 | 2 → 17 | 0 → 0 | 0.56 → **0.35** |
| Time (Fácil) | 113 → 113 | 5 → 8 | 0 → 0 | 0.99 → 0.99 |
| Mi Fiesta (Difícil) | 228 → 249 | 6 → 60 | 0 → 0 | 0.57 → **0.09** |
| Dawn of Faith (Difícil) | 174 → 168 | 5 → 71 | 2 → 0 | 1.00 → **0.37** |
| What's Up Danger (Extremo) | 255 → 255 | 7 → 100 | **17 → 0** | 0.70 → **0.03** |

Con otros jugadores (supera con ±30 · ±35 · ±40 · ±45 ms):

| Oficial | Charter 8 | Charter 9 |
|---|---|---|
| What's Up Danger (Extremo) | 0.94 · 0.86 · 0.78 · 0.70 | **0.73 · 0.43 · 0.14 · 0.03** |
| Mi Fiesta (Difícil) | 0.95 · 0.83 · 0.72 · 0.57 | 0.90 · 0.67 · 0.33 · 0.09 |
| Dawn of Faith (Difícil) | 1.00 · 1.00 · 1.00 · 1.00 | 0.97 · 0.86 · 0.62 · 0.37 |
| Running With the Wolves (Normal) | 0.98 · 0.90 · 0.71 · 0.56 | 0.92 · 0.77 · 0.51 · 0.35 |

Los 8 temas en las 5 dificultades, con ±45 ms: Relajado ≥ 0.97; Fácil 0.82-1.00; Normal 0.40-0.57 (las de 40 s, 0.82-0.85); Difícil 0.14-0.38 (las cortas, 0.51-0.62); Extremo 0.03-0.06 (las cortas, 0.18-0.55). **Dónde se muere** (What's Up Danger en Extremo): en el drop de 1:42 y en la zona roja. En la primera estrofa casi nada: la apertura y el nivel del arco lo apartan de ahí. En Dawn of Faith en Difícil, el 60 % de las muertes cae en el clímax.

En la zona roja de What's Up Danger los cristales afilados caen en la caja (2 y 4) y en los primeros tiempos con cambio de acorde. En el drop de 1:42, el bombo del primer tiempo es siempre una hilera, la caja un agachado y el bombo sincopado de "2e" otra hilera.

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **259 JS** (+9): `challenge.test.mjs` (probabilidades del jugador de referencia; Monte Carlo determinista; márgenes del salto frente al simulador; registro de variantes; acentos sobre golpes fuertes y más estrechos con la dificultad; **el playtest como regresión**: Normal > Difícil > Extremo en What's Up Danger, Extremo ≤ 0.15 con ±45 ms y ≥ 0.35 con ±30, ≤ 25 % de las muertes en el primer cuarto, Dawn of Faith en Difícil ≤ 0.6); semicorcheas y acordes en `music-model`; "fuera del pulso solo sobre un golpe" en los 8 × 3; rejilla con semicorcheas; cristales que alternan de superficie aunque sean afilados. **70 PHP**, **104 Python** |
| 8 oficiales × 5 dificultades | jugables con la tolerancia de su dificultad, en la rejilla y sin avisos |
| E2E What's Up Danger (Extremo, 1280×720, bot con pulsaciones fechadas, colisiones activas) | el cliente carga el charter 9: 255 obstáculos, 52 acentos de salto y 48 cristales afilados; hilera de 248 junto al Dino a 734 px/s (1:41), cristales afilados en la zona roja a 982 px/s (2:45); **victoria al 100 %**, ~60 FPS |
| Consola | solo el 401 del arranque anónimo y el favicon |
| Oficiales y comunidad | re-horneados y re-sembrados; los 3 de la comunidad, re-charteados (`--charter-below=9`) |
| Bundle | **191.45 KB gzip** (+2.96) |

**Decisiones (vinculantes):**

- **Fuera del pulso solo hay acción sobre un golpe que se oye.** El pulso se juega aunque el detector no lo marque; un contratiempo o una semicorchea callados, no.
- **La rejilla tiene semicorcheas donde la canción las toca** (recta y ≤ 115 BPM), como huecos para una acción suelta: dos acciones seguidas siguen sin caber.
- **La exigencia de un nivel la pone su dificultad, no su canción.** Se mide con un jugador de referencia (±45 ms) y los acentos se aprietan hasta la exigencia por minuto de cada dificultad.
- **La precisión la dan los obstáculos, no el ritmo**: variantes de acento del registro (`accentOf`) sobre los golpes fuertes, decididas por frase.
- **Se muere donde la música aprieta**: más margen en la calma y en el primer tercio de la canción.
- **Un playtest de dificultad se protege con el jugador de referencia**, no con densidades: la densidad ya no dice lo difícil que es un nivel.

**Limitaciones que quedan:**

- **La sensación la dirá el próximo playtest.** El jugador de referencia es un modelo: error gaussiano sin despistes ni aprendizaje. Todo está en tablas: `ACCENT_RULES`, `accent` por dificultad, `REFERENCE_PLAYER`, `sixteenth`/`climaxOffbeat` por dificultad y `OFFBEAT_FLOOR`, `GROOVE_WEIGHT`, `CHORD_WEIGHT` en patterns.js.
- **El vuelo no está calibrado** con el jugador de referencia (se corrige mirando). Y **los agachados no tienen acentos**: agacharse antes de tiempo es gratis, así que un ptero más rápido no exigiría nada a quien se adelanta.
- **Las canciones cortas (40 s) quedan más fáciles** en Normal-Extremo: la exigencia es por minuto.
- **La dificultad medida de las tarjetas** (`chartStats`) apenas nota los acentos: su margen medio lo dominan los obstáculos holgados. Sigue separando las dificultades y ninguna tarjeta cambia de estrellas; la medida buena es `referencePassRate`, demasiado cara para el navegador.
- **Una canción con muchas combinaciones naturales** (Mi Fiesta: salto → agachado a 0.57 s) queda más exigente que su presupuesto: el presupuesto solo cuenta los acentos.

**Ajuste posterior: más velocidad y progresión (Sep 2026, "que se sienta un poco más emocionante") ✅.** Pedido explícito: subir solo la velocidad/progresión (no densidad ni exigencia de los acentos), dejando Relajado y Fácil igual. `CHARTER_VERSION = 10`. `speedPlan.js::SPEED_RULES`: `gearBoost` 0.14→0.19, `levelBoost` empuje 0.12→0.18 y clímax 0.34→0.46. `difficulty.js`, solo Normal/Difícil/Extremo: `baseSpeed`/`maxSpeedPxS` 1.06/860→1.14/940 (Normal), 1.14/940→1.22/980 (Difícil), 1.24/1000→1.32/1000 (Extremo; el techo absoluto no sube — sigue siendo donde toda pantalla apaisada lee cada obstáculo ≥ 0.85 s antes). **Medido con el jugador de referencia (±45 ms): el efecto sobre si se supera o no es pequeño y no siempre baja** (Sugar Red 0.83→0.86, Running With the Wolves 0.35→0.42, Mi Fiesta 0.09→0.10, Dawn of Faith 0.35→0.29, What's Up Danger 0.02→0.03). La razón: el margen de un acento (`timingMarginsS`) CRECE con la velocidad para un obstáculo del mismo tamaño (una hilera de 300 de largo pasa de −35/+60 ms a 750 px/s a −85/+110 a 1000), y `accentVariant` recalcula qué variante usar contra la velocidad de cada instante, así que el nivel se autocompensa. Subir solo la velocidad hace el nivel más rápido de leer y de ritmo, no necesariamente más difícil de superar: para bajar de verdad cuántos lo pasan (lo que pidió el playtest anterior) hace falta tocar `accent.marginS`/`accent.hazardPerMin` en `difficulty.js`, que sigue pendiente porque este pedido fue "solo velocidad". Oficiales re-horneados y re-sembrados; comunidad re-charteada (`--charter-below=10`). Tests: 259 JS (sin cambios de aserciones, solo de datos), 70 PHP. Bundle sin cambio (191.45 KB gzip: solo cambiaron constantes, no código nuevo).

#### Ola 6c — Siguientes momentos ✅ (Sep 2026)

Tras el playtest de la 6b y del ajuste de velocidad ("lo veo pasable, no noté problemas"). Los cuatro puntos del plan, más una calibración de la exigencia que la acompaña: con los anillos y el vuelo encadenado se podía, por fin, pedir lo que se había pedido para las dificultades altas. `CHARTER_VERSION` 11 (la ola) y **12** (la calibración de las canciones cortas); **formato de chart 5**; **analizador 3**.

**1. Anillos de salto** — una acción nueva dentro de correr.

- **Qué es.** Un aro en el aire (`RING_JUMP`, `trigger: 'jump'` en el registro): si el Dino está dentro de su zona y se pulsa, vuelve a saltar (`JUMP_RING.impulsePxS` 760). Rompe el techo de densidad del salto: dos golpes a 0.15-0.66 s se juegan saltando y volviendo a saltar en el aire.
- **Contrato de modos.** Gancho opcional `trigger(body, def)` en `systems/modes/` (`run.js` devuelve `'ring'`); `geometry.triggerZone`; `physics.applyTrigger`. El activador no es sólido: `playability.toSimObstacles` solo devuelve sólidos y `toSimTriggers` los activadores; `simulateRun({ triggers })` comprueba el aro tras integrar, en el mismo orden que `GameSession._physicsStep`.
- **Dónde** (`patterns.js`, `RING_RULES`, `canRing`): sobre el golpe que sigue a un salto demasiado cerca para volver a saltar desde el suelo. `PAIR_GAP` medido con el simulador: `jumpRing` 0.15-0.66 s, `ringJump = 0.67 + 2·tol`, `ringDuck = 0.2 + 110/v + tol`. `dropOrphanRings` quita el que se queda sin su salto.
- **Con qué** (`levels/rings.js`, pieza nueva): un anillo que se puede ignorar no es una acción. Cada uno lleva el obstáculo más corto que **se supera pulsando en el aro y NO sin pulsar** (`ringHazard`, simulación local). Un cactus basta desde ~0.24 s tras el salto; antes, una hilera. Si ninguno cumple, el anillo se quita.
- **Por dificultad** (`unlock.ring`, `ring { share, strength }`): Relajado y Fácil nunca; Normal desde el primer empuje; Difícil y Extremo desde el primer groove.
- **Runtime**: chispas al activarlo (`JUMP_RING_FX`), `spawner.triggerAt/markTriggerUsed`, aviso de controles las 3 primeras partidas (`settings.countMechanicSeen`, `hint` en el registro).
- **Rediseño tras el playtest de la 6c** ("no lo entendí a la primera, parece un portal"). La primera versión era un aro alto y hueco en cian: la misma forma que los portales de modo y el mismo color que el de correr, y su aviso decía "Anillo". Ahora es un **orbe de doble salto**: macizo (los portales son huecos), **naranja** (un color que no usa ningún portal ni obstáculo), con un **doble chevrón ︽ encima que sube** entre frames, y que **se ilumina y crece mientras el Dino está a su alcance en el aire** (`armedSprite: 'orbLit'` en el registro, `Obstacle.setArmed`, `spawner.armTrigger`): enseña cuándo pulsar. Aviso "DOBLE SALTO — Salta y pulsa Espacio otra vez al tocar el orbe". Solo visual: caja, zona y charts no cambian (sin subir `CHARTER_VERSION`). En el código sigue llamándose "anillo" (`RING_JUMP`, `rings.js`).

**2. Vuelo en frases encadenadas** — el jugador virtual como política.

- **Quien juega mira el túnel** (`virtualPlayer.FLIGHT_PLAYER`: `correctionGain` 0.7, `maxCorrectionS` 0.25). En cada esquina del camino pulsa o suelta donde su recta se juntaría con la del camino, corrigiendo una parte del desvío. Medido con frases aleatorias (90-150 BPM): con ganancia 1 bastaría la holgura de la 6b; con 0.5 hacían falta 25-40 unidades más; con 0.7, unas 10. El jugador ciego se conserva (`flightPlayer: null`) para demostrar en los tests que acumula error.
- **Frases** (`flightCharter.js`, reescrito): dentro de `fly.chainBars` compases (0 · 0 · 2 · 4 · 8 por dificultad) las notas se encadenan por el aire, incluso ligadas; al acabar la frase, el Dino vuelve al suelo (error a cero). Estreno: las dos primeras notas separadas y en el pulso.
- **Holgura por dificultad** (`fly.comfortPx`: 42 · 38 · 34 · 30 · 24). Medido: el vuelo era lo que más mataba en tramos tranquilos (la mitad de las muertes de Dawn of Faith en Difícil).
- **`referencePassRate` cuenta el vuelo** por defecto (`flight: false` para comparar con medidas anteriores).

**3. Altura de las notas con la melodía** — analizador 3.

- `analyzer/daino_analyzer/melody.py` (pieza nueva, **sin dependencias ni modelos**): sobre el CQT que ya calcula `tonal.py` (ahora compartido: `constant_q`, `ConstantQ`), blanqueo por octava, saliencia por suma de 3 armónicos con preferencia por lo agudo, camino por Viterbi con coste por semitono y sonoridad relativa a la canción. Medido con melodías sintéticas sobre acordes, bajo y batería: 89-100 % de acierto (sin la preferencia por lo agudo, 0-6 %: seguía a la fundamental de los acordes). En los 8 oficiales, altura mediana 60-74 (la voz) en vez de 54-64 (los acordes). < 0.5 s por canción.
- Análisis: bloque `melody { hopSec, pitch, voicedRatio }` (`schema.py`, `ChartValidator::validateMelody`); todo lo de la versión 2 sale idéntico. `sonify --melody` la hace sonar encima de la canción.
- **Basic Pitch descartado por ahora**: el CQT propio da el contorno que hace falta y no cuesta memoria.
- **Uso**: solo alturas RELATIVAS dentro del tramo de vuelo (las notas agudas, arriba). Sin melodía, se decide por el ritmo. Con una melodía que sube de 55 a 75, las cimas del Dino pasan de 60-100 a 120-216.

**Pulido tras jugarla** (Sep 2026): **cada mecánica se explica con su dibujo.**

- **El orbe de doble salto** (ver arriba) y, al activarlo, **una voltereta hacia delante** del Dino mientras sube (`DOUBLE_JUMP_FX.spinS` 0.38 s, sobre el centro del cuerpo) y **un soplo de aire bajo los pies**, como si pisara el aire. Es el gesto clásico del doble salto y se entiende sin leer nada.
- **El vuelo es un PROPULSOR.** Se jugaba como una mochila cohete (mantener sube, soltar cae en línea recta), pero el Dino no llevaba nada que lo explicara: "no lo siento modo vuelo con nave". Ahora:
  - al cruzar el portal aparece una **mochila propulsora** en la espalda, con correa al pecho y la franja del oro del modo;
  - **llama** en diagonal hacia atrás que parpadea mientras se mantiene y queda en **brasa** al soltar;
  - **llamarada al encender** y **bocanada de humo al apagar**, desde la tobera (`Dino.jetNozzle`, con la inclinación de ese frame);
  - la mochila se desvanece al salir del modo.

  El aviso y el mapa dicen **"Propulsor"**, con el texto "Mantén Espacio para encender el propulsor; suelta para caer". En el código el modo sigue siendo `fly`. Las físicas no cambian: el túnel y su validación siguen igual.
- `entities/Dino.js` pasa a montarse en capas (`_spin` → `_rig` → cuerpo, mochila y llama): en Pixi v8 un Sprite no admite hijos, y así la mochila sigue al cuerpo en cualquier pose. Todo el arte sigue siendo código en `pixelart.js` (`jetpack`, `jetFlameA/B/Idle`, `orbA/B/Lit`). +0.9 KB gzip. Con `prefers-reduced-motion`, ni voltereta ni partículas.
- Verificado en el navegador: doble salto en Sugar Red (voltereta a media vuelta en la captura) y propulsor en Dawn of Faith (llama al subir, brasa al caer). Victoria al 100 % en los dos y sin errores.

**4. Efectos nuevos del chart** (`levels/fxPlan.js`, registro `FX_PLANNERS`; `songDirector.FX_KINDS`).

| fx | Cuándo | Qué se ve |
|---|---|---|
| `build` | los compases de subida hacia un drop | el fondo y el suelo se van tensando hasta el golpe (`uBuild`) |
| `break` | un tramo en reposo tras uno con cuerpo, ≥ 2 s | el color se apaga (`uCalm`), el mundo contiene la respiración, sin líneas de velocidad |
| `key` | una modulación del analizador 2, pasado el segundo 8 | el cielo cambia de tono en proporción al salto (`uHue`) |

`drop` y `lift` siguen como en la Ola 5. Solo visuales: ni el simulador ni la física los leen, así que un efecto nuevo no cambia si un nivel se supera.

**5. Exigencia: cada dificultad promete lo mismo en cualquier canción.**

Objetivo del user: **3★ se pasa al segundo o tercer intento; 4★ cuesta cinco o más y no todo el mundo llega; 5★ casi nadie**. Con el jugador de referencia (±45 ms), superar ~1/N de las partidas.

- **Presupuesto por canción, no por minuto** (`accent.hazard` total: 0.02 · 0.1 · 0.7 · 1.6 · 3.0), menos lo que el nivel ya exige sin acentos (`restHazard`, Monte Carlo del chart sin acentos, `CHARTER_RULES.restRuns` 32). Por minuto, una canción de 40 s salía tres veces más fácil.
- **Márgenes en contexto** (`challenge.createContextMargins`): cada acento se mide con sus vecinas en su sitio (ventana de ±0.95 s, bisección de 4 pasos, memoria por forma). Medido en Sugar Red (Difícil): una hilera seguida de un agachado mataba el 24 % de las partidas en un solo punto, y el margen aislado la daba por holgada.
- **Cuota que se amplía** (`shareSteps`, `relaxedStrength`) si ni con el margen mínimo se llega.
- **Charter 12 — las canciones cortas.** Medido tras la ola: en los clips de 40 s el presupuesto no se gastaba (Sugar Red en Extremo: 0.69 de 2.94; se superaba el 42 %). Dos causas, dos arreglos generales:
  - **Las hileras se quedaban cortas arriba.** El margen de una hilera crece con la velocidad: a 1000 px/s la de 328 px aún perdonaba ±82 ms. La escalera llega ahora a **408 px** (`CACTUS_ROW_CELLS`, 17 entradas; el sprite se genera). A velocidades bajas esas hileras no se eligen solas.
  - **Las aperturas del acento no se cerraban.** En 40 s casi todo cae en la apertura (primer 35 %) y en tramos de calma, así que el margen pedido salía ×1.5-1.9 del mínimo. Último tramo de la escalera (`closings` 0.85 · 0.7 · 0.6 · 0.5): cierra las aperturas **hasta el margen mínimo de la dificultad, nunca por debajo** (`Math.max(1, …)`). Una canción larga llega al presupuesto antes y no pisa esos escalones: sus charts no cambian.
  - Memoria de márgenes aislados al px/s (`isolatedMargins`): el charter de un Extremo largo pasa de 2.5 s a 1.9 s.

**Los 8 oficiales en las 5 dificultades** (charter 12, jugador de referencia ±45 ms, 200 partidas, con vuelo):

| Oficial | Duración | Relajado | Fácil | Normal | Difícil | Extremo |
|---|---|---|---|---|---|---|
| Last Christmas | 39 s | 1.00 | 0.99 | 0.71 | 0.36 | 0.07 |
| Sugar Red | 40 s | 1.00 | 0.99 | 0.58 | 0.41 | 0.22 |
| HOPE | 79 s | 1.00 | 0.81 | — | — | — |
| Time | 166 s | 1.00 | 0.98 | — | — | — |
| Running With the Wolves | 164 s | 1.00 | 0.97 | 0.41 | 0.15 | 0.01 |
| Mi Fiesta | 194 s | 0.99 | 0.95 | 0.47 | 0.22 | 0.05 |
| Dawn of Faith | 197 s | 0.99 | 0.98 | 0.59 | 0.26 | — |
| What's Up Danger | 216 s | 0.99 | 0.96 | 0.61 | 0.32 | 0.07 |

(— = la canción no admite esa dificultad: su techo.) **Normal 0.41-0.71, Difícil 0.15-0.41, Extremo 0.01-0.22**; en canciones enteras, Extremo 0.01-0.07. Por precisión, What's Up Danger en Extremo: ±20 ms 1.00 · ±25 ms 0.95 · ±30 ms 0.90 · ±35 ms 0.60 · ±45 ms 0.07. Durísimo, no imposible.

**Qué lleva cada oficial** (su dificultad del manifiesto): What's Up Danger (Extremo) 11 anillos, un vuelo de 10 notas con 5 encadenadas y siguiendo la melodía, 2 subidas, 2 drops y un break; Mi Fiesta (Difícil) 14 anillos y un break; Dawn of Faith (Difícil) un vuelo de 11 notas (5 encadenadas); Running With the Wolves (Normal) un vuelo de 8 (4 encadenadas); HOPE un cambio de tonalidad y un break.

**Carga más ligera.** El charter, `analyze.js` y `chartStats.js` se cargan cuando hacen falta (una canción local): un nivel del catálogo trae su chart hecho. Bundle principal **174.83 KB gzip** (antes de separarlo, 197.71) + chunk del charter 22.29 KB.

**Verificación.**

| Qué | Resultado |
|---|---|
| Tests | **276 JS**: `rings.test.mjs` (el aro es necesario y suficiente, cae en su golpe, simulador = runtime), `fx.test.mjs`, `flight.test.mjs` (el ciego acumula error, quien mira pasa; frases encadenadas; melodía), `challenge.test.mjs` (**bandas por dificultad** en canciones enteras; 5★ superable con ±20 ms), `charter`, `modes`, `music-model`, formato 5. **71 PHP** (formato 5, análisis 3). **109 Python** (`test_melody.py`: melodías sintéticas sobre acordes, bajo y batería; saltos de octava; silencios) |
| E2E What's Up Danger (Extremo, 1280×720, bot con el jugador virtual, colisiones activas) | charter 12 servido (307 eventos); los **11 anillos se activan en su instante** (±20 ms: un paso de física); túnel de vuelo con las notas encadenadas y el aviso VUELO; pasillo de antigravedad con el drop a 1000 px/s; break con el cielo apagado y sin líneas; **victoria al 100 %**, 59.5 FPS de media |
| Consola | solo el 401 del arranque anónimo y el favicon |
| Oficiales y comunidad | re-horneados y re-sembrados; los 3 de la comunidad re-charteados (`--charter-below=12`) |
| Bundle | 174.83 KB gzip + 22.29 KB (charter, bajo demanda) |

**Decisiones (vinculantes):**

- **Un activador es una entrada de registro con `trigger`**, no un obstáculo especial: el modo decide qué hace (`trigger` en el contrato de modos), el simulador y el runtime lo aplican en el mismo orden.
- **Un anillo solo existe si es necesario y suficiente**: pulsar en él salva lo que viene y no pulsar no.
- **El vuelo se valida con quien corrige mirando** (`FLIGHT_PLAYER`), y las frases vuelven al suelo al acabar.
- **La melodía da alturas relativas dentro de un tramo**, nunca notas absolutas.
- **Un efecto `fx` es solo visual** y un registro (`FX_PLANNERS` + `FX_KINDS`).
- **Cada mecánica se explica con su dibujo**: un elemento nuevo no puede compartir forma ni color con otro que hace algo distinto (el aro hueco cian se leía como un portal), y lo que hace el Dino tiene que verse en el Dino (la mochila del propulsor, la voltereta del doble salto).
- **La exigencia es por canción** y se mide con las vecinas en su sitio.
- **El margen mínimo de cada dificultad es un suelo**: las aperturas del acento (arco, principio, reparto) solo lo abren y, si falta exigencia, se cierran hasta él.

**Limitaciones que quedan:**

- **Los clips muy cortos siguen algo más fáciles** en Extremo (Sugar Red, 40 s: 0.22): no tienen golpes fuertes con sitio suficientes para gastar el presupuesto sin inventar acentos. En canciones enteras, Extremo queda en 0.01-0.07.
- **La melodía se comprueba de oído** (`sonify --melody`): un solo o un sintetizador que tape la voz también es "la melodía"; en pasajes sin melodía sigue la voz más aguda del acompañamiento.
- **El jugador de referencia es un modelo** (error gaussiano, sin despistes ni aprendizaje). El siguiente playtest dirá si 3★/4★/5★ se sienten como se pidió; todo está en tablas (`accent` y `ring` y `fly` por dificultad, `ACCENT_RULES`, `RING_RULES`, `FLIGHT_PLAYER`, `FX_RULES`, `JUMP_RING`).
- **Los agachados siguen sin acentos** (agacharse antes es gratis).
- El suite JS tarda ~3 min (charts reales y Monte Carlo en paralelo).

#### La partida empieza con la música ✅ (Oct 2026, playtest de One Day)

Jugando One Day (Relajado, T02.6), el user: **"casi hasta el segundo 0:30 se siente muy aburrido porque no pasa nada… fácil no debe significar no hacer nada por 30 segundos"**. Medido: la primera acción llegaba en el **segundo 35.4**.

**Causa** (dos reglas que por separado tenían sentido):
- El primer tramo de One Day (0-35 s, cuerdas suaves) es de **reposo** (nivel 0 del arco) y el reposo de Relajado no lleva acciones (`apm[0] = 0`): las pone el relleno de silencios de juego.
- El relleno (`fillLongRests`) **se saltaba todo lo anterior a la tercera acción** para no tocar el tutorial ("sus saltos van espaciados a propósito"). El hueco entre el arranque y la primera acción no lo miraba nadie.

No era solo One Day: cualquier canción que abra en reposo. What's Up Danger empezaba en el segundo 13.2 en Relajado y en el 8.1 en Fácil, y Dawn of Faith dejaba 5.5 s entre dos saltos del tutorial en todas sus dificultades.

**Regla general (charter 13):**
- **El principio también cuenta.** El relleno mira desde la ventana inicial: el hueco hasta la primera acción y los del tutorial tienen máximo, el de un tramo de reposo (`maxRestS` × `restLevelFactor`: 5.1 s en Relajado … 2.2 s en Extremo). El tutorial sigue siendo de **saltos en tiempos fuertes, espaciados** (`INTRO_GAP_S`), pero llega con los primeros compases.
- **El reposo con que abre una canción no es un descanso**: todavía no se ha jugado nada. Pasado el tutorial se rellena como la calma (`maxRestS` sin alargar). El respiro largo queda para los reposos de después (un break).
- Donde la música calla de verdad sigue sin haber acciones, y donde no hay pulso tampoco (One Day no tiene golpes hasta el segundo 7.7: la primera acción es ese primer compás).

| Nivel | Primera acción antes → ahora | Acciones en los primeros 30 s |
|---|---|---|
| One Day (Relajado, oficial) | 35.4 s → **7.7 s** | 0 → **9** |
| What's Up Danger (Relajado) | 13.2 s → 5.6 s | 7 → 9 |
| What's Up Danger (Fácil) | 8.1 s → 5.6 s | 12 → 13 |
| Dawn of Faith (Difícil, oficial) | 5.8 s (y un hueco de 5.5 s) → 5.8 s (hueco máximo 2.9 s) | 20 → 22 |

One Day: 7.7 · 11.8 · 16.0 (tutorial, un salto por compás) y después un salto cada dos pulsos (18.1 · 21.1 · 23.3 …), como en la calma que sigue. Los demás oficiales no cambian (ya abrían jugando); el resto de cada chart es idéntico.

**Verificación.** `charter.test.mjs`: canción sintética a 60 BPM que abre con 36 s de reposo, en las 5 dificultades (≥ 6 acciones en esos 36 s, ningún hueco por encima de su máximo, tutorial de saltos espaciados) y **One Day como regresión** (primera acción con el primer compás, ≥ 8 acciones antes del 0:30, ningún hueco de más de 5.1 s en el primer minuto). El medidor de huecos de los tests (`playedRests`) cuenta ahora el principio y dejó de dar por "estreno de un modo" todo lo anterior a un portal. **339 JS.** Oficiales re-horneados y re-sembrados; comunidad re-charteada (`--charter-below=13`).

**Decisiones (vinculantes):**
- **La partida empieza con la música**: mientras suena y tiene pulso, el principio obedece el mismo máximo de silencio de juego que el resto.
- **Un descanso se gana**: el silencio largo de un reposo vale tras haber jugado, no al abrir la canción.
- **Fácil es menos y más espaciado, nunca nada.**

**Limitación:** una canción que abra con música sin golpes (un colchón sin ataques) sigue sin acciones hasta su primer pulso: fuera del pulso no hay dónde ponerlas sin romper "música primero".

#### Una pulsación, un gesto: saltos, agachados y colisiones que se ven ✅ (Oct 2026, playtest con un amigo)

Tres comentarios tras jugar One Day y otros niveles:
- El user: **"presionaba la tecla de salto y no saltaba, y perdí… me pasó una o dos veces"**.
- Su amigo: **"antes sentía que manteniendo la tecla el salto era más largo y pulsando rápido, corto"**.
- Su amigo, otra vez: **"se levantó cuando se estaba agachando del pájaro y creyó que no iba a perder… al ver el juego parado, el dino no choca al pájaro"** (con captura).

Los tres eran lo mismo visto desde sitios distintos: **el nivel se construye y se valida con un jugador que mantiene las teclas, y la partida castigaba a quien solo las pulsa**. Y lo que mataba no siempre era lo que se veía.

**1. El salto dependía de cuánto se mantenía la tecla.** Soltar pronto cortaba el salto (`JUMP_CUT_MULTIPLIER` 2.6, rediseño de Jul 2026). Funcionaba como se diseñó (medido con teclas reales por CDP: 40 ms → 84 de alto y 0.40 s de aire; 500 ms → 158 y 0.68 s). El problema es que el charter coloca cada obstáculo para que cruce al Dino en el ápice del salto COMPLETO, y su validador solo salta así. Margen para pulsar (ms antes / después del golpe) según cuánto se mantenga, ante un cactus suelto:

| Velocidad | toque 0.06 s | 0.1 s | 0.15 s | 0.2 s | 0.3 s | completo |
|---|---|---|---|---|---|---|
| 250 px/s | no se salva | no se salva | +76 / +132 | +26 / +132 | −74 / +132 | −116 / +132 |
| 400 px/s | +166 / +166 | +92 / +182 | +26 / +182 | −24 / +182 | −124 / +182 | −166 / +182 |
| 600 px/s | +150 / +208 | +68 / +216 | +2 / +216 | −48 / +216 | −148 / +216 | −190 / +216 |
| 1000 px/s | +124 / +224 | +42 / +232 | −24 / +232 | −74 / +232 | −174 / +232 | −216 / +232 |

Un margen que empieza en positivo significa que **pulsando EN el golpe se muere**: había que pulsar tarde. One Day va a 376 px/s y son 70 cactus: con un toque de 0.1 s el salto solo valía pulsando entre 100 y 180 ms tarde. Mantener ≥ 0.25 s lo arreglaba, y por eso "no pasa siempre". En un móvil, donde se juega a toques, era lo normal. Con los anillos, igual: soltar cortaba también el segundo salto.

**2. Agacharse exigía dos tiempos y solo se avisaba de uno.** El ptero cruza al Dino 0.36 s después del golpe y hay que seguir agachado hasta que pasa: de 0.42 s (1000 px/s) a 0.60 s (250 px/s) manteniendo. Soltar un poco antes era levantarse contra él. Ese segundo tiempo no lo validaba nadie para una persona (el jugador virtual mantiene hasta 60 unidades después).

**3. Lo que mataba no era lo que se veía.** Cada dibujo chocaba por una caja con relleno fijo. Medido colocando los dibujos reales en todas las posiciones en que el juego da choque (aire que queda entre los dos, en celdas de 4 unidades):

| Dino contra… | Antes | Ahora |
|---|---|---|
| De pie, ptero (levantarse con su cola sobre el lomo: la captura) | **7** | 1 |
| En el aire, ptero | 6 | 2 |
| En el aire, grupo de cactus (caer justo detrás) | 5 | 2 |
| Antigravedad, cristal del suelo / del techo | 3-4 | 0-1 |
| Cactus suelto e hileras | 2 | 2 |

La caja del Dino de pie incluía el aire sobre su lomo (la cabeza empieza en la celda 11) y la del ptero, el de debajo de su cola y su ala. Además **la imagen congelada no era la del golpe**: el choque se detecta en un paso de física, pero el mundo se dibujaba en el instante del fotograma, hasta 16 ms después (más con un tirón), con el obstáculo ya más allá.

**4. El reloj de la canción avanzaba a escalones.** `AudioContext.currentTime` solo sube cuando el sistema pide otro bloque de audio. Medido (Chrome, Windows, 60 FPS): escalones de 9 a 20 ms; un fotograma avanzaba la canción 9 ms y el siguiente 20. Los obstáculos, que se colocan desde ese reloj, temblaban frente al suelo, y cada pulsación se fechaba con ese error. En un móvil los bloques son mayores.

**5. La pausa.** Volver a la pestaña reanudaba el audio aunque la partida estuviese en pausa (el manejador de visibilidad no sabía de la pausa): la canción seguía detrás del panel. Reanudar era instantáneo, con las manos todavía en el ratón (o el dedo en el botón). Y si el sistema cortaba el audio (una llamada en un móvil), la partida se congelaba sin panel.

**Lo que NO era** (medido, para no arreglar lo que no está roto): una tecla pulsada durante un tirón no se pierde ni se fecha mal (con el hilo bloqueado 120 y 250 ms, Chrome entrega la tecla antes del siguiente fotograma y la física la aplica en su instante); One Day va a 60 FPS (p95 17 ms) en la Intel UHD 620 a 1080p.

**Reglas nuevas:**
- **Un toque es el salto normal; mantener lo hace más alto y más largo** (`modes/run.js`, `JUMP_HOLD`). Un toque (menos de 0.12 s) da exactamente el arco base, el del charter. Manteniendo más, el Dino sube con menos gravedad: hasta ~193 de alto y 0.85 s de aire, frente a 158 y 0.72 s. Lo pidió el user: "el jugador controla el salto: si necesita saltar corto, pulsa rápido". Es el salto variable de antes dado la vuelta: antes soltar pronto RECORTABA el arco del nivel; ahora el arco del nivel es el mínimo y mantener solo añade (el mantenido va siempre por encima del base). Una versión intermedia, más alto pero aterrizando a la vez, se descartó: confundía. `JUMP_CUT_MULTIPLIER` ya no existe. El validador juega con el arco base (el jugador virtual suelta en el mismo instante). Para caer antes sigue el fast-fall (↓ en el aire).
- **Agacharse es un gesto**: un toque deja al Dino agachado `DUCK_MIN_S` (0.4 s) y, al soltar, **no se levanta mientras tenga algo encima** (`settle` del modo, con `physics.settlePosture`: la partida y el simulador preguntan si la caja de pie chocaría ahora). Mantener sigue valiendo y saltar lo cancela.
- **Figura dentro de la caja** (`geometry.js`): `FIGURE` y `figureHit`. De pie, la caja menos el hueco sobre el lomo (`STANDING_NOTCH`, reflejado cabeza abajo). Los obstáculos que no llenan su caja traen relleno propio (`hitPad`: el ptero choca por su cuerpo, no por el ala) o piezas (`hitParts`: los cristales); `obstacleHit` es LA colisión de la partida y del simulador. El grupo de cactus se redibujó para llenar su caja (los tres casi igual de altos).
- **La imagen congelada es la del golpe**: al chocar el mundo se dibuja en el instante del paso que lo detectó, y el Dino muere en su postura (`dinoJumpDead`, `dinoDuckDead`).
- **Reloj continuo** (`audio/steadyClock.js`, puro): reloj de alta resolución más un desfase que se estima con la envolvente superior del reloj a escalones y se corrige despacio. Monótono; quieto con el audio detenido.
- **El audio se detiene por motivos** (`AudioEngine.hold/release`: `pause`, `hidden`) y solo suena sin ninguno. **Toda detención jugando es una pausa con su panel** (`audio:pause` → `AppController`). **Reanudar va con cuenta atrás** (3, 2, 1; pausar durante la cuenta la cancela). Si medio segundo después el audio no ha vuelto (algún navegador móvil solo lo reanuda dentro de un gesto), vuelve el panel y el siguiente "Reanudar" lo hace dentro del toque.
- **Nada se queda pulsado** al perder el foco (`input.js`), y en táctil el lienzo no espera gestos del navegador (`touch-action: none`), ni selecciona ni abre el menú de pulsación larga.

**Charter 14.** Las cajas nuevas caben dentro de las de antes: los charts publicados siguen siendo superables. El charter vuelve a medir los márgenes y gasta la misma exigencia por canción, pero parte de lo que antes mataba eran choques con el aire en combinaciones con pteros: en Mi Fiesta (Difícil) el riesgo que no venía de los acentos bajó de 0.58 a 0.21 y lo compensan los acentos (se supera el mismo 22 %). Con las piezas, un cristal perdona 5-25 ms más por el lado de pulsar tarde; con 110 ms como tope de la escalera de afilados, la zona roja de What's Up Danger dejaba de apretar y el charter gastaba la exigencia antes. Dos escalones más (95 y 80 ms) lo devuelven a su sitio:

| What's Up Danger, Extremo (±45 ms, 600 partidas) | Lo supera | Riesgo por cuarto de canción |
|---|---|---|
| Charter 13 | 6.5 % | 0.22 · 0.49 · 0.49 · 1.55 |
| Piezas, escalera hasta 110 | 8.5 % | 0.31 · 0.70 · 0.57 · 0.88 |
| Piezas, escalera hasta 80 (charter 14) | 5.0 % | 0.19 · 0.45 · 0.53 · 1.85 |

**Verificación.**
- `gestures.test.mjs`: mismo arco se suelte cuando se suelte; un toque en el golpe (±80 ms) salva un cactus y agacha bajo el ptero de 250 a 1000 px/s; soltar con el ptero encima no levanta al Dino; y **los 9 oficiales se superan a toques** (`validateChart(…, { tapS })`: el jugador virtual pulsa y suelta a los 60 ms) con la tolerancia de su dificultad.
- `hitboxes.test.mjs`: ninguna postura con ningún kind deja más de una celda de aire en un choque (`helpers/silhouettes.mjs`); el ptero sigue obligando a agacharse; el hueco es aire en todos los dibujos del Dino; piezas dentro de su caja.
- `steady-clock.test.mjs` y `song-clock.test.mjs`: continuo con bloques de 3 a 40 ms, monótono, un corte de audio de 80 ms, pausa, motivos que se acumulan.
- **365 JS, 81 PHP, 112 Python.** Bundle principal 86.9 KB gzip (+1.8).
- **E2E** (Chrome con la GPU real, teclado y toques por CDP): el reloj de la partida baila 0.19 ms por fotograma (p95; el de audio, 8.1); cuatro cactus de One Day con toques de 50 ms, todos a 158 de alto; un bot que **solo da toques** supera Sugar Red (3★: 10 pteros, hileras y un anillo) y **What's Up Danger en Extremo entero** (216 s, 100 pteros, antigravedad con cristales afilados, propulsor y anillos; 59.9 FPS, p99 17.6 ms) al 100 %, y otro que suelta ↓ con cada ptero encima, también; las imágenes congeladas enseñan el choque; pausa → pestaña oculta y de vuelta → sigue en pausa; cuenta atrás (y pausar durante la cuenta la cancela); el audio cortado desde fuera abre el panel; reintentar y salir al menú desde la pausa dejan el audio sonando; ↓ mantenido se suelta al perder el foco; en táctil emulado, un toque a la izquierda salta completo (158, 0.68 s) y uno a la derecha agacha 0.4 s.

**Decisiones (vinculantes):**
- **Una pulsación, un gesto.** Cada acción del nivel se supera pulsando en su golpe, se mantenga o no. El salto variable del rediseño de Jul 2026 (soltar = salto más corto que el del nivel) se sustituye por: toque = el salto del nivel, mantener = más alto y más largo. Aterrizar más tarde por mantener es decisión del jugador. Lo protege el jugador de toques sobre los oficiales.
- **El Dino no se levanta debajo de algo.**
- **Lo que choca es lo que se ve**: en un choque los dibujos se tocan o les falta una celda. Un kind o una postura nuevos pasan por `hitboxes.test.mjs`; si su dibujo no llena la caja, `hitPad`, `hitParts` o redibujarlo.
- **La imagen congelada es la del golpe.**
- **Los kinds publicados no se renombran ni se quitan** (los charts públicos, congelados, los nombran): las escaleras de variantes solo crecen. Y una caja de colisión solo puede encogerse dentro de la anterior.
- **El reloj de la canción es continuo**; nada del juego lee `ctx.currentTime` directamente.
- **El audio se detiene por motivos, toda detención es una pausa con panel y se reanuda con cuenta atrás.**

**Limitaciones:**
- Saltar debajo de un ptero sigue siendo chocar: es una acción explícita, no una postura.
- Dos fuentes de agacharse a la vez (↓ y S, dos dedos a la derecha): soltar una suelta el gesto. Con el Dino sin levantarse bajo nada, no mata.
- La latencia de salida se toma de lo que informa el navegador; con auriculares Bluetooth que informen mal haría falta una calibración manual en AJUSTES (no existe).
- Lo táctil se probó emulado; falta un móvil de verdad.

---

### Ola 7 — Ediciones del autor y editor de niveles 💤 (aplazada: futura actualización)

> **Decisión (Sep 2026, tras la Ola 6c):** se aplaza. Es la pieza más compleja que queda y hoy aporta poco frente a pulir cómo se juega y cómo se ve. Se guarda como **actualización futura, para anunciarla como sorpresa** cuando el juego esté publicado y haya autores que suban canciones. Esta sección deja el diseño pensado para que quien la retome no empiece de cero.

**Qué es.** Que el AUTOR de un nivel pueda retocar momentos concretos de SU nivel (quitar un obstáculo, poner otro, cambiar uno por una variante, fijar uno) sin renunciar a la generación automática: el charter sigue haciendo el nivel entero y las ediciones van encima.

**Qué NO es.**

- **No es una herramienta para arreglar los niveles oficiales ni ningún nivel a mano.** Un nivel que suena mal se sigue arreglando con reglas generales del analizador y del charter, y el playtest se convierte en test de regresión. Los oficiales no llevan ediciones.
- No es un editor desde cero (tipo Geometry Dash). El punto de partida siempre es el chart generado.
- No cambia qué modos existen ni sus reglas. Mover dónde va un modo, como mucho, en una segunda fase y solo entre los tramos que el reparto admite.

**Sobre qué se apoya (ya existe).**

| Pieza | Por qué la hace posible |
|---|---|
| Chart versionado con `music` separado de `events` (Ola 3, §"formato") | Las ediciones tocan `events`; el análisis no se toca |
| Posición de todo derivada del reloj de la canción (`physics.obstacleLeftX`, `speedProfile`, `spawner`) | Saltar a cualquier instante (scrub) es gratis: el mundo se coloca desde el tiempo, no se simula |
| `playability.validateChart` + `virtualPlayer` (Olas 5-6c) | Cada edición se valida con la tolerancia de la dificultad: nada injugable llega a publicarse |
| `challenge.referencePassRate` | Enseñar al autor cuánto cambió la exigencia con sus ediciones |
| `normalizeChart` / `ChartValidator.php` | Datos no confiables del cliente, validados en los dos lados |
| Estado "listo para publicar" y chart congelado al publicar (ajustes de la Ola 5) | Momento natural para editar: antes de publicar |
| `Progress::invalidateForLevel` y la regla "una marca vale para el chart con el que se hizo" | Qué hacer con las marcas si un chart editado cambia |
| Panel de desarrollo y `godMode` | Semilla del "probar desde aquí" |

**Diseño propuesto.**

1. **Ediciones como capa aparte**: `levels.chart_overrides_json` (o una tabla `level_overrides`), una lista de operaciones:
   `{ op: 'remove' | 'add' | 'replace' | 'lock', at: { bar, beat, sub }, kind? }`.
   - Se anclan a una **posición MUSICAL** (compás, pulso, subdivisión de `music.beats`/`downbeats`), no a segundos: si un charter o un analizador nuevo mueve un poco los golpes, la edición sigue en su golpe. Si no encuentra su golpe (±1 hueco de rejilla), queda "sin encajar" y se le enseña al autor; nunca se aplica en otro sitio en silencio.
2. **`levels/overrides.js` (puro)**: `applyOverrides(chart, overrides, model)` → `{ chart, report }`, justo después de `buildChart`. Luego `validateChart` con la tolerancia de la dificultad: una edición que lo vuelve injugable se rechaza con su motivo (qué choca y dónde). Determinista y con tests como el resto del charter.
3. **Cuándo se puede editar**: solo con el nivel privado o "listo para publicar". Al publicar, el chart (con sus ediciones) se congela como hoy. Editar un nivel ya publicado = nueva versión que invalida las marcas (`Progress::invalidateForLevel`) y se avisa antes. Lo más sencillo es no permitirlo en la primera versión.
4. **Re-chartear**: cuando sube `CHARTER_VERSION`, el worker (`scripts/lib/chartFromAnalysis.mjs`) vuelve a aplicar las ediciones de los niveles privados; las que ya no encajan se guardan aparte y se le enseñan al autor ("3 ediciones ya no encajan con la nueva versión").
5. **Servidor**: `POST/GET /api/levels/{id}/overrides` (solo el autor), validación en `ChartValidator` (lista cerrada de ops, kinds del registro, límites de tamaño), y el chart resultante recalculado en el servidor, igual que las variantes de dificultad. El cliente nunca manda el chart final.
6. **Editor sobre el propio juego** (escritorio primero):
   - El mapa de la canción del HUD como línea de tiempo, con la rejilla de pulsos y los tramos.
   - Scrub: pausar, arrastrar, y el mundo se coloca solo en ese instante.
   - Paleta con los kinds del registro permitidos en ese modo y dificultad (`OBSTACLE_KIND`).
   - Validación en vivo: marcas rojas donde no se puede jugar, con la exigencia antes/después.
   - "Probar desde aquí": una GameSession que empieza en un instante.

**Lo que falta construir** (no existe hoy):

- `AudioEngine`: reproducir desde un instante (seek/offset). `GameSession`, `fixedStep`, `spawner` y `beatClock`: arrancar en un instante distinto de 0.
- `levels/overrides.js` y sus tests: determinismo, re-chart que conserva, rechazo de lo injugable, ediciones sin encajar.
- Migración de las ediciones, endpoints y validación PHP.
- La UI del editor (`ui/editor/…`), cargada bajo demanda como el charter para no pesar en el bundle principal.

**Riesgos que hay que decidir al retomarla.**

- Las reglas globales del charter (presupuesto de exigencia de los acentos, anillos solo si son necesarios, huecos de `PAIR_GAP`) pueden quedar rotas por una edición. El validador garantiza que sea jugable, no que suene bien. Propuesta: tras aplicar las ediciones, recalcular la exigencia y enseñarla, sin reequilibrar el resto a escondidas.
- La dificultad del nivel es la que eligió el autor. Si con sus ediciones sale muy por debajo o muy por encima de la banda de esa dificultad, se avisa o se bloquea (decidir entonces).
- Tamaño: 2-3 sesiones de trabajo, más el playtest del propio editor.

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
                                ├──> Ola 6a (bases de modos + antigravedad) ──> Ola 6b (reparto + vuelo) ──> Ola 6c (anillos, frases de vuelo, melodía, fx)
                                └──> Ola 7 (editor y ediciones del autor) — aplazada: futura actualización
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
| D6 `difficulty` hardcodeada | 5 ✅ (medida en 2) | D14 espaciado en s, no en px | 5 ✅ |
| D7 `?public=1` muerto | 0 ✅ | D15 sin validación de jugabilidad | 5 ✅ (básica desde 3) |
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
