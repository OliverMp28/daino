<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Escenarios de los niveles (T02.1, doc 11).
 *
 * El registro de escenas vive en el juego (resources/js/game/scenes/registry.js):
 * paleta, ciclo del cielo, capas. Aquí solo hace falta saber qué AMBIENTES puede
 * elegir quien sube un nivel, para validar la petición. La lista es espejo de las
 * escenas `selectable` del registro; un test (tests/js/scenes.test.mjs) lee este
 * archivo y falla si no coinciden.
 *
 * Las historias de autor (una escena para UNA canción, T02.6) nunca están aquí:
 * solo las pone el manifiesto del catálogo oficial.
 */
final class SceneCatalog
{
    /** Ambientes elegibles para un nivel, en el orden del selector. */
    public const SELECTABLE = ['mountains', 'coast', 'rain', 'storm', 'snow', 'city'];

    /** Forma de un id de escena (misma que el CHECK de `levels.scene`). */
    public const ID_PATTERN = '/^[a-z][a-z0-9-]{1,31}$/';

    public static function isSelectable(string $id): bool
    {
        return in_array($id, self::SELECTABLE, true);
    }

    public static function isValidId(string $id): bool
    {
        return preg_match(self::ID_PATTERN, $id) === 1;
    }
}
