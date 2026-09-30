-- Escenario de cada nivel (T02.1, doc 11).
--
-- levels.scene — id de una escena del registro del juego
-- (resources/js/game/scenes/registry.js). NULL = Automático: el juego decide
-- (hoy, la escena de siempre; con la T02.5, el carácter de la canción).
--
-- Quien sube un nivel elige entre los AMBIENTES elegibles (lista cerrada en
-- app/Services/SceneCatalog.php). Las historias de autor (escenas de UNA canción)
-- solo llegan a los oficiales desde el manifiesto del catálogo.
--
-- El escenario no toca el chart ni las marcas: se puede cambiar siempre, también
-- con el nivel publicado. Un id que el cliente no conozca (una escena más nueva
-- que él) se juega con la de siempre.
--
-- BINARY: con la colación de la tabla (utf8mb4_unicode_ci) REGEXP no distingue
-- mayúsculas y dejaría pasar 'COAST'.

ALTER TABLE levels
    ADD COLUMN scene VARCHAR(32) NULL DEFAULT NULL AFTER difficulty_requested,
    ADD CONSTRAINT chk_levels_scene
        CHECK (scene IS NULL OR BINARY scene REGEXP '^[a-z][a-z0-9-]{1,31}$');
