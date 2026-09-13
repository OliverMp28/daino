<?php
declare(strict_types=1);

/**
 * Limpieza de los duplicados que dejó el defecto D1 (antes de la Ola 3).
 * La BD de desarrollo puede tener duplicados reales: cada test filtra el plan
 * por los usuarios que él mismo crea.
 */

use App\Core\Database;
use App\Models\Level;
use App\Models\Progress;
use App\Models\Ranking;
use App\Services\LegacyLevelDeduper;

require_once __DIR__ . '/fixtures.php';

/**
 * @param array<string, mixed> $extra
 */
function legacyLevel(\App\Models\User $user, string $title, array $extra = []): Level
{
    $level = Level::create(array_merge([
        'user_id' => $user->id, 'title' => $title, 'duration_sec' => 40, 'bpm' => 144,
        'difficulty' => 3, 'generator_seed' => '1',
    ], $extra));
    return $level;
}

/**
 * @return list<array{user_id: int, title: string, keeper: int, duplicates: list<int>}>
 */
function planFor(\App\Models\User ...$users): array
{
    $ids = array_map(static fn ($u) => $u->id, $users);
    return array_values(array_filter(LegacyLevelDeduper::plan(), static fn ($g) => in_array($g['user_id'], $ids, true)));
}

test('dedupe: limpia extensiones repetidas del título y nada más', function (): void {
    assertSame('Sugar Red', LegacyLevelDeduper::cleanTitle('Sugar Red.mp3.mp3'));
    assertSame('Instrumental', LegacyLevelDeduper::cleanTitle('Instrumental.MP3'));
    assertSame('Mi canción v2.0', LegacyLevelDeduper::cleanTitle('Mi canción v2.0'));
    assertSame('.mp3', LegacyLevelDeduper::cleanTitle('.mp3'), 'un título que solo es la extensión no se vacía');
});

test('dedupe: agrupa por usuario, título limpio, duración y BPM; se queda la publicada', function (): void {
    $user = makeUser('dup');
    $other = makeUser('otro');
    $a = legacyLevel($user, 'Sugar Red.mp3.mp3');
    $public = legacyLevel($user, 'Sugar Red.mp3');
    $public->setPublic(true, 'levels/x.mp3');
    $c = legacyLevel($user, 'sugar red.mp3.mp3');                 // mayúsculas distintas: mismo nivel
    legacyLevel($user, 'Sugar Red.mp3', ['duration_sec' => 41]);    // otra duración: no es el mismo
    legacyLevel($other, 'Sugar Red.mp3.mp3');                       // otro usuario: no se fusiona
    legacyLevel($user, 'Sugar Red', ['audio_sha256' => sha('nuevo')]); // posterior a la Ola 3: intocable

    $plan = planFor($user, $other);
    assertSame(1, count($plan), 'un único grupo');
    assertSame($public->id, $plan[0]['keeper'], 'se queda la publicada aunque no sea la más antigua');
    $dups = $plan[0]['duplicates'];
    sort($dups);
    assertSame([$a->id, $c->id], $dups);
    assertSame('Sugar Red', $plan[0]['title']);
});

test('dedupe: fusiona la mejor marca con su fecha, mueve comentarios y corrige el ranking', function (): void {
    $user = makeUser('rank');
    $friend = makeUser('amigo');
    $keeper = legacyLevel($user, 'Instrumental.mp3', ['duration_sec' => 175, 'bpm' => 141]);
    $d1 = legacyLevel($user, 'Instrumental.mp3.mp3', ['duration_sec' => 175, 'bpm' => 141]);
    $d2 = legacyLevel($user, 'Instrumental.mp3.mp3', ['duration_sec' => 175, 'bpm' => 141]);

    $pdo = Database::getInstance();
    $at = static fn (int $userId, int $levelId, string $date) => $pdo
        ->prepare('UPDATE progress SET best_run_at = ? WHERE user_id = ? AND level_id = ?')
        ->execute([$date, $userId, $levelId]);

    Progress::upsert($user->id, $keeper->id, 3, 546);
    $at($user->id, $keeper->id, '2026-07-08 04:01:38');
    Progress::upsert($user->id, $d1->id, 18, 3223);
    $at($user->id, $d1->id, '2026-07-08 04:03:06');
    Progress::upsert($user->id, $d2->id, 25, 390);                  // menos puntos pero más porcentaje
    Progress::upsert($friend->id, $d2->id, 50, 999);                 // otro jugador en un duplicado
    Ranking::recompute($user->id);
    assertSame(3, Ranking::findByUser($user->id)->levelsPlayed, 'antes: cada duplicado contaba como un nivel');

    $pdo->prepare('INSERT INTO comments (user_id, level_id, body) VALUES (?, ?, ?)')->execute([$friend->id, $d1->id, 'bien']);

    $report = LegacyLevelDeduper::apply(planFor($user));

    assertSame(2, $report['levels_deleted']);
    assertSame(1, $report['comments_moved']);
    assertSame(null, Level::findById($d1->id));
    assertSame('Instrumental', Level::findById($keeper->id)->title);

    $mine = Progress::findByUserAndLevel($user->id, $keeper->id);
    assertSame(3223, $mine->points, 'la mejor partida sobrevive');
    assertSame(25, $mine->percentage, 'y el mejor porcentaje, aunque viniera de otra fila');
    assertSame('2026-07-08 04:03:06', $mine->bestRunAt, 'con la fecha en que se logró esa marca');
    assertSame(999, Progress::findByUserAndLevel($friend->id, $keeper->id)->points, 'la marca de otro jugador también pasa');

    assertSame(1, Ranking::findByUser($user->id)->levelsPlayed, 'después: un nivel');
    assertSame(3223, Ranking::findByUser($user->id)->totalPoints);

    $stmt = $pdo->prepare('SELECT level_id FROM comments WHERE user_id = ?');
    $stmt->execute([$friend->id]);
    assertSame($keeper->id, (int) $stmt->fetchColumn());
});

test('dedupe: es idempotente; la segunda pasada no encuentra nada', function (): void {
    $user = makeUser('idem');
    legacyLevel($user, 'Canción.mp3');
    legacyLevel($user, 'Canción.mp3.mp3');
    LegacyLevelDeduper::apply(planFor($user));
    assertSame([], planFor($user));
});
