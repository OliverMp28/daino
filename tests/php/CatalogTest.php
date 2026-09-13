<?php
declare(strict_types=1);

/**
 * Tests de la Ola 2 en servidor: niveles oficiales, pestañas del catálogo,
 * datos de tarjeta sin N+1, ranking por nivel, identidad por Bearer (D12) y el
 * seed idempotente del catálogo oficial.
 *
 * La BD de desarrollo puede tener niveles reales (p. ej. los oficiales ya
 * sembrados): los tests comparan con lo que ellos mismos crean, nunca con
 * totales absolutos.
 */

use App\Controllers\Api\LevelApiController;
use App\Controllers\Api\MeApiController;
use App\Core\AuthContext;
use App\Core\Request;
use App\Core\ValidationException;
use App\Models\Level;
use App\Models\Progress;
use App\Services\OfficialCatalogSeeder;

require_once __DIR__ . '/fixtures.php';

// --------------------------- Fixtures ---------------------------

/**
 * @param array<string, mixed> $overrides
 */
function makeOfficial(string $slug, array $overrides = []): Level
{
    $s = sha("official-{$slug}");
    return Level::create(array_merge([
        'user_id'        => null,
        'title'          => "Oficial {$slug}",
        'duration_sec'   => 60,
        'difficulty'     => 3,
        'generator_seed' => '1',
        'audio_sha256'   => $s,
        'chart_json'     => json_encode(chartFor($s)),
        'chart_version'  => 1,
        'file_path'      => "official/{$slug}.mp3",
        'is_public'      => true,
        'is_official'    => true,
        'official_slug'  => "test-{$slug}",
    ], $overrides));
}

function makeUserLevel(\App\Models\User $user, string $name, bool $public): Level
{
    $level = Level::create([
        'user_id' => $user->id, 'title' => $name, 'duration_sec' => 60, 'difficulty' => 2,
        'generator_seed' => '1', 'audio_sha256' => sha("user-{$name}"),
    ]);
    if ($public) {
        $level->setPublic(true, "levels/{$level->id}.mp3");
    }
    return $level;
}

/**
 * @param array<string, string> $query
 * @return array<string, mixed>
 */
function listLevels(array $query): array
{
    return decode((new LevelApiController())->index(Request::make('GET', '/api/levels', [], $query)));
}

/**
 * @param list<array<string, mixed>> $items
 * @return list<int>
 */
function ids(array $items): array
{
    return array_map(static fn (array $i): int => $i['id'], $items);
}

// --------------------------- Esquema ---------------------------

test('un nivel oficial no tiene autor; uno de usuario sí debe tenerlo', function (): void {
    $official = makeOfficial('sin-autor');
    assertSame(null, Level::findById($official->id)->userId);

    assertThrows(\PDOException::class, fn () => Level::create([
        'user_id' => null, 'title' => 'huérfano', 'duration_sec' => 60, 'difficulty' => 1, 'generator_seed' => '1',
    ]));
});

test('la BD exige que un oficial esté publicado, con audio y slug único', function (): void {
    makeOfficial('unico');
    assertThrows(\PDOException::class, fn () => makeOfficial('otro', ['official_slug' => 'test-unico']), function (\PDOException $e): void {
        assertSame('23000', (string) $e->getCode());
    });
    assertThrows(\PDOException::class, fn () => makeOfficial('privado', ['is_public' => false, 'file_path' => null]));
    assertThrows(\PDOException::class, fn () => makeOfficial('sin-slug', ['official_slug' => null]));
    $user = makeUser();
    assertThrows(\PDOException::class, fn () => Level::create([
        'user_id' => $user->id, 'title' => 'x', 'duration_sec' => 60, 'difficulty' => 1, 'generator_seed' => '1',
        'official_slug' => 'test-colado',
    ]));
});

// --------------------------- Pestañas del catálogo ---------------------------

