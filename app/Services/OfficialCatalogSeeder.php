<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\ValidationException;
use App\Models\Level;
use JsonException;

/**
 * Siembra el catálogo de niveles oficiales (Ola 2).
 *
 *     docker compose exec -T php composer seed:official
 *     docker compose exec -T php composer seed:official -- --from=docs/legacy/audios
 *
 * Entradas:
 *   - `database/seeds/official/manifest.json`   qué niveles hay (slug, archivo, título).
 *   - `database/seeds/official/baked/<slug>.json` audio sha256 + chart + análisis,
 *     producidos por `bun run bake:official` con el mismo analizador y charter
 *     que el navegador.
 *   - `storage/official/<archivo>`             el MP3 (gitignored). Con `--from`
 *     se copia desde otro directorio.
 *
 * Idempotente: la clave es `levels.official_slug`. Volver a sembrar actualiza la
 * metadata (título, artista, dificultad) de la misma fila.
 *
 * El CHART de un oficial ya sembrado no se sustituye salvo con `--rechart`:
 * los jugadores tienen marcas registradas sobre él, y cambiarlo en silencio las
 * dejaría comparando partidas de niveles distintos. Tampoco se sustituye el
 * audio sin su chart: un chart solo vale para el audio con el que se generó.
 *
 * Un archivo que falta o no coincide con su horneado NO aborta el resto: se
 * informa y se sigue. Un despliegue sin algunos MP3 debe seguir sembrando los
 * que sí tiene.
 */
final class OfficialCatalogSeeder
{
    public const RESULT_CREATED  = 'created';
    public const RESULT_UPDATED  = 'updated';
    public const RESULT_SAME     = 'unchanged';
    public const RESULT_RECHART  = 'recharted';
    public const RESULT_SKIPPED  = 'skipped';

    private const SLUG_PATTERN = '/^[a-z0-9][a-z0-9-]{0,63}$/';

    /**
     * @param string        $seedDir   Directorio con manifest.json y baked/.
     * @param string        $audioDir  Destino de los MP3 (storage/official).
     * @param callable|null $log       fn(string): void
     */
    public function __construct(
        private readonly string $seedDir,
        private readonly string $audioDir,
        private $log = null,
    ) {
    }

    /**
     * @param array{from?: ?string, rechart?: bool} $opts
     * @return list<array{slug: string, result: string, detail: string, level_id: ?int}>
     */
    public function run(array $opts = []): array
    {
        $from = $opts['from'] ?? null;
        $rechart = $opts['rechart'] ?? false;

        $manifest = $this->readJson($this->seedDir . '/manifest.json');
        $entries = $manifest['levels'] ?? null;
        if (!is_array($entries) || !array_is_list($entries)) {
            throw new \RuntimeException('manifest.json: `levels` debe ser una lista.');
        }

        $report = [];
        $seen = [];
        foreach ($entries as $i => $entry) {
            $slug = is_array($entry) && is_string($entry['slug'] ?? null) ? $entry['slug'] : "#{$i}";
            try {
                if (isset($seen[$slug])) {
                    throw new SeedSkip('slug repetido en el manifiesto');
                }
                $seen[$slug] = true;
                $report[] = ['slug' => $slug] + $this->seedOne($entry, $from, $rechart);
            } catch (SeedSkip $e) {
                $report[] = ['slug' => $slug, 'result' => self::RESULT_SKIPPED, 'detail' => $e->getMessage(), 'level_id' => null];
            }
            $last = $report[count($report) - 1];
            $this->say(sprintf('  %-9s %-26s %s', $last['result'], $slug, $last['detail']));
        }
        return $report;
    }

