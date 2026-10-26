# syntax=docker/dockerfile:1.7

# Daino PHP-FPM (desarrollo). Versión exacta, la misma que la imagen
# de producción (docker/production/Dockerfile): 8.5.12 corrige CVE-2026-109618 y
# CVE-2026-109619. Alpine para imagen ligera. Sin tags flotantes (":8.5"): cada
# parche de PHP se sube a mano en los dos Dockerfiles, en composer.json y en el
# tag de la imagen de docker-compose.yml.
FROM php:8.5.12-fpm-alpine

LABEL org.opencontainers.image.title="Daino PHP-FPM"
LABEL org.opencontainers.image.description="Runtime PHP para el backend de Daino (Resource Server contra Vout IdP)."
LABEL org.opencontainers.image.source="https://github.com/OliverMp28/daino"

# Dependencias del sistema + extensiones PHP
#
# Notas sobre PHP 8.5:
#   - `pdo` ya viene cargado en la imagen base (php:8.5-fpm-alpine);
#     intentar instalarlo suelta un warning "already loaded" — lo omitimos.
#   - `opcache` forma parte del binario CORE de PHP desde 8.5
#     (RFC "Make OPcache a non-optional part of PHP"). Ya no es una
#     extensión separada: está siempre presente y activa. No se instala
#     ni se habilita; las directivas `opcache.*` del .ini sí siguen
#     funcionando como siempre.
#     Refs:
#       - https://github.com/docker-library/php/issues/1605
#       - https://wiki.php.net/rfc/make_opcache_required
RUN set -eux; \
    apk add --no-cache --virtual .build-deps \
        autoconf \
        g++ \
        make \
        linux-headers \
        icu-dev \
        libzip-dev \
    ; \
    apk add --no-cache \
        bash \
        git \
        icu-libs \
        libzip \
        tzdata \
    ; \
    docker-php-ext-install -j"$(nproc)" \
        pdo_mysql \
        intl \
        zip \
    ; \
    apk del --no-network .build-deps

# Composer desde la imagen oficial
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

# Opcache afinado para desarrollo. Sobrescribe en producción via otro .ini.
RUN { \
        echo 'opcache.enable=1'; \
        echo 'opcache.memory_consumption=128'; \
        echo 'opcache.interned_strings_buffer=16'; \
        echo 'opcache.max_accelerated_files=10000'; \
        echo 'opcache.validate_timestamps=1'; \
        echo 'opcache.revalidate_freq=0'; \
        echo 'opcache.jit=tracing'; \
        echo 'opcache.jit_buffer_size=64M'; \
    } > /usr/local/etc/php/conf.d/99-daino-opcache.ini

# Timezone por defecto; se puede override via PHP_INI_DIR en runtime.
RUN echo 'date.timezone = UTC' > /usr/local/etc/php/conf.d/00-daino-timezone.ini

WORKDIR /var/www/html

# El usuario www-data ya existe en la imagen base; volumes montarán como ese UID.
EXPOSE 9000
CMD ["php-fpm"]
