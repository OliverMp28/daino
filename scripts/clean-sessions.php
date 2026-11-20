<?php
declare(strict_types=1);

/**
 * Limpia archivos de sesión antiguos en storage/sessions/.
 *
 * Borra cualquier sess_* cuyo mtime sea más viejo que SESSION_LIFETIME_MIN
 * (en minutos). Sin args para "limpieza basada en política", o `--all` para
 * borrar todos sin importar la edad (útil tras un redeploy o cambio de
 * formato de sesión).
 *
 * **Ejecutar SIEMPRE dentro del contenedor PHP** (igual que composer migrate):
 *
 *   docker compose exec -T php composer clean:sessions
 *   docker compose exec -T php composer clean:sessions -- --all
 *
 * Razón: `composer.json` exige PHP `~8.5.13` (la de las imágenes Docker). Si
 * se ejecuta en el host con otra versión (p. ej. PHP 8.5.0 de Windows),
 * Composer revienta con `platform_check` antes de invocar el script. El
 * contenedor `php` tiene 8.5.13 garantizado.
 *
 * No automatiza nada (sin cron). Si en algún momento necesitas GC continuo,
 * o subes session.gc_probability en bootstrap, o añades este script al
 * pipeline de CI/deploy.
 */

require __DIR__ . '/../app/bootstrap.php';

use App\Core\Env;

$sessionsDir = realpath(__DIR__ . '/../storage/sessions');
if ($sessionsDir === false || !is_dir($sessionsDir)) {
    fwrite(STDERR, "ERROR: storage/sessions/ no existe o no es accesible.\n");
    exit(1);
}

$wipeAll = in_array('--all', $argv, true);
$lifetimeMin = Env::int('SESSION_LIFETIME_MIN', 120);
$cutoff = $wipeAll ? PHP_INT_MAX : (time() - $lifetimeMin * 60);

$files = glob($sessionsDir . '/sess_*') ?: [];
$deleted = 0;
$kept = 0;
$failed = 0;

foreach ($files as $f) {
    if (!is_file($f)) {
        continue;
    }
    $mtime = filemtime($f);
    if ($mtime !== false && ($wipeAll || $mtime < $cutoff)) {
        if (@unlink($f)) {
            $deleted++;
        } else {
            $failed++;
        }
    } else {
        $kept++;
    }
}

$mode = $wipeAll ? 'todos los archivos' : "más viejos que {$lifetimeMin} min";
echo "Limpieza de sesiones ({$mode}):\n";
echo "  borrados:    {$deleted}\n";
echo "  mantenidos:  {$kept}\n";
if ($failed > 0) {
    echo "  fallaron:    {$failed} (probable problema de permisos)\n";
    exit(2);
}
exit(0);
