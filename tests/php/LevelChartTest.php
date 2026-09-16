<?php
declare(strict_types=1);

/**
 * Tests de la Ola 3 en servidor: validación de charts, upsert por hash de
 * audio (defecto D1), endpoint del chart con ETag y restricciones de BD.
 */

use App\Controllers\Api\LevelApiController;
use App\Core\AuthContext;
use App\Core\Database;
use App\Core\Request;
use App\Core\ValidationException;
use App\Models\Level;
use App\Models\User;
use App\Services\ChartValidator;

require_once __DIR__ . '/fixtures.php';

// --------------------------- ChartValidator ---------------------------

test('ChartValidator acepta un chart válido y lo re-codifica normalizado', function (): void {
    $s = sha('a');
    $raw = chartFor($s);
    $raw['events'][0]['sospechoso'] = ['anidado' => true];   // se descarta
    $out = ChartValidator::validateChart($raw, $s);

    assertSame(1, $out['charterVersion']);
    assertSame(60.5, $out['durationSec']);
    $decoded = json_decode($out['json'], true);
    assertSame(3, count($decoded['events']));
    assertTrue(!isset($decoded['events'][0]['sospechoso']), 'los campos anidados no se persisten');
});

test('ChartValidator conserva tipos de evento futuros con campos escalares', function (): void {
    $s = sha('a');
    $raw = chartFor($s);
    $raw['events'][] = ['t' => 50.0, 'type' => 'section', 'label' => 'chorus'];
    $decoded = json_decode(ChartValidator::validateChart($raw, $s)['json'], true);
    assertSame(['t' => 50.0, 'type' => 'section', 'label' => 'chorus'], $decoded['events'][3]);
});

test('ChartValidator acepta el formato 2 (Ola 5) y conserva velocidad, pulso, dificultad y estructura', function (): void {
    $s = sha('a');
    $raw = chartV2For($s);
    $raw['world']['speedChanges'][0]['sospechoso'] = 'x';   // campo desconocido: no se persiste
    $out = ChartValidator::validateChart($raw, $s);
    $decoded = json_decode($out['json'], true);

    assertSame(2, $decoded['formatVersion']);
    assertSame([['t' => 20.0, 'speedPxS' => 480.0, 'rampS' => 0.0], ['t' => 40.0, 'speedPxS' => 437.5, 'rampS' => 0.9]], $decoded['world']['speedChanges']);
    assertSame([1.0, 1.5, 2.0, 2.5], $decoded['music']['beats']);
    assertSame([1.0, 2.0], $decoded['music']['downbeats']);
    assertSame(['level' => 4, 'requested' => 'auto', 'ceiling' => 5], $decoded['difficulty']);
    assertSame(['t' => 20.0, 'type' => 'section', 'level' => 3, 'intensity' => 0.71, 'role' => 'chorus', 'climax' => false], $decoded['events'][1]);
    assertSame(['t' => 20.0, 'type' => 'fx', 'fx' => 'drop', 'level' => 3], $decoded['events'][2]);
});

test('ChartValidator acepta el formato 3 (Ola 6) con portales de modo, y solo ahí', function (): void {
    $s = sha('a');
    $raw = chartV2For($s);
    $raw['formatVersion'] = 3;
    $raw['events'][] = ['t' => 30.0, 'type' => 'mode', 'mode' => 'flip'];
    $raw['events'][] = ['t' => 45.0, 'type' => 'mode', 'mode' => 'run'];
    $decoded = json_decode(ChartValidator::validateChart($raw, $s)['json'], true);

    assertSame(3, $decoded['formatVersion']);
    $portals = array_values(array_filter($decoded['events'], static fn (array $e): bool => $e['type'] === 'mode'));
    assertSame([['t' => 30.0, 'type' => 'mode', 'mode' => 'flip'], ['t' => 45.0, 'type' => 'mode', 'mode' => 'run']], $portals);
    assertSame([['t' => 20.0, 'speedPxS' => 480.0, 'rampS' => 0.0], ['t' => 40.0, 'speedPxS' => 437.5, 'rampS' => 0.9]], $decoded['world']['speedChanges'], 'el formato 3 conserva lo del 2');

    $cases = [
        'modo en un chart de formato 2' => static function (array $c): array { $c['formatVersion'] = 2; return $c; },
        'modo sin nombre'               => static function (array $c): array { $c['events'][count($c['events']) - 2] = ['t' => 30.0, 'type' => 'mode']; return $c; },
        'nombre de modo inválido'       => static function (array $c): array { $c['events'][count($c['events']) - 2]['mode'] = '<script>'; return $c; },
    ];
    foreach ($cases as $label => $mutate) {
        assertThrows(ValidationException::class, fn () => ChartValidator::validateChart($mutate($raw), $s), function ($e) use ($label): void {
            assertTrue(isset($e->fields['chart']), "{$label}: el error debe señalar el campo chart");
        });
    }
});

