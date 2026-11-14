# Terms and editorial sources

The canonical Terms source is `legal/terms.md`. `scripts/build-legal.py` builds both public mirrors and `cloudflare/legal-version.mjs`, which pins the exact UTF-8 source SHA-256 and document version. The frontend build invokes this builder. Terms are available at https://qroadscan.com/terms/ and https://ride.qroadscan.com/terms.

New registrations must affirmatively accept the current version through an initially unchecked required checkbox. Registration and acceptance are recorded in one database batch. Existing accounts are not silently accepted or automatically blocked: Settings → Terms offers explicit review and acceptance. Cookie-session acceptance requires CSRF verification, rate limiting, and a current session recheck at the write boundary. Bearer keys cannot consent for the user. Records contain account, version, fingerprint, time and method, with an audit event; no extra IP or user-agent collection is added. Migration 0015 creates these records.

Changing the document requires changing its version and rebuilding before deployment. Historical acceptance remains tied to its original version and fingerprint; preserve historical legal source in Git. Do not collect agreement on behalf of a real account during automated verification.

The document uses QRS branding without naming an individual, corporation, address or selected jurisdiction. This does not establish legal anonymity, substitute for any legally required business disclosures, or guarantee enforceability. Obtain qualified legal review for operator identification, applicable law, consumer protections, injury-related exclusions and the intended markets. Non-waivable rights and liabilities remain preserved.

The long-form QRoadScan roadmap article is sourced in `content/posts/qroadscan-safer-journeys-quantum-entropy-roadmap.md` with separate title/slug/excerpt JSON. Publication uses the existing admin editor API, recent password verification, signed CSRF and normal auditing. Article text distinguishes current features, modeled research and future ambitions.

`examples/rgb_entropy_research.py` is an executable NumPy/PennyLane research example. Run it in an environment containing those packages. The three-qubit pure-state simulation produces measurement entropy about 2.430597 bits, normalized entropy 0.810199, qubit-zero subsystem entropy about 0.538330 bits, and display color #acac8d for its documented example input. These are simulation properties, not crash probabilities or evidence of transport conditions.
