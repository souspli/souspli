# The letter format — v1 draft

> **Naming.** This is the wire format of [Souspli](../../index.md). The
> specification predates the project's name and calls a letter a **thing** and a
> type a **program**; those words are kept here because they appear on the wire
> (`.thing`, `thing://`, `thing-envelope-v1:`). See the [glossary](../../glossary.md).
> This document is the single source of the specification; it previously lived in
> the separate `gearcat0/format` repository.


**Status:** draft for discussion. Nothing here is stable. This document defines
the on-the-wire data format only: what a thing *is*, how it is hashed, how it is
signed, and how it is encrypted. It defines no transport, no naming resolution,
and no UI.

**Package:** `@souspli/format`. Pure TypeScript, no UI, no Electron, no
network. Runs in Node and in browsers. This is the package that makes the
project a protocol rather than an app: anyone writing a thing, a bot, an
indexer, a CLI, or a rival shell needs exactly this and nothing else.

Normative keywords (MUST, MUST NOT, SHOULD, MAY) are used in the RFC 2119 sense.

---

## 1. Design rules

These are the invariants everything below serves. If a proposed change violates
one of these, the change is wrong.

1. **Self-containment.** A thing plus its args is complete. Rendering MUST NOT
   require fetching anything. Every byte a thing displays — text, image, video —
   is either in the program or in an attachment that travelled with it.
2. **Content addressing.** Every artifact is identified by the SHA-256 of its
   exact bytes. Identity is not a name, a URL, or a database row.
3. **Verify received bytes, never re-encoded bytes.** Implementations MUST hash
   and verify signatures over the bytes as received. Re-serializing to verify is
   forbidden: it turns an encoder bug into a signature forgery.
4. **The reader owns ordering.** No field in this format establishes a thing's
   position in a feed. `created` is author-controlled and therefore a claim, not
   a fact. Shells order by locally-recorded receipt time.
5. **Authority lives outside the cage.** Nothing in this format is interpreted by
   the untrusted program. Signature verification, decryption, and hash checking
   happen in the shell, before any byte reaches a renderer.

---

## 2. Primitives

### 2.1 Hashes

All hashes are SHA-256 over exact bytes: 32 octets.

- In CBOR: a byte string of length 32. No multihash prefix, no tag.
- In text (URLs, logs, UI): lowercase hex, prefixed — `sha256:6b86b273ff34fce…`.

Implementations MUST reject a byte string of any other length where a hash is
expected.

### 2.2 Canonical CBOR

All hashed or signed structures are encoded in **canonical CBOR**, defined as
RFC 8949 §4.2.1 *core deterministic encoding*, with additional restrictions.

Required:

- Integers encoded in the shortest form that fits.
- Definite-length encoding only. Indefinite-length strings, arrays, and maps are
  forbidden.
- Map keys sorted by **bytewise lexicographic order of their encoded form**.
  (Note: this is RFC 8949's rule, *not* RFC 7049's length-first rule. Several
  older libraries implement the latter. Verify your library before trusting it.)
- No duplicate map keys.

Additionally forbidden in this format:

- **Floating point of any kind.** There is no value in this format that needs
  one, and float canonicalization (NaN payloads, ±0, shortest-form selection) is
  a reliable source of interop bugs. Timestamps are integers; sizes are integers.
- **Tags.** No CBOR tag is defined in v1. Decoders MUST reject any tag.
- **`undefined`.** Absent fields are absent. `null` is permitted only where this
  spec explicitly says so.
- Non-NFC text. All text strings MUST be Unicode NFC-normalized before encoding.
  Decoders MUST reject text that is not NFC. (Without this, two visually
  identical manifests hash differently, and users cannot tell why a signature
  broke.)

**Decoders MUST reject non-canonical input rather than normalizing it.** A
decoder that silently accepts non-canonical bytes and re-encodes them will
produce a different hash than the sender, and the failure will present as a
mysterious invalid signature. Fail loudly at the boundary.

