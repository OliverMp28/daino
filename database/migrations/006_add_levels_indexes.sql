-- Índices para el listado de niveles (Ola 0, defecto D8).
--
-- `Level::findPublic()` ejecuta:
--     SELECT * FROM levels WHERE is_public = TRUE ORDER BY created_at DESC
--
-- y la tabla solo tenía PRIMARY KEY(id) + KEY(user_id). Resultado: full scan
-- sobre `levels` más un filesort para el ORDER BY en cada apertura del modal
-- NIVELES. Con pocas filas no se nota; el catálogo está pensado para crecer
-- con contenido de la comunidad, así que el escaneo es deuda desde el día uno.
--
-- El índice compuesto `(is_public, created_at)` cubre las dos mitades de la
-- consulta: la igualdad por `is_public` como prefijo y el orden por
-- `created_at` dentro de cada grupo, de modo que InnoDB puede leer las filas
-- ya ordenadas y aplicar LIMIT/OFFSET sin materializar el resultado entero.
CREATE INDEX idx_levels_public_created ON levels (is_public, created_at);

-- `Level::findByUser()` filtra por user_id y ordena por created_at DESC. El
-- KEY(user_id) existente resuelve el filtro pero deja el filesort; extenderlo
-- con created_at lo elimina. Se crea uno nuevo en vez de sustituir al viejo
-- para no tocar la FK `fk_levels_user`, que se apoya en él.
CREATE INDEX idx_levels_user_created ON levels (user_id, created_at);
