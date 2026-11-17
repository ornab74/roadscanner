# Install: python -m pip install httpx
# Run: python route.py (set QRS_API_KEY securely on your server first).
import json
import os
from pathlib import Path
import uuid
import httpx

os.umask(0o077)  # Protect local journey and response files.
BASE = "https://ride.qroadscan.com"
KEY = os.environ["QRS_API_KEY"]
# Persist both files. Rerunning recovers the same operation, not a new scan.
state_file = Path("qrs-operation.json")
if state_file.exists():
    state = json.loads(state_file.read_text())
else:
    journey = {'start': {'latitude': 40.75854190779626, 'longitude': -73.97720754146576}, 'destination': {'latitude': 40.753478752021245, 'longitude': -73.98087680339813}, 'mode': 'driving', 'objective': 'balanced', 'notes': 'Public road journey southbound on Fifth Avenue. Review junctions.'}
    # Optional: journey["vehicle_id"] = "OWNED_GARAGE_VEHICLE_UUID"
    state = {"idempotency_key": str(uuid.uuid4()), "journey": journey}
    with state_file.open("x") as f:
        json.dump(state, f, indent=2)

with httpx.Client(timeout=httpx.Timeout(240, connect=10), follow_redirects=False) as client:
    def api(method, path, body=None, idem=None):
        headers = {"Authorization": "Bearer " + KEY}
        if idem:
            headers["Idempotency-Key"] = idem
        response = client.request(method, BASE + path, headers=headers, json=body, follow_redirects=False)
        if response.status_code >= 300:
            raise RuntimeError(f"HTTP {response.status_code}; request ID: "
                               + response.headers.get("X-Request-ID", "unknown"))
        return response.json()

    account = api("GET", "/api/v1/account")
    print("Available API attempts:", account["api_credits"])
    # Always preserve the same request/key after a timeout, even if balance is zero.
    route = api("POST", "/api/v1/routes", state["journey"], state["idempotency_key"])
    Path("route-response.json").write_text(json.dumps(route, indent=2))
    if route["status"] != "proposal" or route.get("geometry_alignment", {}).get("status") != "matched":
        Path("route.geojson").unlink(missing_ok=True)
        print("No accepted route:", route["summary"])
        print(route["endpoint_inspections"]["guidance"])
    else:
        Path("route.geojson").write_text(json.dumps(route["route_geojson"], indent=2))
        print("Modeled caution (not accident probability):", route["risk_summary"])
        for step in route["steps"]:
            print(step["index"], step["instruction"], step["distance_m"], step["risk_score"])
        # The key also needs scans:read to retrieve the stored report.
        saved = api("GET", "/api/v1/reports/" + str(route["report_id"]))
        print("Saved report:", saved["report_id"])
# Network timeout? Rerun with the saved state. 409? Do not generate a new key:
# wait if processing; inspect /api/v1/operations/{operation_id} when available.
# Delete the state file only when deliberately starting a NEW analysis attempt.
