from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .clocking import (
    IdealizedLLMClock,
    LunaClockEstimator,
    SyntheticClockLab,
    apply_clock_snapshot,
    snapshot_error_against_truth,
)
from .llm import LunaAdvisor, LunaAdvisorError, deterministic_advice
from .models import EnvironmentObservation, PathwayRequest, SearchConfig
from .pathway import PathwayToGreenPlanner
from .routes import times_square_to_jfk


NY = ZoneInfo("America/New_York")


def parse_local_datetime(text: str) -> datetime:
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=NY)
    return dt.astimezone(NY)


def _ask(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    value = input(prompt + suffix + ": ").strip()
    if not value and default is not None:
        return default
    return value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="stopforgreen",
        description=(
            "StopForGreen v0.2: virtual signal-clocking twin + "
            "Pathway-to-Greenlights departure planner"
        ),
    )
    sub = p.add_subparsers(dest="command", required=True)

    plan = sub.add_parser(
        "plan",
        help="find a departure time for a requested destination arrival window",
    )
    plan.add_argument("--arrival-start")
    plan.add_argument("--arrival-end")
    plan.add_argument("--earliest-departure")
    plan.add_argument("--latest-departure")

    plan.add_argument(
        "--clock-mode",
        choices=["static", "idealized-llm", "luna"],
        default="idealized-llm",
        help=(
            "static = nominal simulated clocks; "
            "idealized-llm = near-oracle synthetic clock estimator; "
            "luna = GPT-5.6 Luna fits synthetic clock observations"
        ),
    )
    plan.add_argument(
        "--clock-reasoning-effort",
        default="max",
        choices=["none", "low", "medium", "high", "xhigh", "max"],
    )
    plan.add_argument(
        "--clock-observations",
        type=int,
        default=14,
    )

    plan.add_argument("--use-luna-advisor", action="store_true")
    plan.add_argument(
        "--advisor-reasoning-effort",
        default="high",
        choices=["none", "low", "medium", "high", "xhigh", "max"],
    )

    plan.add_argument("--seed", type=int, default=8312026)
    plan.add_argument("--fast", action="store_true")
    plan.add_argument("--output", default="stopforgreen_plan.json")
    plan.add_argument("--clock-output", default="stopforgreen_clock_snapshot.json")

    return p


def _config(fast: bool) -> SearchConfig:
    if not fast:
        return SearchConfig(
            coarse_step_s=20,
            coarse_trials=1200,
            coarse_top_k=14,
            refine_radius_s=55,
            refine_step_s=2,
            refine_trials=3500,
            refine_top_k=10,
            final_trials=14000,
            final_top_k=6,
            search_margin_before_min=15,
            search_margin_after_min=6,
            target_green_fraction=0.80,
        )

    return SearchConfig(
        coarse_step_s=60,
        coarse_trials=450,
        coarse_top_k=7,
        refine_radius_s=35,
        refine_step_s=7,
        refine_trials=900,
        refine_top_k=6,
        final_trials=2200,
        final_top_k=5,
        search_margin_before_min=10,
        search_margin_after_min=4,
        target_green_fraction=0.75,
    )


def _clocked_route(
    *,
    base_route,
    arrival_start: datetime,
    mode: str,
    seed: int,
    observation_count: int,
    reasoning_effort: str,
):
    if mode == "static":
        return base_route, None, None

    # Synthetic hidden-clock laboratory.
    reference = arrival_start - timedelta(minutes=45)
    lab = SyntheticClockLab(base_route, seed=seed ^ 0x51A7)
    truth = lab.generate_truth(reference)
    observations = lab.observe(
        truth,
        reference_local=reference,
        sample_count=max(6, observation_count),
        sample_spacing_s=17,
    )

    if mode == "idealized-llm":
        snapshot = IdealizedLLMClock(
            seed=seed ^ 0xA11CE,
            cycle_error_sd_s=0.025,
            offset_error_sd_s=0.12,
            drift_error_sd_ppm=1.0,
        ).estimate(
            truth,
            reference_local=reference,
        )
    elif mode == "luna":
        snapshot = LunaClockEstimator(
            reasoning_effort=reasoning_effort,
        ).estimate(
            base_route,
            observations,
            reference_local=reference,
        )
        # In the synthetic lab we can grade the Luna fit against hidden truth.
        rmse = snapshot_error_against_truth(snapshot, truth)
        from dataclasses import replace
        snapshot = replace(snapshot, fit_rmse_s=rmse)
    else:
        raise ValueError(f"unknown clock mode: {mode}")

    return apply_clock_snapshot(base_route, snapshot), snapshot, truth


