<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Cookies;
use App\Core\Env;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Models\User;
use App\Services\JwksUnavailableException;
use App\Services\JwtVerifier;
use App\Services\PkceCookie;
use App\Services\UserProvisioner;
use App\Services\VoutAuthService;
use League\OAuth2\Client\Provider\Exception\IdentityProviderException;

/**
 * Auth flow contra Vout (OAuth2 Authorization Code + PKCE).
 *
 * Endpoints:
 *   GET  /auth/login     → genera state+verifier, redirect a Vout authorize.
 *   GET  /auth/callback  → valida state, intercambia code, valida JWT, /me, upsert User, sesión.
 *   POST /auth/logout    → destruye sesión + invalida cookie de refresh. Local-only.
 *   POST /auth/refresh   → usa cookie daino_refresh para renovar tokens.
 *   GET  /api/me/token   → devuelve access_token + csrf_token al frontend.
 *
 * Cómo dura una sesión: el access token de Vout vale 60 min; el refresh token
 * (cookie `daino_refresh`) y la sesión de Daino, 30 días contados desde el
 * último refresco. Mientras se entre al menos una vez cada 30 días no hay que
 * volver a iniciar sesión: el cliente pide un token nuevo con `/auth/refresh`
 * cuando `/api/me/token` o la API le dicen `must_refresh`.
 *
 * CSRF: las rutas POST se protegen con CsrfMiddleware en el router; este
 * controller asume que el middleware ya validó cuando llega.
 *
 * VoutAuthService, JwtVerifier y UserProvisioner son inyectables por
 * constructor para tests (sin tocar Vout real). En runtime, el Router
 * instancia con `new` sin args y los services usan `fromEnv()` lazy.
 */
final class AuthController
{
    /**
     * Con más de esto por delante, `/auth/refresh` devuelve el token de la
     * sesión en vez de pedir otro a Vout. Va a juego con `REFRESH_MARGIN_MS`
     * de `resources/js/api/client.js`: el cliente renueva justo por debajo.
     */
    private const REUSE_MARGIN_S = 60;

    public function __construct(
        private readonly ?VoutAuthService $vout = null,
        private readonly ?JwtVerifier $jwt = null,
        private readonly ?UserProvisioner $users = null,
    ) {
    }

    public function showLogin(Request $req): Response
    {
        $vout = $this->voutOrEnv();
        $authz = $vout->buildAuthorizationUrl();

        // PkceCookie en lugar de $_SESSION: vive aparte del SID, sobrevive a
        // rotaciones del DAINO_SESSID por strict_mode/cookies stale, y se
        // borra al consumirla en /auth/callback. Ver app/Services/PkceCookie.php.
        PkceCookie::set($authz['state'], $authz['code_verifier']);

        return Response::redirect($authz['url']);
    }