### 2.3 Decoding limits

CBOR decoders are a classic denial-of-service surface, and this decoder runs in
the shell — the trusted side. Implementations MUST enforce, and MUST make
configurable:

| Limit | Default |
|---|---|
| Max manifest size | 1 MiB |
| Max envelope size | 64 KiB |
| Max nesting depth | 16 |
| Max attachment count | 256 |
| Max map/array entries | 4096 |
| Max text/byte string length | 1 MiB |

Exceeding any limit is a decode error, not a truncation.

---

## 3. Blob

A blob is raw bytes with no structure: the program, an attachment, a video.
Identified by `sha256(bytes)`. That is the whole definition. Blobs are never
parsed by this package.

---

## 4. Manifest

The manifest is the **args**: it says which program these args are for, what the
args are, and what attachments came with them. It is canonical CBOR. Its
identity is `sha256(canonical_bytes)`.

```
Manifest = {
  1: uint,          # v      — format version, MUST be 1
  2: bytes(32),     # prog   — sha256 of the program blob
  3: tstr,          # type   — display hint (see below)
  4: any,           # args   — program-defined; opaque to this package
  5: { tstr => Att } # att   — attachment table, MAY be absent if empty
}

Att = {
  1: bytes(32),     # h      — sha256 of the attachment blob
  2: tstr,          # m      — MIME type
  3: uint           # n      — size in bytes
}
```

Integer keys keep manifests small; the field names above are for humans and for
the TypeScript API.

**`prog` is the trust anchor for behaviour.** The manifest names its program by
hash, so given args you can tell exactly which program is meant to render them —
and no other program can claim them.

**`type` is a display hint and MUST NOT be trusted.** A manifest can claim
`type: "event"` while pointing `prog` at anything. Shells MUST derive the label
they show the user from `prog` — by resolving the program hash against a local
registry of known programs — and MAY use `type` only as a fallback label for
unknown programs, displayed as unverified. Filtering a feed by `type` is
acceptable; drawing a trust conclusion from it is not.

**`args` is opaque here.** This package does not know what an event is. Programs
define their own arg shapes; validating them is the program's job (and the
shell's, if it wants to be strict about known programs).

**Attachments are keyed by name.** Args reference attachments by their table key
(`{poster: "poster.webp"}`), and the manifest binds name → hash. This gives the
bridge its rule: `getBlob(name)` serves an attachment **if and only if** that
name is in this table and the bytes on hand hash to `h`. The shell never fetches.

`m` and `n` are conveniences (MIME for rendering, size for progress). Neither is
authoritative: implementations MUST verify `h` against the actual bytes and MUST
NOT trust `m` in a way that enables sniffing attacks — serve attachments with
`X-Content-Type-Options: nosniff` semantics.

---

## 5. Envelope

The envelope binds a manifest to an author, a time, and optionally a position in
that author's history. It is canonical CBOR. Its identity is
`sha256(canonical_bytes)`.

```
Envelope = {
  1: uint,          # v      — MUST be 1
  2: Author,        # author
  3: bytes(32),     # man    — sha256 of the manifest's canonical bytes
  4: uint,          # created — unix seconds, author claim (see §1 rule 4)
  5: tstr,          # path   — OPTIONAL, e.g. "event/bbq-july-16"
  6: uint,          # seq    — OPTIONAL, 1-based, requires path
  7: bytes(32),     # prev   — OPTIONAL, sha256 of the previous envelope
  8: Sig            # sig
}

Author = {
  1: tstr,          # s      — signing scheme id (§6)
  2: bytes,         # k      — signing public key / identifier, scheme-defined
  3: tstr,          # e      — OPTIONAL, encryption scheme id
  4: bytes          # ek     — OPTIONAL, encryption public key, requires e
}

Sig = {
  1: bytes          # raw signature bytes, scheme-defined
}
```

