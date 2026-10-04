<?php
declare(strict_types=1);

namespace App\Services;

use App\Models\User;

/**
 * Da de alta en Daino a quien llega con una identidad de Vout y todavía no
 * tiene ficha local.
 *
 * Hay dos puertas de entrada y las dos acaban aquí:
 *   - El login directo (`/auth/callback`), que ya trae el perfil de Vout.
 *   - Un Bearer válido sin ficha: quien abre Daino dentro del portal de Vout sin
 *     haber entrado nunca directamente, o tras vaciar la base de datos. Antes
 *     recibía `user_missing` y jugaba como anónimo para siempre. El JWT no trae
 *     nombre ni avatar, así que el perfil se pide a Vout con ese mismo token.
 */
final class UserProvisioner
{
    public function __construct(
        private readonly ?VoutAuthService $vout = null,
    ) {
    }

    /**
     * Ficha local para un perfil de Vout (`/api/v1/user/me`): la que ya hay o una nueva.
     *
     * @param array{vout_id: string, name?: string, username?: string, avatar?: ?string} $profile
     */
    public static function fromProfile(array $profile): User
    {
        $defaults = [
            'username'   => (string) ($profile['username'] ?? $profile['name'] ?? 'user'),
            'avatar_url' => isset($profile['avatar']) ? (string) $profile['avatar'] : null,
        ];
        try {
            return User::findOrCreateByVoutId($profile['vout_id'], $defaults);
        } catch (\PDOException $e) {
            // Dos peticiones a la vez del mismo usuario nuevo: la otra ganó la
            // carrera contra la clave única de `vout_id`.
            return User::findByVoutId($profile['vout_id']) ?? throw $e;
        }
    }

    /**
     * Ficha local para el dueño de un access token ya verificado, o null si Vout
     * no da su perfil. `$voutId` es el claim del token: el perfil tiene que ser
     * el de esa misma persona.
     */
    public function fromToken(string $accessToken, string $voutId): ?User
    {
        try {
            $profile = ($this->vout ?? VoutAuthService::fromEnv())->fetchUserInfo($accessToken);
        } catch (\Throwable $e) {
            error_log('[daino] alta de usuario: Vout no dio el perfil: ' . $e->getMessage());
            return null;
        }
        if ($profile['vout_id'] !== $voutId) {
            return null;
        }
        return self::fromProfile($profile);
    }
}