    /**
     * @param mixed $entry
     * @return array{result: string, detail: string, level_id: ?int}
     */
    private function seedOne(mixed $entry, ?string $from, bool $rechart): array
    {
        [$slug, $file, $title, $artist, $scene] = $this->parseEntry($entry);

        $bakedPath = "{$this->seedDir}/baked/{$slug}.json";
        if (!is_file($bakedPath)) {
            throw new SeedSkip('sin horneado: ejecuta `bun run bake:official`');
        }
        $baked = $this->readJson($bakedPath);
        $sha = $baked['audio']['sha256'] ?? null;
        if (($baked['slug'] ?? null) !== $slug || ($baked['file'] ?? null) !== $file || !is_string($sha)
            || preg_match('/^[0-9a-f]{64}$/', $sha) !== 1) {
            throw new SeedSkip('horneado desactualizado respecto al manifiesto: vuelve a hornear');
        }

        $this->ensureAudio($file, $sha, $from);

        try {
            $chart = ChartValidator::validateChart($baked['chart'] ?? null, $sha);
            $analysisJson = ChartValidator::validateAnalysis($baked['analysis'] ?? null);
        } catch (ValidationException $e) {
            throw new SeedSkip('horneado inválido: ' . implode('; ', $e->fields));
        }
        $difficulty = $baked['difficulty'] ?? null;
        if (!is_int($difficulty) || $difficulty < 1 || $difficulty > 5) {
            throw new SeedSkip('horneado sin dificultad válida');
        }
        // Techo de dificultad (Ola 4): solo existe con análisis del servidor.
        $ceiling = $baked['difficultyCeiling'] ?? null;
        if ($ceiling !== null && (!is_int($ceiling) || $ceiling < 1 || $ceiling > 5)) {
            throw new SeedSkip('horneado con techo de dificultad inválido');
        }
        // Escenario Automático (T02.5): el ambiente que propone el reparto por cómo
        // suena la canción. Un horneado anterior no lo trae: la Cordillera.
        $sceneAuto = $baked['sceneAuto'] ?? null;
        if ($sceneAuto !== null && (!is_string($sceneAuto) || !SceneCatalog::isSelectable($sceneAuto))) {
            throw new SeedSkip('horneado con un escenario automático que no es un ambiente elegible');
        }

        // Identidad de los efectos (T03.3): la paleta y la firma que le pegan a la
        // canción. Un horneado anterior no la trae: lo de siempre.
        try {
            $fxAuto = FxIdentity::encode(FxIdentity::parse($baked['fxAuto'] ?? null));
        } catch (\InvalidArgumentException $e) {
            throw new SeedSkip('horneado con una identidad de efectos mal formada: ' . $e->getMessage());
        }

        $audioColumns = [
            'audio_sha256'   => $sha,
            'duration_sec'   => max(1, (int) round($chart['durationSec'])),
            'duration_ms'    => (int) round($chart['durationSec'] * 1000),
            'bpm'            => max(30, min(300, (int) round($chart['bpm']))),
            'bpm_exact'      => round($chart['bpm'], 2),
            'game_speed'     => (int) round($chart['speedPxS']),
            'generator_seed' => (string) (json_decode($chart['json'], true)['seed'] ?? 0),
            'chart_json'     => $chart['json'],
            'analysis_json'  => $analysisJson,
            'chart_version'  => $chart['charterVersion'],
            'difficulty_ceiling' => $ceiling,
        ];
        $metadata = [
            'title'      => $title,
            'artist'     => $artist,
            'difficulty' => $difficulty,
            'file_path'  => FileUploadService::OFFICIAL_PREFIX . $file,
            'scene'      => $scene,
            'scene_auto' => $sceneAuto,
            'fx_auto'    => $fxAuto,
        ];

        $level = Level::findOfficialBySlug($slug);
        if ($level === null) {
            $level = Level::create($audioColumns + $metadata + [
                'user_id'       => null,
                'is_public'     => true,
                'is_official'   => true,
                'official_slug' => $slug,
            ]);
            return ['result' => self::RESULT_CREATED, 'detail' => "{$difficulty}★, " . $this->eventCount($chart['json']) . ' eventos', 'level_id' => $level->id];
        }

        $chartChanged = $level->audioSha256 !== $sha || (Level::findChart($level->id)['json'] ?? null) !== $chart['json'];
        if ($chartChanged && !$rechart) {
            // El audio en disco es el del horneado nuevo, pero la fila conserva
            // el hash anterior: el cargador del cliente lo detecta y rechaza el
            // audio (no se juega desincronizado). Hay que decidirlo a propósito.
            // Lo que solo se ve (título, artista, escenario) sí se aplica.
            $level->updateMetadata(['title' => $title, 'artist' => $artist, 'scene' => $scene, 'scene_auto' => $sceneAuto, 'fx_auto' => $fxAuto]);
            throw new SeedSkip($level->audioSha256 !== $sha
                ? 'el audio cambió: usa --rechart para sustituir audio y chart (invalida la comparación de marcas)'
                : 'hay un chart nuevo: usa --rechart para aplicarlo (invalida la comparación de marcas)');
        }

        if ($chartChanged) {
            $level->replaceAudioAndChart($audioColumns);
            $level->updateMetadata($metadata);
            return ['result' => self::RESULT_RECHART, 'detail' => 'audio/chart sustituidos', 'level_id' => $level->id];
        }

        // Mismo chart: un análisis más rico (otra versión del analizador) se guarda
        // igual. No cambia lo que se juega, así que no afecta a ninguna marca.
        $details = [];
        if ($level->updateMetadata($metadata)) {
            $details[] = 'metadata actualizada';
        }
        if ($level->updateAnalysis($analysisJson)) {
            $details[] = 'análisis actualizado';
        }
        return [
            'result'   => $details !== [] ? self::RESULT_UPDATED : self::RESULT_SAME,
            'detail'   => implode(', ', $details),
            'level_id' => $level->id,
        ];
    }

