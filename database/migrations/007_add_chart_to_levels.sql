-- Chart persistido e identidad del audio en `levels` (Ola 3).
--
-- Hasta aquí un nivel solo guardaba metadata + `generator_seed`, y el chart se
-- regeneraba desde el MP3 en cada partida. Esta migración convierte el chart
-- en un artefacto de primera clase: se guarda una vez, se sirve tal cual y el
-- jugador no vuelve a analizar.
--
-- Columnas:
--   audio_sha256        Identidad del audio por sus bytes. Clave de deduplicado
--                       (defecto D1: rejugar ya no crea filas), ETag del
--                       archivo, y la garantía de que el MP3 que se publica es
--                       el mismo para el que se generó el chart.
--   duration_ms         `duration_sec INT` pierde la precisión que el chart usa.
--   bpm_exact           `bpm SMALLINT` pierde el decimal del tempo detectado.
--   game_speed          Congelada con el chart: si se retunea SPEED_BY_BPM,
--                       los niveles publicados no cambian de velocidad.
--   chart_json          El chart (formato en resources/js/game/levels/chartFormat.js).
--                       ~2-3 KB por minuto de canción.
--   analysis_json       Los hechos musicales del análisis. Permiten regenerar el
--                       chart con un charter mejor sin volver a analizar.
--   chart_status        Estado del pipeline. La Ola 4 usará 'analyzing' y
--                       'failed' cuando el análisis pase al servidor.
--   chart_version       Versión del charter que generó el chart: localiza los
--                       charts obsoletos con una consulta.
--   difficulty_ceiling  Techo de dificultad que admite la canción (Ola 4).
--   is_official         Nivel del catálogo de fábrica (Olas 2 y 4).
--
-- MEDIUMTEXT y no JSON: en MariaDB `JSON` es un alias de LONGTEXT con CHECK
-- JSON_VALID; aquí se declara igual pero con un techo de 16 MB, de sobra.

ALTER TABLE levels
    ADD COLUMN duration_ms        INT UNSIGNED        NULL AFTER duration_sec,
    ADD COLUMN bpm_exact          DECIMAL(6,2)        NULL AFTER bpm,
    ADD COLUMN game_speed         SMALLINT UNSIGNED   NULL AFTER bpm_exact,
    ADD COLUMN audio_sha256       CHAR(64)            NULL AFTER file_path,
    ADD COLUMN chart_json         MEDIUMTEXT          NULL,
    ADD COLUMN analysis_json      MEDIUMTEXT          NULL,
    ADD COLUMN chart_status       ENUM('none', 'analyzing', 'ready', 'failed') NOT NULL DEFAULT 'none',
    ADD COLUMN chart_version      SMALLINT UNSIGNED   NULL,
    ADD COLUMN difficulty_ceiling TINYINT UNSIGNED    NULL,
    ADD COLUMN is_official        BOOLEAN             NOT NULL DEFAULT FALSE,
    ADD COLUMN updated_at         TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Un usuario tiene como mucho un nivel por audio. NULL no colisiona, así
    -- que las filas anteriores a esta migración (sin hash) conviven sin tocar.
    ADD UNIQUE KEY uniq_levels_user_audio (user_id, audio_sha256),

    ADD CONSTRAINT chk_levels_sha_format
        CHECK (audio_sha256 IS NULL OR audio_sha256 REGEXP '^[0-9a-f]{64}$'),
    ADD CONSTRAINT chk_levels_chart_json
        CHECK (chart_json IS NULL OR JSON_VALID(chart_json)),
    ADD CONSTRAINT chk_levels_analysis_json
        CHECK (analysis_json IS NULL OR JSON_VALID(analysis_json)),
    -- Red de seguridad del pipeline: 'ready' sin chart sería un nivel que
    -- promete jugarse y no puede.
    ADD CONSTRAINT chk_levels_chart_ready
        CHECK (chart_status <> 'ready' OR (chart_json IS NOT NULL AND chart_version IS NOT NULL)),
    ADD CONSTRAINT chk_levels_difficulty_ceiling
        CHECK (difficulty_ceiling IS NULL OR difficulty_ceiling BETWEEN 1 AND 5);
