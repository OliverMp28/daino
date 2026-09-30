<?php
declare(strict_types=1);

/**
 * Escenario de cada nivel (T02.1, doc 11): lo elige su autor entre los ambientes
 * elegibles, en cualquier estado del nivel, sin tocar el chart ni las marcas.
 * (El del catálogo oficial llega por el manifiesto: CatalogTest.)
 */

use App\Controllers\Api\LevelApiController;
use App\Core\AuthContext;
use App\Core\Database;
use App\Core\Request;
use App\Core\ValidationException;
use App\Models\Level;
use App\Models\Progress;
use App\Services\LevelPresenter;
use App\Services\SceneCatalog;

require_once __DIR__ . '/fixtures.php';

function changeScene(Level $level, mixed $scene): \App\Core\Response
{
    return (new LevelApiController())->changeScene(Request::make('POST', '/', ['scene' => $scene]), ['id' => (string) $level->id]);
}

/** Nivel propio recién creado con POST /api/levels. */
function ownLevelFor(\App\Models\User $user, string $seed): Level
{
    AuthContext::set($user);
    return Level::findById(decode(store(storeBody(sha($seed))))['id']);
}

test('escenario: su autor lo elige y lo devuelve a Automático', function (): void {
    $level = ownLevelFor(makeUser('autor-escena'), 'escena-1');
    assertSame(null, $level->scene, 'un nivel nuevo empieza en Automático');

    $res = changeScene($level, 'coast');
    assertSame(200, $res->status());
    assertSame('coast', decode($res)['level']['scene']);
    assertSame('coast', Level::findById($level->id)->scene);

    $back = changeScene($level, null);
    assertSame(200, $back->status());
    assertSame(null, decode($back)['level']['scene']);
    assertSame(null, Level::findById($level->id)->scene);
});

test('escenario: solo ambientes elegibles; una historia o un id raro es 422', function (): void {
    $level = ownLevelFor(makeUser('autor-raro'), 'escena-2');
    foreach (['volcano', 'one-day', 'COAST', '', 123, ['coast']] as $bad) {
        assertThrows(ValidationException::class, fn () => changeScene($level, $bad), function (ValidationException $e): void {
            assertTrue(isset($e->fields['scene']), 'el error dice qué campo falla');
        });
    }
    assertSame(null, Level::findById($level->id)->scene);
    foreach (SceneCatalog::SELECTABLE as $id) {
        assertSame(200, changeScene($level, $id)->status(), "acepta {$id}");
    }
});

test('escenario: el nivel de otro no existe para ti', function (): void {
    $level = ownLevelFor(makeUser('dueno'), 'escena-3');
    AuthContext::set(makeUser('intruso'));
    assertSame(404, changeScene($level, 'coast')->status());
    assertSame(null, Level::findById($level->id)->scene);
});

test('escenario: un nivel publicado también cambia, y ni el chart ni las marcas se tocan', function (): void {
    $author = makeUser('autor-publicado');
    $level = ownLevelFor($author, 'escena-4');
    Database::getInstance()->prepare("UPDATE levels SET is_public = TRUE, file_path = 'x.mp3' WHERE id = :id")->execute(['id' => $level->id]);
    $player = makeUser('jugador-escena');
    Progress::upsert($player->id, $level->id, 90, 5000);
    $chart = Level::findChart($level->id)['json'];

    AuthContext::set($author);
    assertSame(200, changeScene($level, 'coast')->status());
    assertSame($chart, Level::findChart($level->id)['json'], 'el chart es el mismo');
    assertSame(5000, Progress::findByUserAndLevel($player->id, $level->id)->points, 'la marca sigue');
});

test('escenario: la API lo enseña a cualquiera que vea el nivel', function (): void {
    $level = ownLevelFor(makeUser('autor-lista'), 'escena-5');
    changeScene($level, 'coast');
    $shape = LevelPresenter::one(Level::findById($level->id), null);
    assertTrue(array_key_exists('scene', $shape), 'la tarjeta lleva el escenario');
    assertSame('coast', $shape['scene']);
});

test('escenario: la BD rechaza un id con otra forma (también en mayúsculas)', function (): void {
    $level = ownLevelFor(makeUser('autor-check'), 'escena-6');
    foreach (['Costa Brava', 'COAST'] as $bad) {
        assertThrows(\PDOException::class, function () use ($level, $bad): void {
            Database::getInstance()->prepare('UPDATE levels SET scene = :s WHERE id = :id')->execute(['s' => $bad, 'id' => $level->id]);
        });
    }
});