test('ChartValidator rechaza campos de formato 2 mal formados', function (): void {
    $s = sha('a');
    $mutations = [
        'beats desordenados'        => static fn (array $c) => array_replace_recursive($c, ['music' => ['beats' => [2.0, 1.0]]]),
        'beat fuera de la canción'  => static fn (array $c) => array_replace_recursive($c, ['music' => ['downbeats' => [1.0, 99.0]]]),
        'velocidad absurda'         => static function (array $c): array { $c['world']['speedChanges'][0]['speedPxS'] = 99999; return $c; },
        'rampa negativa'            => static function (array $c): array { $c['world']['speedChanges'][0]['rampS'] = -1; return $c; },
        'cambios desordenados'      => static function (array $c): array { $c['world']['speedChanges'] = array_reverse($c['world']['speedChanges']); return $c; },
        'dificultad fuera de rango' => static fn (array $c) => array_replace_recursive($c, ['difficulty' => ['level' => 9]]),
        'dificultad pedida rara'    => static fn (array $c) => array_replace_recursive($c, ['difficulty' => ['requested' => 'imposible']]),
    ];
    foreach ($mutations as $label => $mutate) {
        assertThrows(ValidationException::class, fn () => ChartValidator::validateChart($mutate(chartV2For($s)), $s), function ($e) use ($label): void {
            assertTrue(isset($e->fields['chart']), "{$label}: el error debe señalar el campo chart");
        });
    }
});

test('ChartValidator rechaza charts inválidos o peligrosos', function (): void {
    $s = sha('a');
    $cases = [
        'no objeto'              => [[1, 2, 3], $s],
        'formato futuro'         => [array_merge(chartFor($s), ['formatVersion' => 4]), $s],
        'otro audio'             => [chartFor(sha('b')), $s],
        'duración absurda'       => [array_replace_recursive(chartFor($s), ['audio' => ['durationSec' => 999999]]), $s],
        'velocidad como texto'   => [array_replace_recursive(chartFor($s), ['world' => ['speedPxS' => '437']]), $s],
        'seed fuera de 32 bits'  => [array_merge(chartFor($s), ['seed' => 2 ** 40]), $s],
    ];
    $unsorted = chartFor($s);
    $unsorted['events'] = array_reverse($unsorted['events']);
    $cases['eventos desordenados'] = [$unsorted, $s];
    $badKind = chartFor($s);
    $badKind['events'][0]['kind'] = '<script>';
    $cases['kind con formato inválido'] = [$badKind, $s];
    $late = chartFor($s);
    $late['events'][] = ['t' => 61.0, 'type' => 'obstacle', 'kind' => 'PTERO'];
    $cases['evento después del final'] = [$late, $s];
    $huge = chartFor($s, 1, 0);
    $huge['events'] = array_fill(0, ChartValidator::MAX_EVENTS + 1, ['t' => 3.0, 'type' => 'obstacle', 'kind' => 'PTERO']);
    $cases['demasiados eventos'] = [$huge, $s];

    foreach ($cases as $label => [$chart, $expected]) {
        assertThrows(ValidationException::class, fn () => ChartValidator::validateChart($chart, $expected), function ($e) use ($label): void {
            assertTrue(isset($e->fields['chart']), "{$label}: el error debe señalar el campo chart");
        });
    }
});

test('ChartValidator valida el análisis y rechaza onsets mal formados', function (): void {
    $body = storeBody(sha('a'));
    $json = ChartValidator::validateAnalysis($body['analysis']);
    assertSame([[3.0, 0.9], [3.8, 0.4]], json_decode($json, true)['onsets']);

    $bad = $body['analysis'];
    $bad['onsets'] = [[3.0]];
    assertThrows(ValidationException::class, fn () => ChartValidator::validateAnalysis($bad));
    $bad['onsets'] = [[3.0, 5.0]];   // fuerza fuera de [0,1]
    assertThrows(ValidationException::class, fn () => ChartValidator::validateAnalysis($bad));
});

// --------------------------- POST /api/levels ---------------------------

