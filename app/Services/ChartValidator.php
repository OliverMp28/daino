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
    public const ANALYSIS_FORMAT_VERSION = 1;

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
        if (($analysis['formatVersion'] ?? null) !== self::ANALYSIS_FORMAT_VERSION) {
            self::fail($f, 'formatVersion no soportado.');
        }
        $analyzer = $analysis['analyzer'] ?? null;
        if (!is_array($analyzer) || !is_string($analyzer['name'] ?? null) || strlen($analyzer['name']) > 64
            || !is_int($analyzer['version'] ?? null)) {
            self::fail($f, 'analyzer inválido.');
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

        $json = json_encode([
            'formatVersion' => self::ANALYSIS_FORMAT_VERSION,
            'analyzer'      => ['name' => $analyzer['name'], 'version' => $analyzer['version']],
            'durationSec'   => $durationSec,
            'sampleRate'    => $sampleRate,
            'bpm'           => $bpm,
            'bpmConfidence' => $bpmConfidence,
            'beatPeriodS'   => $beatPeriodS,
            'onsets'        => $clean,
        ], self::JSON_FLAGS);

        if (strlen($json) > self::ANALYSIS_MAX_BYTES) {
            self::fail($f, 'El análisis es demasiado grande.');
        }
        return $json;
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
