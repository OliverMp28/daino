<?php
declare(strict_types=1);

/**
 * Identidad de los efectos de cada nivel (T03.3, doc 11): `levels.fx_auto`, la
 * paleta y la firma que le pegan a la canción por cómo suena. La reparte el
 * juego con el análisis del servidor; aquí se cuida la forma de lo que se guarda,
 * que la API la enseña y que ninguna petición la escribe.
 */

use App\Controllers\Api\LevelApiController;
use App\Core\AuthContext;
use App\Core\Database;
use App\Core\Request;
use App\Models\Level;
use App\Services\FxIdentity;
use App\Services\LevelPresenter;

require_once __DIR__ . '/fixtures.php';

test('identidad de efectos: la forma que se guarda es canónica; lo mal formado se rechaza', function (): void {
    assertSame(null, FxIdentity::parse(null));
    assertSame(null, FxIdentity::parse([]), 'un objeto vacío es "nada propio"');
    assertSame(null, FxIdentity::parse(['palette' => null, 'signature' => null]));
    assertSame(['palette' => 'ice'], FxIdentity::parse(['palette' => 'ice']));
    assertSame(['signature' => 'meteors'], FxIdentity::parse(['signature' => 'meteors', 'palette' => null]));
    // Las claves, siempre en el mismo orden: dos identidades iguales, el mismo texto.
    $a = FxIdentity::encode(FxIdentity::parse(['signature' => 'aurora', 'palette' => 'rose']));
    assertSame('{"palette":"rose","signature":"aurora"}', $a);
    assertSame(null, FxIdentity::encode(null));
    assertSame(['palette' => 'rose', 'signature' => 'aurora'], FxIdentity::decode($a));

    // Un id que el servidor no conoce pasa (el registro vive en el juego); lo que
    // no tiene forma de identidad, no.
    assertSame(['palette' => 'una-paleta-nueva'], FxIdentity::parse(['palette' => 'una-paleta-nueva']));
    foreach ([['palette' => 'Con Mayúsculas'], ['palette' => 7], ['palette' => ['ice']], ['color' => 'ice'], ['ice', 'aurora'], 'ice', 3] as $bad) {
        assertThrows(\InvalidArgumentException::class, static fn () => FxIdentity::parse($bad));
    }
    // Lo guardado se lee con indulgencia: algo que no se entiende es "nada propio".
    foreach ([null, '', 'no es json', '["ice"]', '{"color":"ice"}', '{"palette":"MAL"}', '7'] as $stored) {
        assertSame(null, FxIdentity::decode($stored), json_encode($stored));
    }
});

test('identidad de efectos: la API la enseña a cualquiera que vea el nivel y ninguna petición la escribe', function (): void {
    $author = makeUser('autor-fx');
    $level = ownLevelFor($author, 'fx-auto-1');
    assertSame(null, $level->fxAuto, 'sin análisis del servidor no hay identidad');
    assertSame(null, LevelPresenter::one($level, null)['fx_auto']);

    // Lo escribe el worker del analizador junto al chart.
    Database::getInstance()->prepare('UPDATE levels SET fx_auto = :fx WHERE id = :id')
        ->execute(['fx' => '{"palette":"ultra","signature":"meteors"}', 'id' => $level->id]);
    $shape = LevelPresenter::one(Level::findById($level->id), null);
    assertSame(['palette' => 'ultra', 'signature' => 'meteors'], $shape['fx_auto']);
    // En los listados también (el catálogo juega con la fila del listado).
    AuthContext::set($author);
    $mine = decode((new LevelApiController())->index(Request::make('GET', '/', [], ['scope' => 'mine'])));
    $row = array_values(array_filter($mine['items'], static fn (array $l): bool => $l['id'] === $level->id))[0];
    assertSame(['palette' => 'ultra', 'signature' => 'meteors'], $row['fx_auto']);

    // Cambiar el escenario no la toca, y una petición no puede fijarla.
    $req = Request::make('POST', '/', ['scene' => 'coast', 'fx_auto' => ['palette' => 'rose']]);
    $res = decode((new LevelApiController())->changeScene($req, ['id' => (string) $level->id]));
    assertSame('coast', $res['level']['scene']);
    assertSame(['palette' => 'ultra', 'signature' => 'meteors'], $res['level']['fx_auto']);
    // Tampoco al registrar una canción: un nivel nuevo nace sin identidad.
    $other = decode(store(storeBody(sha('fx-auto-2')) + ['fx_auto' => ['palette' => 'rose']]));
    assertSame(null, Level::findById($other['id'])->fxAuto);
});

