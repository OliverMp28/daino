<?php
declare(strict_types=1);

/**
 * Siembra los niveles oficiales. Ver App\Services\OfficialCatalogSeeder.
 *
 *     docker compose exec -T php composer seed:official
 *     docker compose exec -T php composer seed:official -- --from=docs/legacy/audios
 *     docker compose exec -T php composer seed:official -- --rechart
 *     docker compose exec -T php composer seed:official -- --dry-run
 *
 *   --from=DIR   copia los MP3 desde DIR (relativo a la raíz del proyecto) a
 *                storage/official/ tras comprobar que son los horneados.
 *   --rechart    permite sustituir el chart/audio de oficiales ya sembrados.
 *   --dry-run    ejecuta todo dentro de una transacción y la revierte.
 *
 * Código de salida 1 si alguna entrada se saltó: un despliegue automatizado
 * debe enterarse de que el catálogo quedó incompleto.
 */

require __DIR__ . '/../app/bootstrap.php';

use App\Core\Database;
use App\Services\FileUploadService;
use App\Services\OfficialCatalogSeeder;

restore_exception_handler();

$root = realpath(__DIR__ . '/..');
$opts = ['from' => null, 'rechart' => false];
$dryRun = false;
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--from=')) {
        $dir = substr($arg, 7);
        $abs = str_starts_with($dir, '/') ? $dir : "{$root}/{$dir}";
        if (!is_dir($abs)) {
            fwrite(STDERR, "--from: no existe el directorio {$abs}\n");
            exit(2);
        }
        $opts['from'] = realpath($abs);
    } elseif ($arg === '--rechart') {
        $opts['rechart'] = true;
    } elseif ($arg === '--dry-run') {
        $dryRun = true;
    } else {
        fwrite(STDERR, "Argumento desconocido: {$arg}\n");
        exit(2);
    }
}

$seeder = new OfficialCatalogSeeder(
    "{$root}/database/seeds/official",
    FileUploadService::officialDir(),
    static function (string $line): void { echo $line, "\n"; },
);

$pdo = Database::getInstance();
if ($dryRun) {
    $pdo->beginTransaction();
    echo "(dry-run: nada se guardará; los MP3 de --from sí se copian)\n";
}

$report = $seeder->run($opts);

if ($dryRun && $pdo->inTransaction()) {
    $pdo->rollBack();
}

$counts = array_count_values(array_column($report, 'result'));
ksort($counts);
echo "\n", implode(', ', array_map(static fn ($k, $v) => "{$v} {$k}", array_keys($counts), $counts)), "\n";
exit(($counts[OfficialCatalogSeeder::RESULT_SKIPPED] ?? 0) === 0 ? 0 : 1);
