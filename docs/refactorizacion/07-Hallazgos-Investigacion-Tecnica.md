# Hallazgos de la investigación técnica (abril 2026)

> Documento curado a partir del informe de Gemini Deep Research "Arquitectura Técnica y Viabilidad de Daino v2 (Abril 2026)". Captura solo los hallazgos que **cambian o refinan decisiones de Daino**, no la totalidad del informe. Para los detalles completos con citas a fuentes, ver el PDF original almacenado fuera del repo.

---

## A. Lenguajes y versiones

### A.1. PHP 8.5 — features útiles y trampas

**Útil para Daino:**

- **Pipe operator `|>`** — encadenar transformaciones de izquierda a derecha sin variables temporales. Útil para procesar respuestas del IdP Vout y metadata de audio.
- **`clone with`** — clonación con override de propiedades en una expresión. Útil para snapshots inmutables del estado del nivel.
- **Atributo `#[NoDiscard]`** — el motor avisa si no se usa el valor de retorno. Útil en métodos críticos de validación JWT y verificación de progresos.
- **Extensión URI nativa** — validación de endpoints de Vout bajo RFC 3986 sin librerías de terceros.
- **CHIPS (Cookies Having Independent Partitioned State)** — soporte nativo para cookies particionadas. Relevante si Daino se embebe en Vout vía iframe.

**Trampas críticas (deprecaciones que afectan a Daino):**

- 🚨 **`__sleep` y `__wakeup` están deprecados** en favor de `__serialize` / `__unserialize`. **Esto es load-bearing**: el `code_verifier` de PKCE y el `state` se almacenan en `$_SESSION` durante el flujo OAuth. Si en algún momento implementamos persistencia custom de sesiones (handler propio), debemos usar los métodos nuevos o la sesión se romperá silenciosamente perdiendo el PKCE en mid-flow.
- `null` como offset de array → deprecado.
- `disable_classes` directiva del INI → eliminada.
- `php -z` (carga de extensiones por CLI) → eliminada.

### A.2. OPcache es core (confirmado)

Ya lo descubrimos en el scaffolding. El RFC se llama "Make OPcache a non-optional part of PHP". Las directivas `opcache.enable` y `opcache.enable_cli` siguen siendo válidas y respetadas. El motor Zend ahora **asume** la presencia de OPcache, lo que permite simplificar rutas internas de carga y compilación.

### A.3. PixiJS v8 — API moderna

**Cambios estructurales respecto a v7 que afectan al código que escribiremos:**

- **`app.init()` es asíncrono** — la inicialización de la aplicación ahora retorna una promesa. La detección de WebGPU vs WebGL fallback se hace dentro de ese await. Patrón correcto:
  ```js
  const app = new Application();
  await app.init({ resizeTo: window, autoDensity: true, resolution: devicePixelRatio });
  ```
- **`Container` reemplaza a `DisplayObject`** como clase base. El scene graph queda más plano y predecible.
- **FederatedEvents** — el sistema de eventos sigue el modelo del DOM (bubbling de eventos pointer/touch).
- **`resizeTo: window`** — autoresize al viewport sin lógica manual.
- **`autoDensity` + `resolution`** — manejo HiDPI nativo, mantiene nitidez en pantallas Retina.

**Para el HUD: `BitmapText`, NO `Text` 🚨**

`PIXI.Text` genera **una nueva textura por cada cambio de carácter**. Para un score que se actualiza 60 veces por segundo, eso destroza la GPU. Usar siempre **`BitmapText`** (atlas pre-generado de glifos) para texto que cambia.

**`RenderLayers` (introducido en PixiJS 8.7)**

API oficial para orquestar capas de renderizado, mejor que apilar `Container`s manualmente. La estructura recomendada para Daino:

1. **Capa fondo (shader)** — un `Filter` de pantalla completa con `filterArea` igual al viewport.
2. **Capa gameplay** — donde viven Dino + obstáculos. Usar `CullerPlugin` para no renderizar obstáculos fuera de pantalla cuando los niveles sean largos.
3. **Capa partículas** — `ParticleContainer` dedicado (no `Container` regular) — la GPU procesa miles más eficientemente.
4. **HUD** — DOM overlay con Tailwind si es accesibilidad/texto largo, o `BitmapText` dentro del canvas si necesita sincronización frame-perfect con el gameplay.

### A.4. Vite — Vite 8 está disponible (decisión abierta)

