"""Decodificación: que el servidor analice EXACTAMENTE el audio que suena en el navegador."""

from __future__ import annotations

import subprocess
import wave

import numpy as np
import pytest

from daino_analyzer.decode import SAMPLE_RATE, DecodeError, decode_file, sha256_file


def _write_wav(path, mono: np.ndarray) -> None:
    pcm = (np.clip(mono, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())


def test_mp3_encoder_delay_is_trimmed_and_clicks_stay_in_place(tmp_path):
    """Un MP3 añade ~1100 muestras de retardo del codificador al principio. Si el
    decodificador no las recorta (como hace Chrome), todo el nivel iría ~25 ms tarde."""
    n = SAMPLE_RATE * 6
    mono = np.zeros(n, dtype=np.float32)
    clicks = [SAMPLE_RATE * 1, int(SAMPLE_RATE * 2.5), SAMPLE_RATE * 4]
    for c in clicks:
        mono[c: c + 40] = np.hanning(40)
    wav = tmp_path / "clicks.wav"
    mp3 = tmp_path / "clicks.mp3"
    _write_wav(wav, mono)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)], check=True)

    audio = decode_file(mp3)
    assert audio.sample_rate == SAMPLE_RATE
    assert audio.samples.shape[0] == 2
    assert abs(audio.samples.shape[1] - n) <= 1152, "longitud del original: sin padding de relleno al final"

    decoded = np.abs(audio.mono)
    for c in clicks:
        peak = c - 100 + int(np.argmax(decoded[c - 100: c + 140]))
        assert abs(peak - (c + 20)) <= 3, f"clic en la muestra {c + 20}, decodificado en {peak}"


def test_sha256_matches_hashlib_for_the_file(tmp_path):
    p = tmp_path / "x.bin"
    p.write_bytes(b"daino" * 1000)
    import hashlib

    assert sha256_file(p) == hashlib.sha256(b"daino" * 1000).hexdigest()


def test_not_audio_is_a_permanent_decode_error(tmp_path):
    p = tmp_path / "fake.mp3"
    p.write_bytes(b"<?php echo 'no soy audio'; ?>" * 50)
    with pytest.raises(DecodeError):
        decode_file(p)


def test_missing_or_too_short_file_fails_clearly(tmp_path):
    with pytest.raises(DecodeError):
        decode_file(tmp_path / "no-existe.mp3")
    wav = tmp_path / "short.wav"
    _write_wav(wav, np.zeros(SAMPLE_RATE // 4, dtype=np.float32))
    with pytest.raises(DecodeError, match="menos de un segundo"):
        decode_file(wav)


def test_too_long_audio_is_rejected_before_analysis(tmp_path):
    wav = tmp_path / "long.wav"
    _write_wav(wav, np.zeros(SAMPLE_RATE * 5, dtype=np.float32))
    with pytest.raises(DecodeError, match="más de"):
        decode_file(wav, max_duration_sec=3)
