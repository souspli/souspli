# Build brief — relays (nostr)

Every transport built so far is a **pull**: you fetch a locator, or somebody
hands you a file. That means every thing that has ever reached a shell did so
because a human handed over its bytes. There is no subscription anywhere.

A relay is the first **push**. It is how a thing reaches someone who never asked
for it — which is the one capability nothing else provides, and the reason a
forum, a feed, or a public conversation is possible at all.

**Depends on:** admission (unchanged), the library, and the keyring's existing
nostr key.

**The principle is the same as transport's, and is not weakened:** *a relay is
untrusted for content; admission is the only gate.* A relay can send anything,
at any rate, forever. What it adds is REACH, never authority.

---

## 1. Why nostr, and why it cost almost nothing

Three things were already true before this brief:

- **Every account already has a nostr keypair**, derived from the same secret
  (`deriveNostrKey`, `src/shell/keyring/index.ts`). No new key management.
- **The envelope can bind the two.** `Author.e` / `Author.ek` (§5.2) carry an
  encryption scheme and public key, and they are **covered by the signature**.
- **No new dependencies.** `WebSocket` is a global in Electron's Node; schnorr
  and sha256 are already in `@noble`.

The one gap was that `BuildBundleOptions` did not expose `enc`, so the binding
was expressible in the format and unreachable from authoring. It is exposed now,
and the shell sets it on every publish.

That field is the keystone. Without it a relay event and a thing are two
unrelated signatures that happened to arrive together. With it, *"the person who
posted this is the person who signed this"* is a question with an answer.

> It is also a **disclosure**: your things declare your nostr key. That is what
> lets others verify a post is really yours, and equally lets them correlate the
> two identities. That is the intent, not a side effect, and the chrome says so.

## 2. The event

Kind **3400**, in NIP-01's regular range (1000–9999, stored by relays). Ours
until something else has to read it.

```jsonc
{
  "kind": 3400,
  "pubkey": "<author's nostr x-only key>",
  "content": "<base64 bundle>",      // "" when this event is a pointer
  "tags": [
    ["t", "thing"],                  // discovery
    ["x", "<envelope hash>"],        // the thing's identity (NIP-94 uses x for a hash)
    ["thing-type", "comment"],       // display hint, untrusted like every type
    ["thing-group", "<chain path>"], // which forum, once forums exist
    ["thing-reply", "<hash>"],       // threading, when it is a reply
    ["thing-fetch", "magnet:…"]      // only when content is a pointer
  ]
}
```

Tag names are **deliberately namespaced** rather than reusing `e` / `p` / `a`.
Those have established NIP meanings over *nostr* ids; our hashes are a different
namespace, and colliding quietly would be worse than being verbose.

**Inline when small, a pointer when large.** A comment or a vote is a few KB and
travels whole, so a forum works on relays alone with no seeder — which is the
entire reason this beats magnets for small things. Past `MAX_INLINE_BUNDLE`
(32 KiB of bundle, ~43 KiB base64) the event carries the hash and a locator
instead, so an article with video does not flood a relay. Posting a thing too
large to inline requires it to be seeded first: a locator is only honest if
something is actually serving it.

## 3. Receiving, and the distinction that matters

Bytes off a relay go through `admitBundle` and nothing else decides anything.
Then one further check, which is what the `ek` work is for:

| event `pubkey` vs the thing's `author.ek` | what it means |
|---|---|
| equal | the author published this themselves |
| the thing declares no `ek` | unbound — an older thing, or a shell that does not bind |
| different | **someone is relaying somebody else's thing** |

The third row is legitimate and expected — anyone may rebroadcast — but **the
shell must never render a relayer as the author.** Authorship comes from the
signature and only from the signature. Who handed it to you is recorded
separately, in `relay_arrivals`, and shown separately.

Bounded like any hostile input: `MAX_EVENTS_PER_WINDOW` per relay per interval,
the inline size cap enforced on the *encoded* length before anything is decoded,
and the existing bundle caps underneath. Admission already rejects junk; these
bound what it costs to *offer* junk.

## 4. Exposure, stated before it happens

**Nothing reaches a relay by default.** The relay list starts empty, and posting
is a separate explicit act (Share → Post to relays). A memo to your boss never
touches a relay. A sealed thing is refused outright: it would stay encrypted, but
the fact of it would not.

Two disclosures, in the register seeding and fetching already use:

- **posting** tells the relay and its readers that this key published this
  thing, and tells the relay your address;
- **subscribing** tells the relay what you are interested in — which none of the
  other transports leak, and which is worth saying plainly rather than burying.

## 5. What is here

- `src/format/bundle.ts` — `enc` on `BuildBundleOptions`
- `src/shell/nostr/event.ts` — build / parse / verify a kind-3400 event
- `src/shell/nostr/index.ts` — `NostrService`: one long-lived socket per relay,
  subscriptions on top, reconnect, rate window
- `src/shell/main.ts` — binds `ek` at every signing site, ingests arrivals,
  posts on request
- `src/shell/library/index.ts` — `relays`, `relay_cursor`, `relay_arrivals`
- `src/shell/chrome/` — the Relays window, Post to relays, the disclosures
- `test/shell/relay-server.ts` — a relay in the test process (RFC 6455 framing
  and a handful of message types), so nothing here needs the public network
- `test/shell/nostr.spec.ts` — the round trip, the attribution rule, hostile
  input, and that nothing is posted unasked
- `pnpm world relay` — the same thing between two real instances

## 6. Known risks

The tag vocabulary and the kind number are **guesses** until something else has
to read them. They are cheap to change now and expensive later.

Relays are a new outbound exposure and a new inbound firehose. The exposure is
handled by making publication explicit; the firehose by treating a relay exactly
as hostile as a bundle from a stranger, which admission already assumes.

Pointer events (`thing-fetch`) are announced but not yet followed: a thing too
large to inline arrives as a hash the shell does not go and fetch. That is the
next piece of work here.
