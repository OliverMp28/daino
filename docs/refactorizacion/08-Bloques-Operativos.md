# Bloques operativos — hoja de ruta de implementación

> Este documento divide el trabajo del nuevo Daino en **bloques entregables**, ordenados por dependencias. **Sustituye la numeración de fases del doc 03** para todo lo que afecta a este repo (las fases de Vout — 1 y 4 — siguen sin aplicar aquí).
>
> No es un plan detallado de cada bloque: es la **hoja de ruta**. Cada bloque, cuando toque ejecutarse, recibe su propio plan paso a paso (ver el formato del Bloque 1 en historial de la conversación).
>
> **Autoridad sobre este doc:** 04, 05, 06, 07 e `integration-guide.md` lo sobrescriben si entran en conflicto. Este doc solo organiza el trabajo, no toma decisiones técnicas nuevas.

---

## Estado actual

| Bloque | Estado | Resumen |
|--------|--------|---------|
| 0 — Scaffolding base | ✅ Completo | Docker, composer, bun, Vite, ViteAssets, .env, nginx |
| 1 — Mini-framework MVC | ✅ Completo | Env, Request, Response, Session (CSRF), Database, Router, routes |
| 2 — Persistencia (schema + modelos) | ⏳ Pendiente | — |
| 3 — Identidad Vout (OAuth2 + JWT + iframe bridge) | ✅ Completo + E2E con Vout real verificado | — |
| 3.5 — Auth resilience (PkceCookie firmada, lifetime 30d, redirect transparente, invalid_grant) | ✅ Completo | Fix de la fragilidad descubierta tras retomar el proyecto con cookies stale |
| 4 — Frontend foundation (PixiJS + audio + shader) | ✅ Completo | Canvas full-viewport, shader audio-reactivo, AudioEngine, MP3 drag&drop. Decisión: Daino jugable sin login obligatorio |
| 5 — Game core (entidades, físicas, input, spawner) | ✅ Completo | Dino + Obstacle + spawner determinista desde ObstacleTimeline pre-computada (Spectral Flux + BPM por autocorrelación, casero, sin Meyda). Single-hit, solo salto. HUD con BitmapText. Bundle 129.69 KB gzipped |
| 6 — UI / HUD / API client / modales | ✅ Completo | Menú DAINO + HUD migrado a DOM Tailwind + modales `<dialog>` slide-in (PERFIL real, RANKING/NIVELES placeholder, SETTINGS funcional, PAUSA centrado) + API client con refresh transparente + chip auth + pausa con ESC. Refactor del shader con `uShaderMode` para reset declarativo idle/reactive. Bundle 121.86 KB gzipped (–7.83 KB tras eliminar Hud canvas) |
| 7 — Persistencia API (progress, ranking, levels, comments) | ✅ Completo | AuthContext + Validator + Soft/Auth middlewares. Endpoints CRUD para Levels (con upload MP3 multipart, MIME real via finfo + magic-byte fallback para ID3v2 en Alpine), Progress (upsert + recompute Ranking sync), Ranking (top N paginado, JOIN sin N+1), Comments. Frontend: modales NIVELES/RANKING reales reemplazan placeholders, AppController crea Level antes de partida si hay sesión, GameSession persiste progreso fire-and-forget. AuthMiddleware ahora resuelve User vía claim `vout_id` del JWT (Vout actualizó el contrato tras feedback). Bundle 123.74 KB gzipped (+1.88 KB sobre B6) |
| 8 — Hardening (PHPStan 9, Pest, CSP, bundle budget) | ⏳ Pendiente | — |

### Olas de rediseño (Sep 2026)

Tras retomar el proyecto y jugarlo, se abrió una segunda hoja de ruta que **atraviesa código ya cerrado** (engine, generador de niveles, modales, API de niveles) en lugar de apilar capas nuevas. Por eso se numeran como **olas**, no como bloques. Viven en **`10-Roadmap-Niveles-Rendimiento-UX.md`**, que es la fuente de verdad para ellas.

