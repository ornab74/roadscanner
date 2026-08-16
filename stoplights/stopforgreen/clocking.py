from __future__ import annotations

import dataclasses
import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Mapping, Optional, Sequence

import numpy as np

from .models import RouteSpec, SignalSpec


@dataclass(frozen=True)
class SignalClockTruth:
    signal: str
    cycle_s: float
    offset_s: float
    drift_ppm: float
    jitter_sd_s: float


@dataclass(frozen=True)
class ClockObservation:
    signal: str
    observed_at_local: datetime
    observed_phase_s: float
    cycle_hint_s: float
    quality: float


@dataclass(frozen=True)
class SignalClockEstimate:
    signal: str
    cycle_s: float
    offset_s: float
    drift_ppm: float
    jitter_sd_s: float
    confidence: float
    source: str


@dataclass(frozen=True)
class ClockTwinSnapshot:
    """
    Virtual controller-clock estimate for a simulation laboratory.

    No field in this object implies live or authorized infrastructure access.
    """
    mode: str
    reference_local: datetime
    generated_at_local: datetime
    estimates: tuple[SignalClockEstimate, ...]
    fit_rmse_s: float
    mean_confidence: float
    notes: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "reference_local": self.reference_local.isoformat(),
            "generated_at_local": self.generated_at_local.isoformat(),
            "fit_rmse_s": self.fit_rmse_s,
            "mean_confidence": self.mean_confidence,
            "notes": list(self.notes),
            "estimates": [dataclasses.asdict(x) for x in self.estimates],
        }


def _seed(text: str) -> int:
    return int.from_bytes(
        hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest(),
        "big",
    ) & 0x7FFFFFFF


def _circular_error(a: float, b: float, period: float) -> float:
    return float(((a - b + period / 2.0) % period) - period / 2.0)


class SyntheticClockLab:
    """
    Hidden synthetic traffic-controller clock laboratory.

    The nominal RouteSpec is perturbed into a hidden "truth":
      - cycle drift
      - phase offset shift
      - oscillator drift in ppm
      - local phase jitter

    The lab can then emit synthetic phase observations. This lets the project
    test the hypothesis "what if an LLM behaved like a very good signal-clocking
    estimator?" without asserting access to real traffic infrastructure.
    """

    def __init__(
        self,
        route: RouteSpec,
        *,
        seed: int = 8312026,
    ) -> None:
        self.route = route.validate()
        self.seed = int(seed)

    def generate_truth(
        self,
        reference_local: datetime,
        *,
        coordinated_green_wave: bool = True,
        corridor_phase_noise_sd_s: float = 1.25,
    ) -> tuple[SignalClockTruth, ...]:
        """
        Build hidden synthetic signal clocks.

        In v0.2's default *clocking-system test*, the hidden lab network is
        deliberately coordinated: a nominal vehicle departing at
        ``reference_local`` has a green-wave path across the surface route.

        This is important: the experiment is intended to test whether the
        planner can discover a green pathway when one actually exists. A route
        of independent random offsets would make "mostly green" mathematically
        impossible no matter how good the LLM clock estimator is.
        """
        out: list[SignalClockTruth] = []

        anchor_s = (
            reference_local.hour * 3600
            + reference_local.minute * 60
            + reference_local.second
            + reference_local.microsecond / 1_000_000
        )

        nominal_arrival_s = anchor_s
        previous_distance = 0.0

        # Corridor-correlated residuals make the hidden schedule realistic
        # enough for robustness testing while retaining a discoverable wave.
        corridor_residual: dict[str, float] = {}

        for i, s in enumerate(self.route.signals):
            rng = np.random.default_rng(
                _seed(f"truth|{self.seed}|{i}|{s.name}")
            )

            if i > 0:
                segment_mi = s.distance_from_origin_mi - previous_distance
                speed = self.route.speed_models[s.corridor].mean_mph
                nominal_arrival_s += segment_mi / max(1.0, speed) * 3600.0

            cycle_delta = float(rng.normal(0.0, 0.30))
            cycle = max(
                s.green_s + s.yellow_s + 8.0,
                float(s.cycle_s + cycle_delta),
            )

            if s.corridor not in corridor_residual:
                corridor_residual[s.corridor] = float(
                    rng.normal(0.0, corridor_phase_noise_sd_s)
                )

            if coordinated_green_wave:
                # Place nominal arrival near the middle of green, leaving margin
                # on both sides for stochastic travel-time error.
                target_phase = 0.47 * s.green_s
                local_residual = (
                    corridor_residual[s.corridor]
                    + float(rng.normal(0.0, 0.55))
                )
                offset = (
                    target_phase
                    - nominal_arrival_s
                    + local_residual
                ) % cycle
            else:
                nominal_offset = float(s.offset_s or 0.0)
                offset = (
                    nominal_offset
                    + float(rng.normal(0.0, 11.0))
                ) % cycle

            drift_ppm = float(
                np.clip(rng.normal(0.0, 28.0), -90.0, 90.0)
            )
            jitter_sd_s = float(
                np.clip(rng.lognormal(-0.65, 0.35), 0.15, 1.8)
            )

            out.append(
                SignalClockTruth(
                    signal=s.name,
                    cycle_s=cycle,
                    offset_s=offset,
                    drift_ppm=drift_ppm,
                    jitter_sd_s=jitter_sd_s,
                )
            )
            previous_distance = s.distance_from_origin_mi

        return tuple(out)

    @staticmethod
    def phase_at(
        truth: SignalClockTruth,
        when_local: datetime,
        reference_local: datetime,
    ) -> float:
        t = (
            when_local.hour * 3600
            + when_local.minute * 60
            + when_local.second
            + when_local.microsecond / 1_000_000
        )
        ref = (
            reference_local.hour * 3600
            + reference_local.minute * 60
            + reference_local.second
            + reference_local.microsecond / 1_000_000
        )
        dt = t - ref
        # Oscillator drift is modeled relative to the reference.
        drift_s = dt * truth.drift_ppm * 1e-6
        return float(
            (t + truth.offset_s + drift_s) % truth.cycle_s
        )

    def observe(
        self,
        truth: Sequence[SignalClockTruth],
        *,
        reference_local: datetime,
        sample_count: int = 12,
        sample_spacing_s: int = 19,
    ) -> tuple[ClockObservation, ...]:
        by_name = {x.signal: x for x in truth}
        obs: list[ClockObservation] = []

        for i, s in enumerate(self.route.signals):
            tr = by_name[s.name]
            rng = np.random.default_rng(
                _seed(f"obs|{self.seed}|{i}|{s.name}")
            )

            # Spread observations around reference instead of only forward.
            center = (sample_count - 1) / 2.0
            for k in range(sample_count):
                when = reference_local + timedelta(
                    seconds=(k - center) * sample_spacing_s
                )
                phase = self.phase_at(tr, when, reference_local)
                measured = (
                    phase
                    + float(rng.normal(0.0, tr.jitter_sd_s))
                ) % tr.cycle_s
                quality = float(
                    np.clip(
                        0.96 - 0.05 * tr.jitter_sd_s
                        + rng.normal(0.0, 0.015),
                        0.65,
                        0.99,
                    )
                )
                obs.append(
                    ClockObservation(
                        signal=s.name,
                        observed_at_local=when,
                        observed_phase_s=float(measured),
                        cycle_hint_s=float(s.cycle_s),
                        quality=quality,
                    )
                )
        return tuple(obs)


