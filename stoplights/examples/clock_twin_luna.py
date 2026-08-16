"""
GPT-5.6 Luna clock-twin example.

This calls the OpenAI Responses API only when OPENAI_API_KEY is present.
The observations are synthetic StopForGreen laboratory data.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from stopforgreen.clocking import (
    SyntheticClockLab,
    LunaClockEstimator,
    apply_clock_snapshot,
)
from stopforgreen.routes import times_square_to_jfk

NY = ZoneInfo("America/New_York")
route = times_square_to_jfk()
reference = datetime(2026, 8, 15, 20, 30, tzinfo=NY)

lab = SyntheticClockLab(route, seed=8312026)
truth = lab.generate_truth(reference)
observations = lab.observe(
    truth,
    reference_local=reference,
    sample_count=14,
    sample_spacing_s=17,
)

snapshot = LunaClockEstimator(
    model="gpt-5.6-luna",
    reasoning_effort="max",
).estimate(
    route,
    observations,
    reference_local=reference,
)

clocked_route = apply_clock_snapshot(route, snapshot)

print(snapshot.to_dict())
print("Clocked route signals:", len(clocked_route.signals))
