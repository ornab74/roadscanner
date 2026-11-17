A delivery app already knows where a driver starts and where a package is going. That makes the destination approach a useful place to add context: which mapped section leads to the stop, what modeled caution index is available, and what still needs checking?

This tutorial builds that focused feature with the QRoadScan route API. It does not replace your dispatcher, routing provider, driver judgment or real-world access checks. The result is a small review card that makes the evidence—and its gaps—visible before a journey.

# What you will build

The feature sends start and destination coordinates to `POST /api/v1/routes`. The server assembles available map and endpoint imagery, samples weather, asks the route model for a proposal and checks the proposed connection against mapped road geometry. Your app reads the last section's modeled index from `endpoint_inspections.destination`.

You can explore the interface first in the [Parcel delivery-driver demo](https://ride.qroadscan.com/demo/delivery). That hosted preview uses a recorded real response at public Fifth Avenue endpoints; its delivery order and driver are fictional. Opening it spends no credits. The [complete source](https://github.com/ornab74/roadscanner/tree/main/examples/delivery-driver) includes a loopback server for optional live calls.

# Prerequisites and key setup

Use Node.js 22 or later. Create a QRoadScan account, then create an expiring key in Settings with `routes:write`. Store it as `QRS_API_KEY` in your server environment. It is a QRoadScan integration key, not an OpenAI or Cloudflare credential.

Keep the key on your backend. Do not paste it into a browser bundle, a URL, a public repository or a screenshot. Your frontend should call your authenticated application server, which checks its own user, request ownership and budget before calling QRoadScan.

A new API trial provides three eligible analysis attempts per account, total across all keys, subject to shared free-use ceilings. Read the [current allowance rules](https://ride.qroadscan.com/docs#free-access-and-usage-limits) before testing. Failed free attempts count, and automatic purchases/overages are disabled.

# Choose the actual approach points

A building's center is not necessarily its entrance. For a delivery workflow, start with the driver's intended public-road connection and the destination approach. If your app starts from an address, use the geocoding endpoint to obtain candidates and inspect their labels and precision before choosing coordinates. Never silently treat a street-only result as an exact residential entrance.

The public example below runs southbound on Fifth Avenue. It is not a recommendation about parking, stopping or loading there. Actual signs and access still need checking. The compact API requires two endpoints: it assesses an approach within a route, rather than claiming to inspect a driveway from one isolated coordinate.

# Make one server-side request

Save the following as `approach.mjs`. Generate a request ID once and retain it with the unchanged request if you need to recover from a timeout.

```javascript
const key = process.env.QRS_API_KEY;
const operationKey = process.env.QRS_REQUEST_ID;
if (!key || !operationKey) throw new Error("Set QRS_API_KEY and a stable UUID QRS_REQUEST_ID");

const response = await fetch("https://ride.qroadscan.com/api/v1/routes", {
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(240_000),
  headers: {
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    "Idempotency-Key": operationKey
  },
  body: JSON.stringify({
    start: {latitude: 40.7585419, longitude: -73.9772075},
    destination: {latitude: 40.7534788, longitude: -73.9808768}
  })
});
if (!response.ok) throw new Error("QRoadScan HTTP " + response.status);
const result = await response.json();
console.log(result.status, result.endpoint_inspections.destination);
```

Run it from your trusted server environment with `node approach.mjs`. This starts one analysis attempt. It may take time to gather imagery and review a mapped proposal; a client timeout does not prove that the work stopped.

# Check whether a route was accepted

HTTP 200 alone does not mean there is a usable route. Inspect both the semantic status and the geometry alignment before displaying directions.

```javascript
const accepted = result.status === "proposal"
  && result.geometry_alignment?.status === "matched";

if (!accepted) {
  console.log("More context needed:", result.summary);
} else {
  const approach = result.endpoint_inspections.destination;
  const score = approach.adjacent_section_risk_score;
  console.log(score === null ? "Unknown modeled caution" : score + "/100 modeled caution");
  console.log("Access verified:", approach.access_verified);
}
```

A `needs_context` response has no accepted turn list or route features. Clear any old route from your UI instead of retaining it beneath a new error message. A previous result must not masquerade as the latest analysis.

# Design the driver card around meaning

A useful card can show the modeled index, the last section's explanation, the mapped endpoint offset and the fact that entrance access remains unverified. Display a clear source label: live API response, recorded demo or mock state.

The index uses a 0–100 scale. It is not a measured percentage chance of an accident. A null score means unknown, not zero. Avoid labels such as “safe driveway” or “13% accident risk.” Use wording like “modeled destination-approach caution” and make the supporting explanation available.

If you draw a ribbon, read `route_geojson` and style each feature using its own score and provenance. GeoJSON coordinates are longitude first, latitude second. Keep unsupported sections gray, and show score coverage alongside a route-wide summary.

The endpoint index refers to the adjacent mapped road section. It is not independent confirmation of a building entrance, apartment number, loading permission, curb clearance or a current obstruction. Make those checks part of the driver's own workflow.

# Handle retries without spending twice

Keep the request body and idempotency key together. For the same logical operation, retry with that same pair. Do not automatically generate a new UUID after a network failure.

A pending 409 can mean the first operation is still processing. Wait, and inspect operation status when its operation ID is available. A completed replay can return the saved report without another analysis attempt. Validation errors, missing permissions and exhausted allowances need correction rather than a retry loop.

If you want saved reports or operation status, add only the necessary `scans:read` and `operations:read` permissions to your integration key. Your own application should enforce which driver or dispatcher may view a particular result; a shared backend key is not a substitute for your user authorization.

# Take the feature into your own app

Start with one delivery screen and one approach card. Ask drivers whether the explanation is useful and whether the unknowns are clear. Do not promise fewer accidents or better delivery times without evidence from a suitable evaluation.

The [API quick start](https://ride.qroadscan.com/docs#complete-route-quick-start) has short examples in seven tabs, including Python httpx, Python requests and JavaScript. The [full route guide](https://ride.qroadscan.com/docs#create-a-route-from-endpoints) explains request fields, bounds, response schemas and the difference between modeled information and verified navigation.

A small, honest feature that fits an existing driver workflow is a good first integration. Show what the system knows, show what it does not know, and let responsible people make the real-world decisions.