test('identidad de efectos: la BD solo guarda JSON', function (): void {
    $level = ownLevelFor(makeUser('autor-fx-check'), 'fx-auto-3');
    $set = static function (string $value) use ($level): void {
        Database::getInstance()->prepare('UPDATE levels SET fx_auto = :fx WHERE id = :id')->execute(['fx' => $value, 'id' => $level->id]);
    };
    assertThrows(\PDOException::class, static fn () => $set('ultra'));
    assertThrows(\PDOException::class, static fn () => $set('{palette: ultra}'));
    $set('{"palette":"ultra"}');
    assertSame('{"palette":"ultra"}', Level::findById($level->id)->fxAuto);
    // Una fila con JSON que no es una identidad se sirve como "nada propio".
    $set('{"color":"rojo"}');
    assertSame(null, LevelPresenter::one(Level::findById($level->id), null)['fx_auto']);
});

test('seed: la identidad de efectos del horneado (T03.3) llega al oficial sin tocar el chart', function (): void {
    $fx = makeSeedFixture([
        'test-fx' => ['fxAuto' => ['palette' => 'ice', 'signature' => 'aurora']],
        'test-sin-fx' => [],
        'test-fx-null' => ['fxAuto' => null],
    ]);
    try {
        seedWith($fx, ['from' => $fx['from']]);
        $level = Level::findOfficialBySlug('test-fx');
        assertSame('{"palette":"ice","signature":"aurora"}', $level->fxAuto);
        assertSame(null, Level::findOfficialBySlug('test-sin-fx')->fxAuto, 'un horneado anterior a la T03.3: lo de siempre');
        assertSame(null, Level::findOfficialBySlug('test-fx-null')->fxAuto, 'una canción sin nada propio');
        $chart = Level::findChart($level->id)['json'];
        assertSame('unchanged', seedWith($fx)['test-fx']['result'], 'idempotente');

        // Otras reglas de reparto: se re-hornea y el seed lo aplica como metadata.
        $bakedPath = "{$fx['seed']}/baked/test-fx.json";
        $baked = json_decode(file_get_contents($bakedPath), true);
        $baked['fxAuto'] = ['palette' => 'rose'];
        file_put_contents($bakedPath, json_encode($baked, JSON_PRESERVE_ZERO_FRACTION));
        assertSame('updated', seedWith($fx)['test-fx']['result']);
        assertSame('{"palette":"rose"}', Level::findById($level->id)->fxAuto);
        assertSame($chart, Level::findChart($level->id)['json']);

        // Mal formada: se salta el nivel y no se pisa lo que había.
        foreach ([['palette' => 'Mal Id'], ['color' => 'rose'], 'rose'] as $bad) {
            $baked['fxAuto'] = $bad;
            file_put_contents($bakedPath, json_encode($baked, JSON_PRESERVE_ZERO_FRACTION));
            $report = seedWith($fx)['test-fx'];
            assertSame('skipped', $report['result'], json_encode($bad));
            assertTrue(str_contains($report['detail'], 'efectos'), $report['detail']);
        }
        assertSame('{"palette":"rose"}', Level::findById($level->id)->fxAuto);
    } finally {
        ($fx['cleanup'])();
    }
});
