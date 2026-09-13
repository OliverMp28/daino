<?php
declare(strict_types=1);

namespace App\Core;

use JsonException;

/**
 * Wrapper inmutable de la request HTTP entrante.
 *
 * Aísla controllers de los superglobales y de las rarezas de PHP
 * (php://input para JSON, getallheaders() no portable, _method spoofing
 * para que los <form> HTML puedan emitir PUT/PATCH/DELETE).
 */
final class Request
{
    /**
     * @param array<string, string|array<int|string, mixed>> $query
     * @param array<string, string|array<int|string, mixed>> $post
     * @param array<string, string|array<int|string, mixed>> $server
     * @param array<string, string> $headers  Normalizados a lowercase.
     * @param array<string, mixed>  $json     Body parseado si Content-Type es JSON.
     */
    private function __construct(
        private readonly string $method,
        private readonly string $path,
        private readonly array $query,
        private readonly array $post,
        private readonly array $server,
        private readonly array $headers,
        private readonly array $json,
        private readonly string $rawBody,
    ) {
    }

    public static function capture(): self
    {
        $server = $_SERVER;
        $rawMethod = strtoupper((string) ($server['REQUEST_METHOD'] ?? 'GET'));

        // Method spoofing: <form method="POST"> con <input name="_method" value="PUT">
        // Solo aplica sobre POST y solo a verbos válidos.
        $spoofed = $rawMethod;
        if ($rawMethod === 'POST' && isset($_POST['_method'])) {
            $candidate = strtoupper((string) $_POST['_method']);
            if (in_array($candidate, ['PUT', 'PATCH', 'DELETE'], true)) {
                $spoofed = $candidate;
            }
        }

        $uri = (string) ($server['REQUEST_URI'] ?? '/');
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';
        // Normalización: quitar trailing slash salvo en raíz.
        if ($path !== '/' && str_ends_with($path, '/')) {
            $path = rtrim($path, '/');
        }

        $headers = self::extractHeaders($server);

        $rawBody = '';
        $json = [];
        if ($spoofed !== 'GET' && $spoofed !== 'HEAD') {
            $rawBody = (string) file_get_contents('php://input');
            $contentType = $headers['content-type'] ?? '';
            if ($rawBody !== '' && str_contains($contentType, 'application/json')) {
                try {
                    $decoded = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
                    if (is_array($decoded)) {
                        $json = $decoded;
                    }
                } catch (JsonException) {
                    // Body declarado JSON pero inválido: dejamos json vacío.
                    // El controller decide cómo reaccionar (e.g. 400).
                }
            }
        }

        /** @var array<string, string|array<int|string, mixed>> $query */
        $query = $_GET;
        /** @var array<string, string|array<int|string, mixed>> $post */
        $post = $_POST;

        return new self($spoofed, $path, $query, $post, $server, $headers, $json, $rawBody);
    }

    /**
     * Construye una request sin superglobales. Para tests y para invocar un
     * controller desde código (CLI, jobs) con una entrada controlada.
     *
     * @param array<string, mixed>  $json     Body JSON ya decodificado.
     * @param array<string, mixed>  $query
     * @param array<string, string> $headers  Nombres en cualquier capitalización.
     */
    public static function make(
        string $method,
        string $path,
        array $json = [],
        array $query = [],
        array $headers = [],
    ): self {
        $normalized = [];
        foreach ($headers as $name => $value) {
            $normalized[strtolower($name)] = $value;
        }
        $rawBody = $json === [] ? '' : (string) json_encode($json);
        /** @var array<string, string|array<int|string, mixed>> $query */
        return new self(strtoupper($method), $path, $query, [], [], $normalized, $json, $rawBody);
    }

    public function method(): string
    {
        return $this->method;
    }

    public function path(): string
    {
        return $this->path;
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $this->query[$key] ?? $default;
    }

    /**
     * Lee del body parseado (JSON) o del form POST, en ese orden.
     */
    public function input(string $key, mixed $default = null): mixed
    {
        if (array_key_exists($key, $this->json)) {
            return $this->json[$key];
        }
        return $this->post[$key] ?? $default;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function bearerToken(): ?string
    {
        $auth = $this->header('authorization');
        if ($auth === null) {
            return null;
        }
        if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m) === 1) {
            return trim($m[1]);
        }
        return null;
    }

    public function isJson(): bool
    {
        $ct = $this->header('content-type') ?? '';
        return str_contains($ct, 'application/json');
    }

    public function ip(): string
    {
        // Sin trust de proxies por ahora: REMOTE_ADDR directo.
        // Cuando metamos un reverse proxy de verdad, leer X-Forwarded-For
        // SOLO si el remote es una IP en la allowlist.
        return (string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public function rawBody(): string
    {
        return $this->rawBody;
    }

    /**
     * @param array<string, mixed> $server
     * @return array<string, string>
     */
    private static function extractHeaders(array $server): array
    {
        $headers = [];
        foreach ($server as $key => $value) {
            $key = (string) $key;
            if (str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            } elseif (in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
                $name = strtolower(str_replace('_', '-', $key));
                $headers[$name] = (string) $value;
            }
        }
        return $headers;
    }
}
