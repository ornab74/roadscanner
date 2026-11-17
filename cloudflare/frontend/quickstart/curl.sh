#!/usr/bin/env bash
# Requires Bash, curl, jq, Python 3. Save as route.sh; run: bash route.sh
# Set QRS_API_KEY securely on your server first. Never commit keys or enable set -x.
set -euo pipefail
umask 077
: "${QRS_API_KEY:?Set QRS_API_KEY in your server environment}"
BASE='https://ride.qroadscan.com'
# Save the unchanged body and key before sending. Keep them after a timeout.
if [[ ! -f qrs-operation.json ]]; then
  python3 - <<'PY'
import json, uuid
state = {"idempotency_key": str(uuid.uuid4()), "journey": {
    "start": {"latitude":40.75854190779626,"longitude":-73.97720754146576},
    "destination": {"latitude":40.753478752021245,"longitude":-73.98087680339813},
    "mode":"driving", "objective":"balanced",
    "notes":"Public road journey southbound on Fifth Avenue. Review junctions."
}}
# Optional: state["journey"]["vehicle_id"] = "OWNED_GARAGE_VEHICLE_UUID"
with open("qrs-operation.json", "x") as f: json.dump(state, f, indent=2)
PY
fi
IDEMPOTENCY_KEY=$(jq -er '.idempotency_key' qrs-operation.json)
jq '.journey' qrs-operation.json > journey.json
curl --fail-with-body --silent --show-error --max-time 30 \
  "$BASE/api/v1/account" -H "Authorization: Bearer $QRS_API_KEY" | jq .
curl --fail-with-body --silent --show-error --max-time 240 \
  "$BASE/api/v1/routes" -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary @journey.json > route-response.json
if jq -e '.status == "proposal" and .geometry_alignment.status == "matched"' route-response.json >/dev/null; then
  jq '.route_geojson' route-response.json > route.geojson
  jq '{risk_summary, steps, endpoint_inspections, route_metrics}' route-response.json
  REPORT_ID=$(jq -er '.report_id' route-response.json)
  curl --fail-with-body --silent --show-error --max-time 30 \
    "$BASE/api/v1/reports/$REPORT_ID" -H "Authorization: Bearer $QRS_API_KEY" \
    > saved-report.json
else
  rm -f -- route.geojson saved-report.json
  jq '{status, summary, endpoint_inspections, limitations}' route-response.json
fi
# Timeout? Rerun the same file/key. 409? Wait if processing; don't create a new key.
# If an operation_id is known: GET /api/v1/operations/{operation_id} (operations:read).
# Inspect its status; do not poll in a tight loop. Paid refunds and free limits differ.
