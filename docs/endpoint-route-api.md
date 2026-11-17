# Endpoint-driven route API

`POST /api/v1/routes` accepts start/destination coordinates, an optional road vehicle, a planning objective, mode and notes. It uses `routes:write`, the existing route admission limits, atomic free/paid reservations and the existing idempotency/report workflow. Clients no longer need to assemble or upload an overview image.

After reservation, the server fetches a bounded labeled overview from the existing fixed imagery provider and validates its actual returned dimensions, image bytes, extent and endpoint coverage. The normal endpoint/corridor imagery, available weather, visual-model proposal, imported-road alignment and mapped-section review follow. The endpoint always requires road alignment before returning GeoJSON, even if legacy visual-only routing is configured elsewhere.

The response adds a FeatureCollection, section instructions, endpoint inspection metadata and a risk summary. The summary is distance weighted over scored sections only and includes scored and illustrative-baseline coverage. Unknowns stay null. Endpoint scores refer to adjacent route sections, not independently verified driveway hazards. No model score is presented as an accident probability. A rejected/unsupported route returns no usable geometry or turn list.

Validation rejects invalid/extra fields, coincident endpoints, spans over 90 km, unsupported map areas and cross-antimeridian routes before reservation. Arbitrary URLs and uploaded image fields are not accepted on this compact surface. Address selection remains explicit through the scoped geocoding endpoint to avoid silently choosing an incorrect residence or entrance.

The API retains existing account ownership, CSRF/Bearer separation, administrator pause/feature switches, scoped keys, key revocation checks, storage bounds and paid refund behavior. Failed free attempts stay counted. `/api/v1/route/analyze` remains compatible for callers supplying their own georeferenced imagery.

The public documentation and OpenAPI 2.2 describe the request, response, examples and limits. Tests exercise strict validation, world-edge bounds, risk aggregation, unknown preservation, disabled/paused work, missing scope, no-funds rejection, automatic imagery, trial accounting and mandatory alignment.

## Release verification

The release passed 193 automated tests and desktop/mobile documentation checks. A single live API attempt between public Manhattan endpoints returned a matched three-section route with GeoJSON, turn instructions, endpoint offsets and scores for all three sections. The saved report reproduced the risk summary, and replaying the same request returned the saved result without consuming a second trial attempt. The temporary key was revoked; the attempt remains counted against the shared free budget. Explicit-null input validation was subsequently tightened and its focused tests passed.
