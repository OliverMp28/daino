"""Operaciones de la cola de análisis (tabla `analysis_jobs`, migración 009).

Todo el SQL del worker vive aquí. Cada función es una transacción completa.

Ciclo de vida de un trabajo:

    queued ──claim──▶ running ──complete──▶ done
      ▲                 │  └───fail (permanente o sin reintentos)──▶ failed
      └──fail (transitorio, con espera)
                        └───reserva caducada (worker muerto)──▶ queued / failed
    queued/running ──PHP cancela (nivel privado, nueva subida)──▶ cancelled

Garantías:
- Exactamente un worker por trabajo: `FOR UPDATE SKIP LOCKED` al reclamar.
- Un worker que perdió la reserva (caducó, o PHP canceló) NO escribe nada:
  `heartbeat` y `complete` comprueban que el trabajo sigue siendo suyo.
- Los resultados se escriben con el nivel bloqueado y comprobando que su audio
  sigue siendo el mismo que se analizó.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

LEASE_SECONDS = 90
BACKOFF_BASE_SECONDS = 30
# Misma prioridad que AnalysisJob::PRIORITY_INTERACTIVE (PHP): alguien espera.
INTERACTIVE_PRIORITY = 10


@dataclass(frozen=True)
class Job:
    id: int
    level_id: int | None
    audio_path: str
    audio_sha256: str | None
    purpose: str
    attempts: int
    max_attempts: int


@dataclass(frozen=True)
class Result:
    audio_sha256: str
    analyzer_key: str
    analysis: dict
    chart: dict
    difficulty: int
    difficulty_ceiling: int | None
    charter_version: int
    # Ola 5: la dificultad pedida con la que se charteó (None = Automática).
    requested_difficulty: int | None = None


# Trabajos que sustituyen el chart de un nivel ya publicado: una reanálisis
# explícita o un cambio de dificultad de su autor (Ola 5).
REPLACES_PUBLIC_CHART = ("reanalyze", "rechart")


def reap_expired(conn) -> int:
    """Trabajos 'running' cuya reserva caducó (el worker murió): vuelven a la
    cola, o fallan si ya agotaron los intentos."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, level_id, attempts >= max_attempts AS exhausted FROM analysis_jobs
               WHERE status = 'running' AND lease_until < NOW(3)
               FOR UPDATE SKIP LOCKED"""
        )
        expired = cur.fetchall()
        for row in expired:
            exhausted = bool(row["exhausted"])
            cur.execute(
                """UPDATE analysis_jobs
                   SET status = %s, error_code = 'lease_expired',
                       error_message = 'El análisis se interrumpió (el worker dejó de responder).',
                       worker_id = NULL, lease_until = NULL, finished_at = IF(%s, NOW(3), NULL)
                   WHERE id = %s""",
                ("failed" if exhausted else "queued", exhausted, row["id"]),
            )
            if exhausted and row["level_id"] is not None:
                _release_level(cur, row["level_id"])
    conn.commit()
    return len(expired)


def claim(conn, worker_id: str, lease_seconds: int = LEASE_SECONDS) -> Job | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id FROM analysis_jobs
               WHERE status = 'queued' AND run_after <= NOW(3)
               ORDER BY priority DESC, id ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED"""
        )
        row = cur.fetchone()
        if row is None:
            conn.rollback()
            return None
        cur.execute(
            """UPDATE analysis_jobs
               SET status = 'running', worker_id = %s, attempts = attempts + 1,
                   lease_until = NOW(3) + INTERVAL %s SECOND,
                   started_at = COALESCE(started_at, NOW(3)), stage = 'starting', progress = 0
               WHERE id = %s""",
            (worker_id, lease_seconds, row["id"]),
        )
        cur.execute("SELECT id, level_id, audio_path, audio_sha256, purpose, attempts, max_attempts FROM analysis_jobs WHERE id = %s", (row["id"],))
        job = cur.fetchone()
    conn.commit()
    return Job(**job)


