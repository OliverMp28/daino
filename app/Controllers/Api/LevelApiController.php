<?php
declare(strict_types=1);

namespace App\Controllers\Api;

use App\Core\AuthContext;
use App\Core\Env;
use App\Core\Request;
use App\Core\Response;
use App\Core\ValidationException;
use App\Core\Validator;
use App\Models\AnalysisJob;
use App\Models\Level;
use App\Models\Progress;
use App\Models\User;
use App\Services\ChartValidator;
use App\Services\FileUploadService;
use App\Services\LevelPresenter;
use App\Services\PublishService;
use App\Services\SceneCatalog;
use PDOException;

/**
 * LevelApiController — niveles (metadata, chart, upload de MP3, streaming).
 *
 * Diseño:
 *   - POST /api/levels                   (auth)    upsert por (usuario, audio_sha256)
 *   - GET  /api/levels                   (público) ?scope=official|community|public|mine (mine: auth)
 *   - GET  /api/levels/{id}              (mixto)   público si is_public; 404 a no-autores si privado
 *   - GET  /api/levels/{id}/chart        (mixto)   chart del nivel, con ETag
 *   - GET  /api/levels/{id}/ranking      (mixto)   mejores marcas del nivel + la de quien mira
 *   - POST /api/levels/{id}/upload       (auth)    multipart `file` MP3 → 200 publicado | 202 analizándose (Ola 4)
 *   - GET  /api/levels/{id}/file         (mixto)   stream MP3 si is_public, o a su autor; con ETag
 *   - POST /api/levels/{id}/visibility   (auth)    {is_public: bool}; true en un nivel listo lo publica ya
 *   - GET  /api/levels/{id}/analysis     (auth)    estado del análisis del servidor (solo el autor)
 *   - POST /api/levels/{id}/analysis     (auth)    reintentar el análisis tras un fallo (solo el autor)
 *   - POST /api/levels/{id}/difficulty   (auth)    dificultad de un nivel listo para publicar (solo el autor)
 *   - POST /api/levels/{id}/scene        (auth)    escenario del nivel, en cualquier estado (solo el autor, T02)
 *
 * Autoría: cualquier mutación valida `$level->userId === AuthContext::user()->id`,
 * 403 si no.
 *
 * Ola 3 — identidad del audio. Un nivel se identifica por el hash de los bytes
 * de su MP3, no por su título:
 *   - Rejugar una canción ya no crea una fila nueva (defecto D1): el POST
 *     devuelve el nivel existente.
 *   - Un chart se genera para un audio concreto; al publicar se comprueba que
 *     el MP3 subido es exactamente ese, o el nivel quedaría desincronizado para
 *     todos los que lo jueguen.
 */
final class LevelApiController
{
    /** Debe coincidir con `levels.title VARCHAR(120)`. */
    private const TITLE_MAX_LEN = 120;

    /** Debe coincidir con `levels.artist VARCHAR(120)`. */
    private const ARTIST_MAX_LEN = 120;

    private const SHA256_PATTERN = '/^[0-9a-f]{64}$/';

    /** Pestaña privada del catálogo; las públicas son `Level::SCOPE_*`. */
    private const SCOPE_MINE = 'mine';

    /** Código SQLSTATE de violación de restricción de unicidad. */
    private const SQLSTATE_UNIQUE_VIOLATION = '23000';

