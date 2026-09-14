<?php
declare(strict_types=1);

/**
 * Ola 4 en servidor: publicación diferida hasta el análisis, cola de trabajos,
 * endpoints de estado y reintento, y validación del análisis de formato 2.
 *
 * Tras el playtest de la Ola 5: publicar en dos pasos (analizar → listo; elegir
 * dificultad y confirmar) y un nivel publicado con una sola dificultad.
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
        $author = makeUser();
        $level = privateLevelWithChart($author);
        // Marca hecha jugando la versión privada: el nivel publicado se genera de
        // nuevo en el servidor, así que esa marca no es de su chart.
        \App\Models\Progress::upsert($author->id, $level->id, 100, 5000);
        \App\Models\Ranking::recompute($author->id);
        $result = PublishService::requestPublish($level, "levels/{$level->id}.mp3", $level->audioSha256);
        assertSame(null, \App\Models\Progress::findByUserAndLevel($author->id, $level->id), 'la marca de la versión privada no pasa al publicado');
        assertSame(0, \App\Models\Ranking::findByUser($author->id)->totalPoints, 'y el ranking global se recalcula sin ella');

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

// --------------------------- Publicar en dos pasos con dificultad elegida ---------------------------

/**
 * Variantes como las deja el worker: el chart de Automática y de cada
 * dificultad hasta el techo. Cada una con otra densidad (otro chart, otro hash).
 *
 * @return array<string, array<string, mixed>>
 */
function variantsFor(string $sha, int $ceiling): array
{
    $variants = [];
    foreach (['auto', ...range(1, $ceiling)] as $key) {
        $level = $key === 'auto' ? min(3, $ceiling) : $key;
        $chart = chartV2For($sha);
        $chart['difficulty'] = ['level' => $level, 'requested' => $key, 'ceiling' => $ceiling];
        $chart['world']['speedPxS'] = 400.0 + 10 * $level;
        for ($i = 0; $i < $level; $i++) {
            $chart['events'][] = ['t' => 30.0 + $i * 0.8, 'type' => 'obstacle', 'kind' => 'CACTUS_SMALL'];
        }
        $variants[(string) $key] = $chart;
    }
    return $variants;
}

/** Nivel propio que el worker acaba de analizar: listo para publicar, con variantes. */
function readyLevel(\App\Models\User $author, string $seed, int $ceiling): Level
{
    $level = privateLevelWithChart($author, $seed);
    $variants = variantsFor($level->audioSha256, $ceiling);
    $stmt = \App\Core\Database::getInstance()->prepare(
        'UPDATE levels SET file_path = :path, pending_public = FALSE, is_public = FALSE, difficulty_ceiling = :ceiling,
                chart_json = :chart, chart_variants_json = :variants, difficulty = :difficulty WHERE id = :id',
    );
    $stmt->execute([
        'path'       => "levels/{$level->id}.mp3",
        'ceiling'    => $ceiling,
        'chart'      => json_encode($variants['auto']),
        'variants'   => json_encode($variants),
        'difficulty' => min(3, $ceiling),
        'id'         => $level->id,
    ]);
    return Level::findById($level->id);
}

function changeDifficulty(Level $level, mixed $value): \App\Core\Response
{
    return (new LevelApiController())->changeDifficulty(Request::make('POST', '/', ['difficulty' => $value]), ['id' => (string) $level->id]);
}

function setVisibility(Level $level, bool $public): \App\Core\Response
{
    return (new LevelApiController())->visibility(Request::make('POST', '/', ['is_public' => $public]), ['id' => (string) $level->id]);
}

test('listo para publicar: su autor ve la elección entre Automática y lo que la canción admite; los demás, nada', function (): void {
    $author = makeUser('autor');
    $level = readyLevel($author, 'listo', 4);
    assertSame(true, $level->publishReady());

    $mine = LevelPresenter::one($level, $author);
    assertSame(true, $mine['publish_ready']);
    assertSame(false, $mine['is_public'], 'analizado NO es publicado: falta que su autor elija y confirme');
    assertSame(['requested' => 'auto', 'options' => [1, 2, 3, 4]], $mine['difficulty_choice']);

    $other = LevelPresenter::one($level, makeUser('otro'));
    assertSame([null, false], [$other['difficulty_choice'], $other['publish_ready']]);
});

