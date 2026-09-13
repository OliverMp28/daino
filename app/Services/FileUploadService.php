<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\PayloadTooLargeException;
use App\Core\ValidationException;
use RuntimeException;


/**
 * FileUploadService — validación + persistencia de uploads.
 *
 * Responsabilidades:
 *   - Validar MIME REAL (vía finfo, no `$_FILES['type']` que viene del cliente).
 *   - Validar tamaño contra UPLOAD_MAX_SIZE_MB del .env.
 *   - Persistir uploads en `storage/uploads/levels/` (out of docroot — Nginx
 *     bloquea acceso directo desde Bloque 0).
 *   - Stream de uploads existentes para `GET /api/levels/{id}/file`.
 *
 * Diseño: clase con métodos estáticos. Sin estado de instancia, sin DI; las
 * dependencias (php-finfo, FS) son globales del runtime.
 */
final class FileUploadService
{
    private const ALLOWED_MIME = 'audio/mpeg';
    private const STORAGE_RELATIVE_DIR = 'levels';

    /**
     * Valida un upload de MP3 contra los límites del sistema.
     *
     * @param array{name?: string, type?: string, tmp_name?: string, error?: int, size?: int} $file
     *        Estructura `$_FILES['key']` típica.
     *
     * @throws ValidationException Si MIME, tamaño o estructura no son válidos.
     * @throws PayloadTooLargeException Si supera UPLOAD_MAX_SIZE_MB. El
     *          bootstrap exception handler mapea a 413.
     */
    public static function validateAudioMp3(array $file, int $maxBytes): void
    {
        $error = $file['error'] ?? UPLOAD_ERR_NO_FILE;
        if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
            // PHP rechazó el upload por exceder upload_max_filesize antes
            // de poder leerlo. Mapea a 413 vía bootstrap exception handler.
            throw new PayloadTooLargeException('Upload excede el límite de PHP.');
        }
        if ($error !== UPLOAD_ERR_OK) {
            throw new ValidationException(['file' => 'Upload falló (error PHP ' . $error . ').']);
        }

