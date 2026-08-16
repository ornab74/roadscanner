from datetime import datetime
from zoneinfo import ZoneInfo

from stopforgreen.models import PathwayRequest, SearchConfig
from stopforgreen.pathway import PathwayToGreenPlanner
from stopforgreen.routes import times_square_to_jfk


NY = ZoneInfo("America/New_York")

planner = PathwayToGreenPlanner(
    times_square_to_jfk(),
    search=SearchConfig(
        coarse_step_s=60,
        coarse_trials=500,
        coarse_top_k=6,
        refine_radius_s=30,
        refine_step_s=10,
        refine_trials=900,
        refine_top_k=5,
        final_trials=2500,
        final_top_k=4,
    ),
)

plan = planner.plan(
    PathwayRequest(
        arrival_window_start=datetime(2026, 8, 15, 21, 15, tzinfo=NY),
        arrival_window_end=datetime(2026, 8, 15, 21, 30, tzinfo=NY),
    )
)

c = plan.recommended
print("Recommended:", c.departure_local)
print("P(arrive in window):", c.p_arrive_in_window)
print("Mean green fraction:", c.mean_green_fraction)
print("P(all green):", c.p_all_green)
print("Expected red stops:", c.expected_red_stops)
