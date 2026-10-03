# Analizador musical de Daino (Olas 4 y 5)

Servicio `analyzer` de `docker-compose.yml`. Analiza cada canción **una vez, al
publicarla**, y guarda su análisis y su chart. Quien juega después no analiza
nada. Diseño y medidas: `docs/refactorizacion/10-Roadmap-Niveles-Rendimiento-UX.md`,
Ola 4 (analizador y cola) y Ola 5 (charter musical y dificultad elegida).

```
PHP (publicar) ──INSERT──▶ analysis_jobs ◀──SKIP LOCKED── worker Python
                                                            │ ffmpeg → análisis (proceso hijo)
                                                            │ node scripts/chart-from-analysis.mjs
                                                            ▼
                                   levels.chart_json / analysis_json / chart_hash
                                   audio_analyses (caché por sha256 + analizador)
```

- **Análisis** (Python): beats y downbeats con beat_this, afinados al ataque real;
  onsets con color y percusividad del ataque (golpe de batería o nota); energía
  global y por bandas (graves, medios, agudos); secciones con rol y tonalidad;
  armonía (`tonal.py`: afinación, tonalidad, acordes por beat, modulaciones);
  rasgos para el techo de dificultad. Formato 2, validado por `schema.py` y por
  `ChartValidator.php`. Qué significa cada campo, cómo se midió y sus límites:
  doc 10, "Afinado del analizador".
- **Charting** (JS): el MISMO `resources/js/game/levels/charter.js` que usa el
  navegador. No hay una segunda implementación de la jugabilidad. Recibe la
  **dificultad** que pidió el autor (`levels.difficulty_requested`, `NULL` =
  Automática), leída al chartear.

**Publicar son dos pasos** (tras el playtest de la Ola 5). El worker analiza y
deja el nivel **listo para publicar**: con el chart de la dificultad pedida y,
en `levels.chart_variants_json`, el de **cada dificultad que la canción admite**
(`auto`, `1`…techo), todos generados aquí. El worker **nunca hace público un
nivel**: su autor elige una dificultad (PHP copia la variante: instantáneo, sin
cola) y confirma. Un nivel publicado tiene una sola dificultad y ninguna variante
(lo exige un CHECK de la BD).

Propósitos de un trabajo (`analysis_jobs.purpose`):

| Propósito | Quién lo encola | Chart de un nivel ya público |
|---|---|---|
| `publish` | subir un nivel para publicarlo (queda listo, no público) | — (aún no es público) |
| `backfill` | `--missing-charts` | se conserva |
| `reanalyze` | `--level`, `--client-charts` | se sustituye |
| `rechart` | `--charter-below` | se sustituye |

Con el análisis en caché (`audio_analyses`), cualquiera de ellos es un re-chart
de menos de un segundo: no se vuelve a analizar el audio.

## Uso diario

```bash
docker compose up -d analyzer                              # arranca el worker
docker compose logs -f analyzer                            # log JSON por trabajo
docker compose exec -T php composer analysis:status        # cola y últimos trabajos
docker compose up -d --scale analyzer=3                    # más workers: se reparten la cola
```

Encolar a mano (PHP, nunca duplica un trabajo activo):

```bash
docker compose exec -T php composer analysis:enqueue -- --missing-charts   # niveles con audio y sin chart
docker compose exec -T php composer analysis:enqueue -- --level=12,15      # reanalizar esos niveles
docker compose exec -T php composer analysis:enqueue -- --client-charts    # públicos con chart del navegador
docker compose exec -T php composer analysis:enqueue -- --charter-below=4  # comunidad con charter anterior → re-chart
```

Tras subir `CHARTER_VERSION` (cualquier cambio en el charter), `--charter-below=<nueva>`
re-chartea los niveles de la comunidad con su análisis guardado y la dificultad que
su autor tuviera pedida; los oficiales se re-hornean (ver abajo). La versión actual
es la 12 (Ola 6c: anillos de salto, vuelo en frases con la altura de la melodía,
efectos nuevos y la misma exigencia por dificultad en cualquier canción; doc 10). Un nivel analizado con un analizador anterior se vuelve a
analizar en ese re-chart (medido: 37-49 s por canción de 3-4 min; con el
análisis en caché, ~2 s).

`ANALYZER_ENABLED=false` en `.env` desactiva el flujo: publicar vuelve a ser
inmediato con el chart del navegador (el sistema degrada, no se rompe).

### Lo que sale del carácter de la canción: escenario y efectos (T02.5, T03.3)