A fecha de la investigación, **Vite 8.0** es la versión recomendada para producción en abril 2026:

- Unifica el pipeline con **Rolldown** (Rust) reemplazando a esbuild + Rollup.
- Mejoras de hasta **10-30x** en tiempo de build de producción.
- Soporte nativo para `tsconfig` paths (sin plugin externo).
- Comportamiento idéntico dev/prod (no más sorpresas en el build).

**Mi setup actual usa Vite 6.** El cambio a Vite 8 es opcional pero significativo para velocidad de iteración. Ver §H "decisiones abiertas" abajo.

### A.5. Tailwind v4 — confirmado lo que ya hacíamos

- Configuración CSS-first con `@theme` directive — sin `tailwind.config.js`.
- Variables de tema expuestas como CSS Custom Properties (accesibles desde JS sin importar JSON).
- Container queries y transformaciones 3D nativas.
- Compilación con motor **Oxide** (Rust).
- `@tailwindcss/vite` plugin oficial — compatible con Vite 6+.

### A.6. Bun 1.3+ (decisión abierta)

- **Bun.SQL** soporta MariaDB nativamente con tagged templates. Si actualizamos, podemos eventualmente usar Bun para scripts de mantenimiento que hablen con la BD sin pasar por PHP.
- Gestor de paquetes notablemente más rápido que npm/pnpm.
- Soporte nativo `.env`.

Mi `bun --version` reporta `1.2.3`. Recomendado actualizar a `1.3.x` con `bun upgrade`. Ver §H.

### A.7. MariaDB 11.4 LTS — confirmado

- 11.4 es la LTS estable para 2026. Mantenemos esta.
- 11.8+ tiene búsqueda vectorial (no relevante para Daino) pero también **gestión más estricta de Repeatable Read** (errores 1020 con snapshot conflicts) — añade complejidad de retries que no necesitamos.

---

## B. Docker e infraestructura

### B.1. Nginx confirmado

Para PHP 8.5 + PHP-FPM en Alpine, Nginx 1.27+ sigue siendo la elección óptima en 2026. Caddy ha madurado pero Nginx ofrece más control granular sobre cabeceras de caché y proxy reverso, crítico para servir MP3s pesados. Apache + mod_php se considera obsoleto para proyectos nuevos de alto rendimiento.

### B.2. Alpine: trampa con `intl` (BANDERA ROJA)

🚨 **La extensión `intl` puede tardar hasta 30 minutos** en compilarse en Alpine PHP 8.5 debido a la ausencia de bibliotecas pre-compiladas para musl. Nuestro Dockerfile actual instala `intl`, así que la primera build (cacheada después) tarda esos 30 minutos.

Mitigaciones disponibles:

1. **Usar `mlocati/docker-php-extension-installer`** — un instalador optimizado que mitiga el tiempo. Es el workaround estándar de la comunidad PHP.
2. **Imagen base pre-construida** propia con `intl` ya compilado.
3. **Migrar a `php:8.5.3-fpm` (Debian)** — `intl` en Debian instala en segundos vía `apt-get install -y libicu-dev`. Trade-off: imagen ~80MB más grande.

Ver §H decisiones abiertas.

### B.3. Docker Compose V2 (confirmado)

- `docker compose` (sin guion) es el estándar absoluto.
- Sin necesidad del campo `version:` en el YAML.
- Funcionalidad `develop` permite sincronizar archivos y rebuilds automáticos al cambiar configs. Útil para iterar el `nginx.conf` sin parar/iniciar.

### B.4. WSL2 + Windows (BANDERA ROJA)

🚨 **Si el código vive en `/mnt/c/...` desde WSL2, el HMR de Vite se vuelve insoportablemente lento.** El bind mount de Windows → contenedor pasando por WSL2 introduce penalización masiva de I/O.

Recomendación oficial 2026: **mover el proyecto a la partición nativa de WSL2** (ej. `~/projects/daino/`) cuando el desarrollador está en Windows.

