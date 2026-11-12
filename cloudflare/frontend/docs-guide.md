This handbook describes the deployed QRoadScan application and its versioned HTTP API. It covers the browser workspace, private vehicle garage, road proposals, aircraft briefings, account security, and server integration. Examples use illustrative vehicles and public airport coordinates. Example performance values are not manufacturer recommendations, flight-planning standards, or observations about your vehicle.

The visible interface and the machine-readable [OpenAPI specification](/openapi.yaml) serve different purposes. This handbook explains the workflows, assumptions, failure cases, and integration decisions. The specification lists request fields and endpoint contracts. Use both when building an integration. Keep your API key on your own server, and begin with the smallest permissions needed for the job.

## Quick start in the app

Start at [Home](/home), create an account if registration is open, and sign in. Your account can have a garage, private API keys, security keys, signed-in sessions, and saved scan reports. Creating an account does not purchase credits or automatically grant administrator access. Purchases are currently disabled. If your account has no scan credits, you can still manage its settings and inspect the available briefing tools; metered analyses and generated illustrations require an existing credit balance.

Open [Settings → Garage](/settings/user#garage) and add a vehicle. Choose its actual vehicle type explicitly. A motorcycle should be saved as `motorcycle`, an articulated truck as `truck`, and an airplane as `aircraft`. The make or model text does not silently override the type. This matters because the type selects the appropriate workspace, advisory language, specifications, and transparent map icon. The garage highlights the known Kawasaki Z125/type mismatch and offers a correction that you must choose yourself.

For a road journey, select your garage vehicle in [Dashboard](/dashboard), choose a start and destination, and inspect the map. You may type coordinates, search for an address, or choose points on the map. Confirm the returned address precision before continuing. Select Streets for labeled road context. Satellite imagery can help inspect an entrance, but it does not establish that a private road, loading bay, doorway, or apartment corridor is legally accessible.

Run a route analysis only after confirming both endpoints. The application captures an overview and a bounded atlas of endpoint and corridor images, requests a model proposal, and tries to align that proposal to imported mapped road shapes. A completed route proposal normally uses one credit. A request for more context returns the reserved credit. Read the limitations and review the proposed street sections before using fullscreen GPS preview.

For an aircraft, use [Aircraft briefing](/aircraft). Select a saved aircraft profile, provide the airport codes and coordinates, enter the scenario altitude and usable fuel, then refresh the evidence. Airport codes and map coordinates are separate user inputs; the application does not verify that they refer to the same airport. Review traffic availability, airport observations and forecasts, pressure-level winds, and the explicit fuel assumptions. An optional AI review explains the supplied evidence; it does not authorize a flight.

## What the different outputs mean

QRoadScan has several distinct surfaces. They should not be treated as interchangeable measurements. The homepage’s Grok guess-mode colorwheel creates a fictional road scene and a modeled score. It is not a live sensor reading, a location-specific accident probability, or proof that a road is safe. Refreshing that simulation calls the configured provider rather than reusing a stored simulated reading.

A scene scan assesses observations supplied by the user or API client. If you submit “rain,” “heavy traffic,” or “construction,” the model considers those statements as inputs. It does not independently prove them. The returned report identifies the supplied observations and provider provenance so an integration can preserve that distinction.

A visual road proposal uses map images, selected endpoints, available weather estimates, and a model-generated corridor. Imported road geometry improves how a ribbon follows mapped streets. It does not validate every turn restriction, bridge capacity, property boundary, road closure, lane, or legal maneuver. Weather caution scores are modeled severity indices, not calibrated accident probabilities.

A garage illustration is artwork. It can reflect a make, model, color, year, and holiday theme, but it is not a verified photograph or a record of a vehicle’s mechanical configuration. Never derive aircraft performance, truck clearance, tire condition, braking capability, or manufacturer specifications from that artwork. The tiny map marker is a separate transparent vector representation based on the saved type and color; it does not require another image-generation credit.

An aircraft briefing combines independently timestamped external sources with user-supplied assumptions. OpenSky positions can be incomplete or delayed. METARs describe airport observations. TAFs describe airport forecasts. Winds aloft are model samples at pressure levels. Fuel figures are deterministic scenario arithmetic. AI commentary is interpretation of that evidence, not certified ATC, separation, collision avoidance, dispatch authority, or a go/no-go decision.

## Account, credits, and privacy basics

Account resources are private to their owner. A garage profile, private illustration, saved report, or active vehicle selection cannot be read merely by guessing its identifier. API keys inherit the owning account’s resource boundary, and the server enforces permissions on every relevant endpoint. An administrator’s browser role does not turn an ordinary API key into an administrator credential.

Credit reservations occur before a metered provider operation. A successful scene scan, completed road proposal, or delivered garage illustration uses one credit. Provider failures and blocked illustration checks refund the reservation. A route response with `needs_context` also refunds it. A network timeout on your client is different from an explicit failure: the server may still be processing. Keep the same idempotency key when checking the same logical operation so you do not unintentionally create another charge.

The browser uses Secure, HttpOnly, host-only session cookies. State-changing browser requests require a signed CSRF token and the correct origin. API requests under `/api/v1/` use an explicit Bearer key and do not fall back to a browser session. Do not copy the browser’s session cookie into a server integration, and do not put a server API key in a public JavaScript bundle or a query string.

Vehicle profiles and stored reports are encrypted at rest. Generated image blobs are encrypted with an owner/vehicle/image binding. Private image responses use `no-store` and require authentication. The application does not publish a public bucket URL for your illustration. Provider services necessarily receive the bounded input needed to fulfill an explicit model request; their own processing terms and retention policies also apply.

Do not include a VIN, home address, license plate, account password, provider key, or other unnecessary personal information in a vehicle’s appearance notes. A descriptive phrase such as “olive camouflage panels with a black seat” is useful. A registration document or secret key is not. Appearance fields are descriptive data, not a place to instruct the application to change its security policy.

## Garage profiles and vehicle types

The garage supports up to twenty active vehicles per account. Each vehicle has a display name, kind, optional make and model, optional year, color description, holiday theme, appearance notes, and a type-specific specifications object. The display name is for your organization; it is not an authentication identifier. The server assigns a UUID and an optimistic `version` to each saved profile.

Choose a vehicle type before saving a new profile. A model name can be ambiguous, and several manufacturers sell cars, motorcycles, boats, industrial equipment, or multiple aircraft categories. QRoadScan does not silently turn a manufacturer name into an operating classification. If a profile was saved under the wrong type, correct it explicitly. A type-only correction retains existing artwork when the descriptive appearance fields remain unchanged; the map marker updates from the corrected type.

A car profile can carry a mass assumption. A motorcycle profile can carry engine displacement and mass. A truck profile can carry height, width, length, gross mass, axle count, and a hazmat flag. A train profile can carry length, mass, rail gauge, and traction type. An aircraft profile can carry true airspeed, cruise fuel burn, usable capacity, fuel unit, scenario reserve, ICAO type designator, and optional OpenSky ICAO24 identifier.

These fields are user-supplied. The application validates their type and broad bounds, but that is not a verification against a manufacturer database. A plausible-looking number can still be wrong. Use the appropriate manual, operator records, or other authoritative vehicle documentation. Do not guess a truck’s loaded mass or an aircraft’s usable fuel capacity from its model name.

Editing a profile requires its current `version`. If another tab or client updates it first, a stale replacement returns `409 vehicle_changed`. Reload the current profile, reconcile your edits, and submit a new replacement with the new version. Do not blindly resubmit a stale body, because that could overwrite a legitimate change made elsewhere.

Appearance changes clear an obsolete illustration so the garage does not display old artwork as if it represented the new description. Changing the display name or performance assumptions does not require regenerating the art. Deleting a vehicle clears its active selection, makes its private resources unavailable, clears the encrypted profile contents, and schedules retained image objects for cleanup.

## Vehicle illustrations, PHF, and holiday themes

The garage’s Generate image action uses the configured GPT Image 2 model. It is explicit: saving a vehicle, selecting a theme, viewing a card, or opening the map does not generate an illustration. A successful delivered image costs one existing scan credit. Generation attempts have daily account and global limits, including failed attempts; this bounds provider spending and discourages repeated filter probes.

PHF means Probabilistic Harm Filtering in this project. The Cloudflare image workflow uses bounded local instruction checks plus structured provider moderation. The description must pass before generation, and the generated image must pass before delivery. A missing, malformed, flagged, or unavailable filter result is not treated as approval. The reserved scan credit is refunded when filtering or image generation fails.

The generation prompt asks for the entire vehicle, realistic model proportions, and empty space around outer extremities. The garage card fits the full image inside its display box rather than allowing the image’s intrinsic dimensions to stretch and crop it. Select the illustration to open a larger view. The card is a display of artwork, not a measurement of vehicle dimensions.

Themes include Original, Winter, Halloween, Autumn, Festive lights, and Lunar New Year. Themes are visual: they should not imply that decorations are safe to install on a real vehicle. The prompt requests that decorations avoid obstructing lights, windows, wheels, propellers, intakes, rails, and controls. Actual installations remain a separate real-world engineering and operating decision.

If the image seems to describe a different kind of vehicle, first inspect the saved vehicle type and model. A Z125 entered as a car is a profile mismatch even if a model recognizes the motorcycle name and draws a motorcycle. Correct the type so guidance and markers agree with the actual vehicle. You do not need to spend another image credit merely to fix how an already-generated picture is framed in the card.

Generated images remain private and expire after ninety days. A successful response includes a browser `image_url` for the app, but a server API client should download through the corresponding `/api/v1/garage/vehicles/{id}/image` endpoint with its Bearer key. Do not remove authentication simply to make a third-party image tag load. Instead, fetch the image on your trusted server and apply your own authorized delivery policy.

## Transparent map markers and GPS position

The small vehicle marker is designed for legibility over a map. It has a transparent background, a type-specific top-down shape, a color selected from the garage profile, and limited holiday accents. Cars, motorcycles, trucks, trains, and aircraft have distinct silhouettes. Camouflage descriptions receive an illustrative camouflage palette. The marker is not a tiny crop of the garage’s full-size studio image, which would retain a background and become unreadable at navigation scale.

A marker with an `A` badge identifies the selected start point. It is a preview of where you chose to begin, not proof that your device or vehicle is physically there. Actual road GPS position uses the device’s geolocation updates during fullscreen guidance. When the device reports a valid heading, the vehicle icon can rotate with that heading. If heading is missing, the drawing’s default orientation should not be interpreted as a compass measurement.

GPS guidance is available only for supported mapped road proposals and only in fullscreen mode. It displays distance to the next proposed section, time at current speed, remaining proposed distance, speed, and reported accuracy. It stops when fullscreen closes, the page is hidden, the user stops it, or the route context changes. An old queued geolocation callback must not restart a stopped session.

Poor reported accuracy and off-route positions pause turn cues. The app does not use a pretend GPS position when a desktop cannot provide location. You can still choose endpoints, inspect a route proposal, or view weather evidence without a live position. Do not interpret the selected start marker as a substitute for a valid GPS fix.

The aircraft page’s surveillance positions come from OpenSky when that feed is available, not from the decorative garage icon or the road GPS watch. Reported aircraft positions are a different data source with different latency, coverage, altitude references, and limitations. No aircraft maneuvering or separation instructions are generated by moving a marker.

## Car route workflow

For a car journey, start with a correctly typed car profile or the generic road profile. Select both endpoints and verify that the map includes them. If an address search returns a street or area rather than a mapped house number, adjust the point manually and inspect the intended entrance. An apartment or suite identifier may be removed for address matching; that does not locate the unit inside a building.

The road workspace combines a labeled overview with automatic endpoint street and satellite views and overlapping corridor panels. The image manifest identifies the role, bounds, dimensions, and provider of each automatic view. The model is instructed to reconcile those views rather than relying solely on a zoomed-out overview or remembered street knowledge.

Imported map geometry supplies the road coordinates used for a solid ribbon when a supported connection is found. The model reviews the candidate and annotates its sections. The alignment process is conditioned on the visual corridor; it is not an independent legal routing engine. A road shape in a map can still be closed, private, incorrectly connected, grade-separated, or subject to a restriction not represented in the imported data.

Read each proposed maneuver and its evidence. “Turn left” in a proposal is not proof that the turn is currently permitted. Follow actual signs, signals, closures, road markings, and applicable rules. The application does not certify lane selection, right of way, speed choice, or access to a private driveway. Use the proposal as reviewable context, not an authority that overrides the road.

When the system returns `needs_context`, it should identify missing evidence or an unsupported connection. The reserved credit is returned, and no completed route report is saved for that failed proposal. Improve the endpoint placement, use a shorter corridor, or provide a readable site plan or directory. Do not fabricate a connection through a building or across a barrier to force a colored ribbon.

### Road color and severity interpretation

Chromographic ribbons distinguish lower, moderate, elevated, and unknown modeled caution. A gray or unknown section is not a safe section; it means the supplied evidence does not support a score. Scores must not be read as a measured probability of a crash. A weather estimate near a street is an area forecast, not a measurement of grip on that exact lane.

The optional NAZA-inspired state layer is a labeled two-qubit simulation. It changes a decorative fringe or pulse and has a baseline off switch. It does not change mapped coordinates, reported weather, risk scores, or vehicle performance. A reproducibility receipt identifies a simulation state; it is not a signature proving real-world safety or evidence of a physical quantum sensor.

## Motorcycle guidance

Save a motorcycle as `motorcycle` so the garage icon and route context reflect two-wheel exposure. Engine displacement and mass are descriptive assumptions, not a complete handling or braking model. A motorcycle’s real behavior also depends on tires, loading, suspension, road surface, rider skill, maintenance, and conditions that the application does not measure.

The model’s motorcycle context emphasizes wind exposure, precipitation, visibility, temperature, and uncertainty about surface grip. A weather forecast does not establish that a particular corner is dry, wet, icy, contaminated, or free of gravel. A low weather caution score is therefore not permission to select a particular lean angle, entry speed, following distance, or braking technique.

Use the satellite and street context to inspect a proposed entrance or intersection, but remember that imagery may be old. Small obstacles can be invisible, and a route image does not show whether a driver has yielded. If the model cannot support a street connection, the correct result is a request for more context, not a confident motorcycle shortcut.

For the Kawasaki Z125 example, distinguish the model description from the saved type. The garage can highlight that specific mismatch and offer a type correction. The user chooses whether to apply it; the application does not silently rewrite every manufacturer/model entry. After changing operating specifications, re-analyze a route when you need guidance to reflect the new profile.

## Trucks, 18-wheelers, and commercial loads

Use `truck` for an 18-wheeler or other heavy road vehicle. Enter the actual operating height, width, length, loaded mass, axle count, and hazmat status when known. A tractor’s brochure mass is not the same as the gross loaded combination mass. A nominal trailer length does not fully describe articulation or turning envelope.

The supplied dimensions become model context. They do not turn the imported road graph into a verified truck-restriction database. Bridge capacity, overhead clearance, seasonal load limits, axle restrictions, hazmat permissions, loading-zone rules, and turning clearance remain unknown unless independently verified from appropriate current sources.

The app should not certify clearance because a road looks wide in satellite imagery. Shadows, canopy, perspective, image age, and unmapped infrastructure can all make such an inference unreliable. A mapped road connection can be unsuitable for an articulated vehicle even when a car could use it. Treat a proposal’s restriction checks as items to verify with official signs, a truck-appropriate routing source, or the operator.

Hazmat is a profile flag, not a complete dangerous-goods classification. The application does not receive a full manifest, regulated class, tunnel category, jurisdictional permit, or emergency-response plan through that boolean. Do not infer that a route is authorized for a particular cargo merely because `hazmat` was set to `true` and an analysis completed.

## Train and rail advisory

Use `train` for a rail vehicle or consist. Length, mass, rail gauge, and traction type help organize the advisory context. They do not establish the actual track gauge, axle-load limit, loading gauge, electrical compatibility, or braking rules along a railway.

Rail mode provides an advisory checklist rather than road turn-by-turn navigation. Dispatcher authority, signals, switches, track possession, electrification, and railway operating procedures require official information and qualified operating decisions. A road map or aerial image cannot issue movement authority or prove that a switch is aligned for a train.

Electric traction requires appropriate verification of supply, clearance, and operating procedures. Diesel, steam, and hybrid traction have their own operator requirements. The app does not choose a braking curve, authorize passing a signal, or infer that track is unoccupied from an image or an absent public feed. The rail advisory API returns the vehicle’s scope and checklist so an integration can present those limits with the data.

## Aircraft briefing workflow

Create a correctly typed aircraft profile before opening the aircraft workspace. Enter only performance assumptions you can substantiate for your scenario. The application deliberately does not invent cruise TAS, burn, usable fuel capacity, or reserve from a model name. A registration or ICAO type label is not a performance table.

Provide departure and arrival airport codes and coordinates separately. Codes are syntax-checked, but code-to-coordinate matching is not verified. Confirm that both inputs represent your intended locations. The map’s dashed line is a direct geographic corridor. It is not a filed flight plan, an airway clearance, a terrain-clear route, a recommended altitude, or an approved track through controlled airspace.

Choose a scenario altitude and enter usable fuel in the unit saved with the aircraft. Refresh weather and traffic, then inspect the individual provider statuses. A successful HTTP response can contain an unavailable traffic feed and available weather feeds. Do not replace those independent status fields with one green “everything is safe” badge.

The optional AI review receives the same snapshot and explicit assumptions. It can summarize airport weather, wind samples, surveillance gaps, fuel arithmetic, and questions to verify with the pilot, dispatcher, or official briefing. It must not issue takeoff/landing clearances, separation instructions, movement commands, regulatory fuel approval, or a go/no-go decision. No connection to an autopilot, flight-control system, radio transmitter, or certified avionics is provided.

Monitoring is a user-started refresh at two-minute intervals. It stops when inputs change, the page is hidden, or the user stops it. It is not a real-time traffic service. The UI removes stale surveillance positions and clears previous scenario figures when you change the inputs, so old calculations are not silently presented as current results for a new aircraft or corridor.

## Airport weather: METAR and TAF

Airport weather is requested from NOAA Aviation Weather Center. A METAR is an airport observation with an observation time. A TAF is an airport forecast with an issue time and validity interval. The interface preserves the raw report text so a qualified reader can compare the AI interpretation with the source.

A station’s weather does not establish conditions at every point between airports. Terrain, local precipitation, cloud, wind, and visibility can vary substantially away from the reporting station. The application does not treat a clear airport report as proof that a mountain corridor or an entire flight path is clear.

Check issue and validity times. A record can be present but stale, outside its validity interval, or missing a trustworthy timestamp. Missing stations are reported explicitly. If only one product or one station is current, the overall airport weather can be partial. Do not silently substitute a prior successful result and label it fresh.

The current briefing does not supply a complete official aviation weather package. NOTAMs, approved charts, terrain, airspace restrictions, icing analysis, turbulence analysis, and convective-avoidance products are not established by these METAR/TAF and pressure-wind calls. Obtain the appropriate current official briefing and operational information separately.

## Winds aloft, jet-stream context, and units

Open-Meteo provides forecast winds at pressure levels near the requested scenario altitude. The application samples the start, midpoint, and destination corridor locations. Coordinates are rounded for weather queries; the output states the sample point, forecast time, pressure level, and approximate standard pressure altitude.

A pressure level is not the same as an exact geometric height above terrain. Atmospheric conditions and local elevation affect that relationship. A value shown near the requested altitude should therefore be read as a model sample at a named pressure level, not a measured wind at the aircraft’s exact flight level or height above the ground.

Wind direction is reported as the direction the wind comes from. This matters when interpreting headwind and crosswind components. Winds from opposite directions must not be compared as if both were directions of travel. The deterministic scenario calculation uses vector components and the corridor’s true course; it does not issue a magnetic heading command.

The 250 hPa samples provide upper-air context relevant to discussions of strong upper-level flow. They do not map the complete jet axis, diagnose turbulence, predict clear-air turbulence along a flight, or establish a safe passage around weather. A strong wind sample is evidence of a model wind value at that pressure and time, not a complete aviation hazard product.

Units are explicit: scenario altitude is feet; aircraft TAS and modeled wind speeds are knots; geographic distance is nautical miles; time is hours or minutes as labeled. Provider wind units are validated before arithmetic. An integration should retain units in its own UI and storage rather than inferring them from a numeric field name alone.

## Fuel and wind scenario arithmetic

The fuel scenario is deterministic arithmetic, separate from the model’s commentary. It uses user-supplied TAS, cruise burn, usable fuel, declared usable capacity, fuel unit, and scenario reserve. The direct corridor is split into two geographic legs, and the endpoint wind components are averaged for each leg. An unsolvable wind triangle or unsuitable groundspeed produces an incomplete result rather than an invented travel time.

The calculation uses constant TAS and burn. It does not add taxi, takeoff, climb, descent, approach, alternates, holding, terrain routing, airspace detours, performance changes with weight, or other operating allowances. The weather samples refer to the current forecast hour, not a time-marched forecast at every expected point of passage. These assumptions can materially change a real trip’s fuel requirement.

Fuel quantities remain in the saved unit: `gal`, `l`, or `kg`. Burn per hour must use that same unit. The application does not silently convert gallons to kilograms or invent a fuel density. If you change the unit in the profile, verify every associated quantity yourself. The data validation ensures consistent types and bounds, not that you have converted a real aircraft’s figures correctly.

The reserve entered by the user is a scenario assumption, not a regulatory minimum or approval. A positive scenario margin does not certify legal or adequate fuel. A negative margin indicates that the stated simple scenario falls below the entered reserve; it is an item to verify, not an automated flight command. Missing required inputs, fuel above declared capacity, or a corridor too short for useful trip estimates leaves fuel figures incomplete.

## OpenSky traffic, coverage, and failures

OpenSky Network supplies crowdsourced aircraft state vectors when its API is reachable. The application requests a limited geographic box around the start/monitoring point rather than a worldwide feed. The response includes the box bounds and source snapshot time. It is not a corridor-wide surveillance guarantee.

The normalized output can include ICAO24, callsign, position, reported barometric and geometric altitude, groundspeed, track, vertical rate, position time, and last contact. These references are not interchangeable. Barometric altitude should not be casually substituted for geometric height, and track is not necessarily the aircraft’s heading. The UI labels reported values instead of treating them as certified onboard measurements.

Old or invalid positions are filtered. Stale cached snapshots are withheld, and the browser removes positions that age beyond its display threshold. An empty array means no supported positions were available in that response; it does not mean the airspace is clear. Coverage can be limited by receivers, geography, transmitter behavior, filtering, provider delays, and outages.

Anonymous OpenSky access has limited upstream capacity. The deployment applies a daily global budget and a short shared cache. Optional OAuth client credentials can be configured securely by the operator. OAuth may change authentication and quotas; it does not guarantee network reachability or service availability. During testing, the endpoint timed out from Cloudflare even when a workspace request succeeded, so the production UI correctly reported traffic unavailable.

An aircraft integration must preserve `status`, snapshot time, coverage text, and failure information. Do not animate invented aircraft during an outage to make the map appear populated. Do not infer that a highlighted aircraft is your physical ownship unless you have independently established its identifier. QRoadScan provides no TCAS substitute, ADS-B In certification, conflict detection, separation service, or ATC authority.

## RainViewer controls and basemap troubleshooting

RainViewer is a precipitation overlay, independent of the basemap and the aircraft traffic feed. Use Play to cycle through the available recent frames. Stop holds the current frame. Moving the frame slider stops playback so your selection stays put. Turning off radar or hiding/leaving the page also stops the animation.

A transparent radar tile can mean no detected precipitation in that tile, incomplete coverage, or another source limitation. It does not establish an absence of all weather hazards. Precipitation imagery does not provide aircraft icing clearance, turbulence avoidance, road grip, or a safety forecast for a particular street.

The basemap uses hosted OpenStreetMap tiles with attribution. Those servers require a legitimate application referrer and compliance with their usage policy. The aircraft and road maps set a map-specific cross-origin referrer policy so the provider receives the site origin without a private page path. The application does not disguise itself as another site or proxy around a provider block.

If you see a tile reading “403 Access blocked,” refresh the page so the latest map code is loaded, then check the actual map request and referrer in your browser’s developer tools. A network or provider block can also occur independently of radar. Keep required attribution visible. Do not bulk-download or prefetch tile regions, and use an appropriate hosted or licensed service when application scale exceeds a public provider’s intended use.

## API quick start

The versioned API uses the production base URL below. The URL path remains `/api/v1/` for compatibility, while the capabilities response identifies the current additive API contract. Existing clients can continue using established endpoints. New clients should discover capabilities and key permissions before starting expensive work.

```text
https://ride.qroadscan.com/api/v1
```

Create a named, expiring API key in [Settings → API access](/settings/user#apiAccess). Choose Read-only, Road planner, or Full user API according to your integration’s needs. Copy the key once and put it in your trusted server’s secret store. The app does not show the raw key again. Changing a password ends browser sessions; it does not automatically replace every integration key, so revoke keys explicitly when required.

For a local server-side experiment, set the environment variable without committing it to a repository. The value below is a placeholder, not a usable key. Shell history, logs, shared terminals, build output, and crash reports can expose credentials, so use your normal secret-management practices.

```bash
export QRS_API_KEY='YOUR_PRIVATE_QRS_API_KEY'
export QRS_BASE='https://ride.qroadscan.com'

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/account" \
  -H "Authorization: Bearer $QRS_API_KEY"
```

A successful account response includes the current plan, account status, and available scan credits. Reading an account does not reserve a credit. If this first request fails, solve authentication or scope issues before submitting a scan, image, or route request. Do not debug authentication by repeatedly making paid model calls.

Next, inspect capabilities and the permissions on your current key:

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/capabilities" \
  -H "Authorization: Bearer $QRS_API_KEY"

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/key" \
  -H "Authorization: Bearer $QRS_API_KEY"
```

Capabilities describe supported surfaces, quotas, documentation links, and advisory scope. Key introspection returns the key’s identifier, scopes, and expiry metadata, not its secret. These discovery calls authenticate your key but do not require a separate content scope. They are useful when diagnosing why a valid Read-only key cannot create a vehicle or start a model analysis.

## Authentication, permissions, and key lifecycle

Every versioned request sends `Authorization: Bearer …`. A browser session cookie is not a substitute. The server hashes API-key material for lookup and checks revocation and expiry. A missing, malformed, revoked, or expired token returns `401`. An authenticated key that lacks a required permission returns `403 insufficient_scope` and identifies the missing scope.

| Scope | Purpose |
| --- | --- |
| `account:read` | Read account plan, status, and credits. |
| `scans:read` | List and retrieve owned scene or visual-route reports. |
| `scans:write` | Submit metered scene scans. |
| `routes:write` | Search route endpoints, preview automatic imagery, and submit visual road analyses. |
| `garage:read` | Read garage profiles, marker SVGs, and mode advisory checklists. |
| `garage:write` | Create, replace, delete, or activate owned vehicle profiles. |
| `images:read` | Retrieve owned generated PNG illustrations. |
| `images:write` | Request a metered, PHF-gated illustration. |
| `aviation:read` | Read aviation configuration and request advisory evidence snapshots. |
| `aviation:review` | Request an AI review of a refreshed aviation snapshot. |
| `operations:read` | Inspect owned metered-operation status and resource links. |

Read-only keys are suitable for dashboards that retrieve existing resources and advisory snapshots without changing garage profiles or generating art. Road planner keys include road analysis permissions while avoiding image generation and aircraft AI review. Full user API keys include the currently supported user API scopes. None of these presets grants browser administrator privileges.

Existing keys retain their former user-level capabilities when scopes are introduced. For backward compatibility, omitting scopes in the authenticated key-creation request retains the full user scope set. The Settings interface sends an explicit preset; new integrations should do the same through that managed UI. Review and rotate legacy broad keys when you can narrow their permissions.

Use a separate key for each integration or environment. Give it a meaningful name, an appropriate expiry, and only the required permissions. A development script that reads reports does not need permission to spend image credits. Revoke a compromised key immediately. Recreating a key is safer than trying to recover a secret that may have entered logs or a public bundle.

## Endpoint reference and response shapes

All paths in this table are relative to the production origin. Unless noted otherwise, requests with a body use `Content-Type: application/json`. Resource ownership is enforced independently of scopes: a key with `garage:read` cannot read another account’s vehicle by guessing its UUID.

| Method and path | Required scope | Main result |
| --- | --- | --- |
| `GET /api/v1/capabilities` | Valid key | Feature and quota discovery. |
| `GET /api/v1/key` | Valid key | Current key metadata and scopes. |
| `GET /api/v1/account` | `account:read` | Plan, status, available credits. |
| `POST /api/v1/scans` | `scans:write` | Metered scene report and operation ID. |
| `POST /api/v1/route/geocode` | `routes:write` | Candidate places with precision/source labels. |
| `POST /api/v1/route/atlas` | `routes:write` | Automatic imagery manifest and warnings, without a route-model analysis. |
| `POST /api/v1/route/analyze` | `routes:write` | Metered visual proposal or refunded context request. |
| `GET /api/v1/reports` | `scans:read` | Paginated owned report metadata. |
| `GET /api/v1/reports/{id}` | `scans:read` | An owned, unexpired encrypted-at-rest report. |
| `GET /api/v1/operations/{id}` | `operations:read` | Reserved/completed/refunded state and resource link. |
| `GET /api/v1/garage/vehicles` | `garage:read` | Owned vehicles and active vehicle ID. |
| `POST /api/v1/garage/vehicles` | `garage:write` | A new owned vehicle profile. |
| `GET /api/v1/garage/vehicles/{id}` | `garage:read` | Current profile and version. |
| `PUT /api/v1/garage/vehicles/{id}` | `garage:write` | Version-checked profile replacement. |
| `DELETE /api/v1/garage/vehicles/{id}` | `garage:write` | Logical deletion and cleanup scheduling. |
| `PUT /api/v1/garage/active` | `garage:write` | Active vehicle selection or clearing. |
| `GET /api/v1/garage/vehicles/{id}/marker` | `garage:read` | Transparent type/color SVG; no model credit. |
| `GET /api/v1/garage/vehicles/{id}/image` | `images:read` | Current private generated PNG. |
| `POST /api/v1/garage/vehicles/{id}/image` | `images:write` | PHF-gated GPT Image 2 result; one credit on success. |
| `POST /api/v1/garage/vehicles/{id}/guidance` | `garage:read` | Mode-specific checklist and optional area weather. |
| `GET /api/v1/aviation/config` | `aviation:read` | Provider and advisory configuration. |
| `POST /api/v1/aviation/snapshot` | `aviation:read` | Traffic/weather/wind/fuel evidence snapshot. |
| `POST /api/v1/aviation/briefing` | `aviation:review` | Refreshed snapshot plus bounded AI review. |

The garage list retains its established `{vehicles, active_vehicle_id}` response. A single profile is a profile object, not a generic list envelope. The new reports collection uses `{data, pagination, meta}` because it can grow over time. Binary image and marker endpoints return image bodies rather than JSON. Check response status and content type before deciding how to parse a response.

## Create and update vehicles through the API

Use a Full user API key or another key with `garage:write` for the write examples in this section. A Read-only key is intentionally denied. The following request creates an illustrative car profile. Replace the example values with your own verified information. `name` and `kind` are required; optional text fields can be omitted. Unsupported specification fields for the chosen kind are rejected instead of silently stored.

```bash
cat > vehicle.json <<'JSON'
{
  "name": "City car",
  "kind": "car",
  "make": "Example",
  "model": "Compact",
  "year": 2025,
  "color": "blue",
  "theme": "none",
  "appearance_notes": "Plain body panels and black wheels",
  "specs": {"mass_kg": 1300}
}
JSON

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @vehicle.json
```

Save the returned `id` and `version` in your own application. The UUID is not a secret credential, but it still identifies a private resource. An integration must not infer authorization from knowing that ID; it should always use the correct account’s key.

For a motorcycle, use `kind: motorcycle` and the motorcycle fields. Do not label a motorcycle as a car merely because a car was the first option in an older form.

```json
{
  "name": "Small motorcycle",
  "kind": "motorcycle",
  "make": "Kawasaki",
  "model": "Z125 Pro",
  "year": 2025,
  "color": "olive camouflage",
  "theme": "none",
  "specs": {"engine_cc": 125}
}
```

For a truck or rail vehicle, keep operating quantities explicit. The following snippets are examples of request shape, not validated operating data:

```json
{
  "name": "Illustrative articulated truck",
  "kind": "truck",
  "specs": {
    "height_m": 4.0,
    "width_m": 2.6,
    "length_m": 22,
    "mass_kg": 36000,
    "axles": 5,
    "hazmat": false
  }
}
```

```json
{
  "name": "Illustrative rail consist",
  "kind": "train",
  "specs": {
    "length_m": 500,
    "mass_kg": 200000,
    "rail_gauge_mm": 1435,
    "traction": "diesel"
  }
}
```

To update a vehicle, fetch the latest object, construct a replacement containing supported profile fields, and include the current `version`. Do not send server-generated fields such as `id`, `image_url`, or timestamps back as if they were editable profile properties. The server rejects unknown fields.

```bash
export VEHICLE_ID='YOUR_VEHICLE_UUID'

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles/$VEHICLE_ID" \
  -H "Authorization: Bearer $QRS_API_KEY"

# Put the editable fields and current version in vehicle-update.json.
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles/$VEHICLE_ID" \
  -X PUT \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @vehicle-update.json
```

A holiday change is an ordinary versioned profile replacement. It does not automatically spend an image credit. The current PNG endpoint refers to the profile’s current illustration, not an immutable historical art archive. Deleting a vehicle or changing its appearance can make a previously observed image link unavailable.

## Activate a vehicle, retrieve a marker, and request advice

Active selection helps the browser choose a profile when opening the road workspace. It does not teleport a GPS position, start monitoring, generate an image, or authorize a route. A profile must belong to the same account as the key.

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/active" \
  -X PUT \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data "{\"vehicle_id\":\"$VEHICLE_ID\"}"
```

Send `{"vehicle_id":null}` to clear the active selection. A deleted profile cannot be activated by retaining its UUID. The server checks current ownership and deletion state before changing the preference.

The marker endpoint returns a small, transparent vector illustration without a model call or image credit. Store or serve it only according to your own authenticated account policy; the production endpoint remains private.

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles/$VEHICLE_ID/marker" \
  -H "Authorization: Bearer $QRS_API_KEY" \
  --output vehicle-marker.svg
```

For a mode-specific advisory checklist, submit an empty JSON object or a supported optional location. The location is used for a coarse area-weather estimate when available. A train advisory does not become movement authority because a weather estimate was returned.

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles/$VEHICLE_ID/guidance" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"location":{"latitude":34.85,"longitude":-82.60}}'
```

## Generate and retrieve a private vehicle illustration

Image generation requires `images:write`, an owned vehicle, an existing credit, and an idempotency key. The body is the empty object `{}`. The application constructs the image description from the saved profile; a request cannot replace the server’s prompt, choose arbitrary provider URLs, disable PHF, or supply a different provider credential.

```bash
export IMAGE_IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles/$VEHICLE_ID/image" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IMAGE_IDEMPOTENCY_KEY" \
  --data '{}'
```

Keep the same key if your client loses the response and needs to retry that same logical generation. A completed replay should not invoke the provider or debit another credit. Generate a new key only for a genuinely new request, such as a new illustration after editing the theme. Do not turn a failed attempt into a retry loop that manufactures fresh keys to evade limits.

A successful JSON response identifies the operation, vehicle, model, PHF results, and credit use. The server-side download endpoint requires `images:read`:

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles/$VEHICLE_ID/image" \
  -H "Authorization: Bearer $QRS_API_KEY" \
  --output vehicle.png
```

Check `Content-Type: image/png` if your client handles multiple response types. A JSON error must not be saved as if it were a PNG and subsequently treated as a corrupted image. A missing or expired illustration returns a resource error; it should not cause your UI to show another user’s cached picture as a fallback.

A browser user performs the same generation through the signed-in settings flow with recent identity verification and CSRF. API keys authenticate explicitly instead; they do not submit the browser’s password or a CSRF cookie with every call. Protect an image-generation key because its permission can spend the owning account’s available image credits within the published limits.

## Submit a scene scan

A scene scan accepts observations, coordinates, model selection, and language. It is not the visual map-atlas workflow. The application supports the configured OpenAI scene model and local Llama service when available. Unsupported provider/model selections are rejected before charging. English is the supported scan language for this deployment.

```bash
cat > scene.json <<'JSON'
{
  "latitude": 40.758,
  "longitude": -73.9855,
  "vehicle_type": "car",
  "destination": "Selected public destination",
  "model": "openai",
  "language": "en",
  "weather": "Light rain reported by the user",
  "traffic": "Slow traffic reported by the user",
  "road_type": "Urban street",
  "obstacles": "None reported; not independently verified",
  "sensor_notes": "Illustrative input, not a live sensor feed"
}
JSON

export SCAN_IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/scans" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $SCAN_IDEMPOTENCY_KEY" \
  --data-binary @scene.json
```

The response includes the modeled classification, observations, provider provenance, report identifier, and operation identifier for a newly completed operation. Preserve the observations and limitations beside the result in your own interface. A `High` classification should not be relabeled as a measured chance of a crash, and a `Low` classification should not be presented as clearance to drive.

Local Llama can have a cold start because it runs in a container. Provider availability and latency differ from OpenAI. A returned failure with refund is different from a client timing out while the server is still working. Use operation status when you have an operation ID, or retry the same logical request with the same idempotency key rather than creating duplicate paid work.

## Visual road-route API

The visual-route endpoints are intended for clients that can provide an actual, correctly georeferenced map capture. They are not a text-only shortcut around missing map evidence. Use `routes:write`, supply owned vehicle IDs when needed, and preserve the map bounds and image dimensions associated with the pixels you captured.

### Find an endpoint

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/route/geocode" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"query":"Easley City Hall, Easley SC"}'
```

The result is a list of candidates with coordinates, labels, source, precision, and an accuracy description. A street-only match is not a resolved house entrance. A Census match can be interpolated. Unit removal means an apartment or suite suffix was removed for address lookup, not that the unit was found inside a complex. Your client should show the precision label and ask the user to confirm the actual endpoint.

### Preview the automatic atlas

```bash
cat > atlas.json <<'JSON'
{
  "start": {"latitude":34.8298,"longitude":-82.6015},
  "destination": {"latitude":34.8526,"longitude":-82.3940},
  "mode": "driving"
}
JSON

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/route/atlas" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @atlas.json
```

The atlas response contains role/bounds/dimension metadata and warnings, not a completed route and not the raw image bytes. It does not charge a route-model scan credit, but it is still quota-limited and uses upstream mapping services. Do not call it in a tight loop to harvest imagery or bypass a provider’s use restrictions.

### Submit an analysis with a real capture

The request below illustrates the shape. Replace the placeholder with a real PNG or JPEG data URI and use bounds/dimensions that match that exact capture. The server validates media signatures and dimensions, requires both endpoints inside the capture, bounds image sizes and context-image count, and rejects unsupported fields. Do not use a garage illustration as a map capture.

```json
{
  "start": {"latitude":34.8298,"longitude":-82.6015},
  "destination": {"latitude":34.8526,"longitude":-82.3940},
  "mode": "driving",
  "vehicle_id": "YOUR_OWNED_ROAD_VEHICLE_UUID",
  "notes": "Review the visible main-road corridor; verify legal turns separately.",
  "map": {
    "image": "data:image/jpeg;base64,REPLACE_WITH_REAL_IMAGE_BYTES",
    "width": 1000,
    "height": 750,
    "bounds": {"north":35.0,"south":34.7,"east":-82.2,"west":-82.8}
  },
  "context_images": []
}
```

```bash
export ROUTE_IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/route/analyze" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $ROUTE_IDEMPOTENCY_KEY" \
  --data-binary @route-with-real-capture.json
```

A completed proposal includes sections, imported/modeled provenance, geometry alignment metadata, image-manifest metadata, weather samples, limitations, and a stored report identifier. A `needs_context` response can be HTTP 200 while indicating that no supported proposal was completed and the credit was refunded. Inspect the semantic `status`; HTTP success alone does not establish a usable route.

Road analysis currently accepts driving and walking contexts. Aircraft and train profiles are rejected by this road handler. Do not describe an aircraft as a car to force a road ribbon into an aviation UI. For long or unsupported corridors, refine the region or provide better evidence; do not invent a continuous line and label it a verified road trace.

## Reports and signed pagination

Use `scans:read` to list the owning account’s completed, unexpired scene and visual-route reports. Generated garage images are deliberately excluded from scan history, so selecting a saved scan does not lead to a nonexistent image-as-report resource.

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/reports?limit=20" \
  -H "Authorization: Bearer $QRS_API_KEY"
```

The reports collection returns `data`, `pagination`, and `meta`. `data` contains report metadata and per-report URLs, not decrypted contents for every report at once. `pagination.next_cursor` is either a signed opaque cursor or null. Keep it exactly as returned; do not parse it to implement authorization or build your own cursor from another account’s values.

Cursors are bound to the owning account and report collection, and expire. They order reports by creation time and report ID, which avoids ordinary page-offset drift when newer reports arrive. They are not permanent bookmarks. If a cursor expires, restart the listing from the first page and deduplicate reports by their identifiers in your own application.

```bash
# Save the actual next_cursor from the prior response; do not invent one.
export REPORT_CURSOR='CURSOR_FROM_RESPONSE'
curl --fail-with-body --silent --show-error --get \
  "$QRS_BASE/api/v1/reports" \
  -H "Authorization: Bearer $QRS_API_KEY" \
  --data-urlencode 'limit=20' \
  --data-urlencode "cursor=$REPORT_CURSOR"
```

Retrieve one report through its owned resource URL:

```bash
export REPORT_ID='REPORT_ID_FROM_RESPONSE'
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/reports/$REPORT_ID" \
  -H "Authorization: Bearer $QRS_API_KEY"
```

Report access checks ownership, completion state, and retention. A guessed identifier does not grant access. Reports older than the supported retention period can become unavailable. Preserve the distinction between your own cached copy and a fresh server retrieval, and apply your own privacy and retention policy if you store copies externally.

## Operation status and idempotent recovery

New metered responses include an `operation_id`. Use `operations:read` to inspect the status when that identifier is available. Operation status is metadata about the work and credit state; it is not another model call.

```bash
export OPERATION_ID='OPERATION_UUID_FROM_RESPONSE'
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/operations/$OPERATION_ID" \
  -H "Authorization: Bearer $QRS_API_KEY"
```

`reserved` means the operation has reserved a credit and has not reached a settled terminal state. It does not mean the model is at a specific percentage. Respect `poll_after_seconds` rather than polling continuously. `completed` means settlement finished; the response can include a result resource link. `refunded` means the reservation was returned, which can result from a provider failure or an unsupported route requiring more context.

A status resource does not reveal another user’s operation. The server checks the owning account. A result link also does not bypass the scope required to retrieve the actual report or PNG. A key with operation-status permission alone does not automatically gain all report or image contents.

Use a fresh idempotency key for every genuinely new metered operation. Store the key together with the original request body before sending it. When retrying a transport failure, reuse the exact original body and key. Do not reuse a key across different operation kinds or different intended jobs. The key is an operation identity, not permission to swap the inputs after submission.

A request can finish after a client disconnects. If you lost the entire response and do not have an operation ID, retry the same request identity rather than inventing another job. A completed replay should not reserve or debit again. A conflicting or still-processing reservation can return 409. Read the original error and operation state before deciding whether the next action is to wait, correct an input, or create a new logical request.

## Aircraft API end-to-end example

First create an aircraft profile with `garage:write`. These numbers demonstrate field shape only. They are not recommended values for a real aircraft, a legal fuel reserve, or a substitute for the appropriate performance manual.

```bash
cat > aircraft.json <<'JSON'
{
  "name": "Illustrative trainer",
  "kind": "aircraft",
  "make": "Example",
  "model": "Trainer",
  "theme": "none",
  "specs": {
    "type_designator": "C172",
    "true_airspeed_kt": 110,
    "fuel_burn_per_hour": 9,
    "fuel_capacity": 45,
    "fuel_unit": "gal",
    "reserve_minutes": 45
  }
}
JSON

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/garage/vehicles" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @aircraft.json
```

Next use the actual returned vehicle UUID in a snapshot request. This example uses public airport coordinates. You must verify that the airport codes and coordinates match your own intended locations before relying on a scenario.

```bash
cat > briefing.json <<'JSON'
{
  "vehicle_id": "YOUR_AIRCRAFT_UUID",
  "start": {"latitude":34.8956,"longitude":-82.2189},
  "destination": {"latitude":35.4362,"longitude":-82.5418},
  "departure_airport": "KGSP",
  "arrival_airport": "KAVL",
  "altitude_ft": 5000,
  "usable_fuel": 35
}
JSON

curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/aviation/snapshot" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @briefing.json
```

Inspect `quality`, individual source statuses, raw airport records, wind timestamps, and `fuel_scenario`. Preserve missing, partial, stale, and unavailable distinctions. A fuel scenario can be incomplete even if a weather response exists. A valid airport forecast does not validate the aircraft’s entered burn or capacity.

Requesting an AI review requires `aviation:review`, uses the same request shape, and refreshes the evidence before asking the configured route model to review it. It is separately quota-limited and currently does not charge a scan credit.

```bash
curl --fail-with-body --silent --show-error \
  "$QRS_BASE/api/v1/aviation/briefing" \
  -X POST \
  -H "Authorization: Bearer $QRS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @briefing.json
```

The result contains `snapshot` and `briefing`. The briefing separates weather review, traffic review, fuel review, and items to verify before flight. Do not transform those advisory text arrays into a stream of automated cockpit commands. Keep the snapshot time and the limitations beside the commentary, especially when a provider is unavailable.

## JavaScript server client example

The following example is intended for Node.js on your trusted server. It reads the API key from an environment variable. Do not paste the key into a browser script or publish it in a static frontend build. The helper checks content type, preserves the server request ID, and distinguishes a JSON problem response from a successful payload.

```javascript
const origin = process.env.QRS_BASE || 'https://ride.qroadscan.com';
const key = process.env.QRS_API_KEY;
if (!key) throw new Error('QRS_API_KEY is required on the server');

async function qrs(path, {method = 'GET', body, idempotencyKey} = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(360_000)
  });
  const requestId = response.headers.get('x-request-id');
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(value?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = value?.code || value?.error;
    error.requestId = requestId;
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  return {value, requestId, headers: response.headers};
}

const capabilities = await qrs('/api/v1/capabilities');
console.log(capabilities.value.api_version);

let cursor = null;
const seen = new Set();
do {
  const query = new URLSearchParams({limit: '20'});
  if (cursor) query.set('cursor', cursor);
  const page = await qrs('/api/v1/reports?' + query);
  for (const report of page.value.data) {
    if (!seen.has(report.report_id)) {
      seen.add(report.report_id);
      // Process authorized metadata; fetch contents only when needed.
      console.log(report.report_id, report.operation_kind);
    }
  }
  cursor = page.value.pagination.next_cursor;
} while (cursor);
```

A timeout in this helper is a local timeout, not a guarantee that a metered operation was canceled. Persist the idempotency key and original body outside a transient function scope when you submit paid work. Avoid printing complete request bodies, images, credentials, or sensitive route details into application logs. Log request IDs and safe error codes instead.

## Python server client example

This example uses Python’s standard library. It illustrates authentication, JSON requests, and problem handling without requiring a particular HTTP SDK. A production service may use its own connection pooling, secret store, structured logging, and retry framework, but it should preserve the same authorization and idempotency rules.

```python
import json
import os
import urllib.error
import urllib.request

BASE = os.environ.get('QRS_BASE', 'https://ride.qroadscan.com')
KEY = os.environ['QRS_API_KEY']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def qrs(path, method='GET', body=None, idempotency_key=None):
    headers = {'Authorization': 'Bearer ' + KEY}
    payload = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        payload = json.dumps(body).encode('utf-8')
    if idempotency_key:
        headers['Idempotency-Key'] = idempotency_key
    request = urllib.request.Request(
        BASE + path, data=payload, headers=headers, method=method
    )
    try:
        with OPENER.open(request, timeout=360) as response:
            return json.load(response), response.headers.get('X-Request-ID')
    except urllib.error.HTTPError as error:
        try:
            problem = json.load(error)
        except (ValueError, TypeError):
            problem = {'error': 'non_json_error'}
        # Do not log KEY or an entire private request body.
        raise RuntimeError({
            'status': error.code,
            'code': problem.get('code', problem.get('error')),
            'request_id': error.headers.get('X-Request-ID'),
            'retry_after': error.headers.get('Retry-After')
        }) from None


account, request_id = qrs('/api/v1/account')
print('Available credits:', account['api_credits'])
```

Binary endpoints need a separate download path in your client. Check the HTTP status and `Content-Type`, then write authorized bytes to your chosen private storage. Do not run a JSON parser over a PNG or SVG. Conversely, do not write an error problem document into a `.png` file and later diagnose it as an image-generation defect.

## Errors, request IDs, and retries

Versioned errors use a problem-style JSON response while retaining the established `error` code for compatibility. The document includes status, code, detail, and a request ID. Responses also carry `X-Request-ID`. Give that identifier and the safe error code when reporting a problem; do not paste a key, session cookie, provider credential, or an entire private image body.

```json
{
  "type": "about:blank",
  "title": "insufficient scope",
  "status": 403,
  "code": "insufficient_scope",
  "error": "insufficient_scope",
  "detail": "insufficient_scope",
  "request_id": "SERVER_GENERATED_REQUEST_UUID",
  "required_scope": "garage:write"
}
```

| Status | Typical meaning | Appropriate next step |
| --- | --- | --- |
| `400` | Invalid JSON, unsupported field, invalid coordinates, bad cursor, or invalid specs. | Correct the request; do not repeat it unchanged. |
| `401` | Missing, malformed, expired, or revoked Bearer key. | Check the secret and expiry; do not fall back to a browser cookie. |
| `403` | Missing scope or a browser security check failed. | Use the required permission or correct browser session/CSRF flow. |
| `402` | No available credit for a metered operation. | Inspect account credits; no purchase flow is currently enabled. |
| `404` | Resource absent, deleted, expired, or not owned by the account. | Check the owned identifier and retention; do not enumerate other IDs. |
| `409` | Version, idempotency, or processing conflict. | Reload current state or wait for the same operation; do not blindly overwrite. |
| `413` | Request or image body exceeds a bound. | Reduce the payload within the documented capture limits. |
| `415` | Body does not use the required JSON content type. | Send `application/json` for JSON endpoints. |
| `422` | A PHF check rejected the image request or output. | Revise the descriptive content; do not attempt to bypass the gate. |
| `429` | A baseline or feature-specific quota is exhausted. | Respect `Retry-After` and the applicable reset window. |
| `503` | A model or upstream service cannot fulfill the operation. | Preserve request identity and inspect operation/refund state before retrying. |

Not every unavailable provider produces an HTTP error for an aircraft snapshot. The endpoint can return a successful evidence envelope with a specific provider marked unavailable. This is intentional: partial weather information may still be useful as long as the missing traffic or wind source remains visible. Your client must inspect semantic statuses as well as HTTP status.

Avoid automatic retry loops for validation failures, PHF rejections, insufficient credits, missing permissions, or stale profile versions. A retry cannot fix those by itself. For transient transport failures, use bounded exponential backoff with jitter and the same idempotency key/body for the same metered operation. Never assume that dropping your HTTP connection canceled a provider task already running on the server.

## Rate limits, quotas, and cost controls

The API applies a baseline budget of 120 requests per API key per minute. Individual features have additional account, key, global, or daily limits. These are separate controls. Passing the baseline limit does not imply permission to generate 120 images or run 120 route analyses in that minute.

Responses with a known API budget include `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. The reset is an epoch timestamp. A 429 also carries `Retry-After` in seconds. When a feature-specific limit is the one that rejects the request, the rate information can describe that limiting feature rather than the baseline minute bucket. Inspect the response instead of hardcoding a universal five-second retry.

| Feature | Current account/key budget | Additional considerations |
| --- | --- | --- |
| API baseline | 120 requests/key/minute | Applies to discovery and ordinary API calls too. |
| Scene scans | 20 attempts/key/minute | Successful metered work uses a credit. |
| Visual route analysis | 6 attempts/account/hour | A separate global route budget also applies. |
| Atlas preview | 6 requests/account/hour | No route-model credit, but mapping-provider limits still apply. |
| Route search | 15 requests/account/minute | Upstream geocoder pacing and availability also apply. |
| Vehicle art | 2 attempts/account/UTC day | Ten global attempts/day; one credit on success. |
| Aircraft evidence | 40 requests/account/hour | Monitoring and manual refresh share this budget. |
| Aircraft AI review | 4 requests/account/UTC day | Twenty global requests/day; currently no scan credit. |

Daily application windows use UTC boundaries, which may not be local midnight for your browser. Do not promise a user that a quota resets at their local midnight unless you have explicitly converted the actual server reset time. Provider quotas can be independent of application budgets and can still cause unavailable responses.

Short shared provider caches reduce repeated upstream requests for nearby traffic, airport weather, and wind samples. They do not turn old source timestamps into current ones. The homepage’s fictional Grok refresh is a different workflow and does not reuse a cached simulated scene. Treat each surface according to its own source and freshness semantics.

## Browser sessions, CSRF, and security keys

The signed-in browser app uses its own session flow. Login, registration, logout, password changes, garage mutations, route tools, and administrator actions require the relevant same-origin and CSRF checks. The application’s own API helper obtains a signed token and sends `X-CSRF-Token`. A valid token refresh preserves the browser cookie so another tab is not unnecessarily invalidated.

The public homepage uses a limited signed preview cookie for its own token flow. That cookie does not grant account access or administrator rights. Likewise, possessing a CSRF token is not authentication. The server still checks the session, ownership, scope, and any recent-verification requirement appropriate to the endpoint.

Passkeys and FIDO2 security keys can be enrolled in Settings after recent identity verification. Registration and sign-in require user verification on a supported authenticator. Challenges are short-lived, bound to the browser/session, consumed once, and checked against the expected origin and relying party. The server stores public credentials, not the authenticator’s private key.

API-key creation/revocation and other sensitive account actions require recent server-side verification in the browser. A normal password login does not automatically unlock all sensitive changes indefinitely. Verified passkey sign-in has its own short elevation window. Removing a security key does not make an existing API key vanish; manage each credential type explicitly.

Static scripts, styles, and module preloads carry Subresource Integrity hashes. The browser should reject altered bytes that do not match the page’s expected digest. CSP restricts script execution and framing. These controls complement authorization; they do not make a leaked API key harmless or prove that a model’s output is correct.

## Administrator console and support operations

The administrator console is a separate browser surface available only to operator-provisioned administrator accounts. A signup email, API-key permission, garage type, or client-provided role field cannot grant that role. Server-side role checks apply to each administrator route. API Bearer keys do not act as administrator sessions.

The console can show bounded account search, service configuration status, security posture, and an audit trail. Sensitive user operations require recent verification. Support-credit grants are positive, bounded, idempotent ledger entries with a reason. Session and API-key revocations are audited. Provider status is reported as configuration metadata rather than revealing secret values.

An administrator should identify the correct account before applying an action. A support reason should be meaningful without including a password or provider key. Replaying the same support reference should not duplicate a grant. A revocation action is different from deleting private reports or modifying an aircraft’s entered operating assumptions.

The console does not provide a general tool for reading other users’ decrypted garage profiles, images, or private reports. Cloud infrastructure operators and application administrator sessions are different trust boundaries. Review deployment documentation and your own operational policy before changing secret bindings, database roles, or encryption keys.

## Integration architecture and operational checklist

Use a trusted backend between your public frontend and the Bearer API. Store one key per integration, set explicit permissions, and avoid sharing a broad production key among unrelated jobs. Your backend can authenticate its own users and decide which account-owned resources each of them should see. QRoadScan’s account boundary does not automatically implement your own organization’s multi-user authorization rules.

Persist metered request identity before sending work. Store the idempotency key, operation type, a reference to the exact request body, submission time, and eventual server operation/report ID. Keep images and route captures in appropriately private storage. Redact credentials from logs and avoid logging full payloads merely because they are helpful during development.

Separate source data from interpretation in your UI. Display provider timestamps, coverage, missing values, scope, and assumptions beside a score or AI summary. If a feed becomes stale, remove or clearly mark the outdated positions. If a profile changes, do not continue presenting old fuel figures or model context as if they were recomputed for the new profile.

Build bounded retry and polling behavior. Use the server’s operation state and retry headers. Do not create fresh paid work whenever a browser tab rerenders. Stop monitoring when a user leaves the relevant view. Cache only data you are permitted to cache, retain its original source timestamps, and follow provider access and licensing terms before scaling or commercial use.

Before deploying an integration, exercise wrong-key, expired-key, insufficient-scope, bad-body, version-conflict, provider-unavailable, stale-traffic, and client-timeout paths. Test that another account’s resource ID does not work with your key. Verify that a failed illustration does not debit twice and that a successful replay does not call the generator again. An integration that works only on the happy path is not ready for sensitive account data or metered model work.

## Troubleshooting and frequently asked questions

### Why is the garage picture cut off?

The image may be fine while the card’s layout is using the PNG’s intrinsic size. The current card explicitly contains and centers the full picture, and the larger viewer lets you inspect it without a narrow card crop. Refresh the page to load the latest styling. You do not need to regenerate and spend a credit just to repair the display box.

### Why does my motorcycle show a car icon?

Check the saved `kind`, not just the make/model text. The marker is based on the type you saved. Correct the profile to motorcycle, verify its specifications, and select it in the road workspace. The known Z125 mismatch has an explicit correction action. Type correction is a user choice and does not silently edit all existing profiles.

### Does the tiny icon cost another credit?

No. The transparent type/color marker is a vector rendering. The large studio illustration is the metered GPT Image 2 resource. They serve different purposes and have separate rendering paths. Downloading a marker does not trigger PHF or image generation because it is built from constrained local shapes and colors.

### Why do I have a key but still get 403?

A valid key can lack a required scope. Inspect the problem response’s `required_scope` and use `/api/v1/key` to inspect your permissions. A Read-only key should be denied when it tries to create a profile or spend an image credit. Do not attempt to solve that by sending an administrator email in the request body.

### Why did a successful HTTP response return no route?

The semantic route status can be `needs_context`. The request was processed, but the evidence did not support a completed proposal. The credit is returned. Read the targeted requests for better endpoints or imagery. HTTP 200 is not a claim of route feasibility.

### Why is aircraft traffic unavailable while weather works?

Traffic and weather come from independent services and can fail independently. OpenSky may be unreachable, rate-limited, require different access, or return stale data. The current deployment has experienced Cloudflare-to-OpenSky timeouts. The app must not turn an unavailable feed into an invented empty-but-clear traffic picture.

### Why is the fuel number incomplete?

Check TAS, fuel burn, capacity, unit, reserve, usable fuel, corridor distance, and wind availability. The calculation avoids inventing missing inputs or converting unrelated units. A simple scenario cannot represent every flight allowance, and an entered reserve is not regulatory approval.

### Can I use aircraft mode as ATC or a navigation instrument?

No. The surface is an advisory briefing reader and scenario tool. It provides no clearance, certified surveillance, separation, collision avoidance, flight-control interface, or approved route. Keep official sources and qualified operating decisions in their proper roles. AI commentary does not override them.

### Why does a private image URL fail on my external site?

The image is private. A browser-oriented app URL expects the correct session, and a versioned download expects a key with the proper scope. Do not make the bucket public. Fetch authorized bytes on your trusted server and implement an appropriate user access policy there.

### What should I include in a useful bug report?

Include the page or endpoint, safe error code, request ID, approximate time with timezone, browser/client version, and the steps that reproduced the problem. Mention whether a source was marked stale or unavailable. Exclude raw keys, cookies, passwords, VINs, personal home addresses, and full private images unless you intentionally choose a secure support channel for them.

## Provider attribution and implementation limits

Mapping uses OpenStreetMap data and hosted tiles with attribution; imported road geometry uses OpenFreeMap/OpenMapTiles sources where applicable. Endpoint and corridor imagery can use Esri services with their visible attribution. RainViewer supplies precipitation imagery. NOAA Aviation Weather Center supplies airport weather products. MET Norway and Open-Meteo provide area weather/model forecasts. OpenSky Network supplies public aircraft state vectors when reachable. OpenAI and xAI provide configured model services.

Each provider has its own access, licensing, availability, privacy, and usage terms. A working development request does not establish permission for unlimited production or commercial use. Review the relevant terms and obtain appropriate agreements or paid access before scaling. Keep source attributions visible and preserve provenance rather than relabeling external data as an in-house measurement.

The project’s security tests and browser checks exercise specific implemented controls. They are not a certification of road safety, aviation suitability, cryptographic perfection, or every possible threat. The app has no live vehicle or aircraft hardware validation. Synthetic GPS fixtures and simulated quantum states are explicitly test/simulation data, not evidence that a real route or flight is safe.

For maintainers, the repository includes deployment instructions, implemented security controls, validation records, and the OpenAPI artifact. Build the frontend before deployment so page assets and SRI hashes stay synchronized. Apply required database migrations before publishing a Worker that expects the new columns. Never commit local environment files, provider credentials, private test-account files, or generated customer images to the repository.
