-- Catálogo de niveles (Ola 2): niveles oficiales sin autor y consultas del
-- catálogo por pestaña.
--
-- 1. Niveles oficiales sin autor.
--    Un nivel oficial es del juego, no de una persona. Hasta aquí `user_id` era
--    obligatorio; la alternativa era un usuario "sistema" falso, que ensuciaría
--    `users` y el ranking y necesitaría un `vout_id` inventado (la columna solo
--    debe guardar identidades reales de Vout). La FK sigue en su sitio: NULL no
--    referencia a nadie.
--
-- 2. Identidad estable de un nivel oficial: `official_slug`.
--    Es la clave del manifiesto (`database/seeds/official/manifest.json`) y lo
--    que hace idempotente `composer seed:official`: volver a sembrar actualiza
--    la misma fila en lugar de duplicarla. NULL en todo nivel no oficial (un
--    índice único admite varios NULL).
--
--    Por qué no deduplicar por `audio_sha256`: `uniq_levels_user_audio` no lo
--    cubre (con `user_id` NULL dos filas nunca colisionan) y una columna
--    generada `IF(is_official, audio_sha256, NULL)` no es posible — MariaDB
--    rechaza expresiones generadas sobre columnas CHAR (error 1901, dependen de
--    PAD_CHAR_TO_FULL_LENGTH). Y semánticamente el slug es mejor clave: si se
--    sustituye el MP3 de una canción oficial por otra codificación, sigue
--    siendo el mismo nivel del catálogo, con otro audio.
--
-- 3. Índices de las consultas del catálogo.
--    - Pestañas "Oficiales" y "De la comunidad": filtran por `is_official` e
--      `is_public` y ordenan por fecha.
--    - Ranking de un nivel: `progress` filtrado por nivel y ordenado por puntos.
--      Sin `(level_id, points)` cada apertura de una ficha haría un filesort.

ALTER TABLE levels
    MODIFY COLUMN user_id BIGINT UNSIGNED NULL,
    ADD COLUMN official_slug VARCHAR(64) NULL AFTER is_official,
    ADD UNIQUE KEY uniq_levels_official_slug (official_slug),
    ADD KEY idx_levels_catalog (is_official, is_public, created_at),
    -- Todo nivel tiene autor salvo los oficiales.
    ADD CONSTRAINT chk_levels_owner
        CHECK (is_official = TRUE OR user_id IS NOT NULL),
    -- Un oficial está siempre publicado y tiene identidad de audio: si no, no
    -- se podría jugar ni deduplicar.
    ADD CONSTRAINT chk_levels_official_shape
        CHECK (is_official = FALSE OR (is_public = TRUE AND audio_sha256 IS NOT NULL)),
    -- Slug si y solo si es oficial.
    ADD CONSTRAINT chk_levels_official_slug
        CHECK ((is_official = TRUE) = (official_slug IS NOT NULL));

-- Mismo orden que `Progress::topForLevel` (puntos DESC, luego quién lo logró
-- antes; InnoDB añade el id de la PK al final). Con el orden mixto hace falta el
-- índice descendente (MariaDB ≥ 10.8): así el ranking de un nivel se lee ya
-- ordenado, sin filesort, tenga el nivel 10 jugadores o 100 000.
CREATE INDEX idx_progress_level_points ON progress (level_id, points DESC, best_run_at ASC);
