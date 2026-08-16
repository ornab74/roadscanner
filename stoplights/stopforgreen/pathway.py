from __future__ import annotations

import dataclasses
import hashlib
import math
from datetime import datetime, timedelta
from typing import Iterable, Sequence

import numpy as np

from .mathx import clamp01, robust_quantile, safe_mean, seconds_since_midnight
from .models import (
    CandidateScore,
    EnvironmentObservation,
    PathwayPlan,
    PathwayRequest,
    RouteSpec,
    SearchConfig,
    SignalPathwayRow,
)
from .quantum import fuse_environment, rgb_circuit
from .simulator import CandidateRaw, RouteMonteCarlo, modal_state, seconds_to_datetime


class PathwayToGreenPlanner:
    """
    Pathway to Greenlights
    ----------------------

    Finds a departure time that balances:
      1. arrival inside the requested destination time window,
      2. high expected green-light hit fraction,
      3. probability of hitting >= target green fraction,
      4. probability of an all-green run,
      5. low red-stop / signal-wait burden,
      6. robustness to phase uncertainty,
      7. departure preference (slightly later if requested).

    It never recommends speeding, running yellow/red, or overriding a physical
    traffic signal. The only decision variable is *when to depart*.

    Search is multi-fidelity:
      - broad coarse grid
      - local refinement
      - high-trial final re-scoring
    """

    def __init__(
        self,
        route: RouteSpec,
        environment: EnvironmentObservation | None = None,
        search: SearchConfig | None = None,
        seed: int = 8312026,
    ) -> None:
        self.route = route.validate()
        self.environment_observation = (
            environment or EnvironmentObservation()
        ).clipped()
        self.search = (search or SearchConfig()).validate()
        self.seed = int(seed)

        self.environment = fuse_environment(self.environment_observation)
        self.quantum = rgb_circuit(self.environment)
        self.simulator = RouteMonteCarlo(
            self.route,
            self.environment,
            self.quantum,
        )

    def _seed_for(self, departure: datetime, fidelity: str, salt: int = 0) -> int:
        text = (
            f"{self.seed}|{fidelity}|{departure.isoformat()}|{salt}|"
            f"{self.route.name}"
        )
        digest = hashlib.blake2b(text.encode(), digest_size=8).digest()
        return int.from_bytes(digest, "big") & 0x7FFFFFFF

    @staticmethod
    def _window_seconds(req: PathwayRequest) -> tuple[float, float]:
        return (
            seconds_since_midnight(req.arrival_window_start),
            seconds_since_midnight(req.arrival_window_end),
        )

    def _schedule_distance(
        self,
        arrival_s: np.ndarray,
        window_start_s: float,
        window_end_s: float,
    ) -> float:
        before = np.maximum(0.0, window_start_s - arrival_s)
        after = np.maximum(0.0, arrival_s - window_end_s)
        return float(np.mean(before + after))

    def _score_raw(
        self,
        raw: CandidateRaw,
        req: PathwayRequest,
        *,
        target_green_fraction: float,
        robustness: float,
    ) -> CandidateScore:
        start_s, end_s = self._window_seconds(req)
        arrival = raw.arrival_local_seconds
        n_signals = len(self.route.signals)

        in_window = (arrival >= start_s) & (arrival <= end_s)
        p_arrive = float(in_window.mean())
        p_early = float((arrival < start_s).mean())
        p_late = float((arrival > end_s).mean())

        green_fraction = raw.green_count.astype(float) / n_signals
        mean_green = float(green_fraction.mean())
        p_green_target = float(
            (green_fraction >= target_green_fraction).mean()
        )
        p_all_green = float((raw.green_count == n_signals).mean())

        expected_red_stops = float(raw.red_stops.mean())
        median_red_stops = float(np.median(raw.red_stops))

        expected_wait = float(raw.signal_wait_s.mean())
        median_wait = float(np.median(raw.signal_wait_s))
        p95_wait = robust_quantile(raw.signal_wait_s, 0.95)

        schedule_distance = self._schedule_distance(
            arrival,
            start_s,
            end_s,
        )

        # Bounded transforms keep each component on comparable scales.
        wait_quality = math.exp(-expected_wait / 260.0)
        red_quality = math.exp(-expected_red_stops / 4.0)
        schedule_quality = math.exp(-schedule_distance / 240.0)

        # Arrival-window probability is intentionally dominant.
        score = (
            0.46 * p_arrive
            + 0.20 * mean_green
            + 0.09 * p_green_target
            + 0.03 * p_all_green
            + 0.07 * wait_quality
            + 0.05 * red_quality
            + 0.06 * schedule_quality
            + 0.04 * robustness
        )

        # Hard-ish penalty: green optimization must not destroy arrival-window fit.
        min_p = self.search.min_arrival_window_probability
        if p_arrive < min_p:
            score -= 0.80 * (min_p - p_arrive)

        # Lateness is usually worse than early arrival for an airport-style window.
        score -= 0.06 * p_late
        score -= 0.02 * p_early

        median_arrival_s = float(np.median(arrival))
        p05_arrival_s = robust_quantile(arrival, 0.05)
        p95_arrival_s = robust_quantile(arrival, 0.95)

        signal_green_probs = tuple(
            float(raw.signal_green[:, i].mean())
            for i in range(n_signals)
        )
        signal_red_probs = tuple(
            float(raw.signal_red[:, i].mean())
            for i in range(n_signals)
        )

        candidate_id = hashlib.blake2s(
            raw.departure_local.isoformat().encode(),
            digest_size=5,
        ).hexdigest()

        return CandidateScore(
            candidate_id=candidate_id,
            departure_local=raw.departure_local,
            score=float(score),
            p_arrive_in_window=p_arrive,
            p_early=p_early,
            p_late=p_late,
            median_arrival_local=seconds_to_datetime(
                raw.departure_local,
                median_arrival_s,
            ),
            p05_arrival_local=seconds_to_datetime(
                raw.departure_local,
                p05_arrival_s,
            ),
            p95_arrival_local=seconds_to_datetime(
                raw.departure_local,
                p95_arrival_s,
            ),
            mean_green_fraction=mean_green,
            p_green_fraction_ge_target=p_green_target,
            p_all_green=p_all_green,
            expected_red_stops=expected_red_stops,
            median_red_stops=median_red_stops,
            expected_signal_wait_s=expected_wait,
            median_signal_wait_s=median_wait,
            p95_signal_wait_s=p95_wait,
            schedule_distance_s=schedule_distance,
            robustness=robustness,
            signal_green_probabilities=signal_green_probs,
            signal_red_probabilities=signal_red_probs,
        )

    def _robustness_estimate(
        self,
        departure: datetime,
        *,
        trials: int,
        fidelity: str,
    ) -> float:
        """
        Evaluate sensitivity to additional controller/phase perturbation.

        A robust departure keeps its green fraction and arrival-window fit even
        when the assumed phase field is nudged.
        """
        scores = []
        for j, perturb_sd in enumerate((2.0, 5.0, 8.0)):
            raw = self.simulator.simulate(
                departure,
                n_trials=max(300, trials // 3),
                seed=self._seed_for(departure, fidelity, 20 + j),
                offset_perturbation_sd_s=perturb_sd,
            )
            green = raw.green_count.mean() / len(self.route.signals)
            # Robustness is purely flow-oriented here; arrival-window quality is
            # scored separately in the main candidate objective.
            scores.append(float(green))
        spread = float(np.std(scores))
        return clamp01(float(np.mean(scores)) - 0.50 * spread)

    def _evaluate(
        self,
        departure: datetime,
        req: PathwayRequest,
        *,
        trials: int,
        fidelity: str,
        with_robustness: bool,
    ) -> tuple[CandidateScore, CandidateRaw]:
        raw = self.simulator.simulate(
            departure,
            n_trials=trials,
            seed=self._seed_for(departure, fidelity),
        )
        robustness = (
            self._robustness_estimate(
                departure,
                trials=trials,
                fidelity=fidelity,
            )
            if with_robustness
            else float(raw.green_count.mean() / len(self.route.signals))
        )
        return (
            self._score_raw(
                raw,
                req,
                target_green_fraction=self.search.target_green_fraction,
                robustness=robustness,
            ),
            raw,
        )

    def _estimate_search_bounds(
        self,
        req: PathwayRequest,
    ) -> tuple[datetime, datetime]:
        """
        Derive a feasible departure interval from the requested arrival window.

        We first probe a neutral departure and estimate a broad travel-time
        quantile band. User-provided departure bounds override this derived band.
        """
        probe_departure = req.arrival_window_start - timedelta(minutes=50)
        probe = self.simulator.simulate(
            probe_departure,
            n_trials=max(800, self.search.coarse_trials),
            seed=self._seed_for(probe_departure, "bounds"),
        )
        probe_start = seconds_since_midnight(probe_departure)
        travel = probe.arrival_local_seconds - probe_start

        fast = robust_quantile(travel, 0.05)
        slow = robust_quantile(travel, 0.95)

        derived_earliest = (
            req.arrival_window_start
            - timedelta(seconds=slow)
            - timedelta(minutes=self.search.search_margin_before_min)
        )
        derived_latest = (
            req.arrival_window_end
            - timedelta(seconds=fast)
            + timedelta(minutes=self.search.search_margin_after_min)
        )

        earliest = req.earliest_departure or derived_earliest
        latest = req.latest_departure or derived_latest

        if latest <= earliest:
            raise ValueError("no feasible departure search interval")
        return earliest, latest

    @staticmethod
    def _time_grid(
        start: datetime,
        end: datetime,
        step_s: int,
    ) -> list[datetime]:
        out = []
        cur = start
        while cur <= end:
            out.append(cur)
            cur += timedelta(seconds=step_s)
        return out

    @staticmethod
    def _dedupe_times(times: Iterable[datetime]) -> list[datetime]:
        return sorted(set(times))

    def _rank(
        self,
        scores: Sequence[CandidateScore],
        prefer_later: bool,
    ) -> list[CandidateScore]:
        if prefer_later:
            return sorted(
                scores,
                key=lambda c: (
                    c.score,
                    c.p_arrive_in_window,
                    c.mean_green_fraction,
                    c.departure_local.timestamp(),
                ),
                reverse=True,
            )
        return sorted(
            scores,
            key=lambda c: (
                c.score,
                c.p_arrive_in_window,
                c.mean_green_fraction,
                -c.departure_local.timestamp(),
            ),
            reverse=True,
        )

    def plan(self, request: PathwayRequest) -> PathwayPlan:
        req = request.validate()
        cfg = self.search

        earliest, latest = self._estimate_search_bounds(req)

        # -------------------------
        # Pass 1: coarse scan
        # -------------------------
        coarse_times = self._time_grid(
            earliest,
            latest,
            cfg.coarse_step_s,
        )
        coarse_scores = []
        for departure in coarse_times:
            score, _ = self._evaluate(
                departure,
                req,
                trials=cfg.coarse_trials,
                fidelity="coarse",
                with_robustness=False,
            )
            coarse_scores.append(score)

        coarse_ranked = self._rank(
            coarse_scores,
            req.prefer_later_departure,
        )[: cfg.coarse_top_k]

        # -------------------------
        # Pass 2: local refinement
        # -------------------------
        refine_times = []
        for candidate in coarse_ranked:
            lo = candidate.departure_local - timedelta(
                seconds=cfg.refine_radius_s
            )
            hi = candidate.departure_local + timedelta(
                seconds=cfg.refine_radius_s
            )
            refine_times.extend(
                self._time_grid(lo, hi, cfg.refine_step_s)
            )
        refine_times = [
            t for t in self._dedupe_times(refine_times)
            if earliest <= t <= latest
        ]

        refine_scores = []
        for departure in refine_times:
            score, _ = self._evaluate(
                departure,
                req,
                trials=cfg.refine_trials,
                fidelity="refine",
                with_robustness=False,
            )
            refine_scores.append(score)

        refine_ranked = self._rank(
            refine_scores,
            req.prefer_later_departure,
        )[: cfg.refine_top_k]

        # -------------------------
        # Pass 3: robust final score
        # -------------------------
        final_scores = []
        final_raw_by_id: dict[str, CandidateRaw] = {}

        for candidate in refine_ranked:
            score, raw = self._evaluate(
                candidate.departure_local,
                req,
                trials=cfg.final_trials,
                fidelity="final",
                with_robustness=True,
            )
            final_scores.append(score)
            final_raw_by_id[score.candidate_id] = raw

        ranked = self._rank(
            final_scores,
            req.prefer_later_departure,
        )

        if not ranked:
            raise RuntimeError("pathway search produced no candidates")

        recommended = ranked[0]
        alternatives = tuple(ranked[1: cfg.final_top_k])

        best_raw = final_raw_by_id[recommended.candidate_id]
        pathway_rows = []

        for i, signal in enumerate(self.route.signals):
            pg = float(best_raw.signal_green[:, i].mean())
            py = float(best_raw.signal_yellow[:, i].mean())
            pr = float(best_raw.signal_red[:, i].mean())
            median_eta_s = float(
                np.median(best_raw.arrival_before_signal_s[:, i])
            )
            pathway_rows.append(
                SignalPathwayRow(
                    signal=signal.name,
                    median_eta_local=seconds_to_datetime(
                        recommended.departure_local,
                        median_eta_s,
                    ),
                    p_green=pg,
                    p_yellow=py,
                    p_red=pr,
                    modal_state=modal_state(pg, py, pr),
                )
            )

        metadata = {
            "mode": "simulation_only",
            "planner": "PathwayToGreenPlanner",
            "search_bounds": {
                "earliest": earliest.isoformat(),
                "latest": latest.isoformat(),
            },
            "coarse_candidates_evaluated": len(coarse_times),
            "refined_candidates_evaluated": len(refine_times),
            "final_candidates_evaluated": len(refine_ranked),
            "green_target_fraction": cfg.target_green_fraction,
            "clock_twin": {
                "sources": sorted(
                    set(s.clock_source for s in self.route.signals)
                ),
                "mean_clock_jitter_s": float(
                    np.mean([s.clock_jitter_s for s in self.route.signals])
                ),
                "mean_abs_drift_ppm": float(
                    np.mean([abs(s.drift_ppm) for s in self.route.signals])
                ),
                "assumption": (
                    "Virtual signal-clock estimates are treated as high-quality "
                    "timing inputs for this simulation test."
                ),
            },
            "safety": (
                "Only departure time is optimized. The driver must obey the "
                "physical traffic signal and posted traffic laws."
            ),
        }

        return PathwayPlan(
            request=req,
            route_name=self.route.name,
            recommended=recommended,
            alternatives=alternatives,
            pathway=tuple(pathway_rows),
            environment=self.environment,
            quantum=self.quantum,
            metadata=metadata,
        )