| Ola | Estado | Resumen |
|-----|--------|---------|
| 0 — Quick wins | ✅ Completa | Tabla de twiddle en la FFT (93 % del coste del análisis), `sampleRate` fijo, índice `is_public`, precarga del catálogo, 5 defectos menores |
| 1 — Perfiles de render por estado | ✅ Completa | Una sola escena, presupuesto declarativo por estado (`maxFPS`, `filter.resolution`, partículas). Tier adaptativo + selector de calidad |
| 2 — UX: menú y catálogo | ✅ Completa | JUGAR abre el catálogo (rejilla de tarjetas + ficha con ranking del nivel), "Subir mi canción" como acción aparte, 8 niveles oficiales horneados y sembrados, identidad y embebido en Vout arreglados (D12, D21). **Modifica el doc 06 §4.1** |
| 3 — Chart + sincronía real | ✅ Completa | **Bisagra.** Arregla el desfase de 3–7 s entre beat y obstáculo, define `chart.json` versionado, persistencia y caché en cliente |
| 4 — Analizador en servidor | ✅ Completa | Servicio `analyzer` (Python + beat_this + librosa + ffmpeg) con cola en la BD (`analysis_jobs`, `SKIP LOCKED`, escalable). Publicar = 202 y el nivel se hace público al analizarse; progreso real en la ficha. Beats, downbeats, secciones, energía y techo de dificultad. Charter JS único (v2). Oficiales re-horneados, análisis local en Web Worker, duplicados D1 fusionados. **Afinado (Sep 2026, analizador 2):** tonalidad, acordes por beat, modulaciones y afinación, percusividad de cada onset y energía por bandas, sin dependencias nuevas ni RAM extra; charts intactos. Ver `analyzer/README.md` y doc 10 |
| 5 — Charter musical | ✅ Completa | Charter v3 en cinco piezas (modelo musical, arco de la canción, dificultad, patrones, charter): todo en la rejilla de pulso y contratiempo, densidad que sigue al arco con un clímax por canción, memoria de frases, mundo que acelera en los tramos que empujan (chart formato 2 con `speedChanges`), mecánicas que se estrenan en momentos del arco, drops y "¡Superado!" en el runtime. Dificultad de primera clase elegida por quien sube dentro del techo (D6), huecos medidos con la física (D14), cada chart validado jugando con la tolerancia de su dificultad (D15). **Ajustes tras el playtest:** publicar en dos pasos (analizado → su autor elige la dificultad entre variantes ya generadas y confirma; un nivel publicado tiene una sola), catálogo en una sola vista, pulsar un nivel lo juega, UI oculta inerte. **Afinado de velocidad (charter v4):** marchas hacia el clímax con trinquete (hasta ×1.55 en Extremo), acelerones en la anacrusa y charts validados también para quien juega con la vista; en partida, mapa de la canción en la barra de progreso, marchas en el HUD, aviso antes de cada acelerón y líneas de velocidad. **Tamaños de pantalla y reintentos:** toda pantalla apaisada ve el mismo mundo (vista escalada con el píxel del arte entero), UI en rem fluido con márgenes seguros, panel de resultados y de pausa con Reintentar sin volver a cargar, botón de pausa y aviso de girar el móvil en táctil |
| 6a — Bases de los modos + antigravedad | ✅ Completa | Registro de **modos de movimiento** (`systems/modes/`: añadir uno es un archivo + una entrada), física que despacha por modo, línea de modos del chart, jugador virtual único y chart **formato 3** con eventos `mode`. Primer modo: **antigravedad** (pasillo con techo; cualquier pulsación invierte la gravedad), colocada por `modePlan.js` en frases de 12-24 s de los tramos con cuerpo, con portal en la anacrusa, estreno espaciado y la dificultad decidiendo cuántas veces. En partida: portal como objeto del mundo, techo del pasillo, aviso y controles en el HUD. Y la progresión de velocidad más marcada tras el playtest (×1.13-1.80, techo 820 px/s) |
| 6b — Reparto de modos + vuelo | ✅ Completa | Arregla el techo que resbalaba. **Carácter de cada tramo** (`songCharacter.js`: contraste, pasivo/épico, sostenido/rítmico, con percusividad, bandas y armonía del analizador 2) y **reparto** (`modePlan.js`): cada modo, como mucho una vez, donde la canción suena distinto y encaja con su forma de jugarse; la dificultad decide qué modos existen y la duración cuántos momentos. Segundo modo: **vuelo** (mantener para subir) con su túnel determinista (`flightCourse.js`, `FlightTunnel.js`), notas mantenidas (`flightCharter.js`) y chart **formato 4** (`hold`, `margin`; modo desconocido = error). **Tras el playtest:** tramos donde la canción cambia de verdad (`songChanges.js`), clímax que empieza en su drop y modos que duran su tramo entero, entrando y saliendo con la música (charter 7) |
| 6c — Siguientes momentos | ⏳ Pendiente | Jugador virtual como política para el vuelo, anillos en el aire, altura de las notas por la melodía, eventos `fx` nuevos |
| 7 — Overrides manuales y editor | ⏳ Pendiente | Capa de ediciones que sobrevive a regeneraciones + editor visual |

> La descripción de generación de niveles del **Bloque 5** queda sustituida por la del doc 10 a partir de la Ola 3.

---

## Principios para los bloques

1. **Un bloque = un entregable completo y verificable.** Al cerrar un bloque, hay un smoke test que demuestra que funciona end-to-end para su scope.
2. **Las dependencias son estrictas.** Un bloque solo arranca cuando los anteriores están cerrados — o se documenta explícitamente que se arrancan en paralelo.
3. **Cada bloque actualiza la sección "Current state" del `CLAUDE.md`** al cerrarse, con la lista de archivos creados y decisiones tomadas.
4. **Los smoke tests temporales se borran al cerrar el bloque** (los rechaza el doc 04 §8 implícitamente — código limpio en cada hito).
5. **Si surge una decisión que no está en los docs autoritativos**, se para y se pregunta — no se improvisa.

---

## Bloque 0 — Scaffolding base ✅