test('dificultad: elegirla es instantáneo — el chart pasa a ser la variante que el servidor ya generó', function (): void {
    $author = makeUser();
    $level = readyLevel($author, 'variante', 4);
    AuthContext::set($author);
    $before = $level->chartHash;

    $res = changeDifficulty($level, 4);
    assertSame(200, $res->status());
    $data = decode($res)['level'];
    assertSame([4, ['requested' => 4, 'options' => [1, 2, 3, 4]], true], [$data['difficulty'], $data['difficulty_choice'], $data['publish_ready']]);

    $fresh = Level::findById($level->id);
    $expected = ChartValidator::validateChart(variantsFor($level->audioSha256, 4)['4'], $level->audioSha256)['json'];
    assertSame($expected, Level::findChart($level->id)['json'], 'el chart del nivel es exactamente la variante validada');
    assertSame(hash('sha256', $expected), $fresh->chartHash);
    assertTrue($fresh->chartHash !== $before, 'otro chart, otro hash: la caché del cliente no sirve el anterior');
    assertSame([4, 440], [$fresh->difficultyRequested, $fresh->gameSpeed]);
    assertSame(null, AnalysisJob::latestForLevel($level->id), 'sin cola ni espera: nada que re-chartear');

    assertSame(200, changeDifficulty($level, 'auto')->status());
    $auto = Level::findById($level->id);
    assertSame([null, 3], [$auto->difficultyRequested, $auto->difficulty], 'Automática se guarda como NULL y es Normal');
    assertSame(true, $auto->publishReady(), 'puede seguir cambiando hasta confirmar');
});

test('dificultad: no se puede pedir más de lo que la canción admite ni valores inventados', function (): void {
    $author = makeUser();
    $level = readyLevel($author, 'techo', 2);
    AuthContext::set($author);
    foreach ([3, 5, 0, 6, 'extremo', null, 2.5] as $bad) {
        assertThrows(ValidationException::class, fn () => changeDifficulty($level, $bad), function ($e) use ($bad): void {
            assertTrue(isset($e->fields['difficulty']), 'valor ' . json_encode($bad) . ': error en difficulty');
        });
    }
    assertSame(null, Level::findById($level->id)->difficultyRequested, 'nada se guarda si se rechaza');
    assertSame(200, changeDifficulty($level, 1)->status());
});

test('dificultad: un nivel publicado tiene una sola, ni siquiera para su autor', function (): void {
    $author = makeUser();
    $level = readyLevel($author, 'fija', 5);
    AuthContext::set($author);
    assertSame(200, changeDifficulty($level, 2)->status());
    assertSame(200, setVisibility(Level::findById($level->id), true)->status());

    $res = changeDifficulty(Level::findById($level->id), 5);
    assertSame(409, $res->status());
    assertSame('difficulty_fixed', decode($res)['error']);
    $public = Level::findById($level->id);
    assertSame([2, true, false], [$public->difficulty, $public->isPublic, $public->hasVariants]);
    assertSame(null, LevelPresenter::one($public, $author)['difficulty_choice'], 'publicado: no se ofrece a nadie');
    // Y la BD lo garantiza: un nivel público no puede conservar otras dificultades.
    assertThrows(\PDOException::class, fn () => \App\Core\Database::getInstance()->exec(
        "UPDATE levels SET chart_variants_json = '{}' WHERE id = {$level->id}",
    ));
});

test('dificultad: analizándose o sin analizar todavía no se elige; lo ajeno ni existe', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser('autor');
        $local = privateLevelWithChart($author, 'solo-local');
        AuthContext::set($author);
        $res = changeDifficulty($local, 3);
        assertSame([409, 'not_ready'], [$res->status(), decode($res)['error']], 'sin el análisis del servidor no se sabe qué admite');
        assertSame(null, LevelPresenter::one(Level::findById($local->id), $author)['difficulty_choice']);

        PublishService::requestPublish($local, "levels/{$local->id}.mp3", $local->audioSha256);
        $res = changeDifficulty(Level::findById($local->id), 3);
        assertSame([409, 'analyzing'], [$res->status(), decode($res)['error']]);

        $ready = readyLevel($author, 'ajeno', 5);
        AuthContext::set(makeUser('ajeno'));
        assertSame(404, changeDifficulty($ready, 3)->status());
    });
});

