"""
StopForGreen
============

Research-grade traffic-signal *simulation* and departure-time optimization.

The project does not connect to signal controllers and does not claim live SPaT.
"""
from .models import (
    GeoPoint,
    EnvironmentObservation,
    SignalSpec,
    RouteSpec,
    SearchConfig,
    PathwayRequest,
    CandidateScore,
    PathwayPlan,
)
from .pathway import PathwayToGreenPlanner

from .clocking import (
    SyntheticClockLab,
    IdealizedLLMClock,
    LunaClockEstimator,
    ClockTwinSnapshot,
    apply_clock_snapshot,
)

__all__ = [
    "GeoPoint",
    "EnvironmentObservation",
    "SignalSpec",
    "RouteSpec",
    "SearchConfig",
    "PathwayRequest",
    "CandidateScore",
    "PathwayPlan",
    "PathwayToGreenPlanner",
    "SyntheticClockLab",
    "IdealizedLLMClock",
    "LunaClockEstimator",
    "ClockTwinSnapshot",
    "apply_clock_snapshot",
]

__version__ = "0.2.0"
