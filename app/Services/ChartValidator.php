<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\ValidationException;

/**
 * ChartValidator — valida charts y análisis que llegan del cliente (Ola 3).
 *
 * En la Ola 3 el chart lo genera el navegador de quien juega y lo sube con
 * `POST /api/levels`. Cuando ese nivel se publica, el mismo chart se sirve a
 * TODOS los demás jugadores. El servidor no puede fiarse de él: podría venir
 * truncado, gigante, con NaN, con millones de eventos o manipulado.
 *
 * Reparto de responsabilidades (defensa en profundidad):
 *   - Aquí, ESTRUCTURA y LÍMITES: tamaño, tipos, rangos, número de eventos,
 *     coherencia con el audio declarado. Lo que protege al servidor y garantiza
 *     que lo guardado es un chart con forma de chart.
 *   - En el cliente (`chartFormat.js::normalizeChart`), SEMÁNTICA del juego:
 *     qué kinds existen, cómo interpretar eventos futuros. El registro de
 *     obstáculos vive en el frontend y no se duplica aquí; un kind desconocido
 *     se descarta al cargar sin romper la partida.
 *
 * Mantener sincronizado con `resources/js/game/levels/chartFormat.js` y
 * `analyze.js` (versiones de formato y límites).
 *
 * Devuelve siempre el JSON RE-CODIFICADO a partir de lo validado, nunca el
 * texto original: así no se persisten campos ni formatos que no se hayan
 * inspeccionado.
 */
final class ChartValidator
{
    public const CHART_FORMAT_VERSION = 1;

    /**
     * 1 = analizador JS del navegador (bpm + onsets). 2 = analizador del servidor
     * (Ola 4): el 1 más beats, downbeats, secciones, energía y rasgos.
     */
    public const ANALYSIS_FORMAT_VERSIONS = [1, 2];

    public const MAX_BEATS = 30_000;
    public const MAX_SECTIONS = 200;
    private const SECTION_ROLES = ['intro', 'verse', 'chorus', 'bridge', 'break', 'outro'];

    /** @var array<string, array{0: int|float, 1: int|float}> */
    private const FEATURE_RANGES = [
        'tempoStability'     => [0, 1],
        'beatSupport'        => [0, 1],
        'percussiveRatio'    => [0, 1],
        'eventsPerMin'       => [0, 10000],
        'strongEventsPerMin' => [0, 10000],
        'loudnessDbfs'       => [-200, 10],
        'dynamicRangeDb'     => [0, 200],
        'silenceRatio'       => [0, 1],
    ];

    /** Techo del chart codificado. Una canción de 20 min ronda los 60 KB. */
    public const CHART_MAX_BYTES = 256 * 1024;

    /** Techo del análisis. ~15 bytes por onset; 20 min de música densa ≈ 400 KB. */
    public const ANALYSIS_MAX_BYTES = 1024 * 1024;

    public const MAX_EVENTS = 20_000;
    public const MAX_ONSETS = 60_000;
    public const MAX_DURATION_SEC = 7200;

    private const JSON_FLAGS = JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION;

