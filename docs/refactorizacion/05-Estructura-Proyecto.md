# Estructura del Proyecto — Nuevo Daino

> Layout de carpetas propuesto para la refactorización completa. Inspirado en Laravel pero implementado en PHP puro, pensado para escalar sin llegar a ser un framework completo.

---

## Árbol de carpetas propuesto

```
daino/
├── CLAUDE.md                       # Guía para Claude Code
├── README.md                       # Intro del proyecto (pendiente de crear)
├── .gitignore
├── .env.example                    # Plantilla vars de entorno
├── .env                            # (gitignored) Credenciales locales
│
├── docker-compose.yml              # Orquestación local
├── docker/
│   ├── php/
│   │   └── Dockerfile              # FROM php:8.5.3-fpm-alpine — pineado para matchear Vout
│   └── nginx/
│       ├── Dockerfile
│       └── default.conf            # server block para public/
│
├── composer.json                   # lcobucci/jwt, vlucas/phpdotenv, league/oauth2-client
├── composer.lock
├── package.json                    # vite, pixi.js, @pixi/particle-emitter, tailwindcss, meyda
├── package-lock.json
├── vite.config.js                  # Output a public/build/
├── tailwind.config.js              # (solo si hace falta; v4 puede ser zero-config)
│
├── public/                         # DOCROOT — lo único servido por Nginx
│   ├── index.php                   # Front controller (único entry PHP)
│   ├── favicon.ico
│   ├── robots.txt
│   └── build/                      # (gitignored) Output de Vite
│
├── app/                            # Código PHP del backend
│   ├── Core/                       # Infra compartida (mini-framework propio)
│   │   ├── Router.php              # Despacho de rutas
│   │   ├── Request.php             # Wrapper de $_SERVER, $_GET, $_POST, body JSON
│   │   ├── Response.php            # Helpers JSON/HTML/redirect
│   │   ├── Database.php            # Singleton PDO
│   │   ├── Session.php             # Wrapper $_SESSION con CSRF
│   │   ├── Env.php                 # Accesor tipado de phpdotenv
│   │   └── View.php                # Render de plantillas PHP en Views/
│   │
│   ├── Controllers/
│   │   ├── HomeController.php      # Landing, catálogo
│   │   ├── AuthController.php      # Login via Vout, callback, logout
│   │   ├── GameController.php      # Pantalla del juego, cargar MP3
│   │   ├── LevelController.php     # CRUD de niveles guardados
│   │   ├── ProgressController.php  # Guardar progreso tras partida
│   │   ├── RankingController.php   # Ranking global
│   │   ├── CommentController.php   # Comentarios
│   │   └── Api/
│   │       ├── ProgressApiController.php   # JSON endpoints
│   │       ├── LevelApiController.php
│   │       └── RankingApiController.php
│   │
│   ├── Services/
│   │   ├── VoutAuthService.php     # OAuth2 flow (authorize URL, exchange code, refresh)
│   │   ├── JwtVerifier.php         # Valida JWT con lcobucci/jwt y JWKS
│   │   ├── JwksCache.php           # Cacheo de /oauth/jwks
│   │   └── LevelGenerator.php      # (Opcional backend) — generación del seed
│   │
│   ├── Middleware/
│   │   ├── AuthMiddleware.php      # Exige JWT válido o sesión con vout_id
│   │   ├── CsrfMiddleware.php
│   │   └── CorsMiddleware.php
│   │
│   ├── Models/
│   │   ├── User.php                # Active record / Data Mapper ligero
│   │   ├── Level.php
│   │   ├── Progress.php
│   │   ├── Ranking.php
│   │   └── Comment.php
│   │
│   ├── Views/                      # Templates PHP (no Blade)
│   │   ├── layouts/
│   │   │   ├── main.php
│   │   │   └── game.php
│   │   ├── partials/
│   │   │   ├── nav.php
│   │   │   └── footer.php
│   │   └── pages/
│   │       ├── home.php
│   │       ├── login.php
│   │       ├── play.php
│   │       ├── ranking.php
│   │       └── profile.php
│   │
│   └── bootstrap.php               # require autoloader, carga .env, inicializa Router
│
├── routes/
│   ├── web.php                     # Rutas HTML (GET/POST)
│   └── api.php                     # Rutas JSON (/api/*)
│
├── resources/                      # FUENTES frontend (compiladas por Vite)
│   ├── js/
│   │   ├── main.js                 # Entry — decide si cargar game vs. páginas estáticas
│   │   │
│   │   ├── game/
│   │   │   ├── engine.js           # PIXI.Application, ticker, loop principal
│   │   │   ├── entities/
│   │   │   │   ├── Dino.js
│   │   │   │   ├── Obstacle.js
│   │   │   │   ├── Cloud.js
│   │   │   │   └── ParticleLayer.js
│   │   │   ├── systems/
│   │   │   │   ├── physics.js      # AABB collisions
│   │   │   │   ├── input.js        # Teclado + touch + postMessage desde Vout
│   │   │   │   └── spawner.js      # Genera obstáculos según análisis
│   │   │   ├── audio/
│   │   │   │   ├── AudioEngine.js  # AudioContext + AnalyserNode
│   │   │   │   ├── bpm.js          # Detección de BPM (meyda o custom)
│   │   │   │   └── features.js     # Extracción de picos, RMS, etc.
│   │   │   ├── shaders/
│   │   │   │   ├── background.frag # Fondo reactivo al audio
│   │   │   │   └── glow.frag
│   │   │   ├── levels/
│   │   │   │   ├── LevelGenerator.js   # Dado un MP3 → sequence de obstáculos
│   │   │   │   └── Seed.js             # Deterministic PRNG
│   │   │   └── config.js           # Constantes: gravity, speeds, thresholds
│   │   │
│   │   ├── ui/
│   │   │   ├── ranking.js
│   │   │   ├── hud.js              # Score, progress bar, game over
│   │   │   ├── auth.js             # Estado de sesión UI
│   │   │   ├── comments.js
│   │   │   └── upload.js           # Drag & drop de MP3
│   │   │
│   │   ├── api/
│   │   │   └── client.js           # fetch wrapper con Bearer token
│   │   │
│   │   └── iframe/
│   │       └── bridge.js           # postMessage con Vout (handshake READY + GAME_ACTION)
│   │
│   └── css/
│       └── main.css                # @import "tailwindcss";
│
├── database/
│   ├── migrations/
│   │   ├── 001_create_users_table.sql
│   │   ├── 002_create_levels_table.sql
│   │   ├── 003_create_progress_table.sql
│   │   ├── 004_create_rankings_table.sql
│   │   └── 005_create_comments_table.sql
│   └── seeds/
│       └── demo_user.sql           # (opcional) datos de prueba
│
├── storage/
│   ├── uploads/                    # (gitignored) MP3s subidos por usuarios
│   ├── logs/                       # (gitignored)
│   └── cache/
│       └── jwks.json               # (gitignored) cache de claves públicas de Vout
│
├── tests/                          # (futuro) PHPUnit / Pest
│
├── scripts/
│   ├── migrate.php                 # Ejecutor simple de migrations/*.sql
│   └── seed.php
│
└── docs/                           # YA EXISTE — docs actuales
    ├── refactorizacion/
    ├── vout-integration/
    └── legacy/
```

