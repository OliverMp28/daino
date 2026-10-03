<?php
declare(strict_types=1);

/**
 * Rutas web (HTML, sesión).
 *
 * El front controller (public/index.php) ya creó $router. NO crear uno nuevo.
 *
 * @var \App\Core\Router $router
 */

// Home pública — Daino se juega sin login obligatorio (decisión Bloque 4).
// El AuthMiddleware se aplicará en Bloque 7 a los endpoints API que requieran
// identidad (submit ranking, comentar, subir MP3 público).
$router->get('/', 'HomeController@index');

// Direcciones de las pantallas del juego (T06). Es la misma página: qué se abre
// lo decide el cliente (resources/js/ui/routeModel.js). El servidor solo pone el
// título y la descripción del nivel para quien recibe el enlace.
$router->get('/niveles', 'HomeController@levels');
$router->get('/niveles/{ref}', 'HomeController@level');

// --- OAuth flow contra Vout ----------------------------------------------
// CSRF aplica solo a POST/PUT/PATCH/DELETE. /auth/login y /auth/callback son
// GET — el `state` OAuth ya nos protege contra CSRF en esos.
$router->get('/auth/login',    'AuthController@showLogin');
$router->get('/auth/callback', 'AuthController@callback');
$router->post('/auth/logout',  'AuthController@logout')->middleware('CsrfMiddleware');
$router->post('/auth/refresh', 'AuthController@refresh')->middleware('CsrfMiddleware');