### 5.1 What the signature covers

The signature covers a hash of the envelope **minus the signature itself**:

```
sig_payload   = canonical_cbor(Envelope without key 8)
sig_digest    = sha256(sig_payload)
signing_input = "thing-envelope-v1:" || base64url_nopad(sig_digest)
```

Because `man` is the manifest hash, and the manifest hash covers `prog`, `type`,
`args`, and every attachment's `h`, the signature transitively covers **the
program, the arguments, and every byte of every attachment**. Nobody can swap
your video, retype your args, or reinterpret your event as another type without
invalidating the signature. This is the reason the manifest is hashed as a unit
rather than the envelope listing its parts.

`Author.ek` being inside `sig_payload` matters: it makes the envelope a
**self-certified key binding**. Alice's signature attests "this encryption key is
mine," which is how anyone learns a key to encrypt to her without a directory.

### 5.2 Domain separation

`signing_input` is prefixed with `thing-envelope-v1:` so that a signature
produced for this protocol cannot be replayed as a signature for anything else
that signs opaque digests with the same key. Every scheme in §6 MUST bind the
domain string, either by signing it directly or via a scheme-native namespace
field.

### 5.3 Chaining

`path` + `seq` + `prev` make an author's publication history tamper-evident.
Rules:

- `seq` and `prev` MUST NOT appear without `path`.
- The first envelope for a path has `seq: 1` and no `prev`.
- Every subsequent envelope for that path has `seq: n+1` and
  `prev: sha256(envelope_n)`.
- A verifier holding envelope *n* can detect a withheld or forked history: two
  envelopes with the same `(author.k, path, seq)` and different hashes are a
  **fork**, and are proof of author misbehaviour or key compromise. Shells MUST
  surface a detected fork rather than silently picking one.

This gives you "a relay can delay me but cannot silently lie to me" without any
chain. It is deliberately in the substrate now because retrofitting it later
means a format break.

**Not yet specified:** how a reader finds envelope *n+1*. That is naming and
discovery, and it is out of scope here. This section only defines the chain's
shape so that layer has something to point at.

---

## 6. Signature scheme registry

A scheme is `(id, key encoding, verify function)`. The registry is a map from id
to verifier; adding a scheme MUST NOT require a format change. Unknown scheme →
the envelope is `unverifiable`, which is a distinct outcome from `invalid` and
MUST be surfaced differently in UI.

| id | `k` | Signing | Notes |
|---|---|---|---|
| `eth-eip191` | 20-byte address | EIP-191 `personal_sign` over `signing_input`; verify by ecrecover and compare to `k` | v1 primary |
| `nostr-schnorr` | 32-byte x-only pubkey | BIP-340 Schnorr over `sha256(signing_input)` | v1 primary |
| `ssh-ed25519` | SSH public key blob | `ssh-keygen -Y sign` with namespace `thing-envelope-v1` | v1 stub |

**`eth-eip191` is the recommended default.** Ethereum and Nostr share secp256k1,
so one master key yields both an address and — via a deterministic derivation
from a signed message — an x-only Nostr pubkey. That derived key goes in
`Author.ek` and does encryption duty (§7), which means the private-invite feature
uses NIP-44 rather than a hand-rolled ECIES. Hardware wallets (Ledger, Trezor)
support `personal_sign` today, so that path is immediate.

**`ssh-ed25519` is in v1 specifically to prove the registry is real.** It is
nearly free (ed25519 verify), it has a scheme-native namespace field so domain
separation comes for free, and millions of developers already have a key and a
mental model for it. If the abstraction can hold two curves and two very
different key encodings, it will hold Solana (ed25519, same code path) and
whatever comes later.

### 6.1 Explicitly excluded

