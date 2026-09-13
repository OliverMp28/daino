<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;
use RuntimeException;

/**
 * Level — nivel generado a partir de un MP3.
 *
 * Local-First por defecto: `filePath` es null y `isPublic = false`. Solo cuando
 * el usuario publica (`setPublic(true, $path)`) se sube el MP3. El CHECK del
 * schema garantiza la coherencia.
 *
 * Ola 3: un nivel guarda también su chart y la identidad de su audio
 * (`audioSha256`). El chart y el análisis son textos de varios KB, así que el
 * modelo NO los carga al hidratar: los listados solo traen metadata
 * (`LIST_COLUMNS`) y el chart se lee aparte con `findChart()` cuando alguien va
 * a jugar. Un listado de 20 niveles pasaría de ~2 KB a ~800 KB si trajera los
 * blobs sin necesidad.
 *
 * Ola 2: niveles OFICIALES. Son del juego, no de una persona: `userId` es null,
 * siempre están publicados y se identifican por `officialSlug` (la clave del
 * manifiesto `database/seeds/official/manifest.json`). Los crea y actualiza
 * `OfficialCatalogSeeder`; ningún endpoint los puede mutar (toda mutación
 * compara `userId` con el usuario, y null no coincide con nadie).
 */
final class Level
{
    /** Columnas de metadata. Nunca incluir `chart_json` ni `analysis_json` aquí. */
    private const LIST_COLUMNS = 'id, user_id, title, artist, duration_sec, duration_ms, bpm, bpm_exact, game_speed,
        difficulty, file_path, audio_sha256, generator_seed, is_public, pending_public, chart_status, chart_version,
        chart_hash, difficulty_ceiling, is_official, official_slug, created_at, updated_at';

    /** Pestañas públicas del catálogo. */
    public const SCOPE_OFFICIAL  = 'official';
    public const SCOPE_COMMUNITY = 'community';
    public const SCOPE_PUBLIC    = 'public';

    /**
     * WHERE y ORDER BY de cada pestaña pública. Los oficiales van de menos a
     * más difícil: un jugador nuevo encuentra primero lo más asequible. Los de
     * la comunidad, lo más reciente primero. Las dos primeras usan
     * `idx_levels_catalog (is_official, is_public, created_at)`.
     */
    private const SCOPE_SQL = [
        self::SCOPE_OFFICIAL  => ['is_official = TRUE AND is_public = TRUE', 'difficulty ASC, title ASC, id ASC'],
        self::SCOPE_COMMUNITY => ['is_official = FALSE AND is_public = TRUE', 'created_at DESC, id DESC'],
        self::SCOPE_PUBLIC    => ['is_public = TRUE', 'created_at DESC, id DESC'],
    ];

    public function __construct(
        public readonly int $id,
        public readonly ?int $userId,
        public string $title,
        public ?string $artist,
        public int $durationSec,
        public ?int $durationMs,
        public ?int $bpm,
        public ?float $bpmExact,
        public ?int $gameSpeed,
        public int $difficulty,
        public ?string $filePath,
        public ?string $audioSha256,
        public string $generatorSeed,
        public bool $isPublic,
        public bool $pendingPublic,
        public string $chartStatus,
        public ?int $chartVersion,
        public ?string $chartHash,
        public ?int $difficultyCeiling,
        public bool $isOfficial,
        public readonly ?string $officialSlug,
        public readonly string $createdAt,
        public string $updatedAt,
    ) {
    }

    public function hasChart(): bool
    {
        return $this->chartStatus === 'ready' && $this->chartVersion !== null;
    }

