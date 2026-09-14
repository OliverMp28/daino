<?php
declare(strict_types=1);

namespace App\Services;

use App\Models\AnalysisJob;
use App\Models\Level;
use App\Models\Progress;
use App\Models\User;

/**
 * Forma pública de un nivel para la API (Ola 2).
 *
 * Una tarjeta del catálogo necesita más que la fila de `levels`: quién lo
 * creó, cuántos jugadores tiene y la mejor marca de quien mira. Resolverlo por
 * nivel serían 3 consultas por tarjeta (N+1). `many()` lo resuelve para una
 * página entera con 3 consultas en total, sea de 1 o de 50 niveles.
 *
 * NUNCA incluye el chart ni el análisis (varios KB cada uno): se piden aparte
 * con /chart cuando alguien va a jugar.
 */
final class LevelPresenter
{
    /**
     * @param list<Level> $levels
     * @return list<array<string, mixed>>
     */
    public static function many(array $levels, ?User $viewer): array
    {
        if ($levels === []) {
            return [];
        }
        $ids = array_map(static fn (Level $l): int => $l->id, $levels);
        $authorIds = array_values(array_filter(array_map(static fn (Level $l): ?int => $l->userId, $levels)));

        $authors = User::publicProfilesByIds($authorIds);
        $players = Progress::playerCounts($ids);
        $bests = $viewer === null ? [] : Progress::bestForUserOnLevels($viewer->id, $ids);

        // El estado del análisis solo interesa (y solo se enseña) a su autor.
        $ownIds = $viewer === null ? [] : array_values(array_map(
            static fn (Level $l): int => $l->id,
            array_filter($levels, static fn (Level $l): bool => $l->userId === $viewer->id),
        ));
        $jobs = AnalysisJob::latestForLevels($ownIds);
        // Ola 5: la dificultad de un nivel propio se puede cambiar mientras nadie
        // más tenga marca en él.
        $others = $viewer === null ? [] : Progress::otherPlayerCounts($ownIds, $viewer->id);

        return array_map(
            static fn (Level $l): array => self::shape($l, $viewer, $authors, $players, $bests, $jobs, $others),
            $levels,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function one(Level $level, ?User $viewer): array
    {
        return self::many([$level], $viewer)[0];
    }

    /**
     * @param array<int, array{vout_id: string, username: string, avatar_url: ?string}> $authors
     * @param array<int, int> $players
     * @param array<int, array{points: int, percentage: int}> $bests
     * @param array<int, AnalysisJob> $jobs
     * @param array<int, int> $others
     * @return array<string, mixed>
     */
    private static function shape(Level $level, ?User $viewer, array $authors, array $players, array $bests, array $jobs, array $others): array
    {
        $isMine = $viewer !== null && $level->userId === $viewer->id;
        // Ola 5: elegir dificultad es cosa del autor, y solo entre las que la
        // canción admite (1..techo, conocido tras el análisis del servidor).
        $choice = !$isMine ? null : [
            'requested' => $level->difficultyRequested ?? 'auto',
            'options'   => $level->difficultyCeiling === null ? [] : range(1, $level->difficultyCeiling),
            'locked'    => ($others[$level->id] ?? 0) > 0,
        ];
        return [
            'id'             => $level->id,
            'user_id'        => $level->userId,
            'title'          => $level->title,
            'artist'         => $level->artist,
            'duration_sec'   => $level->durationSec,
            'duration_ms'    => $level->durationMs,
            'bpm'            => $level->bpm,
            'bpm_exact'      => $level->bpmExact,
            'game_speed'     => $level->gameSpeed,
            'difficulty'     => $level->difficulty,
            'generator_seed' => $level->generatorSeed,
            'is_public'      => $level->isPublic,
            'is_official'    => $level->isOfficial,
            // `file_path` NO se expone (defecto D5): es una ruta interna del
            // servidor. La UI solo necesita saber si hay audio subido.
            'has_audio'      => $level->filePath !== null,
            'audio_sha256'   => $level->audioSha256,
            'has_chart'      => $level->hasChart(),
            'chart_version'  => $level->chartVersion,
            // Ola 4: identifica el chart guardado. La caché del cliente lo usa en
            // la clave: un chart sustituido por otro de la misma versión del
            // charter (otro analizador) no puede servirse viejo.
            'chart_hash'     => $level->chartHash,
            'difficulty_ceiling' => $level->difficultyCeiling,
            'pending_public' => $level->pendingPublic,
            'created_at'     => $level->createdAt,
            'updated_at'     => $level->updatedAt,
            // Ola 2: lo que pinta una tarjeta.
            'author'         => $level->userId === null ? null : ($authors[$level->userId] ?? null),
            'is_mine'        => $isMine,
            'players'        => $players[$level->id] ?? 0,
            'my_best'        => $bests[$level->id] ?? null,
            'analysis'       => $isMine && isset($jobs[$level->id]) ? $jobs[$level->id]->summary() : null,
            'difficulty_choice' => $choice,
        ];
    }
}
