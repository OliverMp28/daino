<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Env;
use Lcobucci\JWT\Signer\Key;
use Lcobucci\JWT\Signer\Key\InMemory;
use RuntimeException;

/**
 * Caché de las claves públicas (JWKS) de Vout en formato lcobucci/jwt Key.
 *
 * Política de refresh (doc 07 §E.3):
 *   - TTL del JSON cacheado: 1 h.
 *   - Si llega un `kid` desconocido, fuerza refresh inmediato (rotación).
 *   - Si Vout no contesta, una clave ya conocida sigue valiendo hasta 24 h:
 *     una caída de Vout no invalida los tokens que firmó antes de caer.
 *   - El JSON se persiste en `storage/cache/jwks.json` (gitignored).
 *
 * El fetcher HTTP y el archivo de caché son inyectables para tests sin Vout
 * activo (y sin pisar la caché real).
 */
final class JwksCache
{
    public const CACHE_FILE = __DIR__ . '/../../storage/cache/jwks.json';
    public const TTL_SECONDS = 3600;
    /** Cuánto se sigue usando una clave ya descargada cuando Vout no contesta. */
    public const STALE_SECONDS = 86400;

    /** @var \Closure(string): string  Fetcher HTTP del JWKS — recibe URL, devuelve body crudo. */
    private \Closure $fetcher;
    private readonly string $cacheFile;

    public function __construct(
        private readonly string $jwksUrl = '',
        ?\Closure $fetcher = null,
        ?string $cacheFile = null,
    ) {
        $this->fetcher = $fetcher ?? \Closure::fromCallable([self::class, 'defaultHttpFetch']);
        $this->cacheFile = $cacheFile ?? self::CACHE_FILE;
    }

    public static function fromEnv(?\Closure $fetcher = null): self
    {
        return new self(Env::string('VOUT_JWKS_URL'), $fetcher);
    }

    /**
     * Devuelve la Key (lcobucci) para un `kid` dado, o null si Vout no la
     * tiene ni siquiera tras un refresh forzado.
     *
     * @throws JwksUnavailableException  Vout no contesta y no hay copia local que sirva.
     */
    public function getKey(string $kid): ?Key
    {
        $cache = $this->loadCache();
        $known = $cache === null ? null : self::findKid($cache['jwks'], $kid);
        if ($cache !== null && $known !== null && $this->isFresh($cache)) {
            return self::jwkToKey($known);
        }
        // Caché caducada, o kid desconocido en caché fresca (rotación de claves).

        try {
            $fresh = $this->fetchAndStore();
        } catch (JwksUnavailableException $e) {
            if ($cache !== null && $known !== null && (time() - $cache['cached_at']) < self::STALE_SECONDS) {
                return self::jwkToKey($known);
            }
            throw $e;
        }
        $jwk = self::findKid($fresh, $kid);
        return $jwk === null ? null : self::jwkToKey($jwk);
    }

    /**
     * Fuerza un refresh y devuelve el JWKS actualizado.
     *
     * @return array{keys: list<array<string, mixed>>}
     */
    public function refresh(): array
    {
        return $this->fetchAndStore();
    }

    /**
     * @return array{cached_at: int, jwks: array{keys: list<array<string, mixed>>}}|null
     */
    private function loadCache(): ?array
    {
        if (!is_file($this->cacheFile)) {
            return null;
        }
        $body = file_get_contents($this->cacheFile);
        if ($body === false) {
            return null;
        }
        try {
            /** @var array{cached_at: int, jwks: array{keys: list<array<string, mixed>>}} $decoded */
            $decoded = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
            if (!isset($decoded['cached_at'], $decoded['jwks']['keys'])) {
                return null;
            }
            return $decoded;
        } catch (\JsonException) {
            return null;
        }
    }

    /**
     * @param array{cached_at: int, jwks: array{keys: list<array<string, mixed>>}} $cache
     */
    private function isFresh(array $cache): bool
    {
        return (time() - $cache['cached_at']) < self::TTL_SECONDS;
    }

    /**
     * @return array{keys: list<array<string, mixed>>}
     */
    private function fetchAndStore(): array
    {
        if ($this->jwksUrl === '') {
            throw new RuntimeException('JwksCache: VOUT_JWKS_URL no configurado.');
        }
        // Todo lo que impida tener un JWKS de Vout (no contesta, contesta otra
        // cosa) es el mismo caso para quien llama: Vout no está disponible.
        try {
            $body = ($this->fetcher)($this->jwksUrl);
        } catch (\Throwable $e) {
            throw new JwksUnavailableException($e->getMessage(), 0, $e);
        }
        try {
            /** @var array{keys?: list<array<string, mixed>>} $decoded */
            $decoded = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new JwksUnavailableException('JwksCache: respuesta JWKS no es JSON: ' . $e->getMessage(), 0, $e);
        }
        if (!isset($decoded['keys']) || !is_array($decoded['keys'])) {
            throw new JwksUnavailableException('JwksCache: respuesta JWKS sin campo `keys`.');
        }

        /** @var array{keys: list<array<string, mixed>>} $jwks */
        $jwks = ['keys' => array_values($decoded['keys'])];
        $payload = ['cached_at' => time(), 'jwks' => $jwks];

        $dir = dirname($this->cacheFile);
        if (!is_dir($dir) && !mkdir($dir, 0o775, true) && !is_dir($dir)) {
            throw new RuntimeException("JwksCache: no se pudo crear {$dir}.");
        }
        // Si el archivo existe pero no nos pertenece (caso típico: lo creó otro
        // user en un docker exec puntual), tirarlo. El directorio padre tiene
        // que ser escribible — lo es por defecto en storage/cache/.
        if (is_file($this->cacheFile) && !is_writable($this->cacheFile)) {
            @unlink($this->cacheFile);
        }
        $written = file_put_contents(
            $this->cacheFile,
            json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
            LOCK_EX,
        );
        if ($written === false) {
            throw new RuntimeException('JwksCache: no se pudo escribir el caché.');
        }
        // 0666 para que cualquier user (root via docker exec, www-data via FPM)
        // pueda sobrescribir más adelante. El JWKS es público y rebuildeable
        // desde Vout si se borra — no hay riesgo de divulgación.
        @chmod($this->cacheFile, 0o666);

        return $jwks;
    }

