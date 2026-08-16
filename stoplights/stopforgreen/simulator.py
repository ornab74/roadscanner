from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Mapping, Sequence

import numpy as np

from .mathx import clamp01
from .models import (
    EnvironmentPosterior,
    QuantumRGB,
    RouteSpec,
    SignalSpec,
    SignalState,
    SpeedSpec,
)


@dataclass
class CandidateRaw:
    departure_local: datetime
    arrival_local_seconds: np.ndarray
    signal_wait_s: np.ndarray
    red_stops: np.ndarray
    green_count: np.ndarray
    yellow_count: np.ndarray
    red_count: np.ndarray
    signal_green: np.ndarray
    signal_yellow: np.ndarray
    signal_red: np.ndarray
    arrival_before_signal_s: np.ndarray
    wait_by_signal_s: np.ndarray

    @property
    def n_trials(self) -> int:
        return int(self.arrival_local_seconds.shape[0])


class CorrelatedSpeedField:
    def __init__(
        self,
        models: Mapping[str, SpeedSpec],
        n_trials: int,
        rng: np.random.Generator,
        pressure: float,
    ) -> None:
        self.models = dict(models)
        self.n_trials = n_trials
        self.rng = rng
        self.pressure = clamp01(pressure)
        self.prev: dict[str, np.ndarray] = {}

    def draw(self, corridor: str) -> np.ndarray:
        spec = self.models[corridor]
        fresh = self.rng.normal(0.0, 1.0, self.n_trials)

        if corridor in self.prev:
            rho = spec.autocorrelation
            z = rho * self.prev[corridor] + math.sqrt(1 - rho * rho) * fresh
        else:
            z = fresh

        self.prev[corridor] = z

        mean = spec.mean_mph * (1.0 - 0.36 * self.pressure)
        speed = mean + spec.std_mph * z
        return np.clip(speed, spec.min_mph, spec.max_mph)