    public function callback(Request $req): Response
    {
        $code  = $req->query('code');
        $state = $req->query('state');
        $error = $req->query('error');

        // Caso "Cancelar" desde Vout: viene `?error=access_denied&state=...`
        // sin code. Es un flujo legítimo, no un error nuestro — limpiar la
        // PkceCookie y mandar al usuario al inicio sin alarma.
        if (is_string($error) && $error !== '') {
            PkceCookie::clear();
            return Response::html(
                '<!doctype html><html><body style="font-family:sans-serif;padding:2rem">'
                . '<h2>Login cancelado</h2>'
                . '<p>No autorizaste a Daino acceder a tu cuenta de Vout. '
                . '<a href="/">Volver al inicio</a> o <a href="/auth/login">probar de nuevo</a>.</p>'
                . '</body></html>',
                200,
            );
        }

        // Sub-bloque 3.5: state/verifier vienen de PkceCookie firmada, no de
        // $_SESSION. Sobrevive a rotaciones del SID. consume() borra la
        // cookie en cualquier caso (one-shot anti-replay).
        $pkce = PkceCookie::consume();

        // Fix #3 — redirect transparente cuando el flow OAuth llega "frío":
        // cookie ausente, expirada (10 min sin completar), firma rota o
        // usuario llegó al callback directamente sin pasar por /auth/login.
        // En lugar de mostrar "Sesión OAuth expirada — vuelve a /auth/login"
        // (que se lee como error), simplemente reiniciamos el flow.
        if ($pkce === null
            || !is_string($code) || $code === ''
            || !is_string($state) || $state === ''
        ) {
            return Response::redirect('/auth/login');
        }

        if (!hash_equals($pkce['state'], $state)) {
            return Response::html('State mismatch — posible CSRF en flow OAuth.', 403);
        }

        $vout = $this->voutOrEnv();
        $verifier = $this->jwtOrEnv();

        try {
            $accessToken = $vout->exchangeCodeForToken($code, $pkce['verifier']);
            $verifier->verify($accessToken->getToken());
            $info = $vout->fetchUserInfo($accessToken->getToken());
        } catch (\Throwable $e) {
            // Auditoría Bloque 3 — BAJO: detalle solo en debug; loggear siempre.
            error_log('[daino] OAuth callback error: ' . $e->getMessage());
            $debug = Env::bool('APP_DEBUG', false);
            $detail = $debug ? ' — ' . htmlspecialchars($e->getMessage()) : '';
            return Response::html('Login con Vout falló — vuelve a intentarlo' . $detail, 502);
        }

        $user = UserProvisioner::fromProfile($info);
        $user->update(['last_login_at' => date('Y-m-d H:i:s')]);

        Session::regenerate();
        Session::set('user_id', $user->id);
        Session::set('vout_id', $user->voutId);
        Session::set('access_token', $accessToken->getToken());
        $expiresAt = $accessToken->getExpires() ?? (time() + 3600);
        Session::set('access_token_expires_at', $expiresAt);

        $refresh = $accessToken->getRefreshToken();
        if (is_string($refresh) && $refresh !== '') {
            $this->setRefreshCookie($refresh);
        }

        return Response::redirect('/');
    }

    /**
     * Renueva el access token con el refresh token de la cookie `daino_refresh`
     * (HttpOnly, Path=/auth/refresh). Requiere CSRF (header).
     *
     * Respuestas, y qué hace el cliente con cada una:
     *   - 200: token nuevo (mismo contrato que `/api/me/token`).
     *   - 401 `session_expired`: la sesión se acabó de verdad (Vout ya no
     *     acepta el refresh token, o no hay). Hay que iniciar sesión otra vez.
     *   - 503 `idp_unavailable`: Vout no contesta o contesta mal. La sesión y
     *     el refresh token siguen intactos: se reintenta más tarde.
     *
     * Solo `invalid_grant` cierra la sesión. Antes la cerraba cualquier fallo,
     * también un Vout apagado: se tiraba un refresh token que seguía valiendo.
     */
    public function refresh(Request $req): Response
    {
        if (!Session::has('vout_id')) {
            return self::sessionExpired();
        }

        // Vout da un refresh token nuevo en cada uso e invalida el anterior. Si
        // otra pestaña acaba de renovar, esta petición trae la cookie vieja:
        // canjearla daría `invalid_grant` y cerraría una sesión buena. PHP
        // atiende las peticiones de una misma sesión de una en una, así que al
        // llegar aquí el token de la otra pestaña ya está en la sesión.
        $live = $this->liveSessionToken();
        if ($live !== null) {
            return Response::json($live);
        }

        $refresh = $_COOKIE['daino_refresh'] ?? null;
        if (!is_string($refresh) || $refresh === '') {
            // Sesión identificada sin forma de renovarla: no sirve para nada.
            Session::destroy();
            return self::sessionExpired();
        }

        try {
            $newToken = $this->voutOrEnv()->refresh($refresh);
        } catch (IdentityProviderException $e) {
            if (self::extractOAuthError($e) === 'invalid_grant') {
                // El usuario revocó Daino en Vout, el refresh token caducó
                // (30 días) o ya se había canjeado.
                $this->clearRefreshCookie();
                Session::destroy();
                return self::sessionExpired();
            }
            error_log('[daino] refresh: Vout respondió con error: ' . $e->getMessage());
            return self::idpUnavailable();
        } catch (\Throwable $e) {
            error_log('[daino] refresh: Vout no contesta: ' . $e->getMessage());
            return self::idpUnavailable();
        }

        // Desde aquí el refresh token anterior ya no vale: el nuevo se guarda
        // ANTES de cualquier otra cosa que pueda fallar, o se pierde la cadena.
        $newRefresh = $newToken->getRefreshToken();
        if (is_string($newRefresh) && $newRefresh !== '') {
            $this->setRefreshCookie($newRefresh);
        }

        $accessToken = $newToken->getToken();
        try {
            $claims = $this->jwtOrEnv()->verify($accessToken);
        } catch (\Throwable $e) {
            error_log('[daino] refresh: el token nuevo no se pudo verificar: ' . $e->getMessage());
            return self::idpUnavailable();
        }

        $voutId = $claims['vout_id'] ?? null;
        if (!is_string($voutId) || $voutId !== Session::get('vout_id')) {
            // Un refresh token que da la identidad de otra persona no renueva esta sesión.
            error_log('[daino] refresh: el token nuevo no es del usuario de la sesión.');
            $this->clearRefreshCookie();
            Session::destroy();
            return self::sessionExpired();
        }
        $user = User::findByVoutId($voutId) ?? $this->usersOrDefault()->fromToken($accessToken, $voutId);
        if ($user === null) {
            return self::idpUnavailable();
        }

        $expiresAt = $newToken->getExpires() ?? (time() + 3600);
        Session::set('user_id', $user->id);
        Session::set('access_token', $accessToken);
        Session::set('access_token_expires_at', $expiresAt);
        Session::keepAlive();

        return Response::json(self::tokenPayload($user, $accessToken, $expiresAt));
    }

