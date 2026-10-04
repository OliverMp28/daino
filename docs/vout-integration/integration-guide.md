# Guía de Integración: Ecosistema de Usuarios Vout

> **Versión:** 1.1  
> **Protocolo:** OAuth 2.0 (Authorization Code + PKCE)  
> **Última actualización:** Octubre 2026

---

## ¿Qué es Vout?

Vout es un **Proveedor de Identidad (IdP)** que centraliza las cuentas de usuario para un ecosistema de minijuegos web. En lugar de que cada juego gestione su propia base de datos de usuarios, Vout ofrece un "pasaporte universal": el usuario se registra una vez y puede jugar en cualquier proyecto integrado.

**Beneficios para tu proyecto:**
- No necesitas gestionar registros, contraseñas ni recuperación de cuentas.
- Tus usuarios acceden con un clic usando su cuenta de Vout (o Google).
- Recibes un identificador único (`vout_id`) para vincular progreso y datos.

---

## Tipos de Integración

Tu proyecto puede integrarse con Vout de dos maneras:

### 1. Solo Catálogo (sin autenticación)
Tu juego aparece en el portal de Vout pero **no necesita identificar usuarios**. Ideal para juegos simples sin backend ni base de datos.

- Tu app se registra en Vout con `requires_auth = false`.
- No necesitas configurar OAuth2 ni tokens.
- El juego simplemente se carga en el portal.

### 2. Con Ecosistema de Usuarios (OAuth2)
Tu juego necesita saber **quién es el usuario** (para guardar puntuaciones, mostrar su nombre, etc.).

- Tu app se registra en Vout con `requires_auth = true`.
- Recibes un `client_id` (y opcionalmente un `client_secret`).
- Implementas el flujo OAuth2 estándar descrito a continuación.
- Si además publicas el juego en el portal, dentro del iframe no hay redirect: el portal te pasa el token por `postMessage` (ver "Identidad dentro del iFrame").

> **Nota:** El protocolo es **exactamente el mismo** para proyectos propios y de terceros. La única diferencia es que los proyectos propios de Vout (`is_first_party = true`) no muestran pantalla de autorización al usuario — la sesión se inicia de forma transparente.

---

## Protocolo: OAuth2 Authorization Code + PKCE

Vout implementa el estándar **OAuth 2.0** con la extensión **PKCE** (Proof Key for Code Exchange), que es el flujo recomendado para aplicaciones web modernas.

### ¿Qué significa esto para ti?

No necesitas una librería específica de Vout. Si tu stack habla OAuth2 y JWT estándar, funciona con Vout, ya uses PHP, Node.js, Python, Go o cualquier otro lenguaje.

Una integración con Vout pasa por dos fases, y cada una usa un tipo de librería distinto:

| Fase | Qué hace | Cuándo ocurre | Qué librería usar |
| :--- | :--- | :--- | :--- |
| 1. Login | Redirige al usuario a Vout, recibe el `code` en el callback y lo intercambia por un Access Token. | Una sola vez por sesión del usuario. | Un cliente OAuth2: `laravel/socialite` o `league/oauth2-client` (PHP), `openid-client` (Node.js), `authlib` (Python), `golang.org/x/oauth2` (Go)... |
| 2. Cada request al API | Verifica que el Access Token sigue siendo válido antes de servir la response. | En cada llamada autenticada. | Dos opciones, descritas debajo. |

Para la Fase 2 tienes dos formas de verificar el token:

- Opción A, validación local (rápida). Verificas la firma RS256 del JWT en tu servidor con la clave pública de Vout (publicada en `/oauth/jwks`). Como no llamas a la red, la verificación tarda microsegundos. Necesitas un validador JWT: `lcobucci/jwt` (PHP), `jose` (Node.js), `PyJWT` (Python), `jwx` (Go). La sección "Validación Stateless del Token" más abajo la cubre en detalle.
- Opción B, reenviar el token a Vout (simple). Llamas a `GET /api/v1/user/me` pasando el token. Si Vout responde 200, el token es válido y de paso recibes los datos del usuario; un 401 significa que es inválido. No te hace falta ninguna librería JWT, solo un cliente HTTP (curl, Guzzle, axios, requests).

> ¿Cuál elegir? Si tu app es simple, empieza con la Opción B: menos código y revocaciones detectadas al instante. Cuando el round-trip por request empiece a pesarte en tráfico alto, mueve a la Opción A. Más abajo hay una tabla que las compara con detalle.

---

## Flujo Paso a Paso

### Paso 1: Registra tu aplicación

Contacta al administrador de Vout para registrar tu app. Recibirás:
- **`client_id`**: Identificador público de tu aplicación (UUID).
- **`client_secret`** (opcional): Solo para aplicaciones con backend seguro. Las SPAs usan PKCE sin secret.
- **`redirect_uri`**: La URL de tu app donde Vout redirigirá al usuario tras autenticarse.

### Paso 2: Redirige al usuario a Vout

Tu aplicación redirige al usuario a la URL de autorización de Vout:

```
GET https://vout.example.com/oauth/authorize?
    client_id=TU_CLIENT_ID
    &redirect_uri=https://tu-app.com/callback
    &response_type=code
    &scope=user:read user:email
    &state=CADENA_ALEATORIA_ANTI_CSRF
    &code_challenge=HASH_SHA256_DEL_CODE_VERIFIER
    &code_challenge_method=S256
```

**Parámetros:**
| Parámetro | Obligatorio | Descripción |
| :--- | :---: | :--- |
| `client_id` | ✅ | Tu UUID de cliente |
| `redirect_uri` | ✅ | Debe coincidir con la registrada |
| `response_type` | ✅ | Siempre `code` |
| `scope` | ✅ | Permisos solicitados (ver sección Scopes) |
| `state` | ✅ | Cadena aleatoria para protección CSRF |
| `code_challenge` | ✅* | Hash SHA-256 del code verifier (PKCE) |
| `code_challenge_method` | ✅* | Siempre `S256` |