test('store crea el nivel con chart, análisis y metadata derivada del chart', function (): void {
    AuthContext::set(makeUser());
    $s = sha('song-1');
    $res = store(storeBody($s));

    assertSame(201, $res->status());
    $data = decode($res);
    assertSame($s, $data['audio_sha256']);
    assertSame(true, $data['has_chart']);
    assertSame(1, $data['chart_version']);
    assertSame(60500, $data['duration_ms'], 'la duración sale del chart, con precisión de ms');
    assertSame(128.2, $data['bpm_exact']);
    assertSame(438, $data['game_speed']);
    assertTrue(!array_key_exists('chart_json', $data) && !array_key_exists('file_path', $data), 'ni blobs ni rutas internas en la respuesta');
});

test('D1: rejugar la misma canción devuelve el mismo nivel, no crea otra fila', function (): void {
    $user = makeUser();
    AuthContext::set($user);
    $s = sha('song-rejugada');

    $first = decode(store(storeBody($s)));
    $second = store(storeBody($s));
    $third = store(storeBody($s));

    assertSame(200, $second->status());
    assertSame($first['id'], decode($second)['id']);
    assertSame($first['id'], decode($third)['id']);
    assertSame(1, Level::countByUser($user->id), 'tres partidas, una sola fila');
});

test('el mismo audio de dos usuarios son dos niveles distintos', function (): void {
    $s = sha('song-compartida');
    AuthContext::set(makeUser('a'));
    $a = decode(store(storeBody($s)));
    AuthContext::set(makeUser('b'));
    $b = decode(store(storeBody($s)));
    assertTrue($a['id'] !== $b['id'], 'cada usuario tiene su propio nivel');
});

test('un charter más nuevo actualiza el chart de un nivel privado', function (): void {
    AuthContext::set(makeUser());
    $s = sha('song-upgrade');
    $id = decode(store(storeBody($s)))['id'];

    $res = decode(store(storeBody($s, ['chart' => chartFor($s, 2, 5)])));
    assertSame(2, $res['chart_version']);
    assertSame(5, count(json_decode(Level::findChart($id)['json'], true)['events']));
});

test('un charter más viejo NO pisa el chart existente', function (): void {
    AuthContext::set(makeUser());
    $s = sha('song-downgrade');
    $id = decode(store(storeBody($s, ['chart' => chartFor($s, 3, 4)])))['id'];
    store(storeBody($s, ['chart' => chartFor($s, 1, 2)]));
    assertSame(3, Level::findChart($id)['version']);
});

test('el chart de un nivel PÚBLICO queda congelado aunque llegue uno más nuevo', function (): void {
    AuthContext::set(makeUser());
    $s = sha('song-publica');
    $id = decode(store(storeBody($s)))['id'];
    Level::findById($id)->setPublic(true, 'levels/' . $id . '.mp3');

    store(storeBody($s, ['chart' => chartFor($s, 9, 7)]));
    assertSame(1, Level::findChart($id)['version'], 'otros jugadores tienen marcas sobre este chart');
});

test('store rechaza lo que no debe persistir', function (): void {
    AuthContext::set(makeUser());
    $s = sha('song-invalid');
    $cases = [
        'sin chart'               => [storeBody($s, ['chart' => null]), 'chart'],
        'hash con formato malo'   => [storeBody('ZZZ'), 'audio_sha256'],
        'chart de otro audio'     => [storeBody($s, ['chart' => chartFor(sha('otro'))]), 'chart'],
        'título > columna (D3)'   => [storeBody($s, ['title' => str_repeat('x', 121)]), 'title'],
        'seed no numérica'        => [storeBody($s, ['generator_seed' => 'abc']), 'generator_seed'],
    ];
    foreach ($cases as $label => [$body, $field]) {
        assertThrows(ValidationException::class, fn () => store($body), function ($e) use ($label, $field): void {
            assertTrue(isset($e->fields[$field]), "{$label}: se esperaba error en '{$field}', llegó " . json_encode($e->fields));
        });
    }
});

test('la clave única (usuario, audio) es la red de seguridad ante carreras', function (): void {
    $user = makeUser();
    $s = sha('song-carrera');
    $data = ['user_id' => $user->id, 'title' => 'x', 'duration_sec' => 60, 'difficulty' => 3,
             'generator_seed' => '1', 'audio_sha256' => $s];
    Level::create($data);
    assertThrows(\PDOException::class, fn () => Level::create($data), function (\PDOException $e): void {
        assertSame('23000', (string) $e->getCode(), 'el controller distingue este código para devolver el ganador');
    });
});