    public function logout(Request $req): Response
    {
        Session::destroy();
        $this->clearRefreshCookie();
        return Response::redirect('/');
    }

    /**
     * Entrega del access_token al frontend en standalone. Cookie de sesión
     * (DAINO_SESSID) es la auth aquí; el Bearer no aplica todavía. Devuelve
     * también el csrf_token para que el frontend lo use en /auth/refresh y
     * /auth/logout.
     *
     * Bloque 6: el response 200 incluye `user: {vout_id, username, avatar_url}`
     * para que el HUD/menú pueda hidratar el chip de identidad en una sola
     * llamada al boot. Cambio aditivo — bridge.js solo lee `access_token`.
     *
     * Un 401 con `must_refresh` NO es "sin sesión": la sesión sigue viva y solo
     * le falta un token nuevo. El cliente lo pide con `/auth/refresh` (por eso
     * va el `csrf_token` en la respuesta).
     */
    public function meToken(Request $req): Response
    {
        $voutId = Session::get('vout_id');
        if (!is_string($voutId) || $voutId === '') {
            return Response::json(['error' => 'unauthenticated'], 401);
        }
        $expiresAt = (int) (Session::get('access_token_expires_at') ?? 0);
        $accessToken = Session::get('access_token');
        if (!is_string($accessToken) || $expiresAt <= time()) {
            return self::mustRefresh('token_expired');
        }

        // Auditoría Bloque 3 — MEDIO: re-validar firma/iss/aud/exp antes de
        // entregar el token al frontend. JWKS está cacheado, coste despreciable.
        // Cubre escenarios de rotación de claves Vout, sesión manipulada o
        // token revocado entre callback y request al frontend.
        try {
            $this->jwtOrEnv()->verify($accessToken);
        } catch (JwksUnavailableException $e) {
            // No se pudo comprobar, que no es lo mismo que un token malo.
            error_log('[daino] JWKS de Vout no disponible: ' . $e->getMessage());
            return self::idpUnavailable();
        } catch (\Throwable) {
            Session::set('access_token', null);
            Session::set('access_token_expires_at', 0);
            return self::mustRefresh('token_invalid');
        }

        // La identidad de la sesión es su `vout_id`, no `user_id`: si la base de
        // datos se vació, un id puede ser ya de otra persona. Sin ficha, se
        // rehace con el perfil de Vout en vez de cerrar la sesión.
        $user = User::findByVoutId($voutId) ?? $this->usersOrDefault()->fromToken($accessToken, $voutId);
        if ($user === null) {
            Session::destroy();
            return Response::json(['error' => 'user_missing'], 401);
        }
        Session::set('user_id', $user->id);

        return Response::json(self::tokenPayload($user, $accessToken, $expiresAt));
    }