    /**
     * Crea el nivel de un audio para el usuario, o devuelve el que ya tenía.
     *
     * 201 si lo crea, 200 si ya existía. El chart de un nivel existente solo se
     * sustituye si llega uno de una versión MÁS NUEVA del charter y el nivel NO
     * es público: el chart de un nivel publicado queda congelado, porque otros
     * jugadores tienen marcas registradas sobre él.
     */
    public function store(Request $req): Response
    {
        $user = AuthContext::user();

        // `max` de title/artist coincide con el ancho real de la columna
        // (VARCHAR(120)): un valor más largo es un 422, no un 500 de MariaDB
        // (defecto D3).
        $title      = Validator::string($req->input('title'), ['min' => 1, 'max' => self::TITLE_MAX_LEN, 'field' => 'title']);
        $artist     = Validator::string($req->input('artist'), ['min' => 0, 'max' => self::ARTIST_MAX_LEN, 'required' => false, 'field' => 'artist']);
        $sha        = Validator::string($req->input('audio_sha256'), ['pattern' => self::SHA256_PATTERN, 'field' => 'audio_sha256']);
        $difficulty = Validator::int($req->input('difficulty'), ['min' => 1, 'max' => 5, 'field' => 'difficulty']);
        $seed       = Validator::string($req->input('generator_seed'), ['min' => 1, 'max' => 64, 'pattern' => '/^-?\d+$/', 'field' => 'generator_seed']);

        $chart = $req->input('chart');
        if ($chart === null) {
            throw new ValidationException(['chart' => 'Required.']);
        }
        // El chart manda: duración, tempo y velocidad salen de él una vez
        // validado, en vez de aceptar del cliente copias que podrían no cuadrar.
        $validChart = ChartValidator::validateChart($chart, $sha);
        $analysisJson = $req->input('analysis') === null
            ? null
            : ChartValidator::validateAnalysis($req->input('analysis'));

        $existing = Level::findByUserAndAudioHash($user->id, $sha);
        if ($existing !== null) {
            return Response::json(self::serialize(self::maybeUpgradeChart($existing, $validChart, $analysisJson)), 200);
        }

        $durationSec = $validChart['durationSec'];
        try {
            $level = Level::create([
                'user_id'        => $user->id,
                'title'          => $title,
                'artist'         => $artist === '' ? null : $artist,
                'duration_sec'   => max(1, (int) round($durationSec)),
                'duration_ms'    => (int) round($durationSec * 1000),
                'bpm'            => max(30, min(300, (int) round($validChart['bpm']))),
                'bpm_exact'      => round($validChart['bpm'], 2),
                'game_speed'     => (int) round($validChart['speedPxS']),
                'difficulty'     => $difficulty,
                'generator_seed' => $seed,
                'audio_sha256'   => $sha,
                'chart_json'     => $validChart['json'],
                'analysis_json'  => $analysisJson,
                'chart_version'  => $validChart['charterVersion'],
                'is_public'      => false,
                'file_path'      => null,
            ]);
        } catch (PDOException $e) {
            // Dos peticiones simultáneas para el mismo audio (doble clic, dos
            // pestañas): la segunda choca con la clave única. No es un error
            // del cliente — devolvemos el nivel que ganó la carrera.
            if ((string) $e->getCode() !== self::SQLSTATE_UNIQUE_VIOLATION) {
                throw $e;
            }
            $winner = Level::findByUserAndAudioHash($user->id, $sha);
            if ($winner === null) {
                throw $e;
            }
            // Misma regla que si la búsqueda previa lo hubiera encontrado.
            return Response::json(self::serialize(self::maybeUpgradeChart($winner, $validChart, $analysisJson)), 200);
        }

        return Response::json(self::serialize($level), 201);
    }

    /**
     * @param array<string, string> $params
     */
    public function show(Request $req, array $params): Response
    {
        $level = self::visibleLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        return Response::json(self::serialize($level));
    }

