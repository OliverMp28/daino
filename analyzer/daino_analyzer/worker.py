"""Worker del analizador: saca trabajos de la cola, analiza, chartea y guarda.

    python -m daino_analyzer worker

Diseño para funcionar solo y durante meses:

- El análisis corre en un PROCESO HIJO persistente. Si se cuelga, excede el
  tiempo máximo o el sistema lo mata por memoria, el worker lo detecta, registra
  el fallo y arranca otro hijo. El proceso principal nunca carga PyTorch.
- El hijo se recicla cada `max_tasks_per_child` trabajos: cualquier fuga de
  memoria de librerías nativas queda acotada.
- Mientras analiza, el worker renueva la reserva y publica el progreso. Si PHP
  cancela el trabajo (el autor lo retiró o subió otro archivo), el worker lo ve
  en la siguiente renovación, mata al hijo y no escribe nada.
- Fallos PERMANENTES (no es audio, el audio no coincide, el análisis no pasa el
  esquema) no se reintentan; los TRANSITORIOS (el hijo murió, tiempo agotado)
  se reintentan con espera exponencial hasta `max_attempts`.
- SIGTERM (docker stop) abandona el trabajo en curso devolviéndolo a la cola al
  momento y sin contarlo como intento: un despliegue no es un fallo.
- Escala: varios contenedores (`docker compose up --scale analyzer=N`) se
  reparten la cola sin coordinarse (`SKIP LOCKED`).
"""

from __future__ import annotations

import json
import multiprocessing as mp
import os
import signal
import socket
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from daino_analyzer import ANALYZER_KEY, jobs, schema
from daino_analyzer.charter import CharterError, chart_from_analysis
from daino_analyzer.decode import sha256_file
from daino_analyzer.storage import audio_path

HEALTH_FILE = Path(os.environ.get("ANALYZER_HEALTH_FILE", "/tmp/daino-analyzer-alive"))


class AnalysisFailed(Exception):
    def __init__(self, code: str, message: str, *, permanent: bool):
        super().__init__(message)
        self.code = code
        self.permanent = permanent


class Cancelled(Exception):
    pass


@dataclass
class WorkerConfig:
    worker_id: str
    poll_seconds: float = 2.0
    lease_seconds: int = jobs.LEASE_SECONDS
    heartbeat_seconds: float = 10.0
    job_timeout_seconds: float = 900.0
    max_tasks_per_child: int = 20

    @staticmethod
    def from_env() -> "WorkerConfig":
        return WorkerConfig(
            worker_id=f"{socket.gethostname()}-{os.getpid()}",
            poll_seconds=float(os.environ.get("ANALYZER_POLL_SECONDS", "2")),
            job_timeout_seconds=float(os.environ.get("ANALYZER_JOB_TIMEOUT_SECONDS", "900")),
            max_tasks_per_child=int(os.environ.get("ANALYZER_MAX_TASKS_PER_CHILD", "20")),
        )


# --------------------------- Proceso hijo ---------------------------

def _child_main(conn) -> None:  # pragma: no cover - se ejecuta en otro proceso
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    from daino_analyzer import analysis
    from daino_analyzer.decode import DecodeError, decode_file
    from daino_analyzer.schema import SchemaError

    while True:
        try:
            msg = conn.recv()
        except EOFError:
            return
        if msg[0] == "stop":
            return
        try:
            audio = decode_file(msg[1])
            result = analysis.analyze(audio, progress=lambda stage, ratio: conn.send(("progress", stage, ratio)))
            schema.validate(result)
            conn.send(("result", result))
        except DecodeError as exc:
            conn.send(("error", "decode_failed", str(exc), True))
        except SchemaError as exc:
            conn.send(("error", "analysis_invalid", str(exc), True))
        except MemoryError:
            conn.send(("error", "out_of_memory", "Sin memoria para analizar este audio.", False))
        except Exception as exc:  # noqa: BLE001 - cualquier otro fallo se informa al padre
            conn.send(("error", "analysis_error", f"{type(exc).__name__}: {exc}"[:400], False))


