#!/bin/sh
# Arranque del contenedor PHP de producción.
#
# 1. Los volúmenes (sesiones, audios) pueden llegar vacíos y de root: PHP-FPM
#    escribe en ellos como www-data.
# 2. Aplica las migraciones pendientes (scripts/migrate.php es idempotente).
#    DAINO_MIGRATE_ON_START=false lo desactiva. Si la BD no responde en ~60 s,
#    el contenedor sale con error: mejor un despliegue fallido y visible que
#    servir con un esquema viejo.
# 3. Arranca PHP-FPM (o lo que se pase como comando).
set -eu

cd /var/www/html

for dir in storage/sessions storage/cache storage/logs storage/uploads/levels storage/official; do
    mkdir -p "$dir"
    chown www-data:www-data "$dir"
done

if [ "${1:-}" = "php-fpm" ] && [ "${DAINO_MIGRATE_ON_START:-true}" = "true" ]; then
    tries=0
    # Como www-data: el bootstrap abre una sesión y su archivo no debe ser de root.
    until su -s /bin/sh www-data -c 'php scripts/migrate.php run'; do
        tries=$((tries + 1))
        if [ "$tries" -ge 30 ]; then
            echo "[daino] migraciones: la base de datos no responde, me rindo" >&2
            exit 1
        fi
        echo "[daino] migraciones: reintento en 2 s ($tries/30)" >&2
        sleep 2
    done
fi

exec docker-php-entrypoint "$@"
