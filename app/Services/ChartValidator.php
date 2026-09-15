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
    /** Formato que genera el charter actual (Ola 5). */
    public const CHART_FORMAT_VERSION = 2;

    /**
     * 1 = charter de las Olas 3-4 (velocidad constante). 2 = charter musical
     * (Ola 5): cambios de velocidad, pulso, dificultad y eventos de estructura.
     */
    public const CHART_FORMAT_VERSIONS = [1, 2];

    public const MAX_SPEED_CHANGES = 400;
    private const MAX_RAMP_S = 10;

    /**
     * 1 = analizador JS del navegador (bpm + onsets). 2 = analizador del servidor
     * (Ola 4): el 1 más beats, downbeats, secciones, energía y rasgos. Desde la
     * versión 2 del analizador, además (opcionales en el formato): percusividad de
     * cada onset, energía por bandas, tonalidad por sección y el bloque `tonal`.
     */
    public const ANALYSIS_FORMAT_VERSIONS = [1, 2];

    public const MAX_BEATS = 30_000;
    public const MAX_SECTIONS = 200;
    public const MAX_CHORDS = 40_000;
    public const MAX_MODULATIONS = 200;
    private const BAND_NAMES = ['low', 'mid', 'high'];
    private const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
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
        if (!in_array($formatVersion, self::CHART_FORMAT_VERSIONS, true)) {
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
            'formatVersion' => $formatVersion,
            'charter'       => ['name' => $charter['name'], 'version' => $charter['version']],
            'seed'          => $seed,
            'audio'         => ['sha256' => $sha, 'durationSec' => $durationSec, 'sampleRate' => $sampleRate],
            'music'         => ['bpm' => $bpm, 'bpmConfidence' => $bpmConfidence, 'beatPeriodS' => $beatPeriodS],
            'world'         => ['speedPxS' => $speedPxS],
            'events'        => $cleanEvents,
        ];
        if ($formatVersion === 2) {
            self::addChartV2($normalized, $chart, $music, $world, $durationSec);
        }

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
     * Campos opcionales del chart de formato 2 (Ola 5). Mismas reglas que
     * `chartFormat.js::normalizeChart`, pero aquí lo mal formado se rechaza: en
     * el cliente se descarta con aviso, en el servidor no se persiste.
     *
     * @param array<string, mixed> $normalized
     * @param array<string, mixed> $chart
     * @param array<string, mixed> $music
     * @param array<string, mixed> $world
     */
    private static function addChartV2(array &$normalized, array $chart, array $music, array $world, float $durationSec): void
    {
        $f = 'chart';
        foreach (['beats', 'downbeats'] as $key) {
            if (!array_key_exists($key, $music)) {
                continue;
            }
            $list = $music[$key];
            if (!is_array($list) || !array_is_list($list) || count($list) > self::MAX_BEATS) {
                self::fail($f, "music.{$key} inválido.");
            }
            $prev = -INF;
            $clean = [];
            foreach ($list as $i => $t) {
                $t = self::number($t, $f, "music.{$key}[{$i}]", 0, $durationSec + 0.001);
                if ($t <= $prev) {
                    self::fail($f, "music.{$key} debe ser estrictamente creciente.");
                }
                $prev = $t;
                $clean[] = $t;
            }
            $normalized['music'][$key] = $clean;
        }

        if (array_key_exists('speedChanges', $world)) {
            $changes = $world['speedChanges'];
            if (!is_array($changes) || !array_is_list($changes) || count($changes) > self::MAX_SPEED_CHANGES) {
                self::fail($f, 'world.speedChanges inválido.');
            }
            $prev = -INF;
            $clean = [];
            foreach ($changes as $i => $c) {
                if (!is_array($c) || array_is_list($c)) {
                    self::fail($f, "world.speedChanges[{$i}] no es un objeto.");
                }
                $t = self::number($c['t'] ?? null, $f, "world.speedChanges[{$i}].t", 0, $durationSec);
                if ($t < $prev) {
                    self::fail($f, 'world.speedChanges debe estar ordenado por t.');
                }
                $prev = $t;
                $clean[] = [
                    't'        => $t,
                    'speedPxS' => self::number($c['speedPxS'] ?? null, $f, "world.speedChanges[{$i}].speedPxS", 50, 2000),
                    'rampS'    => self::number($c['rampS'] ?? 0, $f, "world.speedChanges[{$i}].rampS", 0, self::MAX_RAMP_S),
                ];
            }
            $normalized['world']['speedChanges'] = $clean;
        }

        if (array_key_exists('difficulty', $chart) && $chart['difficulty'] !== null) {
            $d = $chart['difficulty'];
            $level = is_array($d) ? ($d['level'] ?? null) : null;
            $requested = is_array($d) ? ($d['requested'] ?? 'auto') : null;
            $ceiling = is_array($d) ? ($d['ceiling'] ?? null) : null;
            if (!is_int($level) || $level < 1 || $level > 5
                || !($requested === 'auto' || (is_int($requested) && $requested >= 1 && $requested <= 5))
                || !($ceiling === null || (is_int($ceiling) && $ceiling >= 1 && $ceiling <= 5))) {
                self::fail($f, 'difficulty inválida.');
            }
            $normalized['difficulty'] = ['level' => $level, 'requested' => $requested, 'ceiling' => $ceiling];
        }
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

        // Analizador 2: opcionales (los análisis de la versión 1 no los tienen).
        if (array_key_exists('onsetPercussive', $a)) {
            $perc = $a['onsetPercussive'];
            if (!is_array($perc) || !array_is_list($perc) || count($perc) !== $onsetCount) {
                self::fail($f, 'onsetPercussive debe ser paralelo a onsets.');
            }
            $out['onsetPercussive'] = array_map(static fn ($v) => self::number($v, $f, 'onsetPercussive', 0, 1), $perc);
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
            $section = [
                'startSec' => $start,
                'endSec'   => $end,
                'cluster'  => $cluster,
                'role'     => $role,
                'energy'   => self::number($s['energy'] ?? null, $f, "sections[{$i}].energy", 0, 1),
                'density'  => self::number($s['density'] ?? null, $f, "sections[{$i}].density", 0, 1000),
            ];
            if (array_key_exists('key', $s)) {
                $section['key'] = self::keyLabel($s['key'], $f, "sections[{$i}].key");
                $section['keyConfidence'] = self::number($s['keyConfidence'] ?? null, $f, "sections[{$i}].keyConfidence", 0, 1);
            }
            $out['sections'][] = $section;
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
        if (array_key_exists('bands', $energy)) {
            $bands = $energy['bands'];
            $names = is_array($bands) ? array_keys($bands) : [];
            sort($names);
            if (!is_array($bands) || array_is_list($bands) || $names !== ['high', 'low', 'mid']) {
                self::fail($f, 'energy.bands debe tener low, mid y high.');
            }
            $out['energy']['bands'] = [];
            foreach (self::BAND_NAMES as $name) {
                $curve = $bands[$name];
                if (!is_array($curve) || !array_is_list($curve) || count($curve) !== count($values)) {
                    self::fail($f, "energy.bands.{$name} debe ser paralela a energy.values.");
                }
                $out['energy']['bands'][$name] = array_map(static fn ($v) => self::number($v, $f, "energy.bands.{$name}", 0, 1), $curve);
            }
            $levels = $energy['bandLevelDb'] ?? null;
            if (!is_array($levels) || !array_is_list($levels) || count($levels) !== 3) {
                self::fail($f, 'energy.bandLevelDb debe tener 3 niveles.');
            }
            $levels = array_map(static fn ($v) => self::number($v, $f, 'energy.bandLevelDb', -120, 0), $levels);
            if (max($levels) < -5.0) {
                self::fail($f, 'energy.bandLevelDb: la banda más fuerte no puede quedar por debajo de −5 dB.');
            }
            $out['energy']['bandLevelDb'] = $levels;
        }

        $features = $a['features'] ?? null;
        if (!is_array($features) || array_is_list($features) || !is_bool($features['pulseDoubled'] ?? null)) {
            self::fail($f, 'features inválido.');
        }
        $out['features'] = ['pulseDoubled' => $features['pulseDoubled']];
        foreach (self::FEATURE_RANGES as $key => [$lo, $hi]) {
            $out['features'][$key] = self::number($features[$key] ?? null, $f, "features.{$key}", $lo, $hi);
        }

        if (array_key_exists('tonal', $a)) {
            $out['tonal'] = self::validateTonal($a['tonal'], $duration);
        }
        return $out;
    }

    /**
     * Armonía (analizador 2): afinación, tonalidad, acordes y modulaciones.
     *
     * @return array<string, mixed>
     */
    private static function validateTonal(mixed $t, float $duration): array
    {
        $f = 'analysis';
        if (!is_array($t) || array_is_list($t)) {
            self::fail($f, 'tonal debe ser un objeto.');
        }
        $out = [
            'tuningCents'   => self::number($t['tuningCents'] ?? null, $f, 'tonal.tuningCents', -50, 50),
            'key'           => self::keyLabel($t['key'] ?? null, $f, 'tonal.key'),
            'keyConfidence' => self::number($t['keyConfidence'] ?? null, $f, 'tonal.keyConfidence', 0, 1),
            'chords'        => [],
        ];

        $chords = $t['chords'] ?? null;
        if (!is_array($chords) || !array_is_list($chords) || $chords === [] || count($chords) > self::MAX_CHORDS) {
            self::fail($f, 'tonal.chords debe ser una lista acotada y no vacía.');
        }
        $chordLabels = self::chordLabels();
        $prevT = -INF;
        $prevLabel = null;
        foreach ($chords as $i => $c) {
            if (!is_array($c) || !array_is_list($c) || count($c) !== 2) {
                self::fail($f, "tonal.chords[{$i}] debe ser [t, etiqueta].");
            }
            $time = self::number($c[0], $f, "tonal.chords[{$i}][0]", 0, $duration + 0.001);
            if ($time <= $prevT || !in_array($c[1], $chordLabels, true) || $c[1] === $prevLabel) {
                self::fail($f, "tonal.chords[{$i}] inválido.");
            }
            $prevT = $time;
            $prevLabel = $c[1];
            $out['chords'][] = [$time, $c[1]];
        }
        if ($out['chords'][0][0] !== 0.0) {
            self::fail($f, 'tonal.chords debe empezar en 0.');
        }

        $out['chordConfidence'] = self::number($t['chordConfidence'] ?? null, $f, 'tonal.chordConfidence', 0, 1);
        $out['harmonicRhythm'] = self::number($t['harmonicRhythm'] ?? null, $f, 'tonal.harmonicRhythm', 0, 64);

        $mods = $t['modulations'] ?? null;
        if (!is_array($mods) || !array_is_list($mods) || count($mods) > self::MAX_MODULATIONS) {
            self::fail($f, 'tonal.modulations debe ser una lista acotada.');
        }
        $out['modulations'] = [];
        $prevT = 0.0;
        foreach ($mods as $i => $m) {
            if (!is_array($m) || array_is_list($m)) {
                self::fail($f, "tonal.modulations[{$i}] no es un objeto.");
            }
            $time = self::number($m['t'] ?? null, $f, "tonal.modulations[{$i}].t", 0, $duration + 0.001);
            $semitones = $m['semitones'] ?? null;
            if ($time <= $prevT || !is_int($semitones) || $semitones < -5 || $semitones > 6) {
                self::fail($f, "tonal.modulations[{$i}] inválida.");
            }
            $prevT = $time;
            $out['modulations'][] = [
                't'         => $time,
                'key'       => self::keyLabel($m['key'] ?? null, $f, "tonal.modulations[{$i}].key"),
                'semitones' => $semitones,
            ];
        }
        return $out;
    }

    private static function keyLabel(mixed $value, string $field, string $path): string
    {
        if (!is_string($value) || !in_array($value, self::keyLabels(), true)) {
            self::fail($field, "{$path} no es una tonalidad conocida.");
        }
        return $value;
    }

    /** @return list<string> "C major" … "B minor" (sintaxis de mir_eval, como el analizador). */
    private static function keyLabels(): array
    {
        $out = [];
        foreach (['major', 'minor'] as $mode) {
            foreach (self::NOTE_NAMES as $note) {
                $out[] = "{$note} {$mode}";
            }
        }
        return $out;
    }

    /** @return list<string> "C:maj" … "B:min" y "N" (sin acorde). */
    private static function chordLabels(): array
    {
        $out = [];
        foreach (['maj', 'min'] as $quality) {
            foreach (self::NOTE_NAMES as $note) {
                $out[] = "{$note}:{$quality}";
            }
        }
        $out[] = 'N';
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
