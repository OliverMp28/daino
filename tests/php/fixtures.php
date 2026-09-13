<?php
declare(strict_types=1);

/**
 * Fixtures compartidas por los tests PHP. Cada *Test.php la incluye con
 * require_once; el runner solo carga los archivos que terminan en Test.php.
 */

use App\Controllers\Api\LevelApiController;
use App\Core\Request;
use App\Models\User;

// --------------------------- Fixtures ---------------------------

function makeUser(string $name = 'tester'): User
{
    return User::create([
        'vout_id'  => sprintf('%08x-0000-4000-8000-%012x', random_int(0, 0xFFFFFFFF), random_int(0, 0xFFFFFFFFFFFF)),
        'username' => $name . random_int(1000, 9999),
    ]);
}

function sha(string $seed): string
{
    return hash('sha256', $seed);
}

/**
 * @return array<string, mixed>
 */
function chartFor(string $audioSha, int $charterVersion = 1, int $events = 3): array
{
    $list = [];
    for ($i = 0; $i < $events; $i++) {
        $list[] = ['t' => 3.0 + $i * 0.8, 'type' => 'obstacle', 'kind' => 'CACTUS_SMALL'];
    }
    return [
        'formatVersion' => 1,
        'charter'       => ['name' => 'daino-charter', 'version' => $charterVersion],
        'seed'          => 1234,
        'audio'         => ['sha256' => $audioSha, 'durationSec' => 60.5, 'sampleRate' => 44100],
        'music'         => ['bpm' => 128.2, 'bpmConfidence' => 0.91, 'beatPeriodS' => 0.468],
        'world'         => ['speedPxS' => 437.5],
        'events'        => $list,
    ];
}

/**
 * @return array<string, mixed>
 */
function storeBody(string $audioSha, array $overrides = []): array
{
    return array_merge([
        'title'          => 'Canción de prueba',
        'audio_sha256'   => $audioSha,
        'difficulty'     => 3,
        'generator_seed' => '1234',
        'chart'          => chartFor($audioSha),
        'analysis'       => [
            'formatVersion' => 1,
            'analyzer'      => ['name' => 'daino-flux-js', 'version' => 1],
            'durationSec'   => 60.5, 'sampleRate' => 44100, 'bpm' => 128.2,
            'bpmConfidence' => 0.91, 'beatPeriodS' => 0.468,
            'onsets'        => [[3.0, 0.9], [3.8, 0.4]],
        ],
    ], $overrides);
}

function store(array $body): \App\Core\Response
{
    return (new LevelApiController())->store(Request::make('POST', '/api/levels', $body));
}

/**
 * @return array<string, mixed>
 */
function decode(\App\Core\Response $res): array
{
    return json_decode($res->body(), true, 512, JSON_THROW_ON_ERROR);
}
