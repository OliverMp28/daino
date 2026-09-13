<?php
declare(strict_types=1);

/**
 * Limpia los niveles duplicados del defecto D1. Ver App\Services\LegacyLevelDeduper.
 *
 *     docker compose exec -T php composer levels:dedupe-legacy             simulación
 *     docker compose exec -T php composer levels:dedupe-legacy -- --apply  aplica
 */

require __DIR__ . '/../app/bootstrap.php';

use App\Services\LegacyLevelDeduper;

restore_exception_handler();

$apply = in_array('--apply', array_slice($argv, 1), true);
$plan = LegacyLevelDeduper::plan();

if ($plan === []) {
    echo "No hay niveles duplicados de antes de la Ola 3.\n";
    exit(0);
}

foreach ($plan as $group) {
    printf(
        "  usuario %d · «%s»: se queda el nivel %d, se fusionan y borran %s\n",
        $group['user_id'],
        $group['title'],
        $group['keeper'],
        implode(', ', $group['duplicates']),
    );
}

if (!$apply) {
    echo "\nSimulación: no se ha cambiado nada. Añade --apply para aplicarlo.\n";
    exit(0);
}

$report = LegacyLevelDeduper::apply($plan);
printf(
    "\nHecho: %d niveles borrados, marcas de %d duplicados fusionadas, %d comentarios movidos, ranking recalculado para %d usuario(s).\n",
    $report['levels_deleted'],
    $report['progress_merged'],
    $report['comments_moved'],
    count($report['users_recomputed']),
);