    /**
     * @param mixed       $chart          Chart decodificado del body JSON.
     * @param string|null $expectedSha256 Hash del audio al que dice pertenecer el nivel.
     * @return array{json: string, charterVersion: int, durationSec: float, speedPxS: float, bpm: float}
     */
    public static function validateChart(mixed $chart, ?string $expectedSha256): array
    {
        $f = 'chart';
        if (!is_array($chart) || array_is_list($chart)) {
            self::fail($f, 'Debe ser un objeto.');
        }

        $formatVersion = $chart['formatVersion'] ?? null;
        if ($formatVersion !== self::CHART_FORMAT_VERSION) {
            self::fail($f, 'formatVersion no soportado.');
        }

        $charter = $chart['charter'] ?? null;
        if (!is_array($charter) || !is_string($charter['name'] ?? null) || strlen($charter['name']) > 64
            || !is_int($charter['version'] ?? null) || $charter['version'] < 1 || $charter['version'] > 65535) {
            self::fail($f, 'charter inválido.');
        }

        $seed = $chart['seed'] ?? null;
        if (!is_int($seed) || $seed < -2147483648 || $seed > 2147483647) {
            self::fail($f, 'seed debe ser un entero de 32 bits.');
        }

        $audio = $chart['audio'] ?? null;
        if (!is_array($audio)) {
            self::fail($f, 'audio ausente.');
        }
        $durationSec = self::number($audio['durationSec'] ?? null, $f, 'audio.durationSec', 0.001, self::MAX_DURATION_SEC);
        $sampleRate = self::number($audio['sampleRate'] ?? null, $f, 'audio.sampleRate', 8000, 192000);
        $sha = $audio['sha256'] ?? null;
        if ($sha !== null && (!is_string($sha) || preg_match('/^[0-9a-f]{64}$/', $sha) !== 1)) {
            self::fail($f, 'audio.sha256 con formato inválido.');
        }
        // Un chart solo vale para el audio con el que se generó.
        if ($expectedSha256 !== null && $sha !== $expectedSha256) {
            self::fail($f, 'El chart no corresponde a este audio.');
        }

        $music = $chart['music'] ?? null;
        if (!is_array($music)) {
            self::fail($f, 'music ausente.');
        }
        $bpm = self::number($music['bpm'] ?? null, $f, 'music.bpm', 20, 400);
        $bpmConfidence = self::number($music['bpmConfidence'] ?? null, $f, 'music.bpmConfidence', -1, 10);
        $beatPeriodS = self::number($music['beatPeriodS'] ?? null, $f, 'music.beatPeriodS', 0.1, 3);

        $world = $chart['world'] ?? null;
        if (!is_array($world)) {
            self::fail($f, 'world ausente.');
        }
        $speedPxS = self::number($world['speedPxS'] ?? null, $f, 'world.speedPxS', 50, 2000);

        $events = $chart['events'] ?? null;
        if (!is_array($events) || !array_is_list($events)) {
            self::fail($f, 'events debe ser una lista.');
        }
        if (count($events) > self::MAX_EVENTS) {
            self::fail($f, 'Demasiados eventos.');
        }

        $cleanEvents = [];
        $prevT = -INF;
        foreach ($events as $i => $e) {
            if (!is_array($e) || array_is_list($e)) {
                self::fail($f, "events[{$i}] no es un objeto.");
            }
            $t = self::number($e['t'] ?? null, $f, "events[{$i}].t", 0, $durationSec);
            if ($t < $prevT) {
                self::fail($f, 'events debe estar ordenado por t.');
            }
            $prevT = $t;

            $type = $e['type'] ?? null;
            if (!is_string($type) || preg_match('/^[a-z][a-z_]{0,31}$/', $type) !== 1) {
                self::fail($f, "events[{$i}].type inválido.");
            }
            $clean = ['t' => $t, 'type' => $type];
            if ($type === 'obstacle') {
                $kind = $e['kind'] ?? null;
                if (!is_string($kind) || preg_match('/^[A-Z][A-Z0-9_]{0,31}$/', $kind) !== 1) {
                    self::fail($f, "events[{$i}].kind inválido.");
                }
                $clean['kind'] = $kind;
            }
            // Tipos futuros (section, mode, fx…) se aceptan con sus campos
            // escalares, sin anidar: el cliente los ignora si no los conoce.
            foreach ($e as $key => $value) {
                if (isset($clean[$key]) || !is_string($key) || preg_match('/^[a-zA-Z][a-zA-Z0-9]{0,31}$/', $key) !== 1) {
                    continue;
                }
                if (is_string($value) && strlen($value) <= 64) {
                    $clean[$key] = $value;
                } elseif ((is_int($value) || is_float($value)) && is_finite((float) $value)) {
                    $clean[$key] = $value;
                } elseif (is_bool($value)) {
                    $clean[$key] = $value;
                }
            }
            $cleanEvents[] = $clean;
        }

        $normalized = [
            'formatVersion' => self::CHART_FORMAT_VERSION,
            'charter'       => ['name' => $charter['name'], 'version' => $charter['version']],
            'seed'          => $seed,
            'audio'         => ['sha256' => $sha, 'durationSec' => $durationSec, 'sampleRate' => $sampleRate],
            'music'         => ['bpm' => $bpm, 'bpmConfidence' => $bpmConfidence, 'beatPeriodS' => $beatPeriodS],
            'world'         => ['speedPxS' => $speedPxS],
            'events'        => $cleanEvents,
        ];

        $json = json_encode($normalized, self::JSON_FLAGS);
        if (strlen($json) > self::CHART_MAX_BYTES) {
            self::fail($f, 'El chart es demasiado grande.');
        }

        return [
            'json'           => $json,
            'charterVersion' => $charter['version'],
            'durationSec'    => $durationSec,
            'speedPxS'       => $speedPxS,
            'bpm'            => $bpm,
        ];
    }