    /**
     * Chart de un nivel, servido tal cual está guardado.
     *
     * Con ETag: el chart de una versión dada es inmutable, así que una
     * revalidación responde 304 sin cuerpo. El cliente además lo cachea en
     * IndexedDB, por lo que en la práctica esta petición se hace una vez.
     *
     * @param array<string, string> $params
     */
    public function chart(Request $req, array $params): Response
    {
        $level = self::visibleLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        $chart = Level::findChart($level->id);
        if ($chart === null) {
            return Response::json(['error' => 'no_chart', 'message' => 'Este nivel todavía no tiene chart.'], 404);
        }

        $etag = '"c' . $chart['version'] . '-' . substr(hash('sha256', $chart['json']), 0, 20) . '"';
        if (self::etagMatches($req, $etag)) {
            return (new Response('', 304))->header('ETag', $etag)->header('Cache-Control', 'private, no-cache');
        }
        return Response::rawJson($chart['json'])
            ->header('ETag', $etag)
            ->header('Cache-Control', 'private, no-cache');
    }

    /**
     * Listado del catálogo por pestaña.
     *
     *   ?scope=official   niveles del juego, de menos a más difíciles
     *   ?scope=community  publicados por jugadores, lo más reciente primero
     *   ?scope=mine       los del usuario, públicos y privados (requiere sesión)
     *   ?scope=public     todos los públicos (por defecto; también `?public=1`)
     *
     * `?mine=1` se mantiene como alias de `scope=mine` para clientes anteriores
     * a la Ola 2.
     */
    public function index(Request $req): Response
    {
        $mine   = filter_var($req->query('mine', '0'), FILTER_VALIDATE_BOOLEAN);
        $scope  = $mine ? self::SCOPE_MINE : (string) $req->query('scope', Level::SCOPE_PUBLIC);
        $limit  = Validator::int($req->query('limit', 20), ['min' => 1, 'max' => 50, 'required' => false, 'field' => 'limit']);
        $offset = Validator::int($req->query('offset', 0), ['min' => 0, 'max' => 100_000, 'required' => false, 'field' => 'offset']);
        $viewer = AuthContext::tryUser();

        if ($scope === self::SCOPE_MINE) {
            if ($viewer === null) {
                return Response::json(['error' => 'unauthorized', 'message' => 'scope=mine requires Bearer token.'], 401);
            }
            $items = Level::findByUser($viewer->id, $limit, $offset);
            $total = Level::countByUser($viewer->id);
        } elseif (Level::isScope($scope)) {
            $items = Level::findByScope($scope, $limit, $offset);
            $total = Level::countByScope($scope);
        } else {
            throw new ValidationException(['scope' => 'Debe ser official, community, public o mine.']);
        }

        return Response::json([
            'scope'  => $scope,
            'items'  => LevelPresenter::many($items, $viewer),
            'total'  => $total,
            'limit'  => $limit,
            'offset' => $offset,
        ]);
    }

    /**
     * Ranking de un nivel concreto: mejores marcas y, con sesión, la posición
     * de quien mira aunque no esté en el top.
     *
     * @param array<string, string> $params
     */
    public function ranking(Request $req, array $params): Response
    {
        $level = self::visibleLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        $limit = Validator::int($req->query('limit', 10), ['min' => 1, 'max' => 50, 'required' => false, 'field' => 'limit']);

        $top = Progress::topForLevel($level->id, $limit);
        $profiles = User::publicProfilesByIds(array_map(static fn (Progress $p): int => $p->userId, $top));

        $items = [];
        foreach ($top as $i => $p) {
            $items[] = [
                'rank'        => $i + 1,
                'user'        => $profiles[$p->userId] ?? null,
                'points'      => $p->points,
                'percentage'  => $p->percentage,
                'best_run_at' => $p->bestRunAt,
            ];
        }

        $me = null;
        $viewer = AuthContext::tryUser();
        if ($viewer !== null) {
            $mine = Progress::findByUserAndLevel($viewer->id, $level->id);
            if ($mine !== null) {
                $me = ['rank' => $mine->rankOnLevel(), 'points' => $mine->points, 'percentage' => $mine->percentage];
            }
        }

        return Response::json([
            'level_id' => $level->id,
            'items'    => $items,
            'players'  => Progress::countForLevel($level->id),
            'me'       => $me,
        ]);
    }

