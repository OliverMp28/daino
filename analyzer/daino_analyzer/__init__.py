"""Analizador musical de Daino (Ola 4).

Convierte un MP3 en un `analysis.json`: hechos musicales (beats, downbeats,
onsets, energía, secciones). No decide nada de jugabilidad: eso es el CHARTING,
que vive en JS y se comparte con el navegador (doc 10 §2.1).
"""

ANALYZER_NAME = "daino-mir-py"

# Súbelo cuando cambie cualquier cosa que altere el análisis de un mismo audio:
# los análisis guardados con otra versión se detectan como obsoletos.
# 2: armonía (tonalidad, acordes, modulaciones), percusividad de cada onset y
#    energía por bandas. Lo de la versión 1 sale idéntico.
ANALYZER_VERSION = 2

ANALYZER_KEY = f"{ANALYZER_NAME}@{ANALYZER_VERSION}"

# Formato del JSON. El 1 es el del analizador JS (bpm + onsets); el 2 añade los
# hechos ricos y es un SUPERCONJUNTO: todo lector del 1 entiende un 2.
ANALYSIS_FORMAT_VERSION = 2
