-- Escenario Automático de cada nivel (T02.5, doc 11).
--
-- levels.scene_auto — el ambiente que pega con cómo suena la canción, propuesto
-- por el reparto de escenarios (resources/js/game/scenes/sceneCasting.js) a
-- partir del análisis del SERVIDOR. NULL = ninguna propuesta: la canción no
-- encaja claramente con ningún ambiente, o aún no la ha analizado el servidor
-- (una canción jugada solo en local). En los dos casos se juega en la Cordillera.
--
-- Lo escriben el worker del analizador (con el chart), el seeder de oficiales
-- (desde el horneado) y `python -m daino_analyzer cast-scenes` (al cambiar las
-- reglas). Nunca quien sube el nivel: lo suyo es `levels.scene`, que manda.
--
-- Mismo formato que levels.scene (BINARY: ver 012).

ALTER TABLE levels
    ADD COLUMN scene_auto VARCHAR(32) NULL DEFAULT NULL AFTER scene,
    ADD CONSTRAINT chk_levels_scene_auto
        CHECK (scene_auto IS NULL OR BINARY scene_auto REGEXP '^[a-z][a-z0-9-]{1,31}$');
