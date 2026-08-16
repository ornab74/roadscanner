from __future__ import annotations

from .mathx import stable_offset
from .models import GeoPoint, RouteSpec, SignalSpec, SpeedSpec


def times_square_to_jfk() -> RouteSpec:
    rows = [
        ("Times Sq / Broadway & W 46 St",                0.00, "origin", 90, 42, 3),
        ("7th Ave & W 45 St",                            0.05, "7th",    90, 42, 3),
        ("7th Ave & W 44 St",                            0.10, "7th",    90, 42, 3),
        ("7th Ave & W 43 St",                            0.15, "7th",    90, 42, 3),
        ("7th Ave & W 42 St",                            0.20, "7th",    90, 40, 3),
        ("7th Ave & W 41 St",                            0.25, "7th",    90, 42, 3),
        ("7th Ave & W 40 St",                            0.30, "7th",    90, 42, 3),
        ("W 40 St & 6th Ave",                            0.48, "40th",   90, 40, 3),
        ("W 40 St & 5th Ave",                            0.65, "40th",   90, 40, 3),
        ("E 40 St & Madison Ave",                        0.82, "40th",   90, 40, 3),
        ("E 40 St & Park Ave",                           0.99, "40th",   90, 38, 3),
        ("E 40 St & Lexington Ave",                      1.16, "40th",   90, 40, 3),
        ("E 40 St & 3rd Ave",                            1.33, "40th",   90, 40, 3),
        ("E 40 St & 2nd Ave",                            1.50, "40th",   90, 38, 3),
        ("2nd Ave & E 39 St",                            1.55, "2nd",    90, 42, 3),
        ("2nd Ave & E 38 St",                            1.60, "2nd",    90, 42, 3),
        ("2nd Ave & E 37 St / Midtown Tunnel approach",  1.65, "2nd",    90, 42, 3),
    ]

    signals = tuple(
        SignalSpec(
            name=name,
            distance_from_origin_mi=float(dist),
            corridor=corridor,
            cycle_s=float(cycle),
            green_s=float(green),
            yellow_s=float(yellow),
            offset_s=stable_offset(name, float(cycle)),
        )
        for name, dist, corridor, cycle, green, yellow in rows
    )

    speeds = {
        "origin": SpeedSpec(8.0, 1.5, 3.0, 17.0, 0.50),
        "7th": SpeedSpec(8.5, 1.8, 3.0, 19.0, 0.55),
        "40th": SpeedSpec(10.5, 2.0, 4.0, 22.0, 0.47),
        "2nd": SpeedSpec(12.0, 2.2, 4.0, 25.0, 0.42),
    }

    return RouteSpec(
        name="Times Square -> JFK",
        origin=GeoPoint(
            40.757955,
            -73.985343,
            "Times Square allocated start",
        ),
        destination="John F. Kennedy International Airport (JFK)",
        signals=signals,
        speed_models=speeds,
        total_route_mi=16.5,
        signalized_surface_mi=1.65,
    ).validate()
