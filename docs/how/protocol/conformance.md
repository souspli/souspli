# Conformance

Souspli is meant to be a protocol, not an app. The test of that is whether someone
can write a second implementation and **prove it agrees with the first** — so that a
letter signed, sealed or rejected by one is signed, sealed or rejected identically by
the other.

Conformance has two halves.

## The format half: portable vectors

`src/conformance/vectors/*.json` — 41 deterministic vectors in seven files. Each is
candidate bytes plus the expected outcome, as plain JSON, so an implementation in
any language can run them.

| File | Vectors | Covers |
|---|---|---|
| `canonical.json` | 13 | Canonical CBOR: key ordering (including the RFC 7049 vs 8949 trap), shortest-form integers, NFC, rejected floats / tags / indefinite lengths / duplicate keys |
| `hashing.json` | 4 | SHA-256 over exact bytes |
| `envelopes.json` | 4 | Signature verification per scheme; flipped bits; unknown scheme → `unverifiable` |
| `bundles.json` | 8 | The admission algorithm: manifest, program and attachment hash mismatches, tampered `type` |
| `chain.json` | 3 | A valid `seq`/`prev` chain, a fork, a gap |
| `sealed.json` | 1 | A bundle sealed to three keys, with a vector per recipient and a `not-for-me` case |
| `limits.json` | 8 | One per decode limit, each expected to fail cleanly |

Rules a second implementation will trip on first:

- **Reject non-canonical input; never normalise it.** A decoder that quietly
  re-encodes produces a different hash, and the failure presents as a mysterious
  invalid signature.
- **Verify the bytes that arrived.** Never decode, re-encode, then verify: that
  turns an encoder bug into a signature forgery.
- `invalid`, `unverifiable` and `not-for-me` are three distinct outcomes.

Everything except the sealed set regenerates byte-identically (`pnpm gen:vectors`:
fixed test keys, RFC 6979 ECDSA, zero-aux BIP-340), so any diff is a real behavioural
change. The sealed set uses fresh randomness, as real sealing must, so it is
generated once and frozen. The reference implementation is held to the same vectors,
one test each.

How to drive them, the target interface, and the JSON shapes:
[`src/conformance/README.md`](../../../src/conformance/README.md).

## The container half: a live battery

Whether untrusted code can break out of a renderer cannot be written down as data;
it needs a running browser. A second *client* has to survive:

- **the escape battery** — `test/cage.spec.ts` driving the pages in `test/things/`
  (one per attack, plus positive controls), each of which is handed the address of a listener and tries to
  reach it. The proof is the listener's silence, observed from outside the renderer;
- **the client obligations** — `test/shell/*.spec.ts`: the four admission outcomes,
  a letter unable to forge or overpaint the trusted header (checked at pixel level),
  the private key never on disk in the clear, sealed plaintext never on disk,
  received-at ordering, fork detection, and a name shown as verified only when it
  provably maps to the signing key.

See [the security page](../architecture/security.md) for what the battery does and
does not demonstrate.
