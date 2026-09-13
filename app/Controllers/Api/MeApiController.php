<?php
declare(strict_types=1);

namespace App\Controllers\Api;

use App\Core\AuthContext;
use App\Core\Request;
use App\Core\Response;

/**
 * GET /api/me — identidad del portador del Bearer (Ola 2, defecto D12).
 *
 * En modo standalone la identidad llega con `/api/me/token`, que usa la cookie
 * de sesión. Embebido en Vout no hay sesión de Daino: el token llega por
 * postMessage y hasta aquí nada lo traducía a un usuario, así que "Mis niveles"
 * y el guardado de progreso no existían dentro del iframe. Este endpoint cierra
 * ese hueco con el mismo contrato de usuario que `/api/me/token`.
 */
final class MeApiController
{
    public function show(Request $req): Response
    {
        return Response::json(['user' => AuthContext::user()->publicProfile()]);
    }
}