def heartbeat(conn, job: Job, worker_id: str, stage: str, progress: float, lease_seconds: int = LEASE_SECONDS) -> bool:
    """Renueva la reserva e informa del progreso. False = el trabajo ya no es de
    este worker (lo cancelaron o caducó): hay que abandonar sin escribir."""
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE analysis_jobs
               SET lease_until = NOW(3) + INTERVAL %s SECOND, stage = %s, progress = %s
               WHERE id = %s AND worker_id = %s AND status = 'running'""",
            (lease_seconds, stage[:32], round(min(max(progress, 0.0), 1.0), 3), job.id, worker_id),
        )
        ok = cur.rowcount == 1
    conn.commit()
    return ok


def requested_difficulty(conn, level_id: int | None) -> int | None:
    """Dificultad que pide el autor del nivel ahora mismo (None = Automática).
    Se lee justo antes de chartear: un cambio durante el análisis se aplica."""
    if level_id is None:
        return None
    with conn.cursor() as cur:
        cur.execute("SELECT difficulty_requested FROM levels WHERE id = %s", (level_id,))
        found = cur.fetchone()
    conn.commit()
    if found is None or found["difficulty_requested"] is None:
        return None
    return int(found["difficulty_requested"])


def cached_analysis(conn, audio_sha256: str, analyzer_key: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT analysis_json FROM audio_analyses WHERE audio_sha256 = %s AND analyzer_key = %s",
            (audio_sha256, analyzer_key),
        )
        row = cur.fetchone()
    conn.commit()
    return json.loads(row["analysis_json"]) if row else None


def complete(conn, job: Job, worker_id: str, result: Result) -> str:
    """Escribe el resultado. Devuelve qué pasó: 'published', 'chart_updated',
    'chart_frozen', o 'abandoned' (el trabajo ya no era de este worker, o el nivel
    cambió mientras se analizaba)."""
    analysis_json = json.dumps(result.analysis, ensure_ascii=False, separators=(",", ":"))
    chart_json = json.dumps(result.chart, ensure_ascii=False, separators=(",", ":"))
    chart_hash = hashlib.sha256(chart_json.encode("utf-8")).hexdigest()
    duration = float(result.chart["audio"]["durationSec"])
    bpm = float(result.chart["music"]["bpm"])

    with conn.cursor() as cur:
        cur.execute("SELECT status, worker_id FROM analysis_jobs WHERE id = %s FOR UPDATE", (job.id,))
        row = cur.fetchone()
        if row is None or row["status"] != "running" or row["worker_id"] != worker_id:
            conn.rollback()
            return "abandoned"

        # La caché de análisis se guarda aunque el nivel ya no lo necesite: el
        # trabajo caro está hecho y otra subida del mismo audio lo aprovecha.
        cur.execute(
            """INSERT INTO audio_analyses (audio_sha256, analyzer_key, analysis_json, duration_ms)
               VALUES (%s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE analysis_json = VALUES(analysis_json), duration_ms = VALUES(duration_ms)""",
            (result.audio_sha256, result.analyzer_key, analysis_json, int(round(duration * 1000))),
        )

        outcome = "chart_updated"
        if job.level_id is not None:
            cur.execute(
                """SELECT id, file_path, audio_sha256, is_public, pending_public, chart_status, difficulty_requested
                   FROM levels WHERE id = %s FOR UPDATE""",
                (job.level_id,),
            )
            level = cur.fetchone()
            if level is None or level["file_path"] != job.audio_path:
                # Borrado, retirado o re-subido con otro archivo mientras se analizaba.
                _finish(cur, job.id, "cancelled", "level_changed", "El nivel cambió mientras se analizaba.")
                conn.commit()
                return "abandoned"
            if level["audio_sha256"] is not None and level["audio_sha256"] != result.audio_sha256:
                _finish(cur, job.id, "failed", "audio_mismatch", "El audio no coincide con el del nivel.")
                _release_level(cur, job.level_id)
                conn.commit()
                return "abandoned"

            frozen = bool(level["is_public"]) and level["chart_status"] == "ready" and job.purpose not in REPLACES_PUBLIC_CHART
            if frozen:
                # Un nivel ya publicado conserva su chart: otros jugadores tienen
                # marcas sobre él. Solo se sustituye con una reanálisis explícita
                # o un cambio de dificultad de su autor.
                outcome = "chart_frozen"
            else:
                cur.execute(
                    """UPDATE levels SET
                         audio_sha256 = COALESCE(audio_sha256, %s),
                         duration_sec = %s, duration_ms = %s, bpm = %s, bpm_exact = %s, game_speed = %s,
                         generator_seed = %s, chart_json = %s, analysis_json = %s, chart_status = 'ready',
                         chart_version = %s, chart_hash = %s, difficulty = %s, difficulty_ceiling = %s,
                         is_public = (is_public OR pending_public), pending_public = FALSE
                       WHERE id = %s""",
                    (
                        result.audio_sha256,
                        max(1, int(round(duration))), int(round(duration * 1000)),
                        max(30, min(300, int(round(bpm)))), round(bpm, 2),
                        int(round(float(result.chart["world"]["speedPxS"]))),
                        str(result.chart["seed"]), chart_json, analysis_json,
                        result.charter_version, chart_hash, result.difficulty, result.difficulty_ceiling,
                        job.level_id,
                    ),
                )
                outcome = "published" if level["pending_public"] else "chart_updated"

                # El autor cambió la dificultad DESPUÉS de que este trabajo la
                # leyera (entre chartear y guardar): se encola ya otro re-chart,
                # en esta misma transacción, para que el nivel nunca se quede con
                # una dificultad que ya no es la pedida.
                current = level["difficulty_requested"]
                current = None if current is None else int(current)
                if current != result.requested_difficulty:
                    cur.execute(
                        """INSERT INTO analysis_jobs (level_id, audio_path, audio_sha256, purpose, priority)
                           VALUES (%s, %s, %s, 'rechart', %s)""",
                        (job.level_id, job.audio_path, result.audio_sha256, INTERACTIVE_PRIORITY),
                    )

        _finish(cur, job.id, "done", None, None)
    conn.commit()
    return outcome


def fail(conn, job: Job, worker_id: str, code: str, message: str, *, permanent: bool) -> str:
    """Registra un fallo. Devuelve 'retry', 'failed' o 'abandoned'."""
    with conn.cursor() as cur:
        cur.execute("SELECT status, worker_id, attempts, max_attempts FROM analysis_jobs WHERE id = %s FOR UPDATE", (job.id,))
        row = cur.fetchone()
        if row is None or row["status"] != "running" or row["worker_id"] != worker_id:
            conn.rollback()
            return "abandoned"
        if not permanent and row["attempts"] < row["max_attempts"]:
            delay = BACKOFF_BASE_SECONDS * (2 ** (row["attempts"] - 1))
            cur.execute(
                """UPDATE analysis_jobs
                   SET status = 'queued', worker_id = NULL, lease_until = NULL,
                       run_after = NOW(3) + INTERVAL %s SECOND, error_code = %s, error_message = %s
                   WHERE id = %s""",
                (delay, code[:40], message[:500], job.id),
            )
            conn.commit()
            return "retry"
        _finish(cur, job.id, "failed", code, message)
        if job.level_id is not None:
            _release_level(cur, job.level_id)
    conn.commit()
    return "failed"


def release(conn, job: Job, worker_id: str) -> bool:
    """Devuelve a la cola un trabajo que este worker deja a medias por pararse.
    Disponible ya y con el intento devuelto. False si ya no era suyo."""
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE analysis_jobs
               SET status = 'queued', worker_id = NULL, lease_until = NULL, run_after = NOW(3),
                   attempts = IF(attempts > 0, attempts - 1, 0), stage = NULL, progress = 0
               WHERE id = %s AND worker_id = %s AND status = 'running'""",
            (job.id, worker_id),
        )
        ok = cur.rowcount == 1
    conn.commit()
    return ok


def _release_level(cur, level_id: int) -> None:
    """Un análisis que falla de forma definitiva no deja el nivel "pendiente de
    publicar" para siempre: vuelve a privado (con su audio, para reintentar) y su
    chart, si no tenía, queda marcado como fallido."""
    cur.execute(
        """UPDATE levels SET pending_public = FALSE,
             chart_status = IF(chart_status = 'analyzing', 'failed', chart_status)
           WHERE id = %s""",
        (level_id,),
    )


def _finish(cur, job_id: int, status: str, code: str | None, message: str | None) -> None:
    cur.execute(
        """UPDATE analysis_jobs
           SET status = %s, error_code = %s, error_message = %s, finished_at = NOW(3),
               lease_until = NULL, progress = IF(%s = 'done', 1, progress), stage = IF(%s = 'done', 'done', stage)
           WHERE id = %s""",
        (status, None if code is None else code[:40], None if message is None else message[:500], status, status, job_id),
    )
