<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Core\AuthContext;
use App\Core\Env;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Models\User;
use App\Services\JwksUnavailableException;
use App\Services\JwtVerifier;
use App\Services\UserProvisioner;
use Closure;

/**
 * AuthMiddleware — gating de rutas autenticadas.
 *
 *  - Rutas API (path empieza por `/api/`): exige `Authorization: Bearer <jwt>`
 *    válido. Falla con 401 JSON si falta o no verifica.
 *  - Rutas web: exige sesión iniciada (`vout_id` en `$_SESSION`). Si falta,
 *    redirige a `/auth/login`.
 *
 * El usuario autenticado queda en `AuthContext`; los controllers lo leen de ahí.
 *
 * Qué significa cada respuesta para el cliente (`resources/js/api/client.js`):
 *   - 401 `invalid_token` + `must_refresh`: el token no vale (lo normal: caducó).
 *     Pide otro con `/auth/refresh` y reintenta.
 *   - 503 `idp_unavailable`: no se pudo comprobar porque Vout no contesta. El
 *     token puede ser bueno: no hay que renovar ni cerrar sesión.
 *   - 401 `user_missing`: token bueno, pero no hay ficha local ni Vout da el perfil.
 *
 * JwtVerifier y UserProvisioner son inyectables para tests; por defecto se
 * construyen desde el entorno la primera vez que se necesitan.
 */
final class AuthMiddleware
{
    public function __construct(
        private readonly ?JwtVerifier $verifier = null,
        private readonly ?UserProvisioner $users = null,
    ) {
    }

    public function __invoke(Request $req, Closure $next): Response
    {
        $isApi = str_starts_with($req->path(), '/api/');

        if ($isApi) {
            $token = $req->bearerToken();
            if ($token === null) {
                return Response::json(
                    ['error' => 'unauthorized', 'message' => 'Missing Bearer token.'],
                    401,
                );
            }
            try {
                $claims = ($this->verifier ?? JwtVerifier::fromEnv())->verify($token);
            } catch (JwksUnavailableException $e) {
                error_log('[daino] JWKS de Vout no disponible: ' . $e->getMessage());
                return Response::json(['error' => 'idp_unavailable'], 503);
            } catch (\Throwable $e) {
                // El motivo exacto solo en debug: no le sirve a un cliente y
                // sí a quien tantea tokens.
                $body = ['error' => 'invalid_token', 'must_refresh' => true];
                if (Env::bool('APP_DEBUG', false)) {
                    $body['message'] = $e->getMessage();
                }
                return Response::json($body, 401);
            }

            // Resolver el User local desde el claim `vout_id` del JWT.
            // Vout incluye este UUID directamente en el token (ver
            // integration-guide §"Datos dentro del Token"), así que el
            // lookup es directo contra la columna indexada `users.vout_id`
            // sin round-trip a `/api/v1/user/me`. La guía recomienda
            // explícitamente este patrón sobre el `sub` (que puede cambiar
            // de formato en el futuro).
            $voutId = $claims['vout_id'] ?? null;
            if (!is_string($voutId) || $voutId === '') {
                return Response::json(
                    ['error' => 'invalid_token', 'message' => 'JWT sin claim `vout_id`.'],
                    401,
                );
            }
            // Sin ficha local: quien entra por el portal de Vout sin haber
            // pasado nunca por /auth/callback. Se le da de alta con su perfil.
            $user = User::findByVoutId($voutId)
                ?? ($this->users ?? new UserProvisioner())->fromToken($token, $voutId);
            if ($user === null) {
                return Response::json(
                    ['error' => 'user_missing', 'message' => 'No se pudo obtener el perfil del usuario.'],
                    401,
                );
            }
            AuthContext::set($user);

            return $next($req);
        }

        // Web mode
        if (!Session::has('vout_id')) {
            return Response::redirect('/auth/login');
        }
        return $next($req);
    }
}
