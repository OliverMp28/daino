<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Database;
use App\Models\Ranking;

/**
 * Limpia los niveles duplicados que dejó el defecto D1 (antes de la Ola 3).
 *
 *     docker compose exec -T php composer levels:dedupe-legacy            (simulación)
 *     docker compose exec -T php composer levels:dedupe-legacy -- --apply
 *
 * Qué pasaba: jugar un nivel con sesión creaba una fila `levels` NUEVA en cada
 * partida, y el título acumulaba la extensión (defecto D2): `Sugar Red.mp3`,
 * `Sugar Red.mp3.mp3`, `Sugar Red.mp3.mp3`… El ranking contaba cada fila como un
 * nivel distinto. Desde la Ola 3 un nivel se identifica por el hash de su audio
 * y ya no se crean, pero las filas viejas seguían ahí.
 *
 * Qué se considera duplicado — solo filas anteriores a la Ola 3 (sin
 * `audio_sha256`) y no oficiales, del MISMO usuario, con el mismo título una vez
 * quitadas las extensiones repetidas, la misma duración y el mismo BPM. Las filas
 * con hash no se tocan: para ellas la unicidad ya la garantiza la base de datos.
 *
 * Qué se hace con cada grupo, en una transacción:
 *   1. Se elige la fila que se queda: la publicada, si la hay; si no, la que
 *      tenga chart; si no, la más antigua.
 *   2. Las marcas de las demás se FUSIONAN en ella (se queda la mejor de cada
 *      usuario, con la fecha en que se logró). Nadie pierde su mejor partida.
 *   3. Los comentarios se mueven a la fila que se queda.
 *   4. Se borran los duplicados y se limpia la extensión del título.
 *   5. Se recalcula el ranking de los usuarios afectados.
 */
final class LegacyLevelDeduper
{
    /**
     * @return list<array{user_id: int, title: string, keeper: int, duplicates: list<int>}>
     */
    public static function plan(): array
    {
        $rows = Database::getInstance()->query(
            'SELECT id, user_id, title, duration_sec, bpm, is_public, chart_status
             FROM levels
             WHERE audio_sha256 IS NULL AND is_official = FALSE AND user_id IS NOT NULL
             ORDER BY id',
        )->fetchAll();

        /** @var array<string, list<array<string, mixed>>> $groups */
        $groups = [];
        foreach ($rows as $row) {
            $key = implode('|', [
                (int) $row['user_id'],
                mb_strtolower(self::cleanTitle((string) $row['title'])),
                (int) $row['duration_sec'],
                $row['bpm'] === null ? 'null' : (int) $row['bpm'],
            ]);
            $groups[$key][] = $row;
        }

        $plan = [];
        foreach ($groups as $members) {
            if (count($members) < 2) {
                continue;
            }
            usort($members, static fn (array $a, array $b): int =>
                [(int) $b['is_public'], $b['chart_status'] === 'ready' ? 1 : 0, (int) $a['id']]
                <=> [(int) $a['is_public'], $a['chart_status'] === 'ready' ? 1 : 0, (int) $b['id']]);
            $keeper = $members[0];
            $plan[] = [
                'user_id'    => (int) $keeper['user_id'],
                'title'      => self::cleanTitle((string) $keeper['title']),
                'keeper'     => (int) $keeper['id'],
                'duplicates' => array_map(static fn (array $m): int => (int) $m['id'], array_slice($members, 1)),
            ];
        }
        return $plan;
    }

    /**
     * @param list<array{user_id: int, title: string, keeper: int, duplicates: list<int>}> $plan
     * @return array{levels_deleted: int, progress_merged: int, comments_moved: int, users_recomputed: list<int>}
     */
    public static function apply(array $plan): array
    {
        $pdo = Database::getInstance();
        $ownTransaction = !$pdo->inTransaction();
        if ($ownTransaction) {
            $pdo->beginTransaction();
        }

        $report = ['levels_deleted' => 0, 'progress_merged' => 0, 'comments_moved' => 0, 'users_recomputed' => []];
        $affectedUsers = [];
        try {
            foreach ($plan as $group) {
                $keeper = $group['keeper'];
                $dups = $group['duplicates'];
                if ($dups === []) {
                    continue;
                }
                $in = implode(',', array_fill(0, count($dups), '?'));

                // Usuarios con marcas en el grupo: su ranking cambia.
                $stmt = $pdo->prepare("SELECT DISTINCT user_id FROM progress WHERE level_id IN ({$in})");
                $stmt->execute($dups);
                foreach ($stmt->fetchAll() as $r) {
                    $affectedUsers[(int) $r['user_id']] = true;
                }

                // Fusión de marcas. El orden de las asignaciones importa: MariaDB
                // evalúa cada una con los valores YA actualizados por las
                // anteriores, así que la fecha se decide antes de subir los puntos.
                // Origen con alias `src` y destino cualificado como `progress.`:
                // en un INSERT … SELECT sobre la misma tabla, una columna sin
                // cualificar es ambigua (error 1052).
                $merge = $pdo->prepare(
                    "INSERT INTO progress (user_id, level_id, percentage, points, best_run_at)
                     SELECT src.user_id, ?, src.percentage, src.points, src.best_run_at
                     FROM progress AS src WHERE src.level_id IN ({$in})
                     ORDER BY src.points DESC
                     ON DUPLICATE KEY UPDATE
                        best_run_at = IF(VALUES(points) > progress.points, VALUES(best_run_at), progress.best_run_at),
                        percentage  = GREATEST(progress.percentage, VALUES(percentage)),
                        points      = GREATEST(progress.points, VALUES(points))",
                );
                $merge->execute([$keeper, ...$dups]);
                $report['progress_merged'] += $merge->rowCount() > 0 ? count($dups) : 0;

                $move = $pdo->prepare("UPDATE comments SET level_id = ? WHERE level_id IN ({$in})");
                $move->execute([$keeper, ...$dups]);
                $report['comments_moved'] += $move->rowCount();

                // Un duplicado nunca debería tener audio subido (solo se publicaba
                // una vez), pero si lo tuviera se conserva: se avisa, no se borra.
                $files = $pdo->prepare("SELECT id FROM levels WHERE id IN ({$in}) AND file_path IS NOT NULL");
                $files->execute($dups);
                if ($files->fetchAll() !== []) {
                    throw new \RuntimeException("El grupo del nivel {$keeper} tiene duplicados con audio subido: revísalo a mano.");
                }

                $delete = $pdo->prepare("DELETE FROM levels WHERE id IN ({$in})");
                $delete->execute($dups);
                $report['levels_deleted'] += $delete->rowCount();

                $pdo->prepare('UPDATE levels SET title = ? WHERE id = ?')->execute([$group['title'], $keeper]);
            }

            foreach (array_keys($affectedUsers) as $userId) {
                Ranking::recompute($userId);
                $report['users_recomputed'][] = $userId;
            }

            if ($ownTransaction) {
                $pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($ownTransaction && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        return $report;
    }

    /** "Sugar Red.mp3.mp3" → "Sugar Red". Solo quita extensiones de audio del final. */
    public static function cleanTitle(string $title): string
    {
        $clean = trim((string) preg_replace('/(\.(mp3|wav|ogg|m4a|flac))+$/i', '', trim($title)));
        return $clean === '' ? $title : $clean;
    }
}
