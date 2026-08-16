from __future__ import annotations

import math

import numpy as np

from .mathx import clamp01, normalized_entropy, sigmoid
from .models import EnvironmentObservation, EnvironmentPosterior, QuantumRGB


def _weighted(obs: EnvironmentObservation, weights: dict[str, float]) -> float:
    num = 0.0
    den = 0.0
    for key, w in weights.items():
        num += float(getattr(obs, key)) * w
        den += abs(w)
    return clamp01(num / den) if den else 0.0


def fuse_environment(obs: EnvironmentObservation) -> EnvironmentPosterior:
    obs = obs.clipped()

    pressure = _weighted(
        obs,
        {
            "event_pressure": 0.30,
            "flow_uncertainty": 0.23,
            "pedestrian_pressure": 0.20,
            "incident_pressure": 0.17,
            "workzone_pressure": 0.10,
        },
    )
    hazard = _weighted(
        obs,
        {
            "weather_risk": 0.22,
            "workzone_pressure": 0.22,
            "incident_pressure": 0.20,
            "road_surface_risk": 0.24,
            "pedestrian_pressure": 0.12,
        },
    )

    coherence = clamp01(
        0.48 * (1.0 - obs.flow_uncertainty)
        + 0.24 * obs.visibility_quality
        + 0.14 * (1.0 - obs.incident_pressure)
        + 0.14 * (1.0 - obs.event_pressure)
    )

    vector = np.array(
        [
            obs.event_pressure,
            obs.weather_risk,
            obs.workzone_pressure,
            obs.flow_uncertainty,
            obs.pedestrian_pressure,
            obs.incident_pressure,
            1.0 - obs.visibility_quality,
            obs.road_surface_risk,
        ],
        dtype=float,
    )
    contradiction = clamp01(float(np.std(vector) / 0.5))
    simplex = (vector + 0.03) / float((vector + 0.03).sum())
    modality_entropy = normalized_entropy(simplex.tolist())

    confidence = clamp01(
        obs.source_reliability
        * (0.88 - 0.32 * contradiction)
        * (0.90 + 0.10 * coherence)
    )

    return EnvironmentPosterior(
        pressure=pressure,
        coherence=coherence,
        hazard=hazard,
        confidence=confidence,
        contradiction=contradiction,
        modality_entropy=modality_entropy,
    )


def encode_rgb(env: EnvironmentPosterior) -> tuple[float, float, float]:
    r = clamp01(
        0.72 * env.pressure
        + 0.18 * env.contradiction
        + 0.10 * env.hazard
    )
    g = clamp01(
        0.78 * env.coherence
        + 0.14 * env.confidence
        + 0.08 * (1.0 - env.hazard)
    )
    b = clamp01(
        0.74 * env.hazard
        + 0.16 * env.modality_entropy
        + 0.10 * env.contradiction
    )
    return r, g, b


def RX(theta: float) -> np.ndarray:
    c = math.cos(theta / 2.0)
    s = math.sin(theta / 2.0)
    return np.array([[c, -1j * s], [-1j * s, c]], dtype=np.complex128)


def RY(theta: float) -> np.ndarray:
    c = math.cos(theta / 2.0)
    s = math.sin(theta / 2.0)
    return np.array([[c, -s], [s, c]], dtype=np.complex128)


def RZ(theta: float) -> np.ndarray:
    return np.array(
        [[np.exp(-0.5j * theta), 0], [0, np.exp(0.5j * theta)]],
        dtype=np.complex128,
    )


I2 = np.eye(2, dtype=np.complex128)
Z2 = np.array([[1, 0], [0, -1]], dtype=np.complex128)
CNOT = np.array(
    [[1, 0, 0, 0],
     [0, 1, 0, 0],
     [0, 0, 0, 1],
     [0, 0, 1, 0]],
    dtype=np.complex128,
)


def _expectation(psi: np.ndarray, obs: np.ndarray) -> float:
    return float(np.real(np.vdot(psi, obs @ psi)))


def _reduced_density_q0(psi: np.ndarray) -> np.ndarray:
    matrix = psi.reshape(2, 2)
    return matrix @ matrix.conj().T


def _von_neumann_entropy(rho: np.ndarray) -> float:
    vals = np.clip(np.real(np.linalg.eigvalsh(rho)), 0.0, 1.0)
    vals /= max(1e-12, float(vals.sum()))
    h = 0.0
    for p in vals:
        if p > 1e-12:
            h -= float(p) * math.log2(float(p))
    return float(h)


def rgb_circuit(
    env: EnvironmentPosterior,
    rgb: tuple[float, float, float] | None = None,
) -> QuantumRGB:
    """
    NumPy state-vector equivalent of the user's PennyLane RGB circuit:
      RX(a*pi) q0
      RY(b*pi) q1
      CNOT
      RZ(c*pi) q1
      RX((a+b)*pi/2) q0
      RY((b+c)*pi/2) q1
      <Z0>, <Z1>
    """
    a, b, c = map(clamp01, rgb or encode_rgb(env))
    psi = np.array([1, 0, 0, 0], dtype=np.complex128)

    for gate in (
        np.kron(RX(a * math.pi), I2),
        np.kron(I2, RY(b * math.pi)),
        CNOT,
        np.kron(I2, RZ(c * math.pi)),
        np.kron(RX((a + b) * math.pi / 2.0), I2),
        np.kron(I2, RY((b + c) * math.pi / 2.0)),
    ):
        psi = gate @ psi
        psi = psi / max(1e-12, float(np.linalg.norm(psi)))

    z0 = _expectation(psi, np.kron(Z2, I2))
    z1 = _expectation(psi, np.kron(I2, Z2))
    combined = ((z0 + 1.0) / 2.0 * 0.60) + ((z1 + 1.0) / 2.0 * 0.40)
    entropic_score = sigmoid(6.0 * (combined - 0.5))

    rho = _reduced_density_q0(psi)
    state_entropy = _von_neumann_entropy(rho)
    purity = float(np.real(np.trace(rho @ rho)))

    phase_uncertainty = (
        2.4
        + 5.8 * env.contradiction
        + 4.2 * (1.0 - env.confidence)
        + 3.5 * state_entropy
        + 1.8 * (1.0 - entropic_score)
    )

    return QuantumRGB(
        rgb=(a, b, c),
        z0=z0,
        z1=z1,
        combined=float(combined),
        entropic_score=clamp01(entropic_score),
        state_entropy_bits=state_entropy,
        purity=purity,
        phase_uncertainty_s=float(phase_uncertainty),
    )
