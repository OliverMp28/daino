<?php
declare(strict_types=1);

/**
 * La sesión con Vout a lo largo del tiempo: el access token vale 60 minutos y
 * la sesión, 30 días. Lo que se protege aquí es lo que falló jugando:
 *
 *   - Al volver al día siguiente la sesión "se había perdido": seguía viva, pero
 *     nadie usaba el refresh token.
 *   - Un Vout apagado, o dos pestañas renovando a la vez, cerraban la sesión.
 *   - Quien entra por el portal de Vout sin haber entrado nunca directamente no
 *     tenía ficha en Daino y jugaba como anónimo.
 *
 * Se ejercitan AuthController, AuthMiddleware y JwksCache de verdad contra un
 * Vout de mentira que firma tokens reales (tests/php/idp.php).
 */

use App\Controllers\AuthController;
use App\Core\AuthContext;
use App\Core\Cookies;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Middleware\AuthMiddleware;
use App\Models\User;
use App\Services\JwksUnavailableException;

require_once __DIR__ . '/fixtures.php';
require_once __DIR__ . '/idp.php';

/**
 * Sesión y cookies limpias. Devuelve lo que se vaya escribiendo en cookies.
 *
 * @return \ArrayObject<int, array{name: string, value: string, expires: int}>
 */
function cleanSession(): \ArrayObject
{
    $_SESSION = [];
    unset($_COOKIE['daino_refresh']);
    $written = new \ArrayObject();
    Cookies::writeWith(static function (string $name, string $value, array $options) use ($written): void {
        $written[] = ['name' => $name, 'value' => $value, 'expires' => (int) ($options['expires'] ?? 0)];
    });
    return $written;
}

/**
 * Un test que parte de una sesión limpia y recibe las cookies que se escriban.
 * Los fallos de Vout que se provocan aquí se anotan en el log del servidor:
 * durante el test se apartan para que no parezcan fallos de la pasada.
 */
function sessionTest(string $name, callable $fn): void
{
    test($name, static function () use ($fn): void {
        $log = (string) ini_get('error_log');
        ini_set('error_log', '/dev/null');
        try {
            $fn(cleanSession());
        } finally {
            ini_set('error_log', $log);
            Cookies::writeWith(null);
        }
    });
}

/** Sesión iniciada como `$user`, con un access token al que le quedan `$ttl` segundos. */
function signIn(User $user, FakeVout $vout, int $ttl, ?string $refreshToken = 'r1'): string
{
    $token = $vout->token($user->voutId, $ttl);
    Session::set('user_id', $user->id);
    Session::set('vout_id', $user->voutId);
    Session::set('access_token', $token);
    Session::set('access_token_expires_at', time() + $ttl);
    if ($refreshToken !== null) {
        $_COOKIE['daino_refresh'] = $refreshToken;
    }
    return $token;
}

function authController(FakeVout $vout): AuthController
{
    return new AuthController($vout->service(), $vout->verifier(), $vout->provisioner());
}

function refreshCall(FakeVout $vout): Response
{
    return authController($vout)->refresh(Request::make('POST', '/auth/refresh'));
}

/**
 * @param \ArrayObject<int, array{name: string, value: string, expires: int}> $cookies
 * @return array{name: string, value: string, expires: int}|null  La última escritura de esa cookie.
 */
function lastCookie(\ArrayObject $cookies, string $name): ?array
{
    $found = null;
    foreach ($cookies as $cookie) {
        if ($cookie['name'] === $name) {
            $found = $cookie;
        }
    }
    return $found;
}

/** Petición a una ruta con Bearer obligatorio; el final de la cadena devuelve a quién se reconoció. */
function apiAs(FakeVout $vout, string $bearer): Response
{
    AuthContext::clear();
    $middleware = new AuthMiddleware($vout->verifier(), $vout->provisioner());
    return $middleware(
        Request::make('GET', '/api/me', headers: ['Authorization' => "Bearer {$bearer}"]),
        static fn (Request $req): Response => Response::json(['user' => AuthContext::user()->publicProfile()]),
    );
}

function withDebug(string $value, callable $fn): void
{
    $before = $_ENV['APP_DEBUG'] ?? null;
    $_ENV['APP_DEBUG'] = $value;
    try {
        $fn();
    } finally {
        if ($before === null) {
            unset($_ENV['APP_DEBUG']);
        } else {
            $_ENV['APP_DEBUG'] = $before;
        }
    }
}

