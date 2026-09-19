# The relay event

Every other transport is a *pull*: someone hands you bytes, or you fetch a locator.
A relay is the one *push* — how a letter reaches someone who never asked for it,
which is what makes a forum possible. Souspli uses [Nostr](https://github.com/nostr-protocol/nips)
relays, unmodified.

**Principle:** a relay is untrusted for content. Whatever it sends goes through
[admission](../architecture/admission.md) and nothing else decides anything. A relay
adds reach, never authority.

> Provisional. The kind number and tag names are the project's own until something
> else has to read them. They are cheap to change now and expensive later.

## Event

Kind **3400** (NIP-01 regular range: stored by relays).

```jsonc
{
  "kind": 3400,
  "pubkey": "<poster's nostr x-only key>",
  "content": "<base64 bundle>",       // "" when this event is a pointer
  "tags": [
    ["t", "thing"],                   // discovery
    ["x", "<envelope hash>"],         // the letter's identity
    ["thing-type", "comment"],        // display hint — untrusted, like every type
    ["thing-group", "<forum root>"],  // which forum, if any
    ["thing-reply", "<hash>"],        // threading, when it is a reply
    ["thing-fetch", "magnet:…"]       // only when content is a pointer
  ]
}
```

Tag names are deliberately namespaced rather than reusing `e` / `p` / `a`, which
have established meanings over *Nostr* ids. Letter hashes are a different namespace.

## Inline or pointer

- A bundle up to **32 KiB** travels whole in `content`. Comments, votes, vouches and
  most memos fit, so a forum works on relays alone with nobody seeding.
- A larger letter is posted as a **pointer**: `content` is empty, `x` names the hash
  and `thing-fetch` carries a locator. Posting one requires the letter to be seeded
  first — a locator is only honest if something is serving it.
- Sealed letters are never posted. The content would stay encrypted; the fact of it
  would not.

## Who posted is not who wrote

Every Souspli identity has a Nostr key derived from the same secret, and every
letter it signs carries that key in `Author.ek` — *inside* the signature. That
binding answers "is the poster the author?":

| event `pubkey` vs the letter's `author.ek` | Meaning |
|---|---|
| equal | The author published this themselves. |
| letter declares no `ek` | Unbound — an older letter, or a client that does not bind. |
| different | Someone is relaying somebody else's letter. Legitimate and expected. |

A reader **must never render a relayer as the author.** Authorship comes from the
letter's signature and only from it. Who handed it over is recorded separately.

## Offers: the only fetch a stranger can propose

A pointer could make your machine download something because somebody else said so.
Therefore:

- **Nothing is fetched automatically.** A pointer becomes an *offer*: a row naming
  what is claimed to exist and where it would come from. No tracker is contacted and
  no byte pulled until a person presses **Fetch**. That press is the entire security
  boundary of this path — a retry loop, a thumbnail prefetch or a "fetch all" would
  remove it.
- An offer has **no author**. The event names a Nostr key; who signed the letter is
  inside an envelope that has not arrived. The honest line is "offered by `<key>`".
- `thing-type`, `thing-group` and `thing-reply` are hints about something nobody
  here has read. They are attacker-controlled.
- **What comes back must be what was advertised.** The reader admits the fetched
  bundle, compares its envelope hash with `x`, and stores it only on a match. A
  validly signed *other* letter is still refused.
- `file:` locators in an offer are refused outright: a stranger has no business
  naming paths on your disk.
- Offers are capped (500 by default, newest kept), since a relay can advertise
  forever.

An offer can be voted on and ranked like any letter — a vote points at a hash
whether or not you hold it.

## Bounds

Relay input is as hostile as a bundle from a stranger: events are rate-limited per
relay (500 per 10 s), the inline size cap is enforced on the *encoded* length before
anything is decoded, and the ordinary bundle limits apply underneath.
