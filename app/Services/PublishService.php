<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Database;
use App\Core\Env;
use App\Models\AnalysisJob;
use App\Models\Level;

/**
 * Publicación de niveles con análisis en servidor (Ola 4).
 *
 * Regla: un nivel NO aparece en el catálogo hasta que el servidor lo ha
 * analizado. Al publicar se guarda el MP3, el nivel queda "pendiente de
 * publicar" y se encola su análisis en la MISMA transacción; el worker lo hace
 * público al terminar. Así todo nivel público se juega con el chart del
 * analizador del servidor, no con el que generó el navegador de quien lo subió.
 *
 * Sin analizador (`ANALYZER_ENABLED=false`, p. ej. un despliegue sin el servicio
 * Python) se publica al instante con el chart del cliente, como en la Ola 3: el
 * sistema degrada, no se rompe.
 */
final class PublishService
{
    public static function analyzerEnabled(): bool
    {
        return Env::bool('ANALYZER_ENABLED', false);
    }

    /**
     * @return array{published: bool, job: ?AnalysisJob}
     */
    public static function requestPublish(Level $level, string $relativePath, string $audioSha256): array
    {
        if (!self::analyzerEnabled()) {
            $level->setPublic(true, $relativePath);
            return ['published' => true, 'job' => null];
        }

        $job = self::transaction(static function () use ($level, $relativePath, $audioSha256): AnalysisJob {
            $pdo = Database::getInstance();
            $pdo->prepare('SELECT id FROM levels WHERE id = :id FOR UPDATE')->execute(['id' => $level->id]);
            AnalysisJob::cancelActiveForLevel($level->id);
            $pdo->prepare(
                "UPDATE levels
                 SET file_path = :path,
                     pending_public = (is_public = FALSE),
                     chart_status = IF(chart_status IN ('none', 'failed'), 'analyzing', chart_status)
                 WHERE id = :id",
            )->execute(['path' => $relativePath, 'id' => $level->id]);
            return AnalysisJob::enqueue(
                $level->id,
                $relativePath,
                $audioSha256,
                AnalysisJob::PURPOSE_PUBLISH,
                AnalysisJob::PRIORITY_INTERACTIVE,
            );
        });
        return ['published' => false, 'job' => $job];
    }

    /**
     * Reintenta el análisis de un nivel cuyo trabajo falló (o reanaliza a
     * petición de su autor). Exige audio subido y ningún trabajo activo.
     */
    public static function retry(Level $level): AnalysisJob
    {
        if ($level->filePath === null) {
            throw new \DomainException('no_audio');
        }
        return self::transaction(static function () use ($level): AnalysisJob {
            $pdo = Database::getInstance();
            $pdo->prepare('SELECT id FROM levels WHERE id = :id FOR UPDATE')->execute(['id' => $level->id]);
            if (AnalysisJob::hasActive($level->id)) {
                throw new \DomainException('already_active');
            }
            $pdo->prepare(
                "UPDATE levels
                 SET pending_public = (is_public = FALSE),
                     chart_status = IF(chart_status IN ('none', 'failed'), 'analyzing', chart_status)
                 WHERE id = :id",
            )->execute(['id' => $level->id]);
            return AnalysisJob::enqueue(
                $level->id,
                (string) $level->filePath,
                $level->audioSha256,
                AnalysisJob::PURPOSE_PUBLISH,
                AnalysisJob::PRIORITY_INTERACTIVE,
            );
        });
    }

    /**
     * Retira un nivel del catálogo: cancela su análisis, lo deja privado y borra
     * su audio del servidor (Local-First: el audio de un nivel privado vive en
     * el equipo de su autor).
     */
    public static function unpublish(Level $level): void
    {
        $path = $level->filePath;
        self::transaction(static function () use ($level): void {
            AnalysisJob::cancelActiveForLevel($level->id, 'unpublished');
            Database::getInstance()->prepare(
                "UPDATE levels
                 SET is_public = FALSE, pending_public = FALSE, file_path = NULL,
                     chart_status = IF(chart_status = 'analyzing', 'none', chart_status)
                 WHERE id = :id",
            )->execute(['id' => $level->id]);
        });
        if ($path !== null) {
            FileUploadService::deleteLevelMp3($path);
        }
    }

    /**
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    private static function transaction(callable $fn): mixed
    {
        $pdo = Database::getInstance();
        if ($pdo->inTransaction()) {
            return $fn();
        }
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}