// --------------------------- Volver al día siguiente ---------------------------

sessionTest('sesión: con el access token caducado, /api/me/token pide renovar (la sesión sigue viva)', function (): void {
    $vout = new FakeVout();
    $user = makeUser('vuelve');
    signIn($user, $vout, -60);

    $res = authController($vout)->meToken(Request::make('GET', '/api/me/token'));
    $body = decode($res);
    assertSame(401, $res->status());
    assertSame(true, $body['must_refresh'] ?? null, 'no es "sin sesión": hay que renovar');
    assertTrue(is_string($body['csrf_token'] ?? null) && $body['csrf_token'] !== '', 'con el CSRF que necesita /auth/refresh');
    assertSame($user->voutId, Session::get('vout_id'), 'la sesión no se toca');

    cleanSession();
    $anonymous = authController($vout)->meToken(Request::make('GET', '/api/me/token'));
    assertSame(401, $anonymous->status());
    assertTrue(!array_key_exists('must_refresh', decode($anonymous)), 'sin sesión no hay nada que renovar');
});

sessionTest('sesión: /auth/refresh da un token nuevo, guarda el refresh token nuevo y alarga la sesión', function (\ArrayObject $cookies): void {
    $vout = new FakeVout();
    $user = makeUser('renueva');
    $old = signIn($user, $vout, -60, 'r1');
    $vout->onRefresh = static fn (string $refresh) => $vout->grant($user->voutId, 'r2');

    $res = refreshCall($vout);
    $body = decode($res);
    assertSame(200, $res->status());
    assertSame('r1', $vout->lastRefreshToken, 'canjea el refresh token de la cookie');
    assertTrue($body['access_token'] !== $old, 'access token nuevo');
    assertSame($body['access_token'], Session::get('access_token'), 'y queda en la sesión');
    assertTrue($body['expires_in'] > 3500 && $body['expires_in'] <= 3600, 'expires_in: lo que le queda, en segundos');
    assertSame($user->username, $body['user']['username'], 'con la identidad: al arrancar no hace falta otra petición');
    assertTrue(is_string($body['csrf_token']) && $body['csrf_token'] !== '', 'y el CSRF');

    $refreshCookie = lastCookie($cookies, 'daino_refresh');
    assertSame('r2', $refreshCookie['value'] ?? null, 'Vout invalida r1 al usarlo: hay que guardar r2');
    assertTrue($refreshCookie['expires'] > time() + 29 * 86400, 'otros 30 días');
    $sessionCookie = lastCookie($cookies, 'DAINO_SESSID');
    assertTrue($sessionCookie !== null && $sessionCookie['value'] === session_id(), 'la cookie de sesión se renueva a la vez');
    assertTrue($sessionCookie['expires'] > time() + 29 * 86400, 'y caduca con el refresh token, no a los 30 días del login');
});

sessionTest('sesión: dos pestañas renovando a la vez no se cierran la sesión una a otra', function (): void {
    $vout = new FakeVout();
    $user = makeUser('pestañas');
    signIn($user, $vout, -60, 'r1');
    // Vout como es: cada refresh token vale una vez.
    $vout->onRefresh = static fn (string $refresh) => $refresh === 'r1'
        ? $vout->grant($user->voutId, 'r2')
        : throw FakeVout::oauthError('invalid_grant');

    $first = decode(refreshCall($vout));
    // La segunda pestaña mandó su petición antes de recibir la cookie nueva.
    $_COOKIE['daino_refresh'] = 'r1';
    $second = refreshCall($vout);

    assertSame(200, $second->status(), 'antes: invalid_grant y sesión cerrada');
    assertSame($first['access_token'], decode($second)['access_token'], 'recibe el token que acaba de sacar la otra');
    assertSame(1, $vout->refreshCalls, 'sin volver a canjear nada en Vout');
    assertSame($user->voutId, Session::get('vout_id'));
});

// --------------------------- Lo que NO cierra una sesión ---------------------------

