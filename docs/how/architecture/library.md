# Keys, library and storage

Everything the client keeps lives under one per-user directory
([paths](../../use/install.md)). `SHELL_USER_DATA_DIR` overrides it, which is how
tests and the [multi-account world](../develop/world.md) get hermetic profiles.

```
<userData>/
  identity.key.enc        the encrypted identity (never the plaintext key)
  library/
    index.sqlite          one row per admitted envelope + relation tables
    blobs/<sha256-hex>    content-addressed store: programs and attachments
  seeds/blobs/<tar-sha256>  admitted bundles, byte for byte, re-servable
  downloads/<infohash>/   partial BitTorrent transfers
```

## Keyring — `src/shell/keyring/`

The **only** code that touches private key bytes. Everything else receives a
`Signer` and an `Unsealer` interface; the format library and the container never
see key material, so a bug in either can at worst produce a wrong verification
result, not an exfiltrated key.

- **One secret, two keys.** A secp256k1 key gives the Ethereum-style address letters
  are signed with (`eth-eip191`). A Nostr x-only key is derived deterministically
  from a signature over a fixed message; it signs relay events, unseals sealed
  letters, and is declared in every envelope as `Author.ek`.
- **At rest:** Electron `safeStorage` (OS keychain) where available; otherwise a
  static-key XChaCha wrapper that keeps the key out of plain sight and is honestly
  labelled as *software keys* in the interface. The plaintext key is never written
  to disk in either mode.
- **HD import:** BIP-39 phrases, MetaMask's path (`m/44'/60'/0'/0/i`). Only the
  chosen key is persisted; the phrase never is.
- Hardware signers and OS-backed signing are not implemented.

## Library — `src/shell/library/`

A SQLite index (`better-sqlite3`) over a content-addressed blob store.

- **One row per admitted envelope.** A co-signed document is several rows sharing a
  manifest hash; the feed shows it once.
- **The reader owns ordering.** Rows are ordered by locally recorded *received-at*.
  The author's `created` is a claim and is never used to position anything.
- **Fork detection:** two envelopes with the same `(author key, path, seq)` and
  different hashes are flagged, not silently resolved.
- **Relation tables** are derived from `args` at store time
  ([relations](../protocol/relations.md)): `refs` (`replyTo`, `attests`, `votesOn`,
  `inGroup`), `votes`, `vouches`, group members, document signers — plus local-only
  tables for petnames, relays, relay arrivals, offers, transfers, seeding intent and
  drafts. When a new relation is added, a one-time backfill re-reads letters already
  held.
- **Tribe** is computed by a bounded frontier walk over `vouches` from your own key,
  depth 2, with a visited set. Thread walks are bounded the same way. Both are
  ordinary loops that obviously terminate rather than recursive SQL, because cycles
  in claims are normal.
- **Garbage collection** counts references from both letters *and* drafts; a blob is
  released only when the last holder is gone.

## Sealed letters never touch disk in the clear

A sealed letter's decrypted program, manifest and attachments live in an
**in-memory store** scoped to the session, never in `blobs/`. Its *encrypted* bundle
is what sits in `seeds/` and what Export writes. After a restart a sealed letter is
unmountable until it is re-ingested. This is pinned by a test
(`test/shell/library.spec.ts`) and proposed as a MUST for the
[specification](../protocol/spec.md).

## Export is a copy, never a rebuild

Saving a letter to a file copies the admitted bundle byte for byte from `seeds/`.
Rebuilding it would sign with the local key and therefore *re-author* it: someone
else's letter would leave under your signature, and your own would arrive under a
new hash.

## Native module note

`better-sqlite3` is compiled against Electron's ABI, not Node's
(`pnpm rebuild:native`, run by `postinstall`). For that reason the library is tested
through Electron rather than under Vitest.