class ChildAnalyzer:
    """Analiza en un proceso hijo persistente, con timeout y cancelación."""

    def __init__(self, max_tasks: int = 20):
        self._ctx = mp.get_context("spawn")
        self._proc = None
        self._conn = None
        self._tasks = 0
        self._max_tasks = max_tasks

    def run(self, path: Path, *, on_progress: Callable[[str, float], None], should_continue: Callable[[], bool],
            timeout_sec: float) -> dict:
        self._ensure()
        self._conn.send(("analyze", str(path)))
        deadline = time.monotonic() + timeout_sec
        try:
            while True:
                if self._conn.poll(0.25):
                    try:
                        msg = self._conn.recv()
                    except EOFError as exc:
                        raise self._crashed() from exc
                    kind = msg[0]
                    if kind == "progress":
                        on_progress(msg[1], float(msg[2]))
                    elif kind == "result":
                        self._tasks += 1
                        if self._tasks >= self._max_tasks:
                            self.close()
                        return msg[1]
                    elif kind == "error":
                        self._tasks += 1
                        raise AnalysisFailed(msg[1], msg[2], permanent=bool(msg[3]))
                elif not self._proc.is_alive():
                    raise self._crashed()
                if time.monotonic() > deadline:
                    self.kill()
                    raise AnalysisFailed("timeout", f"El análisis superó {timeout_sec:.0f} s.", permanent=False)
                if not should_continue():
                    self.kill()
                    raise Cancelled()
        except (AnalysisFailed, Cancelled):
            raise
        except BaseException:
            self.kill()
            raise

    def _crashed(self) -> AnalysisFailed:
        code = self._proc.exitcode if self._proc is not None else None
        self.kill()
        # -9 (SIGKILL) suele ser el OOM killer del sistema.
        return AnalysisFailed("analyzer_crashed", f"El proceso de análisis terminó inesperadamente (código {code}).", permanent=False)

    def _ensure(self) -> None:
        if self._proc is not None and self._proc.is_alive():
            return
        parent, child = self._ctx.Pipe()
        self._proc = self._ctx.Process(target=_child_main, args=(child,), daemon=True, name="daino-analysis")
        self._proc.start()
        child.close()
        self._conn = parent
        self._tasks = 0

    def kill(self) -> None:
        if self._proc is not None and self._proc.is_alive():
            self._proc.kill()
            self._proc.join(5)
        self._proc = None
        self._conn = None

    def close(self) -> None:
        if self._proc is not None and self._proc.is_alive():
            try:
                self._conn.send(("stop",))
                self._proc.join(10)
            except (BrokenPipeError, OSError):
                pass
        self.kill()


class InProcessAnalyzer:
    """Mismo contrato que ChildAnalyzer, en el proceso actual (tests, depuración)."""

    def run(self, path: Path, *, on_progress, should_continue, timeout_sec: float) -> dict:
        from daino_analyzer import analysis
        from daino_analyzer.decode import DecodeError, decode_file
        from daino_analyzer.schema import SchemaError

        def progress(stage, ratio):
            on_progress(stage, ratio)
            if not should_continue():
                raise Cancelled()

        try:
            result = analysis.analyze(decode_file(path), progress=progress)
            schema.validate(result)
            return result
        except DecodeError as exc:
            raise AnalysisFailed("decode_failed", str(exc), permanent=True) from exc
        except SchemaError as exc:
            raise AnalysisFailed("analysis_invalid", str(exc), permanent=True) from exc

    def close(self) -> None:
        pass


# --------------------------- Worker ---------------------------

