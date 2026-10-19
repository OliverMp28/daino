"""El interruptor del analizador: `ANALYZER_ENABLED`, la misma variable que lee PHP.

Apagado, el contenedor sigue en pie y sano sin abrir la base de datos: así se
enciende cambiando la variable, sin tocar el compose de producción.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

from daino_analyzer.cli import analyzer_enabled, main


def test_sin_definir_esta_encendido():
    assert analyzer_enabled({}) is True
    assert analyzer_enabled({"ANALYZER_ENABLED": ""}) is True


def test_apagado_con_los_valores_de_php():
    for value in ("false", "FALSE", "0", "no", "off", " Off "):
        assert analyzer_enabled({"ANALYZER_ENABLED": value}) is False, value
    for value in ("true", "1", "yes", "on"):
        assert analyzer_enabled({"ANALYZER_ENABLED": value}) is True, value


def test_apagado_el_healthcheck_dice_sano(monkeypatch):
    monkeypatch.setenv("ANALYZER_ENABLED", "false")
    assert main(["health"]) == 0


def test_apagado_el_worker_espera_sin_tocar_la_bd_y_para_con_sigterm():
    env = {**os.environ, "ANALYZER_ENABLED": "false", "DB_HOST": "no-existe.invalid"}
    proc = subprocess.Popen([sys.executable, "-m", "daino_analyzer", "worker"], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline()
        assert '"worker_disabled"' in line, line
        time.sleep(0.3)
        assert proc.poll() is None, "sigue en pie aunque la BD no exista"
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=5) == 0
    finally:
        if proc.poll() is None:
            proc.kill()