---

## Principios de diseño

### 1. Un único docroot: `public/`

Nginx solo sirve `public/`. Todo lo demás (`app/`, `resources/`, `storage/`, `database/`, `.env`) queda **fuera del alcance HTTP**. Esto evita exposiciones accidentales de código fuente, `.env`, SQL o MP3 subidos.

### 2. Separación `app/` vs `resources/`

- `app/` = PHP server-side (ejecutado en cada request).
- `resources/` = fuente JS/CSS que Vite compila y deposita en `public/build/`.

Vite nunca lee `app/` y PHP nunca lee `resources/`. Están físicamente separados para que la capa de build sea predecible.

### 3. Router propio minimalista

No introducir FastRoute ni nada externo todavía. El router propio del Daino viejo funcionaba. Lo reescribimos con matching simple (`GET /levels/:id`), middleware chain, y dispatch a `Controller@method`. ~150 líneas.

### 4. MVC sin Eloquent

Los `Models/` son clases con métodos estáticos o factories (`User::find($id)`, `User::create([...])`) que usan `Database::getInstance()->prepare(...)`. Sin ORM. Si un query se repite, extraer a método del modelo. Si un query es complejo, crear Service.

### 5. Services separan lógica de negocio

Los controllers deben ser **finos**: recibir request, delegar a Service, renderizar response. Toda la lógica OAuth (`VoutAuthService`) y la validación JWT (`JwtVerifier`) vive en `Services/`.

### 6. Rutas declarativas en `routes/web.php` y `routes/api.php`

Separar web (devuelve HTML con CSRF + sesión) de API (devuelve JSON con Bearer token). Mismo router, diferentes middleware.