class Worker:
    def __init__(self, connect: Callable, config: WorkerConfig, analyzer=None,
                 charter: Callable[[dict, str], dict] = chart_from_analysis,
                 root: Path | None = None, log: Callable[..., None] | None = None):
        self._connect = connect
        self.config = config
        self.analyzer = analyzer if analyzer is not None else ChildAnalyzer(config.max_tasks_per_child)
        self.charter = charter
        self.root = root
        self.log = log or _log
        self.conn = None
        self.stopping = False

    def _db(self):
        if self.conn is None or not self.conn.open:
            self.conn = self._connect()
        return self.conn

    def run_once(self) -> str | None:
        conn = self._db()
        reaped = jobs.reap_expired(conn)
        if reaped:
            self.log("jobs_reaped", count=reaped)
        job = jobs.claim(conn, self.config.worker_id, self.config.lease_seconds)
        if job is None:
            return None
        return self.process(job)

    def process(self, job: jobs.Job) -> str:
        conn = self._db()
        started = time.monotonic()
        state = {"stage": "starting", "progress": 0.0, "last_beat": 0.0, "alive": True}

        def beat(stage: str, progress: float, force: bool = False) -> bool:
            # Un cambio de etapa se escribe YA (son pocos por canción): quien
            # publica ve avanzar el progreso en vez de un salto cada latido.
            stage_changed = stage != state["stage"]
            state["stage"], state["progress"] = stage, progress
            now = time.monotonic()
            if force or stage_changed or now - state["last_beat"] >= self.config.heartbeat_seconds:
                state["last_beat"] = now
                state["alive"] = jobs.heartbeat(conn, job, self.config.worker_id, stage, progress, self.config.lease_seconds)
                _touch_health()
            return state["alive"] and not self.stopping

        self.log("job_started", job=job.id, level=job.level_id, attempt=job.attempts, purpose=job.purpose)
        try:
            path = audio_path(job.audio_path, self.root)
            if not path.is_file():
                raise AnalysisFailed("audio_missing", "El archivo de audio no existe en el servidor.", permanent=True)
            sha = sha256_file(path)
            if job.audio_sha256 is not None and sha != job.audio_sha256:
                raise AnalysisFailed("audio_mismatch", "El audio no coincide con el del nivel.", permanent=True)

            analysis = jobs.cached_analysis(conn, sha, ANALYZER_KEY)
            cached = analysis is not None
            if cached:
                try:
                    schema.validate(analysis)
                except schema.SchemaError:
                    analysis, cached = None, False
            if not beat("analyzing", 0.02, force=True):
                raise Cancelled()
            if analysis is None:
                analysis = self.analyzer.run(
                    path,
                    on_progress=lambda stage, ratio: beat(stage, 0.02 + 0.88 * ratio),
                    # El analizador pregunta varias veces por segundo. La reserva
                    # se renueva AQUÍ, por tiempo, no solo al llegar progreso: una
                    # etapa larga sin mensajes (el pulso de una canción de 20 min)
                    # dejaría caducar la reserva y otro worker repetiría el trabajo.
                    should_continue=lambda: beat(state["stage"], state["progress"]),
                    timeout_sec=self.config.job_timeout_seconds,
                )

            if not beat("charting", 0.92, force=True):
                raise Cancelled()
            try:
                charted = self.charter(analysis, sha)
            except CharterError as exc:
                raise AnalysisFailed("charter_failed", str(exc), permanent=True) from exc

            result = jobs.Result(
                audio_sha256=sha, analyzer_key=ANALYZER_KEY, analysis=analysis, chart=charted["chart"],
                difficulty=int(charted["difficulty"]), difficulty_ceiling=charted["difficultyCeiling"],
                charter_version=int(charted["chart"]["charter"]["version"]),
            )
            outcome = jobs.complete(conn, job, self.config.worker_id, result)
            self.log("job_done", job=job.id, level=job.level_id, outcome=outcome, cached_analysis=cached,
                     events=len(result.chart["events"]), ms=int((time.monotonic() - started) * 1000))
            return outcome
        except Cancelled:
            if self.stopping:
                # Parada ordenada (despliegue, docker stop): no es un fallo del
                # trabajo. Vuelve a la cola al momento y sin gastar un intento.
                jobs.release(conn, job, self.config.worker_id)
                self.log("job_released", job=job.id)
                return "released"
            self.log("job_cancelled", job=job.id, level=job.level_id)
            return "cancelled"
        except AnalysisFailed as exc:
            outcome = jobs.fail(conn, job, self.config.worker_id, exc.code, str(exc), permanent=exc.permanent)
            self.log("job_failed", job=job.id, level=job.level_id, code=exc.code, outcome=outcome, message=str(exc))
            return outcome

    def run_forever(self) -> int:
        signal.signal(signal.SIGTERM, self._stop)
        signal.signal(signal.SIGINT, self._stop)
        self.log("worker_started", worker=self.config.worker_id, analyzer=ANALYZER_KEY)
        while not self.stopping:
            _touch_health()
            try:
                if self.run_once() is None:
                    time.sleep(self.config.poll_seconds)
            except Exception as exc:  # noqa: BLE001 - un fallo de BD no debe tumbar el servicio
                self.log("worker_error", error=f"{type(exc).__name__}: {exc}"[:300])
                try:
                    if self.conn is not None:
                        self.conn.close()
                except Exception:  # noqa: BLE001
                    pass
                self.conn = None
                time.sleep(min(30.0, self.config.poll_seconds * 5))
        self.analyzer.close()
        self.log("worker_stopped", worker=self.config.worker_id)
        return 0

    def _stop(self, *_args) -> None:
        self.stopping = True


def run_forever() -> int:
    from daino_analyzer import db

    config = WorkerConfig.from_env()
    worker = Worker(lambda: db.connect_with_retry(log=lambda m: _log("db_waiting", message=m)), config)
    return worker.run_forever()


def health(max_age_sec: float = 120.0) -> int:
    try:
        age = time.time() - HEALTH_FILE.stat().st_mtime
    except FileNotFoundError:
        return 1
    return 0 if age <= max_age_sec else 1


def _touch_health() -> None:
    try:
        HEALTH_FILE.touch()
    except OSError:
        pass


def _log(event: str, **fields) -> None:
    sys.stdout.write(json.dumps({"ts": round(time.time(), 3), "event": event, **fields}, ensure_ascii=False) + "\n")
    sys.stdout.flush()
