# syntax=docker/dockerfile:1.7

# Imágenes de producción de Daino (Coolify, docker-compose.prod.yml).
#
#   target `php`  → PHP-FPM con el código, vendor sin dependencias de desarrollo
#                   y el manifest de Vite. Escucha en 9000 (FastCGI).
#   target `web`  → nginx con public/ y los assets compilados. Escucha en 80.
#
# Todo se construye dentro: ni vendor/, ni node_modules/, ni public/build/, ni
# .env del host (los excluye .dockerignore). El analizador tiene su propia
# imagen (analyzer/Dockerfile, target `production`).
#
#   docker build -f docker/production/Dockerfile --target php -t daino-php:prod .
#   docker build -f docker/production/Dockerfile --target web -t daino-web:prod .

ARG PHP_IMAGE=php:8.5.3-fpm-alpine

# --- Assets: Vite + Tailwind con Bun -----------------------------------------
FROM oven/bun:1.3.13-alpine AS assets
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY vite.config.js ./
COPY resources ./resources
# Tailwind busca clases también en las vistas PHP.
COPY app/Views ./app/Views
RUN bun run build

# --- PHP base: solo las extensiones que usa la app --------------------------
# El Dockerfile de desarrollo instala además intl y zip; la app no las usa (y
# intl en Alpine tarda mucho en compilar). pdo, mbstring, openssl, json y
# opcache ya vienen en la imagen.
FROM ${PHP_IMAGE} AS php-base
RUN set -eux; \
    apk add --no-cache --virtual .build-deps $PHPIZE_DEPS; \
    docker-php-ext-install -j"$(nproc)" pdo_mysql; \
    apk del --no-network .build-deps

# --- Vendor: composer install --no-dev ---------------------------------------
FROM php-base AS vendor
RUN apk add --no-cache unzip
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /src
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --no-scripts --no-autoloader
COPY app ./app
RUN composer dump-autoload --no-dev --classmap-authoritative

# --- PHP-FPM ------------------------------------------------------------------
FROM php-base AS php
COPY docker/php/php.prod.ini /usr/local/etc/php/conf.d/99-daino.ini
COPY docker/php/fpm-pool.prod.conf /usr/local/etc/php-fpm.d/zz-daino.conf
COPY docker/php/entrypoint.prod.sh /usr/local/bin/daino-entrypoint
WORKDIR /var/www/html
COPY composer.json ./
COPY --from=vendor /src/vendor ./vendor
COPY app ./app
COPY routes ./routes
COPY database ./database
COPY scripts ./scripts
COPY public ./public
COPY --from=assets /src/public/build ./public/build
# storage/ no está en el repo (salvo uploads/levels/.gitkeep): se crea aquí.
# sessions, uploads/levels y official van en volúmenes (docker-compose.prod.yml).
RUN set -eux; \
    chmod +x /usr/local/bin/daino-entrypoint; \
    mkdir -p storage/sessions storage/cache storage/logs storage/uploads/levels storage/official; \
    chown -R www-data:www-data storage
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD php -r 'exit(@fsockopen("127.0.0.1", 9000) ? 0 : 1);'
ENTRYPOINT ["daino-entrypoint"]
CMD ["php-fpm"]

# --- nginx ----------------------------------------------------------------------
FROM nginx:1.27-alpine AS web
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY public /var/www/html/public
COPY --from=assets /src/public/build /var/www/html/public/build
EXPOSE 80
# /api/health pasa por PHP: si responde, nginx y PHP están vivos.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/api/health || exit 1