*\*Obligatorio para clientes públicos (SPAs). Recomendado para todos.*

### Paso 3: El usuario autoriza (o no)

- Si es una app **first-party**, el usuario se redirige automáticamente sin ver ningún prompt.
- Si es una app **third-party**, el usuario verá: *"La app X solicita acceso a tu perfil"*, con los scopes listados.

> **Vout recuerda el consentimiento.** Tras la primera autorización exitosa, los siguientes `/oauth/authorize` del mismo usuario para tu app saltan la pantalla y emiten el `code` directo (paridad UX con Google/GitHub). El usuario puede revocar el acceso desde `/settings/connected-apps` cuando quiera; en ese momento se invalidan los tokens activos y la próxima autorización mostrará la pantalla otra vez. Si la app pide un scope **nuevo** que el grant no cubre, Vout vuelve a preguntar (incremental consent).

### Paso 4: Intercambia el código por un token

Vout redirige al usuario de vuelta a tu `redirect_uri` con un `code` temporal:

```
GET https://tu-app.com/callback?code=CODIGO_TEMPORAL&state=TU_STATE
```

Tu backend intercambia ese código por un Access Token:

```
POST https://vout.example.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=TU_CLIENT_ID
&client_secret=TU_CLIENT_SECRET    (solo si tu cliente tiene secret)
&redirect_uri=https://tu-app.com/callback
&code=CODIGO_TEMPORAL
&code_verifier=EL_CODE_VERIFIER_ORIGINAL    (PKCE)
```

**Respuesta exitosa:**
```json
{
    "token_type": "Bearer",
    "expires_in": 3600,
    "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOi...",
    "refresh_token": "def50200c..."
}
```

### Paso 5: Consulta la API de Vout

Con el Access Token, puedes obtener los datos del usuario:

```
GET https://vout.example.com/api/v1/user/me
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOi...
```

**Respuesta:**
```json
{
    "data": {
        "vout_id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Oliver",
        "username": "oliver_mp",
        "avatar": "https://lh3.googleusercontent.com/...",
        "email": "oliver@example.com"
    }
}
```

> **Nota:** El campo `email` solo aparece si solicitaste el scope `user:email`.

---

## Scopes Disponibles

Los scopes controlan qué datos del usuario comparte Vout con tu app. **Importante:** Vout no almacena el progreso interno de tu juego (niveles, inventario, etc.). Esos datos los gestiona tu propia base de datos usando el `vout_id` como clave.

Los scopes relacionados con juegos sirven exclusivamente para sincronizar **metadatos globales** con el portal público de Vout (ej. mostrar récords o favoritos en el perfil público del jugador).

| Scope | Datos que incluye | Caso de uso |
| :--- | :--- | :--- |
| `user:read` | `vout_id`, `name`, `username`, `avatar` | Mostrar nombre y foto en tu juego |
| `user:email` | `email` | Enviar notificaciones, comunicación directa |
| `games:read` | Historial global y estadísticas en Vout | Saber qué otros juegos prefiere el usuario en el portal |
| `games:write` | Metadatos públicos hacia Vout | Actualizar en el portal Vout que el usuario rompió un récord en tu juego, o marcar tu juego como su favorito |

**Scope por defecto:** Si no especificas ningún scope, se asigna `user:read`.

**Buena práctica:** Solicita solo los scopes que necesitas. Los usuarios confían más en apps que piden menos permisos.

---

## Persistencia del consentimiento y parámetro `prompt`

Vout sigue la semántica de OIDC Core §3.1.2.1 para el parámetro `prompt` en `/oauth/authorize`. Por defecto, **una vez que el usuario autoriza tu app, Vout recuerda esa decisión** y futuras peticiones saltan la pantalla — incluso si la sesión web del usuario en Vout caducó. El consentimiento sobrevive a la vida del access token (60 min) y solo se borra si el usuario revoca el acceso desde `/settings/connected-apps`.

### Comportamiento por defecto (sin `prompt`)

| Estado del usuario | Resultado |
|---|---|
| Sin sesión en Vout | Vout muestra `/login`. Tras autenticar, se aplica la regla siguiente. |
| Con sesión + grant activo cubriendo los scopes pedidos | Salto directo: 302 al `redirect_uri` con `?code=...&state=...`. |
| Con sesión + grant pero piden un scope nuevo | Pantalla de consent (incremental consent). Al aprobar, el grant se actualiza con la unión de scopes. |
| Con sesión sin grant | Pantalla de consent normal. |

### Forzar comportamientos específicos

```
GET /oauth/authorize?...&prompt=consent
```

| Valor | Cuándo usarlo | Comportamiento |
|---|---|---|
| `prompt=consent` | Operaciones sensibles, "ejecutar como otro usuario", cambiar de cuenta. | Vout **siempre** muestra la pantalla aunque exista grant activo. |
| `prompt=login` | Después de un cambio de identidad o si quieres forzar verificación de credenciales. | Vout cierra la sesión actual y obliga a iniciar sesión de nuevo antes de continuar el flow. |
| `prompt=none` | SSO silencioso (típico de iframes embebidos o re-auth en background). | Si hay sesión + grant: 302 con código. Si falta cualquiera de los dos: redirige al `redirect_uri` con `?error=login_required` o `?error=consent_required` — **nunca muestra UI**. |

### Revocación desde el lado del usuario

Cualquier usuario puede entrar en `/settings/connected-apps` (en su cuenta de Vout) y revocar el acceso a tu app. Eso:

- Marca el grant como revocado (no desaparece del histórico, queda con `revoked_at`).
- Marca todos los `oauth_access_tokens` y `oauth_refresh_tokens` del par (user, client) como `revoked=1`. Tu próximo refresh fallará con `invalid_grant`.
- Los JWTs ya emitidos siguen siendo criptográficamente válidos hasta su `exp` natural (≤ 60 min), porque la validación stateless no consulta la BD. Si necesitas revocación instantánea, llama a `/api/v1/user/me` periódicamente o vuelve a stateless con TTL más corto.

