-- Publicar en dos pasos con la dificultad elegida (ajustes tras el playtest de la Ola 5).
--
-- Un nivel publicado tiene UNA sola dificultad: sus marcas solo se comparan si
-- todos juegan el mismo chart. La dificultad se elige ANTES de publicar, y con
-- sentido: solo entre las que la canción admite, lo que exige el análisis del
-- servidor (el del navegador no distingue una balada de un tema con batería;
-- medido en la calibración, doc 10).
--
-- Flujo: publicar sube el MP3 y lo analiza (`pending_public`). Al terminar, el
-- worker ya no lo hace público: lo deja LISTO PARA PUBLICAR, con el chart de
-- cada dificultad que la canción admite ya generado por el servidor. Su autor
-- elige una (cambiar es instantáneo: se copia la variante, sin cola ni espera),
-- puede probarla, y confirma. Al confirmar, las variantes desaparecen.
--
-- levels.chart_variants_json — {"auto": chart, "1": chart, …, "<techo>": chart},
-- todos generados por el charter del servidor con el mismo análisis. Solo en
-- niveles no públicos: el CHECK impide que un nivel publicado conserve otras
-- dificultades a las que cambiar.

ALTER TABLE levels
    ADD COLUMN chart_variants_json LONGTEXT NULL AFTER chart_json,
    ADD CONSTRAINT chk_levels_chart_variants_json
        CHECK (chart_variants_json IS NULL OR JSON_VALID(chart_variants_json)),
    ADD CONSTRAINT chk_levels_variants_private
        CHECK (chart_variants_json IS NULL OR is_public = FALSE);
