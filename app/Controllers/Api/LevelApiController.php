<?php
declare(strict_types=1);

namespace App\Controllers\Api;

use App\Core\AuthContext;
use App\Core\Env;
use App\Core\Request;
use App\Core\Response;
use App\Core\ValidationException;
use App\Core\Validator;
use App\Models\Level;
use App\Services\FileUploadService;

/**
 * LevelApiController — niveles (metadata + upload de MP3 + streaming).
 *
 * Diseño:
 *   - POST /api/levels                        (auth)   metadata-only
 *   - GET  /api/levels                        (público) ?public=1 | ?mine=1 (auth)
 *   - GET  /api/levels/{id}                   (mixto)  público si is_public,
 *                                                      404 a no-autores si privado
 *   - POST /api/levels/{id}/upload            (auth)   multipart `file` MP3
 *   - GET  /api/levels/{id}/file              (mixto)  stream MP3 si is_public
 *   - POST /api/levels/{id}/visibility        (auth)   {is_public: bool}
 *
 * Autoría: cualquier mutación valida `$level->userId === AuthContext::user()->id`,
 * 403 si no.
 *
 * Anti-spam de título: al pasar a público, chequea (user_id, title) duplicado.
 *
 * Storage: `storage/uploads/levels/` (out of docroot, vía FileUploadService).
 */
final class LevelApiController
{
    /** Debe coincidir con `levels.title VARCHAR(120)`. */
    private const TITLE_MAX_LEN = 120;

    /** Debe coincidir con `levels.artist VARCHAR(120)`. */
    private const ARTIST_MAX_LEN = 120;

    public function store(Request $req): Response
    {
        $user = AuthContext::user();

        // `max` debe coincidir con el ancho real de la columna (VARCHAR(120),
        // ver 002_create_levels_table.sql). Estaba a 200: un título más largo
        // pasaba la validación y reventaba en MariaDB con el error 1406, que el
        // handler global traduce a un 500 opaco en vez del 422 que corresponde
        // a una entrada inválida del cliente. Defecto D3.
        $title       = Validator::string($req->input('title'),       ['min' => 1, 'max' => self::TITLE_MAX_LEN, 'field' => 'title']);
        $artist      = Validator::string($req->input('artist'),      ['min' => 0, 'max' => self::ARTIST_MAX_LEN, 'required' => false, 'field' => 'artist']);
        $durationSec = Validator::int   ($req->input('duration_sec'), ['min' => 1, 'max' => 7200, 'field' => 'duration_sec']);
        $bpm         = Validator::int   ($req->input('bpm'),         ['min' => 30, 'max' => 300, 'required' => false, 'field' => 'bpm']);
        $difficulty  = Validator::int   ($req->input('difficulty'),  ['min' => 1, 'max' => 5, 'field' => 'difficulty']);
        $seed        = Validator::string($req->input('generator_seed'), ['min' => 1, 'max' => 64, 'field' => 'generator_seed']);

        $level = Level::create([
            'user_id'        => $user->id,
            'title'          => $title,
            'artist'         => $artist === '' ? null : $artist,
            'duration_sec'   => $durationSec,
            'bpm'            => $bpm === 0 ? null : $bpm,
            'difficulty'     => $difficulty,
            'generator_seed' => $seed,
            'is_public'      => false,
            'file_path'      => null,
        ]);

        return Response::json(self::serialize($level), 201);
    }