    /**
     * Lo que recibe el cliente con un token válido, igual desde `/api/me/token`
     * que desde `/auth/refresh`. `expires_in` (segundos que le quedan) es lo que
     * usa para saber cuándo renovar: no depende de que su reloj y el del servidor
     * marquen la misma hora.
     *
     * @return array{access_token: string, expires_at: int, expires_in: int, csrf_token: string, user: array{vout_id: string, username: string, avatar_url: ?string}}
     */
    private static function tokenPayload(User $user, string $accessToken, int $expiresAt): array
    {
        return [
            'access_token' => $accessToken,
            'expires_at'   => $expiresAt,
            'expires_in'   => max(0, $expiresAt - time()),
            'csrf_token'   => Session::csrfToken(),
            'user'         => $user->publicProfile(),
        ];
    }

    /**
     * El token de la sesión, si todavía le queda margen de sobra.
     *
     * @return array<string, mixed>|null
     */
    private function liveSessionToken(): ?array
    {
        $accessToken = Session::get('access_token');
        $expiresAt = (int) (Session::get('access_token_expires_at') ?? 0);
        $voutId = Session::get('vout_id');
        if (!is_string($accessToken) || $accessToken === '' || !is_string($voutId)
            || $expiresAt - time() <= self::REUSE_MARGIN_S
        ) {
            return null;
        }
        $user = User::findByVoutId($voutId);
        return $user === null ? null : self::tokenPayload($user, $accessToken, $expiresAt);
    }

    private static function mustRefresh(string $error): Response
    {
        return Response::json([
            'error'        => $error,
            'must_refresh' => true,
            'csrf_token'   => Session::csrfToken(),
        ], 401);
    }

    private static function sessionExpired(): Response
    {
        return Response::json(['error' => 'session_expired'], 401);
    }

    private static function idpUnavailable(): Response
    {
        return Response::json(['error' => 'idp_unavailable'], 503);
    }

    /**
     * Extrae el `error` (RFC 6749) del body de una IdentityProviderException
     * de league/oauth2-client. Vout responde con
     *   400 {"error":"invalid_grant","error_description":"...","hint":"..."}
     * y league lo guarda en getResponseBody(): puede llegar como array (ya
     * decodeado) o como string. Devolvemos null si no se puede extraer.
     */
    private static function extractOAuthError(IdentityProviderException $e): ?string
    {
        $body = $e->getResponseBody();
        if (is_array($body)) {
            $err = $body['error'] ?? null;
            return is_string($err) ? $err : null;
        }
        if (is_string($body) && $body !== '') {
            try {
                $decoded = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
                $err = is_array($decoded) ? ($decoded['error'] ?? null) : null;
                return is_string($err) ? $err : null;
            } catch (\JsonException) {
                return null;
            }
        }
        return null;
    }

    private function voutOrEnv(): VoutAuthService
    {
        return $this->vout ?? VoutAuthService::fromEnv();
    }

    private function jwtOrEnv(): JwtVerifier
    {
        return $this->jwt ?? JwtVerifier::fromEnv();
    }

    private function usersOrDefault(): UserProvisioner
    {
        return $this->users ?? new UserProvisioner($this->vout);
    }

    private function setRefreshCookie(string $refreshToken): void
    {
        Cookies::set('daino_refresh', $refreshToken, self::refreshCookieAttrs(time() + 30 * 24 * 3600));
    }

    /**
     * Borra `daino_refresh` reusando EXACTAMENTE los mismos atributos de
     * seguridad (path, secure, httponly, samesite) que setRefreshCookie.
     * Sin esto, navegadores con cookies "Strict-by-default" pueden rehusar
     * sobreescribir la cookie y dejar el refresh_token vivo hasta su expiry
     * natural (30 días). Auditoría Bloque 3 — ALTO.
     */
    private function clearRefreshCookie(): void
    {
        Cookies::set('daino_refresh', '', self::refreshCookieAttrs(time() - 3600));
    }

    /**
     * @return array{expires: int, path: string, secure: bool, httponly: bool, samesite: string}
     */
    private static function refreshCookieAttrs(int $expires): array
    {
        $secure = Env::string('APP_ENV', 'production') !== 'local';
        return [
            'expires'  => $expires,
            'path'     => '/auth/refresh',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ];
    }
}