test('scope=official solo trae oficiales, de menos a más difíciles', function (): void {
    $hard = makeOfficial('duro', ['difficulty' => 5, 'title' => 'AAA duro']);
    $easy = makeOfficial('facil', ['difficulty' => 1, 'title' => 'ZZZ fácil']);
    makeUserLevel(makeUser(), 'comunidad', true);

    $data = listLevels(['scope' => 'official', 'limit' => '50']);
    assertSame('official', $data['scope']);
    foreach ($data['items'] as $item) {
        assertSame(true, $item['is_official'], 'solo oficiales');
    }
    $order = ids($data['items']);
    assertTrue(array_search($easy->id, $order, true) < array_search($hard->id, $order, true), 'la dificultad manda sobre el título');
    $difficulties = array_column($data['items'], 'difficulty');
    $sorted = $difficulties;
    sort($sorted);
    assertSame($sorted, $difficulties, 'orden ascendente de dificultad');
});

test('scope=community excluye oficiales y privados; scope=public incluye oficiales', function (): void {
    $official = makeOfficial('en-publico');
    $user = makeUser();
    $public = makeUserLevel($user, 'publicado', true);
    $private = makeUserLevel($user, 'privado', false);

    $community = ids(listLevels(['scope' => 'community', 'limit' => '50'])['items']);
    assertTrue(in_array($public->id, $community, true), 'el publicado sale en comunidad');
    assertTrue(!in_array($official->id, $community, true), 'un oficial no es de la comunidad');
    assertTrue(!in_array($private->id, $community, true), 'un privado no se lista');

    $all = listLevels(['public' => '1', 'limit' => '50']);
    assertSame('public', $all['scope'], 'sin scope, el listado público de siempre (compatibilidad)');
    assertTrue(in_array($official->id, ids($all['items']), true), 'el listado público incluye oficiales');
});

test('scope=mine exige sesión e incluye los privados propios; mine=1 sigue funcionando', function (): void {
    $res = (new LevelApiController())->index(Request::make('GET', '/api/levels', [], ['scope' => 'mine']));
    assertSame(401, $res->status());

    $user = makeUser();
    $private = makeUserLevel($user, 'mío privado', false);
    makeUserLevel(makeUser(), 'ajeno', true);
    AuthContext::set($user);

    $mine = listLevels(['scope' => 'mine']);
    assertSame([$private->id], ids($mine['items']));
    assertSame(true, $mine['items'][0]['is_mine']);
    assertSame(ids($mine['items']), ids(listLevels(['mine' => '1'])['items']));
});

test('un scope desconocido es un 422, nunca SQL construido con la entrada', function (): void {
    assertThrows(ValidationException::class, fn () => listLevels(['scope' => 'official OR 1=1']), function ($e): void {
        assertTrue(isset($e->fields['scope']), 'el error señala el campo scope');
    });
});

// --------------------------- Datos de tarjeta ---------------------------

test('la tarjeta trae autor, jugadores y la mejor marca de quien mira', function (): void {
    $author = makeUser('autora');
    $level = makeUserLevel($author, 'tarjeta', true);
    $official = makeOfficial('tarjeta');
    $p1 = makeUser('p1');
    $p2 = makeUser('p2');
    Progress::upsert($p1->id, $level->id, 80, 5000);
    Progress::upsert($p2->id, $level->id, 20, 900);

    $anon = listLevels(['scope' => 'community', 'limit' => '50'])['items'];
    $card = $anon[array_search($level->id, ids($anon), true)];
    assertSame($author->username, $card['author']['username']);
    assertTrue(!isset($card['author']['id']), 'el id interno del autor no se expone');
    assertSame(2, $card['players']);
    assertSame(null, $card['my_best'], 'un anónimo no tiene marca');
    assertSame(false, $card['is_mine']);

    AuthContext::set($p1);
    $seen = listLevels(['scope' => 'community', 'limit' => '50'])['items'];
    $card = $seen[array_search($level->id, ids($seen), true)];
    assertSame(['points' => 5000, 'percentage' => 80], $card['my_best']);

    $officials = listLevels(['scope' => 'official', 'limit' => '50'])['items'];
    $card = $officials[array_search($official->id, ids($officials), true)];
    assertSame(null, $card['author'], 'un oficial no tiene autor');
    assertSame(0, $card['players']);
});

