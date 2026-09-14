<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;
use RuntimeException;

/**
 * Progress — mejor partida de cada (user, level).
 *
 * `upsert` es atómico vía INSERT ... ON DUPLICATE KEY UPDATE: si ya existe la
 * combinación (user_id, level_id), actualiza percentage/points solo si la
 * nueva puntuación supera la guardada (no degradamos progreso).
 */
final class Progress
{
    public function __construct(
        public readonly int $id,
        public readonly int $userId,
        public readonly int $levelId,
        public int $percentage,
        public int $points,
        public string $bestRunAt,
    ) {
    }

    public static function findByUserAndLevel(int $userId, int $levelId): ?self
    {
        $stmt = Database::getInstance()->prepare(
            'SELECT * FROM progress WHERE user_id = :user_id AND level_id = :level_id',
        );
        $stmt->execute(['user_id' => $userId, 'level_id' => $levelId]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    /**
     * Inserta o actualiza el progreso. Solo sube percentage/points si superan
     * los previos. Devuelve la fila resultante (recién insertada o actualizada).
     */
    public static function upsert(int $userId, int $levelId, int $percentage, int $points): self
    {
        $pdo = Database::getInstance();
        $stmt = $pdo->prepare(
            'INSERT INTO progress (user_id, level_id, percentage, points)
             VALUES (:user_id, :level_id, :percentage, :points)
             ON DUPLICATE KEY UPDATE
                percentage  = GREATEST(percentage, VALUES(percentage)),
                points      = GREATEST(points, VALUES(points)),
                best_run_at = CASE
                    WHEN VALUES(points) > points THEN CURRENT_TIMESTAMP
                    ELSE best_run_at
                END',
        );
        $stmt->execute([
            'user_id'    => $userId,
            'level_id'   => $levelId,
            'percentage' => $percentage,
            'points'     => $points,
        ]);
        $row = self::findByUserAndLevel($userId, $levelId);
        if ($row === null) {
            throw new RuntimeException(
                "Progress::upsert no pudo recuperar la fila tras upsert (user={$userId}, level={$levelId}).",
            );
        }
        return $row;
    }

    /**
     * Mejor marca de un usuario en cada nivel de una página del catálogo, en
     * UNA consulta (sin N+1 por tarjeta).
     *
     * @param list<int> $levelIds
     * @return array<int, array{points: int, percentage: int}>  indexado por level_id
     */
    public static function bestForUserOnLevels(int $userId, array $levelIds): array
    {
        if ($levelIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($levelIds), '?'));
        $stmt = Database::getInstance()->prepare(
            "SELECT level_id, points, percentage FROM progress WHERE user_id = ? AND level_id IN ({$in})",
        );
        $stmt->execute([$userId, ...$levelIds]);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[(int) $row['level_id']] = ['points' => (int) $row['points'], 'percentage' => (int) $row['percentage']];
        }
        return $out;
    }

    /**
     * Jugadores distintos con marca guardada en cada nivel, en una consulta.
     * (Una fila de `progress` por usuario y nivel ⇒ COUNT = jugadores.)
     *
     * @param list<int> $levelIds
     * @return array<int, int>  indexado por level_id; los niveles sin jugadores no aparecen
     */
    public static function playerCounts(array $levelIds): array
    {
        if ($levelIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($levelIds), '?'));
        $stmt = Database::getInstance()->prepare(
            "SELECT level_id, COUNT(*) AS players FROM progress WHERE level_id IN ({$in}) GROUP BY level_id",
        );
        $stmt->execute($levelIds);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[(int) $row['level_id']] = (int) $row['players'];
        }
        return $out;
    }

    /**
     * Mejores marcas de un nivel. Empate a puntos: gana quien lo logró antes.
     * Usa `idx_progress_level_points (level_id, points)`.
     *
     * @return list<self>
     */
    public static function topForLevel(int $levelId, int $limit = 10): array
    {
        $stmt = Database::getInstance()->prepare(
            'SELECT * FROM progress WHERE level_id = :level_id
             ORDER BY points DESC, best_run_at ASC, id ASC LIMIT :lim',
        );
        $stmt->bindValue(':level_id', $levelId, \PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, \PDO::PARAM_INT);
        $stmt->execute();
        return array_map(self::fromRow(...), $stmt->fetchAll());
    }

    /**
     * Posición de una marca dentro de su nivel, con el mismo criterio de orden
     * que `topForLevel` (1 = primero).
     */
    public function rankOnLevel(): int
    {
        $stmt = Database::getInstance()->prepare(
            'SELECT COUNT(*) AS ahead FROM progress
             WHERE level_id = :level_id
               AND (points > :points
                    OR (points = :points2 AND (best_run_at < :at OR (best_run_at = :at2 AND id < :id))))',
        );
        $stmt->execute([
            'level_id' => $this->levelId,
            'points'   => $this->points,
            'points2'  => $this->points,
            'at'       => $this->bestRunAt,
            'at2'      => $this->bestRunAt,
            'id'       => $this->id,
        ]);
        $row = $stmt->fetch();
        return ($row === false ? 0 : (int) $row['ahead']) + 1;
    }

    /**
     * Borra las marcas de un nivel cuyo chart deja de ser el que se jugó y
     * recalcula el ranking global de quienes las tenían. Una marca solo vale
     * para el chart con el que se hizo: si no, bastaría con superar un nivel en
     * Relajado y publicarlo en Extremo para estrenar su ranking con un 100 %.
     *
     * @return int  marcas borradas
     */
    public static function invalidateForLevel(int $levelId): int
    {
        $pdo = Database::getInstance();
        $stmt = $pdo->prepare('SELECT DISTINCT user_id FROM progress WHERE level_id = :level_id');
        $stmt->execute(['level_id' => $levelId]);
        $userIds = array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
        if ($userIds === []) {
            return 0;
        }
        $delete = $pdo->prepare('DELETE FROM progress WHERE level_id = :level_id');
        $delete->execute(['level_id' => $levelId]);
        foreach ($userIds as $userId) {
            Ranking::recompute($userId);
        }
        return $delete->rowCount();
    }

    public static function countForLevel(int $levelId): int
    {
        $stmt = Database::getInstance()->prepare('SELECT COUNT(*) AS c FROM progress WHERE level_id = :level_id');
        $stmt->execute(['level_id' => $levelId]);
        $row = $stmt->fetch();
        return $row === false ? 0 : (int) $row['c'];
    }

    public function delete(): void
    {
        $stmt = Database::getInstance()->prepare('DELETE FROM progress WHERE id = :id');
        $stmt->execute(['id' => $this->id]);
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function fromRow(array $row): self
    {
        return new self(
            id:         (int) $row['id'],
            userId:     (int) $row['user_id'],
            levelId:    (int) $row['level_id'],
            percentage: (int) $row['percentage'],
            points:     (int) $row['points'],
            bestRunAt:  (string) $row['best_run_at'],
        );
    }
}
