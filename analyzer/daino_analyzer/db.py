"""Conexión a MariaDB (la misma base de datos que la web).

PyMySQL: puro Python, sin librerías de sistema. Transacciones explícitas
(autocommit desactivado): toda operación de la cola es "todo o nada".
"""

from __future__ import annotations

import os
import time

import pymysql
import pymysql.cursors


def settings_from_env() -> dict:
    return {
        "host": os.environ.get("DB_HOST", "mariadb"),
        "port": int(os.environ.get("DB_PORT", "3306")),
        "user": os.environ.get("DB_USER", "daino"),
        "password": os.environ.get("DB_PASSWORD", ""),
        "database": os.environ.get("DB_DATABASE", "daino"),
    }


def connect(settings: dict | None = None) -> pymysql.connections.Connection:
    s = settings or settings_from_env()
    return pymysql.connect(
        host=s["host"], port=s["port"], user=s["user"], password=s["password"], database=s["database"],
        charset="utf8mb4", autocommit=False, cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10, read_timeout=60, write_timeout=60,
    )


def connect_with_retry(settings: dict | None = None, *, attempts: int = 30, log=print) -> pymysql.connections.Connection:
    """La base de datos puede tardar en estar lista al arrancar el contenedor."""
    delay = 1.0
    for i in range(attempts):
        try:
            return connect(settings)
        except pymysql.err.OperationalError as exc:
            if i == attempts - 1:
                raise
            log(f"base de datos no disponible ({exc.args[0]}), reintento en {delay:.0f} s")
            time.sleep(delay)
            delay = min(delay * 2, 15.0)
    raise RuntimeError("inalcanzable")
