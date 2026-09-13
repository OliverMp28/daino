<?php
declare(strict_types=1);

namespace App\Core;

use LogicException;

/**
 * Response HTTP construible y emitible.
 *
 * Los controllers devuelven instancias de Response; el front controller
 * (public/index.php) llama a send(). send() NO hace exit — quien quiera
 * salir, sale a mano.
 */
final class Response
{
    /**
     * @param array<string, string> $headers  Mapa case-insensitive (las claves
     *                                        se normalizan a lowercase internamente).
     */
    public function __construct(
        private string $body = '',
        private int $status = 200,
        private array $headers = [],
    ) {
        // Normaliza claves a lowercase para evitar duplicados tipo
        // "Content-Type" + "content-type".
        $normalized = [];
        foreach ($headers as $name => $value) {
            $normalized[strtolower($name)] = $value;
        }
        $this->headers = $normalized;
    }

    public static function json(mixed $data, int $status = 200): self
    {
        $body = json_encode(
            $data,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        );
        return new self($body, $status, ['content-type' => 'application/json; charset=utf-8']);
    }

    /**
     * Body JSON ya codificado (p. ej. un chart guardado tal cual en BD): se
     * sirve sin decodificar y recodificar varios KB por petición.
     */
    public static function rawJson(string $json, int $status = 200): self
    {
        return new self($json, $status, ['content-type' => 'application/json; charset=utf-8']);
    }

    public static function html(string $html, int $status = 200): self
    {
        return new self($html, $status, ['content-type' => 'text/html; charset=utf-8']);
    }

    public static function redirect(string $url, int $status = 302): self
    {
        return new self('', $status, ['location' => $url]);
    }

    public static function noContent(): self
    {
        return new self('', 204, []);
    }

    public function header(string $name, string $value): self
    {
        $this->headers[strtolower($name)] = $value;
        return $this;
    }

    public function status(): int
    {
        return $this->status;
    }

    /** Body tal cual se enviará. Útil en tests de controllers. */
    public function body(): string
    {
        return $this->body;
    }

    public function headerValue(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function send(): void
    {
        if (headers_sent($file, $line)) {
            // Falla ruidosa en dev. En prod, error_reporting decide si se ve.
            throw new LogicException("Headers ya enviados en {$file}:{$line}");
        }

        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            // Capitaliza Content-Type, Location, etc. para output correcto.
            $pretty = self::titleize($name);
            header("{$pretty}: {$value}", true);
        }
        echo $this->body;
    }

    private static function titleize(string $headerName): string
    {
        return implode('-', array_map(
            static fn(string $part): string => ucfirst($part),
            explode('-', $headerName),
        ));
    }
}
