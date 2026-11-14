# Admin publishing and runtime configuration

## Write a blog post

1. Sign in at `https://ride.qroadscan.com/login` with an administrator account.
2. Open `/blog` and choose **Write a post** or **Manage blog**, or go directly to
   `/admin#blog`.
3. Choose **Verify admin access** and enter your current password if needed.
4. Enter title, URL slug, description and body. Use the formatting toolbar and
   **Preview**, then **Save draft** or **Publish now**.

The public blog is now backed by D1 rather than the migration's static empty
page. No sample article is automatically published. The server renders listings
and post pages, so published text is visible without executing a client renderer.
Only `published` rows can be retrieved publicly. Drafts and archived posts remain
available only to a recently verified administrator.

Supported formatting: headings, bold, emphasis, ordered/unordered lists, quotes,
inline code, fenced code, HTTP(S) links, paragraphs and line breaks. Raw HTML is
always escaped. Image embeds and arbitrary HTML attributes are intentionally
unsupported. The same small renderer runs in editor preview and on the server;
there is no raw-HTML publishing mode or third-party editor script.

Published posts are at `/blog/<slug>`. Saving changes to a published post updates
it publicly. Unpublish returns it to draft; archive keeps the record privately;
restore returns an archive to draft. Changing a slug changes the URL and does not
create an automatic redirect. The listing shows the latest 50 published posts;
the admin list includes up to 500 posts, the database-enforced storage ceiling.
Titles, descriptions and bodies are bounded to 160, 280 and 30,000 characters.
Public HTML is no-store/no-transform; third-party copies cannot be recalled.

## Configuration

The console supplies 21 controls across General, Access, Features, Publishing,
Models and Limits. Settings are validated on the server and persisted as the
singleton `site_settings` record. Changes take effect when subsequent API/auth
requests read that record. Provider keys and bindings remain in Cloudflare.

| Controls | Effect |
| --- | --- |
| Public site/blog name | Blog branding and announcement label |
| Public announcement | App announcement banner; never interpreted as HTML |
| HTTPS support URL | Support link in app account navigation |
| Registration | Can disable signup; cannot override a disabled Cloudflare switch |
| Pause new work | Stops new AI/generation requests while keeping login/reports/admin access |
| Optional feature switches | Public AI preview, routes/atlas, voice, garage images, aircraft AI |
| Blog availability | Disables public blog reads while leaving the admin editor available |
| Four model overrides | Route/aircraft OpenAI, homepage OpenAI, homepage Grok, scene OpenAI |
| Six quota controls | Can reduce budgets within existing safety ceilings |

Quota maxima remain: 6 route analyses/account/hour, 60 routes globally/hour,
6 atlas previews/account/hour, 120 voice requests/account/hour, 10 image
attempts globally/day, and 4 aircraft AI reviews/account/day. Other existing
quotas and credit reservation/refund behavior are retained. Models must actually
be available to the configured provider account; model identifiers do not grant
new provider permissions. Blank model overrides use the operator's environment.

Saving requires a reason. Filling defaults edits the form only; it does not save.
Version checks reject stale settings or post saves instead of silently overwriting
another admin's work. The UI asks you to reload/reconcile in that case.

## Privilege and audit boundaries

- Browser cookie session, admin role and recent five-minute verification required
  for draft/configuration reads and every publishing/configuration write.
- Existing signed CSRF and Origin checks apply to all mutations.
- API bearer keys cannot manage posts or site configuration.
- New writes recheck role, session expiry and elevation in their database
  statements, closing the gap if access expires or is removed while reading a body.
- Database triggers atomically append audit entries for post creation/status
  changes and configuration saves. Full post bodies are not duplicated in logs.
- Provider endpoints, secret values, password material, administrator roles and
  payment activation cannot be edited through these controls.
- Stripe's operator switch remains false. Admin controls cannot bypass it or the
  separate sandbox/live safeguards.

## Administrative API

All routes below require the browser/session boundaries above.

| Method | Route | Body / response |
| --- | --- | --- |
| GET | `/api/admin/settings` | Saved settings, schema, version and safe operator metadata |
| PUT | `/api/admin/settings` | `{version, settings, reason}` |
| GET | `/api/admin/posts` | Private post metadata list |
| POST | `/api/admin/posts` | `{title, slug, excerpt, body, status}` |
| GET | `/api/admin/posts/<id>` | Private editor contents and version |
| PUT | `/api/admin/posts/<id>` | Same post fields plus `version` |
| GET | `/api/site` | Public name/announcement/support and route availability metadata |

Public blog GETs expose only published content. Editor responses are no-store.
No API key, password, email address or private account report is embedded in public
blog HTML.

## Deploy and validate

Apply `0014_admin_publishing.sql` before deploying the Worker. It adds tables,
indexes and audit/size triggers without replacing old account, credit or report
records. Run `cloudflare/build_frontend.py` after UI/formatter changes: it refreshes
SRI, transitive module preloads and the server blog asset integrity constants.

Tests cover privileges/CSRF, private drafts, publication/unpublication/archival,
version conflicts, uniqueness, HTML/link injection, settings validation, feature
switches, paused work, audit entries and access revocation at write time.
Browser validation uses an isolated local database for actual publication/status
changes. Production verification saves only a temporary private draft, removes it
after the check, and leaves production settings and published content untouched.

## Release verification

- All **142 Cloudflare tests passed**, including privilege changes during writes
  and long malformed formatting inputs.
- Isolated Chromium checks exercised draft/save/preview, publication,
  unpublication, archival, restoration and configuration updates.
- Production Chromium checks verified the logged-in admin's `/blog` writing links,
  recent verification, all 21 settings, private draft saving and layouts at 1500,
  1024 and 390 pixels, without script exceptions. Production test drafts were
  removed afterward and verification sessions were signed out.
- Public blog asset SRI, no-store/no-transform responses, app health, unchanged
  default feature settings and disabled payments were verified after deployment.
- Migration `0014_admin_publishing.sql` was applied; the final Worker deployment
  version is `94a3424d-dee9-421c-840e-10d32202bb58`.
