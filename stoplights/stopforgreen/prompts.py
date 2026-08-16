from __future__ import annotations

import json
from typing import Any

from .models import PathwayPlan


STOPFORGREEN_LUNA_SYSTEM_PROMPT = r"""
You are StopForGreen Pathway Intelligence, a simulation-audit and route-timing
interpretation layer.

MISSION
Interpret a completed StopForGreen Monte-Carlo departure-time search. A
virtual signal clock twin may have supplied cycle, phase-offset, oscillator
drift, and jitter estimates to the simulator. The simulation engine generated
the candidate departure times and probabilities. Your job is to audit internal
consistency and explain the best pathway without converting synthetic clock
estimates into claims of live signal telemetry.

NON-NEGOTIABLE EPISTEMIC BOUNDARY
- You are not connected to traffic-light controllers.
- You do not receive live SPaT unless the application explicitly supplies a
  verified live SPaT data source. In this project it does not.
- "Green probability", "red probability", "pathway", "optimal departure",
  "clock offset", and "drift" are simulation outputs unless a verified external
  source is explicitly supplied.
- Never describe a modeled signal state as a verified physical lamp state.
- The RGB/quantum circuit is a feature/uncertainty transform inside the model;
  it is not remote observation of a traffic signal.

SAFETY BOUNDARY
- Never recommend running a red light.
- Never recommend accelerating through yellow.
- Never recommend speeding to preserve a green wave.
- Never tell the user to ignore the physical signal.
- Do not propose modifying, hacking, overriding, spoofing, jamming, or
  controlling public traffic infrastructure.
- The only optimization action allowed is choosing a departure time.
- If the real signal differs from the model, the real signal is authoritative.

DECISION RULE
1. The recommended candidate MUST be one of the candidate IDs supplied.
2. Prefer candidates with high probability of arriving inside the user's
   requested destination window.
3. Subject to schedule fit, prefer high mean green fraction, high probability
   of reaching the green target, low expected red stops, low signal wait, and
   high robustness.
4. A tiny increase in green probability must not justify a materially worse
   arrival-window probability.
5. If the top two candidates are statistically close, say so in the
   uncertainty note rather than inventing certainty.
6. Do not create a new departure timestamp.
7. Keep numerical claims faithful to the supplied candidate values.

RESPONSE STYLE
Calm, technical, compact, driver-readable. No chain-of-thought. Return only the
structured response requested by the API schema.
""".strip()


def build_luna_pathway_prompt(plan: PathwayPlan) -> str:
    candidates = [plan.recommended, *plan.alternatives]

    payload = {
        "route": plan.route_name,
        "arrival_window": {
            "start": plan.request.arrival_window_start.isoformat(),
            "end": plan.request.arrival_window_end.isoformat(),
        },
        "simulation_recommended_candidate_id": plan.recommended.candidate_id,
        "candidates": [c.to_prompt_dict() for c in candidates],
        "pathway": [
            {
                "signal": r.signal,
                "median_eta_local": r.median_eta_local.isoformat(),
                "p_green": round(r.p_green, 5),
                "p_yellow": round(r.p_yellow, 5),
                "p_red": round(r.p_red, 5),
                "modal_state": r.modal_state.value,
            }
            for r in plan.pathway
        ],
        "environment": {
            "pressure": round(plan.environment.pressure, 5),
            "coherence": round(plan.environment.coherence, 5),
            "hazard": round(plan.environment.hazard, 5),
            "confidence": round(plan.environment.confidence, 5),
            "contradiction": round(plan.environment.contradiction, 5),
            "modality_entropy": round(plan.environment.modality_entropy, 5),
        },
        "quantum_rgb": {
            "rgb": [round(v, 5) for v in plan.quantum.rgb],
            "z0": round(plan.quantum.z0, 5),
            "z1": round(plan.quantum.z1, 5),
            "entropic_score": round(plan.quantum.entropic_score, 5),
            "state_entropy_bits": round(plan.quantum.state_entropy_bits, 5),
            "phase_uncertainty_s": round(plan.quantum.phase_uncertainty_s, 3),
        },
        "metadata": dict(plan.metadata),
    }

    return (
        "Audit and interpret this completed StopForGreen pathway search.\n"
        "Return only the schema-constrained result.\n\n"
        + json.dumps(payload, separators=(",", ":"), default=str)
    )


def pathway_advisor_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "recommended_candidate_id": {"type": "string"},
            "recommended_departure_local": {"type": "string"},
            "summary": {"type": "string"},
            "schedule_assessment": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "p_arrive_in_window": {"type": "number"},
                    "median_arrival_local": {"type": "string"},
                    "p05_arrival_local": {"type": "string"},
                    "p95_arrival_local": {"type": "string"},
                },
                "required": [
                    "p_arrive_in_window",
                    "median_arrival_local",
                    "p05_arrival_local",
                    "p95_arrival_local",
                ],
            },
            "green_pathway_assessment": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "mean_green_fraction": {"type": "number"},
                    "p_green_fraction_ge_target": {"type": "number"},
                    "p_all_green": {"type": "number"},
                    "expected_red_stops": {"type": "number"},
                    "median_signal_wait_s": {"type": "number"},
                    "robustness": {"type": "number"},
                },
                "required": [
                    "mean_green_fraction",
                    "p_green_fraction_ge_target",
                    "p_all_green",
                    "expected_red_stops",
                    "median_signal_wait_s",
                    "robustness",
                ],
            },
            "uncertainty_note": {"type": "string"},
            "safety_note": {"type": "string"},
            "alternative_candidate_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": [
            "recommended_candidate_id",
            "recommended_departure_local",
            "summary",
            "schedule_assessment",
            "green_pathway_assessment",
            "uncertainty_note",
            "safety_note",
            "alternative_candidate_ids",
        ],
    }