    /**
     * @param array<string, string> $params
     */
    public function upload(Request $req, array $params): Response
    {
        $user = AuthContext::user();
        $level = Level::findById(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        if ($level->userId !== $user->id) {
            return Response::json(['error' => 'forbidden'], 403);
        }

        $file = $_FILES['file'] ?? null;
        if (!is_array($file)) {
            throw new ValidationException(['file' => 'Field `file` ausente o no es un upload multipart.']);
        }

        $maxBytes = Env::int('UPLOAD_MAX_SIZE_MB', 10) * 1024 * 1024;
        FileUploadService::validateAudioMp3($file, $maxBytes);

        // El chart de este nivel se generó para un audio concreto. Si se
        // publica con otro MP3 (una versión distinta, otro corte, otro archivo
        // con el mismo nombre), cada obstáculo caería fuera de su golpe para
        // todos los jugadores. Se rechaza antes de mover nada.
        $uploadedSha = FileUploadService::sha256OfUpload($file);
        if ($level->audioSha256 !== null && !hash_equals($level->audioSha256, $uploadedSha)) {
            throw new ValidationException([
                'file' => 'Este MP3 no es el mismo con el que se creó el nivel. Sube exactamente ese archivo.',
            ]);
        }

        // Anti-spam de título: chequear duplicado ANTES de mover el archivo.
        if (Level::publicTitleExistsForUser($user->id, $level->title, $level->id)) {
            return Response::json(
                ['error' => 'duplicate_title', 'message' => 'Ya tienes un nivel público con ese título.'],
                409,
            );
        }

        $relative = FileUploadService::storeLevelMp3($level->id, $file);
        $level->setAudioHashIfMissing($uploadedSha);

        // Ola 4: con analizador, el nivel queda pendiente hasta que el servidor
        // lo analiza (202 + estado del análisis); sin él, se publica ya (200).
        $result = PublishService::requestPublish($level, $relative, $uploadedSha);
        $fresh = Level::findById($level->id) ?? $level;
        return Response::json(self::serialize($fresh), $result['published'] ? 200 : 202);
    }

    /**
     * Estado del análisis de un nivel propio (la UI lo consulta mientras publica).
     *
     * @param array<string, string> $params
     */
    public function analysisStatus(Request $req, array $params): Response
    {
        $level = self::ownLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        $job = AnalysisJob::latestForLevel($level->id);
        return Response::json([
            'level_id'       => $level->id,
            'is_public'      => $level->isPublic,
            'pending_public' => $level->pendingPublic,
            'publish_ready'  => $level->publishReady(),
            'has_chart'      => $level->hasChart(),
            'chart_version'  => $level->chartVersion,
            'chart_hash'     => $level->chartHash,
            'analysis'       => $job?->summary(),
        ]);
    }

    /**
     * Reintenta el análisis de un nivel propio (tras un fallo).
     *
     * @param array<string, string> $params
     */
    public function retryAnalysis(Request $req, array $params): Response
    {
        $level = self::ownLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        if (!PublishService::analyzerEnabled()) {
            return Response::json(['error' => 'analyzer_disabled', 'message' => 'El análisis en servidor no está activo.'], 409);
        }
        try {
            $job = PublishService::retry($level);
        } catch (\DomainException $e) {
            return $e->getMessage() === 'no_audio'
                ? Response::json(['error' => 'no_audio', 'message' => 'Sube primero el MP3 del nivel.'], 409)
                : Response::json(['error' => 'already_active', 'message' => 'Ya se está analizando.'], 409);
        }
        return Response::json(['level_id' => $level->id, 'analysis' => $job->summary()], 202);
    }

    /**
     * Elige la dificultad de un nivel propio LISTO PARA PUBLICAR (doc 10 §2.3,
     * ajustes tras el playtest de la Ola 5).
     *
     * Body `{difficulty: "auto" | 1..5}`, solo hasta el techo que la canción
     * admite. Instantáneo: el servidor ya generó el chart de cada dificultad al
     * analizarla. Un nivel publicado tiene una sola dificultad para siempre.
     *   200  aplicada: el nivel ya se juega con ella
     *   409  difficulty_fixed (publicado) | analyzing | not_ready (sin analizar)
     *   422  valor inválido o por encima del techo
     *
     * @param array<string, string> $params
     */
    public function changeDifficulty(Request $req, array $params): Response
    {
        $level = self::ownLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        $raw = $req->input('difficulty');
        $requested = $raw === 'auto' ? null : Validator::int($raw, ['min' => 1, 'max' => 5, 'field' => 'difficulty']);
        if ($requested !== null && $level->difficultyCeiling !== null && $requested > $level->difficultyCeiling) {
            throw new ValidationException(['difficulty' => "Esta canción admite hasta {$level->difficultyCeiling} de 5."]);
        }
        try {
            $fresh = PublishService::changeDifficulty($level, $requested);
        } catch (\DomainException $e) {
            return match ($e->getMessage()) {
                'difficulty_fixed' => Response::json(['error' => 'difficulty_fixed', 'message' => 'Un nivel publicado tiene una sola dificultad: la que se eligió al publicarlo.'], 409),
                'analyzing'        => Response::json(['error' => 'analyzing', 'message' => 'Se está analizando: podrás elegir la dificultad en cuanto termine.'], 409),
                'unavailable'      => throw new ValidationException(['difficulty' => 'Esta canción no admite esa dificultad.']),
                default            => Response::json(['error' => 'not_ready', 'message' => 'Publica el nivel primero: al analizarlo sabremos qué dificultades admite.'], 409),
            };
        }
        return Response::json(['level' => self::serialize($fresh)]);
    }

    /**
     * Elige el escenario de un nivel propio (T02.1, doc 11).
     *
     * Body `{scene: "<ambiente>" | null}`; null = Automático. Solo ambientes
     * elegibles (`SceneCatalog::SELECTABLE`): las historias de autor son de los
     * oficiales. Vale en cualquier estado, también publicado: el escenario no
     * cambia el chart ni las marcas, solo lo que se ve.
     *   200  aplicado
     *   404  no existe o no es tuyo
     *   422  escenario desconocido o no elegible
     *
     * @param array<string, string> $params
     */
    public function changeScene(Request $req, array $params): Response
    {
        $level = self::ownLevel(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        $raw = $req->input('scene');
        if ($raw !== null && (!is_string($raw) || !SceneCatalog::isSelectable($raw))) {
            throw new ValidationException(['scene' => 'Ese escenario no existe o no se puede elegir.']);
        }
        $level->updateMetadata(['scene' => $raw]);
        return Response::json(['level' => self::serialize($level)]);
    }

    /**
     * @param array<string, string> $params
     */
    public function streamFile(Request $req, array $params): Response
    {
        // Público para cualquiera; privado con audio subido (listo para
        // publicar, o con el análisis fallido) solo para su autor, que lo prueba
        // antes de publicarlo sin tener que volver a elegir su MP3.
        $level = self::visibleLevel(self::parseId($params));
        if ($level === null || $level->filePath === null) {
            return Response::json(['error' => 'not_found'], 404);
        }

        $etag = $level->audioSha256 !== null ? '"a-' . $level->audioSha256 . '"' : null;
        if ($etag !== null && self::etagMatches($req, $etag)) {
            return (new Response('', 304))->header('ETag', $etag)->header('Cache-Control', 'private, no-cache');
        }

        // streamLevelMp3 emite headers + body crudo. Devolvemos noContent para
        // que el front controller no escriba nada más.
        FileUploadService::streamLevelMp3($level->filePath, $etag);
        return Response::noContent();
    }

    /**
     * @param array<string, string> $params
     */
    public function visibility(Request $req, array $params): Response
    {
        $user = AuthContext::user();
        $level = Level::findById(self::parseId($params));
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        if ($level->userId !== $user->id) {
            return Response::json(['error' => 'forbidden'], 403);
        }

        $isPublic = Validator::bool($req->input('is_public'), ['field' => 'is_public']);

        if ($isPublic) {
            // Pasar a público exige tener file_path. Si nunca hubo upload,
            // forzamos al user a llamar a /upload primero (que internamente
            // setea is_public=true).
            if ($level->filePath === null) {
                throw new ValidationException(['is_public' => 'Sube primero el MP3 vía /upload antes de publicar.']);
            }
            if (Level::publicTitleExistsForUser($user->id, $level->title, $level->id)) {
                return Response::json(
                    ['error' => 'duplicate_title', 'message' => 'Ya tienes un nivel público con ese título.'],
                    409,
                );
            }
            // Analizado y con la dificultad elegida por su autor: esta es la
            // confirmación del segundo paso, y publica ya.
            if ($level->publishReady()) {
                try {
                    return Response::json(self::serialize(PublishService::confirmPublish($level)));
                } catch (\DomainException) {
                    return Response::json(['error' => 'not_ready', 'message' => 'El nivel ya no está listo para publicar.'], 409);
                }
            }
            // Con analizador, publicar pasa SIEMPRE por el análisis del servidor:
            // este camino no puede saltárselo.
            if (!$level->isPublic && PublishService::analyzerEnabled()) {
                if (!AnalysisJob::hasActive($level->id)) {
                    PublishService::retry($level);
                }
                return Response::json(self::serialize(Level::findById($level->id) ?? $level), 202);
            }
            $level->setPublic(true);
        } else {
            // Pasar a privado: cancela un análisis en curso, borra el archivo
            // físico y resetea file_path. Para volver a publicar, se re-sube.
            PublishService::unpublish($level);
            $level = Level::findById($level->id);
        }

        return Response::json(self::serialize($level));
    }

    // --------------------------- Helpers ---------------------------

    /** Nivel del usuario autenticado, o null (→ 404: no se filtra que existe). */
    private static function ownLevel(int $id): ?Level
    {
        $user = AuthContext::tryUser();
        $level = Level::findById($id);
        return $level !== null && $user !== null && $level->userId === $user->id ? $level : null;
    }

    /**
     * Nivel si quien pregunta puede verlo: público, o privado y es su autor.
     * Un privado ajeno devuelve null (→ 404, no 403) para no filtrar que existe.
     */
    private static function visibleLevel(int $id): ?Level
    {
        $level = Level::findById($id);
        if ($level === null) {
            return null;
        }
        if (!$level->isPublic) {
            $user = AuthContext::tryUser();
            if ($user === null || $user->id !== $level->userId) {
                return null;
            }
        }
        return $level;
    }

    /**
     * @param array{json: string, charterVersion: int} $validChart
     */
    private static function maybeUpgradeChart(Level $level, array $validChart, ?string $analysisJson): Level
    {
        $isNewer = $level->chartVersion === null || $validChart['charterVersion'] > $level->chartVersion;
        if ($isNewer && !$level->isPublic) {
            $level->updateChart($validChart['json'], $analysisJson, $validChart['charterVersion']);
        }
        return $level;
    }

    private static function etagMatches(Request $req, string $etag): bool
    {
        $header = $req->header('if-none-match');
        if ($header === null) {
            return false;
        }
        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '*' || $candidate === $etag || $candidate === 'W/' . $etag) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param array<string, string> $params
     */
    private static function parseId(array $params): int
    {
        return Validator::int($params['id'] ?? null, ['min' => 1, 'field' => 'id']);
    }

    /**
     * Forma pública de un nivel, vista por quien hace la petición.
     *
     * @return array<string, mixed>
     */
    private static function serialize(Level $level): array
    {
        return LevelPresenter::one($level, AuthContext::tryUser());
    }
}