// --------------------------- GET /api/levels/{id}/chart ---------------------------

test('chart: sirve el chart guardado con ETag, y 304 si no cambió', function (): void {
    $user = makeUser();
    AuthContext::set($user);
    $s = sha('song-etag');
    $id = decode(store(storeBody($s)))['id'];
    Level::findById($id)->setPublic(true, 'levels/' . $id . '.mp3');
    AuthContext::clear();   // lo pide un anónimo

    $ctrl = new LevelApiController();
    $res = $ctrl->chart(Request::make('GET', "/api/levels/{$id}/chart"), ['id' => (string) $id]);
    assertSame(200, $res->status());
    assertSame(Level::findChart($id)['json'], $res->body(), 'se sirve tal cual, sin recodificar');
    $etag = $res->headerValue('etag');
    assertTrue(is_string($etag) && str_starts_with($etag, '"c1-'), "ETag inesperado: {$etag}");

    $again = $ctrl->chart(Request::make('GET', "/api/levels/{$id}/chart", [], [], ['If-None-Match' => $etag]), ['id' => (string) $id]);
    assertSame(304, $again->status());
    assertSame('', $again->body());
});

test('chart: un nivel privado ajeno es 404 (no se filtra que existe)', function (): void {
    AuthContext::set(makeUser('autor'));
    $id = decode(store(storeBody(sha('song-privada'))))['id'];

    AuthContext::set(makeUser('otro'));
    $res = (new LevelApiController())->chart(Request::make('GET', '/'), ['id' => (string) $id]);
    assertSame(404, $res->status());
    assertSame('not_found', decode($res)['error']);
});

test('chart: el autor sí ve el chart de su nivel privado', function (): void {
    $author = makeUser();
    AuthContext::set($author);
    $id = decode(store(storeBody(sha('song-mia'))))['id'];
    $res = (new LevelApiController())->chart(Request::make('GET', '/'), ['id' => (string) $id]);
    assertSame(200, $res->status());
});

test('chart: un nivel anterior a la Ola 3 (sin chart) responde no_chart', function (): void {
    $user = makeUser();
    $level = Level::create(['user_id' => $user->id, 'title' => 'viejo', 'duration_sec' => 60, 'difficulty' => 3, 'generator_seed' => '7']);
    $level->setPublic(true, 'levels/x.mp3');
    $res = (new LevelApiController())->chart(Request::make('GET', '/'), ['id' => (string) $level->id]);
    assertSame(404, $res->status());
    assertSame('no_chart', decode($res)['error']);
});

// --------------------------- Listado y modelo ---------------------------

test('el listado no arrastra los blobs de chart ni análisis', function (): void {
    $user = makeUser();
    AuthContext::set($user);
    store(storeBody(sha('song-lista')));
    $res = (new LevelApiController())->index(Request::make('GET', '/api/levels', [], ['mine' => '1']));
    $item = decode($res)['items'][0];
    assertSame(true, $item['has_chart']);
    assertTrue(!isset($item['chart_json']) && !isset($item['analysis_json']), 'sin blobs en el listado');
    assertTrue(strlen($res->body()) < 2048, 'un nivel en el listado debe ocupar poco: ' . strlen($res->body()) . ' bytes');
});

// --------------------------- Restricciones de BD ---------------------------

test('la BD rechaza un hash mal formado, JSON inválido y "ready" sin chart', function (): void {
    $user = makeUser();
    $pdo = Database::getInstance();
    $insert = static function (array $cols) use ($pdo, $user): void {
        $cols = array_merge(['user_id' => $user->id, 'title' => 'x', 'duration_sec' => 1, 'difficulty' => 1, 'generator_seed' => '1'], $cols);
        $names = implode(', ', array_keys($cols));
        $params = implode(', ', array_map(static fn ($k) => ':' . $k, array_keys($cols)));
        $pdo->prepare("INSERT INTO levels ({$names}) VALUES ({$params})")->execute($cols);
    };

    assertThrows(\PDOException::class, fn () => $insert(['audio_sha256' => str_repeat('G', 64)]));
    assertThrows(\PDOException::class, fn () => $insert(['audio_sha256' => sha('j'), 'chart_json' => '{no es json']));
    assertThrows(\PDOException::class, fn () => $insert(['audio_sha256' => sha('k'), 'chart_status' => 'ready']));
});
