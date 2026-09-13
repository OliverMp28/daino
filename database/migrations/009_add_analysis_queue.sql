-- Análisis en servidor (Ola 4): cola de trabajos, caché de análisis por audio y
-- publicación diferida hasta que el análisis termina.
--
-- 1. analysis_jobs — la cola.
--    En MariaDB y no en un servicio aparte (Redis, un API HTTP del analizador):
--    - Durable: reiniciar el analizador o el servidor no pierde trabajos.
--    - Transaccional: PHP encola en la MISMA transacción en que guarda el MP3;
--      nunca hay un audio subido sin trabajo ni un trabajo sin audio.
--    - Escala horizontal: N workers reclaman con `FOR UPDATE SKIP LOCKED`
--      (MariaDB ≥ 10.6) y cada trabajo lo coge exactamente uno.
--    - Tolerante a caídas: el worker renueva `lease_until` mientras trabaja; si
--      muere, la reserva caduca y otro lo retoma (hasta `max_attempts`).
--
-- 2. audio_analyses — caché de análisis por (hash del audio, analizador).
--    La misma canción subida por varias personas se analiza UNA vez; cambiar
--    el analizador de versión la vuelve a analizar.
--
-- 3. levels.pending_public — "publícalo cuando esté analizado". Al publicar, el
--    nivel no aparece en el catálogo hasta que el servidor lo ha analizado: todo
--    nivel público se juega con el chart del analizador del servidor.
--
-- 4. levels.chart_hash — hash del chart guardado. El cliente cachea charts por
--    nivel y versión del charter; si el servidor sustituye un chart por otro de
--    la MISMA versión (otro analizador), la caché serviría el viejo.

CREATE TABLE analysis_jobs (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    level_id        BIGINT UNSIGNED NULL,
    audio_path      VARCHAR(500) NOT NULL,
    audio_sha256    CHAR(64) NULL,
    purpose         ENUM('publish', 'backfill', 'reanalyze') NOT NULL DEFAULT 'publish',
    status          ENUM('queued', 'running', 'done', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    priority        TINYINT NOT NULL DEFAULT 0,
    attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts    TINYINT UNSIGNED NOT NULL DEFAULT 3,
    stage           VARCHAR(32) NULL,
    progress        DECIMAL(4, 3) NOT NULL DEFAULT 0,
    error_code      VARCHAR(40) NULL,
    error_message   VARCHAR(500) NULL,
    worker_id       VARCHAR(80) NULL,
    lease_until     DATETIME(3) NULL,
    run_after       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at      DATETIME(3) NULL,
    finished_at     DATETIME(3) NULL,
    PRIMARY KEY (id),
    -- Reclamar el siguiente: por estado, cuándo puede correr y prioridad.
    KEY idx_jobs_claim (status, run_after, priority, id),
    KEY idx_jobs_level (level_id, id),
    KEY idx_jobs_lease (status, lease_until),
    CONSTRAINT fk_jobs_level FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE,
    CONSTRAINT chk_jobs_sha CHECK (audio_sha256 IS NULL OR audio_sha256 REGEXP '^[0-9a-f]{64}$'),
    CONSTRAINT chk_jobs_progress CHECK (progress BETWEEN 0 AND 1),
    CONSTRAINT chk_jobs_attempts CHECK (attempts <= max_attempts),
    CONSTRAINT chk_jobs_running_lease CHECK (status <> 'running' OR (worker_id IS NOT NULL AND lease_until IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audio_analyses (
    audio_sha256    CHAR(64) NOT NULL,
    analyzer_key    VARCHAR(64) NOT NULL,
    analysis_json   MEDIUMTEXT NOT NULL,
    duration_ms     INT UNSIGNED NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (audio_sha256, analyzer_key),
    CONSTRAINT chk_audio_analyses_json CHECK (JSON_VALID(analysis_json)),
    CONSTRAINT chk_audio_analyses_sha CHECK (audio_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE levels
    ADD COLUMN pending_public BOOLEAN NOT NULL DEFAULT FALSE AFTER is_public,
    ADD COLUMN chart_hash CHAR(64) NULL AFTER chart_version,
    -- Pendiente de publicar = tiene audio subido y todavía no es público.
    ADD CONSTRAINT chk_levels_pending_public
        CHECK (pending_public = FALSE OR (file_path IS NOT NULL AND is_public = FALSE)),
    ADD CONSTRAINT chk_levels_chart_hash
        CHECK (chart_hash IS NULL OR chart_hash REGEXP '^[0-9a-f]{64}$');

-- Hash de los charts ya guardados: SHA2 de MariaDB sobre el mismo texto que
-- calcula PHP (hash('sha256', chart_json)).
UPDATE levels SET chart_hash = SHA2(chart_json, 256) WHERE chart_json IS NOT NULL;