    /**
     * @param array{keys: list<array<string, mixed>>} $jwks
     * @return array<string, mixed>|null
     */
    private static function findKid(array $jwks, string $kid): ?array
    {
        foreach ($jwks['keys'] as $jwk) {
            if (($jwk['kid'] ?? null) === $kid) {
                return $jwk;
            }
        }
        return null;
    }

    /**
     * @param array<string, mixed> $jwk
     */
    private static function jwkToKey(array $jwk): Key
    {
        if (($jwk['kty'] ?? null) !== 'RSA') {
            throw new RuntimeException("JwksCache: kty no soportado: " . var_export($jwk['kty'] ?? null, true));
        }
        if (!is_string($jwk['n'] ?? null) || !is_string($jwk['e'] ?? null)) {
            throw new RuntimeException('JwksCache: JWK RSA sin n/e.');
        }
        $pem = self::rsaJwkToPem((string) $jwk['n'], (string) $jwk['e']);
        return InMemory::plainText($pem);
    }

    /**
     * Convierte un JWK RSA pública (n, e en base64url) a PEM SubjectPublicKeyInfo.
     * Implementación ASN.1 inline: ~30 líneas de DER, sin dependencias extra.
     */
    private static function rsaJwkToPem(string $nB64Url, string $eB64Url): string
    {
        $b64UrlDecode = static function (string $s): string {
            $s = strtr($s, '-_', '+/');
            $pad = (4 - strlen($s) % 4) % 4;
            $bin = base64_decode($s . str_repeat('=', $pad), true);
            if ($bin === false) {
                throw new RuntimeException('JwksCache: base64url inválido.');
            }
            return $bin;
        };

        $modulus  = $b64UrlDecode($nB64Url);
        $exponent = $b64UrlDecode($eB64Url);

        // INTEGER ASN.1: añadir 0x00 si MSB es 1 (positivo no ambiguo).
        $asn1Int = static function (string $bytes) use (&$asn1Tlv): string {
            if ((ord($bytes[0]) & 0x80) !== 0) {
                $bytes = "\x00" . $bytes;
            }
            return $asn1Tlv("\x02", $bytes);
        };

        // Tag-Length-Value genérico para tags simples.
        $asn1Tlv = static function (string $tag, string $body): string {
            $len = strlen($body);
            if ($len < 0x80) {
                $lenBytes = chr($len);
            } else {
                $tmp = '';
                while ($len > 0) {
                    $tmp = chr($len & 0xff) . $tmp;
                    $len >>= 8;
                }
                $lenBytes = chr(0x80 | strlen($tmp)) . $tmp;
            }
            return $tag . $lenBytes . $body;
        };

        $rsaPublicKey = $asn1Tlv("\x30", $asn1Int($modulus) . $asn1Int($exponent));

        // SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING wrap RSAPublicKey }
        // AlgorithmIdentifier para rsaEncryption: OID 1.2.840.113549.1.1.1 + NULL.
        $algIdentifier =
            "\x30\x0d" .                     // SEQUENCE, len 13
            "\x06\x09" .                     // OID, len 9
            "\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01" . // 1.2.840.113549.1.1.1
            "\x05\x00";                      // NULL

        $bitString = $asn1Tlv("\x03", "\x00" . $rsaPublicKey);
        $spki = $asn1Tlv("\x30", $algIdentifier . $bitString);

        $b64 = chunk_split(base64_encode($spki), 64, "\n");
        return "-----BEGIN PUBLIC KEY-----\n{$b64}-----END PUBLIC KEY-----\n";
    }

    /**
     * Fetcher HTTP por defecto: usa file_get_contents con timeout corto.
     * Para tests, inyectar un Closure custom que devuelva un JWKS de fixture.
     */
    private static function defaultHttpFetch(string $url): string
    {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "Accept: application/json\r\n",
                'timeout' => 5,
                'ignore_errors' => false,
            ],
        ]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) {
            throw new RuntimeException("JwksCache: fetch a {$url} falló.");
        }
        return $body;
    }
}
