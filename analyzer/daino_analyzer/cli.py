"""Línea de órdenes del analizador.

    python -m daino_analyzer worker                      procesa la cola de análisis (servicio)
    python -m daino_analyzer analyze <mp3> [--out f]     analiza un archivo y escribe el JSON
    python -m daino_analyzer report <mp3>...             resumen legible de varias canciones
    python -m daino_analyzer bake-official [--from DIR]  hornea los niveles oficiales
    python -m daino_analyzer sonify <mp3> --out f.wav    la canción con clics en beats y downbeats
                                       [--chords]        …y los acordes detectados sonando debajo
                                       [--melody]        …y la melodía detectada (un seno que la sigue)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="daino_analyzer")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("worker", help="procesa la cola de análisis")
    sub.add_parser("health", help="exit 0 si el worker está vivo (healthcheck de Docker)")

    p = sub.add_parser("analyze", help="analiza un archivo")
    p.add_argument("file")
    p.add_argument("--out")

    p = sub.add_parser("report", help="resumen de varias canciones")
    p.add_argument("files", nargs="+")

    p = sub.add_parser("bake-official", help="hornea los niveles oficiales")
    p.add_argument("--seed-dir", default="/srv/daino/database/seeds/official")
    p.add_argument("--from", dest="source", default="/srv/daino/storage/official")
    p.add_argument("--out-dir")
    p.add_argument("--only")

    p = sub.add_parser("sonify", help="canción + clics en beats/downbeats para escucharla")
    p.add_argument("file")
    p.add_argument("--out", required=True)
    p.add_argument("--chords", action="store_true", help="añade los acordes detectados")
    p.add_argument("--melody", action="store_true", help="añade la melodía detectada")

    args = parser.parse_args(argv)

    if args.command == "worker":
        from daino_analyzer.worker import run_forever

        return run_forever()
    if args.command == "health":
        from daino_analyzer.worker import health

        return health()
    if args.command == "analyze":
        return _analyze(args.file, args.out)
    if args.command == "report":
        return _report(args.files)
    if args.command == "bake-official":
        from daino_analyzer.bake import bake_official

        return bake_official(Path(args.seed_dir), Path(args.source), Path(args.out_dir) if args.out_dir else None, args.only)
    if args.command == "sonify":
        from daino_analyzer.sonify import sonify

        return sonify(Path(args.file), Path(args.out), chords=args.chords, melody=args.melody)
    return 2


def _analyze(file: str, out: str | None) -> int:
    from daino_analyzer import analysis, schema
    from daino_analyzer.decode import decode_file

    result = analysis.analyze(decode_file(file))
    schema.validate(result)
    text = json.dumps(result, separators=(",", ":"))
    if out:
        Path(out).write_text(text)
    else:
        sys.stdout.write(text + "\n")
    return 0


def _report(files: list[str]) -> int:
    import resource
    from collections import Counter

    from daino_analyzer import analysis, schema
    from daino_analyzer.decode import decode_file

    for f in files:
        t0 = time.time()
        stages: dict[str, float] = {}
        a = analysis.analyze(decode_file(f), progress=lambda s, _r: stages.setdefault(s, time.time() - t0))
        schema.validate(a)
        ft = a["features"]
        print(f"\n== {Path(f).name}  ({a['durationSec']:.0f} s, analizado en {time.time() - t0:.1f} s; beats {stages.get('onsets', 0) - stages.get('beats', 0):.1f} s)")
        print(f"   tempo {a['bpm']:.1f} BPM · estabilidad {ft['tempoStability']:.2f} · compás {a['meter']} · beats {len(a['beats'])} · con golpe {ft['beatSupport']:.0%}")
        print(f"   onsets {len(a['onsets'])} · eventos/min {ft['eventsPerMin']:.0f} (fuertes {ft['strongEventsPerMin']:.0f}) · percusivo {ft['percussiveRatio']:.2f}")
        print(f"   sonoridad {ft['loudnessDbfs']:.1f} dBFS · rango dinámico {ft['dynamicRangeDb']:.1f} dB · silencio {ft['silenceRatio']:.0%}")
        print("   secciones: " + " | ".join(
            f"{s['startSec']:.0f}s {s['role']}({s['cluster']}) e={s['energy']:.2f} {s['key']}" for s in a["sections"]))
        ton = a["tonal"]
        chords, held = ton["chords"], Counter()
        for i, (t, label) in enumerate(chords):
            held[label] += (chords[i + 1][0] if i + 1 < len(chords) else a["durationSec"]) - t
        perc = sorted(a["onsetPercussive"])
        print(f"   tonalidad {ton['key']} (confianza {ton['keyConfidence']:.2f}) · afinación {ton['tuningCents']:+.1f} cents · "
              f"acordes {len(chords)} (encaje {ton['chordConfidence']:.2f}, {ton['harmonicRhythm']:.2f} cambios/compás)")
        print("   acordes más largos: " + ", ".join(f"{label} {secs:.0f}s" for label, secs in held.most_common(6)))
        if ton["modulations"]:
            print("   modulaciones: " + ", ".join(f"{m['t']:.0f}s → {m['key']} ({m['semitones']:+d})" for m in ton["modulations"]))
        voiced = [p for p in a["melody"]["pitch"] if p > 0]
        if voiced:
            voiced.sort()
            print(f"   melodía en el {a['melody']['voicedRatio']:.0%} de lo que suena · altura mediana {voiced[len(voiced) // 2]:.0f} "
                  f"(p10-p90 {voiced[len(voiced) // 10]:.0f}-{voiced[len(voiced) * 9 // 10]:.0f} MIDI)")
        lv = a["energy"]["bandLevelDb"]
        print(f"   percusividad mediana {perc[len(perc) // 2] if perc else 0:.2f} · nivel graves/medios/agudos "
              f"{lv[0]:.0f}/{lv[1]:.0f}/{lv[2]:.0f} dB · memoria pico {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
