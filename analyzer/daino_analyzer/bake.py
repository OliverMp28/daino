"""Horneado de los niveles oficiales con el analizador del servidor.

    docker compose run --rm \\
        -v ./database/seeds/official/baked:/srv/daino/database/seeds/official/baked \\
        -v ./docs/legacy/audios:/audios:ro \\
        analyzer bake-official --from /audios

(Sin `--from` lee `storage/official/`, que el servicio monta. El contenedor no
ve el resto del proyecto: por eso el directorio de origen se monta aparte.)

Para cada entrada del manifiesto: comprueba el MP3, lo analiza y deja el
análisis en `baked/<slug>.json`; después llama a `scripts/bake-official.mjs`,
que chartea con el charter del juego y escribe la forma canónica del JSON. Así
hay una sola implementación del charting y una sola forma de serializar.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

from daino_analyzer import analysis, schema
from daino_analyzer.decode import decode_file, sha256_file

PROJECT = Path("/srv/daino")


def bake_official(seed_dir: Path, source: Path, out_dir: Path | None, only: str | None) -> int:
    manifest = json.loads((seed_dir / "manifest.json").read_text(encoding="utf-8"))
    baked_dir = out_dir or (seed_dir / "baked")
    wanted = set(only.split(",")) if only else None
    failures = 0
    done = []
    previous: dict[str, str | None] = {}

    for entry in manifest["levels"]:
        slug = entry["slug"]
        if wanted is not None and slug not in wanted:
            continue
        path = source / entry["file"]
        if not path.is_file():
            print(f"  FALTA {slug}: no está {path}")
            failures += 1
            continue
        t0 = time.time()
        try:
            sha = sha256_file(path)
            a = analysis.analyze(decode_file(path))
            schema.validate(a)
            partial = {
                "formatVersion": 1,
                "slug": slug,
                "file": entry["file"],
                "bakedWith": {"analyzer": f"{a['analyzer']['name']}@{a['analyzer']['version']}"},
                "audio": {"sha256": sha, "bytes": path.stat().st_size, "durationSec": a["durationSec"]},
                "analysis": a,
            }
            target = baked_dir / f"{slug}.json"
            previous[slug] = target.read_text(encoding="utf-8") if target.is_file() else None
            target.write_text(json.dumps(partial, ensure_ascii=False), encoding="utf-8")
            done.append(slug)
            print(f"  analizado {slug} en {time.time() - t0:.1f} s: {a['bpm']:.1f} BPM, {len(a['beats'])} beats, "
                  f"{len(a['onsets'])} onsets, {len(a['sections'])} secciones")
        except Exception as exc:  # noqa: BLE001 - se informa por canción y se sigue
            failures += 1
            print(f"  FALLO {slug}: {exc}")

    if done:
        proc = subprocess.run(
            ["node", str(PROJECT / "scripts/bake-official.mjs"), f"--only={','.join(done)}"],
            cwd=PROJECT, check=False,
        )
        failures += 0 if proc.returncode == 0 else 1
        # Un horneado sin chart (el charter falló para esa canción) no se deja a
        # medias: el seeder lo rechazaría. Se restaura el anterior.
        for slug in done:
            target = baked_dir / f"{slug}.json"
            if "chart" not in json.loads(target.read_text(encoding="utf-8")):
                print(f"  RESTAURADO {slug}: el charting falló, se conserva el horneado anterior")
                if previous[slug] is None:
                    target.unlink()
                else:
                    target.write_text(previous[slug], encoding="utf-8")
    sys.stdout.flush()
    return 0 if failures == 0 else 1
