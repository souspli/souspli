# The talk — "Letters, not servers"

> Renamed 2026-09-23. The deck was designed under the working title *Folio*; the
> project is **Souspli** and a document is a **letter**. Both `source/Folio.dc.html`
> and the published file carry the new wording. `Folio` survives in the source
> filename and the design tool's ids only.

# Handoff: "Documents, Not Servers" talk deck

## Overview

Folio is a 14-slide, 8-minute conference talk arguing for peer-to-peer exchange of
immutable, signed HTML documents in place of the three-tier client/server stack.
This package contains the finished deck as a **ready-to-publish static web site**,
plus the design source and the documentation needed to rebuild or extend it.

The deck is a self-contained, keyboard-navigable web presentation: 1920×1080 slides
that auto-scale to any viewport, with a thumbnail rail, speaker notes and print-to-PDF.

## What's in this bundle

```
design_handoff_folio/
├── README.md                ← this file
├── site/
│   └── index.html           ← THE DELIVERABLE: one self-contained file, no build, no network
└── source/
    ├── Folio.dc.html        ← authoring source (design component format)
    ├── support.js           ← runtime the source needs
    ├── deck-stage.js        ← the <deck-stage> presentation shell (web component)
    ├── outline.md           ← original slide outline / intent notes
    └── _ds/organic-…/       ← the Organic design system (styles.css + bundle + guide)
```

## Where it is published