**ERC-1271 / smart-contract wallets (Safe, most ERC-4337 accounts) MUST NOT be
supported.** Their signatures can only be verified by calling a contract on
chain. That destroys self-containment (rule 1): a signature that needs an RPC
round-trip cannot be verified from a flyer on a wall with no internet. If
contract-wallet support is ever wanted it needs a different mechanism — e.g. the
contract wallet signing a delegation to an EOA — not a verifier that dials out.

**Passport / ICAO 9303 chips are out of scope for v1**, not because they are
uninteresting but because they bind content to a legal identity, which is close
to the opposite of what this system is for. The registry has a slot when that
changes.

---

## 7. Sealed envelopes (private things)

A sealed envelope is a public wrapper around an encrypted envelope. It is what
"encrypt a copy to each person I want to invite" looks like on the wire.

**Sign-then-encrypt.** The author signs a normal envelope; the signed envelope is
then encrypted. The signature is *inside* the ciphertext. This means the world
cannot see who sent a sealed thing — only recipients can. Encrypt-then-sign would
publish the author's identity to anyone holding the blob, which for a private
gathering is exactly the leak we are trying to avoid.

```
Sealed = {
  1: uint,          # v — MUST be 1
  2: [Slot],        # slots — one per recipient, ORDER RANDOMIZED
  3: bytes(24),     # nonce
  4: bytes          # ct — XChaCha20-Poly1305(CK, nonce, nip44_pad(canonical_cbor(Envelope)))
}

Slot = {
  1: bytes(32),     # epk — ephemeral x-only pubkey, unique per slot
  2: bytes          # wrap — NIP-44 v2 encryption of CK to the recipient
}
```

`wrap` is the **raw NIP-44 v2 payload bytes** — `version(1) || nonce(32) ||
ciphertext || mac(32)` — NOT its base64 form. NIP-44's canonical text encoding is
base64 for Nostr events, but here the payload is already a CBOR byte string, so
base64 would be redundant. Implementations MUST NOT base64-encode `wrap`.

- A random 32-byte content key `CK` encrypts the envelope once.
- `CK` is wrapped per recipient with NIP-44 v2, using a **fresh ephemeral sender
  key per slot**.
- **Recipient pubkeys are not listed.** A recipient trial-decrypts each slot
  until one succeeds. This is O(n) work for small n, and it is the price of not
  publishing the guest list — a sealed invite that names its recipients leaks the
  social graph to anyone who holds it.
- Slot order MUST be randomized. Otherwise position leaks who was invited first.
- The plaintext of `ct` MUST be the envelope under **NIP-44 v2's padding**, the
  same scheme the slot wraps already use — one padding rule for the whole format:

  ```
  padded  = u16be(len(envelope)) || envelope || zeros
  len(padded) = 2 + calc_padded_len(len(envelope))
  ```

  where `calc_padded_len` is NIP-44's (32 for ≤ 32 bytes; otherwise the next
  multiple of a chunk that is 32 up to 256 bytes and one-eighth of the next power
  of two above that). An envelope MUST be 1–65535 bytes. Decoders MUST reject a
  plaintext whose length is not exactly `2 + calc_padded_len(prefix)` or whose
  prefix exceeds what is present, and MUST distinguish that from an AEAD failure:
  the first is a sealer using some other padding rule, the second is tampering.
  The reason is unchanged — ciphertext length must not fingerprint the envelope.

**Re-invitation falls out.** Anyone who can decrypt `CK` can build a new `Sealed`
with a new slot for Carol. Alice's inner signature survives, so Carol sees the
event is genuinely Alice's. This is a *feature* — it is the paper-flyer property,
where whoever holds the flyer can hand it on — but it is also a property users
must be told about in plain language. Shells MUST state, at the point of sealing,
that any recipient can forward to anyone. Do not let people believe a seal is
access control; it is confidentiality against non-recipients only.

