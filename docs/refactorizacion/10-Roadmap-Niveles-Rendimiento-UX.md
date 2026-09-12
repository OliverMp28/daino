# Roadmap — Rediseño de niveles, rendimiento y UX (Sep 2026)

> **Qué es este documento.** Tras retomar el proyecto y jugarlo de verdad, el resultado no convence. Este doc recoge el diagnóstico técnico completo y organiza el trabajo restante en **olas** entregables.
>
> **Por qué "olas" y no "bloques".** Los Bloques 0–7 del doc 08 son constructivos: cada uno añade una capa que antes no existía. Lo que viene ahora atraviesa código ya cerrado (engine, generador, modales, API de niveles). Llamarlos "Bloque 9, 10, 11…" daría a entender que se apilan encima; no es el caso. Una **ola** modifica lo que ya hay.
>
> **Autoridad.** Los docs 04, 05, 07 y `vout-integration/integration-guide.md` siguen por encima de este. Este doc **modifica el doc 06 §4.1** (ver Ola 2) y **sustituye** la descripción de generación de niveles del doc 08 § Bloque 5. Todo lo demás del 06 y del 08 sigue vigente.
>
> **Estado:** ninguna ola arrancada. Investigación cerrada Sep 2026.

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

---

## 2. Decisiones vinculantes

Tomadas explícitamente por el propietario del proyecto en la sesión de planificación (Sep 2026).

### 2.1 Análisis pesado en servidor; charting compartido en JS

Se separan dos responsabilidades que hoy están fundidas en `LevelGenerator`:

| | **ANÁLISIS** | **CHARTING** |
|---|---|---|
| Qué hace | DSP: onsets, beats, downbeats, secciones, energía | Decide qué obstáculo va dónde, con qué dificultad |
| Coste | Alto, segundos o minutos | Trivial, milisegundos |
| Dónde corre | **Sidecar Python** (`librosa`/`madmom`), offline, una vez por canción | **JS puro, compartido**, en el navegador |
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

### Ola 0 — Quick wins

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

**Verificación.** Cronometrar "Analizando audio…" con la misma canción antes y después (esperado: de 3–5 s a menos de 1 s). Abrir NIVELES y comprobar que pinta al instante. `EXPLAIN` sobre `findPublic()` mostrando uso del índice.

---

### Ola 1 — Perfiles de render por estado

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

**Verificación.** DevTools → Performance, 10 s en MENU antes y después. Confirmar que el menú cae a ~30 fps con el filtro a resolución reducida y que la partida mantiene 60 fps a resolución plena. Comprobar que la transición menú→partida sigue siendo continua (sin parpadeo ni salto del suelo).

---

### Ola 2 — UX: menú, catálogo y "subir mi canción"

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

---

### Ola 3 — Motor de niveles I: formato Chart y sincronía real

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

**Verificación.** Reproducir una canción con un click de metrónomo superpuesto y comprobar que los obstáculos llegan al Dino **sobre el beat**. Jugar el mismo nivel dos veces y comprobar en la pestaña Network que la segunda no hace ninguna petición ni muestra la fase de análisis. Redimensionar la ventana entre dos partidas del mismo nivel y comprobar que los obstáculos caen en los mismos instantes.

---

### Ola 4 — Motor de niveles II: analizador en servidor

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

- **Seed del catálogo oficial:** `composer seed:official` copia de `docs/legacy/audios/` a `storage/official/`, crea las filas con `is_official = TRUE` y encola el análisis de cada una.

**Notas técnicas que no se pueden pasar por alto:**
- **Desfase del decodificador.** `ffmpeg` y el decodificador MP3 del navegador tratan el encoder delay/padding de forma distinta (~26 ms, a veces hasta ~100 ms). El reloj del juego es `ctx.currentTime − _playStartedAt` sobre el buffer decodificado *por el navegador*. Por eso `chart.json` lleva `audio.offsetSec`: permite corregirlo sin regenerar nada.
- **Duración.** Guardar la del servidor pero dejar que el cliente prefiera `audioBuffer.duration` para la condición de victoria.

**Verificación.** Publicar una canción, ver progreso de análisis real, y que otro usuario (otra sesión, otro navegador) la juegue **sin ninguna fase de análisis**. Ejecutar el seed en una BD limpia y comprobar 8 niveles oficiales jugables.

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
| D1 fila duplicada por partida | 3 | D9 modal sin precarga | 0 |
| D2 título `.mp3.mp3` | 0 | D10 `sampleRate` no fijado | 0 |
| D3 validación 200 vs col 120 | 0 | D11 nivel privado no jugable | 2 |
| D4 botón "Jugar" bloqueado | 0 | D12 identidad en iframe | 2 |
| D5 `file_path` expuesto | 0 | D13 orden `filterSpacing` | 3 |
| D6 `difficulty` hardcodeada | 5 | D14 espaciado en s, no en px | 5 |
| D7 `?public=1` muerto | 0 | D15 sin validación de jugabilidad | 5 |
| D8 sin índice `is_public` | 0 | | |

---

## 6. Cierre de cada ola

Mismo protocolo que los bloques (doc 08 § "Cómo cierra cada bloque"):

1. Verificación de la ola ejecutada y pasada.
2. Smokes temporales borrados.
3. Sección "Current state" del `CLAUDE.md` actualizada.
4. `.env.example` actualizado si aparecieron variables nuevas.
5. Commit en `rewrite/v2` con formato `feat: ola N — <título>`.
6. Ola marcada como ✅ en este documento.
