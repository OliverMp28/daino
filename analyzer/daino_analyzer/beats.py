"""Beats y downbeats: el pulso de la canción.

Seguimiento con beat_this (Foscarin, Schlüter & Widmer, ISMIR 2024; CPJKU, MIT):
red neuronal entrenada con miles de canciones anotadas por humanos. Medido con
audio de verdad conocida (tests/test_beats.py): F-measure de beats 0.93-0.99 y
de downbeats 0.94-0.99 entre 90 y 174 BPM, con swing, en 3/4 y con secciones sin
batería.

Dos correcciones propias sobre su salida:

1. AFINADO. beat_this trabaja a 50 fotogramas por segundo: sus beats caen en
   múltiplos de 20 ms y el error medido llegaba a 16-27 ms. Para un juego de
   ritmo es demasiado. Cada beat se lleva al pico de onset más cercano (±35 ms)
   si hay un golpe claro ahí; si no lo hay (un tramo sin batería), se conserva.
2. SILENCIO. En colas y huecos silenciosos el modelo sigue "marcando el paso".
   Esos beats no tienen música debajo y se descartan.

El tempo sale de los intervalos entre beats reales, no de una autocorrelación
global: sigue a la canción si acelera y dice cuánto se puede fiar de él.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass

import numpy as np

from daino_analyzer.onsets import LATENCY_S, Envelopes
from daino_analyzer.spectral import Spectral

CHECKPOINT = os.environ.get("BEAT_THIS_CHECKPOINT", "final0")

REFINE_WINDOW_S = 0.035
REFINE_MIN_PEAK = 0.12          # pico mínimo (escala de la envolvente) para mover un beat
REFINE_MEDIAN_RATIO = 3.0       # …y claramente por encima de su entorno
SILENCE_DB = -50.0              # dB respecto al máximo de la canción
SILENCE_CONTEXT_S = 0.25


@dataclass(frozen=True)
class BeatResult:
    beats: np.ndarray
    downbeats: np.ndarray
    meter: int | None
    bpm: float
    beat_period_s: float
    tempo_stability: float        # [0,1] fracción de intervalos coherentes con su entorno
    beat_support: float           # [0,1] fracción de beats con un golpe real debajo
    model: str
    level_doubled: bool = False   # el pulso real iba al doble del que marcó el modelo


_model_lock = threading.Lock()
_model = None


def _beat_this():
    """Modelo cargado una vez por proceso (tarda ~2 s y ocupa ~80 MB)."""
    global _model
    with _model_lock:
        if _model is None:
            import torch
            from beat_this.inference import Audio2Beats

            threads = int(os.environ.get("ANALYZER_TORCH_THREADS", "0") or 0)
            if threads > 0:
                torch.set_num_threads(threads)
            _model = Audio2Beats(checkpoint_path=CHECKPOINT, device="cpu", dbn=False)
        return _model


def raw_track(mono44: np.ndarray, sr: int = 44100) -> tuple[np.ndarray, np.ndarray, str]:
    try:
        model = _beat_this()
        beats, downbeats = model(mono44, sr)
        return np.asarray(beats, dtype=np.float64), np.asarray(downbeats, dtype=np.float64), f"beat_this:{CHECKPOINT}"
    except ImportError:  # pragma: no cover - solo sin torch instalado
        import librosa

        _, beats = librosa.beat.beat_track(y=mono44, sr=sr, units="time")
        return np.asarray(beats, dtype=np.float64), np.array([]), "librosa.beat_track"


def track(mono44: np.ndarray, spec: Spectral, envs: Envelopes, sr: int = 44100) -> BeatResult:
    raw_beats, raw_down, model = raw_track(mono44, sr)
    level_db = _level_db(spec)

    beats = _drop_silent(raw_beats, level_db, spec.hop_sec)
    beats, doubled = _normalize_level(beats, envs)
    beats, supported = _refine(beats, envs)
    beats = _count_through_gaps(beats, supported)
    order = np.argsort(beats)
    beats, supported = beats[order], supported[order]
    beats = np.round(beats, 4)
    downbeats = _snap(raw_down, beats, max_dist=0.1)

    ibi = np.diff(beats)
    if len(ibi) >= 1:
        period = float(np.median(ibi))
    else:
        period = 0.5
    return BeatResult(
        beats=beats,
        downbeats=downbeats,
        meter=_meter(beats, downbeats),
        bpm=60.0 / period,
        beat_period_s=period,
        tempo_stability=_stability(ibi),
        beat_support=float(np.mean(supported)) if len(supported) else 0.0,
        model=model,
        level_doubled=doubled,
    )


# --------------------------- Nivel métrico ---------------------------

# Acento normalizado de los puntos intermedios a partir del cual la canción va
# en realidad al doble. Medido en canciones reales: 1.02 donde el pulso real es
# el doble (el modelo alternaba niveles); entre −0.02 y 0.38 en el resto
# (corcheas normales o canciones lentas de verdad). Ver docstring de
# `_normalize_level`.
DOUBLE_ACCENT_RATIO = 0.75
MAX_DOUBLED_BPM = 190.0
ACCENT_WINDOW_S = 0.035


def _accent(env: np.ndarray, hop: float, times: np.ndarray) -> float:
    w = max(1, int(round(ACCENT_WINDOW_S / hop)))
    vals = []
    for t in times:
        k = int(round(t / hop))
        lo, hi = max(0, k - w), min(len(env), k + w + 1)
        if lo < hi:
            vals.append(float(env[lo:hi].max()))
    return float(np.mean(vals)) if vals else 0.0


def _normalize_level(beats: np.ndarray, envs: Envelopes) -> tuple[np.ndarray, bool]:
    """Un único nivel métrico coherente para toda la canción.

    El modelo marca el pulso que tocaría una persona, y a veces cambia de nivel a
    mitad de canción (medido: en una canción, 24 intervalos a la mitad del resto).
    Se decide con evidencia acústica, no con un tempo "preferido":

    - Acento de los PUNTOS INTERMEDIOS entre beats, normalizado: 0 = como un
      instante cualquiera, 1 = tan acentuado como los propios beats. Si llega a
      `DOUBLE_ACCENT_RATIO`, lo que suena entre beats es tan fuerte como los
      beats: el pulso real es el doble y se densifica la canción entera.
    - Si no, los tramos donde el modelo se fue al doble se reducen al nivel
      dominante conservando la fase, y los beats que se saltó se rellenan.
    """
    if len(beats) < 8:
        return beats, False
    env, hop = envs.full, envs.hop_sec
    ibi = np.diff(beats)
    period = float(np.median(ibi))

    regular = (ibi > 0.85 * period) & (ibi < 1.15 * period)
    mids = (beats[:-1][regular] + beats[1:][regular]) / 2
    # Referencia "instante cualquiera": una rejilla densa sin relación con el
    # pulso (paso irracional respecto al periodo). Determinista, a diferencia de
    # instantes aleatorios.
    probe = np.arange(beats[0], beats[-1], period * 0.1234567)
    a_beat, a_mid, a_any = _accent(env, hop, beats), _accent(env, hop, mids), _accent(env, hop, probe)
    if a_beat - a_any > 0.02 and len(mids) >= 4:
        ratio = (a_mid - a_any) / (a_beat - a_any)
        if ratio >= DOUBLE_ACCENT_RATIO and 120.0 / period <= MAX_DOUBLED_BPM:
            return _densify(beats, period / 2), True

    # Reducir tramos al doble: se recorre la canción esperando un beat cada
    # `period`; lo que llega demasiado pronto sobra, salvo que sea el más cercano
    # a lo esperado.
    kept = [float(beats[0])]
    i = 1
    n = len(beats)
    while i < n:
        expected = kept[-1] + period
        j = i
        candidates = []
        while j < n and beats[j] < kept[-1] + 1.35 * period:
            candidates.append(j)
            j += 1
        if not candidates:
            kept.append(float(beats[i]))       # hueco: se rellena después
            i += 1
            continue
        best = min(candidates, key=lambda c: abs(beats[c] - expected))
        if beats[best] - kept[-1] >= 0.7 * period:
            kept.append(float(beats[best]))
        i = candidates[-1] + 1
    return _densify(np.array(kept), period, only_gaps=True), False


def _densify(beats: np.ndarray, period: float, only_gaps: bool = False) -> np.ndarray:
    """Inserta beats equiespaciados en intervalos que valen varios `period`.

    `only_gaps`: solo rellena beats saltados (intervalos de 1.7-4.3 periodos); los
    huecos más largos suelen ser silencios y se dejan vacíos."""
    out = [float(beats[0])]
    for a, b in zip(beats[:-1], beats[1:]):
        steps = int(round((b - a) / period))
        if steps >= 2 and (not only_gaps or ((b - a) >= 1.7 * period and steps <= 4)):
            out.extend(float(a + (b - a) * k / steps) for k in range(1, steps))
        out.append(float(b))
    return np.array(out)


def _level_db(spec: Spectral) -> np.ndarray:
    power = spec.mel.mean(axis=0)
    ref = max(float(np.max(power)), 1e-12)
    return 10.0 * np.log10(np.maximum(power, ref * 1e-10) / ref)


def _drop_silent(beats: np.ndarray, level_db: np.ndarray, hop: float) -> np.ndarray:
    if len(beats) == 0:
        return beats
    ctx = max(1, int(round(SILENCE_CONTEXT_S / hop)))
    keep = []
    for b in beats:
        k = int(round(b / hop))
        lo, hi = max(0, k - ctx), min(len(level_db), k + ctx + 1)
        if lo < hi and float(np.max(level_db[lo:hi])) >= SILENCE_DB:
            keep.append(b)
    return np.array(keep)


def _refine(beats: np.ndarray, envs: Envelopes) -> tuple[np.ndarray, np.ndarray]:
    env = envs.full
    hop = envs.hop_sec
    w = max(1, int(round(REFINE_WINDOW_S / hop)))
    ctx = max(1, int(round(1.0 / hop)))
    out = np.empty(len(beats))
    supported = np.zeros(len(beats), dtype=bool)
    for i, b in enumerate(beats):
        k = int(round(b / hop))
        lo, hi = max(1, k - w), min(len(env) - 1, k + w + 1)
        if lo >= hi:
            out[i] = b
            continue
        j = lo + int(np.argmax(env[lo:hi]))
        peak = float(env[j])
        local = float(np.median(env[max(0, j - ctx): j + ctx]))
        if peak >= REFINE_MIN_PEAK and peak >= REFINE_MEDIAN_RATIO * max(local, 1e-6):
            a, c = float(env[j - 1]), float(env[j + 1])
            denom = a - 2 * peak + c
            frac = 0.5 * (a - c) / denom if abs(denom) > 1e-12 else 0.0
            # Misma envolvente que los onsets, misma corrección de latencia: un
            # beat afinado y el onset del mismo golpe coinciden al milisegundo.
            out[i] = (j + float(np.clip(frac, -0.5, 0.5))) * hop - LATENCY_S
            supported[i] = True
        else:
            out[i] = b
    return out, supported


def _count_through_gaps(beats: np.ndarray, supported: np.ndarray, max_tempo_dev: float = 0.12) -> np.ndarray:
    """Beats sin golpe debajo, encerrados entre beats con golpe: se reparten
    uniformemente entre esas dos anclas, como cuenta un músico a través de un
    puente sin batería.

    Medido (audio sintético con un puente de 4 compases de acorde sostenido): ahí
    el modelo deriva hasta 69 ms porque no hay nada que lo ancle; contando entre
    anclas el error vuelve a pocos ms. Solo se aplica si el hueco cuadra con el
    tempo de alrededor (±12 %): si la canción cambió de tempo en el hueco, se
    respeta lo que dijo el modelo.
    """
    out = beats.copy()
    n = len(beats)
    i = 0
    while i < n:
        if supported[i]:
            i += 1
            continue
        j = i
        while j < n and not supported[j]:
            j += 1
        # Tramo sin apoyo [i, j). Necesita ancla a ambos lados.
        if i > 0 and j < n:
            a, b = i - 1, j
            intervals = b - a
            neighbors = []
            for k in range(max(1, a - 3), a + 1):
                if supported[k] and supported[k - 1]:
                    neighbors.append(beats[k] - beats[k - 1])
            for k in range(b + 1, min(n, b + 4)):
                if supported[k] and supported[k - 1]:
                    neighbors.append(beats[k] - beats[k - 1])
            if neighbors:
                period = float(np.median(neighbors))
                spacing = (beats[b] - beats[a]) / intervals
                if abs(spacing - period) <= max_tempo_dev * period:
                    out[i:j] = beats[a] + spacing * np.arange(1, intervals)
        i = j
    return out


def _snap(times: np.ndarray, beats: np.ndarray, max_dist: float) -> np.ndarray:
    if len(times) == 0 or len(beats) == 0:
        return np.array([])
    snapped = []
    for t in times:
        k = int(np.argmin(np.abs(beats - t)))
        if abs(beats[k] - t) <= max_dist:
            snapped.append(beats[k])
    return np.unique(np.array(snapped))


def _meter(beats: np.ndarray, downbeats: np.ndarray) -> int | None:
    if len(downbeats) < 3:
        return None
    idx = np.searchsorted(beats, downbeats)
    counts = np.diff(idx)
    counts = counts[(counts >= 2) & (counts <= 12)]
    if len(counts) == 0:
        return None
    values, freq = np.unique(counts, return_counts=True)
    return int(values[np.argmax(freq)])


def _stability(ibi: np.ndarray) -> float:
    """Fracción de intervalos a ±8 % de la mediana de sus 8 vecinos. Sigue a una
    canción que acelera (la mediana es local) y castiga saltos de nivel. Los
    huecos de más de 1.6 periodos (silencios, donde no hay beats a propósito) no
    cuentan: no dicen nada de la regularidad del pulso."""
    n = len(ibi)
    if n < 4:
        return 0.0
    period = float(np.median(ibi))
    ok = total = 0
    for i in range(n):
        if ibi[i] > 1.6 * period:
            continue
        total += 1
        lo, hi = max(0, i - 4), min(n, i + 5)
        med = float(np.median(ibi[lo:hi]))
        if med > 0 and abs(ibi[i] - med) <= 0.08 * med:
            ok += 1
    return ok / total if total else 0.0
