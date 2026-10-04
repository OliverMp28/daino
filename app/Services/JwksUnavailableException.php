<?php
declare(strict_types=1);

namespace App\Services;

use RuntimeException;

/**
 * No se pudieron obtener las claves públicas de Vout (no contesta, o contesta
 * algo que no es un JWKS) y no hay copia local que sirva.
 *
 * Es un fallo del proveedor de identidad, NO del token: quien lo atrapa
 * responde 503 y deja la sesión como está, en vez de dar el token por inválido.
 * El mensaje lleva la URL interna de Vout: va al log, nunca al cliente.
 */
final class JwksUnavailableException extends RuntimeException
{
}
