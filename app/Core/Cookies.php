<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Punto único por el que la sesión y el refresco escriben cookies.
 *
 * Existe para que los tests puedan ver qué cookie se escribió y con qué
 * atributos (p. ej. que un fallo de red NO borra el refresh token): en CLI
 * `setcookie()` no tiene a quién escribir.
 */
final class Cookies
{
    /** @var (\Closure(string, string, array<string, mixed>): void)|null */
    private static ?\Closure $writer = null;

    /**
     * @param array{expires?: int, path?: string, domain?: string, secure?: bool, httponly?: bool, samesite?: string} $options
     */
    public static function set(string $name, string $value, array $options): void
    {
        if (self::$writer !== null) {
            (self::$writer)($name, $value, $options);
            return;
        }
        setcookie($name, $value, $options);
    }

    /**
     * Solo tests: desvía las escrituras a `$writer`; `null` vuelve a `setcookie()`.
     *
     * @param (\Closure(string, string, array<string, mixed>): void)|null $writer
     */
    public static function writeWith(?\Closure $writer): void
    {
        self::$writer = $writer;
    }
}