Cuando el usuario revoque y vuelva a entrar en tu app, Vout mostrará la pantalla de consent otra vez como si fuera la primera vez.

---

## Validación Stateless del Token (Avanzado)

Esta sección amplía la Opción A de la Fase 2: verificar el JWT localmente con la clave pública de Vout. Es opcional. Si tu app es simple, la Opción B (reenviar el token a `/api/v1/user/me`) hace el trabajo igual de bien y es más fácil de implementar.

Los Access Tokens de Vout son JWT firmados con RS256, así que cualquier librería JWT estándar puede verificar la firma con la clave pública publicada en `/oauth/jwks`. Conviene cuando montas microservicios, APIs con tráfico alto o juegos cuyo backend no quiere depender del round-trip a `/me` en cada petición.

### Discovery automático

Vout publica un documento OIDC Discovery — la mayoría de librerías JWT modernas se autoconfiguran con solo apuntar al issuer:

```
GET https://vout.example.com/.well-known/openid-configuration
```

Respuesta (resumida):

```json
{
  "issuer": "https://vout.example.com",
  "authorization_endpoint": "https://vout.example.com/oauth/authorize",
  "token_endpoint": "https://vout.example.com/oauth/token",
  "jwks_uri": "https://vout.example.com/oauth/jwks",
  "userinfo_endpoint": "https://vout.example.com/api/v1/user/me",
  "scopes_supported": ["user:read", "user:email", "games:read", "games:write", "game:play"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials", "urn:ietf:params:oauth:grant-type:device_code"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```

> **Aviso honesto:** Vout es **OAuth 2.0 con Access Tokens firmados (RS256)**, no un IdP OIDC completo. No emite ID Tokens ni implementa el flujo de `nonce` de OIDC. Exponemos esta URL porque las librerías cliente la usan para descubrir endpoints — todo lo que devolvemos (jwks, scopes, endpoints) es real y respetado.

### Endpoint JWKS

```
GET https://vout.example.com/oauth/jwks
```

Respuesta (RFC 7517):

```json
{
  "keys": [{
    "kty": "RSA",
    "use": "sig",
    "alg": "RS256",
    "kid": "Vw5D5w1BbAXKmaCCqc6m2MpffbXnTqaX7ye5BaNjB5U",
    "n": "sfnwC5_4zVwIJHajk3Dlsnlbl_jSOspy7Bf1vBnkeGl...",
    "e": "AQAB"
  }]
}
```

El `kid` es el JWK Thumbprint (RFC 7638), derivado matemáticamente del propio JWK — cualquier validador puede recomputarlo y verificarlo. Cuando Vout rote claves, el JWKS expondrá la antigua y la nueva durante la transición; tu librería elegirá la correcta usando el `kid` del header del JWT.

**Cabeceras de cache:** `Cache-Control: public, max-age=3600`. Tu librería normalmente cachea el JWKS automáticamente — no necesitas re-descargarlo en cada petición.

### Datos dentro del Token (Claims)

Si decodificas el JWT sin verificar la firma todavía, el payload se ve así:

```json
{
  "iss": "https://vout.example.com",
  "aud": "9d0e4f3a-1234-5678-90ab-cdef12345678",
  "jti": "a1b2c3d4e5f6...",
  "iat": 1778151275,
  "nbf": 1778151275,
  "exp": 1778154875,
  "sub": "2",
  "vout_id": "4f1ade51-449a-4871-8e62-d908ad737c24",
  "scopes": ["user:read"]
}
```

| Claim | Descripción |
| :--- | :--- |
| `iss` | URL del IdP Vout. Debes validar que coincide con tu instancia. |
| `aud` | Tu `client_id`. Debes validar que coincide con el tuyo. |
| `sub` | ID interno del usuario en Vout (entero, opaco). RFC 7519 lo permite, pero **para enlazar al usuario en tu BD usa `vout_id`**: el formato de `sub` puede cambiar en futuras versiones. |
| `vout_id` | **UUID canónico del usuario.** Es el mismo valor que devuelve `/api/v1/user/me`. Úsalo como clave para mapear el token a tu tabla `users` local y te ahorras un round-trip. No aparece en tokens `client_credentials` (no hay user asociado). |
| `scopes` | Array de scopes autorizados. |
| `exp` | Timestamp de expiración. |
| `iat` | Timestamp de emisión. |
| `nbf` | "Not before". Antes de este timestamp el token no es válido. |
| `jti` | ID único del token. Útil para revocación local, blacklists, etc. |

El header del JWT incluye `kid` apuntando a la clave del JWKS:

```json
{ "typ": "JWT", "alg": "RS256", "kid": "Vw5D5w1BbAXKmaCCqc6m2MpffbXnTqaX7ye5BaNjB5U" }
```

> Por qué hay dos identificadores. `sub` cumple RFC 7519: cualquier librería JWT estándar lo lee sin saber nada de Vout. `vout_id` es el identificador externo que documenta toda esta guía y que devuelve `/api/v1/user/me`. Tener los dos en el mismo token significa que para mapear `JWT → user local` no hace falta tocar `/me`; basta con decodificar el JWT.

### Ejemplo de validación con `lcobucci/jwt` (PHP)

```php
use Lcobucci\JWT\Configuration;
use Lcobucci\JWT\Signer\Rsa\Sha256;
use Lcobucci\JWT\Signer\Key\InMemory;
use Lcobucci\JWT\Validation\Constraint;

// Obtén la PEM de la clave pública desde el JWKS (cacheada por tu app).
// Cualquier librería JWK→PEM sirve: web-token/jwt-library, paragonie/jwt, etc.
$pem = jwksToPem(httpGet('https://vout.example.com/oauth/jwks'));

$config = Configuration::forAsymmetricSigner(
    new Sha256(),
    InMemory::plainText(''),                  // privateKey vacío: solo validamos
    InMemory::plainText($pem),                // publicKey desde JWKS
);

$token = $config->parser()->parse($accessToken);

$constraints = [
    new Constraint\SignedWith($config->signer(), $config->verificationKey()),
    new Constraint\IssuedBy('https://vout.example.com'),
    new Constraint\PermittedFor('TU_CLIENT_ID'),
    new Constraint\StrictValidAt(new \Lcobucci\Clock\SystemClock(new \DateTimeZone('UTC'))),
];

$config->validator()->assert($token, ...$constraints);
```

