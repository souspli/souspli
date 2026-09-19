# How is this different from…?

Short answers for people who already know the landscape. None of these systems is
bad; most solve a different problem. Souspli borrows from several of them and says
so.

The one-line version: **other systems move messages between servers or peers and
leave rendering to an app. Souspli moves a complete, signed, self-rendering document
and makes the app incapable of leaking.** The unit is the document, not the feed.

## Email with PGP, or a signed PDF

The closest relatives, and the honest comparison.

- A signed PDF is attributable and self-contained. It is not *interactive* without
  JavaScript that readers rightly disable, it cannot be replied to in a structured
  way, and its viewer is free to fetch remote content.
- HTML email is interactive-ish, and that is exactly the problem: remote images and
  tracking pixels are how a newsletter learns that you opened it, when, and where.
  Mail clients fight this with heuristics.
- PGP signs a message body. It does not bind the *program that renders it* to the
  content, so two clients may show two people different things from the same signed
  bytes.

Souspli's signature covers the rendering program, the arguments and every
attachment as one unit, and the container the letter runs in has
[no network at four independent layers](../how/architecture/container.md). Tracking
is not discouraged; it is not possible.

## Nostr

Souspli *uses* Nostr relays as one of its transports, and every Souspli identity
already has a Nostr key. The differences:

- A Nostr event is a small JSON note that each client renders as it sees fit. A
  letter carries its own presentation and behaviour, identical for every reader.
- Nostr content generally lives on relays and is fetched on demand, and clients load
  remote media by URL. A letter is complete when it arrives; nothing is fetched to
  show it.
- In Souspli a relay is *reach, never authority*: whatever a relay sends passes the
  same admission gate as a file from a stranger, and authorship comes only from the
  signature inside the letter, never from who posted it.

See [the relay event](../how/protocol/relay-event.md).

## Mastodon / ActivityPub, Bluesky / AT Protocol

These decentralise *who runs the server*. There is still a server: your account
lives on an instance or a PDS, its operator holds the system of record, sets the
visibility rules, and can see your activity. Moving is possible; custody is still
someone else's.

Souspli has no accounts and no home server. Your identity is a key on your machine,
your data is the letters in your library, and a forum is a set of letters that
reference each other — not a place anyone hosts.

## IPFS, BitTorrent, Hypercore

Content-addressed *transport and storage*. Souspli agrees with all of it — letters
are content-addressed, and BitTorrent is one of the ways they travel. What those
systems do not define is what the content *is*, who signed it, or how to open
untrusted interactive content without it reporting on you. A web page on IPFS is
still a web page: it can load anything from anywhere once it runs.

## Secure Scuttlebutt

The nearest in spirit: offline-first, identity is a key, social trust instead of
global reputation. SSB replicates append-only *feeds* — to follow someone is to
replicate their log, and applications interpret messages from it. Souspli's unit is
the single document, which can be handed over by any channel — a file, a paste, a
QR code, a relay, a torrent — without subscribing to anybody's history. Souspli's
[vouches and depth-2 "tribe"](../use/people.md) owe a clear debt to SSB's hops.

## Signal, Matrix

Private *messaging*. Excellent at confidential conversation between known parties,
and not trying to be anything else. A Signal message is not a durable, portable,
independently verifiable artefact you can hand to a third party as evidence of what
was said; that is a feature for messaging and the opposite of what a contract, an
invoice or a published article needs.

## "Isn't this just a browser with the network turned off?"

Partly — deliberately. The rendering engine is Chromium, because HTML/CSS/JS is the
most widely understood document technology there is. What is added:

- a **format** that binds program + content + attachments under one signature;
- an **admission gate** that verifies all of it before a byte is rendered;
- a **container** that removes the network, storage, navigation and every ambient
  capability, proven by [an escape-attempt suite](../how/architecture/security.md);
- **trusted chrome** the document cannot draw over, where author, signature status
  and every confirmation live;
- a **library** that indexes what you hold and the relations between letters.

## What Souspli is *not* good at

- **Real-time anything.** There is no presence, typing indicator or live cursor.
- **Huge public feeds.** Discovery is deliberately social and local; there is no
  global index and no algorithmic timeline.
- **Revocation.** A signed letter cannot be unsaid. A seal is confidentiality
  against non-recipients, not access control: any recipient can forward it.
- **Being finished.** It is an alpha. [What is missing today](../use/status.md) is
  listed plainly.
