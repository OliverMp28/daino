-- Identidad de los efectos de cada nivel (T03.3, doc 11).
--
-- levels.fx_auto — lo que los efectos de la música tienen de propio en esta
-- canción, repartido por cómo suena (resources/js/game/fx/casting.js) a partir
-- del análisis del SERVIDOR: su paleta y, si le pega, su firma. JSON compacto con
-- las claves que haya, en este orden:
--     {"palette":"ultra","signature":"meteors"}
-- NULL = nada propio: la paleta de siempre y ninguna firma (la canción no encaja
-- claramente con nada, o aún no la ha analizado el servidor).
--
-- Lo escriben el worker del analizador (con el chart), el seeder de oficiales
-- (desde el horneado) y `python -m daino_analyzer cast` (al cambiar las reglas).
-- Nunca quien sube el nivel: los efectos no se eligen.
--
-- Los ids (paletas, firmas) no se validan aquí contra una lista: el registro
-- vive en el juego, y un cliente ignora lo que no conoce. Solo la forma.

ALTER TABLE levels
    ADD COLUMN fx_auto VARCHAR(255) NULL DEFAULT NULL AFTER scene_auto,
    ADD CONSTRAINT chk_levels_fx_auto
        CHECK (fx_auto IS NULL OR JSON_VALID(fx_auto));
