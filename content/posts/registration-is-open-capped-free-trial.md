# Registration is open: explore QRoadScan with a capped free trial

QRoadScan registration is now open. You can create an account, explore the road-planning workspace, build a private vehicle garage, and try route intelligence without connecting your own AI-provider key.

This release is an invitation to explore what the system can show—and to understand the difference between a useful modeled proposal and verified navigation. QRoadScan brings route geometry, map imagery, available weather evidence and model-generated explanations into one workspace. It makes the information behind a proposal easier to inspect rather than presenting a color as a guarantee.

## What you can try for free

Each account can use up to **five browser scan attempts per UTC day**. There is also a separate **three-attempt API trial per account, total**, shared across all of that account's API keys. Creating another key does not refill the trial.

The public free pool has a shared ceiling of **50 attempts per UTC day and 500 per UTC month**, combining browser and API trials across everyone. These ceilings keep the experiment bounded while we learn from real use. They can stop free analysis before your personal allowance is exhausted. Unused daily attempts do not accumulate.

An attempt counts when the service admits a new analysis request, even if the model subsequently fails, asks for more context, or cannot produce a connected route. Those requests can still consume provider resources. Replaying the same completed operation with the same idempotency key does not consume a fresh attempt. Existing paid-credit refunds retain their separate rules.

Payments and automatic overages remain disabled. The free scan trial does not include paid vehicle-image generation. The allowance is a request limit, not a promise about any cloud provider's dollar-denominated bill.

## Your first journey

Register at [ride.qroadscan.com/register](https://ride.qroadscan.com/register), review and accept the Terms, and sign in. A new-account guide walks through the workspace. You can reopen it later with **Quick start**.

Enter a start and a destination, select the appropriate address results, or use coordinates. Location permission is optional: manual endpoints are useful when a laptop cannot provide a reliable position. Inspect the actual start and destination entrances; the center of a building is not necessarily its driveway.

The planning button is now directly beneath the endpoint controls. Select your garage vehicle if you have one, add relevant preferences, and submit one journey. Endpoint imagery and map context are assembled automatically. You can also supply an entrance photograph or a readable site plan when the last few meters matter.

Once a proposal is available, click its colored sections to inspect the modeled caution readings and their explanations. Gray or unsupported portions need attention: lack of evidence should remain visible. A low modeled score is not proof that a road is safe, and the number is not a calibrated accident probability.

## A workspace for different vehicles

A motorcycle, passenger car and articulated truck have different considerations. Garage profiles let the system receive relevant vehicle details rather than assuming every journey has the same needs. Truck dimensions and trailer information can inform the review; motorcycle guidance can consider available weather evidence and exposure.

These reviews do not certify a truck turn, bridge clearance, legal access or traction. Verify restrictions and physical conditions independently. Aircraft tools provide a separate briefing surface, where available traffic and weather sources retain their timestamps and availability indicators. They are not an air traffic control or collision-avoidance service.

Full-screen road guidance can use device GPS after you explicitly start it and grant permission. It depends on usable signal and on the quality of the proposed route. Review the route before departure; follow actual road signs, restrictions and conditions.

## Developers: a clearer path from key to request

The [documentation](https://ride.qroadscan.com/docs) now starts with a developer quick start. Switch between cURL, Python with httpx, Python requests, JavaScript, Go, C# and PHP examples. The first request reads your account balance and does not spend a scan attempt.

Create a named, expiring key in Settings and give it only the scopes your integration needs. Store it on your own server. A QRoadScan API key is separate from an OpenAI, Grok or Cloudflare credential. Never embed private keys in a public frontend, URL or repository.

The endpoint index is generated from the same OpenAPI source available for download. Guides cover authentication, account balances, route requests, garage operations, aircraft evidence, report pagination, operation status, errors and retries. The account response distinguishes paid credits from daily browser attempts and the API trial, so your integration can explain what is available before it submits new work.

For metered requests, use an idempotency key. If the network drops, recover the same operation with the original body and key instead of creating new work blindly. Inspect both HTTP status and the result's semantic status: a response requesting more context is not a completed route.

## Security is part of the workflow

Browser mutations retain signed CSRF checks and same-origin protections. API integrations use scoped Bearer credentials. Private reports and garage resources are checked against account ownership. Free-use reservations are enforced at the database boundary, including simultaneous submissions.

You can enroll security keys in Settings. An account with an enrolled key requires its password and an enrolled key for browser sign-in. Keep a spare key: there is no password-only bypass for a key-protected account.

These controls reduce specific risks; they do not make any application immune to failures or abuse. We will keep refining the service as evidence and testing reveal where it needs improvement.

## Help us make the next iteration better

Useful feedback describes what you tried, what you expected, and what the interface returned. Include a safe request ID when one is available. Do not share private keys, session cookies, sensitive images or your home address publicly. A nearby public place or a redacted example often provides enough context to investigate.

Our long-term goal is to help people make more informed mobility decisions across different kinds of vehicles. The current release is one step in that direction: inspectable proposals, clearer limits, and a straightforward way for developers to explore them.

[Create an account](https://ride.qroadscan.com/register) · [Read the API quick start](https://ride.qroadscan.com/docs#api-quick-start) · [Review the Terms](https://ride.qroadscan.com/terms)
