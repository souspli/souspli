# The sealed container

In the code: *the cage* (`src/main/cage.ts`, `src/main/protocol.ts`, `src/preload/`).

The container runs arbitrary untrusted HTML, CSS and JavaScript with **no network
access and no ambient authority**. "No network" is enforced at four independent
layers, so that any single layer failing is not a breach. Each is tagged `Layer N`
in `src/main/cage.ts`.

## Layer 1 — process configuration

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
`webSecurity: true`, `experimentalFeatures: false`, and a **fresh, non-persistent
session partition per letter** (`thing-<id>`, no `persist:` prefix, so in memory
only). No letter can read another's storage, and nothing a letter stores survives it
being closed.

The OS-level Chromium sandbox is a backstop against a renderer *memory-corruption*
exploit. It is always configured; whether the host can initialise it is a separate
question the test banner reports honestly — see [security](security.md).

## Layer 2 — request interception

Every request whose scheme is not `thing:` is cancelled. All permission requests
*and* permission checks are denied. `window.open` is denied. `will-navigate` and
`will-redirect` are prevented, so a letter cannot leave its own page.

## Layer 3 — egress that bypasses request interception

A dead proxy (`127.0.0.1:1`) swallows any HTTP(S) or SOCKS traffic that escapes
Layer 2. WebRTC — which `webRequest` cannot see at all — is closed with
`setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` plus a process-wide
command-line policy.

## Layer 4 — Content-Security-Policy

Injected on every `thing:` response by the session *and* stamped on the bytes by the
protocol handler:

```
default-src 'none'; script-src 'unsafe-inline' thing:; style-src 'unsafe-inline' thing:;
img-src thing: data: blob:; media-src thing: blob:; font-src thing: data:;
connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'
```

`connect-src 'none'` kills `fetch`, XHR, WebSocket and EventSource at the CSP layer;
Layer 2 kills them again at the network layer. Both, on purpose.

This policy is also what shapes what a type can do: images, audio, video and fonts
from its own attachments work; frames, forms, plugins and embedded documents do not —
which is why an enclosed PDF can travel in a letter but cannot be displayed by it.

## How a letter is served

A letter is loaded as `thing://<random-id>/index.html`, handled by
`protocol.handle()` on the container's own session.

- The **program** is served only from an in-memory map populated before load.
- **Attachments** are served at `thing://<id>/att/<name>` by resolving an *admitted
  name* to a hash and streaming that hash from the client's blob store — with the
  manifest's MIME type, `X-Content-Type-Options: nosniff`, and single-range `Range`
  support so media can seek.
- An unknown name is a 404. The handler never touches the filesystem based on
  anything a letter supplied, and never touches the network.

The security gate is the admitted attachment table plus the handler — not the
bridge. A program can construct an `att/` URL by hand; it still only resolves names
that were in the signed manifest. Integrity was checked once, at admission, not per
request: re-hashing a 200 MB video on every range request buys nothing when the
store is unreachable to the letter.

## The header a letter cannot paint on

The trusted header is a **separate native view**, composited in its own region of
the window. The letter renders into a different view entirely, so it cannot paint
over, resize away or overlay the header — a spatial guarantee rather than a
z-index.

This is tested two ways: a geometry assertion in the escape battery, and at the
pixel level in `test/shell/chrome.spec.ts` — a letter that floods its viewport and
draws a fake "✓ signed" badge leaves the real badge intact and its own colour
entirely absent from a capture of the header.

## What a letter is told about you

`viewerInfo()` returns a locale and a colour-scheme preference. No time zone, no
screen dimensions, no identifier — nothing that fingerprints. When in doubt a field
is left out.