**Attachments in sealed things** are encrypted individually with `CK` under
distinct nonces, and the manifest's `h` values are the hashes of the
**plaintext** bytes (so that verification after decryption is unchanged). This
means an observer can correlate two sealed copies of the same attachment by
ciphertext. Accepted for v1; noted in §10.

### 7.1 Sealed bundle layout (RESOLVES the §7/§8 ambiguity)

Earlier drafts said the manifest was "inside `ct`", but `ct` as defined above
contains **only** `canonical_cbor(Envelope)`. That left it undefined where a
sealed thing's manifest, program, and attachments actually live. This section
pins it down. **`ct` contains the envelope and nothing else.** Every other part
of a sealed thing travels as its own bundle member, each independently encrypted
under the same `CK` with its own fresh 24-byte nonce, using
XChaCha20-Poly1305. Each encrypted member is stored as `nonce(24) || ciphertext`:

```
sealed member = bytes(24) nonce || XChaCha20-Poly1305(CK, nonce, plaintext)
```

So a **sealed** bundle (§8) is:

```
bundle/
  envelope.cbor        # Sealed (the ct inside holds the Envelope)
  manifest.enc         # sealed member of canonical_cbor(Manifest)
  program.enc          # sealed member of the program blob
  blobs/<hex-hash>     # sealed member; <hex-hash> is sha256 of the PLAINTEXT
                       # attachment bytes (as in the manifest's h), even though
                       # the file stores ciphertext
```

A recipient, after recovering `CK` from a slot and decrypting `ct` to the
envelope, decrypts `manifest.enc` → the manifest and checks
`sha256(plaintext manifest) == envelope.man`; decrypts `program.enc` and checks
`sha256(plaintext program) == manifest.prog`; and decrypts each
`blobs/<hex-hash>` and checks `sha256(plaintext) == h` (which also equals the
file name). Admission (§8.1) is otherwise unchanged: every hash is over the
recovered **plaintext** bytes, and any mismatch fails the whole bundle.

Rationale: this keeps §7's stated properties (attachments encrypted individually
under `CK`; `h` is the plaintext hash) and makes the manifest and program obey
the same rule, rather than special-casing the manifest into `ct`. It also keeps
the public and sealed admission paths structurally identical once the members
are decrypted.

---

## 8. Bundle

A bundle is the shippable container — the flyer. It is what a file, a paste, a
QR, or a torrent carries.

A **public** bundle:

```
bundle/
  envelope.cbor       # Envelope
  manifest.cbor       # canonical CBOR
  program             # the program blob (raw bytes)
  blobs/<hex-hash>    # one file per attachment, named by its sha256
```

A **sealed** bundle carries the same parts, but every part except
`envelope.cbor` is an encrypted member (`manifest.enc`, `program.enc`,
ciphertext `blobs/<hex-hash>`) — see §7.1. `manifest.cbor` is NOT present in a
sealed bundle; it is `manifest.enc`.

Serialized as an uncompressed tar for v1. (Uncompressed: the bundle's parts are
already-compressed media in the common case, and a compressor over the whole
thing invites compression-oracle games with sealed content.)

### 8.1 Admission algorithm

This is the gate. A shell MUST run every step, in order, and MUST admit nothing
to its library or to a renderer until all pass:

1. Decode `envelope.cbor` under §2's strict rules. Reject non-canonical.
2. If `Sealed`: trial-decrypt slots to recover `CK`; on success, decrypt `ct`
   and decode the inner envelope. If no slot decrypts, the bundle is
   `not-for-me` — a distinct outcome from invalid. For a sealed bundle, also
   decrypt the sealed members (§7.1) before the hash-check steps: `manifest.enc`
   → the manifest bytes used in step 5, `program.enc` → the program bytes used
   in step 7, and each ciphertext `blobs/<hex-hash>` → the plaintext bytes used
   in step 8. Steps 5–8 then run identically on those recovered plaintext bytes.
