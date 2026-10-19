<?php
declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/**
 * Wrapper sobre $_SESSION con cookie segura y helpers CSRF.
 *
 * Driver: archivos en storage/sessions/ (gitignored). PKCE `code_verifier`
 * y `state` del flujo OAuth2 viven aquí — NUNCA en cookies, localStorage
 * ni URLs (CLAUDE.md, Architectural invariants).
 *
 * Cookie: HttpOnly, SameSite=Lax, Secure activo si APP_ENV != local.
 *
 * Con Secure se llama `__Host-DAINO_SESSID`: el navegador solo acepta una
 * cookie con ese nombre si la pone este mismo host, por HTTPS, con Path=/ y sin
 * Domain. En producción Daino vive en daino.vout.tech junto a otras apps del
 * mismo dominio; una de ellas podría escribir una cookie `DAINO_SESSID` con
 * Domain=.vout.tech y el navegador la mandaría aquí. Con el prefijo no puede.
 */
final class Session
{
    private const COOKIE_NAME = 'DAINO_SESSID';
    private const HOST_PREFIX = '__Host-';
    private const CSRF_KEY = '_csrf_token';

    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $sessionPath = realpath(__DIR__ . '/../../storage/sessions');
        if ($sessionPath === false) {
            throw new RuntimeException('storage/sessions/ no existe — créala antes de arrancar la sesión.');
        }

        $lifetimeMin = Env::int('SESSION_LIFETIME_MIN', 120);
        $secure = Env::string('APP_ENV', 'production') !== 'local';

        session_save_path($sessionPath);
        session_name(self::cookieName($secure));
        session_set_cookie_params([
            'lifetime' => $lifetimeMin * 60,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) ($lifetimeMin * 60));

        session_start();
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return $_SESSION[$key] ?? $default;
    }

    public static function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public static function pull(string $key, mixed $default = null): mixed
    {
        $value = $_SESSION[$key] ?? $default;
        unset($_SESSION[$key]);
        return $value;
    }

    public static function has(string $key): bool
    {
        return isset($_SESSION[$key]);
    }

    public static function regenerate(): void
    {
        session_regenerate_id(true);
        // Token CSRF rotado tras login/logout para evitar fixation.
        unset($_SESSION[self::CSRF_KEY]);
    }

    public static function destroy(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            Cookies::set(session_name(), '', self::cookieAttrs(time() - 42000));
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    /**
     * Vuelve a enviar la cookie de sesión con la caducidad contada desde ahora.
     *
     * PHP solo la envía al crear la sesión, así que caducaba a los
     * SESSION_LIFETIME_MIN del login aunque se entrase a diario, mientras que la
     * cookie del refresh token se renueva en cada refresco: las dos tienen que
     * caducar a la vez. Se llama al renovar el access token.
     */
    public static function keepAlive(): void
    {
        $id = session_id();
        if (!is_string($id) || $id === '') {
            return;
        }
        $lifetime = (int) session_get_cookie_params()['lifetime'];
        Cookies::set(session_name(), $id, self::cookieAttrs($lifetime > 0 ? time() + $lifetime : 0));
    }

    /**
     * El prefijo `__Host-` exige Secure: en local (HTTP) el navegador rechazaría
     * la cookie, así que allí va sin él.
     */
    private static function cookieName(bool $secure): string
    {
        return $secure ? self::HOST_PREFIX . self::COOKIE_NAME : self::COOKIE_NAME;
    }

    /**
     * @return array{expires: int, path: string, domain: string, secure: bool, httponly: bool, samesite: string}
     */
    private static function cookieAttrs(int $expires): array
    {
        $params = session_get_cookie_params();
        return [
            'expires'  => $expires,
            'path'     => $params['path'],
            'domain'   => $params['domain'],
            'secure'   => $params['secure'],
            'httponly' => $params['httponly'],
            'samesite' => $params['samesite'] ?? 'Lax',
        ];
    }

    /**
     * Token CSRF único por sesión. Se genera la primera vez y se reutiliza
     * hasta que se llame a regenerate().
     */
    public static function csrfToken(): string
    {
        if (!isset($_SESSION[self::CSRF_KEY])) {
            $_SESSION[self::CSRF_KEY] = bin2hex(random_bytes(32));
        }
        return (string) $_SESSION[self::CSRF_KEY];
    }

    public static function validateCsrf(string $token): bool
    {
        $stored = $_SESSION[self::CSRF_KEY] ?? null;
        if (!is_string($stored) || $stored === '') {
            return false;
        }
        return hash_equals($stored, $token);
    }
}
