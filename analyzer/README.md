# Analizador musical de Daino (Ola 4)

Servicio `analyzer` de `docker-compose.yml`. Analiza cada canción **una vez, al
publicarla**, y guarda su análisis y su chart. Quien juega después no analiza
nada. Diseño y medidas: `docs/refactorizacion/10-Roadmap-Niveles-Rendimiento-UX.md`, Ola 4.

```
PHP (publicar) ──INSERT──▶ analysis_jobs ◀──SKIP LOCKED── worker Python
                                                            │ ffmpeg → análisis (proceso hijo)
                                                            │ node scripts/chart-from-analysis.mjs
                                                            ▼
                                   levels.chart_json / analysis_json / chart_hash
                                   audio_analyses (caché por sha256 + analizador)
```

- **Análisis** (Python): beats y downbeats con beat_this, afinados al ataque real;
  onsets con color de ataque; energía; secciones con rol; rasgos para el techo de
  dificultad. Formato 2, validado por `schema.py` y por `ChartValidator.php`.
- **Charting** (JS): el MISMO `resources/js/game/levels/charter.js` que usa el
  navegador. No hay una segunda implementación de la jugabilidad.

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
```

`ANALYZER_ENABLED=false` en `.env` desactiva el flujo: publicar vuelve a ser
inmediato con el chart del navegador (el sistema degrada, no se rompe).

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

Si solo cambia el charter o la escala de dificultad, basta `bun run bake:official`
(re-chartea desde el análisis guardado, sin audio ni Python).

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
  sonify "/srv/daino/storage/official/HOPE.mp3" --out /out/hope.wav
```

La canción con clics: agudo en cada beat, grave en cada downbeat y uno más grave
en cada cambio de sección. `storage/analysis-debug/` está gitignored.

Otros comandos: `python -m daino_analyzer analyze <mp3>` (JSON del análisis),
`report <mp3>...` (resumen por canción), `health`.

## Operación

| Variable | Por defecto | Qué hace |
|---|---|---|
| `ANALYZER_TORCH_THREADS` | 4 | Hilos de PyTorch por worker |
| `ANALYZER_JOB_TIMEOUT_SECONDS` | 900 | Tiempo máximo por canción (se reintenta) |
| `ANALYZER_MEM_LIMIT` | 3g | Memoria del contenedor |
| `ANALYZER_POLL_SECONDS` | 2 | Espera entre consultas con la cola vacía |
| `ANALYZER_MAX_TASKS_PER_CHILD` | 20 | Reciclado del proceso hijo (acota fugas nativas) |

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
  reanálisis explícito (`--level`, `--client-charts`).

Seguridad: el contenedor solo recibe variables de base de datos y monta en solo
lectura lo que usa (su código, el charter JS, `database/`, los audios). No ve
`.env`, `storage/sessions` ni `docs/`. La API pública nunca devuelve el mensaje
de error del worker (salida de ffmpeg, rutas internas): solo su código.

## Producción

La imagen (`analyzer/Dockerfile`) ya contiene el código, el modelo de beat_this y
Node; los montajes de `analyzer/` en `docker-compose.yml` son para desarrollo.
Fuera de desarrollo el contenedor necesita igualmente `resources/js`, `scripts`,
`package.json`, `node_modules` (el charter importa `pixi.js` vía `physics.js`),
`database/` y los directorios de audio.
