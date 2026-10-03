<?php
declare(strict_types=1);

namespace App\Services;

use InvalidArgumentException;

/**
 * Identidad de los efectos de un nivel (T03.3, doc 11): `levels.fx_auto`.
 *
 * Qué paleta y qué firma le pegan a una canción lo decide el reparto del juego
 * (resources/js/game/fx/casting.js) con el análisis del servidor. Aquí solo se
 * cuida LA FORMA de lo que se guarda y se sirve: un objeto con las claves que
 * haya (`palette`, `signature`), cada una un id.
 *
 * A propósito no hay lista cerrada de paletas ni de firmas: el registro vive en
 * el juego, y un cliente ignora un id que no conoce (cae en lo de siempre). Así
 * añadir una paleta no obliga a tocar el servidor, y no hay un espejo que se
 * pueda quedar atrás.
 *
 * Nunca lo escribe una petición: solo el seeder de oficiales, el worker del
 * analizador y `python -m daino_analyzer cast`.
 */
final class FxIdentity
{
    /** Claves admitidas, en el orden en que se guardan. */
    public const KEYS = ['palette', 'signature'];

    /** Forma de un id (la de una escena: migración 012). */
    public const ID_PATTERN = '/^[a-z][a-z0-9-]{1,31}$/';

    /**
     * Valida y ordena. `null` (o un objeto vacío) es "nada propio".
     *
     * @return array{palette?: string, signature?: string}|null
     * @throws InvalidArgumentException  Si no tiene la forma esperada.
     */
    public static function parse(mixed $value): ?array
    {
        if ($value === null) {
            return null;
        }
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new InvalidArgumentException('la identidad de los efectos tiene que ser un objeto');
        }
        $out = [];
        foreach ($value as $key => $id) {
            if (!in_array($key, self::KEYS, true)) {
                throw new InvalidArgumentException("clave desconocida \"{$key}\"");
            }
            if ($id === null) {
                continue;
            }
            if (!is_string($id) || preg_match(self::ID_PATTERN, $id) !== 1) {
                throw new InvalidArgumentException("\"{$key}\" no es un id");
            }
        }
        foreach (self::KEYS as $key) {
            if (isset($value[$key])) {
                $out[$key] = $value[$key];
            }
        }
        return $out === [] ? null : $out;
    }

    /**
     * Texto canónico para la columna (claves en orden, sin espacios): dos
     * identidades iguales dan el mismo texto, lo escriba PHP o el analizador.
     *
     * @param array{palette?: string, signature?: string}|null $identity  Ya validada con `parse`.
     */
    public static function encode(?array $identity): ?string
    {
        return $identity === null ? null : json_encode($identity, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    }

    /**
     * Lo guardado, para servirlo. Indulgente: una fila con algo que no se entiende
     * es "nada propio", no un error (la partida se juega con lo de siempre).
     *
     * @return array{palette?: string, signature?: string}|null
     */
    public static function decode(?string $stored): ?array
    {
        if ($stored === null || $stored === '') {
            return null;
        }
        try {
            return self::parse(json_decode($stored, true, 4, JSON_THROW_ON_ERROR));
        } catch (\JsonException | InvalidArgumentException) {
            return null;
        }
    }
}