**Objetivo.** Tener un pipeline ejecutable que sirva HTML desde PHP-FPM con HMR de Vite, sin lógica de negocio.

**Entregado.**
- Docker Compose (`nginx:1.27-alpine`, `php:8.5.3-fpm-alpine`, `mariadb:11.4`).
- `docker/php/Dockerfile` con OPcache+JIT, extensiones `pdo_mysql`/`intl`/`zip`.
- `docker/nginx/default.conf` con docroot `/public`, deny a `app/`, `vendor/`, `.env`.
- `composer.json` (lcobucci/jwt 5.x, vlucas/phpdotenv 5.x, league/oauth2-client 2.x).
- `package.json` + `bun.lock` (Vite 8.0.10, PixiJS 8.18.1, Tailwind v4.2.4 + `@tailwindcss/vite` 4.2.4). Build verificado con `bun run build`.
- `vite.config.js` con manifest a `public/build/`.
- `app/Core/ViteAssets.php` puente Vite↔PHP (modo dev y modo manifest).
- `.env.example`, `.gitignore`, `.editorconfig`, `.dockerignore`.

**Verificación.** `docker compose up -d` + `curl localhost:${APP_PORT}/` devuelve HTML con `Server: nginx/1.27.5` y `X-Powered-By: PHP/8.5.3`.

---

## Bloque 1 — Mini-framework MVC ✅

**Objetivo.** Tener Router, Request, Response, Session, Database, Env funcionando, con rutas declarativas en `routes/`.

**Entregado.**
- `app/Core/Env.php`, `Request.php`, `Response.php`, `Session.php`, `Database.php`, `Router.php`, `RouteEntry.php`.
- `app/bootstrap.php` con autoload, dotenv, exception handler global (PDO→503, resto→500), `Session::start()`.
- `routes/web.php`, `routes/api.php`.
- `public/index.php` reescrito como front controller limpio.
- `storage/sessions/`, `storage/logs/`, `storage/cache/`.

**Decisiones aprobadas (vinculantes para bloques siguientes):** ver "Current state" en `CLAUDE.md`.

**Verificación.** `GET /` 200 HTML, `GET /api/health` 200 JSON, sesión persiste con cookie `DAINO_SESSID`, 404/405 con `Allow:`.

---

## Bloque 2 — Persistencia: schema y modelos

**Objetivo.** Tener la base de datos creada con el schema definitivo del doc 04 §5 y los modelos PHP que la consumen.

**Alcance.**
- (Opcional, recomendado al inicio) Invocar el subagente `legacy-explorer` para entender cómo el Daino viejo modelaba `register`, `canciones`, `progreso`, `comentarios`, `ranking` (referencias: `../daino-legacy/` y `docs/legacy/dinohtml-legacy.sql`). Salida esperada: lista de patrones a NO replicar (passwords, ID numéricos expuestos, schema sin FKs, `username` derivable de email, etc.). Útil para no repetir errores en el schema nuevo.
- Migration runner (`scripts/migrate.php`) — ejecutor simple de `database/migrations/*.sql` con tabla `_migrations` para idempotencia.
- Migraciones SQL para las 5 tablas del doc 04 §5: `users`, `levels`, `progress`, `rankings`, `comments`. **`vout_id`** en snake_case. `levels.file_path` nullable + `is_public` con default false (decisión Bloque 7).
- Modelos en `app/Models/`: `User`, `Level`, `Progress`, `Ranking`, `Comment`. Sin ORM — métodos estáticos sobre `Database::getInstance()->prepare(...)`.
- Seeds opcionales en `database/seeds/`.

**Dependencias.** Bloque 1 (necesita `Database::getInstance()` y `Env`).

**Verificación.**
- `composer migrate` (alias en `composer.json`) crea las 5 tablas en MariaDB.
- Test manual: `User::findOrCreateByVoutId('uuid-test', ['username' => 'foo'])` inserta y recupera.
- `SHOW TABLES` lista las 5 + `_migrations`.

**Lo que NO entra aquí.** No hay endpoints aún. Modelos cobran sentido cuando los use el AuthController (Bloque 3) y los Controllers de juego (Bloque 7).

---

## Bloque 3 — Identidad Vout: OAuth2, JWT, iframe bridge

**Objetivo.** Login completo contra Vout (Authorization Code + PKCE), validación local de JWT vía JWKS, y bridge `postMessage` para modo embebido.

**Alcance.**