    public static function findById(int $id): ?self
    {
        $stmt = Database::getInstance()->prepare('SELECT ' . self::LIST_COLUMNS . ' FROM levels WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    public static function findOfficialBySlug(string $slug): ?self
    {
        $stmt = Database::getInstance()->prepare('SELECT ' . self::LIST_COLUMNS . ' FROM levels WHERE official_slug = :slug');
        $stmt->execute(['slug' => $slug]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    /**
     * Página de una pestaña pública del catálogo.
     *
     * @param string $scope  Una de las constantes SCOPE_*.
     * @return list<self>
     */
    public static function findByScope(string $scope, int $limit = 50, int $offset = 0): array
    {
        [$where, $order] = self::scopeSql($scope);
        $stmt = Database::getInstance()->prepare(
            'SELECT ' . self::LIST_COLUMNS . " FROM levels WHERE {$where} ORDER BY {$order} LIMIT :lim OFFSET :off",
        );
        $stmt->bindValue(':lim', $limit, \PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset, \PDO::PARAM_INT);
        $stmt->execute();
        return array_map(self::fromRow(...), $stmt->fetchAll());
    }

    /**
     * @param string $scope  Una de las constantes SCOPE_*.
     */
    public static function countByScope(string $scope): int
    {
        [$where] = self::scopeSql($scope);
        $row = Database::getInstance()->query("SELECT COUNT(*) AS c FROM levels WHERE {$where}")->fetch();
        return $row === false ? 0 : (int) $row['c'];
    }

    public static function isScope(string $scope): bool
    {
        return isset(self::SCOPE_SQL[$scope]);
    }

    /**
     * @return array{0: string, 1: string}
     */
    private static function scopeSql(string $scope): array
    {
        // Lista cerrada: el SQL nunca se construye con texto del cliente.
        return self::SCOPE_SQL[$scope] ?? throw new \InvalidArgumentException("Scope de catálogo desconocido: {$scope}");
    }

    /**
     * Nivel de un usuario para un audio concreto. Es la clave de deduplicado:
     * rejugar la misma canción devuelve el mismo nivel en vez de crear otro.
     */
    public static function findByUserAndAudioHash(int $userId, string $audioSha256): ?self
    {
        $stmt = Database::getInstance()->prepare(
            'SELECT ' . self::LIST_COLUMNS . ' FROM levels WHERE user_id = :user_id AND audio_sha256 = :sha',
        );
        $stmt->execute(['user_id' => $userId, 'sha' => $audioSha256]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    /**
     * @return list<self>
     */
    public static function findByUser(int $userId, int $limit = 50, int $offset = 0): array
    {
        $stmt = Database::getInstance()->prepare(
            'SELECT ' . self::LIST_COLUMNS . ' FROM levels WHERE user_id = :user_id
             ORDER BY created_at DESC LIMIT :lim OFFSET :off',
        );
        $stmt->bindValue(':user_id', $userId, \PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, \PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset, \PDO::PARAM_INT);
        $stmt->execute();
        return array_map(self::fromRow(...), $stmt->fetchAll());
    }

    /**
     * @return list<self>
     */
    public static function findPublic(int $limit = 50, int $offset = 0): array
    {
        return self::findByScope(self::SCOPE_PUBLIC, $limit, $offset);
    }

    public static function countByUser(int $userId): int
    {
        $stmt = Database::getInstance()->prepare('SELECT COUNT(*) AS c FROM levels WHERE user_id = :user_id');
        $stmt->execute(['user_id' => $userId]);
        $row = $stmt->fetch();
        return $row === false ? 0 : (int) $row['c'];
    }

    public static function countPublic(): int
    {
        return self::countByScope(self::SCOPE_PUBLIC);
    }

    /**
     * Chart de un nivel, tal como está guardado. null si no tiene.
     *
     * @return array{json: string, version: int}|null
     */
    public static function findChart(int $id): ?array
    {
        $stmt = Database::getInstance()->prepare(
            "SELECT chart_json, chart_version FROM levels WHERE id = :id AND chart_status = 'ready'",
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if ($row === false || $row['chart_json'] === null || $row['chart_version'] === null) {
            return null;
        }
        return ['json' => (string) $row['chart_json'], 'version' => (int) $row['chart_version']];
    }

    /**
     * Existe ya un nivel público (o en camino de serlo) con este (user_id,
     * title)? Anti-spam para cuando un user intenta publicar dos veces el mismo
     * título. Case-insensitive gracias al collation `utf8mb4_unicode_ci`.
     */
    public static function publicTitleExistsForUser(int $userId, string $title, ?int $excludeId = null): bool
    {
        $sql = 'SELECT 1 FROM levels WHERE user_id = :user_id AND title = :title AND (is_public = TRUE OR pending_public = TRUE)';
        $params = ['user_id' => $userId, 'title' => $title];
        if ($excludeId !== null) {
            $sql .= ' AND id <> :exclude';
            $params['exclude'] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        $stmt = Database::getInstance()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn() !== false;
    }

    /**
     * @param array{
     *     user_id: ?int,
     *     title: string,
     *     artist?: ?string,
     *     duration_sec: int,
     *     duration_ms?: ?int,
     *     bpm?: ?int,
     *     bpm_exact?: ?float,
     *     game_speed?: ?int,
     *     difficulty: int,
     *     generator_seed: string,
     *     audio_sha256?: ?string,
     *     chart_json?: ?string,
     *     analysis_json?: ?string,
     *     chart_version?: ?int,
     *     file_path?: ?string,
     *     is_public?: bool,
     *     is_official?: bool,
     *     official_slug?: ?string,
     *     difficulty_ceiling?: ?int
     * } $data
     */
    public static function create(array $data): self
    {
        $chartJson = $data['chart_json'] ?? null;
        $pdo = Database::getInstance();
        $stmt = $pdo->prepare(
            'INSERT INTO levels (user_id, title, artist, duration_sec, duration_ms, bpm, bpm_exact, game_speed,
                                 difficulty, file_path, audio_sha256, generator_seed, is_public,
                                 chart_json, analysis_json, chart_status, chart_version, chart_hash,
                                 difficulty_ceiling, is_official, official_slug)
             VALUES (:user_id, :title, :artist, :duration_sec, :duration_ms, :bpm, :bpm_exact, :game_speed,
                     :difficulty, :file_path, :audio_sha256, :generator_seed, :is_public,
                     :chart_json, :analysis_json, :chart_status, :chart_version, :chart_hash,
                     :difficulty_ceiling, :is_official, :official_slug)',
        );
        $stmt->execute([
            'user_id'        => $data['user_id'],
            'title'          => $data['title'],
            'artist'         => $data['artist'] ?? null,
            'duration_sec'   => $data['duration_sec'],
            'duration_ms'    => $data['duration_ms'] ?? null,
            'bpm'            => $data['bpm'] ?? null,
            'bpm_exact'      => $data['bpm_exact'] ?? null,
            'game_speed'     => $data['game_speed'] ?? null,
            'difficulty'     => $data['difficulty'],
            'file_path'      => $data['file_path'] ?? null,
            'audio_sha256'   => $data['audio_sha256'] ?? null,
            'generator_seed' => $data['generator_seed'],
            'is_public'      => ($data['is_public'] ?? false) ? 1 : 0,
            'chart_json'     => $chartJson,
            'analysis_json'  => $data['analysis_json'] ?? null,
            'chart_status'   => $chartJson !== null ? 'ready' : 'none',
            'chart_version'  => $chartJson !== null ? ($data['chart_version'] ?? null) : null,
            'chart_hash'     => $chartJson !== null ? hash('sha256', $chartJson) : null,
            'difficulty_ceiling' => $data['difficulty_ceiling'] ?? null,
            'is_official'    => ($data['is_official'] ?? false) ? 1 : 0,
            'official_slug'  => $data['official_slug'] ?? null,
        ]);
        $id = (int) $pdo->lastInsertId();
        $created = self::findById($id);
        if ($created === null) {
            throw new RuntimeException("Level::create no pudo recuperar la fila recién creada (id={$id}).");
        }
        return $created;
    }

    /**
     * Guarda (o sustituye) el chart y el análisis del nivel.
     * El análisis es opcional: si no llega, se conserva el que hubiera.
     */
    public function updateChart(string $chartJson, ?string $analysisJson, int $chartVersion): void
    {
        $stmt = Database::getInstance()->prepare(
            "UPDATE levels
             SET chart_json = :chart_json,
                 analysis_json = COALESCE(:analysis_json, analysis_json),
                 chart_status = 'ready',
                 chart_version = :chart_version,
                 chart_hash = :chart_hash
             WHERE id = :id",
        );
        $stmt->execute([
            'chart_json'    => $chartJson,
            'analysis_json' => $analysisJson,
            'chart_version' => $chartVersion,
            'chart_hash'    => hash('sha256', $chartJson),
            'id'            => $this->id,
        ]);
        $this->chartStatus = 'ready';
        $this->chartVersion = $chartVersion;
        $this->chartHash = hash('sha256', $chartJson);
    }

    /**
     * Actualiza la metadata mostrable de un nivel (no toca audio ni chart).
     *
     * @param array{title?: string, artist?: ?string, difficulty?: int, file_path?: ?string} $data
     * @return bool  true si cambió algo.
     */
    public function updateMetadata(array $data): bool
    {
        $map = ['title' => 'title', 'artist' => 'artist', 'difficulty' => 'difficulty', 'file_path' => 'filePath'];
        $sets = [];
        $params = ['id' => $this->id];
        foreach ($map as $column => $property) {
            if (!array_key_exists($column, $data) || $data[$column] === $this->{$property}) {
                continue;
            }
            $sets[] = "{$column} = :{$column}";
            $params[$column] = $data[$column];
        }
        if ($sets === []) {
            return false;
        }
        Database::getInstance()->prepare('UPDATE levels SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);
        foreach ($map as $column => $property) {
            if (array_key_exists($column, $params)) {
                $this->{$property} = $data[$column];
            }
        }
        return true;
    }

    /**
     * Sustituye a la vez el audio de un nivel y el chart que le corresponde.
     * Nunca uno sin el otro: un chart solo vale para el audio con el que se
     * generó. Lo usa el seed de oficiales con `--rechart`.
     *
     * @param array{audio_sha256: string, duration_sec: int, duration_ms: int, bpm: int, bpm_exact: float,
     *              game_speed: int, generator_seed: string, chart_json: string, analysis_json: ?string,
     *              chart_version: int, difficulty_ceiling?: ?int} $data
     */
    public function replaceAudioAndChart(array $data): void
    {
        $data += ['difficulty_ceiling' => null];
        Database::getInstance()->prepare(
            "UPDATE levels
             SET audio_sha256 = :audio_sha256, duration_sec = :duration_sec, duration_ms = :duration_ms,
                 bpm = :bpm, bpm_exact = :bpm_exact, game_speed = :game_speed, generator_seed = :generator_seed,
                 chart_json = :chart_json, analysis_json = :analysis_json, difficulty_ceiling = :difficulty_ceiling,
                 chart_status = 'ready', chart_version = :chart_version, chart_hash = :chart_hash
             WHERE id = :id",
        )->execute($data + ['id' => $this->id, 'chart_hash' => hash('sha256', $data['chart_json'])]);
        $this->chartHash = hash('sha256', $data['chart_json']);
        $this->difficultyCeiling = $data['difficulty_ceiling'];
        $this->audioSha256 = $data['audio_sha256'];
        $this->durationSec = $data['duration_sec'];
        $this->durationMs = $data['duration_ms'];
        $this->bpm = $data['bpm'];
        $this->bpmExact = $data['bpm_exact'];
        $this->gameSpeed = $data['game_speed'];
        $this->generatorSeed = $data['generator_seed'];
        $this->chartStatus = 'ready';
        $this->chartVersion = $data['chart_version'];
    }

    /**
     * Fija el hash del audio de un nivel que aún no lo tenía (niveles anteriores
     * a la Ola 3). No sustituye un hash existente: eso cambiaría el audio de un
     * chart ya generado.
     */
    public function setAudioHashIfMissing(string $audioSha256): void
    {
        if ($this->audioSha256 !== null) {
            return;
        }
        $stmt = Database::getInstance()->prepare(
            'UPDATE levels SET audio_sha256 = :sha WHERE id = :id AND audio_sha256 IS NULL',
        );
        $stmt->execute(['sha' => $audioSha256, 'id' => $this->id]);
        $this->audioSha256 = $audioSha256;
    }

    /**
     * Cambio de visibilidad. Si se publica, exige path; el CHECK del schema lo
     * fuerza también a nivel BD para defensa en profundidad.
     */
    public function setPublic(bool $public, ?string $filePath = null): void
    {
        if ($public && $filePath === null && $this->filePath === null) {
            throw new RuntimeException('No se puede publicar un nivel sin file_path.');
        }
        $stmt = Database::getInstance()->prepare(
            'UPDATE levels SET is_public = :is_public, file_path = COALESCE(:file_path, file_path) WHERE id = :id',
        );
        $stmt->execute([
            'is_public' => $public ? 1 : 0,
            'file_path' => $filePath,
            'id'        => $this->id,
        ]);
        $this->isPublic = $public;
        if ($filePath !== null) {
            $this->filePath = $filePath;
        }
    }

    public function delete(): void
    {
        $stmt = Database::getInstance()->prepare('DELETE FROM levels WHERE id = :id');
        $stmt->execute(['id' => $this->id]);
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function fromRow(array $row): self
    {
        return new self(
            id:                (int) $row['id'],
            userId:            $row['user_id'] === null ? null : (int) $row['user_id'],
            title:             (string) $row['title'],
            artist:            $row['artist'] === null ? null : (string) $row['artist'],
            durationSec:       (int) $row['duration_sec'],
            durationMs:        $row['duration_ms'] === null ? null : (int) $row['duration_ms'],
            bpm:               $row['bpm'] === null ? null : (int) $row['bpm'],
            bpmExact:          $row['bpm_exact'] === null ? null : (float) $row['bpm_exact'],
            gameSpeed:         $row['game_speed'] === null ? null : (int) $row['game_speed'],
            difficulty:        (int) $row['difficulty'],
            filePath:          $row['file_path'] === null ? null : (string) $row['file_path'],
            audioSha256:       $row['audio_sha256'] === null ? null : (string) $row['audio_sha256'],
            generatorSeed:     (string) $row['generator_seed'],
            isPublic:          (bool) $row['is_public'],
            pendingPublic:     (bool) $row['pending_public'],
            chartStatus:       (string) $row['chart_status'],
            chartVersion:      $row['chart_version'] === null ? null : (int) $row['chart_version'],
            chartHash:         $row['chart_hash'] === null ? null : (string) $row['chart_hash'],
            difficultyCeiling: $row['difficulty_ceiling'] === null ? null : (int) $row['difficulty_ceiling'],
            isOfficial:        (bool) $row['is_official'],
            officialSlug:      $row['official_slug'] === null ? null : (string) $row['official_slug'],
            createdAt:         (string) $row['created_at'],
            updatedAt:         (string) $row['updated_at'],
        );
    }
}