    /**
     * @return array{0: string, 1: string, 2: string, 3: ?string, 4: ?string}
     */
    private function parseEntry(mixed $entry): array
    {
        if (!is_array($entry)) {
            throw new SeedSkip('entrada del manifiesto no es un objeto');
        }
        $slug = $entry['slug'] ?? null;
        $file = $entry['file'] ?? null;
        $title = $entry['title'] ?? null;
        $artist = $entry['artist'] ?? null;
        // T02: escenario del oficial (un ambiente o su historia de autor); sin él,
        // Automático. Que exista en el registro del juego lo vigila un test JS.
        $scene = $entry['scene'] ?? null;
        if (!is_string($slug) || preg_match(self::SLUG_PATTERN, $slug) !== 1) {
            throw new SeedSkip('slug inválido');
        }
        // Solo un nombre de archivo, sin rutas: el audio vive en su directorio.
        if (!is_string($file) || $file === '' || basename($file) !== $file || !str_ends_with(strtolower($file), '.mp3')) {
            throw new SeedSkip('file debe ser un nombre de archivo .mp3 sin ruta');
        }
        if (!is_string($title) || $title === '' || mb_strlen($title) > 120) {
            throw new SeedSkip('title obligatorio, máximo 120 caracteres');
        }
        if ($artist !== null && (!is_string($artist) || mb_strlen($artist) > 120)) {
            throw new SeedSkip('artist debe ser null o texto de hasta 120 caracteres');
        }
        if ($scene !== null && (!is_string($scene) || !SceneCatalog::isValidId($scene))) {
            throw new SeedSkip('scene debe ser null o el id de una escena (minúsculas, cifras y guiones)');
        }
        return [$slug, $file, $title, $artist === '' ? null : $artist, $scene];
    }

    /**
     * Deja el MP3 en su sitio y comprueba que es EXACTAMENTE el horneado.
     */
    private function ensureAudio(string $file, string $expectedSha, ?string $from): void
    {
        $target = "{$this->audioDir}/{$file}";

        if ($from !== null && is_file("{$from}/{$file}")) {
            $sourceSha = hash_file('sha256', "{$from}/{$file}");
            if ($sourceSha !== $expectedSha) {
                throw new SeedSkip("el MP3 de --from no es el horneado (sha {$this->short($sourceSha)} ≠ {$this->short($expectedSha)})");
            }
            if (!is_file($target) || hash_file('sha256', $target) !== $expectedSha) {
                if (!is_dir($this->audioDir) && !mkdir($this->audioDir, 0755, true) && !is_dir($this->audioDir)) {
                    throw new \RuntimeException("No se pudo crear {$this->audioDir}");
                }
                if (!copy("{$from}/{$file}", $target)) {
                    throw new SeedSkip("no se pudo copiar a {$target}");
                }
            }
        }

        if (!is_file($target)) {
            throw new SeedSkip("falta el MP3: copia \"{$file}\" a storage/official/ o usa --from");
        }
        $actual = hash_file('sha256', $target);
        if ($actual !== $expectedSha) {
            throw new SeedSkip("storage/official/{$file} no es el horneado (sha {$this->short((string) $actual)} ≠ {$this->short($expectedSha)})");
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function readJson(string $path): array
    {
        $raw = @file_get_contents($path);
        if ($raw === false) {
            throw new \RuntimeException("No se pudo leer {$path}");
        }
        try {
            $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new \RuntimeException("{$path}: JSON inválido ({$e->getMessage()})");
        }
        if (!is_array($data)) {
            throw new \RuntimeException("{$path}: se esperaba un objeto");
        }
        return $data;
    }

    private function eventCount(string $chartJson): int
    {
        return count(json_decode($chartJson, true)['events'] ?? []);
    }

    private function short(string $sha): string
    {
        return substr($sha, 0, 10);
    }

    private function say(string $line): void
    {
        if ($this->log !== null) {
            ($this->log)($line);
        }
    }
}
