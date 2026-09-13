<?php
declare(strict_types=1);

/**
 * Runner mínimo de tests PHP, sin dependencias.
 *
 *     docker compose exec -T php composer test
 *
 * Por qué no Pest/PHPUnit todavía: el doc 08 los planifica para el Bloque 8
 * (hardening) junto a PHPStan. Estos tests están escritos para migrarse tal
 * cual: cada `test()` es un caso independiente con aserciones explícitas.
 *
 * Aislamiento: cada test corre dentro de una transacción que se REVIERTE al
 * terminar, pase o falle. Se ejercita la base de datos real (constraints,
 * índices únicos, JSON_VALID) sin dejar datos. MariaDB revierte a nivel de
 * sentencia los errores de clave duplicada, así que la transacción sobrevive a
 * los tests que los provocan a propósito.
 */

require __DIR__ . '/../../app/bootstrap.php';

use App\Core\AuthContext;
use App\Core\Database;

// El handler global de bootstrap escribe JSON; en CLI queremos ver el error.
restore_exception_handler();

/** @var list<array{name: string, fn: callable}> $tests */
$tests = [];

function test(string $name, callable $fn): void
{
    global $tests;
    $tests[] = ['name' => $name, 'fn' => $fn];
}

final class AssertionFailed extends \RuntimeException
{
}

function assertSame(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new AssertionFailed(sprintf(
            "%s\n      esperado: %s\n      obtenido: %s",
            $message === '' ? 'Los valores no coinciden' : $message,
            var_export($expected, true),
            var_export($actual, true),
        ));
    }
}

function assertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new AssertionFailed($message);
    }
}

/**
 * @param class-string<\Throwable> $class
 */
function assertThrows(string $class, callable $fn, ?callable $inspect = null): void
{
    try {
        $fn();
    } catch (\Throwable $e) {
        if (!$e instanceof $class) {
            throw new AssertionFailed("Se esperaba {$class}, se lanzó " . $e::class . ': ' . $e->getMessage());
        }
        if ($inspect !== null) {
            $inspect($e);
        }
        return;
    }
    throw new AssertionFailed("Se esperaba {$class} y no se lanzó nada.");
}

foreach (glob(__DIR__ . '/*Test.php') ?: [] as $file) {
    require $file;
}

$pdo = Database::getInstance();
$passed = 0;
$failed = 0;
$started = microtime(true);

foreach ($tests as ['name' => $name, 'fn' => $fn]) {
    $pdo->beginTransaction();
    AuthContext::clear();
    try {
        $fn();
        $passed++;
        echo "  ok    {$name}\n";
    } catch (\Throwable $e) {
        $failed++;
        echo "  FALLO {$name}\n      " . $e->getMessage() . "\n";
        if (!$e instanceof AssertionFailed) {
            echo '      en ' . $e->getFile() . ':' . $e->getLine() . "\n";
        }
    } finally {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    }
}

printf("\n%d tests, %d ok, %d fallos (%.2f s)\n", $passed + $failed, $passed, $failed, microtime(true) - $started);
exit($failed === 0 ? 0 : 1);
