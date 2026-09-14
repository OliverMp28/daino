"""Puente al charter del juego (JS).

El charting —qué obstáculo va dónde— tiene UNA implementación, en JS, y la
comparten el navegador, el horneado de oficiales y este worker (doc 10 §2.1).
Aquí solo se invoca `scripts/chart-from-analysis.mjs` con Node.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from daino_analyzer.storage import project_root


class CharterError(Exception):
    """El charter rechazó el análisis. Permanente: reintentar no cambia nada."""


def chart_from_analysis(analysis: dict, audio_sha256: str, difficulty: int | None = None, *,
                        variants: bool = False, timeout_sec: float = 60.0, root: Path | None = None) -> dict:
    """`difficulty`: la que pidió el autor (1-5) o None para "Automática" (Ola 5).
    El charter nunca supera el techo que la canción admite.

    `variants`: además, el chart de cada dificultad que la canción admite
    ('auto', '1'…techo). Un nivel sin publicar queda con todas y su autor elige."""
    script = (root or project_root()) / "scripts" / "chart-from-analysis.mjs"
    node = os.environ.get("NODE_BIN", "node")
    payload = json.dumps({
        "analysis": analysis,
        "sha256": audio_sha256,
        "difficulty": difficulty if difficulty is not None else "auto",
        "variants": variants,
    }).encode("utf-8")
    try:
        proc = subprocess.run([node, str(script)], input=payload, capture_output=True, timeout=timeout_sec, check=False)
    except subprocess.TimeoutExpired as exc:
        raise CharterError(f"el charter tardó más de {timeout_sec:.0f} s") from exc
    if proc.returncode != 0:
        raise CharterError(proc.stderr.decode(errors="replace").strip()[:400] or f"código {proc.returncode}")
    out = json.loads(proc.stdout)
    for key in ("chart", "difficulty", "difficultyCeiling", "stats"):
        if key not in out:
            raise CharterError(f"respuesta del charter sin '{key}'")
    if variants and not isinstance(out.get("variants"), dict):
        raise CharterError("respuesta del charter sin 'variants'")
    return out
