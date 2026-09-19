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

- contains a `<script>` tag or an inline event handler — nothing we build ships JavaScript;
- loads anything from another origin (images, styles, fonts, frames);
- has a dead internal link, or a relative `.md` link that was not rewritten;
- exceeds **14 KB gzipped**, so that it arrives in the first round trip.
  (`/how/protocol/spec/` is the one allow-listed exception.)

`public/_headers` adds a `Content-Security-Policy` of `default-src 'none'`.

## And what visitors actually receive

The build gate proves what is *published*; a CDN can still rewrite HTML afterwards.

```bash
npm run check:live      # SITE_URL=https://… to point it elsewhere
```

fetches every deployed page with a browser's navigation headers and fails on an
unexpected `<script>`, a cookie, a missing CSP, an edge rewrite, or an over-budget
page. `.github/workflows/site-live.yml` runs it daily and after each deploy.

Cloudflare's Web Analytics beacon is **expected** — it is enabled on the Pages
project — and the check allows exactly that one script. Note that the CSP in
`public/_headers` currently refuses to load it, so it collects nothing; if the
numbers are ever wanted, add `script-src https://static.cloudflareinsights.com;
connect-src https://cloudflareinsights.com` there.

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

## The screenshot

`public/img/app.jpg` is the real app, captured headlessly on a populated library by
[`tools/screenshot/capture.mjs`](../tools/screenshot/capture.mjs) (the window is two
native views, so it composites them at their real bounds). Regenerate it after a
visible UI change:

```bash
pnpm world provision && pnpm world seed && pnpm build
xvfb-run -a -s "-screen 0 1920x1200x24" node tools/screenshot/capture.mjs
```

It is the one image on the site: lazy-loaded, sized in the markup so nothing shifts,
and below the first screen so the page still paints from its first round trip.

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
