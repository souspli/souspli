# site/ — souspli.org

A static site built from [`../docs`](../docs). The markdown there is the single
source: it reads cleanly on GitHub and becomes the website unchanged. This directory
adds only a layout, a landing page, and a build gate.

```bash
cd site
npm ci
npm run dev      # http://localhost:8080, rebuilds on change
npm run build    # → _dist/, then scripts/check.mjs
```

It is a **standalone package**, deliberately outside the repo's pnpm workspace, so
the host never has to install Electron or compile SQLite to publish a web page.

## What the build gate enforces

`scripts/check.mjs` fails the build if any page:

- contains a `<script>` tag or an inline event handler — the site runs no JavaScript;
- loads anything from another origin (images, styles, fonts, frames);
- has a dead internal link, or a relative `.md` link that was not rewritten;
- exceeds **14 KB gzipped**, so that it arrives in the first round trip.
  (`/how/protocol/spec/` is the one allow-listed exception.)

The footer's claim — no third-party requests, no cookies, no JavaScript — is
therefore checked on every build rather than merely asserted. `public/_headers` adds
a `Content-Security-Policy` of `default-src 'none'` so a browser would refuse them
anyway.

## And what visitors actually receive

The build gate proves what is *published*. A CDN can still rewrite HTML at the edge —
and Cloudflare did: zone-level Web Analytics injected a beacon `<script>` into every
page of souspli.org while the same deployment on `pages.dev` stayed clean. The CSP
blocked it, but the markup was there.

```bash
npm run check:live      # SITE_URL=https://… to point it elsewhere
```

fetches every page **with a browser's navigation headers** (edge injection ignores a
bare `curl`) and fails on a served `<script>`, a cookie, a missing CSP, or an
over-budget page. `.github/workflows/site-live.yml` runs it daily and after each
deploy, because a dashboard toggle can change the answer with no commit.

Cloudflare settings that must stay **off** for the zone: Web Analytics / RUM
(automatic setup), Rocket Loader, Email Address Obfuscation, Automatic HTTPS
Rewrites. Network Error Logging only reports load *failures*, but it reports them to
a third party; the check warns about it.

## How pages are made

- Every `docs/**/*.md` becomes a page; `foo/index.md` → `/foo/`, `foo/bar.md` →
  `/foo/bar/`. `docs/index.md` is `/docs/`; `/` is the landing page
  (`pages/index.njk`).
- Docs carry no front matter. The title is the first `# heading`.
- Relative links to other docs are rewritten to site URLs; links that leave `docs/`
  (source files, READMEs) point at the repository on GitHub.
- One layout, one inline stylesheet (`_includes/base.njk`), system fonts, light and
  dark from `prefers-color-scheme`. The favicon is a `data:` URI, so a page view is
  exactly one request.

## Deploying (Cloudflare Pages)

| Setting | Value |
|---|---|
| Repository | `souspli/souspli` |
| Root directory | `site` |
| Build command | `npm ci && npm run build` |
| Build output directory | `_dist` |
| Environment | `NODE_VERSION=22` |
| Custom domain | `souspli.org` |

Pull requests get preview deployments automatically. Nothing else is needed: no
Functions, no KV, no analytics.
