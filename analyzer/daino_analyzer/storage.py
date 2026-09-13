"""Rutas del audio de un nivel. Espejo de `FileUploadService::absolutePath` (PHP).

    levels/12.mp3      → <raíz>/storage/uploads/levels/12.mp3   (subido por un usuario)
    official/HOPE.mp3  → <raíz>/storage/official/HOPE.mp3       (catálogo de fábrica)

Solo se usa el nombre final: un `file_path` manipulado nunca sale de su directorio.
"""

from __future__ import annotations

import os
from pathlib import Path

OFFICIAL_PREFIX = "official/"


def project_root() -> Path:
    return Path(os.environ.get("DAINO_ROOT", "/srv/daino"))


def audio_path(relative: str, root: Path | None = None) -> Path:
    base = root or project_root()
    name = Path(relative).name
    if not name or name in (".", ".."):
        raise ValueError(f"ruta de audio inválida: {relative!r}")
    if relative.startswith(OFFICIAL_PREFIX):
        return base / "storage" / "official" / name
    return base / "storage" / "uploads" / "levels" / name
