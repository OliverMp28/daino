<?php
declare(strict_types=1);

/**
 * Ola 4 en servidor: publicación diferida hasta el análisis, cola de trabajos,
 * endpoints de estado y reintento, y validación del análisis de formato 2.
 */

use App\Controllers\Api\LevelApiController;
use App\Core\AuthContext;
use App\Core\Request;
use App\Core\ValidationException;
use App\Models\AnalysisJob;
use App\Models\Level;
use App\Services\ChartValidator;
use App\Services\LevelPresenter;
use App\Services\PublishService;

require_once __DIR__ . '/fixtures.php';

function withAnalyzer(bool $enabled, callable $fn): void
{
    $previous = $_ENV['ANALYZER_ENABLED'] ?? null;
    $_ENV['ANALYZER_ENABLED'] = $enabled ? 'true' : 'false';
    try {
        $fn();
    } finally {
        if ($previous === null) {
            unset($_ENV['ANALYZER_ENABLED']);
        } else {
            $_ENV['ANALYZER_ENABLED'] = $previous;
        }
    }
}

function privateLevelWithChart(\App\Models\User $user, string $seed = 'queue'): Level
{
    AuthContext::set($user);
    $id = decode(store(storeBody(sha($seed))))['id'];
    return Level::findById($id);
}

/**
 * @return array<string, mixed>
 */
function analysisV2(float $duration = 60.5): array
{
    $beats = [];
    for ($t = 0.5; $t < $duration - 1; $t += 0.5) {
        $beats[] = round($t, 3);
    }
    return [
        'formatVersion' => 2,
        'analyzer'      => ['name' => 'daino-mir-py', 'version' => 1, 'models' => ['beats' => 'beat_this:final0']],
        'durationSec'   => $duration, 'sampleRate' => 44100, 'bpm' => 120.0, 'bpmConfidence' => 0.98, 'beatPeriodS' => 0.5,
        'onsets'        => [[3.0, 0.9], [3.5, 0.4]],
        'onsetColor'    => [[0.3, 0.3, 0.4], [0.1, 0.2, 0.7]],
        'beats'         => $beats,
        'downbeats'     => array_values(array_filter($beats, static fn (int $i) => $i % 4 === 0, ARRAY_FILTER_USE_KEY)),
        'meter'         => 4,
        'sections'      => [['startSec' => 0.0, 'endSec' => $duration, 'cluster' => 'A', 'role' => 'verse', 'energy' => 0.7, 'density' => 2.5]],
        'energy'        => ['hopSec' => 0.1, 'values' => array_fill(0, 605, 0.5)],
        'features'      => ['tempoStability' => 0.98, 'beatSupport' => 0.9, 'pulseDoubled' => false, 'percussiveRatio' => 0.4,
                            'eventsPerMin' => 180.0, 'strongEventsPerMin' => 90.0, 'loudnessDbfs' => -14.2,
                            'dynamicRangeDb' => 12.0, 'silenceRatio' => 0.01],
    ];
}

// --------------------------- Publicación ---------------------------

test('con analizador, publicar deja el nivel pendiente y encola su análisis (no público todavía)', function (): void {
    withAnalyzer(true, function (): void {
        $level = privateLevelWithChart(makeUser());
        $result = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256);

        assertSame(false, $result['published']);
        $fresh = Level::findById($level->id);
        assertSame(false, $fresh->isPublic, 'no aparece en el catálogo hasta estar analizado');
        assertSame(true, $fresh->pendingPublic);
        assertSame("levels/{$level->id}.mp3", $fresh->filePath);

        $job = AnalysisJob::latestForLevel($level->id);
        assertSame('queued', $job->status);
        assertSame(AnalysisJob::PRIORITY_INTERACTIVE, $job->priority);
        assertSame($level->audioSha256, $job->audioSha256);

        $community = decode((new LevelApiController())->index(Request::make('GET', '/', [], ['scope' => 'community', 'limit' => '50'])))['items'];
        assertTrue(!in_array($level->id, array_column($community, 'id'), true), 'un pendiente no se lista');
    });
});

