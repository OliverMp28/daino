<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;
use RuntimeException;

/**
 * User — registro local mínimo enlazado a Vout por `vout_id`.
 *
 * No guarda credenciales (Vout es IdP). Datos mostrables en runtime vienen
 * del JWT validado, salvo `username` y `avatar_url` que cacheamos para
 * rankings y para no llamar a /api/me en cada paint.
 *
 * La fila se crea lazily en el primer callback OAuth exitoso.
 */
final class User
{
    public function __construct(
        public readonly int $id,
        public readonly string $voutId,
        public string $username,
        public ?string $avatarUrl,
        public readonly string $createdAt,
        public ?string $lastLoginAt,
    ) {
    }

    public static function findById(int $id): ?self
    {
        $stmt = Database::getInstance()->prepare('SELECT * FROM users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    public static function findByVoutId(string $voutId): ?self
    {
        $stmt = Database::getInstance()->prepare('SELECT * FROM users WHERE vout_id = :vout_id');
        $stmt->execute(['vout_id' => $voutId]);
        $row = $stmt->fetch();
        return $row === false ? null : self::fromRow($row);
    }

    /**
     * Perfiles públicos de varios usuarios en UNA consulta (para rankings y
     * autores de niveles, sin N+1).
     *
     * @param list<int> $ids
     * @return array<int, array{vout_id: string, username: string, avatar_url: ?string}>  indexado por id
     */
    public static function publicProfilesByIds(array $ids): array
    {
        $ids = array_values(array_unique($ids));
        if ($ids === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $stmt = Database::getInstance()->prepare("SELECT id, vout_id, username, avatar_url FROM users WHERE id IN ({$in})");
        $stmt->execute($ids);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[(int) $row['id']] = [
                'vout_id'    => (string) $row['vout_id'],
                'username'   => (string) $row['username'],
                'avatar_url' => $row['avatar_url'] === null ? null : (string) $row['avatar_url'],
            ];
        }
        return $out;
    }

    /**
     * Forma pública del usuario: lo que el frontend puede mostrar. Nunca el id
     * interno ni fechas.
     *
     * @return array{vout_id: string, username: string, avatar_url: ?string}
     */
    public function publicProfile(): array
    {
        return ['vout_id' => $this->voutId, 'username' => $this->username, 'avatar_url' => $this->avatarUrl];
    }

    /**
     * @param array{vout_id: string, username: string, avatar_url?: ?string} $data
     */
    public static function create(array $data): self
    {
        $pdo = Database::getInstance();
        $stmt = $pdo->prepare(
            'INSERT INTO users (vout_id, username, avatar_url) VALUES (:vout_id, :username, :avatar_url)',
        );
        $stmt->execute([
            'vout_id'    => $data['vout_id'],
            'username'   => $data['username'],
            'avatar_url' => $data['avatar_url'] ?? null,
        ]);
        $id = (int) $pdo->lastInsertId();
        $created = self::findById($id);
        if ($created === null) {
            throw new RuntimeException("User::create no pudo recuperar la fila recién creada (id={$id}).");
        }
        return $created;
    }

    /**
     * @param array{username: string, avatar_url?: ?string} $defaults
     */
    public static function findOrCreateByVoutId(string $voutId, array $defaults): self
    {
        $existing = self::findByVoutId($voutId);
        if ($existing !== null) {
            return $existing;
        }
        return self::create([
            'vout_id'    => $voutId,
            'username'   => $defaults['username'],
            'avatar_url' => $defaults['avatar_url'] ?? null,
        ]);
    }

    /**
     * @param array{username?: string, avatar_url?: ?string, last_login_at?: ?string} $data
     */
    public function update(array $data): void
    {
        $allowed = ['username', 'avatar_url', 'last_login_at'];
        $sets = [];
        $params = ['id' => $this->id];
        foreach ($data as $key => $value) {
            if (!in_array($key, $allowed, true)) {
                continue;
            }
            $sets[] = "{$key} = :{$key}";
            $params[$key] = $value;
        }
        if ($sets === []) {
            return;
        }
        $sql = 'UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = :id';
        $stmt = Database::getInstance()->prepare($sql);
        $stmt->execute($params);
        if (array_key_exists('username', $data)) {
            $this->username = $data['username'];
        }
        if (array_key_exists('avatar_url', $data)) {
            $this->avatarUrl = $data['avatar_url'];
        }
        if (array_key_exists('last_login_at', $data)) {
            $this->lastLoginAt = $data['last_login_at'];
        }
    }

    public function delete(): void
    {
        $stmt = Database::getInstance()->prepare('DELETE FROM users WHERE id = :id');
        $stmt->execute(['id' => $this->id]);
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function fromRow(array $row): self
    {
        return new self(
            id:          (int) $row['id'],
            voutId:      (string) $row['vout_id'],
            username:    (string) $row['username'],
            avatarUrl:   $row['avatar_url'] === null ? null : (string) $row['avatar_url'],
            createdAt:   (string) $row['created_at'],
            lastLoginAt: $row['last_login_at'] === null ? null : (string) $row['last_login_at'],
        );
    }
}
