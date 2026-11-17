# Journey quick start and request controls

The dashboard places **Plan** immediately below the endpoint controls. Endpoint vision and image options are collapsed initially so the primary action stays close to Start and Destination.

New registrations create a versioned, pending onboarding record in the same database transaction as the account. After the first dashboard sign-in, a four-step guide explains endpoints, vehicle details, planning credits and full-screen GPS guidance. Completing or skipping it saves the preference to the account; existing accounts can open **Quick start** manually. Registration remains controlled independently by `REGISTRATION_ENABLED` and is enabled for the capped public trial.

`GET /api/onboarding` returns the current account's guide state. `POST /api/onboarding` accepts exactly `{"version":1,"action":"complete"}` or `{"version":1,"action":"skip"}`. These endpoints require a browser session; mutations also require the normal signed CSRF token and origin checks. API keys cannot change onboarding preferences. Completion cannot be downgraded by a later skip, and revoked sessions cannot write preferences. Requests are rate limited. Existing accounts without a record do not receive an automatic tour.

Address searches discard results if their input changed while the request was running. During route analysis or an unresolved retry, endpoint controls and marker dragging stay locked; retries reuse the original payload and idempotency key. Coordinates less than one meter apart are rejected before image capture or paid model submission. Image-atlas previews also lock planning controls while being prepared.

Validation includes account isolation, CSRF enforcement, disabled registration, revoked-session writes, guide persistence, stale searches, identical endpoints, pending-request retries, and mobile/desktop dialog layouts. Browser tests use an isolated database and mocked analysis responses; they do not spend model credits or enable public registration.