### Ejemplo en Node.js (`jose` / `node-openid-client`)

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://vout.example.com/oauth/jwks'));

const { payload } = await jwtVerify(accessToken, JWKS, {
    issuer: 'https://vout.example.com',
    audience: process.env.VOUT_CLIENT_ID,
});
```

`jose` cachea el JWKS automáticamente y refresca cuando aparece un `kid` desconocido — útil para rotación de claves transparente.

### Mapeando el JWT a tu base de datos

Una vez validado el token, lee `vout_id` del payload y úsalo como FK contra tu tabla `users` local. El patrón es el mismo en cualquier stack:

> Guarda `vout_id` (UUID) en tu tabla, no `sub`. `sub` es un detalle interno de Vout; `vout_id` es el contrato público estable que esta guía documenta.

PHP (`lcobucci/jwt`):

```php
$voutId = $token->claims()->get('vout_id');
$user = $db->query('SELECT * FROM users WHERE vout_id = ?', [$voutId])->fetch();
```

Node.js (`jose`):

```js
const { payload } = await jwtVerify(accessToken, JWKS, { issuer, audience });
const user = await db.users.findUnique({ where: { vout_id: payload.vout_id } });
```

Python (`PyJWT` + `cryptography`):

```python
import jwt, requests
jwks_client = jwt.PyJWKClient('https://vout.example.com/oauth/jwks')
signing_key = jwks_client.get_signing_key_from_jwt(access_token)
payload = jwt.decode(
    access_token,
    signing_key.key,
    algorithms=['RS256'],
    audience=client_id,
    issuer='https://vout.example.com',
)
user = User.query.filter_by(vout_id=payload['vout_id']).first()
```

Go (`github.com/lestrrat-go/jwx/v2`):

```go
keySet, _ := jwk.Fetch(ctx, "https://vout.example.com/oauth/jwks")
token, _ := jwt.Parse(
    []byte(accessToken),
    jwt.WithKeySet(keySet),
    jwt.WithIssuer("https://vout.example.com"),
    jwt.WithAudience(clientID),
)
voutID, _ := token.Get("vout_id")
// SELECT * FROM users WHERE vout_id = $1 ...
```

> Nota para Laravel: los snippets de PHP de arriba aplican igual en Laravel. La librería OAuth de la Fase 1 (`laravel/socialite`) y la librería JWT de la Fase 2 (`lcobucci/jwt`) son distintas y complementarias. Socialite no valida JWTs, y lcobucci no hace el flow OAuth.

### ¿Validación stateless o llamar a `/api/v1/user/me`?

Las dos son válidas, sirven escenarios distintos:

| | Validación local (JWKS) | Llamada a `/api/v1/user/me` |
| :--- | :--- | :--- |
| **Latencia** | Microsegundos (sin red) | Round-trip HTTP |
| **Detecta revocación** | No (hasta que expire el token, máx 60 min) | **Sí, instantánea** |
| **Detecta cambios de perfil** | No | Sí, en cada llamada |
| **Datos disponibles** | Solo claims del JWT | Perfil completo + `vout_id` |
| **Escalabilidad** | Excelente (sin acoplamiento a Vout) | Limitada por Vout |
| **Recomendado para** | APIs de alto QPS, microservicios | Apps con backend ligero, dashboards |

**Patrón recomendado:** valida la firma localmente (rápido) y consulta `/api/v1/user/me` solo en operaciones críticas que requieran datos frescos o detección inmediata de revocación.

---

## Refresh Tokens

Los Access Tokens expiran después de **60 minutos** (configurable). Para obtener uno nuevo sin pedir al usuario que vuelva a autorizarse:

```
POST https://vout.example.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=def50200c...
&client_id=TU_CLIENT_ID
&client_secret=TU_CLIENT_SECRET
&scope=user:read
```

Los Refresh Tokens son válidos durante **30 días** (configurable).

---

## Identificador Externo: `vout_id`

Cada usuario de Vout tiene un **UUID único** llamado `vout_id`. Es el identificador que debes guardar en tu base de datos para vincular al usuario.

Puedes obtenerlo desde dos sitios, y ambos devuelven exactamente el mismo valor:

1. Dentro del JWT, como claim `vout_id`. No hay red de por medio, así que es instantáneo. Disponible desde la versión actual de Vout.
2. Desde `GET /api/v1/user/me`, en el campo `vout_id`. Incluye también nombre, avatar y email.

Para el lookup `JWT → user local`, lee el claim del JWT y te ahorras la llamada. Reserva `/me` para cuando necesites datos frescos del perfil (avatar actualizado, email, etc.).

No uses el ID autoincremental: por seguridad, Vout no lo expone externamente.

```sql
-- En tu base de datos (ejemplo para tu tabla de jugadores):
CREATE TABLE players (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    vout_id CHAR(36) UNIQUE NOT NULL,  -- El UUID de Vout
    best_score INT DEFAULT 0,
    created_at TIMESTAMP
);
```

---

## Embebiendo tu juego en Vout (X-Frame-Options / CSP)

Tu juego se carga dentro de un `<iframe>` del portal Vout. Por defecto, **muchos servidores y frameworks bloquean los iframes** mediante cabeceras de seguridad — y este bloqueo lo aplica el navegador, no Vout. Si te ocurre, en la consola del navegador verás algo así:

```
Refused to display 'https://tu-juego.com/' in a frame because it set
'X-Frame-Options' to 'sameorigin'.
```

O bien:

```
Refused to frame 'https://tu-juego.com/' because an ancestor violates
the following Content Security Policy directive: "frame-ancestors 'self'".
```

**Esto ocurre en producción y en desarrollo por igual.** No es un fallo de Vout: tu servidor está diciéndole al navegador que no permite ser embebido.

### Cómo arreglarlo

El estándar moderno y recomendado es `Content-Security-Policy: frame-ancestors`, que sí permite whitelistear orígenes concretos (`X-Frame-Options` solo soporta SAMEORIGIN o DENY, sin granularidad — y queda obsoleta cuando ambas cabeceras están presentes).

En el servidor de tu juego, **elimina** `X-Frame-Options` y **añade**:

```
Content-Security-Policy: frame-ancestors 'self' https://vout.app https://www.vout.app
```

`frame-ancestors` lista los **orígenes del portal que embebe tu juego**, no los tuyos. Cambia `https://vout.app` por el dominio real de la instancia de Vout en la que registraste tu app (te lo confirmamos al darte de alta). Tu juego puede correr en `localhost`, en staging o en producción — eso no afecta a esta cabecera. Lo único que importa es de **dónde** se carga el iframe que va a contenerte: ese origen es el que tienes que autorizar.