class IdealizedLLMClock:
    """
    Upper-bound testing assumption.

    This adapter intentionally assumes the "LLM clocking system" can infer
    controller clocks nearly perfectly from synthetic observations. It is not
    a claim about real-world GPT access or accuracy.

    We inject only tiny estimation error so the rest of StopForGreen can be
    tested against an almost-oracle clock estimator.
    """

    def __init__(
        self,
        *,
        seed: int = 99181,
        cycle_error_sd_s: float = 0.035,
        offset_error_sd_s: float = 0.18,
        drift_error_sd_ppm: float = 1.5,
    ) -> None:
        self.seed = int(seed)
        self.cycle_error_sd_s = float(cycle_error_sd_s)
        self.offset_error_sd_s = float(offset_error_sd_s)
        self.drift_error_sd_ppm = float(drift_error_sd_ppm)

    def estimate(
        self,
        truth: Sequence[SignalClockTruth],
        *,
        reference_local: datetime,
    ) -> ClockTwinSnapshot:
        estimates: list[SignalClockEstimate] = []
        squared_errors = []

        for i, tr in enumerate(truth):
            rng = np.random.default_rng(
                _seed(f"idealized-llm|{self.seed}|{i}|{tr.signal}")
            )
            cycle = max(
                10.0,
                tr.cycle_s + float(rng.normal(0, self.cycle_error_sd_s)),
            )
            offset = (
                tr.offset_s
                + float(rng.normal(0, self.offset_error_sd_s))
            ) % cycle
            drift = tr.drift_ppm + float(
                rng.normal(0, self.drift_error_sd_ppm)
            )
            jitter = max(
                0.05,
                tr.jitter_sd_s * float(rng.normal(1.0, 0.025)),
            )

            phase_err = _circular_error(
                offset,
                tr.offset_s,
                tr.cycle_s,
            )
            squared_errors.append(phase_err * phase_err)

            confidence = float(
                np.clip(
                    0.985
                    - abs(phase_err) / max(1.0, tr.cycle_s) * 0.4,
                    0.90,
                    0.999,
                )
            )
            estimates.append(
                SignalClockEstimate(
                    signal=tr.signal,
                    cycle_s=float(cycle),
                    offset_s=float(offset),
                    drift_ppm=float(drift),
                    jitter_sd_s=float(jitter),
                    confidence=confidence,
                    source="idealized_llm_clock",
                )
            )

        rmse = math.sqrt(sum(squared_errors) / max(1, len(squared_errors)))
        mean_conf = sum(x.confidence for x in estimates) / len(estimates)

        return ClockTwinSnapshot(
            mode="idealized_llm_clock",
            reference_local=reference_local,
            generated_at_local=reference_local,
            estimates=tuple(estimates),
            fit_rmse_s=float(rmse),
            mean_confidence=float(mean_conf),
            notes=(
                "Upper-bound synthetic test assumption.",
                "Clock estimates are derived from hidden simulated truth.",
                "Not live SPaT or controller telemetry.",
            ),
        )


