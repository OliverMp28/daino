"""Contorno melódico: a qué altura canta la melodía en cada momento (analizador 3).

Para qué: el vuelo del juego dibuja un camino con las notas que se mantienen, y
ese camino puede subir y bajar con la melodía de la canción ("se siente la música
en los altos y bajos"). No hace falta transcribir notas: basta con saber, fotograma
a fotograma, qué altura lleva la voz o el instrumento que canta.

Sin modelos ni dependencias nuevas, sobre el mismo CQT que la armonía (tonal.py,
un bin cada tercio de semitono, 93 ms por fotograma):

1. BLANQUEO. Cada bin frente a la mediana de su octava en el mismo fotograma: los
   parciales de una nota destacan; el colchón de acordes y el ruido de la batería
   (que ocupan muchas frecuencias a la vez) se quedan en cero.
2. SALIENCIA por suma de armónicos (Salamon y Gómez, 2012, simplificada): una
   altura candidata vale lo que suman sus 3 primeros armónicos con peso 0.6^(h−1),
   la mitad si su fundamental no destaca, y un 30 % más por cada octava hacia
   arriba: la melodía suele ser la voz más aguda. Medido con melodías sintéticas
   sobre acordes, bajo y batería (tests/test_melody.py): con 6 armónicos y sin
   preferir lo agudo, el camino seguía a la fundamental de los acordes (0-6 % de
   acierto); con esto, 89-100 %. En los 8 oficiales la altura mediana pasa de
   54-64 (el registro de los acordes) a 60-74 (el de la voz).
3. CAMINO por Viterbi: saltar de altura cuesta por semitono, así que una nota no
   parpadea entre su fundamental y un armónico, y un salto real (una octava entre
   frases) solo gana si se sostiene.
4. SONORIDAD: un fotograma lleva melodía si su saliencia pasa de una fracción de la
   típica de la canción y la música suena; los tramos sueltos de 1-2 fotogramas no
   cuentan.

Límites honestos: en una mezcla, "lo más saliente" es la voz casi siempre, pero un
solo de guitarra o un sintetizador que tape a la voz también es "la melodía", y en
pasajes sin melodía el camino sigue la voz más aguda del acompañamiento. Los
errores de octava existen (se miden en tests/test_melody.py). Por eso el charter
solo la usa para alturas RELATIVAS dentro de un tramo, nunca para notas absolutas,
y la comprobación de verdad es de oído: `sonify --melody` la hace sonar encima de
la canción. No se da una "confianza": las que se probaron (cuánto destaca la
candidata sobre su alternativa) no distinguían una melodía de un acompañamiento.

Coste medido: menos de medio segundo por canción de 4 min sobre el CQT ya hecho.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from daino_analyzer import tonal
from daino_analyzer.spectral import SR

HOP_SEC = tonal.HOP / SR
BINS_PER_SEMITONE = tonal.BINS_PER_OCTAVE // 12

MIN_MIDI = 50                       # D3: lo más grave que canta una voz con cuerpo
MAX_MIDI = 86                       # D6
HARMONICS = 3
HARMONIC_DECAY = 0.6
MISSING_FUNDAMENTAL = 0.5           # saliencia de una altura cuya fundamental no destaca
REGISTER_BIAS = 0.3                 # cuánto más vale una candidata por cada octava por encima de MIN_MIDI
LOG_GAIN = 100.0

JUMP_COST = 0.6                     # coste por semitono de cambiar de altura entre fotogramas…
JUMP_CAP = 7.0                      # …hasta este máximo (un salto grande sostenido se acepta)
EMISSION_GAIN = 12.0                # cuánto manda la saliencia frente al coste de saltar

VOICING_RATIO = 0.45                # sonoro si la saliencia del camino pasa de esta fracción de la típica…
SILENT_DB = -30.0                   # …y la música suena (energía respecto al percentil 95)
MIN_VOICED_FRAMES = 3               # tramos sonoros más cortos (≈ 0.28 s) no cuentan
MAX_GAP_FRAMES = 1                  # huecos de 1 fotograma dentro de una nota se rellenan



@dataclass(frozen=True)
class MelodyResult:
    hop_sec: float
    pitch: np.ndarray               # MIDI (con decimales) por fotograma; 0 = sin melodía
    voiced_ratio: float             # fracción de fotogramas con música que llevan melodía


def analyze(cq: tonal.ConstantQ, tuning_cents: float, duration: float) -> MelodyResult:
    frames = int(np.ceil(duration / HOP_SEC)) if duration > 0 else 0
    C = tonal.shift_cents(cq.magnitude, tuning_cents)
    n = min(C.shape[1], frames)
    if n == 0:
        return MelodyResult(hop_sec=HOP_SEC, pitch=np.zeros(frames), voiced_ratio=0.0)
    C = C[:, :n]

    W = _whiten(C)
    lo = (MIN_MIDI - tonal.FMIN_MIDI) * BINS_PER_SEMITONE
    hi = (MAX_MIDI - tonal.FMIN_MIDI) * BINS_PER_SEMITONE
    S = _salience(W, lo, hi)                                             # (candidatas, n)

    loud = _loudness_db(C, lo, hi) >= SILENT_DB
    scale = float(np.percentile(S.max(axis=0)[loud], 95)) if loud.any() else 0.0
    if scale <= 0:
        return MelodyResult(hop_sec=HOP_SEC, pitch=np.zeros(frames), voiced_ratio=0.0)
    E = np.minimum(S / scale, 1.5)

    path = _viterbi(EMISSION_GAIN * E)
    idx = np.arange(n)
    on_path = E[path, idx]
    typical = float(np.median(on_path[loud]))
    voiced = loud & (on_path >= VOICING_RATIO * typical)
    voiced = _clean_runs(voiced)

    pitch = np.zeros(frames)
    fine = path + _parabolic(S, path)
    pitch[:n] = np.where(voiced, MIN_MIDI + fine / BINS_PER_SEMITONE, 0.0)

    voiced_ratio = float(voiced.sum() / max(1, loud.sum()))
    return MelodyResult(hop_sec=HOP_SEC, pitch=pitch, voiced_ratio=voiced_ratio)


def _whiten(C: np.ndarray) -> np.ndarray:
    from scipy.ndimage import median_filter

    L = np.log1p(LOG_GAIN * C / max(float(C.max()), 1e-12))
    base = median_filter(L, size=(tonal.BINS_PER_OCTAVE + 1, 1), mode="nearest")
    return np.maximum(0.0, L - base)


def _salience(W: np.ndarray, lo: int, hi: int) -> np.ndarray:
    bins = W.shape[0]
    cand = np.arange(lo, hi + 1, dtype=np.float64)
    S = np.zeros((cand.size, W.shape[1]), dtype=np.float64)
    for h in range(1, HARMONICS + 1):
        pos = cand + tonal.BINS_PER_OCTAVE * np.log2(h)
        a = np.floor(pos).astype(int)
        frac = (pos - a)[:, None]
        ok = a + 1 < bins
        part = np.zeros_like(S)
        part[ok] = W[a[ok]] * (1 - frac[ok]) + W[a[ok] + 1] * frac[ok]
        S += HARMONIC_DECAY ** (h - 1) * part
    fundamental = W[lo:hi + 1] > 0
    octaves = (cand - lo) / tonal.BINS_PER_OCTAVE
    return S * np.where(fundamental, 1.0, MISSING_FUNDAMENTAL) * (1.0 + REGISTER_BIAS * octaves)[:, None]


def _loudness_db(C: np.ndarray, lo: int, hi: int) -> np.ndarray:
    energy = (C[lo:hi + 1] ** 2).sum(axis=0)
    ref = max(float(np.percentile(energy, 95)), 1e-20)
    return 10.0 * np.log10(np.maximum(energy, 1e-20) / ref)


def _viterbi(emission: np.ndarray) -> np.ndarray:
    k, n = emission.shape
    semis = np.abs(np.arange(k)[:, None] - np.arange(k)[None, :]) / BINS_PER_SEMITONE
    trans = -np.minimum(JUMP_COST * semis, JUMP_CAP)                     # (a, desde)
    score = emission[:, 0].copy()
    back = np.zeros((k, n), dtype=np.int32)
    for t in range(1, n):
        cand = score[None, :] + trans
        back[:, t] = np.argmax(cand, axis=1)
        score = cand[np.arange(k), back[:, t]] + emission[:, t]
    path = np.zeros(n, dtype=np.int32)
    path[-1] = int(np.argmax(score))
    for t in range(n - 1, 0, -1):
        path[t - 1] = back[path[t], t]
    return path


def _parabolic(S: np.ndarray, path: np.ndarray) -> np.ndarray:
    """Desplazamiento fraccionario del máximo alrededor del bin del camino, en bins."""
    k, n = S.shape
    idx = np.arange(n)
    left = S[np.clip(path - 1, 0, k - 1), idx]
    mid = S[path, idx]
    right = S[np.clip(path + 1, 0, k - 1), idx]
    denom = left - 2 * mid + right
    with np.errstate(divide="ignore", invalid="ignore"):
        delta = np.where(np.abs(denom) > 1e-12, 0.5 * (left - right) / denom, 0.0)
    return np.clip(delta, -0.5, 0.5)


def _clean_runs(voiced: np.ndarray) -> np.ndarray:
    v = voiced.copy()
    n = v.size
    # Huecos cortos dentro de una nota.
    i = 0
    while i < n:
        if v[i]:
            i += 1
            continue
        j = i
        while j < n and not v[j]:
            j += 1
        if 0 < i and j < n and j - i <= MAX_GAP_FRAMES:
            v[i:j] = True
        i = j
    # Tramos sonoros sueltos.
    i = 0
    while i < n:
        if not v[i]:
            i += 1
            continue
        j = i
        while j < n and v[j]:
            j += 1
        if j - i < MIN_VOICED_FRAMES:
            v[i:j] = False
        i = j
    return v
