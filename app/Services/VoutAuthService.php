<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Env;
use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessTokenInterface;
use RuntimeException;

/**
 * Wrapper sobre league/oauth2-client (GenericProvider) para Vout.
 *
 * Responsabilidades:
 *   - Construir la URL de authorize con PKCE S256 + state.
 *   - Generar y emparejar `code_verifier` con `code_challenge`.
 *   - Intercambiar `code` por tokens (server-to-server).
 *   - Refrescar tokens.
 *   - Obtener userinfo del endpoint Vout (`/api/v1/user/me`), que devuelve
 *     `{ data: { vout_id, name, username, avatar, email? } }` — formato
 *     non-estándar que envuelve en `data`, no se mapea limpio con
 *     `getResourceOwner()` por eso lo hacemos a mano.
 *
 * El cliente HTTP para userinfo es inyectable para tests (vía constructor).
 */
final class VoutAuthService
{
    /**
     * User-Agent de las llamadas de Daino a Vout hechas con file_get_contents
     * (JWKS y perfil). PHP no manda ninguno por defecto, y en producción esas
     * llamadas pasan por Cloudflare, cuyo Browser Integrity Check (encendido de
     * serie) desafía las peticiones sin User-Agent. El canje del código y el
     * refresco van por Guzzle, que ya manda el suyo.
     */
    public const USER_AGENT = 'Daino/2 (servidor; +https://daino.vout.cloud)';

    /** @var \Closure(string, array<string, string>): string  ($url, $headers) → body */
    private \Closure $httpGet;

    public function __construct(
        private readonly GenericProvider $provider,
        private readonly string $userInfoUrl,
        private readonly string $scopes,
        ?\Closure $httpGet = null,
    ) {
        $this->httpGet = $httpGet ?? \Closure::fromCallable([self::class, 'defaultHttpGet']);
    }

    public static function fromEnv(?\Closure $httpGet = null): self
    {
        $provider = new GenericProvider([
            'clientId'                => Env::string('VOUT_CLIENT_ID'),
            'clientSecret'            => Env::string('VOUT_CLIENT_SECRET', ''),
            'redirectUri'             => Env::string('VOUT_REDIRECT_URI'),
            'urlAuthorize'            => Env::string('VOUT_AUTHORIZE_URL'),
            'urlAccessToken'          => Env::string('VOUT_TOKEN_URL'),
            'urlResourceOwnerDetails' => Env::string('VOUT_USERINFO_URL'),
        ]);
        return new self(
            $provider,
            Env::string('VOUT_USERINFO_URL'),
            Env::string('VOUT_SCOPES', 'user:read'),
            $httpGet,
        );
    }

    /**
     * @return array{url: string, state: string, code_verifier: string}
     */
    public function buildAuthorizationUrl(): array
    {
        $verifier = self::generatePkceVerifier();
        $state = bin2hex(random_bytes(16));

        $url = $this->provider->getAuthorizationUrl([
            'scope'                 => $this->scopes,
            'state'                 => $state,
            'code_challenge'        => self::pkceChallenge($verifier),
            'code_challenge_method' => 'S256',
        ]);

        return [
            'url'           => $url,
            'state'         => $state,
            'code_verifier' => $verifier,
        ];
    }

    public function exchangeCodeForToken(string $code, string $codeVerifier): AccessTokenInterface
    {
        return $this->provider->getAccessToken('authorization_code', [
            'code'          => $code,
            'code_verifier' => $codeVerifier,
        ]);
    }

    public function refresh(string $refreshToken): AccessTokenInterface
    {
        return $this->provider->getAccessToken('refresh_token', [
            'refresh_token' => $refreshToken,
        ]);
    }

    /**
     * Llama a /api/v1/user/me con el access_token. Devuelve el sub-objeto
     * `data` ya extraído.
     *
     * @return array{vout_id: string, name?: string, username?: string, avatar?: ?string, email?: ?string}
     */
    public function fetchUserInfo(string $accessToken): array
    {
        $body = ($this->httpGet)($this->userInfoUrl, [
            'Authorization' => "Bearer {$accessToken}",
            'Accept'        => 'application/json',
        ]);

        try {
            /** @var array{data?: array<string, mixed>} $decoded */
            $decoded = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new RuntimeException('VoutAuthService: respuesta /me no es JSON: ' . $e->getMessage(), 0, $e);
        }

        if (!isset($decoded['data']) || !is_array($decoded['data'])) {
            throw new RuntimeException('VoutAuthService: respuesta /me sin sub-objeto `data`.');
        }
        if (!isset($decoded['data']['vout_id']) || !is_string($decoded['data']['vout_id'])) {
            throw new RuntimeException('VoutAuthService: /me sin `data.vout_id`.');
        }

        /** @var array{vout_id: string, name?: string, username?: string, avatar?: ?string, email?: ?string} $data */
        $data = $decoded['data'];
        return $data;
    }

    /**
     * PKCE verifier: cadena aleatoria de 43–128 chars, alfabeto base64url.
     * Generamos 32 bytes (256 bits) de entropía; resulta en 43 chars.
     */
    public static function generatePkceVerifier(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    /**
     * PKCE challenge S256 = base64url(sha256(verifier)).
     */
    public static function pkceChallenge(string $verifier): string
    {
        $hash = hash('sha256', $verifier, true);
        return rtrim(strtr(base64_encode($hash), '+/', '-_'), '=');
    }

    /**
     * @param array<string, string> $headers
     */
    private static function defaultHttpGet(string $url, array $headers): string
    {
        $headerLines = '';
        foreach ($headers as $name => $value) {
            $headerLines .= "{$name}: {$value}\r\n";
        }
        $ctx = stream_context_create([
            'http' => [
                'method'        => 'GET',
                'header'        => $headerLines,
                'user_agent'    => self::USER_AGENT,
                'timeout'       => 10,
                'ignore_errors' => false,
            ],
        ]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) {
            throw new RuntimeException("VoutAuthService: GET {$url} falló (¿Vout encendido?).");
        }
        return $body;
    }
}