### Recetas por stack

**Laravel** — añade un middleware o usa `spatie/laravel-csp`. El más rápido:

```php
// app/Http/Middleware/FrameAncestors.php
public function handle(Request $request, Closure $next): Response
{
    $response = $next($request);
    $response->headers->remove('X-Frame-Options');
    $response->headers->set(
        'Content-Security-Policy',
        "frame-ancestors 'self' https://vout.app",
    );
    return $response;
}
```

**Express / Node con Helmet** — Helmet activa `frameguard` por defecto. Apágalo y configura CSP:

```js
app.use(helmet({ frameguard: false }));
app.use(helmet.contentSecurityPolicy({
    directives: {
        frameAncestors: ["'self'", 'https://vout.app'],
    },
}));
```

**Next.js** — en `next.config.js`:

```js
async headers() {
    return [{
        source: '/:path*',
        headers: [{
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://vout.app",
        }],
    }];
}
```

**nginx** — en el bloque `server` del juego:

```
add_header Content-Security-Policy "frame-ancestors 'self' https://vout.app" always;
# Quita cualquier línea previa que ponga X-Frame-Options.
```

**Apache** — en `.htaccess` o vhost:

```
Header always unset X-Frame-Options
Header always set Content-Security-Policy "frame-ancestors 'self' https://vout.app"
```

### Verifica antes de publicar

```bash
curl -I https://tu-juego.com/ | grep -iE "x-frame|content-security"
```

- Si ves `X-Frame-Options: SAMEORIGIN` o `DENY` → tu juego no embebe en Vout.
- Si ves `Content-Security-Policy: frame-ancestors 'self' https://vout.app` → todo listo.

Sin esta cabecera correctamente configurada, el iframe del portal mostrará un cuadro en blanco, y tus jugadores no podrán abrir tu juego desde Vout. Comprueba ambas cosas (desarrollo y producción) antes de subir el juego.

---

## Identidad dentro del iFrame (handshake `postMessage`)

Cuando un usuario abre tu juego desde el portal, ya tiene sesión en Vout. Mandarlo a `/oauth/authorize` sería hacerle repetir algo que ya hizo, así que el portal le entrega a tu juego un access token directamente, por `postMessage`. Nunca por la URL.

Ese token es un access token normal de Vout: mismo formato, misma firma y mismos claims que los de `/oauth/token`. Lo validas con el código que ya tienes (ver "Validación Stateless del Token").

### Lo más rápido: el SDK

Vout publica un script que hace todo lo de esta sección por ti. Lo cargas, le dices el origen del portal y listo:

```html
<script src="https://vout.app/sdk/vout-game.js"></script>
<script>
    const vout = VoutGame.connect({
        portalOrigin: 'https://vout.app',

        // Identidad: llega al conectar y en cada renovación del token.
        onAuth(session) {
            // session = { token, expiresAt, voutId, username }
            // Manda session.token a tu backend y valídalo allí.
        },

        // Ya no habrá más renovaciones: suelta la identidad.
        onSessionEnd(reason) {},
    });

    // Para tu botón de "Salir":
    // vout.exit();
</script>
```

Con eso tu juego ya funciona con el control facial. Las teclas y clics que el jugador hace con la cara llegan a tu página como eventos de teclado y ratón normales (`keydown`, `keyup`, `click`…), así que **tu código de controles de siempre funciona sin tocarlo**.

| Opción | Para qué |
| :--- | :--- |
| `portalOrigin` | Obligatorio. El origen exacto del portal. |
| `onAuth(session)` | Identidad y token. Se llama al conectar y en cada renovación. |
| `onSessionEnd(reason)` | El portal ya no renovará el token. |
| `suggestedPreset` | Preset de gestos que tu juego recomienda (ver "Control facial"). |
| `simulateInput` | `true` por defecto. Ponlo a `false` si prefieres tratar tú las teclas con `onKey` y `onClick`. |
| `onAction(event, at)` / `onActionEnd(event, at)` | Eventos de juego (`JUMP`, `DUCK`…), si los usas. |
| `onKey(key)` / `onClick(click)` / `onCursor(x, y)` | La entrada en crudo, por si quieres algo a medida. |

Lo que devuelve: `vout.embedded` (si estás dentro del portal), `vout.session` (la última sesión, o `null`), `vout.exit()` y `vout.disconnect()`.

Fuera del portal, `VoutGame.connect()` no hace nada y `vout.embedded` vale `false`. Puedes llamarlo siempre y usar tu flujo OAuth normal cuando no estés embebido.

El archivo no tiene dependencias. Si prefieres no cargar código desde otro dominio, cópialo a tu proyecto.

El resto de esta sección explica qué pasa por debajo. Léela si quieres implementar el protocolo a mano o entender los límites.