Al chartear, el worker guarda también dos cosas que salen de cómo suena la
canción, con el mismo análisis que se guarda:

- `levels.scene_auto`: el ambiente que le pega, o NULL (la Cordillera). Lo decide
  `resources/js/game/scenes/sceneCasting.js`.
- `levels.fx_auto`: la identidad de sus efectos, su paleta y su firma
  (`{"palette":"ice","signature":"aurora"}`), o NULL (la paleta de siempre y sin
  firma). Lo decide `resources/js/game/fx/casting.js`.

Los dos repartos son JS, como el charter, y comparten motor
(`levels/portraits.js`) y rasgos (`levels/songTraits.js`). No tocan el chart ni
las marcas, así que un nivel publicado también se actualiza.

Tras cambiar las reglas (`SCENE_CASTING_VERSION`, `FX_CASTING_VERSION`) o crear
una de las columnas, se vuelve a repartir lo que ya tiene análisis, sin reanalizar
ni re-chartear (segundos):

```bash
docker compose exec -T analyzer python -m daino_analyzer cast --dry-run   # qué cambiaría
docker compose exec -T analyzer python -m daino_analyzer cast             # aplicarlo
docker compose exec -T analyzer python -m daino_analyzer cast --level=12,15
bun run bake:official && docker compose exec -T php composer seed:official   # los oficiales (horneado)
bun run cast:report                                                           # rasgos y encajes de cada oficial
```

(`cast-scenes` y `bun run scenes:report` siguen valiendo: son los mismos comandos.)

Para ver qué propondría con cualquier canción: `analyze <mp3> --out x.json` (arriba)
y `bun run cast:report -- x.json`.

## Catálogo oficial en un despliegue nuevo

Los MP3 no están en el repo (pistas comerciales, remote público). Los horneados
(`database/seeds/official/baked/*.json`) sí.

```bash
# 1. Sembrar: comprueba el sha256 de cada MP3 contra su horneado y lo copia a storage/official/
docker compose exec -T php composer seed:official -- --from=docs/legacy/audios

# 2. Solo si se añade una canción o cambia el analizador: volver a hornear
docker compose run --rm \
  -v ./database/seeds/official/baked:/srv/daino/database/seeds/official/baked \
  -v ./docs/legacy/audios:/audios:ro \
  analyzer bake-official --from /audios
bun run bake:official -- --check                           # ¿horneados al día con el charter?
docker compose exec -T php composer seed:official -- --rechart   # aplicar charts nuevos (invalida marcas)
```

Si solo cambia el charter, la escala de dificultad o un reparto (escenarios, efectos),
basta `bun run bake:official` (re-chartea desde el análisis guardado, sin audio ni
Python) y `seed:official` (sin `--rechart` si el chart no cambió). La dificultad de cada
oficial la fija `difficulty` en `database/seeds/official/manifest.json` (`auto` si
falta); el horneado guarda también la medida (`measuredDifficulty`) para comprobarla.

## Tests

```bash
# Análisis (música sintética con verdad conocida + mir_eval) y cola/worker contra
# una base de datos desechable (daino_test_analyzer, se crea y se borra sola).
MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps --entrypoint python analyzer \
  -m pytest -q -p no:cacheprovider tests
```

`MSYS_NO_PATHCONV=1` solo hace falta en Git Bash de Windows.

## Depurar un análisis de oído

```bash
docker compose run --rm -v ./storage/analysis-debug:/out analyzer \
  sonify "/srv/daino/storage/official/HOPE.mp3" --out /out/hope.wav --chords --melody
```

La canción con clics: agudo en cada beat, grave en cada downbeat y uno más grave
en cada cambio de sección. Con `--chords`, además, cada acorde detectado suena
debajo (fundamental grave y tríada suave, con la afinación detectada): si acompaña
a la canción está bien, si choca no. Con `--melody` (analizador 3), un seno sigue
la melodía detectada: si canta con la voz (o el instrumento que lleva la melodía)
está bien; un salto de octava suelto es un error conocido y el charter solo usa
alturas relativas. `storage/analysis-debug/` está gitignored.

Otros comandos: `python -m daino_analyzer analyze <mp3>` (JSON del análisis),
`report <mp3>...` (resumen por canción: tempo, secciones, tonalidad, acordes más
largos, modulaciones, nivel por bandas, melodía y memoria pico del proceso), `health`.

## Versión del analizador

