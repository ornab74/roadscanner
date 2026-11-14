# qroadscan.com public website

This assets-only Cloudflare Worker is separate from the authenticated Ride app.

- Worker: `qroadscan`; custom domain: `qroadscan.com`.
- Homepage: `public/index.html`, `site.css`, `site.mjs`.
- Existing Naza One landing content is retained at `/naza-one/` with Windows,
  Android, testing-group and source links. Its previous incorrect label pointing
  to Ride as “Naza One on the web” is corrected.
- Docs, Blog, API reference and account features link to `ride.qroadscan.com`.
  `/docs`, `/blog`, and `/app` on the main domain redirect to their app destinations.
- Route visualization is explicitly an illustrative UI preview with fictional
  locations. It makes no model calls and displays no measured risk or traffic.
- API examples are server-side account reads. No credentials are embedded or
  collected, and no inference credits are used by the website.
- Payments remain paused. No billing configuration, app Worker, database, or
  application secrets are changed by deploying this website.

## Edit and preview

From the repository root, refresh SRI after changing CSS or JavaScript:

```bash
python website/build.py
python -m http.server 8894 --directory website/public
```

`build.py` uses the Python standard library. Preview the homepage and Naza One
page at desktop and mobile widths; check menu, preview switch, API language tabs,
keyboard tab controls, code copying, and all product links. The local basic HTTP
server does not apply the production `_headers` or `_redirects` files.

## Deploy

Use the configured Cloudflare CLI authentication, never hard-coded key values:

```bash
npx wrangler deploy --config website/wrangler.jsonc
```

The assets-only configuration needs no Docker build or application bindings.
The `_headers` file supplies CSP and browser isolation. Executable assets use SRI;
there are no external fonts, analytics libraries, inline scripts, or inline styles
in the new homepage. The preserved Naza One page's styles are extracted locally.

Deployment replaces only the `qroadscan` static Worker and its existing domain.
Keep `roadscanner-ride` deployed from `cloudflare/wrangler.jsonc` independently.
For rollback, use `wrangler rollback <previous-version-id> --name qroadscan`
with the version recorded in the Cloudflare deployment history. Restore the
corresponding website Git revision before the next deployment.