At **souspli.org/talk/**: the compiled file is `../public/talk/index.html`, copied
through as-is by the site build. It is the one page on the site that runs script
(its own, inlined), so `site/scripts/check.mjs` and `public/_headers` make an
exception for `/talk/` — and only for script and size; it still may not reach
another origin, and the two Google Fonts preconnects the bundler left in were
removed because every font is inlined.

## Publishing it as a static site

`site/index.html` is a **single file with every asset inlined** (CSS, JS, fonts,
design-system tokens). It works offline, from `file://`, and from any static host.

Minimum viable publish — copy `site/index.html` to the web root of any of:

| Host | Steps |
| --- | --- |
| GitHub Pages | Commit `index.html` to the repo root (or `/docs`), enable Pages on that branch |
| Netlify / Vercel | Drag the `site/` folder onto the dashboard, or point the project at it — no build command, publish directory `site` |
| Cloudflare Pages | Same: no build command, output directory `site` |
| S3 + CloudFront | `aws s3 sync site/ s3://<bucket>/ --cache-control "max-age=300"`, index document `index.html` |
| nginx/Apache | Drop the file in the docroot |

Nothing server-side is required. There is no routing, no API, no build step.

### Recommended additions before publishing

These are not present in the bundled file and should be added by hand or in the
publishing pipeline:

1. **Page title and social preview.** The `<title>` is `Folio`. Add Open Graph and
   Twitter meta into `<head>`:
   ```html
   <meta property="og:title" content="Folio — Documents, Not Servers">
   <meta property="og:description" content="A peer-to-peer alternative to the three-tier stack.">
   <meta property="og:image" content="https://example.com/folio-cover.png">
   <meta name="description" content="A peer-to-peer alternative to the three-tier stack.">
   ```
2. **Cover image** for the OG card — screenshot slide 01 at 1200×630.
3. **Deep-linking.** `<deck-stage>` accepts programmatic navigation via
   `document.querySelector('deck-stage').goTo(n)` (0-indexed). To make slides
   linkable (`/#7`), add a small script that calls `goTo` from `location.hash` on
   load and writes the hash back on slide change.
4. **Analytics** — if any is wanted. Note the deck's own thesis is about not leaking
   visitor data to third parties; a server-log-only or self-hosted counter is more
   consistent with the content than a third-party tag.
5. **Caching.** Serve `index.html` with a short max-age (it is the whole site);
   `Cache-Control: public, max-age=300, must-revalidate` is sensible.
6. **Fonts.** Caprasimo and Figtree are inlined in the bundle, so no Google Fonts
   request is made at runtime. Keep it that way if you re-bundle.

### Regenerating `site/index.html`

The bundled file is compiled output — **do not hand-edit it**. Edit
`source/Folio.dc.html` and re-bundle. If you are rebuilding outside this tooling,
the equivalent is: inline `styles.css`, `_ds_bundle.js`, `support.js`,
`deck-stage.js` and the two web fonts into a single HTML document.

## About the design files

The files in `source/` are **design references authored in HTML** — a working
prototype that shows the intended look and behaviour, not production code to be
copied wholesale into an application. For the static-site use case they can be
published directly (that is what `site/index.html` is). If instead you are
recreating this deck inside an existing codebase (React, Astro, MDX-based slide
tooling, etc.), treat `source/Folio.dc.html` as the spec and rebuild using that
codebase's own patterns and component library.

## Fidelity

**High-fidelity.** Colours, typography, spacing and layout are final and come from
the Organic design system tokens. Recreate pixel-for-pixel; do not re-style.

## Design tokens

All values come from `source/_ds/organic-…/styles.css`. Use the CSS variables, not
the literals.

**Colour**

| Token | Hex | Used for |
| --- | --- | --- |
| `--color-bg` | `#f5ead8` | Slide ground |
| `--color-surface` | `#ebddc5` | Cards, tier bands, cover slides |
| `--color-text` | `#201e1d` | Body and heading ink |
| `--color-accent` | `#c67139` | Bullet dots, rules, emphasis |
| `--color-accent-100/200` | `#fff2eb` / `#ffe1d0` | Third-party chips, highlighted bands |
| `--color-accent-400` | `#f6a06b` | Dashed borders, arrow glyphs, role pills |
| `--color-accent-700` | `#8c491a` | Captions, kickers, tier labels (body-size accent text) |
| `--color-accent-800/900` | `#643312` / `#402310` | Ink on accent-tinted fills |
| `--color-accent-2-800` | `#3d472b` | Divider and quote slide ground |
| `--color-accent-2-700` | `#56633f` | The decorative circle on divider slides |
| `--color-accent-2-200/300` | sage lights | Type on the sage ground |

**Type** — `--font-heading` Caprasimo 400 (display only), `--font-body` Figtree
400/500/600. The deck defines its own slide-scale ramp on `deck-stage`:

| Variable | Size | Role |
| --- | --- | --- |
| `--type-display` | 120px | Cover / close wordmark |
| `--type-title` | 64px | Slide titles |
| `--type-subtitle` | 40px | Ledes |
| `--type-body` | 34px | Cards, bullets |
| `--type-small` | 28px | Boxes, bands, captions |
| `--type-kicker` | 24px | Meta lines, pills, chips (floor — nothing smaller) |

Slide padding: `--pad-x: 132px`, `--pad-top: 96px`, `--pad-bottom: 96px`.

**Radius** — `--radius-sm 8px`, `--radius-md 16px`, `--radius-lg 28px`, `999px` for
pills and circles. **Shadow** — `--shadow-sm/md/lg` from the token sheet; the deck
uses elevation sparingly.

## Slides

1920×1080 each. `data-screen-label` on every `<section>` matches the number below;
`data-speaker-notes` carries the delivery note.

| # | Label | Purpose |
| --- | --- | --- |
| 01 | Cover | Name and claim. Centred display wordmark on `--color-surface`. |
| 02 | Anatomy of a three-tier service | The reference diagram: stacked surface bands (data / app / client) plus a dashed third-party column at right. |
| 03 | Four services, one shape | Four mini stacks (social, ride-hail, events, news) in a 2×2 grid — the parallelism is the argument. |
| 04 | One URL, many pages | Same address, same second, different artefacts served to different people. |
| 05 | What the four have in common | Three cards: custody, enforcement, opacity. |
| 06 | Divider — "A folio is a leaf of paper" | Sage ground, oversized soft circle bleeding off the lower right. |
| 07 | Anatomy of a folio | A document mock at left, four annotations at right. The whole technical proposal. |
| 08 | Five guarantees | Numbered grid; headings only, read aloud. |
| 09 | The newspaper | Flow row — the physical-edition analogy. |
| 10 | The CV and the contract | Sequence diagram: send, sign, return. |
| 11 | Commercial paper | PO → invoice → contract; schema rides inside the folio. |
| 12 | Two models side by side | The one table in the deck, using the design system's `.table`. |
| 13 | Quote | Full-bleed sage; the civic argument, slowed down. |
| 14 | Close | The ask — download the proof of concept at `github.com/gearcat0/cage`. |

## Interactions & behaviour

All of it lives in `deck-stage.js`; nothing is bespoke to this deck.

- **Navigation** — arrow keys / space / click advance; `goTo(n)` programmatically.
- **Scaling** — slides are authored at 1920×1080 and CSS-transform-scaled to fit the
  viewport, letterboxed. No responsive reflow: the aspect ratio is fixed by design.
- **Thumbnail rail** — click to jump; drag to reorder (authoring affordance, harmless
  in publication; hide it if you want a locked public view).
- **Speaker notes** — read from `data-speaker-notes`, surfaced over `postMessage`.
- **Print** — one page per slide, colour-exact (`print-color-adjust: exact`), so
  "Print → Save as PDF" in the browser produces the handout.
- **Hover/focus** — design-system defaults: accent tint on hover, 2px
  `--color-accent` `:focus-visible` ring. Do not restyle per page.
- No animation, no data fetching, no state beyond the current slide index.

## State

One value: current slide index, owned by `<deck-stage>`. If you add hash
deep-linking, that index syncs to `location.hash`. Nothing else persists.

## Assets

No images, no icon files. Every graphic in the deck is CSS — rounded bands, dashed
borders, CSS-triangle arrow glyphs, and the circle on the divider slides. Fonts are
Caprasimo and Figtree (Google Fonts, inlined into the bundle). The Organic design
system is included under `source/_ds/`.

## External reference

Slide 14 points at **souspli.org**.