test('los datos de tarjeta cuestan las mismas consultas para 1 que para 20 niveles', function (): void {
    $user = makeUser();
    for ($i = 0; $i < 20; $i++) {
        $l = makeUserLevel($user, "n+1 {$i}", true);
        Progress::upsert($user->id, $l->id, 50, 100 + $i);
    }
    AuthContext::set($user);

    // El driver no cuenta consultas; se mide el efecto: el tiempo por nivel no
    // debe crecer con el tamaño de la página (mínimo de varias pasadas).
    $measure = static function (int $limit): float {
        $best = INF;
        for ($r = 0; $r < 7; $r++) {
            $t = hrtime(true);
            listLevels(['scope' => 'mine', 'limit' => (string) $limit]);
            $best = min($best, hrtime(true) - $t);
        }
        return $best;
    };
    $one = $measure(1);
    $twenty = $measure(20);
    assertTrue($twenty < $one * 6, sprintf('20 tarjetas no deben costar ~20 veces 1 (1: %.2f ms, 20: %.2f ms)', $one / 1e6, $twenty / 1e6));
});

// --------------------------- Ranking de un nivel ---------------------------

test('ranking de nivel: por puntos, con la posición de quien mira fuera del top', function (): void {
    $level = makeOfficial('ranking');
    $users = [];
    foreach ([300, 900, 600, 100] as $i => $points) {
        $users[$i] = makeUser("r{$i}");
        Progress::upsert($users[$i]->id, $level->id, 10, $points);
    }
    $ctrl = new LevelApiController();

    $anon = decode($ctrl->ranking(Request::make('GET', '/', [], ['limit' => '2']), ['id' => (string) $level->id]));
    assertSame([900, 600], array_column($anon['items'], 'points'));
    assertSame([1, 2], array_column($anon['items'], 'rank'));
    assertSame(4, $anon['players']);
    assertSame(null, $anon['me']);

    AuthContext::set($users[3]);   // 100 puntos, el último
    $me = decode($ctrl->ranking(Request::make('GET', '/', [], ['limit' => '2']), ['id' => (string) $level->id]))['me'];
    assertSame(['rank' => 4, 'points' => 100, 'percentage' => 10], $me);
});

test('ranking de nivel: a igualdad de puntos va antes quien lo logró primero', function (): void {
    $level = makeOfficial('empate');
    $first = makeUser('primero');
    $second = makeUser('segundo');
    Progress::upsert($first->id, $level->id, 50, 700);
    \App\Core\Database::getInstance()->exec("UPDATE progress SET best_run_at = '2026-01-01 00:00:00' WHERE user_id = {$first->id}");
    Progress::upsert($second->id, $level->id, 50, 700);

    $top = Progress::topForLevel($level->id);
    assertSame([$first->id, $second->id], array_map(static fn (Progress $p): int => $p->userId, $top));
    assertSame(1, Progress::findByUserAndLevel($first->id, $level->id)->rankOnLevel());
    assertSame(2, Progress::findByUserAndLevel($second->id, $level->id)->rankOnLevel());
});

test('ranking de un nivel privado ajeno es 404', function (): void {
    $private = makeUserLevel(makeUser('autor'), 'secreto', false);
    AuthContext::set(makeUser('curioso'));
    $res = (new LevelApiController())->ranking(Request::make('GET', '/'), ['id' => (string) $private->id]);
    assertSame(404, $res->status());
});

// --------------------------- Oficiales inmutables desde la API ---------------------------

test('ningún usuario puede cambiar la visibilidad ni subir audio a un oficial', function (): void {
    $official = makeOfficial('intocable');
    AuthContext::set(makeUser());
    $ctrl = new LevelApiController();
    $res = $ctrl->visibility(Request::make('POST', '/', ['is_public' => false]), ['id' => (string) $official->id]);
    assertSame(403, $res->status());
    $res = $ctrl->upload(Request::make('POST', '/'), ['id' => (string) $official->id]);
    assertSame(403, $res->status());
    assertSame(true, Level::findById($official->id)->isPublic);
});

// --------------------------- D12: identidad por Bearer ---------------------------