### Los mensajes

| Dirección | Mensaje | Cuándo |
| :--- | :--- | :--- |
| juego → portal | `{ type: 'READY', suggestedPreset?: string }` | Tu juego ya puede recibir la identidad. Repítelo hasta que llegue `VOUT_AUTH`. |
| portal → juego | `{ type: 'VOUT_AUTH', token, expiresAt, voutId, username }` | En respuesta a cada `READY` válido, y otra vez cada vez que el portal renueva el token. |
| portal → juego | `{ type: 'VOUT_SESSION_END', reason }` | Ya no habrá más renovaciones. `reason` es `'signed_out'`, `'revoked'` o `'unavailable'`. |
| portal → juego | `{ type: 'VOUT_ACTION', event: string, at: number }` | Empieza una acción: un gesto del usuario mapeado a un evento de juego (control facial). |
| portal → juego | `{ type: 'VOUT_ACTION_END', event: string, at: number }` | Termina esa acción: el usuario dejó de hacer el gesto. |
| portal → juego | `{ type: 'VOUT_KEY', code, key, state: 'down' \| 'up', at }` | El usuario pulsa o suelta una tecla con un gesto. `code` y `key` son los de `KeyboardEvent`. |
| portal → juego | `{ type: 'VOUT_CLICK', button: 'left' \| 'right', at }` | El usuario hace clic con un gesto. Aplícalo donde esté el cursor. |
| portal → juego | `{ type: 'VOUT_CURSOR', x: number, y: number }` | Cursor por movimiento de cabeza. Coordenadas de 0 a 1, relativas a tu iframe. |
| juego → portal | `{ type: 'EXIT' }` | El usuario quiere salir. El portal lo lleva al catálogo. |
| juego → portal | `{ type: 'GAME_STATE', state: 'playing' \| 'paused' \| 'ended', score?: number }` | Reservado. El portal lo acepta, pero todavía no hace nada con él. |

`expiresAt` es la expiración del token en segundos Unix (el mismo valor que su claim `exp`). `at` va en milisegundos Unix.

Ignora cualquier `type` que no conozcas. El protocolo puede crecer y tu juego no debería romperse por ello.

### Cómo ocurre

1. El portal carga tu `embed_url` tal cual, sin parámetros.
2. Tu juego envía `READY` a `window.parent`.
3. El portal comprueba dos cosas: que `event.origin` es uno de los `allowed_origins` de tu app (comparación exacta de esquema, host y puerto) y que el mensaje viene del iframe que él mismo creó. Si algo no cuadra, lo descarta sin responder.
4. El portal responde con `VOUT_AUTH`, dirigido solo a ese origen.
5. Unos 5 minutos antes de que el token caduque, el portal pide uno nuevo y te manda otro `VOUT_AUTH`. Quédate siempre con el último.

Tu iframe permanece oculto hasta que el handshake termina. Está oculto por opacidad, no con `display: none`: desde el primer momento tiene su tamaño real, así que puedes medir la ventana y arrancar tu bucle de juego con normalidad.

Si no envías `READY` en los 8 segundos siguientes a que cargue tu página, el usuario ve un aviso de "El juego no responde" con un botón para reintentar. Un `READY` que llegue tarde sigue funcionando y quita el aviso solo. Aun así, envíalo en cuanto tu script arranque: `READY` significa "puedo recibir la identidad", no "ya cargué todos mis recursos".

### Qué token recibes

| | App con OAuth (`requires_auth = true`) | Juego solo catálogo |
| :--- | :--- | :--- |
| `aud` | Tu `client_id` | Un client interno del portal |
| `scopes` | `["user:read"]` | `["game:play"]` |
| Duración | 60 minutos | 60 minutos |
| Pide consentimiento | Solo si tu app es de terceros y el usuario aún no la autorizó | No |

Si tu app tiene client OAuth, el token está emitido para ti: valida `aud` contra tu `client_id` igual que en el flujo directo, y puedes usarlo como Bearer contra `/api/v1/user/me`.

Si tu juego es solo de catálogo, el token no está emitido para ti. Úsalo, como mucho, para saludar al jugador por su nombre. Si necesitas una identidad en la que puedas confiar (guardar progreso, rankings), registra tu app con `requires_auth = true`.

### Consentimiento

Una app de terceros solo recibe la identidad de un usuario que la haya autorizado. Si entra por primera vez a tu juego desde el portal, antes de cargar tu iframe verá una pantalla de permisos con el scope `user:read`. Al aceptar, entra al juego.

Es el mismo consentimiento que el del flujo directo, no uno aparte:

- Si el usuario ya entró a tu web con "Entrar con Vout", el portal no le vuelve a preguntar.
- Si autoriza desde el portal, tampoco verá la pantalla cuando entre a tu web pidiendo solo `user:read`.
- Si lo revoca en `/settings/connected-apps`, el portal deja de renovarte el token y la próxima vez volverá a preguntar.

Las apps propias de Vout (`is_first_party = true`) se saltan esta pantalla.

### Renovación: la hace el portal, no tú

Dentro de un iframe tus cookies son de terceros, y los navegadores las bloquean cada vez más. No cuentes con poder usar tu refresh token ni tu propia sesión mientras estás embebido.

Por eso renueva el portal. Mientras el usuario siga con la pestaña abierta y con sesión en Vout, recibirás un `VOUT_AUTH` nuevo antes de que caduque el anterior.

Cuando el portal intenta renovar y ya no puede, te lo dice con `VOUT_SESSION_END`:

| `reason` | Qué pasó |
| :--- | :--- |
| `signed_out` | El usuario cerró sesión en Vout o su sesión caducó. |
| `revoked` | El usuario revocó el acceso de tu app. |
| `unavailable` | Tu juego dejó de estar disponible en el portal. |

