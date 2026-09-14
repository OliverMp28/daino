<?php
declare(strict_types=1);

/**
 * Mantenimiento de la cola de análisis (Ola 4).
 *
 *     docker compose exec -T php composer analysis:status
 *     docker compose exec -T php composer analysis:enqueue -- --missing-charts
 *     docker compose exec -T php composer analysis:enqueue -- --level=12,15
 *     docker compose exec -T php composer analysis:enqueue -- --client-charts
 *     docker compose exec -T php composer analysis:enqueue -- --charter-below=3
 *
 *   --missing-charts  niveles con audio en el servidor y SIN chart (p. ej. los
 *                     publicados antes de la Ola 3): se analizan y se les pone.
 *   --level=IDS       reanaliza esos niveles aunque ya tengan chart (explícito).
 *   --client-charts   niveles PÚBLICOS de la comunidad cuyo chart lo generó el
 *                     navegador de su autor: se reanalizan en el servidor. Cambia
 *                     su chart, así que las marcas previas dejan de ser comparables.
 *   --charter-below=N niveles de la comunidad con chart de un charter anterior a
 *                     la versión N: re-chart con el análisis guardado (Ola 5:
 *                     `--charter-below=3` los pasa al charter musical). También
 *                     cambia su chart: mismo aviso que --client-charts.
 *
 * Nunca encola un nivel que ya tenga un trabajo activo.
 */

require __DIR__ . '/../app/bootstrap.php';

use App\Core\Database;
use App\Models\AnalysisJob;

restore_exception_handler();

$argv = array_slice($argv, 1);
$command = $argv[0] ?? 'status';
$pdo = Database::getInstance();

if ($command === 'status') {
    $counts = $pdo->query('SELECT status, COUNT(*) AS n FROM analysis_jobs GROUP BY status')->fetchAll();
    echo 'Cola: ' . ($counts === [] ? 'vacía' : implode(', ', array_map(static fn ($r) => "{$r['n']} {$r['status']}", $counts))) . "\n\n";
    $rows = $pdo->query(
        'SELECT j.id, j.level_id, l.title, j.purpose, j.status, j.stage, j.progress, j.attempts, j.error_code,
                j.created_at, j.finished_at, TIMESTAMPDIFF(SECOND, j.started_at, COALESCE(j.finished_at, NOW(3))) AS secs
         FROM analysis_jobs j LEFT JOIN levels l ON l.id = j.level_id
         ORDER BY j.id DESC LIMIT 15',
    )->fetchAll();
    foreach ($rows as $r) {
        printf(
            "  #%-5d nivel %-5s %-28s %-9s %-9s %-10s %3d%%  intentos %d  %s%s\n",
            $r['id'], $r['level_id'] ?? '—', mb_strimwidth((string) $r['title'], 0, 28, '…'), $r['purpose'], $r['status'],
            (string) $r['stage'], (int) round((float) $r['progress'] * 100), $r['attempts'],
            $r['secs'] !== null ? "{$r['secs']} s" : '', $r['error_code'] ? "  [{$r['error_code']}]" : '',
        );
    }
    exit(0);
}

if ($command !== 'enqueue') {
    fwrite(STDERR, "Uso: analysis-queue.php status | enqueue --missing-charts | --level=IDS | --client-charts | --charter-below=N\n");
    exit(2);
}

$flags = array_slice($argv, 1);
$targets = [];
foreach ($flags as $flag) {
    if ($flag === '--missing-charts') {
        $rows = $pdo->query(
            "SELECT id, file_path, audio_sha256 FROM levels
             WHERE file_path IS NOT NULL AND chart_status <> 'ready' AND is_official = FALSE",
        )->fetchAll();
        foreach ($rows as $r) {
            $targets[(int) $r['id']] = [$r, AnalysisJob::PURPOSE_BACKFILL];
        }
    } elseif ($flag === '--client-charts') {
        $rows = $pdo->query(
            "SELECT id, file_path, audio_sha256 FROM levels
             WHERE file_path IS NOT NULL AND is_public = TRUE AND is_official = FALSE AND chart_status = 'ready'
               AND (analysis_json IS NULL OR JSON_VALUE(analysis_json, '$.formatVersion') < 2)",
        )->fetchAll();
        foreach ($rows as $r) {
            $targets[(int) $r['id']] = [$r, AnalysisJob::PURPOSE_REANALYZE];
        }
    } elseif (str_starts_with($flag, '--charter-below=')) {
        // Ola 5: niveles de la comunidad con chart de un charter anterior. Se
        // re-chartean con el análisis guardado (segundos, sin reanalizar) y la
        // dificultad que su autor tuviera pedida.
        $version = (int) substr($flag, strlen('--charter-below='));
        if ($version < 2) {
            fwrite(STDERR, "--charter-below necesita una versión ≥ 2\n");
            exit(2);
        }
        $stmt = $pdo->prepare(
            "SELECT id, file_path, audio_sha256 FROM levels
             WHERE file_path IS NOT NULL AND is_official = FALSE AND chart_status = 'ready' AND chart_version < ?",
        );
        $stmt->execute([$version]);
        foreach ($stmt->fetchAll() as $r) {
            $targets[(int) $r['id']] = [$r, AnalysisJob::PURPOSE_RECHART];
        }
    } elseif (str_starts_with($flag, '--level=')) {
        $ids = array_filter(array_map('intval', explode(',', substr($flag, 8))));
        foreach ($ids as $id) {
            $stmt = $pdo->prepare('SELECT id, file_path, audio_sha256 FROM levels WHERE id = ? AND file_path IS NOT NULL');
            $stmt->execute([$id]);
            $r = $stmt->fetch();
            if ($r === false) {
                echo "  nivel {$id}: no existe o no tiene audio en el servidor\n";
                continue;
            }
            $targets[$id] = [$r, AnalysisJob::PURPOSE_REANALYZE];
        }
    } else {
        fwrite(STDERR, "Opción desconocida: {$flag}\n");
        exit(2);
    }
}

$queued = 0;
foreach ($targets as $id => [$r, $purpose]) {
    if (AnalysisJob::hasActive($id)) {
        echo "  nivel {$id}: ya tiene un análisis activo\n";
        continue;
    }
    $pdo->prepare("UPDATE levels SET chart_status = IF(chart_status IN ('none', 'failed'), 'analyzing', chart_status) WHERE id = ?")->execute([$id]);
    $job = AnalysisJob::enqueue($id, (string) $r['file_path'], $r['audio_sha256'], $purpose, AnalysisJob::PRIORITY_BACKGROUND);
    echo "  nivel {$id}: trabajo #{$job->id} ({$purpose})\n";
    $queued++;
}
echo "\n{$queued} trabajo(s) encolado(s).\n";