test('GET /api/me devuelve el perfil público del portador del token', function (): void {
    $user = makeUser('embebido');
    AuthContext::set($user);
    $data = decode((new MeApiController())->show(Request::make('GET', '/api/me')));
    assertSame(['user' => ['vout_id' => $user->voutId, 'username' => $user->username, 'avatar_url' => null]], $data);
});

test('D21: la shell deja que Vout la embeba, y solo Vout', function (): void {
    assertSame("'self' http://localhost", \App\Controllers\HomeController::frameAncestors('http://localhost'));
    assertSame("'self' https://vout.example.com:8443", \App\Controllers\HomeController::frameAncestors('https://vout.example.com:8443'));
    // Un .env raro nunca se inyecta en la cabecera.
    foreach (['', '*', "http://a.com\r\nX-Evil: 1", 'javascript:alert(1)', "http://a.com 'unsafe-inline'", 'https://a.com/path'] as $bad) {
        assertSame("'self'", \App\Controllers\HomeController::frameAncestors($bad), 'rechaza: ' . json_encode($bad));
    }
});

// --------------------------- Seed del catálogo oficial ---------------------------

/**
 * Directorio de seed temporal con MP3 falsos: el seeder solo mira bytes y hash.
 *
 * @param array<string, array{title?: string, artist?: ?string, bytes?: string, difficulty?: int, events?: int, charter?: int}> $levels
 * @return array{seed: string, audio: string, from: string, cleanup: callable}
 */
function makeSeedFixture(array $levels): array
{
    $base = sys_get_temp_dir() . '/daino-seed-' . bin2hex(random_bytes(4));
    foreach (['seed/baked', 'audio', 'from'] as $d) {
        mkdir("{$base}/{$d}", 0777, true);
    }
    $manifest = ['formatVersion' => 1, 'levels' => []];
    foreach ($levels as $slug => $spec) {
        $file = "{$slug}.mp3";
        $bytes = $spec['bytes'] ?? "ID3 audio de {$slug}";
        file_put_contents("{$base}/from/{$file}", $bytes);
        $s = hash('sha256', $bytes);
        $manifest['levels'][] = ['slug' => $slug, 'file' => $file, 'title' => $spec['title'] ?? ucfirst($slug), 'artist' => $spec['artist'] ?? null];
        file_put_contents("{$base}/seed/baked/{$slug}.json", json_encode([
            'formatVersion' => 1, 'slug' => $slug, 'file' => $file,
            'audio'         => ['sha256' => $s, 'bytes' => strlen($bytes), 'durationSec' => 60.5],
            'difficulty'    => $spec['difficulty'] ?? 2,
            'chart'         => chartFor($s, $spec['charter'] ?? 1, $spec['events'] ?? 3),
            'analysis'      => storeBody($s)['analysis'],
        ], JSON_PRESERVE_ZERO_FRACTION));
    }
    file_put_contents("{$base}/seed/manifest.json", json_encode($manifest));

    $cleanup = static function () use ($base): void {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($it as $f) {
            $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
        }
        rmdir($base);
    };
    return ['seed' => "{$base}/seed", 'audio' => "{$base}/audio", 'from' => "{$base}/from", 'cleanup' => $cleanup];
}

/**
 * @return array<string, array{slug: string, result: string, detail: string, level_id: ?int}>
 */
function seedWith(array $fx, array $opts = []): array
{
    $report = (new OfficialCatalogSeeder($fx['seed'], $fx['audio']))->run($opts);
    return array_column($report, null, 'slug');
}

test('seed: crea los oficiales copiando el audio y es idempotente', function (): void {
    $fx = makeSeedFixture(['test-uno' => ['difficulty' => 4, 'artist' => 'Alguien'], 'test-dos' => []]);
    try {
        $first = seedWith($fx, ['from' => $fx['from']]);
        assertSame('created', $first['test-uno']['result']);
        assertSame('created', $first['test-dos']['result']);
        assertTrue(is_file("{$fx['audio']}/test-uno.mp3"), 'el MP3 se copia a storage/official');

        $level = Level::findOfficialBySlug('test-uno');
        assertSame(null, $level->userId);
        assertSame(true, $level->isPublic && $level->isOfficial && $level->hasChart());
        assertSame(4, $level->difficulty);
        assertSame('Alguien', $level->artist);
        assertSame('official/test-uno.mp3', $level->filePath);

        $again = seedWith($fx);   // ya sin --from: el audio está en su sitio
        assertSame('unchanged', $again['test-uno']['result']);
        assertSame($first['test-uno']['level_id'], $again['test-uno']['level_id'], 'misma fila, no una nueva');
    } finally {
        ($fx['cleanup'])();
    }
});

