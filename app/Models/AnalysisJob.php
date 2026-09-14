<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;
use RuntimeException;

/**
 * AnalysisJob — un trabajo de la cola de análisis del servidor (Ola 4).
 *
 * PHP solo ENCOLA, CONSULTA y CANCELA. Reclamar, renovar la reserva, completar y
 * fallar lo hace el worker del servicio `analyzer` (analyzer/daino_analyzer/jobs.py),
 * que es el único que escribe resultados. Ver migración 009 para el porqué de
 * una cola en la base de datos.
 */
final class AnalysisJob
{
    public const STATUS_QUEUED    = 'queued';
    public const STATUS_RUNNING   = 'running';
    public const STATUS_DONE      = 'done';
    public const STATUS_FAILED    = 'failed';
    public const STATUS_CANCELLED = 'cancelled';

    public const PURPOSE_PUBLISH   = 'publish';
    public const PURPOSE_BACKFILL  = 'backfill';
    public const PURPOSE_REANALYZE = 'reanalyze';
    /** Ola 5: volver a chartear (otra dificultad) con el análisis ya guardado. */
    public const PURPOSE_RECHART   = 'rechart';

    /** Publicar lo espera una persona mirando la pantalla: va por delante del resto. */
    public const PRIORITY_INTERACTIVE = 10;
    public const PRIORITY_BACKGROUND  = 0;

    public function __construct(
        public readonly int $id,
        public readonly ?int $levelId,
        public readonly string $audioPath,
        public readonly ?string $audioSha256,
        public readonly string $purpose,
        public string $status,
        public readonly int $priority,
        public int $attempts,
        public readonly int $maxAttempts,
        public ?string $stage,
        public float $progress,
        public ?string $errorCode,
        public ?string $errorMessage,
        public readonly string $createdAt,
        public ?string $startedAt,
        public ?string $finishedAt,
    ) {
    }

    public static function enqueue(?int $levelId, string $audioPath, ?string $audioSha256, string $purpose, int $priority): self
    {
        $pdo = Database::getInstance();
        $pdo->prepare(
            'INSERT INTO analysis_jobs (level_id, audio_path, audio_sha256, purpose, priority)
             VALUES (:level_id, :audio_path, :sha, :purpose, :priority)',
        )->execute([
            'level_id'   => $levelId,
            'audio_path' => $audioPath,
            'sha'        => $audioSha256,
            'purpose'    => $purpose,
            'priority'   => $priority,
        ]);
        $job = self::findById((int) $pdo->lastInsertId());
        if ($job === null) {
            throw new RuntimeException('AnalysisJob::enqueue no pudo recuperar el trabajo creado.');
        }
        return $job;
    }

    public static function findById(int $id): ?self
    {
        $stmt = Database::getInstance()->prepare('SELECT * FROM analysis_jobs WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    public static function latestForLevel(int $levelId): ?self
    {
        return self::latestForLevels([$levelId])[$levelId] ?? null;
    }

    /**
     * Último trabajo de cada nivel, en una consulta (para las tarjetas de "Míos").
     *
     * @param list<int> $levelIds
     * @return array<int, self>  indexado por level_id
     */
    public static function latestForLevels(array $levelIds): array
    {
        if ($levelIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($levelIds), '?'));
        $stmt = Database::getInstance()->prepare(
            "SELECT j.* FROM analysis_jobs j
             JOIN (SELECT level_id, MAX(id) AS id FROM analysis_jobs WHERE level_id IN ({$in}) GROUP BY level_id) last
               ON last.id = j.id",
        );
        $stmt->execute($levelIds);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $job = self::fromRow($row);
            $out[(int) $job->levelId] = $job;
        }
        return $out;
    }

    public static function hasActive(int $levelId): bool
    {
        $stmt = Database::getInstance()->prepare(
            "SELECT 1 FROM analysis_jobs WHERE level_id = :id AND status IN ('queued', 'running') LIMIT 1",
        );
        $stmt->execute(['id' => $levelId]);
        return $stmt->fetchColumn() !== false;
    }

    /**
     * Cancela los trabajos pendientes o en curso de un nivel. Un worker que esté
     * con uno lo descubre al renovar su reserva y abandona sin escribir nada.
     */
    public static function cancelActiveForLevel(int $levelId, string $reason = 'superseded'): int
    {
        $stmt = Database::getInstance()->prepare(
            "UPDATE analysis_jobs
             SET status = 'cancelled', error_code = :reason, finished_at = NOW(3), lease_until = NULL
             WHERE level_id = :id AND status IN ('queued', 'running')",
        );
        $stmt->execute(['id' => $levelId, 'reason' => $reason]);
        return $stmt->rowCount();
    }

    /**
     * Trabajos por delante en la cola (0 = el siguiente). null si no está en cola.
     */
    public function queuePosition(): ?int
    {
        if ($this->status !== self::STATUS_QUEUED) {
            return null;
        }
        $stmt = Database::getInstance()->prepare(
            "SELECT COUNT(*) FROM analysis_jobs
             WHERE status = 'queued' AND (priority > :p OR (priority = :p2 AND id < :id))",
        );
        $stmt->execute(['p' => $this->priority, 'p2' => $this->priority, 'id' => $this->id]);
        return (int) $stmt->fetchColumn();
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_QUEUED || $this->status === self::STATUS_RUNNING;
    }

    /**
     * Forma pública para la API: lo que necesita la UI para enseñar el progreso.
     *
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'status'         => $this->status,
            // Ola 5: la UI distingue publicar de aplicar otra dificultad.
            'purpose'        => $this->purpose,
            'stage'          => $this->stage,
            'progress'       => round($this->progress, 3),
            'attempts'       => $this->attempts,
            'queue_position' => $this->queuePosition(),
            // Solo el código: el mensaje es del worker (salida de ffmpeg, rutas
            // internas del servidor) y se queda en BD y logs. La UI traduce el
            // código a un texto para el jugador (resources/js/ui/publishModel.js).
            'error'          => $this->errorCode === null || $this->status !== self::STATUS_FAILED ? null : [
                'code' => $this->errorCode,
            ],
            'created_at'     => $this->createdAt,
            'finished_at'    => $this->finishedAt,
        ];
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function fromRow(array $row): self
    {
        return new self(
            id:           (int) $row['id'],
            levelId:      $row['level_id'] === null ? null : (int) $row['level_id'],
            audioPath:    (string) $row['audio_path'],
            audioSha256:  $row['audio_sha256'] === null ? null : (string) $row['audio_sha256'],
            purpose:      (string) $row['purpose'],
            status:       (string) $row['status'],
            priority:     (int) $row['priority'],
            attempts:     (int) $row['attempts'],
            maxAttempts:  (int) $row['max_attempts'],
            stage:        $row['stage'] === null ? null : (string) $row['stage'],
            progress:     (float) $row['progress'],
            errorCode:    $row['error_code'] === null ? null : (string) $row['error_code'],
            errorMessage: $row['error_message'] === null ? null : (string) $row['error_message'],
            createdAt:    (string) $row['created_at'],
            startedAt:    $row['started_at'] === null ? null : (string) $row['started_at'],
            finishedAt:   $row['finished_at'] === null ? null : (string) $row['finished_at'],
        );
    }
}