def command_plan(args: argparse.Namespace) -> int:
    arrival_start_text = args.arrival_start or _ask(
        "Destination arrival window start (NY local ISO)",
        "2026-08-15T21:15:00",
    )
    arrival_end_text = args.arrival_end or _ask(
        "Destination arrival window end (NY local ISO)",
        "2026-08-15T21:30:00",
    )

    req = PathwayRequest(
        arrival_window_start=parse_local_datetime(arrival_start_text),
        arrival_window_end=parse_local_datetime(arrival_end_text),
        earliest_departure=(
            None if not args.earliest_departure
            else parse_local_datetime(args.earliest_departure)
        ),
        latest_departure=(
            None if not args.latest_departure
            else parse_local_datetime(args.latest_departure)
        ),
    ).validate()

    base_route = times_square_to_jfk()

    try:
        route, clock_snapshot, _truth = _clocked_route(
            base_route=base_route,
            arrival_start=req.arrival_window_start,
            mode=args.clock_mode,
            seed=args.seed,
            observation_count=args.clock_observations,
            reasoning_effort=args.clock_reasoning_effort,
        )
    except Exception as exc:
        if args.clock_mode == "luna":
            print(
                f"Luna clock fitting unavailable: {exc}",
                file=sys.stderr,
            )
            print(
                "Falling back to idealized-LLM clock twin for the test.",
                file=sys.stderr,
            )
            route, clock_snapshot, _truth = _clocked_route(
                base_route=base_route,
                arrival_start=req.arrival_window_start,
                mode="idealized-llm",
                seed=args.seed,
                observation_count=args.clock_observations,
                reasoning_effort=args.clock_reasoning_effort,
            )
            effective_clock_mode = "idealized-llm-fallback"
        else:
            raise
    else:
        effective_clock_mode = args.clock_mode

    if clock_snapshot is not None:
        Path(args.clock_output).write_text(
            json.dumps(clock_snapshot.to_dict(), indent=2),
            encoding="utf-8",
        )

    planner = PathwayToGreenPlanner(
        route,
        environment=EnvironmentObservation(),
        search=_config(args.fast),
        seed=args.seed,
    )

    print(
        f"Running StopForGreen using clock mode: {effective_clock_mode}",
        flush=True,
    )
    plan = planner.plan(req)

    if args.use_luna_advisor:
        try:
            advice = LunaAdvisor(
                reasoning_effort=args.advisor_reasoning_effort,
            ).advise(plan)
            advisor_mode = "gpt-5.6-luna"
        except LunaAdvisorError as exc:
            print(
                f"Luna advisory unavailable: {exc}",
                file=sys.stderr,
            )
            advice = deterministic_advice(plan)
            advisor_mode = "deterministic_fallback"
    else:
        advice = deterministic_advice(plan)
        advisor_mode = "deterministic"

    output = {
        "project": "StopForGreen",
        "version": "0.2.0",
        "clock_mode": effective_clock_mode,
        "clock_snapshot": (
            None if clock_snapshot is None else clock_snapshot.to_dict()
        ),
        "advisor_mode": advisor_mode,
        "plan": plan.to_dict(),
        "advice": advice,
    }

    Path(args.output).write_text(
        json.dumps(output, indent=2, default=str),
        encoding="utf-8",
    )

    c = plan.recommended

    print()
    print("=" * 88)
    print("STOPFORGREEN v0.2 - LLM CLOCK-TWIN PATHWAY TO GREENLIGHTS")
    print("=" * 88)
    print(f"Route: {plan.route_name}")
    print(f"Clock mode: {effective_clock_mode}")
    if clock_snapshot is not None:
        print(
            "Clock twin: "
            f"mean confidence={clock_snapshot.mean_confidence:.3f}, "
            f"synthetic fit RMSE={clock_snapshot.fit_rmse_s:.3f}s"
        )
    print(
        "Requested arrival window: "
        f"{req.arrival_window_start.strftime('%I:%M:%S %p')} - "
        f"{req.arrival_window_end.strftime('%I:%M:%S %p %Z')}"
    )
    print(
        "Recommended departure: "
        f"{c.departure_local.strftime('%I:%M:%S %p %Z')}"
    )
    print(
        "Predicted arrival median: "
        f"{c.median_arrival_local.strftime('%I:%M:%S %p %Z')}"
    )
    print(
        f"Arrival p05-p95: "
        f"{c.p05_arrival_local.strftime('%I:%M:%S %p')} - "
        f"{c.p95_arrival_local.strftime('%I:%M:%S %p')}"
    )
    print(f"P(arrive in window): {c.p_arrive_in_window:.1%}")
    print(f"Mean green fraction: {c.mean_green_fraction:.1%}")
    print(
        "P(hit >= "
        f"{planner.search.target_green_fraction:.0%} green): "
        f"{c.p_green_fraction_ge_target:.1%}"
    )
    print(f"P(all green): {c.p_all_green:.3%}")
    print(f"Expected red stops: {c.expected_red_stops:.2f}")
    print(f"Median red stops: {c.median_red_stops:.1f}")
    print(
        "Modeled signal wait: "
        f"median={c.median_signal_wait_s:.1f}s, "
        f"p95={c.p95_signal_wait_s:.1f}s"
    )
    print(f"Clock/phase robustness: {c.robustness:.3f}")

    print()
    print("PATHWAY TO GREENLIGHTS")
    for row in plan.pathway:
        print(
            f"{row.median_eta_local.strftime('%H:%M:%S')}  "
            f"{row.modal_state.value:6s}  "
            f"G={row.p_green:6.1%} "
            f"Y={row.p_yellow:5.1%} "
            f"R={row.p_red:6.1%}  "
            f"{row.signal}"
        )

    if plan.alternatives:
        print()
        print("TOP ALTERNATIVE DEPARTURES")
        for alt in plan.alternatives:
            print(
                f"{alt.departure_local.strftime('%H:%M:%S')} "
                f"score={alt.score:.4f} "
                f"arrival-window={alt.p_arrive_in_window:.1%} "
                f"green={alt.mean_green_fraction:.1%} "
                f"red-stops={alt.expected_red_stops:.2f}"
            )

    print()
    print(
        "TESTING ASSUMPTION: the virtual LLM clock twin is allowed to behave "
        "like a high-quality traffic-signal clock estimator inside the synthetic lab."
    )
    print(
        "REAL-WORLD RULE: obey every physical signal and posted traffic law; "
        "the model does not control infrastructure."
    )
    print(f"Saved plan: {args.output}")
    if clock_snapshot is not None:
        print(f"Saved clock snapshot: {args.clock_output}")

    return 0


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "plan":
        return command_plan(args)
    raise AssertionError("unreachable")
