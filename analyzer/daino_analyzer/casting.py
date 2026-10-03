"""Los repartos de los niveles ya analizados (T02.5 y T03.3, doc 11).

Lo que un nivel tiene por cómo suena su canción lo proponen los repartos del
juego, en JS como el charter, a partir del análisis del servidor:

- `levels.scene_auto`: el escenario Automático (resources/js/game/scenes/sceneCasting.js).
- `levels.fx_auto`: la identidad de sus efectos, su paleta y su firma
  (resources/js/game/fx/casting.js).

El worker los guarda junto al chart. Esto vuelve a repartir los niveles que YA
tienen análisis, al cambiar las reglas (SCENE_CASTING_VERSION, FX_CASTING_VERSION)
o tras crear una de las columnas:

    docker compose exec -T analyzer python -m daino_analyzer cast [--dry-run] [--level=IDS]

Solo toca esas dos columnas: ni el chart, ni las marcas, ni el escenario que
eligió su autor (`scene`, que manda sobre el Automático). Un análisis del
navegador (formato 1) no da propuestas: None, lo de siempre.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Callable

from daino_analyzer.jobs import fx_auto_or_none, scene_id_or_none
from daino_analyzer.storage import project_root

# Niveles por llamada a Node: cada análisis ocupa 50-150 KB.
BATCH = 16


class CastError(Exception):
    """El reparto (Node) falló."""


def run_caster(items: list[dict], *, root: Path | None = None, timeout_sec: float = 120.0) -> dict[int, dict]:
    """{id: {"scene": ambiente o None, "fx": texto de `fx_auto` o None}} para cada `{id, analysis}`."""
    script = (root or project_root()) / "scripts" / "cast-scenes.mjs"
    node = os.environ.get("NODE_BIN", "node")
    payload = json.dumps({"items": items}, separators=(",", ":")).encode("utf-8")
    try:
        proc = subprocess.run([node, str(script)], input=payload, capture_output=True, timeout=timeout_sec, check=False)
    except subprocess.TimeoutExpired as exc:
        raise CastError(f"el reparto tardó más de {timeout_sec:.0f} s") from exc
    if proc.returncode != 0:
        raise CastError(proc.stderr.decode(errors="replace").strip()[:400] or f"código {proc.returncode}")
    out = json.loads(proc.stdout)
    return {
        int(item["id"]): {"scene": scene_id_or_none(item.get("scene")), "fx": fx_auto_or_none(item.get("fx"))}
        for item in out["items"]
    }


def cast_levels(conn, *, dry_run: bool = False, level_ids: list[int] | None = None,
                caster: Callable[[list[dict]], dict[int, dict]] = run_caster) -> dict:
    """Recalcula `scene_auto` y `fx_auto` de los niveles con análisis. Devuelve
    {"total": n, "changed": [(id, título, antes, después), …], "fx_changed": [ídem]}:
    `changed`, los escenarios; `fx_changed`, las identidades de los efectos."""
    where = "analysis_json IS NOT NULL"
    params: tuple = ()
    if level_ids:
        where += " AND id IN (" + ",".join(["%s"] * len(level_ids)) + ")"
        params = tuple(level_ids)
    with conn.cursor() as cur:
        cur.execute(f"SELECT id FROM levels WHERE {where} ORDER BY id", params)
        ids = [int(r["id"]) for r in cur.fetchall()]
    conn.commit()

    changed: list[tuple[int, str, str | None, str | None]] = []
    fx_changed: list[tuple[int, str, str | None, str | None]] = []
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, analysis_json, scene_auto, fx_auto FROM levels WHERE id IN ("
                + ",".join(["%s"] * len(chunk)) + ")",
                tuple(chunk),
            )
            rows = cur.fetchall()
        items = []
        for r in rows:
            try:
                items.append({"id": int(r["id"]), "analysis": json.loads(r["analysis_json"])})
            except (TypeError, ValueError):
                items.append({"id": int(r["id"]), "analysis": None})
        proposals = caster(items)
        with conn.cursor() as cur:
            for r in rows:
                new = proposals.get(int(r["id"])) or {"scene": None, "fx": None}
                if new["scene"] != r["scene_auto"]:
                    changed.append((int(r["id"]), r["title"], r["scene_auto"], new["scene"]))
                    if not dry_run:
                        cur.execute("UPDATE levels SET scene_auto = %s WHERE id = %s", (new["scene"], r["id"]))
                if new["fx"] != r["fx_auto"]:
                    fx_changed.append((int(r["id"]), r["title"], r["fx_auto"], new["fx"]))
                    if not dry_run:
                        cur.execute("UPDATE levels SET fx_auto = %s WHERE id = %s", (new["fx"], r["id"]))
        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    return {"total": len(ids), "changed": changed, "fx_changed": fx_changed}


# El nombre de antes de la T03.3, cuando solo repartía escenarios.
cast_scenes = cast_levels