3. Look up `author.s` in the registry. Unknown → `unverifiable`, stop.
4. Recompute `sig_payload`, `sig_digest`, `signing_input` **from the received
   bytes**. Verify `sig`. Fail → `invalid`, stop.
5. `sha256(manifest received bytes)` MUST equal `envelope.man`. (For a sealed
   bundle, "received bytes" are the decrypted `manifest.enc` plaintext.)
6. Decode the manifest under §2's strict rules.
7. `sha256(program bytes)` MUST equal `manifest.prog`.
8. For each entry in `manifest.att`: the blob MUST be present, and its sha256
   MUST equal `h`. A missing or mismatched attachment fails the whole bundle —
   there is no partial admission, because a thing with a missing attachment is
   not self-contained.
9. If `path`/`seq`/`prev` are present and the shell holds prior envelopes for
   `(author.k, path)`, check the chain and flag forks.

Only now may bytes reach a cage.

Note step 4's phrasing. Verification uses the bytes that arrived. Do not decode
then re-encode then verify.

---

## 9. Public API sketch

```ts
// Encoding
encodeManifest(m: Manifest): Uint8Array          // canonical
encodeEnvelope(e: UnsignedEnvelope, signer: Signer): Promise<Uint8Array>

// Decoding — strict; throws on non-canonical or limit violation
decodeManifest(bytes: Uint8Array): Manifest
decodeEnvelope(bytes: Uint8Array): Envelope

// Hashing
hash(bytes: Uint8Array): Hash                     // sha256, 32 bytes

// Verification
verifyEnvelope(bytes: Uint8Array): Promise<
  | { status: 'valid'; envelope: Envelope }
  | { status: 'invalid'; reason: string }
  | { status: 'unverifiable'; scheme: string }
>
admitBundle(b: BundleSource): Promise<AdmissionResult>   // §8.1, all steps

// Registry
registerScheme(id: string, verifier: Verifier): void
registerEncryptionScheme(id: string, sealer: Sealer): void

// Sealing
seal(env: Uint8Array, recipients: EncKey[], sender: Signer): Promise<Uint8Array>
unseal(sealed: Uint8Array, me: EncKey): Promise<Uint8Array | 'not-for-me'>
```

`Signer` is an interface, not a key. The shell implements it over a keyring, a
hardware wallet, or a browser extension. **This package MUST NOT hold private key
material or perform key storage.** It signs through an injected interface and
verifies with public keys. That keeps the blast radius of a bug in this package
to "wrong verification result," not "key exfiltration."

---

## 10. Known gaps and open questions

Listed honestly because this draft will be reviewed by people who will find them
anyway.

1. **Sealed attachment correlation.** §7 encrypts attachments under `CK`, so two
   sealed copies of the same poster share ciphertext and are linkable. Fixable
   with a per-bundle key derivation; deferred.
2. **`created` is a lie you can tell.** Deliberate — rule 4 means nothing depends
   on it. But shells will be tempted to display it. Consider whether the UI
   should show it at all, or only "received."
3. **Key rotation is unspecified.** If Alice's key is compromised, every past
   envelope still verifies. A revocation or rotation record probably belongs in
   the naming layer rather than here, but it needs an answer before real use.
4. **Program supersedes is not in this spec.** The plan is a signed pointer
   (`new_program_hash` signed by the key that signed v1), chained like §5.3. It
   may want to be an envelope with a reserved `type` rather than a new record
   type. Decide when the bridge lands.
5. **Trial decryption is O(n) and unbounded.** A malicious sealed blob can claim
   10,000 slots and burn CPU. Cap the slot count (suggest 512) and note that this
   caps invite size.
6. **`args` being opaque means the shell cannot sanity-check unknown programs.**
   Accepted: the cage is what makes that safe. Worth stating in the README so
   nobody adds "validation" that reintroduces a trusted parser.
7. **Is `type` worth having at all?**, given §4 says never trust it. The argument
   for: unknown programs need *some* label. The argument against: any field that
   MUST NOT be trusted will eventually be trusted by someone.

