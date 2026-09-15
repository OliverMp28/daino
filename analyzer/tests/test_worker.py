"""Cola y worker contra una base de datos real y desechable.

Se crea `daino_test_analyzer` con las migraciones del proyecto, se ejercita el
ciclo completo (reclamar, renovar, completar, fallar, cancelar, caducar) y se
borra al final. Requiere el servicio `mariadb` (docker compose run).
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import threading
import time
import wave
from pathlib import Path

import numpy as np
import pymysql
import pytest

from daino_analyzer import ANALYZER_KEY, jobs
from daino_analyzer.charter import chart_from_analysis
from daino_analyzer.worker import AnalysisFailed, ChildAnalyzer, Worker, WorkerConfig
from tests import synth

TEST_DB = "daino_test_analyzer"
MIGRATIONS = Path(os.environ.get("DAINO_ROOT", "/srv/daino")) / "database" / "migrations"


def _root_settings(database: str | None = None) -> dict:
    return {
        "host": os.environ.get("DB_HOST", "mariadb"),
        "port": int(os.environ.get("DB_PORT", "3306")),
        "user": os.environ.get("TEST_DB_ROOT_USER", "root"),
        "password": os.environ.get("TEST_DB_ROOT_PASSWORD", ""),
        "database": database,
    }


def _connect(database: str = TEST_DB):
    s = _root_settings(database)
    return pymysql.connect(host=s["host"], port=s["port"], user=s["user"], password=s["password"], database=s["database"],
                           charset="utf8mb4", autocommit=False, cursorclass=pymysql.cursors.DictCursor)


@pytest.fixture(scope="module")
def database():
    s = _root_settings()
    try:
        admin = pymysql.connect(host=s["host"], port=s["port"], user=s["user"], password=s["password"],
                                client_flag=pymysql.constants.CLIENT.MULTI_STATEMENTS, autocommit=True)
    except pymysql.err.OperationalError as exc:  # pragma: no cover - sin BD disponible
        pytest.skip(f"MariaDB no disponible: {exc}")
    with admin.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEST_DB}")
        cur.execute(f"CREATE DATABASE {TEST_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cur.execute(f"USE {TEST_DB}")
        for f in sorted(MIGRATIONS.glob("*.sql")):
            cur.execute(f.read_text(encoding="utf-8"))
            while cur.nextset():
                pass
    yield
    with admin.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEST_DB}")
    admin.close()


@pytest.fixture()
def conn(database):
    c = _connect()
    with c.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        for table in ("analysis_jobs", "audio_analyses", "progress", "levels", "users"):
            cur.execute(f"DELETE FROM {table}")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")
    c.commit()
    yield c
    c.close()


# --------------------------- Fixtures de datos ---------------------------

def valid_analysis(duration: float = 40.0, bpm: float = 120.0) -> dict:
    period = 60.0 / bpm
    beats = [round(0.5 + i * period, 3) for i in range(int((duration - 1) / period))]
    onsets = [[b, 1.0 if i % 4 == 0 else 0.6] for i, b in enumerate(beats)]
    frames = int(duration * 10)
    return {
        "formatVersion": 2,
        "analyzer": {"name": "daino-mir-py", "version": 2, "models": {"beats": "fake"}},
        "durationSec": duration, "sampleRate": 44100, "bpm": bpm, "bpmConfidence": 1.0, "beatPeriodS": round(period, 5),
        "onsets": onsets, "onsetColor": [[0.3, 0.3, 0.4] for _ in onsets], "onsetPercussive": [0.9 for _ in onsets],
        "beats": beats, "downbeats": beats[::4], "meter": 4,
        "sections": [{"startSec": 0.0, "endSec": duration, "cluster": "A", "role": "verse", "energy": 0.7, "density": 2.0,
                      "key": "C major", "keyConfidence": 0.8}],
        "energy": {"hopSec": 0.1, "values": [0.5] * frames,
                   "bands": {"low": [0.5] * frames, "mid": [0.5] * frames, "high": [0.5] * frames},
                   "bandLevelDb": [-1.5, -5.2, -21.0]},
        "tonal": {"tuningCents": 0.0, "key": "C major", "keyConfidence": 0.8, "chords": [[0.0, "C:maj"]],
                  "chordConfidence": 0.9, "harmonicRhythm": 0.0, "modulations": []},
        "features": {"tempoStability": 1.0, "beatSupport": 1.0, "pulseDoubled": False, "percussiveRatio": 0.5,
                     "eventsPerMin": 120.0, "strongEventsPerMin": 60.0, "loudnessDbfs": -12.0, "dynamicRangeDb": 10.0,
                     "silenceRatio": 0.0},
    }


class FakeAnalyzer:
    def __init__(self, analysis=None, error=None, during=None):
        self.calls = 0
        self.analysis = analysis or valid_analysis()
        self.error = error
        self.during = during

    def run(self, path, *, on_progress, should_continue, timeout_sec):
        self.calls += 1
        on_progress("beats", 0.5)
        if self.during:
            self.during()
            on_progress("onsets", 0.7)
        if not should_continue():
            from daino_analyzer.worker import Cancelled
            raise Cancelled()
        if self.error:
            raise self.error
        return self.analysis

    def close(self):
        pass


def make_level(conn, root: Path, *, audio: bytes = b"ID3 audio de prueba", public=False, pending=True,
               with_chart=False, sha_known=True) -> tuple[int, str]:
    sha = hashlib.sha256(audio).hexdigest()
    with conn.cursor() as cur:
        cur.execute("INSERT INTO users (vout_id, username) VALUES (UUID(), %s)", ("worker-test",))
        user_id = cur.lastrowid
        cur.execute(
            """INSERT INTO levels (user_id, title, duration_sec, difficulty, generator_seed, audio_sha256, is_public,
                                   pending_public, file_path, chart_json, chart_status, chart_version)
               VALUES (%s, 'Prueba', 40, 3, '1', %s, %s, %s, %s, %s, %s, %s)""",
            (user_id, sha if sha_known else None, public, pending and not public, "levels/pending.mp3",
             json.dumps({"formatVersion": 1, "events": []}) if with_chart else None,
             "ready" if with_chart else "analyzing", 1 if with_chart else None),
        )
        level_id = cur.lastrowid
        path = f"levels/{level_id}.mp3"
        cur.execute("UPDATE levels SET file_path = %s WHERE id = %s", (path, level_id))
    conn.commit()
    target = root / "storage" / "uploads" / "levels"
    target.mkdir(parents=True, exist_ok=True)
    (target / f"{level_id}.mp3").write_bytes(audio)
    return level_id, path


def enqueue(conn, level_id, path, sha=None, purpose="publish", priority=10, max_attempts=3) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO analysis_jobs (level_id, audio_path, audio_sha256, purpose, priority, max_attempts) VALUES (%s, %s, %s, %s, %s, %s)",
            (level_id, path, sha, purpose, priority, max_attempts),
        )
        job_id = cur.lastrowid
    conn.commit()
    return job_id


def row(conn, sql, *args):
    with conn.cursor() as cur:
        cur.execute(sql, args)
        r = cur.fetchone()
    conn.commit()
    return r


def worker(conn_factory, root, analyzer, **cfg):
    config = WorkerConfig(worker_id=cfg.pop("worker_id", "test-worker"), heartbeat_seconds=0.0, poll_seconds=0.01, **cfg)
    return Worker(conn_factory, config, analyzer=analyzer, charter=chart_from_analysis, root=root, log=lambda *a, **k: None)


# --------------------------- Tests ---------------------------

def test_publish_flow_leaves_the_level_ready_with_a_chart_per_difficulty_but_not_public(conn, tmp_path):
    """Publicar son dos pasos: el worker analiza y deja el nivel LISTO, con el
    chart de cada dificultad que la canción admite; lo hace público su autor al
    elegir una y confirmar (PHP), nunca el worker."""
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path, sha=hashlib.sha256(b"ID3 audio de prueba").hexdigest())
    analyzer = FakeAnalyzer()

    assert worker(_connect, tmp_path, analyzer).run_once() == "ready"

    lvl = row(conn, "SELECT * FROM levels WHERE id = %s", level_id)
    assert lvl["is_public"] == 0 and lvl["pending_public"] == 0, "analizado, pero no publicado"
    assert lvl["chart_status"] == "ready" and lvl["chart_version"] == 3
    assert lvl["chart_hash"] == hashlib.sha256(lvl["chart_json"].encode()).hexdigest()
    ceiling = lvl["difficulty_ceiling"]
    assert ceiling is not None and 1 <= lvl["difficulty"] <= 5
    chart = json.loads(lvl["chart_json"])
    assert len(chart["events"]) > 10 and chart["audio"]["sha256"] == lvl["audio_sha256"]

    variants = json.loads(lvl["chart_variants_json"])
    assert sorted(variants) == sorted(["auto", *[str(d) for d in range(1, ceiling + 1)]]), "Automática y 1..techo, nada por encima"
    assert variants["auto"] == chart, "sin dificultad pedida, el chart del nivel es el de Automática"
    for key, variant in variants.items():
        expected_level = min(3, ceiling) if key == "auto" else int(key)
        assert variant["difficulty"]["level"] == expected_level and variant["audio"]["sha256"] == lvl["audio_sha256"]
    assert _obstacles(json.dumps(variants[str(ceiling)])) > _obstacles(json.dumps(variants["1"])), "cada variante es otro nivel"

    job = row(conn, "SELECT * FROM analysis_jobs WHERE id = %s", job_id)
    assert job["status"] == "done" and float(job["progress"]) == 1.0 and job["lease_until"] is None
    assert row(conn, "SELECT COUNT(*) AS n FROM audio_analyses WHERE analyzer_key = %s", ANALYZER_KEY)["n"] == 1


def test_same_audio_is_analyzed_once(conn, tmp_path):
    a, pa = make_level(conn, tmp_path)
    b, pb = make_level(conn, tmp_path)
    enqueue(conn, a, pa)
    enqueue(conn, b, pb)
    analyzer = FakeAnalyzer()
    w = worker(_connect, tmp_path, analyzer)
    assert w.run_once() == "ready"
    assert w.run_once() == "ready"
    assert analyzer.calls == 1, "la segunda subida del mismo audio reutiliza el análisis"


def test_two_workers_never_take_the_same_job(conn, tmp_path):
    ids = []
    for _ in range(6):
        lvl, path = make_level(conn, tmp_path, audio=os.urandom(64))
        ids.append(enqueue(conn, lvl, path))
    claimed, lock = [], threading.Lock()

    def grab(name):
        c = _connect()
        while True:
            job = jobs.claim(c, name)
            if job is None:
                break
            with lock:
                claimed.append(job.id)
        c.close()

    threads = [threading.Thread(target=grab, args=(f"w{i}",)) for i in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(claimed) == sorted(ids), "cada trabajo lo coge exactamente un worker"


def test_interactive_jobs_go_first(conn, tmp_path):
    lvl, path = make_level(conn, tmp_path)
    background = enqueue(conn, lvl, path, purpose="backfill", priority=0)
    lvl2, path2 = make_level(conn, tmp_path, audio=b"otro")
    interactive = enqueue(conn, lvl2, path2, priority=10)
    assert jobs.claim(_connect(), "w").id == interactive
    assert jobs.claim(_connect(), "w").id == background


def test_cancellation_during_analysis_writes_nothing(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path)

    def php_cancels():
        c = _connect()
        with c.cursor() as cur:
            cur.execute("UPDATE analysis_jobs SET status = 'cancelled', lease_until = NULL WHERE id = %s", (job_id,))
        c.commit()
        c.close()

    assert worker(_connect, tmp_path, FakeAnalyzer(during=php_cancels)).run_once() == "cancelled"
    lvl = row(conn, "SELECT is_public, chart_json FROM levels WHERE id = %s", level_id)
    assert lvl["is_public"] == 0 and lvl["chart_json"] is None


def test_stage_changes_are_visible_right_away_without_waiting_for_the_heartbeat(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path)
    seen = {}

    def php_polls():
        seen.update(row(_connect(), "SELECT stage, progress FROM analysis_jobs WHERE id = %s", job_id))

    config = WorkerConfig(worker_id="lento", heartbeat_seconds=3600.0, poll_seconds=0.01)
    w = Worker(_connect, config, analyzer=FakeAnalyzer(during=php_polls), charter=chart_from_analysis, root=tmp_path,
               log=lambda *a, **k: None)
    assert w.run_once() == "ready"
    assert seen["stage"] == "beats", "la etapa nueva se escribe al empezar, no en el siguiente latido"
    assert float(seen["progress"]) == pytest.approx(0.02 + 0.88 * 0.5, abs=0.001)


class SilentAnalyzer(FakeAnalyzer):
    """Una etapa larga que no manda progreso (el pulso de una canción muy larga):
    solo pregunta si debe seguir, como hace ChildAnalyzer mientras espera."""

    def __init__(self, seconds, on_poll=None):
        super().__init__()
        self.seconds = seconds
        self.on_poll = on_poll

    def run(self, path, *, on_progress, should_continue, timeout_sec):
        self.calls += 1
        on_progress("beats", 0.1)
        end = time.monotonic() + self.seconds
        while time.monotonic() < end:
            if self.on_poll:
                self.on_poll()
            if not should_continue():
                from daino_analyzer.worker import Cancelled
                raise Cancelled()
            time.sleep(0.02)
        return self.analysis


def test_long_stage_without_progress_keeps_renewing_the_lease(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path)
    beats = []
    original = jobs.heartbeat

    def spy(*args, **kwargs):
        beats.append(time.monotonic())
        return original(*args, **kwargs)

    config = WorkerConfig(worker_id="largo", heartbeat_seconds=0.1, poll_seconds=0.01)
    w = Worker(_connect, config, analyzer=SilentAnalyzer(0.6), charter=chart_from_analysis, root=tmp_path,
               log=lambda *a, **k: None)
    jobs.heartbeat = spy
    try:
        assert w.run_once() == "ready"
    finally:
        jobs.heartbeat = original
    # analyzing (forzado) + beats (etapa nueva) + charting (forzado) = 3 sin
    # renovación por tiempo; 0.6 s a 0.1 s por latido añaden ~5 más.
    assert len(beats) >= 6, f"la reserva se renueva durante la etapa silenciosa ({len(beats)} latidos)"
    assert row(conn, "SELECT status FROM analysis_jobs WHERE id = %s", job_id)["status"] == "done"


def test_graceful_stop_returns_the_job_immediately_without_spending_an_attempt(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path)
    config = WorkerConfig(worker_id="parando", heartbeat_seconds=0.05, poll_seconds=0.01)
    w = Worker(_connect, config, analyzer=None, charter=chart_from_analysis, root=tmp_path, log=lambda *a, **k: None)

    def docker_stop():
        w.stopping = True

    w.analyzer = SilentAnalyzer(5.0, on_poll=docker_stop)
    assert w.run_once() == "released"
    job = row(conn, "SELECT status, attempts, worker_id, lease_until, run_after <= NOW(3) AS ready FROM analysis_jobs WHERE id = %s", job_id)
    assert job == {"status": "queued", "attempts": 0, "worker_id": None, "lease_until": None, "ready": 1}
    lvl = row(conn, "SELECT pending_public, chart_json FROM levels WHERE id = %s", level_id)
    assert lvl == {"pending_public": 1, "chart_json": None}, "sigue pendiente: otro worker lo retoma"

    w.stopping = False
    w.analyzer = FakeAnalyzer()
    assert w.run_once() == "ready"
    assert row(conn, "SELECT attempts FROM analysis_jobs WHERE id = %s", job_id)["attempts"] == 1


def test_permanent_failure_is_not_retried_and_the_level_stays_private(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    (tmp_path / "storage" / "uploads" / "levels" / f"{level_id}.mp3").unlink()
    job_id = enqueue(conn, level_id, path)
    assert worker(_connect, tmp_path, FakeAnalyzer()).run_once() == "failed"
    job = row(conn, "SELECT status, attempts, error_code FROM analysis_jobs WHERE id = %s", job_id)
    assert (job["status"], job["attempts"], job["error_code"]) == ("failed", 1, "audio_missing")
    lvl = row(conn, "SELECT pending_public, chart_status, is_public FROM levels WHERE id = %s", level_id)
    assert (lvl["pending_public"], lvl["chart_status"], lvl["is_public"]) == (0, "failed", 0)


def test_audio_that_is_not_the_levels_is_rejected(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path, sha="0" * 64)
    assert worker(_connect, tmp_path, FakeAnalyzer()).run_once() == "failed"
    assert row(conn, "SELECT error_code FROM analysis_jobs WHERE id = %s", job_id)["error_code"] == "audio_mismatch"


def test_transient_failure_is_retried_with_backoff_until_exhausted(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path, max_attempts=2)
    crash = AnalysisFailed("analyzer_crashed", "murió", permanent=False)
    w = worker(_connect, tmp_path, FakeAnalyzer(error=crash))

    assert w.run_once() == "retry"
    job = row(conn, "SELECT status, run_after > NOW(3) AS waiting FROM analysis_jobs WHERE id = %s", job_id)
    assert job["status"] == "queued" and job["waiting"] == 1, "espera antes de reintentar"
    assert w.run_once() is None, "durante la espera no se reclama"

    with conn.cursor() as cur:
        cur.execute("UPDATE analysis_jobs SET run_after = NOW(3) WHERE id = %s", (job_id,))
    conn.commit()
    assert w.run_once() == "failed"
    assert row(conn, "SELECT status, attempts FROM analysis_jobs WHERE id = %s", job_id) == {"status": "failed", "attempts": 2}


def test_expired_lease_goes_back_to_the_queue_or_fails_when_exhausted(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path, max_attempts=2)
    c = _connect()
    jobs.claim(c, "worker-muerto")
    with conn.cursor() as cur:
        cur.execute("UPDATE analysis_jobs SET lease_until = NOW(3) - INTERVAL 1 SECOND WHERE id = %s", (job_id,))
    conn.commit()
    assert jobs.reap_expired(c) == 1
    assert row(conn, "SELECT status FROM analysis_jobs WHERE id = %s", job_id)["status"] == "queued"

    jobs.claim(c, "worker-muerto")
    with conn.cursor() as cur:
        cur.execute("UPDATE analysis_jobs SET lease_until = NOW(3) - INTERVAL 1 SECOND WHERE id = %s", (job_id,))
    conn.commit()
    jobs.reap_expired(c)
    assert row(conn, "SELECT status FROM analysis_jobs WHERE id = %s", job_id)["status"] == "failed"
    assert row(conn, "SELECT pending_public, chart_status FROM levels WHERE id = %s", level_id) == {"pending_public": 0, "chart_status": "failed"}


def test_a_worker_that_lost_its_lease_cannot_write(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    enqueue(conn, level_id, path)
    c = _connect()
    job = jobs.claim(c, "lento")
    with conn.cursor() as cur:
        cur.execute("UPDATE analysis_jobs SET worker_id = 'otro' WHERE id = %s", (job.id,))
    conn.commit()
    result = jobs.Result(hashlib.sha256(b"ID3 audio de prueba").hexdigest(), ANALYZER_KEY, valid_analysis(),
                         {"audio": {"durationSec": 40}, "music": {"bpm": 120}, "world": {"speedPxS": 400}, "seed": 1, "events": []},
                         3, 4, 2)
    assert jobs.complete(c, job, "lento", result) == "abandoned"
    assert not jobs.heartbeat(c, job, "lento", "beats", 0.5)
    assert row(conn, "SELECT chart_json FROM levels WHERE id = %s", level_id)["chart_json"] is None


def test_level_reuploaded_during_analysis_is_not_overwritten(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path)

    def author_reuploads():
        c = _connect()
        with c.cursor() as cur:
            cur.execute("UPDATE levels SET file_path = 'levels/nuevo.mp3' WHERE id = %s", (level_id,))
        c.commit()
        c.close()

    assert worker(_connect, tmp_path, FakeAnalyzer(during=author_reuploads)).run_once() == "abandoned"
    assert row(conn, "SELECT status, error_code FROM analysis_jobs WHERE id = %s", job_id) == {"status": "cancelled", "error_code": "level_changed"}


def test_hash_changed_during_analysis_fails_and_releases_the_level(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path)
    job_id = enqueue(conn, level_id, path)

    def hash_changes():
        c = _connect()
        with c.cursor() as cur:
            cur.execute("UPDATE levels SET audio_sha256 = %s WHERE id = %s", ("1" * 64, level_id))
        c.commit()
        c.close()

    assert worker(_connect, tmp_path, FakeAnalyzer(during=hash_changes)).run_once() == "abandoned"
    assert row(conn, "SELECT status, error_code FROM analysis_jobs WHERE id = %s", job_id) == {"status": "failed", "error_code": "audio_mismatch"}
    lvl = row(conn, "SELECT pending_public, chart_status, is_public, chart_json FROM levels WHERE id = %s", level_id)
    assert lvl == {"pending_public": 0, "chart_status": "failed", "is_public": 0, "chart_json": None}, \
        "sin trabajo activo, el nivel no puede quedarse pendiente para siempre"


def test_public_chart_is_frozen_unless_reanalysis_is_explicit(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path, public=True, pending=False, with_chart=True)
    old = row(conn, "SELECT chart_json FROM levels WHERE id = %s", level_id)["chart_json"]
    enqueue(conn, level_id, path, purpose="publish")
    w = worker(_connect, tmp_path, FakeAnalyzer())
    assert w.run_once() == "chart_frozen"
    assert row(conn, "SELECT chart_json FROM levels WHERE id = %s", level_id)["chart_json"] == old

    enqueue(conn, level_id, path, purpose="reanalyze")
    assert w.run_once() == "chart_updated"
    lvl = row(conn, "SELECT is_public, chart_json, chart_variants_json FROM levels WHERE id = %s", level_id)
    assert lvl["chart_json"] != old and lvl["is_public"] == 1
    assert lvl["chart_variants_json"] is None, "un nivel publicado tiene una sola dificultad: sin variantes"


def _set_difficulty(conn, level_id, value):
    with conn.cursor() as cur:
        cur.execute("UPDATE levels SET difficulty_requested = %s WHERE id = %s", (value, level_id))
    conn.commit()


def _obstacles(chart_json: str) -> int:
    return sum(1 for e in json.loads(chart_json)["events"] if e["type"] == "obstacle")


def test_rechart_keeps_the_authors_choice_and_only_an_unpublished_level_keeps_variants(conn, tmp_path):
    """Un re-chart explícito (p. ej. `--charter-below` tras un charter nuevo) usa
    el análisis guardado y la dificultad que el autor eligió. Un nivel listo sigue
    listo, con sus variantes regeneradas; uno publicado se queda sin ellas."""
    level_id, path = make_level(conn, tmp_path)
    enqueue(conn, level_id, path)
    w = worker(_connect, tmp_path, FakeAnalyzer())
    assert w.run_once() == "ready"
    auto = row(conn, "SELECT difficulty_ceiling, chart_json FROM levels WHERE id = %s", level_id)
    assert json.loads(auto["chart_json"])["difficulty"]["requested"] == "auto"
    ceiling = auto["difficulty_ceiling"]
    assert ceiling is not None and ceiling >= 4, "el análisis de prueba es denso: admite dificultades altas"

    analyzer = FakeAnalyzer()
    w.analyzer = analyzer
    _set_difficulty(conn, level_id, 1)
    enqueue(conn, level_id, path, purpose="rechart")
    assert w.run_once() == "chart_updated"
    easy = row(conn, "SELECT difficulty, chart_json, chart_variants_json, is_public FROM levels WHERE id = %s", level_id)
    assert easy["difficulty"] == 1 and json.loads(easy["chart_json"])["difficulty"] == {"level": 1, "requested": 1, "ceiling": ceiling}
    assert easy["is_public"] == 0 and json.loads(easy["chart_variants_json"])["1"] == json.loads(easy["chart_json"]), \
        "sigue listo para publicar, con la elección del autor entre sus variantes"
    assert analyzer.calls == 0, "el re-chart usa el análisis guardado, no vuelve a analizar"

    with conn.cursor() as cur:
        cur.execute("UPDATE levels SET is_public = TRUE, chart_variants_json = NULL WHERE id = %s", (level_id,))
    conn.commit()
    enqueue(conn, level_id, path, purpose="rechart")
    assert w.run_once() == "chart_updated"
    public = row(conn, "SELECT difficulty, chart_variants_json FROM levels WHERE id = %s", level_id)
    assert public["difficulty"] == 1 and public["chart_variants_json"] is None, "publicado: su dificultad y ninguna otra"
    assert row(conn, "SELECT COUNT(*) AS n FROM analysis_jobs WHERE level_id = %s AND status = 'queued'", level_id)["n"] == 0


def test_legacy_level_without_hash_gets_it_from_the_file(conn, tmp_path):
    level_id, path = make_level(conn, tmp_path, sha_known=False, public=True, pending=False)
    enqueue(conn, level_id, path, purpose="backfill", priority=0)
    assert worker(_connect, tmp_path, FakeAnalyzer()).run_once() == "chart_updated"
    lvl = row(conn, "SELECT audio_sha256, chart_status FROM levels WHERE id = %s", level_id)
    assert lvl == {"audio_sha256": hashlib.sha256(b"ID3 audio de prueba").hexdigest(), "chart_status": "ready"}


# --------------------------- Integración real ---------------------------

@pytest.fixture(scope="module")
def short_mp3(tmp_path_factory):
    y, _ = synth.make_song(bpm=124, sections=[synth.Section(bars=12)])
    d = tmp_path_factory.mktemp("audio")
    wav, mp3 = d / "song.wav", d / "song.mp3"
    pcm = (np.clip(synth.to_stereo(y).T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(synth.SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "160k", str(mp3)], check=True)
    return mp3.read_bytes()


def test_end_to_end_with_the_real_child_process_analyzer_and_charter(conn, tmp_path, short_mp3):
    level_id, path = make_level(conn, tmp_path, audio=short_mp3)
    job_id = enqueue(conn, level_id, path, sha=hashlib.sha256(short_mp3).hexdigest())
    child = ChildAnalyzer(max_tasks=5)
    stages = []
    w = worker(_connect, tmp_path, child)
    original = jobs.heartbeat

    def spy(c, job, worker_id, stage, progress, lease_seconds=jobs.LEASE_SECONDS):
        stages.append(stage)
        return original(c, job, worker_id, stage, progress, lease_seconds)

    jobs.heartbeat = spy
    try:
        assert w.run_once() == "ready"
    finally:
        jobs.heartbeat = original
        child.close()

    lvl = row(conn, "SELECT is_public, chart_json, chart_variants_json, analysis_json, bpm_exact FROM levels WHERE id = %s", level_id)
    analysis = json.loads(lvl["analysis_json"])
    assert lvl["is_public"] == 0 and "auto" in json.loads(lvl["chart_variants_json"]), "listo para que su autor elija"
    assert abs(float(lvl["bpm_exact"]) - 124) < 1.5
    assert analysis["formatVersion"] == 2 and analysis["analyzer"]["models"]["beats"].startswith("beat_this")
    assert len(json.loads(lvl["chart_json"])["events"]) > 10
    assert {"analyzing", "beats", "charting"} <= set(stages), f"progreso informado por etapas: {stages}"
    assert row(conn, "SELECT status FROM analysis_jobs WHERE id = %s", job_id)["status"] == "done"


def test_child_timeout_is_a_transient_failure_and_the_child_is_replaced(tmp_path, short_mp3):
    path = tmp_path / "song.mp3"
    path.write_bytes(short_mp3)
    child = ChildAnalyzer()
    try:
        with pytest.raises(AnalysisFailed) as exc:
            child.run(path, on_progress=lambda *_: None, should_continue=lambda: True, timeout_sec=0.3)
        assert exc.value.code == "timeout" and not exc.value.permanent
        result = child.run(path, on_progress=lambda *_: None, should_continue=lambda: True, timeout_sec=300)
        assert result["formatVersion"] == 2, "tras matar al hijo colgado, uno nuevo analiza bien"
    finally:
        child.close()


def test_not_audio_in_the_child_is_a_permanent_failure(tmp_path):
    path = tmp_path / "fake.mp3"
    path.write_bytes(b"<?php no soy audio" * 100)
    child = ChildAnalyzer()
    try:
        with pytest.raises(AnalysisFailed) as exc:
            child.run(path, on_progress=lambda *_: None, should_continue=lambda: True, timeout_sec=120)
        assert exc.value.code == "decode_failed" and exc.value.permanent
    finally:
        child.close()
