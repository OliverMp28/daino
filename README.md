# Daino

Side-scroller web audio-reactivo: **cada nivel es una canción**. La duración del MP3 define la longitud del nivel y el BPM/intensidad modula la dificultad y un fondo reactivo que cubre toda la ventana. Inspiración: Piano Tiles, Geometry Dash.

> Este repo aloja la **rewrite v2**. El código del Daino original vive en la rama [`legacy`](https://github.com/OliverMp28/daino/tree/legacy).

## Stack

| Capa | Tecnología |
|------|------------|
| Runtime backend | PHP 8.5.13 (pineado, Alpine) + PDO |
| Servidor web | Nginx 1.30.7 |
| Base de datos | MariaDB 11.4 |
| Identidad | OAuth2 (Authorization Code + PKCE) contra el IdP **Vout** — sin login local |
| Build frontend | Vite 8 + Tailwind v4 (`@tailwindcss/vite`) |
| Motor de juego | PixiJS v8 (WebGL/WebGPU) |
| Audio | Web Audio API nativa (+ Meyda si hace falta BPM avanzado) |
| Package manager | **Bun** (`bun install`, `bun run dev`, `bun run build`) |
| Orquestación local | Docker Compose |

Las decisiones detalladas (por qué sin framework, por qué no p5.js, UX game-like, etc.) están en `docs/refactorizacion/`. Lee primero `00-LEEME-PRIMERO.md`.

## Arrancar en local

Necesitas: **Docker Desktop**, **Bun ≥ 1.2** (recomendado 1.3+).

```bash
# 1. Clonar y entrar
git clone -b rewrite/v2 https://github.com/OliverMp28/daino.git
cd daino

# 2. Configurar entorno
cp .env.example .env
# Edita .env con tus credenciales de Vout (VOUT_CLIENT_ID, VOUT_CLIENT_SECRET si aplica)

# 3. Levantar backend (PHP + Nginx + MariaDB)
docker compose up -d

# 4. Instalar dependencias frontend con Bun
bun install

# 5. Arrancar Vite dev server con HMR (corre en el host, no en Docker)
bun run dev
```

Abrir `http://localhost:8080` en el navegador (o el puerto que pongas en `APP_PORT` del `.env`). Para entrar con una cuenta hace falta Vout corriendo en local: ver `docs/vout-integration/integration-guide.md`.

## Estructura del proyecto

```
daino/
├── app/                   # Backend PHP (MVC ligero)
│   ├── Core/              # Infra: Router, Database, Request, Response, ViteAssets...
│   ├── Controllers/
│   ├── Services/
│   ├── Middleware/
│   ├── Models/
│   ├── Views/             # Templates PHP (sin framework de templates)
│   └── bootstrap.php      # Autoload + env
├── public/
│   ├── index.php          # Front controller (ÚNICO PHP público)
│   └── build/             # Output de Vite (gitignorado)
├── resources/
│   ├── js/                # Source JS (game/, ui/, api/)
│   └── css/               # Source CSS
├── routes/                # Declaración de rutas (web.php, api.php)
├── database/
│   ├── migrations/
│   └── seeds/
├── storage/               # uploads/, logs/, cache/  (gitignorado)
├── docker/                # Dockerfiles + configs
│   ├── php/
│   └── nginx/
├── docker-compose.yml
├── composer.json
├── package.json
├── vite.config.js
└── docs/                  # Planificación y referencias (ver docs/refactorizacion/00-LEEME-PRIMERO.md)
```

La estructura completa razonada está en [docs/refactorizacion/05-Estructura-Proyecto.md](docs/refactorizacion/05-Estructura-Proyecto.md).

## Comandos habituales

```bash
# Backend
docker compose up -d          # arrancar PHP + Nginx + DB
docker compose logs -f php    # seguir logs del contenedor PHP
docker compose down           # parar (conserva BD)
docker compose down -v        # parar y borrar volumen de BD

# Dependencias PHP (dentro del contenedor)
docker compose exec php composer install
docker compose exec php composer require <pkg>

# Frontend (en el host)
bun install                   # instalar dependencias
bun run dev                   # dev server en http://localhost:5174 con HMR (VITE_DEV_PORT)
bun run build                 # build de producción a public/build/
```

## Modos de ejecución del juego

Daino puede correr en dos modos (detectados automáticamente en runtime):

- **Standalone** — `http://localhost:8080` directo. Control por teclado/touch. Login con "Entrar con Vout" (OAuth2 + PKCE).
- **Embebido en Vout** — cargado dentro de un `<iframe>` del portal Vout. Recibe comandos (gestos faciales) vía `postMessage`. La identidad llega del portal con el handshake `READY` → `VOUT_AUTH`, y los gestos como `VOUT_ACTION`, `VOUT_KEY` y `VOUT_POINTER` (protocolo completo en la guía de integración de Vout).

## Ramas del repo

- `main` — Daino legacy (intocado hasta que la v2 esté jugable).
- `legacy` — Puntero permanente al mismo HEAD que `main`, como marcador del código viejo.
- `ramita` — WIP viejo heredado; no se toca.
- `rewrite/v2` — **Rama activa** del nuevo Daino. Es la que se despliega: `.github/workflows/images.yml` publica las imágenes de producción en GHCR con cada push a esta rama, y Coolify despliega `docker-compose.prod.yml` desde ella.

## Licencia

Código propietario. Ver `composer.json`.