test('seed: cambios de metadata se aplican; un chart nuevo solo con --rechart', function (): void {
    $fx = makeSeedFixture(['test-chart' => []]);
    try {
        seedWith($fx, ['from' => $fx['from']]);
        $id = Level::findOfficialBySlug('test-chart')->id;

        // Nuevo horneado del MISMO audio con otro charter y otro título.
        $baked = json_decode(file_get_contents("{$fx['seed']}/baked/test-chart.json"), true);
        $baked['chart'] = chartFor($baked['audio']['sha256'], 2, 6);
        $baked['difficulty'] = 5;
        file_put_contents("{$fx['seed']}/baked/test-chart.json", json_encode($baked, JSON_PRESERVE_ZERO_FRACTION));

        $frozen = seedWith($fx)['test-chart'];
        assertSame('skipped', $frozen['result']);
        assertTrue(str_contains($frozen['detail'], '--rechart'), 'dice cómo aplicarlo');
        assertSame(1, Level::findChart($id)['version'], 'el chart con marcas no se toca en silencio');

        $done = seedWith($fx, ['rechart' => true])['test-chart'];
        assertSame('recharted', $done['result']);
        assertSame(2, Level::findChart($id)['version']);
        assertSame(5, Level::findById($id)->difficulty);
    } finally {
        ($fx['cleanup'])();
    }
});

test('seed: audio ausente o distinto del horneado se salta sin frenar a los demás', function (): void {
    $fx = makeSeedFixture(['test-falta' => [], 'test-cambiado' => [], 'test-bien' => []]);
    try {
        unlink("{$fx['from']}/test-falta.mp3");
        file_put_contents("{$fx['from']}/test-cambiado.mp3", 'otra codificación');

        $report = seedWith($fx, ['from' => $fx['from']]);
        assertSame('skipped', $report['test-falta']['result']);
        assertTrue(str_contains($report['test-falta']['detail'], 'falta el MP3'), $report['test-falta']['detail']);
        assertSame('skipped', $report['test-cambiado']['result']);
        assertTrue(str_contains($report['test-cambiado']['detail'], 'no es el horneado'), $report['test-cambiado']['detail']);
        assertTrue(!is_file("{$fx['audio']}/test-cambiado.mp3"), 'un audio que no casa no llega a storage');
        assertSame('created', $report['test-bien']['result']);
        assertSame(null, Level::findOfficialBySlug('test-falta'));
    } finally {
        ($fx['cleanup'])();
    }
});

test('seed: rechaza entradas peligrosas o incoherentes del manifiesto', function (): void {
    $fx = makeSeedFixture(['test-ok' => []]);
    try {
        $manifest = json_decode(file_get_contents("{$fx['seed']}/manifest.json"), true);
        $manifest['levels'][] = ['slug' => 'test-ruta', 'file' => '../../.env', 'title' => 'x'];
        $manifest['levels'][] = ['slug' => 'Mal Slug', 'file' => 'a.mp3', 'title' => 'x'];
        $manifest['levels'][] = $manifest['levels'][0];   // slug repetido
        file_put_contents("{$fx['seed']}/manifest.json", json_encode($manifest));

        $report = (new OfficialCatalogSeeder($fx['seed'], $fx['audio']))->run(['from' => $fx['from']]);
        assertSame(['created', 'skipped', 'skipped', 'skipped'], array_column($report, 'result'));
        assertTrue(str_contains($report[1]['detail'], 'sin ruta'), $report[1]['detail']);
        assertTrue(str_contains($report[3]['detail'], 'repetido'), $report[3]['detail']);
    } finally {
        ($fx['cleanup'])();
    }
});
