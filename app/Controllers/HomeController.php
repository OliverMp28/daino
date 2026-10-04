<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Env;
use App\Core\Request;
use App\Core\Response;
use App\Core\View;
use App\Models\Level;

/**
 * Sirve la página del juego. Es una sola (el menú, el catálogo y la partida son
 * estados de la misma aplicación), pero tiene varias direcciones (T06):
 *
 *   /                      el menú
 *   /niveles               el catálogo
 *   /niveles/mios          el catálogo, en «Míos»
 *   /niveles/12-one-day    la ficha de un nivel: lo que se comparte
 *
 * Qué se enseña en cada una lo decide el cliente (resources/js/ui/routeModel.js);
 * aquí solo cambia lo que ve quien NO ejecuta el juego: el título de la pestaña y
 * la descripción con la que una aplicación de mensajería presenta el enlace.
 *
 * Pública por diseño. Daino se juega sin login obligatorio (decisión Bloque 4):
 * cualquiera puede entrar al menú, soltar un MP3 y jugar. Login (vía Vout) solo
 * desbloquea features secundarias — submit de ranking global, comentar, subir
 * MP3 público — que se cablearon en el Bloque 7 con AuthMiddleware en sus rutas
 * API correspondientes.
 */
final class HomeController
{
    private const DESCRIPTION = 'Daino es un juego de ritmo donde cada nivel es una canción: salta, agáchate y vuela al compás.';

    /** Los nombres de las dificultades, como en el juego (resources/js/game/levels/difficulty.js). */
    private const DIFFICULTY_NAMES = [1 => 'Relajado', 2 => 'Fácil', 3 => 'Normal', 4 => 'Difícil', 5 => 'Extremo'];

    public function index(Request $req): Response
    {
        return self::page('Daino', self::DESCRIPTION, '/');
    }

    /** `/niveles`: el catálogo. */
    public function levels(Request $req): Response
    {
        return self::catalogPage();
    }

    /**
     * `/niveles/{ref}`: «Míos» o la ficha de un nivel (`12` o `12-su-titulo`; lo
     * que sigue al número es solo para leerlo).
     *
     * Un nivel privado y uno que no existe reciben LA MISMA página, la del
     * catálogo: desde fuera no se puede saber cuál de los dos es. El juego dirá
     * "no existe o no está publicado" (o lo abrirá, si quien mira es su autor).
     *
     * @param array<string, string> $params
     */
    public function level(Request $req, array $params): Response
    {
        $ref = $params['ref'] ?? '';
        if ($ref === 'mios') {
            return self::catalogPage();
        }
        if (preg_match('/^([1-9]\d{0,9})(?:-.*)?$/', $ref, $m) !== 1) {
            return new Response('Not Found', 404, ['content-type' => 'text/plain; charset=utf-8']);
        }

        $level = Level::findById((int) $m[1]);
        if ($level === null || !$level->isPublic) {
            return self::catalogPage();
        }

        $difficulty = self::DIFFICULTY_NAMES[$level->difficulty] ?? null;
        $facts = array_filter([
            $difficulty === null ? null : "Dificultad: {$difficulty}",
            sprintf('%d:%02d', intdiv($level->durationSec, 60), $level->durationSec % 60),
        ]);
        return self::page(
            "{$level->title} · Daino",
            "Juega «{$level->title}» en Daino, el juego de ritmo donde cada nivel es una canción. " . implode(' · ', $facts) . '.',
            "/niveles/{$level->id}",
        );
    }

    private static function catalogPage(): Response
    {
        return self::page('Niveles · Daino', self::DESCRIPTION, '/niveles');
    }

    /**
     * @param string $path  Dirección canónica de la página (sin dominio).
     */
    private static function page(string $title, string $description, string $path): Response
    {
        $voutOrigin = Env::string('VOUT_ORIGIN', '');
        $appUrl = rtrim(Env::string('APP_URL', ''), '/');
        $html = View::render('pages.home', [
            'title'        => $title,
            'description'  => $description,
            // Sin APP_URL no hay dirección absoluta que dar: se omite.
            'canonicalUrl' => self::isOrigin($appUrl) ? $appUrl . $path : '',
            'voutOrigin'   => $voutOrigin,
            'uploadMaxMb'  => Env::int('UPLOAD_MAX_SIZE_MB', 10),
        ]);

        // Quién puede embeber Daino (Ola 2, defecto D21): ella misma y el portal
        // de Vout. `X-Frame-Options` no admite listas de orígenes; `frame-ancestors`
        // sí. Nginx deja de mandar X-Frame-Options a las respuestas que traen esta
        // cabecera (docker/nginx/default.conf): la guía de Vout pide no enviar las
        // dos.
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
        return self::isOrigin($voutOrigin) ? "'self' {$voutOrigin}" : "'self'";
    }

    private static function isOrigin(string $value): bool
    {
        return preg_match('#^https?://[a-z0-9.-]+(:\d{1,5})?$#i', $value) === 1;
    }
}