    /**
     * @param mixed $analysis Análisis decodificado del body JSON.
     * @return string JSON re-codificado.
     */
    public static function validateAnalysis(mixed $analysis): string
    {
        $f = 'analysis';
        if (!is_array($analysis) || array_is_list($analysis)) {
            self::fail($f, 'Debe ser un objeto.');
        }
        $formatVersion = $analysis['formatVersion'] ?? null;
        if (!in_array($formatVersion, self::ANALYSIS_FORMAT_VERSIONS, true)) {
            self::fail($f, 'formatVersion no soportado.');
        }
        $analyzer = $analysis['analyzer'] ?? null;
        if (!is_array($analyzer) || !is_string($analyzer['name'] ?? null) || strlen($analyzer['name']) > 64
            || !is_int($analyzer['version'] ?? null)) {
            self::fail($f, 'analyzer inválido.');
        }
        $cleanAnalyzer = ['name' => $analyzer['name'], 'version' => $analyzer['version']];
        if (isset($analyzer['models'])) {
            $models = $analyzer['models'];
            if (!is_array($models) || array_is_list($models) || count($models) > 8) {
                self::fail($f, 'analyzer.models inválido.');
            }
            $cleanAnalyzer['models'] = [];
            foreach ($models as $k => $v) {
                if (!is_string($k) || preg_match('/^[a-zA-Z]{1,32}$/', $k) !== 1 || !is_string($v) || strlen($v) > 64) {
                    self::fail($f, 'analyzer.models inválido.');
                }
                $cleanAnalyzer['models'][$k] = $v;
            }
        }

        $durationSec = self::number($analysis['durationSec'] ?? null, $f, 'durationSec', 0.001, self::MAX_DURATION_SEC);
        $sampleRate = self::number($analysis['sampleRate'] ?? null, $f, 'sampleRate', 8000, 192000);
        $bpm = self::number($analysis['bpm'] ?? null, $f, 'bpm', 20, 400);
        $bpmConfidence = self::number($analysis['bpmConfidence'] ?? null, $f, 'bpmConfidence', -1, 10);
        $beatPeriodS = self::number($analysis['beatPeriodS'] ?? null, $f, 'beatPeriodS', 0.1, 3);

        $onsets = $analysis['onsets'] ?? null;
        if (!is_array($onsets) || !array_is_list($onsets) || count($onsets) > self::MAX_ONSETS) {
            self::fail($f, 'onsets inválido.');
        }
        $clean = [];
        foreach ($onsets as $i => $pair) {
            if (!is_array($pair) || count($pair) !== 2 || !array_is_list($pair)) {
                self::fail($f, "onsets[{$i}] debe ser [t, fuerza].");
            }
            $clean[] = [
                self::number($pair[0], $f, "onsets[{$i}][0]", 0, $durationSec + 1),
                self::number($pair[1], $f, "onsets[{$i}][1]", 0, 1),
            ];
        }

        $normalized = [
            'formatVersion' => $formatVersion,
            'analyzer'      => $cleanAnalyzer,
            'durationSec'   => $durationSec,
            'sampleRate'    => $sampleRate,
            'bpm'           => $bpm,
            'bpmConfidence' => $bpmConfidence,
            'beatPeriodS'   => $beatPeriodS,
            'onsets'        => $clean,
        ];
        if ($formatVersion === 2) {
            $normalized += self::validateAnalysisV2($analysis, $durationSec, count($clean));
        }
        $json = json_encode($normalized, self::JSON_FLAGS);

        if (strlen($json) > self::ANALYSIS_MAX_BYTES) {
            self::fail($f, 'El análisis es demasiado grande.');
        }
        return $json;
    }

