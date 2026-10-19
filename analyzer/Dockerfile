# Analizador musical de Daino (Ola 4).
#
# Python 3.12 + ffmpeg + librosa + beat_this (PyTorch CPU) + Node 22.
#
# Por qué Debian 13 (trixie): su ffmpeg 7.1 decodifica los MP3 BIT A BIT igual
# que el ffmpeg 8.1 de referencia, que a su vez produce las mismas muestras que
# Chrome (medido, Sep 2026). Un chart solo va sincronizado si el servidor
# analiza exactamente el audio que suena en el navegador.
#
# Por qué Node dentro: el CHARTING (qué obstáculo va dónde) tiene una sola
# implementación, en JS, compartida con el navegador (doc 10 §2.1). El worker
# analiza en Python y llama al charter JS para generar el chart.
#
# Contexto de build: la RAÍZ del repo (la imagen de producción necesita el
# charter de resources/js y scripts/). Dos targets:
#   dev         (por defecto) el código se monta en vivo (docker-compose.yml).
#   production  el código del worker y del charter van dentro de la imagen
#               (docker-compose.prod.yml).

FROM node:22-trixie-slim AS node

FROM python:3.12-slim-trixie AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TORCH_HOME=/opt/models \
    NUMBA_CACHE_DIR=/tmp/numba-cache \
    MPLCONFIGDIR=/tmp/matplotlib

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# torch y torchaudio de CPU primero y fijados: así beat-this no instala la
# variante CUDA de PyPI (varios GB) y la imagen es reproducible.
#
# torchaudio va por detrás de torch: está en mantenimiento y su última rueda de
# CPU es la 2.11. No hay problema de ABI porque beat_this solo usa
# `torchaudio.transforms.MelSpectrogram` (Python sobre operaciones de torch) y
# recibe el audio ya decodificado, sin `torchaudio.load`. Al subir torch, pasar
# `tests/` (test_beats.py mide la precisión del seguimiento).
ARG TORCH_VERSION=2.14.0
ARG TORCHAUDIO_VERSION=2.11.0
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}" "torchaudio==${TORCHAUDIO_VERSION}"

COPY analyzer/requirements.lock ./
RUN pip install -r requirements.lock

# Pesos del modelo dentro de la imagen: el worker no depende de internet ni de
# que el servidor de la universidad esté disponible al arrancar.
ARG BEAT_THIS_CHECKPOINT=final0
RUN python -c "from beat_this.inference import load_checkpoint; load_checkpoint('${BEAT_THIS_CHECKPOINT}')" \
    && chmod -R a+rX /opt/models

RUN useradd --system --uid 10001 --home-dir /tmp analyzer

ENTRYPOINT ["python", "-m", "daino_analyzer"]
CMD ["worker"]

# --- Producción ----------------------------------------------------------------
# La misma estructura que monta docker-compose.yml en desarrollo, en solo
# lectura dentro de la imagen: /srv/daino/{analyzer, resources/js, scripts,
# package.json}. Los audios llegan por volúmenes compartidos con PHP.
FROM base AS production
ENV DAINO_ROOT=/srv/daino \
    PYTHONPATH=/srv/daino/analyzer
WORKDIR /srv/daino/analyzer
COPY package.json /srv/daino/package.json
COPY resources/js /srv/daino/resources/js
COPY scripts /srv/daino/scripts
COPY analyzer/daino_analyzer ./daino_analyzer
USER analyzer

# --- Desarrollo (target por defecto: el último) ----------------------------------
FROM base AS dev
COPY analyzer/daino_analyzer ./daino_analyzer
COPY analyzer/tests ./tests
USER analyzer
