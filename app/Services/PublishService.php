<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Database;
use App\Core\Env;
use App\Models\AnalysisJob;
use App\Models\Level;
use App\Models\Progress;

/**
 * Publicación de niveles con análisis en servidor (Ola 4) y dificultad elegida
 * antes de publicar (ajustes tras el playtest de la Ola 5).
 *
 * Regla: un nivel NO aparece en el catálogo hasta que el servidor lo ha
 * analizado y su autor ha elegido con qué dificultad sale. En dos pasos:
 *
 *   1. Publicar sube el MP3, deja el nivel "pendiente" y encola su análisis en la
 *      MISMA transacción. El worker lo analiza y genera el chart de cada
 *      dificultad que la canción admite: el nivel queda LISTO PARA PUBLICAR.
 *   2. Su autor elige una de esas dificultades (instantáneo: se copia una
 *      variante ya generada, sin cola), puede probarla, y confirma.
 *
 * Así todo nivel público se juega con un chart del servidor, y tiene UNA sola
 * dificultad para siempre: las marcas de su ranking se hicieron todas sobre el
 * mismo chart.
 *
 * Sin analizador (`ANALYZER_ENABLED=false`, p. ej. un despliegue sin el servicio
 * Python) se publica al instante con el chart del cliente, como en la Ola 3: el
 * sistema degrada, no se rompe (y sin análisis del servidor no hay dificultades
 * con sentido que ofrecer).
 */
final class PublishService
{
    public static function analyzerEnabled(): bool
    {
        return Env::bool('ANALYZER_ENABLED', false);
    }

    /**
     * Paso 1: sube y analiza. Con analizador, las marcas hechas en la versión
     * privada se borran: el nivel publicado se genera de nuevo en el servidor y
     * esas marcas no son de ese chart.
     *
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
                     chart_variants_json = NULL,
                     chart_status = IF(chart_status IN ('none', 'failed'), 'analyzing', chart_status)
                 WHERE id = :id",
            )->execute(['path' => $relativePath, 'id' => $level->id]);
            if (!$level->isPublic) {
                Progress::invalidateForLevel($level->id);
            }
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
     * Paso 2a: el autor elige la dificultad de un nivel listo para publicar.
     *
     * Se copia como chart del nivel la variante que el servidor ya generó para
     * esa dificultad: es instantáneo y sigue siendo un chart del servidor. Si el
     * autor había probado el nivel con otra, su marca de prueba se borra.
     *
     * @param ?int $requested  1..5, o null para "Automática".
     * @throws \DomainException 'difficulty_fixed' | 'analyzing' | 'not_ready' | 'unavailable'
     */
    public static function changeDifficulty(Level $level, ?int $requested): Level
    {
        return self::transaction(static function () use ($level, $requested): Level {
            $pdo = Database::getInstance();
            $pdo->prepare('SELECT id FROM levels WHERE id = :id FOR UPDATE')->execute(['id' => $level->id]);
            $fresh = Level::findById($level->id) ?? throw new \DomainException('not_ready');
            // Todas las comprobaciones ANTES de escribir: si esta llamada va
            // dentro de una transacción ajena, un fallo no puede dejar nada a medias.
            if ($fresh->isPublic) {
                throw new \DomainException('difficulty_fixed');
            }
            if ($fresh->pendingPublic) {
                throw new \DomainException('analyzing');
            }
            $variants = $fresh->publishReady() ? $fresh->chartVariants() : null;
            if ($variants === null) {
                throw new \DomainException('not_ready');
            }
            $variant = $variants[$requested === null ? 'auto' : (string) $requested] ?? null;
            if ($variant === null) {
                throw new \DomainException('unavailable');
            }
            // Generado por el worker, pero pasa por el mismo validador que un
            // chart del cliente antes de ser el chart del nivel.
            $chart = ChartValidator::validateChart($variant, $fresh->audioSha256);
            $difficulty = $variant['difficulty']['level'] ?? null;
            if (!is_int($difficulty) || $difficulty < 1 || $difficulty > 5) {
                throw new \DomainException('unavailable');
            }

            $changed = $fresh->chartHash !== hash('sha256', $chart['json']);
            $fresh->applyVariant($chart, $difficulty, $requested);
            if ($changed) {
                Progress::invalidateForLevel($fresh->id);
            }
            return $fresh;
        });
    }

    /**
     * Paso 2b: publica un nivel listo con la dificultad elegida.
     *
     * @throws \DomainException 'not_ready'
     */
    public static function confirmPublish(Level $level): Level
    {
        return self::transaction(static function () use ($level): Level {
            Database::getInstance()->prepare('SELECT id FROM levels WHERE id = :id FOR UPDATE')->execute(['id' => $level->id]);
            $fresh = Level::findById($level->id) ?? throw new \DomainException('not_ready');
            if ($fresh->isPublic) {
                return $fresh;
            }
            if (!$fresh->publishReady()) {
                throw new \DomainException('not_ready');
            }
            $fresh->confirmPublic();
            return $fresh;
        });
    }

    /**
     * Retira un nivel del catálogo (o cancela su publicación): cancela su
     * análisis, lo deja privado y borra su audio del servidor (Local-First: el
     * audio de un nivel privado vive en el equipo de su autor).
     */
    public static function unpublish(Level $level): void
    {
        $path = $level->filePath;
        self::transaction(static function () use ($level): void {
            AnalysisJob::cancelActiveForLevel($level->id, 'unpublished');
            Database::getInstance()->prepare(
                "UPDATE levels
                 SET is_public = FALSE, pending_public = FALSE, file_path = NULL, chart_variants_json = NULL,
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