    public function show(Request $req, array $params): Response
    {
        $id = self::parseId($params);
        $level = Level::findById($id);
        if ($level === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        // Privado → solo el autor lo ve. Tratamos 404 (no 403) para no
        // filtrar la existencia de niveles privados ajenos.
        if (!$level->isPublic) {
            $user = AuthContext::tryUser();
            if ($user === null || $user->id !== $level->userId) {
                return Response::json(['error' => 'not_found'], 404);
            }
        }
        return Response::json(self::serialize($level));
    }

    public function index(Request $req): Response
    {
        // Nota: no existe un flag `public`. La lista pública es el comportamiento
        // por defecto, así que `?public=1` es aceptado y redundante — se ignora
        // a propósito en lugar de parsearse a una variable muerta (defecto D7).
        $mine   = filter_var($req->query('mine', '0'), FILTER_VALIDATE_BOOLEAN);
        $limit  = Validator::int($req->query('limit', 20),  ['min' => 1, 'max' => 50, 'required' => false, 'field' => 'limit']);
        $offset = Validator::int($req->query('offset', 0),  ['min' => 0, 'max' => 100_000, 'required' => false, 'field' => 'offset']);

        if ($mine) {
            $user = AuthContext::tryUser();
            if ($user === null) {
                return Response::json(['error' => 'unauthorized', 'message' => 'mine=1 requires Bearer token.'], 401);
            }
            $items = Level::findByUser($user->id, $limit, $offset);
            $total = Level::countByUser($user->id);
        } else {
            // Default: lista pública. `?public=1` y el default son equivalentes,
            // para evitar el "no listado" silencioso.
            $items = Level::findPublic($limit, $offset);
            $total = Level::countPublic();
        }

        return Response::json([
            'items'  => array_map(self::serialize(...), $items),
            'total'  => $total,
            'limit'  => $limit,
            'offset' => $offset,
        ]);
    }

    public function upload(Request $req, array $params): Response
    {
        $user = AuthContext::user();
        $id = self::parseId($params);
        $level = Level::findById($id);
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

        // Anti-spam de título: si va a quedar público, chequear duplicado
        // ANTES de mover el archivo (evita escribir y luego desconectar).
        if (Level::publicTitleExistsForUser($user->id, $level->title, $level->id)) {
            return Response::json(
                ['error' => 'duplicate_title', 'message' => 'Ya tienes un nivel público con ese título.'],
                409,
            );
        }

        $relative = FileUploadService::storeLevelMp3($level->id, $file);
        $level->setPublic(true, $relative);

        return Response::json(self::serialize($level));
    }

    public function streamFile(Request $req, array $params): Response
    {
        $id = self::parseId($params);
        $level = Level::findById($id);
        if ($level === null || !$level->isPublic || $level->filePath === null) {
            return Response::json(['error' => 'not_found'], 404);
        }
        // streamLevelMp3 emite headers + body crudo. No llamamos Response::send;
        // devolvemos noContent para que el front controller no escriba más.
        FileUploadService::streamLevelMp3($level->filePath);
        return Response::noContent();
    }

    public function visibility(Request $req, array $params): Response
    {
        $user = AuthContext::user();
        $id = self::parseId($params);
        $level = Level::findById($id);
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
            $level->setPublic(true);
        } else {
            // Pasar a privado: borra el archivo físico y resetea file_path.
            // Si en el futuro vuelve a público, deberá re-subir el MP3.
            if ($level->filePath !== null) {
                FileUploadService::deleteLevelMp3($level->filePath);
            }
            $stmt = \App\Core\Database::getInstance()->prepare(
                'UPDATE levels SET is_public = 0, file_path = NULL WHERE id = :id',
            );
            $stmt->execute(['id' => $level->id]);
            // Re-fetch para devolver state actualizado.
            $level = Level::findById($level->id);
        }

        return Response::json(self::serialize($level));
    }

    /**
     * @param array<string, string> $params
     */
    private static function parseId(array $params): int
    {
        return Validator::int($params['id'] ?? null, ['min' => 1, 'field' => 'id']);
    }

    /**
     * @return array<string, mixed>
     */
    private static function serialize(Level $level): array
    {
        return [
            'id'             => $level->id,
            'user_id'        => $level->userId,
            'title'          => $level->title,
            'artist'         => $level->artist,
            'duration_sec'   => $level->durationSec,
            'bpm'            => $level->bpm,
            'difficulty'     => $level->difficulty,
            'generator_seed' => $level->generatorSeed,
            'is_public'      => $level->isPublic,
            // `file_path` NO se expone (defecto D5). Es una ruta interna del
            // servidor y el cliente nunca la usa: descarga por
            // `GET /api/levels/{id}/file`, que valida `is_public` antes de
            // servir. Publicarla solo daba a cualquiera la estructura del
            // almacenamiento. Se sustituye por un booleano derivado, que es
            // lo único que la UI necesita saber ("¿tiene audio subido?").
            'has_audio'      => $level->filePath !== null,
            'created_at'     => $level->createdAt,
        ];
    }
}