test('sin analizador, publicar es inmediato como en la Ola 3 (el sistema degrada, no se rompe)', function (): void {
    withAnalyzer(false, function (): void {
        $level = privateLevelWithChart(makeUser(), 'sin-analizador');
        $result = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256);
        assertSame(true, $result['published']);
        assertSame(true, Level::findById($level->id)->isPublic);
        assertSame(null, AnalysisJob::latestForLevel($level->id));
    });
});

test('volver a publicar cancela el trabajo anterior: nunca hay dos activos', function (): void {
    withAnalyzer(true, function (): void {
        $level = privateLevelWithChart(makeUser(), 'dos-veces');
        $first = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256)['job'];
        $second = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256)['job'];
        assertSame('cancelled', AnalysisJob::findById($first->id)->status);
        assertSame('queued', AnalysisJob::findById($second->id)->status);
    });
});

test('retirar un nivel pendiente cancela su análisis y lo deja privado sin audio', function (): void {
    withAnalyzer(true, function (): void {
        $level = privateLevelWithChart(makeUser(), 'retirar');
        $job = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256)['job'];
        PublishService::unpublish(Level::findById($level->id));

        assertSame('cancelled', AnalysisJob::findById($job->id)->status);
        $fresh = Level::findById($level->id);
        assertSame([false, false, null], [$fresh->isPublic, $fresh->pendingPublic, $fresh->filePath]);
    });
});

test('la BD impide un pendiente sin audio o ya público', function (): void {
    $level = privateLevelWithChart(makeUser(), 'check');
    $pdo = \App\Core\Database::getInstance();
    assertThrows(\PDOException::class, fn () => $pdo->exec("UPDATE levels SET pending_public = TRUE, file_path = NULL WHERE id = {$level->id}"));
});

// --------------------------- Endpoints ---------------------------

test('GET /analysis: el autor ve el progreso y su posición en la cola; los demás, 404', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser('autor');
        $level = privateLevelWithChart($author, 'estado');
        PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256);

        AuthContext::set($author);
        $data = decode((new LevelApiController())->analysisStatus(Request::make('GET', '/'), ['id' => (string) $level->id]));
        assertSame('queued', $data['analysis']['status']);
        assertTrue(is_int($data['analysis']['queue_position']), 'posición en la cola');
        assertSame(true, $data['pending_public']);
        assertSame(null, $data['analysis']['error']);

        AuthContext::set(makeUser('curioso'));
        $res = (new LevelApiController())->analysisStatus(Request::make('GET', '/'), ['id' => (string) $level->id]);
        assertSame(404, $res->status());
    });
});

test('la posición en la cola respeta prioridad y orden de llegada', function (): void {
    $user = makeUser();
    $a = privateLevelWithChart($user, 'cola-a');
    $b = privateLevelWithChart($user, 'cola-b');
    $background = AnalysisJob::enqueue($a->id, 'levels/a.mp3', null, AnalysisJob::PURPOSE_BACKFILL, AnalysisJob::PRIORITY_BACKGROUND);
    $interactive = AnalysisJob::enqueue($b->id, 'levels/b.mp3', null, AnalysisJob::PURPOSE_PUBLISH, AnalysisJob::PRIORITY_INTERACTIVE);
    assertTrue($interactive->queuePosition() < $background->queuePosition(), 'lo que espera una persona va por delante');
});

test('POST /analysis reintenta un análisis fallido, y rechaza uno ya activo', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser();
        $level = privateLevelWithChart($author, 'reintento');
        $job = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256)['job'];
        $ctrl = new LevelApiController();

        $busy = $ctrl->retryAnalysis(Request::make('POST', '/'), ['id' => (string) $level->id]);
        assertSame(409, $busy->status());
        assertSame('already_active', decode($busy)['error']);

        \App\Core\Database::getInstance()->exec("UPDATE analysis_jobs SET status = 'failed', error_code = 'decode_failed', error_message = 'ffmpeg: Error opening input file /srv/daino/storage/uploads/levels/9.mp3' WHERE id = {$job->id}");
        \App\Core\Database::getInstance()->exec("UPDATE levels SET pending_public = FALSE WHERE id = {$level->id}");
        $raw = $ctrl->analysisStatus(Request::make('GET', '/'), ['id' => (string) $level->id]);
        assertSame(['code' => 'decode_failed'], decode($raw)['analysis']['error']);
        assertTrue(!str_contains($raw->body(), '/srv/daino'), 'el mensaje del worker (rutas internas, salida de ffmpeg) no sale por la API');

        $retry = $ctrl->retryAnalysis(Request::make('POST', '/'), ['id' => (string) $level->id]);
        assertSame(202, $retry->status());
        assertSame('queued', decode($retry)['analysis']['status']);
        assertSame(true, Level::findById($level->id)->pendingPublic, 'reintentar vuelve a pedir la publicación');
    });
});

