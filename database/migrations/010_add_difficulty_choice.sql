-- Dificultad elegida por quien sube la canción (Ola 5, doc 10 §2.3).
--
-- 1. levels.difficulty_requested — la que pidió el autor, 1-5, o NULL para
--    "Automática". `levels.difficulty` sigue siendo la EFECTIVA: la pedida
--    limitada por el techo que la canción admite (`difficulty_ceiling`), la que
--    escribe el worker al chartear y la que enseñan las tarjetas.
--
-- 2. analysis_jobs.purpose 'rechart' — cambiar la dificultad de un nivel ya
--    analizado vuelve a chartear con el análisis guardado en `audio_analyses`
--    (segundos, sin volver a analizar) y, a diferencia de un análisis de
--    relleno, sustituye el chart de un nivel público: es una decisión explícita
--    de su autor (el endpoint lo impide si otros jugadores ya tienen marca).

ALTER TABLE levels
    ADD COLUMN difficulty_requested TINYINT UNSIGNED NULL AFTER difficulty,
    ADD CONSTRAINT chk_levels_difficulty_requested
        CHECK (difficulty_requested IS NULL OR difficulty_requested BETWEEN 1 AND 5);

ALTER TABLE analysis_jobs
    MODIFY COLUMN purpose ENUM('publish', 'backfill', 'reanalyze', 'rechart') NOT NULL DEFAULT 'publish';