Al recibirlo, suelta la identidad. Ten en cuenta que el portal se entera en el momento de renovar, no en el instante en que ocurre: el aviso puede llegar hasta 55 minutos después. Si necesitas enterarte antes de una revocación, pregunta a `/api/v1/user/me` desde tu backend antes de una operación sensible: un token revocado recibe un 401 al instante.

Como red de seguridad, si llega la hora de `expiresAt` sin un `VOUT_AUTH` nuevo ni un `VOUT_SESSION_END` (por ejemplo, el usuario se quedó sin conexión), da la sesión por terminada igualmente.

Si el usuario cambia de cuenta de Vout en otra pestaña, el portal recarga la página del juego entera. Tu iframe arranca de cero y recibe la identidad nueva por el camino normal.

> **Ojo en local.** Para el navegador, `http://localhost` y `http://localhost:8090` son el mismo sitio (el puerto no cuenta), así que en tu máquina tus cookies sí viajan dentro del iframe. El bloqueo solo aparece en producción, con dominios distintos. Que funcione en local no demuestra que tu refresh funcione embebido.

### Control facial: qué llega a tu juego

Vout permite jugar con gestos de la cara y movimientos de cabeza. El usuario elige qué hace cada gesto: pulsar una tecla, hacer clic o emitir un evento de juego.

El navegador no deja que el portal simule teclas ni clics dentro de un iframe de otro origen. Por eso el portal no pulsa la tecla: le dice a tu juego cuál pulsar, con un mensaje, y es tu página la que crea el evento.

| El usuario mapeó el gesto a… | Tu juego recibe | Con el SDK |
| :--- | :--- | :--- |
| Una tecla | `VOUT_KEY` al pulsar y al soltar | Eventos `keydown` y `keyup` reales |
| Un clic | `VOUT_CLICK` | Eventos de ratón y puntero reales en la posición del cursor |
| El cursor con la cabeza | `VOUT_CURSOR` | Eventos `mousemove` y `pointermove` |
| Un evento de juego | `VOUT_ACTION` y `VOUT_ACTION_END` | Tus callbacks `onAction` y `onActionEnd` |

Lo importante: **cada usuario tiene su propio mapeo**, y lo trae consigo a todos los juegos. La mayoría usa teclas (Espacio para saltar, flechas para moverse). Si tu juego ya se juega con teclado y conviertes `VOUT_KEY` en eventos de teclado, funciona con el mapeo de cualquier usuario sin que tengas que hacer nada más.

Los presets que ofrece Vout:

| Preset | Qué emite |
| :--- | :--- |
| `platformer` | Teclas: Espacio, flechas, Z, X, C |
| `shooter` | Teclas, clic izquierdo y cursor con la cabeza |
| `accessible` | Teclas: Espacio, Enter, flechas, Escape |
| `runner` | Eventos de juego `JUMP` y `DUCK` |

Si tu juego tiene acciones propias que no encajan con una tecla, puedes recomendar un preset enviando `suggestedPreset` en tu `READY` (por ejemplo `'runner'`). El portal le ofrecerá al usuario cambiar a ese preset durante la partida, sin tocar su configuración guardada. Es una sugerencia: el usuario puede rechazarla, así que no dependas solo de ella.

#### Si conviertes las teclas a mano

Sin el SDK, esto es lo mínimo para que una tecla del portal llegue a tu código de teclado:

```js
function onVoutKey(message) {
    const event = new KeyboardEvent(message.state === 'down' ? 'keydown' : 'keyup', {
        key: message.key,
        code: message.code,
        bubbles: true,
        cancelable: true,
    });
    (document.activeElement || document.body).dispatchEvent(event);
}
```

Tres cosas que el SDK ya resuelve y que tendrás que cuidar tú:

- **`keyCode`.** Un evento creado así tiene `keyCode` a 0. Si tu juego o tu motor (Phaser, por ejemplo) lee `event.keyCode`, defínelo con `Object.defineProperty`.
- **Pulsaciones muy cortas.** Un gesto en modo "toque" llega como tecla abajo y arriba seguidas. Si consultas el estado de las teclas una vez por fotograma, mantén la tecla un mínimo (el SDK usa 80 ms).
- **Dónde escuchas.** El evento se despacha sobre el elemento con el foco y sube hasta `document` y `window`. Si escuchas en un `<canvas>` que no tiene el foco, no te llega.

Estos eventos no cuentan como una acción real del usuario para el navegador (`isTrusted` es `false`). Sirven para tu lógica de juego, pero no para lo que exige un gesto real: entrar en pantalla completa, desbloquear el audio o copiar al portapapeles.

#### Toques y acciones mantenidas

Cada acción tiene un principio y un final. `VOUT_ACTION` llega cuando el usuario empieza el gesto y `VOUT_ACTION_END`, con el mismo `event`, cuando lo deja.

- Si tu juego funciona a toques (saltar), quédate con `VOUT_ACTION` e ignora el final.
- Si tiene mecánicas de mantener (planear, un propulsor), empieza con `VOUT_ACTION` y para con `VOUT_ACTION_END`.

Dos detalles que conviene saber:

- **El final no llega igual de rápido para todos los gestos.** Con la cabeza (arriba, abajo, a los lados) es inmediato. Con un gesto de la cara (cejas, boca) llega entre 0,6 y 0,75 segundos después de que el usuario relaje el gesto, porque el portal lo deduce al dejar de verlo. Para una acción que hay que soltar con precisión, la cabeza funciona mejor. Pasa lo mismo al soltar una tecla mantenida: con un gesto de la cara, el `VOUT_KEY` de soltar llega alrededor de medio segundo tarde.
- **Dos gestos pueden mantener la misma acción.** En el preset `runner`, tanto levantar las cejas como subir la cabeza emiten `JUMP`. Puedes recibir dos `VOUT_ACTION` seguidos del mismo evento; el `VOUT_ACTION_END` llega una sola vez, cuando el usuario suelta el último.

El portal cierra siempre lo que abre: si el usuario apaga la cámara, cambia de pestaña o cambia de preset con una acción en curso, recibes su `VOUT_ACTION_END`.