`ANALYZER_VERSION` (en `daino_analyzer/__init__.py`) forma parte de la clave de la
caché `audio_analyses`: subirla hace que un trabajo nuevo vuelva a analizar el
audio en vez de reutilizar lo guardado. Súbela con cualquier cambio que altere el
análisis de un mismo audio.

La 2 añade armonía, percusividad y bandas **sin cambiar nada de lo que ya había**:
re-hornear los oficiales dio charts idénticos byte a byte. Los niveles de la
comunidad conservan su análisis de la versión 1 hasta que se reanalicen, y no
pasa nada porque el charter todavía no lee la armonía. Cuando la lea: re-hornear
los oficiales (arriba) y `composer analysis:enqueue -- --level=…` para la
comunidad. `seed:official` guarda un análisis nuevo aunque el chart no cambie,
sin tocar chart ni marcas.

La 3 (Ola 6c) añade el **contorno melódico** (`melody.py`: bloque
`melody { hopSec, pitch, voicedRatio }`, sobre el mismo CQT que la armonía, sin
dependencias nuevas ni modelos; < 0.5 s por canción). Todo lo de la versión 2 sale
idéntico. El charter la usa para la altura de las notas del vuelo (charter 11+).

## Operación

| Variable | Por defecto | Qué hace |
|---|---|---|
| `ANALYZER_TORCH_THREADS` | 4 | Hilos de PyTorch por worker |
| `ANALYZER_JOB_TIMEOUT_SECONDS` | 900 | Tiempo máximo por canción (se reintenta) |
| `ANALYZER_MEM_LIMIT` | 3g | Memoria del contenedor |
| `ANALYZER_POLL_SECONDS` | 2 | Espera entre consultas con la cola vacía |
| `ANALYZER_MAX_TASKS_PER_CHILD` | 20 | Reciclado del proceso hijo (acota fugas nativas) |

Memoria medida (Sep 2026, analizador 2): el proceso que analiza una canción de
3-4 min llega a **640-890 MB de pico**, casi todo PyTorch y el modelo de
beat_this; la armonía añade unos pocos MB. El `ANALYZER_MEM_LIMIT` de 3g es para
desarrollo: en un servidor pequeño hay que ajustarlo midiendo el contenedor
entero con `docker stats` durante un trabajo real (proceso padre, hijo y el
charter de Node).

Garantías del worker (cada una con su test en `tests/test_worker.py`):

- Un trabajo lo coge **un solo worker** (`FOR UPDATE SKIP LOCKED`).
- La reserva (90 s) se **renueva por tiempo** mientras analiza, aunque una etapa
  larga no mande progreso. Si el worker muere, caduca y otro lo retoma.
- Fallo **transitorio** (tiempo agotado, hijo muerto) → reintento con espera
  exponencial hasta 3 intentos. **Permanente** (no es audio, hash distinto) →
  falla sin reintentar y el nivel vuelve a privado con su audio, para reintentar
  o publicar otro archivo.
- `docker stop` devuelve el trabajo a la cola **al momento y sin gastar intento**.
- Si el autor retira o vuelve a subir el nivel mientras se analiza, el worker lo
  ve al renovar la reserva y no escribe nada.
- Un nivel ya público **conserva su chart** (hay marcas sobre él) salvo
  reanálisis o re-chart explícito (`--level`, `--client-charts`, `--charter-below`).
  Su autor no puede cambiarle la dificultad.
- Un trabajo de publicación deja el nivel **listo, no público**, con sus variantes;
  un re-chart de un nivel listo regenera las variantes y conserva la dificultad
  elegida. La API no deja elegir dificultad mientras el nivel se analiza.

Seguridad: el contenedor solo recibe variables de base de datos y monta en solo
lectura lo que usa (su código, el charter JS, `database/`, los audios). No ve
`.env`, `storage/sessions` ni `docs/`. La API pública nunca devuelve el mensaje
de error del worker (salida de ffmpeg, rutas internas): solo su código.

## Producción

La imagen (`analyzer/Dockerfile`) ya contiene el código, el modelo de beat_this y
Node; los montajes de `analyzer/` en `docker-compose.yml` son para desarrollo.
Fuera de desarrollo el contenedor necesita igualmente `resources/js`, `scripts`,
`package.json` (`"type": "module"`), `database/` y los directorios de audio.
**No necesita `node_modules`**: el charting no importa ningún paquete npm
(comprobado en la Ola 5 recorriendo los imports de `chart-from-analysis.mjs` y
`bake-official.mjs`; la Ola 4 lo montaba creyendo que `physics.js` arrastraba Pixi).