### Server-side
- `app/Services/VoutAuthService.php` — wrapper sobre `league/oauth2-client` con provider personalizado (doc 07 §E.1). Genera URL de autorización con PKCE `S256`, intercambia `code` por tokens, refresca.
- `app/Services/JwksCache.php` — caché PSR-16 de las claves públicas de Vout (`/oauth/token/keys`), TTL 1h, refresh forzado en `kid` desconocido (doc 07 §E.3).
- `app/Services/JwtVerifier.php` — `lcobucci/jwt` 5.5: valida firma RS256, `iss`, `aud`, `exp` con leeway 60s (doc 07 §E.2).
- `app/Controllers/AuthController.php` — métodos:
  - `login` (genera `state`+`code_verifier` en sesión, redirect a Vout).
  - `callback` (valida `state`, intercambia `code`, valida JWT, busca/crea `User`, **emite cookie de refresh** con el `refresh_token` recibido, guarda el `access_token` en `$_SESSION['access_token']` con su `expires_at`).
  - `refresh` (`POST /auth/refresh`): lee la cookie de refresh, llama a `/oauth/token` de Vout con `grant_type=refresh_token`, rota la cookie con el nuevo refresh_token (Vout las rota — doc 07 §E.5), actualiza `$_SESSION['access_token']`, devuelve el nuevo access_token al cliente vía JSON.
  - `logout` — **decisión: logout solo local** para v1: destruye sesión + invalida cookie de refresh. Razón: integration-guide.md no documenta endpoint de revocación (`/oauth/revoke`); el access_token expira de forma natural a los 60 min (default Vout). Si Vout añade revoke en el futuro, se invoca desde aquí.