sessionTest('sesión: Vout apagado no cierra la sesión ni tira el refresh token', function (\ArrayObject $cookies): void {
    $vout = new FakeVout();
    $user = makeUser('paciente');
    signIn($user, $vout, -60);
    $vout->up = false;

    $res = refreshCall($vout);
    assertSame(503, $res->status(), 'antes: 401 y sesión destruida');
    assertSame('idp_unavailable', decode($res)['error']);
    assertSame($user->voutId, Session::get('vout_id'), 'la sesión sigue ahí para el siguiente intento');
    assertSame(null, lastCookie($cookies, 'daino_refresh'), 'el refresh token sigue valiendo: no se borra');
    assertSame(null, lastCookie($cookies, 'DAINO_SESSID'));

    // Vout contesta, pero con un error que no es del usuario (mal configurado, caído a medias).
    $vout->up = true;
    $vout->onRefresh = static fn () => throw FakeVout::oauthError('server_error', 500);
    assertSame(503, refreshCall($vout)->status());
    assertSame($user->voutId, Session::get('vout_id'));

    // Y cuando vuelve, la misma cookie sirve.
    $vout->onRefresh = static fn () => $vout->grant($user->voutId, 'r2');
    assertSame(200, refreshCall($vout)->status());
});

sessionTest('sesión: si el token nuevo no se puede comprobar, el refresh token nuevo no se pierde', function (\ArrayObject $cookies): void {
    $vout = new FakeVout();
    $user = makeUser('a-medias');
    signIn($user, $vout, -60, 'r1');
    $vout->onRefresh = static fn () => $vout->grant($user->voutId, 'r2');
    $vout->jwksUp = false;      // da tokens, pero no sus claves públicas

    $res = refreshCall($vout);
    assertSame(503, $res->status());
    assertSame('r2', lastCookie($cookies, 'daino_refresh')['value'] ?? null, 'r1 ya no vale en Vout: sin r2 habría que volver a iniciar sesión');
    assertSame($user->voutId, Session::get('vout_id'));
});

// --------------------------- Lo que sí la cierra ---------------------------

sessionTest('sesión: cuando Vout rechaza el refresh token (revocado o caducado), la sesión se cierra', function (\ArrayObject $cookies): void {
    $vout = new FakeVout();
    signIn(makeUser('revocada'), $vout, -60);
    $vout->onRefresh = static fn () => throw FakeVout::oauthError('invalid_grant');

    $res = refreshCall($vout);
    assertSame(401, $res->status());
    assertSame('session_expired', decode($res)['error']);
    assertSame(false, Session::has('vout_id'));
    $cleared = lastCookie($cookies, 'daino_refresh');
    assertTrue($cleared !== null && $cleared['value'] === '' && $cleared['expires'] < time(), 'y el refresh token muerto se borra');
});

sessionTest('sesión: sin refresh token no se pide renovar para siempre: la sesión caducada se cierra', function (): void {
    $vout = new FakeVout();
    signIn(makeUser('sin-vale'), $vout, -60, null);

    $res = refreshCall($vout);
    assertSame(401, $res->status());
    assertSame('session_expired', decode($res)['error']);
    assertSame(false, Session::has('vout_id'), 'la próxima carga dirá "sin sesión", no "renueva"');
    assertSame(0, $vout->refreshCalls);
});

sessionTest('sesión: el refresh token de otra persona no renueva esta sesión', function (): void {
    $vout = new FakeVout();
    $mine = makeUser('yo');
    $other = makeUser('otra');
    signIn($mine, $vout, -60);
    $vout->onRefresh = static fn () => $vout->grant($other->voutId, 'r2');

    assertSame(401, refreshCall($vout)->status());
    assertSame(false, Session::has('vout_id'));
});

// --------------------------- La ficha de usuario ---------------------------

sessionTest('sesión: la identidad es el vout_id, no un id que tras vaciar la base de datos puede ser de otro', function (): void {
    $vout = new FakeVout();
    $mine = makeUser('la-mia');
    $other = makeUser('ajena');
    signIn($mine, $vout, 3600);
    Session::set('user_id', $other->id);

    $body = decode(authController($vout)->meToken(Request::make('GET', '/api/me/token')));
    assertSame($mine->username, $body['user']['username']);
    assertSame($mine->id, Session::get('user_id'));
});

sessionTest('sesión: sin ficha local (base de datos vaciada) se rehace con el perfil de Vout', function (): void {
    $vout = new FakeVout();
    $user = makeUser('borrada');
    signIn($user, $vout, 3600);
    $user->delete();
    $vout->profile = ['vout_id' => $user->voutId, 'username' => 'de_vuelta', 'avatar' => null];

    $res = authController($vout)->meToken(Request::make('GET', '/api/me/token'));
    assertSame(200, $res->status(), 'antes: user_missing y sesión destruida');
    assertSame('de_vuelta', decode($res)['user']['username']);
    assertSame('de_vuelta', User::findByVoutId($user->voutId)?->username);
});