---

## Flujos clave diagramados

### Flujo de login vía Vout

```
Usuario → [GET /login] → AuthController::showLogin → redirect a
→ https://vout.example.com/oauth/authorize?client_id=...&code_challenge=...&state=...

Vout autentica → redirect a
→ [GET /auth/callback?code=...&state=...] → AuthController::callback
   1. Verifica state (CSRF)
   2. POST /oauth/token con code + code_verifier
   3. Recibe access_token (JWT) + refresh_token
   4. JwtVerifier valida firma (JWKS cache), iss, aud, exp
   5. GET /api/v1/user/me con Bearer
   6. User::findOrCreateByVoutId(data)
   7. Session: user_id + access_token en memoria
   → redirect a /
```

### Flujo de partida

```
1. Usuario entra a /play
2. UI muestra drag & drop para MP3
3. Usuario suelta un .mp3 → FileReader → ArrayBuffer
4. AudioEngine lo decodifica con AudioContext.decodeAudioData
5. LevelGenerator analiza: duración, BPM, picos → genera seed de obstáculos
6. PIXI.Application arranca, ticker corre a 60fps
7. AnalyserNode alimenta shader de fondo en tiempo real
8. Game over → ProgressApiController::save (POST /api/progress)
9. RankingController recalcula agregado
```

### Flujo de iframe (cuando Daino corre dentro de Vout)

```
Daino carga → detecta window.self !== window.top
            → postMessage({type:"READY"}, VOUT_ORIGIN) hacia parent
Vout responde → postMessage({type:"AUTH_TOKEN", token:...}, DAINO_ORIGIN)
Daino → apiClient.setToken(token)
Vout (frames faciales) → postMessage({type:"GAME_ACTION", payload:"JUMP"}, DAINO_ORIGIN)
Daino → input.js traduce a acción del juego
```

---

## Variables de entorno (`.env.example`)

```bash
# App
APP_ENV=local
APP_URL=http://localhost:8080
APP_KEY=                                # random 32 bytes base64

# Base de datos
DB_HOST=mariadb
DB_PORT=3306
DB_DATABASE=daino
DB_USER=daino
DB_PASSWORD=secret

# Vout / OAuth2
VOUT_ISSUER=https://vout.example.com
VOUT_AUTHORIZE_URL=https://vout.example.com/oauth/authorize
VOUT_TOKEN_URL=https://vout.example.com/oauth/token
VOUT_JWKS_URL=https://vout.example.com/oauth/jwks
VOUT_USERINFO_URL=https://vout.example.com/api/v1/user/me
VOUT_CLIENT_ID=                         # UUID entregado por Vout
VOUT_CLIENT_SECRET=                     # opcional, solo si el cliente es confidential
VOUT_REDIRECT_URI=http://localhost:8080/auth/callback
VOUT_SCOPES="user:read"
VOUT_ORIGIN=https://vout.example.com    # para validación postMessage

# Uploads
UPLOAD_MAX_SIZE_MB=10
UPLOAD_ALLOWED_MIME=audio/mpeg
```

---

## Qué NO se incluye (decisiones explícitas de omisión)

- ❌ **p5.js** — reemplazado por Web Audio API + PixiJS.
- ❌ **jQuery / Bootstrap** — solo Tailwind y JS vanilla.
- ❌ **Eloquent / Doctrine** — PDO directo.
- ❌ **Laravel Sail** — esto no es Laravel. Docker Compose manual.
- ❌ **Nodemon / Gulp** — Vite cubre el pipeline completo.
- ❌ **MediaPipe en Daino** — corre en Vout. Daino solo recibe `GAME_ACTION` vía postMessage.
- ❌ **Autenticación local** — sin registro, sin password reset, sin "Entrar con Google". Todo va por Vout.

---

## Siguiente paso

Una vez confirmada esta estructura por el usuario, el plan de scaffolding sería:

1. Crear `docker-compose.yml` + `docker/php/Dockerfile` + `docker/nginx/default.conf`.
2. `composer init` + instalar dependencias PHP.
3. `npm init` + instalar dependencias JS.
4. Crear `app/Core/*` (Router, Database, Request, Response, Env, Session).
5. Crear `public/index.php` front controller.
6. Primera ruta de prueba + primer template para validar que el pipeline funciona.
7. Migraciones básicas y `scripts/migrate.php`.
8. A partir de ahí, seguir el orden de Fases 2 y 3 del doc 03 (adaptadas).