- `app/Middleware/AuthMiddleware.php` — exige Bearer válido en rutas API; redirect a `/auth/login` en rutas web.
- `app/Middleware/CsrfMiddleware.php` — auto en POST/PUT/PATCH/DELETE de rutas web.
- Rutas: `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `POST /auth/refresh`, `GET /api/me/token`.

### Modelo de cookie de refresh token

| Atributo | Valor |
|---|---|
| Nombre | `daino_refresh` |
| `HttpOnly` | sí (no accesible desde JS) |
| `Secure` | sí en `APP_ENV != local` (HTTPS obligatorio en prod) |
| `SameSite` | `Lax` (permite navegación cross-site GET pero no POST cross-site) |
| `Path` | `/auth/refresh` (única ruta que la consume) — minimiza la superficie |
| `Max-Age` | 30 días (matchea TTL del refresh token de Vout, integration-guide.md §"Refresh Tokens") |
| Contenido | El refresh_token tal cual lo emite Vout (string opaco). Si en el futuro se persiste en BD para rotación cruzada, **cifrar en reposo** (doc 07 §E.5). |

### Entrega del Access Token al frontend (modo standalone)

**Decisión: endpoint `GET /api/me/token`**, no meta tag.

- El controller exige sesión válida (cookie de sesión `DAINO_SESSID`); devuelve `{ access_token, expires_at }` en JSON.
- El frontend lo llama una vez al cargar la SPA (después de login, o al refrescar la pestaña). Mantiene el token **solo en memoria del tab** (variable JS, nunca `localStorage` ni `sessionStorage`).
- Cuando el access_token expira (o el servidor responde 401 a una llamada API), el frontend dispara `POST /auth/refresh`, recibe el nuevo access_token y lo guarda en memoria.
- En modo embebido (iframe): este endpoint NO se usa. El token llega vía `postMessage AUTH_TOKEN` desde el parent Vout.

Razones por las que `/api/me/token` gana sobre `<meta>` tag:
- El token no aparece en el HTML source (menos exposición a screen capture / extensiones / historial).
- Sobrevive a refrescos del shell sin tener que rerenderizar HTML server-side.
- Misma API entre standalone y "tras refresh exitoso" — un solo lugar donde leer el token.

### Client-side (mínimo)
- `resources/js/iframe/bridge.js` — handshake `READY`→`AUTH_TOKEN`, validación de `event.origin` contra `VOUT_ORIGIN` (nunca `"*"`), recepción de `GAME_ACTION` (stub: solo log por ahora; el wiring real al juego ocurre en Bloque 5).

**Dependencias.** Bloque 1 (Router/Session/Env), Bloque 2 (`User::findOrCreateByVoutId`).

**Restricciones (no negociables — invariantes del CLAUDE.md):**
- `code_verifier` y `state` viven SOLO en `$_SESSION`.
- Tokens NUNCA en URL params, query strings ni `localStorage`.
- `targetOrigin: "*"` está prohibido.
- `firebase/php-jwt` está prohibido — solo `lcobucci/jwt`.

**Verificación.**
- Flujo manual: `GET /auth/login` → redirige a Vout (mock o real) → callback → sesión iniciada con `vout_id`.
- Auditoría con el subagente `vout-oauth-auditor` antes de cerrar el bloque — debe reportar 0 hallazgos críticos/altos.
- `JwksCache` cachea en `storage/cache/jwks.json` y refresca solo cuando expira o ante `kid` desconocido.

**Limitaciones conocidas — diferidas a bloques posteriores:**
- **Cookie `daino_refresh` con `SameSite=Lax` no llega en modo iframe (cross-site).** Para el flujo embebido en Vout, el refresh lo orquesta el parent vía `postMessage AUTH_TOKEN` cuando el access_token expira; `daino_refresh` solo aplica a standalone. Cuando se cablée el bridge real con el motor (Bloque 5/6), evaluar si tiene sentido emitir `SameSite=None; Secure` condicionalmente al detectar modo embebido.
- **`/auth/login` no es idempotente entre pestañas.** Abrir /auth/login en dos pestañas hace que la segunda sobrescriba la `daino_oauth_pkce`. La primera, al volver del callback, verá una validación HMAC fallida → redirect transparente a `/auth/login` (gracias a Sub-bloque 3.5). Si la UX lo pide, server-side cache `{state → verifier}` con TTL en Bloque 6.

---

## Sub-bloque 3.5 — Auth resilience

> **Disparador.** Tras una semana sin tocar el proyecto, retomar y entrar a `/auth/login` daba "Sesión OAuth expirada — vuelve a /auth/login" en el callback. Causa raíz: combinación de cookie `DAINO_SESSID` stale + `session.use_strict_mode=1` rotando el SID + lifetime de sesión corto (2h) + `oauth_state`/`oauth_code_verifier` viviendo en `$_SESSION`. Bug arquitectónico mío, confirmado en BD de Vout (3 `oauth_auth_codes` con `revoked=0` huérfanos = Daino jamás llamó a `/oauth/token`).

**Objetivo.** Que retomar el proyecto después de días o semanas funcione sin "rituales" (limpiar cookies, borrar session files, reiniciar containers). Senior-level resilience.

**Entregado.**
- `app/Services/PkceCookie.php` — cookie corta y firmada que transporta `state`+`code_verifier` entre `/auth/login` y `/auth/callback`. HMAC-SHA256 con `APP_KEY`. Path `/auth`, `Max-Age=600`, `HttpOnly`, `SameSite=Lax`, `Secure`-en-prod. One-shot: `consume()` borra la cookie aunque la firma sea inválida (anti-replay).
- `APP_KEY` en `.env`/`.env.example`. Base64 de 32 bytes. Documentado cómo regenerarla.
- `SESSION_LIFETIME_MIN`: 120 → 43200 (30 días). Matchea TTL del refresh_token de Vout.
- `AuthController::callback`: usa `PkceCookie::consume`. Si falta cookie / firma rota / falta code-state → **redirect transparente a `/auth/login`** en lugar de "Sesión expirada" hostil.
- `AuthController::refresh`: catch específico de `IdentityProviderException` con `error=invalid_grant` (refresh revocado por el user en Vout `/settings/connected-apps` o caducado a 30 días). Devuelve `{error: session_expired, redirect_to: /auth/login}` para que el frontend redirija.
- `scripts/clean-sessions.php` + `composer clean:sessions` — limpia archivos de sesión más viejos que `SESSION_LIFETIME_MIN`. Flag `--all` para wipe completo.

**Decisiones aprobadas:**
- HMAC sign, no encrypt: el `code_verifier` no es secreto en sí (32 bytes random), solo unguessable para un atacante externo. Lo único que necesitamos es integridad (que no se forge la cookie). HMAC con APP_KEY suficiente; encriptar añade coste sin valor extra.
- Path=/auth (no `/auth/login` específico): la cookie debe ser legible por `/auth/callback` también, ambos comparten prefix.
- Sin `__Host-` prefix por ahora: requiere `Secure` que requiere HTTPS, en local trabajamos HTTP. Bloque 8 cuando haya HTTPS prod.
- file driver de sesión: una vez que sacamos PKCE de `$_SESSION`, el driver de archivos es perfectamente robusto. Cambiar a BD/Redis es premature optimization.

**Verificación:**
- 9/9 tests unit `PkceCookie` (set, consume, HMAC tampering, cookies malformadas, casos vacíos).
- 5/5 tests del path `invalid_grant` de `refresh` (mock `GenericProvider` lanzando `IdentityProviderException` real).
- HTTP smoke: `/auth/login` emite `daino_oauth_pkce` con todos los attrs (Path=/auth, Max-Age=600, HttpOnly, SameSite=Lax). State en cookie matchea state en URL Vout. `DAINO_SESSID` con `Max-Age=2592000` (30 días).
- HTTP smoke: `/auth/callback` sin cookie → 302 a `/auth/login`. Con HMAC roto → 302 a `/auth/login`. Con `?error=access_denied` → cancel page bonito sigue funcionando.
- `composer clean:sessions` borra 0 archivos cuando todos están dentro del lifetime; `--all` borra todo.

---

## Bloque 4 — Frontend foundation: PixiJS + audio + shader ✅

> **Cerrado.** Ver `CLAUDE.md` § "Bloque 4 (frontend foundation) — completo" para la lista exhaustiva de archivos creados, decisiones y limitaciones.
>
> **Disparador de decisión arquitectónica:** durante el bloque se aclaró con el user que **Daino se juega sin login obligatorio**. Login (vía Vout) solo desbloquea features secundarias (submit ranking global, comentar, subir MP3 público). Eso obliga a:
> - `/` queda **pública** (sin AuthMiddleware).
> - Bloque 7 aplicará AuthMiddleware solo a los endpoints API que requieran identidad — no a los de "leer/jugar".
> - `CLAUDE.md` actualizado con esta decisión vinculante.
>
> **Bundler ya alineado.** El proyecto corre Vite 8.0.10 + `@tailwindcss/vite` 4.2.4 + Tailwind 4.2.4 desde el Bloque 0; `bun run build` produce manifest válido. La gotcha de doc 07 §A.4 / §H.1 está superada — no hay spike pendiente. Si en algún bump futuro vuelven los peer-dep warnings, esta es la nota a revisar.

**Objetivo.** Tener el canvas único a full-viewport con shader audio-reactivo de fondo, `AudioEngine` operativo y MP3 drag&drop funcional. Sin gameplay todavía.

**Alcance.**
- `app/Core/View.php` — render de plantillas PHP en `app/Views/` (la decisión §3.17 del plan del Bloque 1 lo aplazó hasta aquí).
- `app/Views/layouts/main.php` — shell HTML con `<canvas>`, meta tags, `ViteAssets::render()`.
- `app/Controllers/HomeController.php` — devuelve la shell. Ruta `GET /`.
- `resources/js/main.js` — entry point: detecta modo (standalone vs iframe), arranca `engine.js`.
- `resources/js/game/engine.js` — `new Application(); await app.init({ resizeTo: window, autoDensity: true, resolution: devicePixelRatio })` (doc 07 §A.3). Canvas `100vw × 100vh` (doc 06 §8). Apila `RenderLayers`: fondo (shader), gameplay (vacío), partículas (vacío), HUD.
- `resources/js/game/entities/ParticleLayer.js` — **construir invocando el subagente `pixi-component-builder`** (`ParticleContainer` de PixiJS v8, partículas ambientales moduladas por `uRMS` del audio). El stub en este bloque puede ser solo el contenedor vacío; el comportamiento reactivo se afina cuando exista AudioEngine real.
- `resources/js/game/audio/AudioEngine.js` — `AudioContext`, `AnalyserNode` con `fftSize: 2048`, `smoothingTimeConstant: 0.82`, `minDecibels: -100`, `maxDecibels: -30` (doc 07 §D.1). Maneja `audioContext.onstatechange` (doc 07 §C.3) — pausa el loop si `suspended`.
- `resources/js/game/shaders/background.frag` — fragment shader que lee FFT como `sampler2D uAudioTexture` (doc 07 §D.2), no como uniforms individuales. Uniforms: `uTime`, `uRMS`, `uBass`, `uMid`, `uHigh`, `uBpmPulse`.
- `resources/js/ui/upload.js` — drag&drop de MP3, `FileReader` + `decodeAudioData`. Validación MIME `audio/mpeg` y tamaño máximo (`UPLOAD_MAX_SIZE_MB`).
- `prefers-reduced-motion`: si activo, shader cae a degradado estático (doc 06 §6, doc 07 §C.4).

**Dependencias.** Bloque 1 (rutas web).

**Verificación.**
- Suelta un MP3 → arranca el shader sincronizado al audio (visible en pantalla completa, ocupando todo el viewport).
- Cambiar pestaña pausa el `AudioContext` y el shader congela; volver a la pestaña reanuda.
- Activar `prefers-reduced-motion` en el navegador → fondo cae a degradado estático.
- Lighthouse Performance > 80 en este estado mínimo.
- **Medir el bundle gzipped** tras `bun run build` (`du -sh public/build/assets/*.js | sort -h`, o `rollup-plugin-visualizer`). Si el JS principal supera **200 KB gzipped en este punto** (sin juego ni UI todavía), abrir investigación de tree-shaking de PixiJS antes de seguir al Bloque 5 — importar solo subpaquetes necesarios (`pixi.js/scene`, `pixi.js/filters`, etc.) en vez del barrel principal.

**Lo que NO entra aquí.** Sin Dino, sin obstáculos, sin HUD interactivo.

---

## Bloque 5 — Game core: entidades, físicas, input, spawner ✅

> **Cerrado.** Ver `CLAUDE.md` § "Bloque 5 (game core) — completo" para la lista exhaustiva de archivos creados, decisiones y limitaciones.

**Objetivo.** Que el Dino salte sobre obstáculos en respuesta al audio, en standalone (teclado/touch) y en iframe (`GAME_ACTION` desde Vout).

**Alcance.**
- `resources/js/game/entities/Dino.js`, `Obstacle.js`, `Cloud.js` (`ParticleLayer.js` ya stub del Bloque 4 — aquí se afina). **Cada uno se construye en su propia invocación al subagente `pixi-component-builder`** (PixiJS v8 estricto, ES Modules, sin dependencias nuevas sin permiso). Una entidad por turno; no se atajan varias en el mismo prompt.
- `resources/js/game/systems/physics.js` — AABB collisions (doc 02 §1, doc 04 §2).
- `resources/js/game/systems/input.js` — teclado (`Space` = saltar, `↓` = agachar), touch (mitad izq = saltar, mitad der = agachar), y consumir `GAME_ACTION` del bridge del Bloque 3.
- `resources/js/game/levels/LevelGenerator.js` — **precomputa la secuencia completa del nivel ANTES del start.** Analiza el `AudioBuffer` ya decodificado (Spectral Flux + onsets de baja/alta frecuencia, doc 07 §D.3) y produce una `ObstacleTimeline` (lista ordenada `[{tAt, kind, lane, ...}]`). Determinista: mismo MP3 + mismo seed → misma timeline.
- `resources/js/game/levels/Seed.js` — PRNG seeded (xorshift32 o similar). Cualquier elección estocástica (qué obstáculo de un set candidato, jitter dentro de una ventana) usa este PRNG.
- `resources/js/game/systems/spawner.js` — **NO analiza audio en runtime.** Es un cursor sobre la `ObstacleTimeline` precomputada: en cada tick del ticker, instancia los obstáculos cuyo `tAt` ya cruzó el tiempo actual de reproducción. Cero CPU de análisis durante el gameplay.
- `resources/js/game/config.js` — constantes (gravedad, velocidades, thresholds).
- HUD básico con `BitmapText` (doc 07 §A.3 🚨): score y barra de progreso.

**Dependencias.** Bloques 3 y 4 (bridge para `GAME_ACTION`, AudioEngine para feeding).

**Verificación.**
- Carga MP3 → arranca nivel → Dino salta (Space/touch/`GAME_ACTION`) → choca → game over.
- **Mismo (MP3, seed) produce la misma `ObstacleTimeline`** entre dos ejecuciones (precomputada antes del start, no derivada en runtime).
- El `spawner` no llama al `AudioEngine` en runtime — solo lee la timeline. Confirmable inspeccionando que no haya `import` del AudioEngine en `spawner.js`.
- HUD score actualiza a 60fps sin bajada de FPS (`BitmapText` cumple).

---

## Bloque 6 — UI / HUD / API client / modos ✅

> **Cerrado.** Ver `CLAUDE.md` § "Bloque 6 — completo" para la lista exhaustiva de archivos creados, decisiones y limitaciones.

**Objetivo.** Pulir la experiencia: menú principal, modales slide-in (ranking, perfil), API client con Bearer, estado de sesión visible.

**Alcance.**
- `resources/js/ui/menu.js` — modo "no jugando" (doc 06 §4.1): título DAINO, lista vertical de acciones, avatar+username arriba derecha.
- `resources/js/ui/hud.js` — HUD durante la partida (doc 06 §4.2): score arriba izq, progreso arriba centro, song info arriba der, avatar abajo izq.
- `resources/js/ui/modals.js` — slide-in panels para ranking, perfil, settings. **Enfoque vanilla:** elemento nativo `<dialog>` (HTML5, focus trap automático, cierre con `Esc`) + ARIA hand-rolled donde haga falta (`role="dialog"`, `aria-labelledby`, `aria-modal="true"`). Animaciones CSS, no JS. **No se usa la librería "Headless UI"** que mencionaba doc 07 §C.2 — es solo React/Vue, incompatible con el invariante "Vanilla JS, no framework" del CLAUDE.md. Si más adelante necesitamos primitivas accesibles que `<dialog>` no cubre, evaluar `a11y-dialog` (vanilla, ~3KB) antes que cualquier librería con framework.
- `resources/js/ui/auth.js` — refleja estado de sesión en UI.
- `resources/js/api/client.js` — `fetch` wrapper con Bearer token, refresh automático en 401 (redirige a `/auth/login` si refresh falla).
- Pausa con `ESC` → overlay semitransparente (doc 06 §4.2).
- Transiciones menú→juego con fade negro 300ms (doc 06 §4.3).

**Dependencias.** Bloques 3 (auth), 5 (juego para mostrar HUD).

**Verificación.**
- Modo menú: lista de acciones funcional, avatar muestra usuario logueado.
- Click en "RANKING" → slide-in panel muestra placeholder (los datos reales vienen del Bloque 7).
- Pulsar "JUGAR" → fade + arranca el juego del Bloque 5.
- `ESC` durante partida pausa el juego con overlay.

---

## Bloque 7 — Persistencia API

**Objetivo.** Endpoints JSON para guardar progreso, leer ranking, CRUD de niveles y comentarios.

**Alcance.**
- `app/Controllers/Api/ProgressApiController.php` — `POST /api/progress` guarda partida (`Progress::upsert`), trigger recálculo de `Ranking`.
- `app/Controllers/Api/RankingApiController.php` — `GET /api/ranking` (top N).
- `app/Controllers/Api/LevelApiController.php` — `POST /api/levels` (guarda **solo metadata** del nivel: `title`, `artist`, `duration_sec`, `bpm`, `difficulty`, `generator_seed`, `is_public=false`). `POST /api/levels/{id}/upload` (sube el MP3 físico — solo se permite si el dueño marca `is_public=true`). `POST /api/levels/{id}/visibility` (publica/despublica). `GET /api/levels/{id}`, `GET /api/levels?mine=1`, `GET /api/levels?public=1`.
- `app/Controllers/Api/CommentApiController.php` — `POST /api/comments`, `GET /api/comments?level_id={id}`.
- `app/Middleware/CorsMiddleware.php` — restrictivo (solo dominio Vout y origen propio).
- Validación MIME `audio/mpeg` y tamaño en upload de niveles (doc 04 §8).
- `storage/uploads/` fuera del docroot, servido vía endpoint controlado.

**Modelo de subida de MP3 (decisión vinculante para Bloque 2).**
- **Por defecto Local-First**: al guardar un nivel privado, NO se sube el MP3. Solo metadata + `generator_seed`. El nivel solo se puede jugar localmente porque la `ObstacleTimeline` (Bloque 5) se regenera del MP3 + seed cada vez.
- **Solo si el usuario explícitamente clica "Compartir nivel"** (publica → `is_public=true`), entonces SÍ se sube el MP3 a `storage/uploads/{user_id}/{level_id}.mp3` para que otros usuarios puedan jugar el nivel sin tener el archivo. Antes del upload: validar MIME (`audio/mpeg`), tamaño (`UPLOAD_MAX_SIZE_MB`), y que el dueño no tenga ya un nivel público con el mismo `title+artist` (anti-spam).
- **Implicación para el schema (Bloque 2):** la columna `levels.file_path` debe ser **NULLABLE** y `levels.is_public` debe defaultear a `FALSE`. Esto ya lo dice doc 04 §5; el Bloque 2 debe respetarlo y añadir un `CHECK` (o trigger en MariaDB) que impida `is_public=TRUE AND file_path IS NULL`.

**Dependencias.** Bloques 2 (modelos), 3 (`AuthMiddleware` con Bearer), 6 (cliente JS para llamarlos).

**Verificación.**
- Tras game over: `POST /api/progress` registra y `GET /api/ranking` lo refleja.
- Subir nivel: aparece en `GET /api/levels?mine=1`.
- Comentario en nivel: aparece en `GET /api/comments?level_id={id}` y respeta `is_visible`.

> **Cerrado.** Ver `CLAUDE.md` § "Bloque 7 — completo" para la lista exhaustiva de archivos creados, decisiones y limitaciones diferidas.

---

## Bloque 8 — Hardening: testing, calidad, seguridad

**Objetivo.** Estado "production-ready" con cobertura mínima, análisis estático y políticas de seguridad.

**Alcance.**
- `phpstan.neon` con `level: 8`. **Bajamos respecto al doc 07 §F.1 (que recomienda level 9)** porque level 9 obliga a anotar todos los `mixed` y bloquea null implícitos a tipos no nulables — overhead alto en un proyecto pequeño con código nuevo cuyo coverage manual ya cubre lo crítico. Level 8 captura el 95% de bugs con 60% del esfuerzo de tipado. Si el proyecto crece o se externaliza el desarrollo, subir a 9 con baseline.
- `tests/` con Pest v4 (doc 07 §F.2). Tests críticos:
  - `Architecture`: ningún Controller toca `$_POST` directo (debe ir vía `Request`).
  - `Unit`: `JwtVerifier`, `JwksCache`, `Env`, `Session::csrfToken/validateCsrf`.
  - `Integration`: flujo completo OAuth contra mock de Vout.
- CSP estricto en `nginx.conf` o headers en `Response`. `frame-ancestors` para Vout cuando aplique modo embebido.
- Bundle budget con `rollup-plugin-visualizer` — alerta si total > 250 KB gzipped (doc 07 §F.3).
- `CullerPlugin` de PixiJS para no renderizar obstáculos fuera de viewport (doc 07 §A.3) en niveles largos.
- Audit del subagente `vout-oauth-auditor` final — 0 hallazgos críticos/altos.
- Documentación de despliegue: cómo promover `rewrite/v2` a `main` (doc 04 §9.1, opción A).

**Dependencias.** Todos los anteriores.

**Verificación.**
- `composer analyse` (PHPStan 9) sin errores.
- `pest` todos verde, incluyendo arquitectura.
- Lighthouse en producción ≥ 90 en Performance, Accessibility, Best Practices.
- Bundle gzipped ≤ 250 KB.

---

## Cómo cierra cada bloque

1. Smoke test ejecutado y pasado.
2. Smoke tests temporales del bloque borrados.
3. Sección "Current state" del `CLAUDE.md` actualizada con: archivos creados, decisiones tomadas, estado del bloque.
4. **Actualizar `.env.example`** con cualquier variable de entorno nueva introducida en el bloque (con valor placeholder, no real). El archivo `.env` real (gitignored) se ajusta en paralelo.
5. **Commit obligatorio** en la rama `rewrite/v2` con mensaje formato `chore: bloque N — <título>`. Sin commit no se considera cerrado el bloque (deja punto de retorno y trazabilidad).
6. Marcar el bloque como ✅ en este doc.

---

## Mapeo a la numeración antigua del doc 03

| Bloque | Doc 03 (fases) |
|--------|----------------|
| 0, 1, 2 | Inicio de Fase 2 (refactor backend) |
| 3 | Final de Fase 2 (auth con Vout) |
| 4, 5, 6 | Fase 3 (refactor frontend) |
| 7 | Solapa Fase 2 (endpoints) y Fase 3 (cliente JS) |
| 8 | Sin equivalente en doc 03 — endurecimiento añadido en este plan |

El doc 03 sigue siendo útil para entender la motivación de cada paso, pero **la numeración operativa es la de este doc**.