class RouteMonteCarlo:
    """
    Route simulator with per-trial signal-state accounting.

    The simulator treats every physical signal as authoritative:
    - RED causes a modeled stop until next green.
    - YELLOW never produces an instruction to accelerate.
    - No illegal-speed optimization is performed.
    """

    def __init__(
        self,
        route: RouteSpec,
        env: EnvironmentPosterior,
        quantum: QuantumRGB,
    ) -> None:
        self.route = route.validate()
        self.env = env
        self.quantum = quantum

    @staticmethod
    def _seconds_since_midnight(dt: datetime) -> float:
        return (
            dt.hour * 3600
            + dt.minute * 60
            + dt.second
            + dt.microsecond / 1_000_000
        )

    def _phase_noise_sd(self) -> float:
        return (
            self.quantum.phase_uncertainty_s
            * (1.0 + 0.30 * self.env.pressure)
            * (1.0 + 0.25 * (1.0 - self.env.coherence))
        )

    def _highway_continuation(
        self,
        n_trials: int,
        rng: np.random.Generator,
    ) -> np.ndarray:
        remaining_mi = max(
            0.0,
            self.route.total_route_mi - self.route.signalized_surface_mi,
        )

        mean_speed = 34.0 * (
            1.0
            - 0.32 * self.env.pressure
            - 0.10 * self.env.hazard
        )
        mean_speed = max(20.0, mean_speed)

        sd = 4.8 + 3.5 * self.env.contradiction
        speed = np.clip(
            rng.normal(mean_speed, sd, n_trials),
            15.0,
            52.0,
        )

        travel = remaining_mi / speed * 3600.0
        tunnel_interchange = rng.gamma(
            shape=2.2,
            scale=24.0 + 36.0 * self.env.pressure,
            size=n_trials,
        )
        airport_loop = np.clip(
            rng.normal(
                165.0 + 75.0 * self.env.pressure,
                45.0 + 25.0 * self.env.contradiction,
                n_trials,
            ),
            70.0,
            480.0,
        )

        rare_tail_probability = 0.03 + 0.05 * self.env.hazard
        rare_tail = rng.random(n_trials) < rare_tail_probability
        tail_delay = np.where(
            rare_tail,
            rng.gamma(2.0, 120.0, n_trials),
            0.0,
        )
        return travel + tunnel_interchange + airport_loop + tail_delay

    def simulate(
        self,
        departure_local: datetime,
        *,
        n_trials: int,
        seed: int,
        offset_perturbation_sd_s: float = 0.0,
    ) -> CandidateRaw:
        if n_trials <= 0:
            raise ValueError("n_trials must be positive")

        rng = np.random.default_rng(seed)
        n_signals = len(self.route.signals)
        start_s = self._seconds_since_midnight(departure_local)

        arrivals = np.full(n_trials, start_s, dtype=float)
        total_wait = np.zeros(n_trials, dtype=float)
        red_stops = np.zeros(n_trials, dtype=np.int16)

        signal_green = np.zeros((n_trials, n_signals), dtype=bool)
        signal_yellow = np.zeros((n_trials, n_signals), dtype=bool)
        signal_red = np.zeros((n_trials, n_signals), dtype=bool)
        arrival_before = np.zeros((n_trials, n_signals), dtype=float)
        wait_by_signal = np.zeros((n_trials, n_signals), dtype=float)

        speed_field = CorrelatedSpeedField(
            self.route.speed_models,
            n_trials,
            rng,
            pressure=self.env.pressure,
        )

        previous_distance = 0.0
        base_phase_sd = self._phase_noise_sd()

        for i, signal in enumerate(self.route.signals):
            # A virtual LLM clock twin is assumed to collapse much of the
            # controller-phase uncertainty in this synthetic upper-bound test.
            # Travel-time uncertainty remains stochastic.
            if signal.clock_source == "idealized_llm_clock":
                phase_sd = min(
                    1.10,
                    0.10 * base_phase_sd + 0.35 * signal.clock_jitter_s,
                )
            elif signal.clock_source.startswith("gpt_clock:"):
                phase_sd = min(
                    3.0,
                    0.24 * base_phase_sd + 0.65 * signal.clock_jitter_s,
                )
            else:
                phase_sd = base_phase_sd

            if i > 0:
                segment_mi = signal.distance_from_origin_mi - previous_distance
                speed = speed_field.draw(signal.corridor)

                # Mild stochastic surface friction.
                friction = rng.lognormal(
                    mean=math.log(1.0 + 0.15 * self.env.pressure),
                    sigma=0.08 + 0.05 * self.env.contradiction,
                    size=n_trials,
                )
                arrivals += segment_mi / np.maximum(speed, 0.5) * 3600.0 * friction

            arrival_before[:, i] = arrivals

            base_offset = float(signal.offset_s or 0.0)
            if offset_perturbation_sd_s > 0:
                controller_perturb = rng.normal(
                    0.0,
                    offset_perturbation_sd_s,
                    n_trials,
                )
            else:
                controller_perturb = 0.0

            # Clock-twin model:
            # - drift_ppm changes the virtual controller clock rate slightly.
            # - clock_jitter_s represents fitted residual phase noise.
            # Both remain simulation-only.
            drift_scale = 1.0 + float(signal.drift_ppm) * 1e-6
            clock_jitter = rng.normal(
                0.0,
                float(signal.clock_jitter_s),
                n_trials,
            )
            phase_noise = rng.normal(0.0, phase_sd, n_trials)
            phase = (
                arrivals * drift_scale
                + base_offset
                + phase_noise
                + clock_jitter
                + controller_perturb
            ) % signal.cycle_s

            green = phase < signal.green_s
            yellow = (phase >= signal.green_s) & (
                phase < signal.green_s + signal.yellow_s
            )
            red = ~(green | yellow)

            signal_green[:, i] = green
            signal_yellow[:, i] = yellow
            signal_red[:, i] = red

            wait = np.where(red, signal.cycle_s - phase, 0.0)
            wait_by_signal[:, i] = wait
            total_wait += wait
            arrivals += wait
            red_stops += red.astype(np.int16)

            previous_distance = signal.distance_from_origin_mi

        highway = self._highway_continuation(n_trials, rng)
        final_arrival = arrivals + highway

        return CandidateRaw(
            departure_local=departure_local,
            arrival_local_seconds=final_arrival,
            signal_wait_s=total_wait,
            red_stops=red_stops,
            green_count=signal_green.sum(axis=1),
            yellow_count=signal_yellow.sum(axis=1),
            red_count=signal_red.sum(axis=1),
            signal_green=signal_green,
            signal_yellow=signal_yellow,
            signal_red=signal_red,
            arrival_before_signal_s=arrival_before,
            wait_by_signal_s=wait_by_signal,
        )


def seconds_to_datetime(reference: datetime, seconds_since_midnight: float) -> datetime:
    midnight = reference.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight + timedelta(seconds=float(seconds_since_midnight))


def modal_state(pg: float, py: float, pr: float) -> SignalState:
    idx = int(np.argmax([pg, py, pr]))
    return (SignalState.GREEN, SignalState.YELLOW, SignalState.RED)[idx]
