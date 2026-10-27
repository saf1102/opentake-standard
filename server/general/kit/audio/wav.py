"""WAV in and out without soundfile/soxr (the OpenTake Python has numpy and scipy only).

    from wav import write, read, resample
    write('audio/mix.wav', stereo_float_array, 48000)   # shape (n,) or (n, 2), float in -1..1
    x, sr = read('some.wav')                             # float32, shape (n, channels)
    y = resample(x, sr, 48000)
"""
from math import gcd

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly


def write(path, data, sr=48000):
    x = np.asarray(data, dtype=np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 1.0:
        x = x / peak * 0.98
    wavfile.write(path, int(sr), (np.clip(x, -1, 1) * 32767).astype(np.int16))


def read(path):
    sr, x = wavfile.read(path)
    if x.dtype.kind == 'i':
        x = x.astype(np.float32) / float(np.iinfo(x.dtype).max)
    elif x.dtype.kind == 'u':
        x = (x.astype(np.float32) - 128) / 128
    x = x.astype(np.float32)
    if x.ndim == 1:
        x = x[:, None]
    return x, sr


def resample(x, sr_from, sr_to):
    if sr_from == sr_to:
        return x
    g = gcd(int(sr_from), int(sr_to))
    return resample_poly(x, int(sr_to) // g, int(sr_from) // g, axis=0).astype(np.float32)
