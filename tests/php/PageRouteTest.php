<?php
declare(strict_types=1);

/**
 * Direcciones de las pantallas del juego (T06, doc 10): `/niveles`,
 * `/niveles/mios` y `/niveles/{id}[-titulo]` sirven la misma página que `/`. Lo
 * único que cambia es lo que ve quien recibe el enlace: el título y la
 * descripción del nivel, solo si es público.
 *
 * Se pasa por el Router de verdad con `routes/web.php`: se prueban también las rutas.
 */

use App\Core\Request;
use App\Core\Response;
use App\Core\Router;
use App\Models\Level;

require_once __DIR__ . '/fixtures.php';

function page(string $path): Response
{
    $router = new Router();
    require __DIR__ . '/../../routes/web.php';
    return $router->dispatch(Request::make('GET', $path));
}

function pageTitle(Response $res): string
{
    return preg_match('#<title>(.*?)</title>#s', $res->body(), $m) === 1 ? $m[1] : '';
}

function metaContent(Response $res, string $attr, string $name): ?string
{
    $pattern = '#<meta ' . $attr . '="' . preg_quote($name, '#') . '" content="(.*?)">#s';
    return preg_match($pattern, $res->body(), $m) === 1 ? $m[1] : null;
}

function publicLevelTitled(string $title): Level
{
    $user = makeUser('autor-enlace');
    $level = Level::create([
        'user_id' => $user->id, 'title' => $title, 'duration_sec' => 157, 'difficulty' => 2,
        'generator_seed' => '1', 'audio_sha256' => sha('enlace-' . $title),
    ]);
    $level->setPublic(true, "levels/{$level->id}.mp3");
    return Level::findById($level->id);
}

test('direcciones: el catálogo y «Míos» sirven la página del juego', function (): void {
    foreach (['/niveles', '/niveles/mios'] as $path) {
        $res = page($path);
        assertSame(200, $res->status(), $path);
        assertSame('Niveles · Daino', pageTitle($res), $path);
        assertTrue(str_contains($res->body(), '<div id="app"'), "{$path}: es la página del juego");
        assertTrue(str_contains((string) $res->headerValue('Content-Security-Policy'), "frame-ancestors 'self'"), "{$path}: se puede incrustar donde la portada");
    }
    assertSame('Daino', pageTitle(page('/')));
});

test('direcciones: la ficha de un nivel público lleva su nombre, para quien recibe el enlace', function (): void {
    $level = publicLevelTitled('Canción de prueba');
    foreach (["/niveles/{$level->id}", "/niveles/{$level->id}-cancion-de-prueba", "/niveles/{$level->id}-lo-que-sea"] as $path) {
        $res = page($path);
        assertSame(200, $res->status(), $path);
        assertSame('Canción de prueba · Daino', pageTitle($res), $path);
        assertSame('Canción de prueba · Daino', metaContent($res, 'property', 'og:title'), $path);
        $description = (string) metaContent($res, 'name', 'description');
        assertTrue(str_contains($description, '«Canción de prueba»'), "{$path}: la descripción nombra el nivel");
        assertTrue(str_contains($description, 'Dificultad: Fácil · 2:37'), "{$path}: y dice cómo es ({$description})");
        assertSame($description, metaContent($res, 'property', 'og:description'), $path);
    }
});

test('direcciones: la dirección canónica de un nivel es la de su número, con el dominio de APP_URL', function (): void {
    $level = publicLevelTitled('Con dominio');
    $before = $_ENV['APP_URL'] ?? null;
    try {
        $_ENV['APP_URL'] = 'https://daino.example/';
        $res = page("/niveles/{$level->id}-con-dominio");
        assertSame("https://daino.example/niveles/{$level->id}", metaContent($res, 'property', 'og:url'));
        assertTrue(str_contains($res->body(), "<link rel=\"canonical\" href=\"https://daino.example/niveles/{$level->id}\">"), 'enlace canónico');

        // Un APP_URL que no es un origen no acaba en la página.
        $_ENV['APP_URL'] = 'javascript:alert(1)';
        assertSame(null, metaContent(page("/niveles/{$level->id}"), 'property', 'og:url'));
    } finally {
        if ($before === null) {
            unset($_ENV['APP_URL']);
        } else {
            $_ENV['APP_URL'] = $before;
        }
    }
});

test('direcciones: un nivel privado y uno que no existe reciben la misma página, sin su nombre', function (): void {
    $user = makeUser('autor-privado');
    $private = Level::create([
        'user_id' => $user->id, 'title' => 'Secreto de sumario', 'duration_sec' => 90, 'difficulty' => 3,
        'generator_seed' => '1', 'audio_sha256' => sha('privado-enlace'),
    ]);
    $missing = $private->id + 987654;

    $a = page("/niveles/{$private->id}-secreto-de-sumario");
    $b = page("/niveles/{$missing}");
    assertSame(200, $a->status());
    assertSame(200, $b->status());
    assertSame('Niveles · Daino', pageTitle($a));
    assertTrue(!str_contains($a->body(), 'Secreto de sumario'), 'el nombre de un nivel privado no sale en la página');
    assertSame($b->body(), $a->body(), 'desde fuera no se distingue un nivel privado de uno que no existe');
});

test('direcciones: el nombre del nivel va escapado', function (): void {
    $level = publicLevelTitled('<script>alert(1)</script> "x"');
    $res = page("/niveles/{$level->id}");
    assertTrue(!str_contains($res->body(), '<script>alert(1)</script>'), 'sin HTML del título en la página');
    assertTrue(str_contains($res->body(), '&lt;script&gt;alert(1)&lt;/script&gt;'), 'aparece escapado');
});

test('direcciones: lo que no es una dirección de Daino es un 404', function (): void {
    foreach (['/niveles/abc', '/niveles/0', '/niveles/-5', '/niveles/12/extra', '/otra-cosa', '/niveles/1e3'] as $path) {
        assertSame(404, page($path)->status(), $path);
    }
});