LUNA_CLOCK_SYSTEM_PROMPT = r"""
You are StopForGreen ClockTwin, operating inside a synthetic traffic-signal
simulation laboratory.

ROLE
Act like a high-precision traffic signal clock-estimation engine. Infer one
clock model per named signal from the synthetic phase observations supplied by
the application.

THIS IS A CLOCK-FITTING TASK, NOT A TRAFFIC-CONTROL TASK.
You do not control lights. You do not modify infrastructure. You only estimate:
- cycle_s
- offset_s
- drift_ppm
- jitter_sd_s
- confidence

ASSUMPTION FOR THIS TEST
Treat the supplied observations as if you are exceptionally good at clock
reconstruction. Use all timestamps jointly. Resolve phase wrapping. Detect
small cycle mismatch and oscillator drift. Prefer a coherent corridor clock
solution when individual observations are noisy.

HARD RULES
- Return exactly one estimate for every supplied signal name.
- Never invent a new signal.
- Never omit a signal.
- offset_s must be normalized to [0, cycle_s).
- cycle_s must stay close to the provided cycle hint unless observations
  strongly establish a nearby correction.
- drift_ppm must be finite and restrained to [-250, 250].
- jitter_sd_s must be in [0.05, 10].
- confidence must be in [0,1].
- Do not claim these are live physical controller clocks.
- Do not output chain-of-thought.
""".strip()


def luna_clock_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "estimates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "signal": {"type": "string"},
                        "cycle_s": {"type": "number"},
                        "offset_s": {"type": "number"},
                        "drift_ppm": {"type": "number"},
                        "jitter_sd_s": {"type": "number"},
                        "confidence": {"type": "number"},
                    },
                    "required": [
                        "signal",
                        "cycle_s",
                        "offset_s",
                        "drift_ppm",
                        "jitter_sd_s",
                        "confidence",
                    ],
                },
            },
            "global_clock_quality": {"type": "number"},
            "summary": {"type": "string"},
        },
        "required": [
            "estimates",
            "global_clock_quality",
            "summary",
        ],
    }


