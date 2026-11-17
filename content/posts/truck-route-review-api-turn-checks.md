An articulated truck needs more context than a generic car route. A dispatcher may need to review the combination's dimensions, the approach and exit geometry around a turn, and restrictions that are missing from the supplied evidence.

The right interface does not turn an attractive route line into a clearance certificate. It makes the truck's inputs and the unresolved checks visible. This tutorial shows how to request that review with the QRoadScan API and put the result into a dispatch screen.

# Explore the example first

Open the [Haul truck-dispatch demo](https://ride.qroadscan.com/demo/truck). It shows profile dimensions, section caution indices, high-attention reviews and unknown clearance states. Its preview values are explicitly illustrative fixtures, not a real assessment of the streets shown.

The [example source and local setup](https://github.com/ornab74/roadscanner/tree/main/examples/truck-dispatch) include a small Node.js server. You can run the preview without a key, or configure your own server-side key and an owned truck profile for a live API request. The hosted preview sends no live requests and spends no credits.

# Supply a profile rather than guessing a truck

Create a truck in the garage and enter the specifications you actually know. Depending on the configuration and review, relevant fields can include height, width, length, articulated versus rigid configuration, wheelbase and kingpin-to-axle information. Do not fill missing values from the phrase “18 wheeler” or from an illustrative demo vehicle.

Set `QRS_DEMO_TRUCK_ID` in your server environment to the UUID of that owned profile. The request below uses the same environment-variable name as the demo. A key with `routes:write` can request the route review. Add `garage:read` only if your integration needs to list garage profiles through the API.

Keep the QRoadScan key on your server. A dispatcher or driver should authenticate to your application, and your backend should check that they may use the relevant profile and read the resulting report. Do not expose a shared API key to a public frontend.

# Request the mapped review

This example uses fixed public Fifth Avenue coordinates to demonstrate the request shape. It does not establish that a particular truck may legally or physically use that location. Replace the scenario only after checking your intended endpoints and profile, and retain the request identity when recovering the same operation.

```javascript
const key = process.env.QRS_API_KEY;
const vehicleId = process.env.QRS_DEMO_TRUCK_ID;
const requestId = process.env.QRS_REQUEST_ID;
if (!key || !vehicleId || !requestId) throw new Error("Configure the key, owned truck ID and stable request UUID");

const response = await fetch("https://ride.qroadscan.com/api/v1/routes", {
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(240_000),
  headers: {
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    "Idempotency-Key": requestId
  },
  body: JSON.stringify({
    start: {latitude: 40.7585419, longitude: -73.9772075},
    destination: {latitude: 40.7534788, longitude: -73.9808768},
    vehicle_id: vehicleId,
    objective: "simplest",
    notes: "Review this truck profile, each maneuver and missing restriction evidence."
  })
});
if (!response.ok) throw new Error("QRoadScan HTTP " + response.status);
const route = await response.json();
if (route.status !== "proposal" || route.geometry_alignment?.status !== "matched") {
  console.log("No accepted route:", route.summary);
} else {
  console.log(route.truck_turn_review);
}
```

A request with an inaccessible or incompatible vehicle profile is rejected. The server's ownership checks still apply even if a caller guesses another vehicle UUID. A new admitted route analysis consumes an eligible free attempt or existing paid credit under the current allowance rules; a truck profile does not create extra credits.

# Build a section review table

Read the returned mapped sections alongside `truck_turn_review`. A useful table can show the street or connector, the modeled caution index, a review state, and the checks the dispatcher needs to resolve.

Keep unknown values visible. If the profile is incomplete, show that fact rather than substituting generic dimensions. If a restriction is unknown, display “unknown” rather than a green “allowed.” A section with no supported numeric score should remain unknown; it is not zero risk.

High-attention review states identify areas to inspect. They do not mean that the system has measured the curb radius, surveyed lane width, checked every sign or computed a certified swept envelope. Check trailer off-tracking, front and rear swing, approach and exit space, and actual signs using appropriate verified information and responsible operators.

# Keep geometry, caution and permission separate

Mapped geometry describes an imported road connection. A modeled caution index describes a model's assessment under stated inputs and evidence. Legal or physical permission to use a road is a separate question.

Do not collapse these into a single “approved route” badge. The demo deliberately keeps clearance and access unverified. The route API does not certify lane occupation, bridge clearance, weight limits, axle restrictions, hazardous-material permissions or private access.

When the service cannot support a connected mapped candidate, it returns an incomplete status with no accepted turn list or GeoJSON route features. Clear the old route and show the reason. A direct line between endpoints is not an acceptable fallback for a truck-navigation interface.

# Review estimate provenance

Route metrics can include class-based time and fuel scenarios. They are not measured live traffic, posted speed limits or guaranteed consumption. An input MPG value is an assumption, not proof that the route is fuel-optimal for a loaded vehicle.

Likewise, area weather estimates do not establish the current surface state on every street. Keep source times, spatial assumptions and missing data attached to the review. A clean-looking map or a low modeled index must not erase an unknown restriction.

# Make the workflow useful to dispatchers

Start with a small review step before dispatch. Let the responsible person confirm the profile, inspect highlighted maneuvers, record unresolved checks in your own system and decide what independent information is required.

The example's “mark reviewed” control is a mock action in the page. A production workflow needs real authenticated users, persistent review records and clear ownership. It should distinguish “someone looked at this checklist” from “this route has been verified for the vehicle.”

The teaching server binds only to loopback, checks Host and Origin, keeps the key private and limits new upstream work. Those controls are useful for a local example, but they do not make it a production multi-user proxy. Add your own authenticated sessions, per-user budgets, durable operation state and authorization before exposing such a backend publicly.

# Recover work and keep costs bounded

Store the unchanged request and idempotency key together. Reuse them after a network interruption. A new UUID means new work; do not issue one automatically because the first response was slow.

The road trial has account and shared ceilings, and failed free attempts count. The local demo also has a small per-process request limit. Neither is a guarantee about a cloud-provider invoice or a substitute for production cost controls.

For the exact request and response contract, use the [route API documentation](https://ride.qroadscan.com/docs#create-a-route-from-endpoints). For a working interface with illustrative states and live-mode setup, use the [truck demo guide](https://ride.qroadscan.com/docs#more-api-demo-apps).

The goal of a first truck integration is a clearer review workflow: supplied dimensions, inspectable route sections and honest unknowns. Treat the output as material for responsible human review, not as permission to make a maneuver.
