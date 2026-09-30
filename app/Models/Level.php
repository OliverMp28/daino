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
    /**
     * Columnas de metadata. Nunca incluir `chart_json`, `chart_variants_json` ni
     * `analysis_json` aquí: de las variantes solo interesa si existen.
     */
    private const LIST_COLUMNS = 'id, user_id, title, artist, duration_sec, duration_ms, bpm, bpm_exact, game_speed,
        difficulty, difficulty_requested, scene, file_path, audio_sha256, generator_seed, is_public, pending_public, chart_status, chart_version,
        chart_hash, difficulty_ceiling, (chart_variants_json IS NOT NULL) AS has_variants, is_official, official_slug, created_at, updated_at';

    /** Pestañas públicas del catálogo. */
    public const SCOPE_OFFICIAL  = 'official';
    public const SCOPE_COMMUNITY = 'community';
    public const SCOPE_PUBLIC    = 'public';

    /**
     * WHERE y ORDER BY de cada pestaña pública. Los oficiales van de menos a
     * más difícil: un jugador nuevo encuentra primero lo más asequible. Los de
     * la comunidad, lo más reciente primero. Las dos primeras usan
     * `idx_levels_catalog (is_official, is_public, created_at)`.
     *
     * `public` es la vista única del catálogo (tras el playtest de la Ola 5):
     * oficiales y comunidad juntos, primero los oficiales en su orden y después
     * lo más reciente de la comunidad. Separarlos en pestañas obligaba a ir y
     * venir para, al final, jugar lo que hubiera.
     */
    private const SCOPE_SQL = [
        self::SCOPE_OFFICIAL  => ['is_official = TRUE AND is_public = TRUE', 'difficulty ASC, title ASC, id ASC'],
        self::SCOPE_COMMUNITY => ['is_official = FALSE AND is_public = TRUE', 'created_at DESC, id DESC'],
        self::SCOPE_PUBLIC    => [
            'is_public = TRUE',
            'is_official DESC, IF(is_official, difficulty, 0) ASC, IF(is_official, title, \'\') ASC, created_at DESC, id DESC',
        ],
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
        /** Ola 5: la dificultad que pidió el autor (null = Automática). `difficulty` es la efectiva. */
        public ?int $difficultyRequested,
        /** T02: escenario del nivel (id del registro de escenas del juego; null = Automático). */
        public ?string $scene,
        public ?string $filePath,
        public ?string $audioSha256,
        public string $generatorSeed,
        public bool $isPublic,
        public bool $pendingPublic,
        public string $chartStatus,
        public ?int $chartVersion,
        public ?string $chartHash,
        public ?int $difficultyCeiling,
        /** Tiene los charts de cada dificultad que admite, a la espera de que su autor elija una. */
        public bool $hasVariants,
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

    /**
     * Analizado por el servidor y pendiente de que su autor elija la dificultad
     * y confirme la publicación.
     */
    public function publishReady(): bool
    {
        return $this->hasVariants && !$this->isPublic && !$this->pendingPublic;
    }

    /**
     * Charts de cada dificultad preparados por el servidor, decodificados
     * (`auto`, `1`, …, techo). null si el nivel no tiene.
     *
     * @return array<string, mixed>|null
     */
    public function chartVariants(): ?array
    {
        $stmt = Database::getInstance()->prepare('SELECT chart_variants_json FROM levels WHERE id = :id');
        $stmt->execute(['id' => $this->id]);
        $json = $stmt->fetchColumn();
        if (!is_string($json)) {
            return null;
        }
        $decoded = json_decode($json, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * Fija como chart del nivel una de sus variantes (ya validada y re-codificada)
     * y la dificultad que el autor pidió. No toca las variantes: puede volver a
     * cambiar hasta que confirme la publicación.
     *
     * @param array{json: string, charterVersion: int, speedPxS: float} $chart
     */
    public function applyVariant(array $chart, int $difficulty, ?int $requested): void
    {
        $hash = hash('sha256', $chart['json']);
        Database::getInstance()->prepare(
            "UPDATE levels
             SET chart_json = :chart_json, chart_hash = :chart_hash, chart_version = :chart_version,
                 chart_status = 'ready', difficulty = :difficulty, difficulty_requested = :requested,
                 game_speed = :game_speed
             WHERE id = :id",
        )->execute([
            'chart_json'    => $chart['json'],
            'chart_hash'    => $hash,
            'chart_version' => $chart['charterVersion'],
            'difficulty'    => $difficulty,
            'requested'     => $requested,
            'game_speed'    => (int) round($chart['speedPxS']),
            'id'            => $this->id,
        ]);
        $this->chartHash = $hash;
        $this->chartVersion = $chart['charterVersion'];
        $this->chartStatus = 'ready';
        $this->difficulty = $difficulty;
        $this->difficultyRequested = $requested;
        $this->gameSpeed = (int) round($chart['speedPxS']);
    }

    /**
     * Confirma la publicación de un nivel listo: público con el chart elegido y
     * sin variantes (un nivel publicado tiene una sola dificultad; la BD lo exige).
     */
    public function confirmPublic(): void
    {
        Database::getInstance()->prepare(
            'UPDATE levels SET is_public = TRUE, pending_public = FALSE, chart_variants_json = NULL WHERE id = :id AND file_path IS NOT NULL',
        )->execute(['id' => $this->id]);
        $this->isPublic = true;
        $this->pendingPublic = false;
        $this->hasVariants = false;
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
     *     difficulty_ceiling?: ?int,
     *     scene?: ?string
     * } $data
     */
    public static function create(array $data): self
    {
        $chartJson = $data['chart_json'] ?? null;
        $pdo = Database::getInstance();
        $stmt = $pdo->prepare(
            'INSERT INTO levels (user_id, title, artist, duration_sec, duration_ms, bpm, bpm_exact, game_speed,
                                 difficulty, scene, file_path, audio_sha256, generator_seed, is_public,
                                 chart_json, analysis_json, chart_status, chart_version, chart_hash,
                                 difficulty_ceiling, is_official, official_slug)
             VALUES (:user_id, :title, :artist, :duration_sec, :duration_ms, :bpm, :bpm_exact, :game_speed,
                     :difficulty, :scene, :file_path, :audio_sha256, :generator_seed, :is_public,
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
            'scene'          => $data['scene'] ?? null,
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
     * Sustituye solo el análisis (hechos musicales), nunca el chart: un análisis
     * más rico del mismo audio no cambia el nivel que se juega ni sus marcas.
     *
     * @return bool true si cambió.
     */
    public function updateAnalysis(string $analysisJson): bool
    {
        $stmt = Database::getInstance()->prepare(
            'UPDATE levels SET analysis_json = :analysis_json WHERE id = :id AND NOT (analysis_json <=> :same)',
        );
        $stmt->execute(['analysis_json' => $analysisJson, 'same' => $analysisJson, 'id' => $this->id]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Actualiza la metadata mostrable de un nivel (no toca audio ni chart). El
     * escenario (T02) es metadata: cambiarlo no cambia el nivel que se juega.
     *
     * @param array{title?: string, artist?: ?string, difficulty?: int, file_path?: ?string, scene?: ?string} $data
     * @return bool  true si cambió algo.
     */
    public function updateMetadata(array $data): bool
    {
        $map = ['title' => 'title', 'artist' => 'artist', 'difficulty' => 'difficulty', 'file_path' => 'filePath', 'scene' => 'scene'];
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
            difficultyRequested: $row['difficulty_requested'] === null ? null : (int) $row['difficulty_requested'],
            scene:             $row['scene'] === null ? null : (string) $row['scene'],
            filePath:          $row['file_path'] === null ? null : (string) $row['file_path'],
            audioSha256:       $row['audio_sha256'] === null ? null : (string) $row['audio_sha256'],
            generatorSeed:     (string) $row['generator_seed'],
            isPublic:          (bool) $row['is_public'],
            pendingPublic:     (bool) $row['pending_public'],
            chartStatus:       (string) $row['chart_status'],
            chartVersion:      $row['chart_version'] === null ? null : (int) $row['chart_version'],
            chartHash:         $row['chart_hash'] === null ? null : (string) $row['chart_hash'],
            difficultyCeiling: $row['difficulty_ceiling'] === null ? null : (int) $row['difficulty_ceiling'],
            hasVariants:       (bool) ($row['has_variants'] ?? false),
            isOfficial:        (bool) $row['is_official'],
            officialSlug:      $row['official_slug'] === null ? null : (string) $row['official_slug'],
            createdAt:         (string) $row['created_at'],
            updatedAt:         (string) $row['updated_at'],
        );
    }
}