**Para Daino:** mi setup actual tiene el código en `c:\Users\34642\Documents\Proyectos Web\daino`. Si el usuario abre el proyecto desde Docker Desktop (que internamente usa WSL2), podría estar pagando esta penalización. **Acción a verificar**: ¿el HMR se siente lento? Si sí, mover el código a `\\wsl$\Ubuntu\home\<user>\daino\`.

**Volúmenes nombrados** (no bind mounts) para la persistencia de MariaDB — esto ya lo hacemos.

### B.5. Patrón HMR (confirmado)

Mi `ViteAssets.php` y la separación "Vite en host, PHP en Docker" son exactamente el patrón recomendado en 2026. No hace falta cambiar nada aquí.

---

## C. UI/UX

### C.1. Hybrid Canvas + DOM (confirmado)

Análisis de osu! lazer, Beat Saber web ports, Geometry Dash ports → el patrón ganador es **canvas para gameplay, DOM para menús**. Daino lo hace así (doc 06).

| Juego | Patrón | Lección |
|-------|--------|---------|
| osu! lazer | Framework C# custom, todo en canvas | Skinning total pero accesibilidad limitada |
| Beat Saber web | Hybrid DOM/A-Frame | Menús accesibles, gameplay performant |
| Geometry Dash port | Canvas puro | Mínima latencia, UI bloqueada al refresh |
| **Daino v2** | **Hybrid PixiJS/Tailwind** | **Sincronización en canvas, accesibilidad en DOM** |

### C.2. Modales con Tailwind v4 + Headless UI

Para los slide-in panels estilo PS5 (ranking, perfil, settings) **sin afectar el rendimiento del canvas**:

- DOM puro, posicionado `fixed`, animaciones CSS.
- **Headless UI** (vía Tailwind) provee primitivas accesibles (Dialog, Transition, Disclosure) sin estilos opinados.
- Cumplimiento WCAG 2.2 nativo.

### C.3. Fullscreen API + AudioContext (gotcha crítico)

Al entrar/salir de fullscreen, el navegador puede **suspender el `AudioContext`**. Daino debe escuchar `audioContext.onstatechange` y pausar el juego automáticamente si el audio se detiene por:

- Cambio de pestaña.
- Políticas de ahorro de energía del navegador.
- Suspensión por fullscreen.

Sin esto, el jugador puede perder la sincronización con el nivel sin enterarse de por qué.

`document.requestFullscreen()` debe llamarse **siempre desde una acción explícita del usuario** (botón "Start"), nunca programáticamente.

### C.4. `prefers-reduced-motion`

En Daino: ajustar los **uniformes de los shaders GLSL** según el media query. Reducir intensidad de strobing y oscilaciones de cámara, manteniendo la sincronía rítmica. El gameplay no cambia, solo la intensidad visual.

---

## D. Audio-reactividad

### D.1. AnalyserNode — parámetros recomendados

| Parámetro | Valor | Razón |
|-----------|-------|-------|
| `fftSize` | **2048** | Equilibrio entre resolución frecuencial (bajos detallados) y temporal (onsets de alta frecuencia) |
| `smoothingTimeConstant` | **0.82** | Transiciones suaves sin sentirse "viscoso" |
| `minDecibels` | **-100 dB** | Captura detalles sutiles en canciones acústicas |
| `maxDecibels` | **-30 dB** | Evita truncar picos en EDM o rock comprimido |

Datos extraídos con `getByteFrequencyData(uint8Array)` cada frame del ticker de PixiJS.

### D.2. Pasar FFT a shader como `sampler2D` texture, NO uniforms

Patrón recomendado en 2026: en vez de pasar 1024 floats individuales como uniforms (satura el bus), generar una **textura 1D/2D** a partir del array de frecuencias y pasarla al fragment shader como `sampler2D uAudioTexture`. El shader hace `texture2D(uAudioTexture, vec2(freqIndex, 0.0)).r` para leer cualquier banda.

Más eficiente y permite acceso aleatorio a cualquier rango de frecuencia.

### D.3. Detección de onsets — Spectral Flux

Algoritmo recomendado: **Spectral Flux**. Detecta cambios bruscos en el contenido de energía a través de múltiples bandas de frecuencia, no solo el volumen global. Captura tanto bombos (graves) como hi-hats (agudos).

CRNN (redes neuronales convolucionales recurrentes) son más precisos pero overkill para Daino. Umbrales dinámicos de energía + Spectral Flux es lo correcto.

### D.4. Detección de BPM

**No hay API nativa** en Web Audio para BPM. Opciones:

- **`web-audio-beat-detector`** o **`realtime-bpm-analyzer`** (npm) — estimación al cargar el nivel, una sola vez.
- BPM estimado modula la velocidad del scroll lateral.

### D.5. Meyda vs Essentia.js (futuro)

🚩 **Meyda muestra desaceleración de actualizaciones en los últimos 12 meses.** Sigue funcionando pero el riesgo de abandono es real.

Alternativa de largo plazo: **Essentia.js** — librería del MTG (Universitat Pompeu Fabra) compilada de C++ a WASM. Más performante y activamente mantenida. Documentación más densa.

**Para el MVP de Daino:** seguimos con la Web Audio API nativa. Si necesitamos features más allá del BPM (cromas, MFCC, segmentación), evaluar **Essentia.js antes que Meyda**.

### D.6. Generación procedural — determinismo

La generación de obstáculos desde MP3 debe ser **determinista** para validar puntuaciones server-side. Algoritmo:

1. Pre-analizar el MP3 al cargarlo (`AudioContext.decodeAudioData`).
2. Detectar onsets de baja frecuencia (~bombo) → obstáculos de salto.
3. Detectar onsets de alta frecuencia (~hi-hat/caja) → obstáculos aéreos / agachados.
4. Generar la secuencia con un **PRNG seeded** (mismo seed → misma secuencia).
5. Enviar el seed al servidor, no la secuencia completa.

---

## E. OAuth2 + JWT

### E.1. `league/oauth2-client` — Provider personalizado

Para Vout, extender `League\OAuth2\Client\Provider\AbstractProvider`:

```php
class VoutProvider extends AbstractProvider {
    public function getBaseAuthorizationUrl() { return $_ENV['VOUT_AUTHORIZE_URL']; }
    public function getBaseAccessTokenUrl(array $params) { return $_ENV['VOUT_TOKEN_URL']; }
    public function getResourceOwnerDetailsUrl(AccessToken $token) { return $_ENV['VOUT_USERINFO_URL']; }
    protected function getDefaultScopes() { return ['user:read']; }
    protected function checkResponse(ResponseInterface $response, $data) { /* errores */ }
    protected function createResourceOwner(array $response, AccessToken $token) {
        return new VoutUser($response); // wrapper sobre el JSON de /me
    }
}
```

La librería gestiona PKCE internamente cuando se invoca `getAuthorizationUrl(['state' => ..., 'code_challenge_method' => 'S256'])`.

### E.2. Verificación JWT con `lcobucci/jwt` 5.5

API moderna usando `Configuration`:

```php
$jwks = $jwksCache->get(); // PSR-16 cache
$config = Configuration::forSymmetricSigner(
    new Signer\Rsa\Sha256(),
    Signer\Key\InMemory::plainText($jwks->keyForKid($token->headers()->get('kid')))
);
$config->setValidationConstraints(
    new Constraint\SignedWith($config->signer(), $config->signingKey()),
    new Constraint\IssuedBy($_ENV['VOUT_ISSUER']),
    new Constraint\PermittedFor($_ENV['VOUT_CLIENT_ID']),
    new Constraint\StrictValidAt(SystemClock::fromUTC(), DateInterval::createFromDateString('60 seconds')) // 60s leeway
);
$config->validator()->assert($token, ...$config->validationConstraints());
```

Validar SIEMPRE: firma, `iss`, `aud`, `exp` con leeway 60s.

### E.3. JWKS caching (PSR-16)

- Cachear las claves públicas de Vout obtenidas de `/oauth/jwks`.
- TTL recomendado: 1 hora.
- Forzar refresh si llega un `kid` desconocido (rotación de claves).

### E.4. PKCE — almacenamiento del `code_verifier`

🚨 **Solo en `$_SESSION` del backend PHP, NUNCA en cookies ni `localStorage`.** Daino es un servidor con sesión nativa, así que el `code_verifier` se queda server-side desde su generación hasta el callback.

El `state` también va en `$_SESSION` y se valida en el callback antes de hacer cualquier cosa con el `code`.

### E.5. Refresh token rotation

- Cada uso del refresh token invalida el anterior (Vout debería emitir uno nuevo). Daino debe almacenar el más reciente.
- Cookie `HttpOnly; Secure; SameSite=Strict`.
- Si se persiste en BD, **cifrar en reposo** (nunca texto plano).

---

## F. Calidad y testing

### F.1. PHPStan nivel 9

Objetivo: `level: 9` en `phpstan.neon` desde el inicio. El nivel 9 obliga a manejar explícitamente `mixed` y bloquea `null` implícito a tipos no nulables.

Para código nuevo es razonable. Si en algún momento adoptamos código legado (no es el caso de Daino), usar baselines.

### F.2. Pest v4 > PHPUnit

- Sintaxis más expresiva.
- Pruebas en paralelo nativas.
- **Architecture testing** (capacidad única de Pest): definir reglas como "ningún controller puede acceder directamente a `$_POST`, debe ir vía clase Request". Ejecutables en CI.

### F.3. Bundle budget

Target realista para Daino:

| Componente | Peso esperado (gzipped) |
|------------|-------------------------|
| PixiJS v8 (solo módulos usados) | ~180 KB |
| Lógica del juego (ESM) | ~30 KB |
| Tailwind v4 (purgado) | ~10 KB |
| **Total core** | **~220 KB** |

Monitorizar con `rollup-plugin-visualizer` (compatible con Vite). Si una dep nueva añade >50 KB, evaluar si vale la pena.

---

## G. Banderas rojas (resumen)

| # | Riesgo | Mitigación |
|---|--------|------------|
| 1 | `intl` en Alpine PHP 8.5 tarda 30 min | `mlocati/docker-php-extension-installer` o cambiar a Debian |
| 2 | WebGPU en móviles gama media inconsistente | Probar fallback a WebGL siempre |
| 3 | Meyda con mantenimiento desacelerado | Evaluar Essentia.js si necesitamos features avanzadas |
| 4 | Código en `/mnt/c/` desde WSL2 destroza HMR | Mover a partición nativa de WSL2 |
| 5 | PHP 8.5 deprecó `__sleep`/`__wakeup` | Si implementamos session handler custom: usar `__serialize`/`__unserialize` |

---

## H. Decisiones abiertas (necesitan input del usuario)

### H.1. ¿Vite 6 o Vite 8?

- **Vite 6 (actual)**: probado, estable, sin issues conocidos con `@tailwindcss/vite`.
- **Vite 8**: 10-30x faster builds (Rolldown/Rust), unifica dev y prod, soporte tsconfig paths nativo. Riesgo: muy reciente (marzo 2026).

Recomendación: **Vite 8** si confirmamos compat con `@tailwindcss/vite` (la investigación sugiere que sí pero conviene verificar). El upgrade es trivial (cambiar version en `package.json`, `bun install`).

### H.2. ¿Alpine o Debian para la imagen PHP?

- **Alpine (actual)**: imagen pequeña (~80 MB), pero `intl` puede tardar 30 min en instalar (cacheado después).
- **Debian**: imagen más grande (~160 MB), pero `intl` instala en segundos.

Recomendación: **mantener Alpine + añadir `mlocati/docker-php-extension-installer`** para acelerar la instalación de extensiones. Mantenemos el tamaño chico y resolvemos el bottleneck.

Alternativa pragmática: si el usuario solo va a hacer la build una vez en local (porque CI/CD vendrá más adelante), aceptar la espera y no tocar nada.

### H.3. ¿Bun 1.2.3 o actualizar a 1.3.x?

- **1.2.3 (actual)**: funciona, sin problemas observados.
- **1.3.x**: mejoras de compat con Vite, `Bun.SQL` con MariaDB nativa.

Recomendación: **`bun upgrade`**. Bun mantiene compatibilidad muy bien, riesgo bajo.

### H.4. ¿Verificar dónde vive el código en Windows?

Si Docker Desktop usa el backend WSL2 (default en Win 10/11), el código en `c:\Users\...` se accede desde el contenedor pasando por `/mnt/c/...` con penalización de I/O.

Recomendación: comprobar si el HMR de Vite se siente lento (>1s para reflejar cambios). Si sí, considerar mover el proyecto a la partición nativa de WSL2.

---

## I. Lo que NO cambia respecto a lo planeado

Confirmado por la investigación, no hay que tocar:

- PHP 8.5.3 pineado.
- PixiJS v8 como motor de juego.
- Tailwind v4 + `@tailwindcss/vite`.
- MariaDB 11.4 LTS.
- Nginx + PHP-FPM (no Apache, no Caddy).
- `lcobucci/jwt` para verificar JWTs RS256.
- `league/oauth2-client` para el flujo OAuth2.
- Vanilla JS sin framework.
- Hybrid Canvas + DOM para la UI.
- Single canvas full-viewport.
- Vite en host, PHP en Docker (no Vite en contenedor).