    /**
     * Campos del formato 2 (analizador del servidor, Ola 4). Mismas reglas que
     * `analyzer/daino_analyzer/schema.py`: lo que allí pasa, aquí pasa.
     *
     * @param array<string, mixed> $a
     * @return array<string, mixed>
     */
    private static function validateAnalysisV2(array $a, float $duration, int $onsetCount): array
    {
        $f = 'analysis';
        $out = [];

        $colors = $a['onsetColor'] ?? null;
        if (!is_array($colors) || !array_is_list($colors) || count($colors) !== $onsetCount) {
            self::fail($f, 'onsetColor debe ser paralelo a onsets.');
        }
        $out['onsetColor'] = [];
        foreach ($colors as $i => $c) {
            if (!is_array($c) || !array_is_list($c) || count($c) !== 3) {
                self::fail($f, "onsetColor[{$i}] debe ser [grave, medio, agudo].");
            }
            $out['onsetColor'][] = array_map(static fn ($v) => self::number($v, $f, "onsetColor[{$i}]", 0, 1), $c);
        }

        foreach (['beats', 'downbeats'] as $key) {
            $list = $a[$key] ?? null;
            if (!is_array($list) || !array_is_list($list) || count($list) > self::MAX_BEATS) {
                self::fail($f, "{$key} inválido.");
            }
            $prev = -INF;
            $out[$key] = [];
            foreach ($list as $i => $t) {
                $t = self::number($t, $f, "{$key}[{$i}]", 0, $duration + 0.001);
                if ($t <= $prev) {
                    self::fail($f, "{$key} debe ser estrictamente creciente.");
                }
                $prev = $t;
                $out[$key][] = $t;
            }
        }

        $meter = $a['meter'] ?? null;
        if ($meter !== null && (!is_int($meter) || $meter < 2 || $meter > 12)) {
            self::fail($f, 'meter debe ser nulo o un entero de 2 a 12.');
        }
        $out['meter'] = $meter;

        $sections = $a['sections'] ?? null;
        if (!is_array($sections) || !array_is_list($sections) || count($sections) > self::MAX_SECTIONS) {
            self::fail($f, 'sections inválido.');
        }
        $out['sections'] = [];
        foreach ($sections as $i => $s) {
            if (!is_array($s) || array_is_list($s)) {
                self::fail($f, "sections[{$i}] no es un objeto.");
            }
            $start = self::number($s['startSec'] ?? null, $f, "sections[{$i}].startSec", 0, $duration);
            $end = self::number($s['endSec'] ?? null, $f, "sections[{$i}].endSec", 0, $duration + 0.001);
            $cluster = $s['cluster'] ?? null;
            $role = $s['role'] ?? null;
            if ($end <= $start || !is_string($cluster) || preg_match('/^[A-Z]{1,2}$/', $cluster) !== 1
                || !in_array($role, self::SECTION_ROLES, true)) {
                self::fail($f, "sections[{$i}] inválida.");
            }
            $out['sections'][] = [
                'startSec' => $start,
                'endSec'   => $end,
                'cluster'  => $cluster,
                'role'     => $role,
                'energy'   => self::number($s['energy'] ?? null, $f, "sections[{$i}].energy", 0, 1),
                'density'  => self::number($s['density'] ?? null, $f, "sections[{$i}].density", 0, 1000),
            ];
        }

        $energy = $a['energy'] ?? null;
        $values = is_array($energy) ? ($energy['values'] ?? null) : null;
        if (!is_array($values) || !array_is_list($values) || count($values) > (int) (self::MAX_DURATION_SEC * 10 + 10)) {
            self::fail($f, 'energy inválido.');
        }
        $out['energy'] = [
            'hopSec' => self::number($energy['hopSec'] ?? null, $f, 'energy.hopSec', 0.01, 10),
            'values' => array_map(static fn ($v) => self::number($v, $f, 'energy.values', 0, 1), $values),
        ];

        $features = $a['features'] ?? null;
        if (!is_array($features) || array_is_list($features) || !is_bool($features['pulseDoubled'] ?? null)) {
            self::fail($f, 'features inválido.');
        }
        $out['features'] = ['pulseDoubled' => $features['pulseDoubled']];
        foreach (self::FEATURE_RANGES as $key => [$lo, $hi]) {
            $out['features'][$key] = self::number($features[$key] ?? null, $f, "features.{$key}", $lo, $hi);
        }
        return $out;
    }

    /**
     * Número finito dentro de [min, max]. JSON no admite NaN/Infinity, pero se
     * comprueba igual: el body puede venir de un cliente no-navegador.
     */
    private static function number(mixed $value, string $field, string $path, float $min, float $max): float
    {
        if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value)) {
            self::fail($field, "{$path} debe ser un número.");
        }
        $v = (float) $value;
        if ($v < $min || $v > $max) {
            self::fail($field, "{$path} fuera de rango.");
        }
        return $v;
    }

    private static function fail(string $field, string $message): never
    {
        throw new ValidationException([$field => $message]);
    }
}
