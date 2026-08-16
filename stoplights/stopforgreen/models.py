from __future__ import annotations

import dataclasses
import enum
import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Optional, Sequence


class SignalState(str, enum.Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lon: float
    label: str = ""

    def validate(self) -> "GeoPoint":
        if not math.isfinite(self.lat) or not -90.0 <= self.lat <= 90.0:
            raise ValueError(f"invalid latitude {self.lat!r}")
        if not math.isfinite(self.lon) or not -180.0 <= self.lon <= 180.0:
            raise ValueError(f"invalid longitude {self.lon!r}")
        return self


@dataclass(frozen=True)
class SignalSpec:
    name: str
    distance_from_origin_mi: float
    corridor: str
    cycle_s: float = 90.0
    green_s: float = 42.0
    yellow_s: float = 3.0
    offset_s: Optional[float] = None

    # Virtual clock-twin fields. Defaults preserve the static-clock behavior.
    drift_ppm: float = 0.0
    clock_jitter_s: float = 0.0
    clock_source: str = "static_simulation"

    @property
    def red_s(self) -> float:
        return self.cycle_s - self.green_s - self.yellow_s

    def validate(self) -> "SignalSpec":
        if self.distance_from_origin_mi < 0:
            raise ValueError(f"{self.name}: distance must be non-negative")
        if self.cycle_s <= 0:
            raise ValueError(f"{self.name}: cycle must be positive")
        if self.green_s <= 0 or self.yellow_s < 0:
            raise ValueError(f"{self.name}: bad green/yellow duration")
        if self.green_s + self.yellow_s >= self.cycle_s:
            raise ValueError(f"{self.name}: green + yellow must be < cycle")
        if not math.isfinite(self.drift_ppm) or abs(self.drift_ppm) > 1000:
            raise ValueError(f"{self.name}: invalid drift_ppm")
        if not math.isfinite(self.clock_jitter_s) or not 0 <= self.clock_jitter_s <= 30:
            raise ValueError(f"{self.name}: invalid clock_jitter_s")
        return self


@dataclass(frozen=True)
class SpeedSpec:
    mean_mph: float
    std_mph: float
    min_mph: float
    max_mph: float
    autocorrelation: float = 0.4

    def validate(self) -> "SpeedSpec":
        if not 0 < self.min_mph <= self.mean_mph <= self.max_mph:
            raise ValueError("invalid speed range")
        if self.std_mph < 0:
            raise ValueError("std_mph cannot be negative")
        if not 0 <= self.autocorrelation < 1:
            raise ValueError("autocorrelation must be in [0,1)")
        return self


@dataclass(frozen=True)
class EnvironmentObservation:
    """
    Normalized scenario inputs in [0,1]. They are model inputs, not assertions
    that live sensors measured these exact values.
    """
    event_pressure: float = 0.72
    weather_risk: float = 0.06
    workzone_pressure: float = 0.10
    flow_uncertainty: float = 0.32
    pedestrian_pressure: float = 0.58
    incident_pressure: float = 0.08
    visibility_quality: float = 0.96
    road_surface_risk: float = 0.06
    source_reliability: float = 0.80

    def clipped(self) -> "EnvironmentObservation":
        vals: dict[str, float] = {}
        for f in dataclasses.fields(self):
            x = float(getattr(self, f.name))
            vals[f.name] = max(0.0, min(1.0, x))
        return EnvironmentObservation(**vals)


@dataclass(frozen=True)
class EnvironmentPosterior:
    pressure: float
    coherence: float
    hazard: float
    confidence: float
    contradiction: float
    modality_entropy: float


@dataclass(frozen=True)
class QuantumRGB:
    rgb: tuple[float, float, float]
    z0: float
    z1: float
    combined: float
    entropic_score: float
    state_entropy_bits: float
    purity: float
    phase_uncertainty_s: float


@dataclass(frozen=True)
class RouteSpec:
    name: str
    origin: GeoPoint
    destination: str
    signals: tuple[SignalSpec, ...]
    speed_models: Mapping[str, SpeedSpec]
    total_route_mi: float
    signalized_surface_mi: float

    def validate(self) -> "RouteSpec":
        self.origin.validate()
        if not self.signals:
            raise ValueError("route requires at least one signal")
        last = -1.0
        for s in self.signals:
            s.validate()
            if s.distance_from_origin_mi < last:
                raise ValueError("signals must be sorted by route distance")
            if s.corridor not in self.speed_models:
                raise ValueError(f"no speed model for corridor {s.corridor!r}")
            last = s.distance_from_origin_mi
        for spec in self.speed_models.values():
            spec.validate()
        if self.total_route_mi <= 0:
            raise ValueError("total route distance must be positive")
        if not 0 <= self.signalized_surface_mi <= self.total_route_mi:
            raise ValueError("signalized_surface_mi outside route")
        return self


@dataclass(frozen=True)
class SearchConfig:
    """
    Multi-fidelity search configuration.

    Coarse pass scans a broad departure range.
    Refine pass searches around the top coarse candidates.
    Final pass re-evaluates a small set with many trials.
    """
    coarse_step_s: int = 30
    coarse_trials: int = 900
    coarse_top_k: int = 10

    refine_radius_s: int = 45
    refine_step_s: int = 5
    refine_trials: int = 2200
    refine_top_k: int = 8

    final_trials: int = 9000
    final_top_k: int = 5

    search_margin_before_min: int = 12
    search_margin_after_min: int = 5

    min_arrival_window_probability: float = 0.45
    target_green_fraction: float = 0.80

    def validate(self) -> "SearchConfig":
        for name in (
            "coarse_step_s", "coarse_trials", "coarse_top_k",
            "refine_radius_s", "refine_step_s", "refine_trials",
            "refine_top_k", "final_trials", "final_top_k",
        ):
            if int(getattr(self, name)) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.refine_top_k > self.coarse_top_k * (2 * self.refine_radius_s // self.refine_step_s + 1):
            raise ValueError("refine_top_k is unrealistically large")
        return self


@dataclass(frozen=True)
class PathwayRequest:
    arrival_window_start: datetime
    arrival_window_end: datetime
    earliest_departure: Optional[datetime] = None
    latest_departure: Optional[datetime] = None
    prefer_later_departure: bool = True

    def validate(self) -> "PathwayRequest":
        if self.arrival_window_end <= self.arrival_window_start:
            raise ValueError("arrival window end must be after start")
        if self.earliest_departure and self.latest_departure:
            if self.latest_departure <= self.earliest_departure:
                raise ValueError("latest_departure must be after earliest_departure")
        return self


@dataclass(frozen=True)
class CandidateScore:
    candidate_id: str
    departure_local: datetime

    score: float
    p_arrive_in_window: float
    p_early: float
    p_late: float

    median_arrival_local: datetime
    p05_arrival_local: datetime
    p95_arrival_local: datetime

    mean_green_fraction: float
    p_green_fraction_ge_target: float
    p_all_green: float
    expected_red_stops: float
    median_red_stops: float

    expected_signal_wait_s: float
    median_signal_wait_s: float
    p95_signal_wait_s: float

    schedule_distance_s: float
    robustness: float

    signal_green_probabilities: tuple[float, ...] = field(default_factory=tuple)
    signal_red_probabilities: tuple[float, ...] = field(default_factory=tuple)

    def to_prompt_dict(self) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "departure_local": self.departure_local.isoformat(),
            "score": round(self.score, 6),
            "p_arrive_in_window": round(self.p_arrive_in_window, 6),
            "p_early": round(self.p_early, 6),
            "p_late": round(self.p_late, 6),
            "median_arrival_local": self.median_arrival_local.isoformat(),
            "p05_arrival_local": self.p05_arrival_local.isoformat(),
            "p95_arrival_local": self.p95_arrival_local.isoformat(),
            "mean_green_fraction": round(self.mean_green_fraction, 6),
            "p_green_fraction_ge_target": round(self.p_green_fraction_ge_target, 6),
            "p_all_green": round(self.p_all_green, 8),
            "expected_red_stops": round(self.expected_red_stops, 4),
            "median_red_stops": round(self.median_red_stops, 4),
            "expected_signal_wait_s": round(self.expected_signal_wait_s, 3),
            "median_signal_wait_s": round(self.median_signal_wait_s, 3),
            "p95_signal_wait_s": round(self.p95_signal_wait_s, 3),
            "schedule_distance_s": round(self.schedule_distance_s, 3),
            "robustness": round(self.robustness, 6),
        }


@dataclass(frozen=True)
class SignalPathwayRow:
    signal: str
    median_eta_local: datetime
    p_green: float
    p_yellow: float
    p_red: float
    modal_state: SignalState
    recommended_behavior: str = "Obey the physical signal; simulation is advisory only."


@dataclass(frozen=True)
class PathwayPlan:
    request: PathwayRequest
    route_name: str
    recommended: CandidateScore
    alternatives: tuple[CandidateScore, ...]
    pathway: tuple[SignalPathwayRow, ...]
    environment: EnvironmentPosterior
    quantum: QuantumRGB
    metadata: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "route_name": self.route_name,
            "request": {
                "arrival_window_start": self.request.arrival_window_start.isoformat(),
                "arrival_window_end": self.request.arrival_window_end.isoformat(),
                "earliest_departure": (
                    None if self.request.earliest_departure is None
                    else self.request.earliest_departure.isoformat()
                ),
                "latest_departure": (
                    None if self.request.latest_departure is None
                    else self.request.latest_departure.isoformat()
                ),
            },
            "recommended": self.recommended.to_prompt_dict(),
            "alternatives": [c.to_prompt_dict() for c in self.alternatives],
            "pathway": [
                {
                    "signal": r.signal,
                    "median_eta_local": r.median_eta_local.isoformat(),
                    "p_green": round(r.p_green, 6),
                    "p_yellow": round(r.p_yellow, 6),
                    "p_red": round(r.p_red, 6),
                    "modal_state": r.modal_state.value,
                    "recommended_behavior": r.recommended_behavior,
                }
                for r in self.pathway
            ],
            "environment": dataclasses.asdict(self.environment),
            "quantum": dataclasses.asdict(self.quantum),
            "metadata": dict(self.metadata),
        }