test('dificultad: cambiarla borra la marca de prueba de su autor (era de otro chart) y recalcula su ranking', function (): void {
    $author = makeUser();
    $level = readyLevel($author, 'prueba', 5);
    \App\Models\Progress::upsert($author->id, $level->id, 100, 9000);
    \App\Models\Ranking::recompute($author->id);
    AuthContext::set($author);

    assertSame(200, changeDifficulty($level, 1)->status());
    assertSame(null, \App\Models\Progress::findByUserAndLevel($author->id, $level->id), 'un 100 % en Relajado no puede estrenar el ranking de otro chart');
    assertSame(0, \App\Models\Ranking::findByUser($author->id)->totalPoints);

    // Elegir la que ya tiene no cambia el chart: la marca hecha con él se conserva.
    \App\Models\Progress::upsert($author->id, $level->id, 40, 3000);
    assertSame(200, changeDifficulty(Level::findById($level->id), 1)->status());
    assertTrue(\App\Models\Progress::findByUserAndLevel($author->id, $level->id) !== null, 'mismo chart, misma marca');
});

test('publicar un nivel listo: público al instante con la dificultad elegida y sin variantes; su marca de prueba vale', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser();
        $level = readyLevel($author, 'confirmar', 4);
        AuthContext::set($author);
        assertSame(200, changeDifficulty($level, 4)->status());
        \App\Models\Progress::upsert($author->id, $level->id, 70, 4000);

        $res = setVisibility(Level::findById($level->id), true);
        assertSame(200, $res->status(), 'no vuelve a pasar por la cola: ya se analizó');
        $data = decode($res);
        assertSame([true, false, 4, null], [$data['is_public'], $data['publish_ready'], $data['difficulty'], $data['difficulty_choice']]);
        $public = Level::findById($level->id);
        assertSame([false, null], [$public->hasVariants, AnalysisJob::latestForLevel($level->id)]);
        assertTrue(\App\Models\Progress::findByUserAndLevel($author->id, $level->id) !== null, 'se jugó con el chart que se publica');

        $listed = decode((new LevelApiController())->index(Request::make('GET', '/', [], ['scope' => 'public', 'limit' => '50'])))['items'];
        assertTrue(in_array($level->id, array_column($listed, 'id'), true), 'aparece en el catálogo');
    });
});

test('no publicar un nivel listo: vuelve a privado, sin audio en el servidor ni variantes', function (): void {
    withAnalyzer(true, function (): void {
        $author = makeUser();
        $level = readyLevel($author, 'renunciar', 3);
        AuthContext::set($author);
        $res = setVisibility($level, false);
        assertSame(200, $res->status());
        $fresh = Level::findById($level->id);
        assertSame([false, null, false, false], [$fresh->isPublic, $fresh->filePath, $fresh->hasVariants, $fresh->publishReady()]);
    });
});

test('el audio de un nivel listo lo descarga su autor para probarlo; nadie más', function (): void {
    $author = makeUser();
    $level = readyLevel($author, 'audio-privado', 3);
    $dir = \App\Services\FileUploadService::absolutePath("levels/{$level->id}.mp3");
    $bytes = 'ID3 audio de prueba ' . $level->id;
    file_put_contents($dir, $bytes);
    try {
        AuthContext::set(makeUser('curioso'));
        assertSame(404, (new LevelApiController())->streamFile(Request::make('GET', '/'), ['id' => (string) $level->id])->status());

        AuthContext::set($author);
        ob_start();
        try {
            (new LevelApiController())->streamFile(Request::make('GET', '/'), ['id' => (string) $level->id]);
        } finally {
            $out = ob_get_clean();
        }
        assertSame($bytes, $out);
    } finally {
        @unlink($dir);
    }
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