sessionTest('API: quien entra por el portal de Vout sin haber entrado nunca a Daino queda dado de alta', function (): void {
    $vout = new FakeVout();
    $voutId = '7b0e5c1a-1111-4222-8333-444455556666';
    $vout->profile = ['vout_id' => $voutId, 'name' => 'Nueva', 'username' => 'nueva_del_portal', 'avatar' => '/avatars/7.png'];
    $token = $vout->token($voutId);

    $res = apiAs($vout, $token);
    assertSame(200, $res->status(), 'antes: 401 user_missing y jugaba como anónima para siempre');
    assertSame('nueva_del_portal', decode($res)['user']['username']);
    assertSame('/avatars/7.png', User::findByVoutId($voutId)?->avatarUrl);

    apiAs($vout, $token);
    assertSame(1, $vout->profileCalls, 'el perfil se pide a Vout una vez; después ya hay ficha');
});

sessionTest('API: sin el perfil de Vout no se inventa un usuario', function (): void {
    $vout = new FakeVout();
    $voutId = '7b0e5c1a-aaaa-4bbb-8ccc-ddddeeeeffff';
    $token = $vout->token($voutId);

    $res = apiAs($vout, $token);          // Vout no da el perfil
    assertSame(401, $res->status());
    assertSame('user_missing', decode($res)['error']);
    assertSame(null, User::findByVoutId($voutId));

    $vout->profile = ['vout_id' => '00000000-0000-4000-8000-000000000000', 'username' => 'otra_persona'];
    assertSame(401, apiAs($vout, $token)->status(), 'un perfil que no es el del token no sirve');
    assertSame(null, User::findByVoutId($voutId));
});

// --------------------------- Lo que la API le dice al cliente ---------------------------

sessionTest('API: un token caducado pide renovar y no cuenta nada de dentro', function (): void {
    $vout = new FakeVout();
    $user = makeUser('caducada');

    withDebug('false', function () use ($vout, $user): void {
        foreach ([
            'caducado'          => $vout->token($user->voutId, -120),
            'de otro emisor'    => $vout->token($user->voutId, 3600, ['issuer' => 'https://otro.test']),
            'para otra app'     => $vout->token($user->voutId, 3600, ['audience' => 'otra-app']),
            'que no es un JWT'  => 'no-soy-un-token',
        ] as $case => $token) {
            $res = apiAs($vout, $token);
            assertSame(401, $res->status(), $case);
            assertSame(['error' => 'invalid_token', 'must_refresh' => true], decode($res), "{$case}: sin el motivo");
        }
    });

    assertSame(200, apiAs($vout, $vout->token($user->voutId))->status(), 'y uno bueno pasa');
});

sessionTest('API: si Vout no contesta y no hay claves guardadas es un 503, no un token inválido', function (): void {
    $vout = new FakeVout();
    $user = makeUser('sin-claves');
    $vout->jwksUp = false;

    $res = apiAs($vout, $vout->token($user->voutId));
    assertSame(503, $res->status(), 'un 401 haría al cliente renovar un token que es bueno');
    assertSame(['error' => 'idp_unavailable'], decode($res), 'sin la dirección interna de Vout');
});

// --------------------------- Claves públicas de Vout ---------------------------

sessionTest('claves: con Vout caído, una clave ya descargada sigue valiendo un día', function (): void {
    $vout = new FakeVout();
    $user = makeUser('claves');
    $token = $vout->token($user->voutId);

    $vout->verifier()->verify($token);
    assertSame(1, $vout->jwksFetches, 'primera vez: se descargan');
    $vout->verifier()->verify($token);
    assertSame(1, $vout->jwksFetches, 'caché fresca: sin red');

    $vout->ageCache(2 * 3600);            // caché caducada (TTL 1 h)…
    $vout->jwksUp = false;                // …y Vout no contesta
    $claims = $vout->verifier()->verify($token);
    assertSame($user->voutId, $claims['vout_id'], 'antes: todos los tokens pasaban a ser inválidos');

    $vout->ageCache(25 * 3600);
    assertThrows(JwksUnavailableException::class, static fn () => $vout->verifier()->verify($token));

    // De vuelta: una caché caducada se renueva.
    $vout->jwksUp = true;
    $before = $vout->jwksFetches;
    $vout->verifier()->verify($token);
    assertSame($before + 1, $vout->jwksFetches);
});
