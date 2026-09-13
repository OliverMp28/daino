<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Env;
use App\Core\Request;
use App\Core\Response;
use App\Core\View;

/**
 * Sirve la única ruta HTML server-rendered del juego: `GET /`.
 *
 * Pública por diseño. Daino se juega sin login obligatorio (decisión Bloque 4):
 * cualquiera puede entrar al menú, soltar un MP3 y jugar. Login (vía Vout) solo
 * desbloquea features secundarias — submit de ranking global, comentar, subir
 * MP3 público — que se cablearán en Bloque 7 con AuthMiddleware en sus rutas
 * API correspondientes.
 */
final class HomeController
{
    public function index(Request $req): Response
    {
        $voutOrigin = Env::string('VOUT_ORIGIN', '');
        $html = View::render('pages.home', [
            'title'       => 'Daino',
            'voutOrigin'  => $voutOrigin,
            'uploadMaxMb' => Env::int('UPLOAD_MAX_SIZE_MB', 10),
        ]);

        // Quién puede embeber Daino (Ola 2, defecto D21). Nginx envía
        // `X-Frame-Options: SAMEORIGIN` a todo, y eso impedía que Vout —otro
        // origen— mostrara el juego en su iframe: el modo embebido entero era
        // inalcanzable. X-Frame-Options no admite listas de orígenes;
        // `frame-ancestors` sí, y los navegadores que lo entienden ignoran
        // X-Frame-Options cuando está presente (CSP nivel 2). Los que no lo
        // entienden siguen protegidos por la cabecera de nginx.
        return Response::html($html)
            ->header('Content-Security-Policy', 'frame-ancestors ' . self::frameAncestors($voutOrigin));
    }

    /**
     * `'self'` más el origen de Vout, solo si es un origen bien formado
     * (esquema http/https + host + puerto opcional). Un valor raro en el .env
     * nunca debe acabar inyectado en una cabecera.
     */
    public static function frameAncestors(string $voutOrigin): string
    {
        $isOrigin = preg_match('#^https?://[a-z0-9.-]+(:\d{1,5})?$#i', $voutOrigin) === 1;
        return $isOrigin ? "'self' {$voutOrigin}" : "'self'";
    }
}
