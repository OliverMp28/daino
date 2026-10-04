<?php
declare(strict_types=1);

/**
 * Un Vout de mentira para los tests de sesión: firma tokens de verdad (RS256,
 * con su JWKS) y deja decidir qué contesta a cada cosa, incluido no contestar.
 * Nada de red y nada de la caché real de claves (`storage/cache/jwks.json`).
 */

use App\Services\JwksCache;
use App\Services\JwtVerifier;
use App\Services\UserProvisioner;
use App\Services\VoutAuthService;
use Lcobucci\JWT\Configuration;
use Lcobucci\JWT\Signer\Key\InMemory;
use Lcobucci\JWT\Signer\Rsa\Sha256;
use League\OAuth2\Client\Provider\Exception\IdentityProviderException;
use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessToken;

final class FakeVout
{
    public const ISSUER = 'https://vout.test';
    public const CLIENT_ID = 'daino-test-client';
    public const KID = 'clave-de-prueba';

    /** ¿Contesta el endpoint de tokens y el de perfil? */
    public bool $up = true;
    /** ¿Contesta el JWKS? */
    public bool $jwksUp = true;
    public int $jwksFetches = 0;
    public int $refreshCalls = 0;
    public int $profileCalls = 0;
    public ?string $lastRefreshToken = null;
    /** Qué hace Vout con un refresh token: devuelve tokens o lanza. */
    public ?\Closure $onRefresh = null;
    /** @var array<string, mixed>|null  Lo que devuelve `/api/v1/user/me` (null = no lo da). */
    public ?array $profile = null;

    public readonly string $cacheFile;

    /** @var array{private: string, public: string, jwks: string}|null  Una clave RSA para toda la pasada. */
    private static ?array $keys = null;

    public function __construct()
    {
        $this->cacheFile = sys_get_temp_dir() . '/daino-jwks-test-' . bin2hex(random_bytes(6)) . '.json';
    }

    public function __destruct()
    {
        @unlink($this->cacheFile);
    }

    public function jwks(): JwksCache
    {
        return new JwksCache('https://vout.test/oauth/jwks', function (string $url): string {
            $this->jwksFetches++;
            if (!$this->jwksUp) {
                throw new RuntimeException("fetch a {$url} falló.");
            }
            return self::keys()['jwks'];
        }, $this->cacheFile);
    }

    public function verifier(): JwtVerifier
    {
        return new JwtVerifier($this->jwks(), self::ISSUER, self::CLIENT_ID);
    }

    public function service(): VoutAuthService
    {
        $provider = new class([
            'clientId'                => self::CLIENT_ID,
            'urlAuthorize'            => 'https://vout.test/oauth/authorize',
            'urlAccessToken'          => 'https://vout.test/oauth/token',
            'urlResourceOwnerDetails' => 'https://vout.test/api/v1/user/me',
        ]) extends GenericProvider {
            public ?\Closure $handler = null;

            public function getAccessToken($grant, array $options = [])
            {
                return ($this->handler)($grant, $options);
            }
        };
        $provider->handler = function (mixed $grant, array $options): AccessToken {
            $this->refreshCalls++;
            $this->lastRefreshToken = $options['refresh_token'] ?? null;
            if (!$this->up) {
                throw new RuntimeException('cURL error 7: Failed to connect to vout.test');
            }
            return ($this->onRefresh)((string) $this->lastRefreshToken);
        };

        return new VoutAuthService($provider, 'https://vout.test/api/v1/user/me', 'user:read', function (): string {
            $this->profileCalls++;
            if (!$this->up || $this->profile === null) {
                throw new RuntimeException('GET /api/v1/user/me falló.');
            }
            return (string) json_encode(['data' => $this->profile]);
        });
    }

    public function provisioner(): UserProvisioner
    {
        return new UserProvisioner($this->service());
    }

    /**
     * Access token firmado. `$ttl` negativo = ya caducado.
     *
     * @param array{issuer?: string, audience?: string} $with
     */
    public function token(string $voutId, int $ttl = 3600, array $with = []): string
    {
        $keys = self::keys();
        $config = Configuration::forAsymmetricSigner(
            new Sha256(),
            InMemory::plainText($keys['private']),
            InMemory::plainText($keys['public']),
        );
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $issued = $ttl < 0 ? $now->modify(($ttl - 3600) . ' seconds') : $now;

        return $config->builder()
            ->issuedBy($with['issuer'] ?? self::ISSUER)
            ->permittedFor($with['audience'] ?? self::CLIENT_ID)
            ->identifiedBy(bin2hex(random_bytes(8)))
            ->relatedTo('2')
            ->issuedAt($issued)
            ->canOnlyBeUsedAfter($issued)
            ->expiresAt($now->modify("{$ttl} seconds"))
            ->withClaim('vout_id', $voutId)
            ->withHeader('kid', self::KID)
            ->getToken($config->signer(), $config->signingKey())
            ->toString();
    }

    /** Lo que devuelve `/oauth/token` al renovar: access token nuevo y refresh token nuevo. */
    public function grant(string $voutId, string $newRefreshToken): AccessToken
    {
        return new AccessToken([
            'access_token'  => $this->token($voutId),
            'expires_in'    => 3600,
            'refresh_token' => $newRefreshToken,
        ]);
    }

    public static function oauthError(string $error, int $status = 400): IdentityProviderException
    {
        return new IdentityProviderException($error, $status, ['error' => $error]);
    }

    /** Deja la caché de claves como si se hubiera descargado hace `$seconds`. */
    public function ageCache(int $seconds): void
    {
        $cache = json_decode((string) file_get_contents($this->cacheFile), true, 512, JSON_THROW_ON_ERROR);
        $cache['cached_at'] = time() - $seconds;
        file_put_contents($this->cacheFile, json_encode($cache));
    }

    /**
     * @return array{private: string, public: string, jwks: string}
     */
    private static function keys(): array
    {
        if (self::$keys !== null) {
            return self::$keys;
        }
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        if ($key === false) {
            throw new RuntimeException('No se pudo generar la clave RSA de prueba.');
        }
        openssl_pkey_export($key, $private);
        $details = openssl_pkey_get_details($key);
        $b64 = static fn (string $bin): string => rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');

        return self::$keys = [
            'private' => $private,
            'public'  => $details['key'],
            'jwks'    => (string) json_encode(['keys' => [[
                'kty' => 'RSA', 'use' => 'sig', 'alg' => 'RS256', 'kid' => self::KID,
                'n'   => $b64($details['rsa']['n']),
                'e'   => $b64($details['rsa']['e']),
            ]]]),
        ];
    }
}
