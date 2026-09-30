<?php
declare(strict_types=1);

/**
 * Rutas JSON. Prefijo /api.
 *
 * Reglas de autenticación:
 *   - Endpoints "públicos del shell" (e.g. health, /api/me/token) NO usan
 *     AuthMiddleware: dependen de la sesión/cookies del navegador, no de
 *     Bearer. /api/me/token tiene su propio guard de sesión adentro.
 *   - Endpoints "de dominio" (Bloque 7+) sí usan AuthMiddleware con Bearer.
 *   - Endpoints "de lectura pública" (ranking, niveles públicos, comentarios
 *     de un nivel) NO usan AuthMiddleware — un anónimo puede ver el
 *     leaderboard. La distinción está modelada como dos `$router->group`
 *     separados; ningún endpoint mezcla. "Auth opcional" siempre causa bugs.
 *   - SoftAuthMiddleware se usa SOLO en endpoints donde el comportamiento
 *     cambia con/sin sesión (e.g. GET /api/levels/{id}: público ve solo
 *     niveles `is_public=true`; el autor ve también los suyos privados).
 *     SoftAuth nunca devuelve 401 — solo populariza AuthContext si hay token.
 *
 * Sin CSRF en API JSON: el gating es por Bearer en `Authorization` header,
 * que el browser NO añade automáticamente cross-origin (a diferencia de
 * cookies). CSRF solo donde la auth es por cookie de sesión (logout,
 * refresh — ya cubierto en routes/web.php).
 *
 * @var \App\Core\Router $router
 */

use App\Core\Response;
use App\Core\Router;
use App\Middleware\AuthMiddleware;
use App\Middleware\SoftAuthMiddleware;

$router->group(['prefix' => '/api'], static function (Router $r): void {
    // -------- Públicos del shell --------
    $r->get('/health', static fn (): Response => Response::json([
        'status' => 'ok',
        'php'    => PHP_VERSION,
        'time'   => date('c'),
    ]));

    // Entrega del access_token al frontend (modo standalone). Auth = sesión.
    $r->get('/me/token', 'AuthController@meToken');

    // -------- Lectura pública sin sesión (sin Bearer requerido) --------
    $r->get('/ranking',  'Api\\RankingApiController@index');
    $r->get('/comments', 'Api\\CommentApiController@index');

    // -------- Lectura con auth opcional (SoftAuth) --------
    // El autor ve su propio nivel privado; los demás solo ven públicos.
    // El stream del MP3 funciona igual: solo `is_public=true` se entrega.
    $r->group(['middleware' => [SoftAuthMiddleware::class]], static function (Router $r): void {
        $r->get('/levels',           'Api\\LevelApiController@index');
        $r->get('/levels/{id}',       'Api\\LevelApiController@show');
        $r->get('/levels/{id}/chart', 'Api\\LevelApiController@chart');
        $r->get('/levels/{id}/ranking', 'Api\\LevelApiController@ranking');
        $r->get('/levels/{id}/file',  'Api\\LevelApiController@streamFile');
    });

    // -------- Mutación + lectura privada (Bearer obligatorio) --------
    $r->group(['middleware' => [AuthMiddleware::class]], static function (Router $r): void {
        // Identidad del Bearer: la usa el modo iframe, donde no hay cookie de sesión.
        $r->get('/me', 'Api\\MeApiController@show');

        $r->post('/progress', 'Api\\ProgressApiController@store');

        $r->post('/levels',                  'Api\\LevelApiController@store');
        $r->post('/levels/{id}/upload',      'Api\\LevelApiController@upload');
        $r->post('/levels/{id}/visibility',  'Api\\LevelApiController@visibility');
        // Ola 4: estado y reintento del análisis en servidor (solo el autor).
        $r->get('/levels/{id}/analysis',     'Api\\LevelApiController@analysisStatus');
        $r->post('/levels/{id}/analysis',    'Api\\LevelApiController@retryAnalysis');
        // Dificultad de un nivel listo para publicar (su autor la elige antes de
        // publicarlo; un nivel publicado tiene una sola).
        $r->post('/levels/{id}/difficulty',  'Api\\LevelApiController@changeDifficulty');
        // T02: escenario de un nivel propio, en cualquier estado (no toca el chart).
        $r->post('/levels/{id}/scene',       'Api\\LevelApiController@changeScene');

        $r->post('/comments', 'Api\\CommentApiController@store');
    });
});