        $tmp = $file['tmp_name'] ?? null;
        if (!is_string($tmp) || $tmp === '' || !is_uploaded_file($tmp)) {
            throw new ValidationException(['file' => 'Upload no presente o no es un upload válido.']);
        }

        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0) {
            throw new ValidationException(['file' => 'Archivo vacío.']);
        }
        if ($size > $maxBytes) {
            throw new PayloadTooLargeException("Upload excede el máximo de {$maxBytes} bytes.");
        }

        // MIME REAL via finfo — NO `$file['type']` que viene del cliente y
        // se puede falsear renombrando un .png a .mp3. Pero la libmagic de
        // Alpine NO reconoce MP3s con ID3v2 tag (los reporta como
        // `application/octet-stream`). Como ID3v2 es lo más común en MP3s
        // reales, no podemos confiar solo en finfo. Patrón:
        //   1. finfo devuelve `audio/mpeg` o variante → OK directo.
        //   2. finfo devuelve `application/octet-stream` → fallback a
        //      magic-byte sniff manual (ID3v2 o frame sync MPEG-1 LayerIII).
        //   3. Cualquier otra cosa → reject.
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $detected = $finfo->file($tmp);

        $audioMimes = ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'];
        if (in_array($detected, $audioMimes, true)) {
            return;
        }

        if ($detected === 'application/octet-stream' && self::looksLikeMp3($tmp)) {
            return;
        }

        throw new ValidationException(['file' => "Tipo no permitido: {$detected}. Solo audio/mpeg."]);
    }

    /**
     * Lee los primeros 3 bytes del archivo y comprueba si parecen un MP3:
     *   - "ID3" → ID3v2 tag (formato dominante; finfo de Alpine lo reporta
     *     como octet-stream).
     *   - 0xFF 0xFB / 0xFA / 0xF3 / 0xF2 → frame sync MPEG-1 Layer III
     *     (MP3 sin tags). El segundo byte tiene los bits de versión/layer.
     *
     * No es un parser completo del header — solo descarta archivos que
     * obviamente no son MP3. Suficiente para validación de upload; el browser
     * del receptor decodificará y rechazará si el contenido fuera inválido.
     */
    private static function looksLikeMp3(string $path): bool
    {
        $fh = @fopen($path, 'rb');
        if ($fh === false) {
            return false;
        }
        $head = fread($fh, 3);
        fclose($fh);
        if ($head === false || strlen($head) < 3) {
            return false;
        }
        if (str_starts_with($head, 'ID3')) {
            return true;
        }
        $b0 = ord($head[0]);
        $b1 = ord($head[1]);
        if ($b0 === 0xFF && ($b1 & 0xE0) === 0xE0) {
            // 0xFF Fx — primeros 11 bits a 1 es el frame sync MPEG.
            return true;
        }
        return false;
    }

    /**
     * Mueve el upload validado a `storage/uploads/levels/{levelId}.mp3` y
     * devuelve el path RELATIVO (e.g. "levels/3.mp3") para guardar en
     * `levels.file_path`.
     *
     * Si el level ya tenía archivo, lo sobreescribe (caso: re-upload tras
     * cambio de visibilidad).
     */
    public static function storeLevelMp3(int $levelId, array $file): string
    {
        $absDir = self::storageBase();
        if (!is_dir($absDir) && !mkdir($absDir, 0755, true) && !is_dir($absDir)) {
            throw new RuntimeException("No se pudo crear el directorio de uploads: {$absDir}");
        }

        $relative = self::STORAGE_RELATIVE_DIR . '/' . $levelId . '.mp3';
        $absPath = $absDir . '/' . $levelId . '.mp3';
        $tmp = (string) $file['tmp_name'];

        if (!move_uploaded_file($tmp, $absPath)) {
            throw new RuntimeException("No se pudo mover el upload a {$absPath}");
        }
        @chmod($absPath, 0644);

        return $relative;
    }

    /**
     * Elimina el archivo físico de un level (al pasar a privado o borrar).
     * Idempotente: si no existe, no hace nada.
     */
    public static function deleteLevelMp3(string $relativePath): void
    {
        $abs = self::storageBase() . '/' . basename($relativePath);
        if (is_file($abs)) {
            @unlink($abs);
        }
    }

    /**
     * Stream del MP3 al cliente. Llama directamente a `readfile` con
     * headers correctos. NO devuelve Response porque emite el body crudo.
     * El controller debe llamar a esto y luego `exit` o devolver Response::noContent.
     */
    public static function streamLevelMp3(string $relativePath, ?string $etag = null): void
    {
        $abs = self::storageBase() . '/' . basename($relativePath);
        if (!is_file($abs)) {
            throw new RuntimeException("Archivo de level no existe: {$abs}");
        }
        $size = filesize($abs);
        if ($size === false) {
            throw new RuntimeException('No se pudo leer el tamaño del archivo.');
        }
        if (!headers_sent()) {
            header('Content-Type: audio/mpeg');
            header('Content-Length: ' . $size);
            header('Content-Disposition: inline; filename="' . basename($abs) . '"');
            header('Accept-Ranges: none');
            if ($etag !== null) {
                // Con ETag (el hash del audio) el navegador revalida con un 304
                // de pocos bytes en lugar de volver a bajar el MP3 entero. El
                // cliente guarda además su propia copia en IndexedDB (Ola 3),
                // así que esto cubre el caso de caché local vaciada.
                header('ETag: ' . $etag);
                header('Cache-Control: private, no-cache');
            } else {
                header('Cache-Control: private, max-age=300');
            }
        }
        readfile($abs);
    }

    /**
     * SHA-256 del contenido de un upload ya validado. Identifica el audio por
     * sus bytes: es lo que se compara con el hash con el que se generó el chart.
     *
     * @param array<string, mixed> $file  Entrada de `$_FILES`.
     */
    public static function sha256OfUpload(array $file): string
    {
        $hash = hash_file('sha256', (string) $file['tmp_name']);
        if ($hash === false) {
            throw new RuntimeException('No se pudo calcular el hash del archivo subido.');
        }
        return $hash;
    }

    private static function storageBase(): string
    {
        // Resuelve absolute path desde el root del proyecto, no desde public/.
        // bootstrap.php define `DAINO_ROOT` arriba en el require.
        $root = defined('DAINO_ROOT') ? (string) DAINO_ROOT : (__DIR__ . '/../..');
        return realpath($root) . '/storage/uploads/' . self::STORAGE_RELATIVE_DIR;
    }
}