test('visibility=true no puede saltarse el análisis con el analizador activo', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser();
        $level = privateLevelWithChart($author, 'atajo');
        \App\Core\Database::getInstance()->exec("UPDATE levels SET file_path = 'levels/{$level->id}.mp3' WHERE id = {$level->id}");
        $res = (new LevelApiController())->visibility(Request::make('POST', '/', ['is_public' => true]), ['id' => (string) $level->id]);
        assertSame(202, $res->status());
        assertSame(false, Level::findById($level->id)->isPublic);
        assertSame('queued', AnalysisJob::latestForLevel($level->id)->status);
    });
});

test('la tarjeta enseña el estado del análisis solo a su autor', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser();
        $level = privateLevelWithChart($author, 'tarjeta-analisis');
        PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256);
        $fresh = Level::findById($level->id);

        $mine = LevelPresenter::one($fresh, $author);
        assertSame('queued', $mine['analysis']['status']);
        assertSame(true, $mine['pending_public']);
        assertSame(null, LevelPresenter::one($fresh, makeUser('otro'))['analysis']);
    });
});

test('el chart_hash de un nivel cambia con su chart (la caché del cliente no sirve uno viejo)', function (): void {
    $level = privateLevelWithChart(makeUser(), 'hash');
    $before = Level::findById($level->id)->chartHash;
    assertTrue(is_string($before) && strlen($before) === 64, 'hash al crear');
    $s = $level->audioSha256;
    $level->updateChart(ChartValidator::validateChart(chartFor($s, 1, 7), $s)['json'], null, 1);
    $after = Level::findById($level->id)->chartHash;
    assertTrue($after !== $before, 'misma versión del charter, otro chart: otro hash');
    assertSame(hash('sha256', Level::findChart($level->id)['json']), $after);
});

// --------------------------- Análisis de formato 2 ---------------------------

test('ChartValidator acepta un análisis de formato 2 y conserva sus hechos ricos', function (): void {
    $input = analysisV2();
    $decoded = json_decode(ChartValidator::validateAnalysis($input), true);
    assertSame(2, $decoded['formatVersion']);
    assertSame('beat_this:final0', $decoded['analyzer']['models']['beats']);
    assertSame(count($input['beats']), count($decoded['beats']));
    assertSame(count($input['downbeats']), count($decoded['downbeats']));
    assertSame('verse', $decoded['sections'][0]['role']);
    assertSame(false, $decoded['features']['pulseDoubled']);
});

test('ChartValidator rechaza análisis de formato 2 incoherentes', function (): void {
    $cases = [
        'color no paralelo'      => static fn (array $a) => array_merge($a, ['onsetColor' => [[0.3, 0.3, 0.4]]]),
        'beats desordenados'     => static fn (array $a) => array_merge($a, ['beats' => [2.0, 1.0]]),
        'beat tras el final'     => static fn (array $a) => array_merge($a, ['beats' => [1.0, 999.0]]),
        'compás absurdo'         => static fn (array $a) => array_merge($a, ['meter' => 40]),
        'rol inventado'          => static fn (array $a) => array_replace_recursive($a, ['sections' => [0 => ['role' => 'drop']]]),
        'energía fuera de rango' => static fn (array $a) => array_replace_recursive($a, ['energy' => ['values' => [0 => 3.0]]]),
        'rasgo ausente'          => static function (array $a) { unset($a['features']['beatSupport']); return $a; },
        'formato futuro'         => static fn (array $a) => array_merge($a, ['formatVersion' => 3]),
    ];
    foreach ($cases as $label => $mutate) {
        assertThrows(ValidationException::class, fn () => ChartValidator::validateAnalysis($mutate(analysisV2())), function ($e) use ($label): void {
            assertTrue(isset($e->fields['analysis']), "{$label}: error en analysis");
        });
    }
});
