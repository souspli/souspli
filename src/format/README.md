# src/format — the letter format (reference implementation)

The implementation of [the format specification](../../docs/how/protocol/spec.md).
On the wire, and throughout this code, a Souspli *letter* is called a **thing** and a
*type* a **program** ([glossary](../../docs/glossary.md)).

It lives inside this repo so the whole system builds and tests together; it is
written to be extracted into its own package (`@souspli/format`) with a `git mv` —
nothing here imports from the shell or the cage. When the implementation surfaces a
discrepancy in the spec, fix the spec in the same pull request.

## Modules

| Module | Responsibility |
|---|---|
| `cbor.ts` | Strict **canonical** CBOR (§2.2): reject-not-normalize. |
| `limits.ts` / `hash.ts` | §2.3 decode limits + 512 slot cap; SHA-256 helpers. |
| `manifest.ts` / `envelope.ts` | Decode/encode (§4, §5); domain-separated `signing_input`; the `Signer` interface. |
| `schemes.ts` / `verify.ts` | Verifier registry; real `eth-eip191` + `nostr-schnorr`; `ssh-ed25519` a documented slot → `unverifiable`. |
| `nip44.ts` / `sealed.ts` | NIP-44 v2 wraps; `seal`/`unseal` (§7) with an injected `Unsealer` (format never holds key bytes). |
| `bundle.ts` | Read: tar parse (tar-bomb caps) + `admitBundle` (§8.1), four distinct outcomes, hashes over **received** bytes. Write (§9, the mirror): `packBundle` (tar writer) + `buildBundle` (build + sign via the injected `Signer`) — output re-admits `valid`. Public bundles; sealed authoring later. |

Crypto: `@noble/*`. Canonical CBOR is hand-written (off-the-shelf CBOR libs use
RFC 7049 length-first key ordering, not RFC 8949 §4.2.1 bytewise — §2.2 warns
about this). Tests: `test/format/`.

## Known deviations from the spec (to reconcile)

Also tracked in the spec's own *Pending amendments* section.

- **`ssh-ed25519`** verification is unimplemented (the scheme is a documented
  registry slot → `unverifiable`).

Sealed content decryption (§7.1) is now implemented: `admitBundle` recovers the
content key CK, decrypts `manifest.enc` / `program.enc` / ciphertext blobs, and
verifies each against its plaintext hash.