class LunaClockEstimator:
    """
    GPT-5.6 Luna synthetic clock fitter.

    The API call receives only synthetic observations created by
    SyntheticClockLab. No public infrastructure is queried.
    """

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        reasoning_effort: Optional[str] = None,
    ) -> None:
        self.model = model or os.getenv(
            "STOPFORGREEN_OPENAI_MODEL",
            "gpt-5.6-luna",
        )
        self.reasoning_effort = reasoning_effort or os.getenv(
            "STOPFORGREEN_CLOCK_REASONING_EFFORT",
            os.getenv("STOPFORGREEN_REASONING_EFFORT", "max"),
        )

    def estimate(
        self,
        route: RouteSpec,
        observations: Sequence[ClockObservation],
        *,
        reference_local: datetime,
    ) -> ClockTwinSnapshot:
        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is required for luna clock mode")

        try:
            from openai import OpenAI
        except Exception as exc:
            raise RuntimeError(
                "openai Python package is required for luna clock mode"
            ) from exc

        by_signal: dict[str, list[dict[str, Any]]] = {}
        for o in observations:
            by_signal.setdefault(o.signal, []).append(
                {
                    "observed_at_local": o.observed_at_local.isoformat(),
                    "observed_phase_s": round(o.observed_phase_s, 6),
                    "cycle_hint_s": round(o.cycle_hint_s, 6),
                    "quality": round(o.quality, 6),
                }
            )

        input_payload = {
            "reference_local": reference_local.isoformat(),
            "signals": [
                {
                    "name": s.name,
                    "nominal_cycle_s": s.cycle_s,
                    "green_s": s.green_s,
                    "yellow_s": s.yellow_s,
                    "observations": by_signal.get(s.name, []),
                }
                for s in route.signals
            ],
        }

        client = OpenAI()
        response = client.responses.create(
            model=self.model,
            reasoning={"effort": self.reasoning_effort},
            instructions=LUNA_CLOCK_SYSTEM_PROMPT,
            input=json.dumps(input_payload, separators=(",", ":")),
            text={
                "format": {
                    "type": "json_schema",
                    "name": "stopforgreen_clock_twin",
                    "strict": True,
                    "schema": luna_clock_schema(),
                }
            },
            store=False,
        )

        text = getattr(response, "output_text", "") or ""
        data = json.loads(text)

        expected_names = [s.name for s in route.signals]
        rows = data.get("estimates")
        if not isinstance(rows, list):
            raise RuntimeError("Luna clock output missing estimates")

        seen = [str(x.get("signal")) for x in rows]
        if sorted(seen) != sorted(expected_names):
            raise RuntimeError(
                "Luna clock output signal names do not exactly match the route"
            )

        nominal = {s.name: s for s in route.signals}
        estimates: list[SignalClockEstimate] = []

        for row in rows:
            name = str(row["signal"])
            base = nominal[name]
            cycle = float(row["cycle_s"])
            if not math.isfinite(cycle):
                raise RuntimeError("non-finite cycle")
            if abs(cycle - base.cycle_s) > 5.0:
                raise RuntimeError(
                    f"Luna clock cycle correction too large for {name}"
                )
            if cycle <= base.green_s + base.yellow_s + 2:
                raise RuntimeError(f"invalid inferred cycle for {name}")

            offset = float(row["offset_s"]) % cycle
            drift = float(row["drift_ppm"])
            jitter = float(row["jitter_sd_s"])
            confidence = float(row["confidence"])

            if not -250 <= drift <= 250:
                raise RuntimeError(f"invalid drift for {name}")
            if not 0.05 <= jitter <= 10:
                raise RuntimeError(f"invalid jitter for {name}")
            if not 0 <= confidence <= 1:
                raise RuntimeError(f"invalid confidence for {name}")

            estimates.append(
                SignalClockEstimate(
                    signal=name,
                    cycle_s=cycle,
                    offset_s=offset,
                    drift_ppm=drift,
                    jitter_sd_s=jitter,
                    confidence=confidence,
                    source=f"gpt_clock:{self.model}",
                )
            )

        # Without hidden truth, use weighted residual proxy later in simulation.
        mean_conf = float(np.mean([x.confidence for x in estimates]))
        return ClockTwinSnapshot(
            mode=f"gpt_clock:{self.model}",
            reference_local=reference_local,
            generated_at_local=datetime.now(reference_local.tzinfo),
            estimates=tuple(estimates),
            fit_rmse_s=float("nan"),
            mean_confidence=mean_conf,
            notes=(
                "GPT-5.6 Luna fit to synthetic phase observations.",
                "No real controller or SPaT system was contacted.",
                str(data.get("summary", ""))[:500],
            ),
        )


def snapshot_error_against_truth(
    snapshot: ClockTwinSnapshot,
    truth: Sequence[SignalClockTruth],
) -> float:
    tmap = {x.signal: x for x in truth}
    errs = []
    for est in snapshot.estimates:
        tr = tmap[est.signal]
        e = _circular_error(est.offset_s, tr.offset_s, tr.cycle_s)
        errs.append(e * e)
    return float(math.sqrt(sum(errs) / max(1, len(errs))))


def apply_clock_snapshot(
    route: RouteSpec,
    snapshot: ClockTwinSnapshot,
) -> RouteSpec:
    """
    Create a new route whose signal phase clocks come from the clock twin.
    Original RouteSpec is left unchanged.
    """
    estimates = {x.signal: x for x in snapshot.estimates}
    if set(estimates) != {s.name for s in route.signals}:
        raise ValueError("clock snapshot must cover every route signal exactly")

    updated = []
    for s in route.signals:
        e = estimates[s.name]
        updated.append(
            dataclasses.replace(
                s,
                cycle_s=float(e.cycle_s),
                offset_s=float(e.offset_s),
                drift_ppm=float(e.drift_ppm),
                clock_jitter_s=float(e.jitter_sd_s),
                clock_source=str(e.source),
            )
        )

    return dataclasses.replace(
        route,
        signals=tuple(updated),
    ).validate()
