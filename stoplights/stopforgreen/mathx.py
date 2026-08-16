from __future__ import annotations

import hashlib
import math
from typing import Iterable, Sequence

import numpy as np


EPS = 1e-12


def clamp01(x: float) -> float:
    return float(max(0.0, min(1.0, x)))


def sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def entropy_categorical(probs: Sequence[float]) -> float:
    total = 0.0
    for p in probs:
        p = clamp01(float(p))
        if p > EPS:
            total -= p * math.log2(p)
    return float(total)


def normalized_entropy(probs: Sequence[float]) -> float:
    if len(probs) <= 1:
        return 0.0
    return clamp01(entropy_categorical(probs) / math.log2(len(probs)))


def safe_mean(values: Iterable[float], default: float = 0.0) -> float:
    vals = [float(v) for v in values]
    if not vals:
        return float(default)
    return float(sum(vals) / len(vals))


def deterministic_hash_int(text: str) -> int:
    return int.from_bytes(
        hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest(),
        "big",
    )


def stable_offset(name: str, cycle_s: float) -> float:
    return float(deterministic_hash_int("StopForGreen|" + name) % max(1, int(round(cycle_s))))


def robust_quantile(x: np.ndarray, q: float) -> float:
    return float(np.quantile(np.asarray(x, dtype=float), q))


def seconds_since_midnight(dt) -> float:
    return float(
        dt.hour * 3600
        + dt.minute * 60
        + dt.second
        + dt.microsecond / 1_000_000
    )