---

## 11. Conformance vectors (required before publish)

These exist. `@souspli/conformance` is the format half of the interop suite:
deterministic vectors — candidate bytes plus the expected outcome, as JSON — that
let a second implementation prove interop by running them against its own decoder
and verifier. The vectors are DATA, not code; any language consumes them. The
reference implementation is held to the same vectors (one test per vector) as a
self-consistency and regression check.

Every category below is covered, and each is a rule an implementation MUST match:

- Canonical encoding: map key ordering (including the RFC 7049 vs 8949 trap),
  shortest-form integers, NFC normalization, rejected floats, rejected tags,
  rejected indefinite lengths, rejected duplicate keys.
- Known-good envelope + manifest + program + attachment, one per scheme in §6,
  with the expected hashes at every level.
- Known-bad: flipped signature bit, manifest hash mismatch, attachment hash
  mismatch, non-canonical CBOR that decodes but should be rejected, tampered
  `type` with intact `prog`, unknown scheme id.
- Chain: valid `seq`/`prev` sequence, a fork, a gap.
- Sealed: a bundle sealed to 3 keys with a vector for each recipient, plus a
  `not-for-me` case.
- Limits: one vector per §2.3 limit, each expected to fail cleanly. Two of the
  §2.3 caps — `maxManifestBytes` and `maxEnvelopeBytes` — bound the *raw*
  manifest / envelope byte length and are enforced by the embedding host before
  decode, so they carry no decoder-level vector; a conforming host MUST still
  enforce them.

The CAGE half of conformance — proving an untrusted thing cannot escape the
renderer sandbox — is a live host harness (it needs a running browser), not
portable data, and ships with the implementation as its escape battery rather
than as vectors here.

---

## 12. Pending amendments

Found while building the reference implementation. Each is a change this draft
should absorb; none is a workaround in the code. Background:
[design note](../../design-notes/format-spec-notes.md).

1. **§4 — `args` SHOULD be JSON-representable.** `args` is CBOR `any`, so a manifest
   may carry integer-keyed maps or byte strings, which reach a program as `Map` and
   `Uint8Array`. Authoring guidance only; decoders are unchanged.
2. **New section — shell obligations.** A shell that admits a sealed bundle holds
   decrypted private bytes. It MUST NOT write them to persistent storage in the
   clear. The reference implementation serves sealed content from an in-memory store
   and its test suite pins this.
3. **§4 — attachment-table keys.** Keys are arbitrary `tstr`, but a shell that serves
   attachments by name cannot round-trip every string. The reference implementation
   refuses names that are empty, longer than 255 characters, or contain `/`, `\`,
   `..` or control characters. The spec should either constrain keys identically or
   state that shells MAY refuse manifests whose names they cannot serve — silent
   per-shell divergence would be an interop trap.
4. **§10.5 is resolved in the implementation:** the slot count is capped at 512
   before any cryptography runs.

## 13. Reference implementation status

| Spec | `@souspli/format` today |
|---|---|
| §6 `eth-eip191` | Sign and verify. The only scheme the Souspli app signs letters with. |
| §6 `nostr-schnorr` | Verify. The app uses this key for relay events and unsealing, not for signing letters. |
| §6 `ssh-ed25519` | **Not implemented** — an envelope using it is `unverifiable`. |
| §7 sealing | `seal` / `unseal` implemented and covered by conformance vectors, including the padding rule above (`sealed.json` was regenerated when the implementation was brought into line with it on 2026-09-23; nothing sealed under the earlier draft existed outside tests). The app can open sealed bundles; it cannot yet author them. |
| §5.3 chaining | Implemented; forks are flagged. `path` is set to the root envelope's hash when a letter is first amended. |
| §11 vectors | 41 vectors in 7 categories, committed under `src/conformance/vectors/`. |
