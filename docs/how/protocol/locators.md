# Locators and transports

A **locator** is a scheme-tagged string saying where to get a bundle. Transports are
pluggable and share one rule:

> **The transport is untrusted for content. Admission is the only gate.**

A transport hands over raw bytes. It cannot make a reader admit anything: every
signature and hash is re-verified over the received bytes. A malicious peer or a
corrupted download yields a rejected bundle, never a compromise. What a transport
*can* do is waste resources, so every fetch is bounded.

| Locator | Transport | Integrity before admission | Network |
|---|---|---|---|
| *(pasted text)* | base64 bundle | — | none |
| `file:<absolute path>` | local read; also drag-and-drop and double-click | — | none |
| `bundle:<sha256-hex>` | content-addressed: the bundle whose tar bytes hash to this | `sha256(bytes)` must equal the name | none (served from the local seed store) |
| `magnet:?xt=urn:btih:…` | BitTorrent (webtorrent) | the torrent's own infohash | DHT, trackers, peers |
| `https://…` | HTTP GET | — | that host. **Provisional; expected to be removed.** |
| a name (`alice.eth`) | resolved to one of the above | see *Names* | the resolver |

## Bounds

- **Size:** 256 MiB per bundle, enforced *while streaming* — never trust a declared
  length. An oversize torrent is refused when its metadata names the size, not after
  downloading it.
- **Time:** ordinary fetches time out and are aborted, not merely abandoned.
- **Redirects (HTTP):** followed manually, at most 5, re-checked on each hop so a
  `Location` header cannot bounce the fetch into `file:`. No cookies or credentials
  are sent; the response's `Content-Type` is ignored.

## Magnets are transfers, not fetches

`fetch()` returns bytes, which cannot express progress, cancellation, or work that
outlives the request. A magnet therefore starts a **transfer**: it runs in the
background, several at once, survives a restart, has no overall timeout, and reports
what it is waiting for — distinguishing a swarm with nobody in it from one whose
peers will not accept a connection.

**Seeding** is opt-in per letter and remembered across restarts. An admitted bundle
is kept byte-for-byte in a seed store so it can be re-served; a sealed letter is
re-served as the ciphertext it arrived as.

## Names

A name does two jobs: *identity* (which key is this?) and *discovery* (where is
their latest letter?). The rule mirrors transport's:

> **The resolver is untrusted for the key. The signature is.**

A name is shown as **verified** only when the resolver's answer provably equals the
author key that admission already proved from the signature. A wrong or hostile
resolver can fail to resolve, or point elsewhere — it can never attach a name to a
letter signed by a different key.

- **ENS** matches the `eth-eip191` scheme: a name resolves to the 20-byte address
  that *is* `author.k`. Reverse records are accepted only when the forward lookup
  confirms them. Discovery reads a text record, `thing`, holding a locator.
- Outcomes are `verified`, `mismatch` (styled as a warning) or `unresolvable`.
- **Petnames** are the third kind of name: local, private, and never verified
  because there is nothing to verify — it is your label.

*Current builds:* ENS resolution is implemented and tested against a mock, but the
Ethereum client library is not shipped and no RPC endpoint is configurable, so every
name is `unresolvable`. Nostr-based naming (`npub…`, NIP-05) is a stub.