#### Cuándo ocurrió el gesto

`at` te dice cuándo pasó de verdad, en milisegundos Unix del reloj del navegador (el mismo que tu `Date.now()`, porque el portal y tu juego corren en el mismo equipo). Entre el gesto y el mensaje pasa el tiempo de analizar la imagen; con `at` puedes descontarlo, algo útil en un juego de ritmo.

- En `VOUT_ACTION`, `at` es el instante de la imagen de cámara en la que el portal vio empezar el gesto.
- En `VOUT_ACTION_END`, es la mejor estimación de cuándo terminó: la imagen en la que la cabeza salió de la zona, o la última en la que se vio el gesto de la cara.

Trátalo como una pista y acótalo: si `at` queda en el futuro o más de un par de segundos atrás, usa el momento en que te llegó el mensaje.

El usuario también puede mapear un gesto a un evento con el nombre que quiera, y te llegará tal cual en `event`. Trátalo como texto que no controlas: compáralo contra tu lista de acciones y descarta el resto.

### Ejemplo mínimo sin el SDK

```js
// El origen del portal, fijo en tu configuración. Nunca lo deduzcas del mensaje.
const VOUT_ORIGIN = 'https://vout.app';

let session = null;

window.addEventListener('message', (event) => {
    if (event.origin !== VOUT_ORIGIN || event.source !== window.parent) return;

    const message = event.data;
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
        case 'VOUT_AUTH':
            // Llega tras READY y en cada renovación: quédate con el último.
            session = { token: message.token, expiresAt: message.expiresAt };
            // Mándalo a tu backend y valídalo allí (firma, iss, aud, exp).
            break;
        case 'VOUT_SESSION_END':
            // No habrá más renovaciones: suelta la identidad.
            session = null;
            break;
        case 'VOUT_ACTION':
            // message.at: cuándo empezó el gesto (ms Unix).
            if (message.event === 'JUMP') startJump(message.at);
            if (message.event === 'DUCK') startDuck(message.at);
            break;
        case 'VOUT_ACTION_END':
            // Solo te hace falta si tienes acciones que se mantienen.
            if (message.event === 'JUMP') endJump(message.at);
            if (message.event === 'DUCK') endDuck(message.at);
            break;
        case 'VOUT_KEY':
            // Una tecla del mapeo del usuario: conviértela en un evento real.
            onVoutKey(message);
            break;
        // VOUT_CLICK, VOUT_CURSOR y cualquier tipo desconocido: ignóralos si no los usas.
    }
});

// Repite READY hasta que llegue VOUT_AUTH, por si el portal aún no escuchaba.
(function announce() {
    if (session) return;
    window.parent.postMessage({ type: 'READY', suggestedPreset: 'runner' }, VOUT_ORIGIN);
    setTimeout(announce, 500);
})();

function exitToPortal() {
    window.parent.postMessage({ type: 'EXIT' }, VOUT_ORIGIN);
}
```

Para saber si estás embebido, comprueba `window.parent !== window`. Fuera del portal, usa el flujo OAuth normal.

### Reglas de seguridad

- **Origen exacto en las dos direcciones.** Al enviar, pasa el origen del portal como `targetOrigin`, nunca `'*'`. Al recibir, descarta todo mensaje cuyo `event.origin` no sea exactamente el del portal.
- **`voutId` y `username` son para pintar la interfaz, no para decidir nada.** Sirven para mostrar el nombre al instante. La identidad verificable es el claim `vout_id` del token, una vez validado.
- **Valida el token como cualquier otro:** firma contra el JWKS, `iss`, `aud` igual a tu `client_id` y `exp`. Hazlo en tu backend.
- **Guarda el token en memoria.** No lo escribas en `localStorage` ni lo pongas en una URL.

### Lo que el iframe no te deja hacer

El portal carga tu juego con `sandbox="allow-scripts allow-same-origin allow-orientation-lock"` y `allow="autoplay; fullscreen; clipboard-write; web-share"`. En la práctica:

- **Sí puedes:** ejecutar scripts, usar `fetch`, reproducir audio, entrar en pantalla completa, bloquear la orientación de la pantalla (estando en pantalla completa), copiar al portapapeles y abrir el diálogo de compartir del sistema. Estas dos últimas solo en respuesta a una acción del usuario, como un clic.
- **No puedes:** abrir ventanas emergentes, usar `alert()` o `confirm()`, enviar formularios HTML clásicos, leer el portapapeles ni navegar la ventana del portal. Para salir, envía `EXIT`.

---

## Preguntas Frecuentes

### ¿Necesito una librería específica de Vout?
**No.** Vout usa OAuth2 estándar. Cualquier librería OAuth2 compatible funciona. Para el juego embebido en el portal hay un SDK opcional (`/sdk/vout-game.js`) que te ahorra implementar el protocolo del iframe.

### ¿Qué pasa si mi juego no tiene backend?
Si tu juego es solo frontend (HTML/JS sin servidor), usa un cliente PKCE (`--public`) que no requiere `client_secret`. El flujo funciona directamente desde el navegador.

### ¿Puedo registrar mi app pero no usar autenticación?
**Sí.** Registra tu app con `requires_auth = false`. Aparecerá en el catálogo de Vout sin necesidad de OAuth2.

### ¿Puedo renovar el token desde dentro del iframe del portal?
**No cuentes con ello.** Embebido, tus cookies son de terceros y el navegador puede bloquearlas. El portal renueva el token por ti y te lo reenvía con otro `VOUT_AUTH` antes de que caduque el anterior (ver "Identidad dentro del iFrame").

### ¿Cómo se diferencia un proyecto propio de uno de terceros?
Las apps marcadas como `is_first_party = true` no muestran el prompt de autorización al usuario. El flujo OAuth2 es idéntico en ambos casos — la única diferencia es la experiencia de usuario.

---

## Soporte

Para registrar tu aplicación o resolver dudas técnicas, contacta al equipo de Vout.
