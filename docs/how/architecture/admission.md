# Admission

Admission is the gate. Nothing reaches the library or a renderer until an incoming
bundle has passed every step of the [specified algorithm](../protocol/spec.md), in
order. It is all-or-nothing: a letter with one missing attachment is not
self-contained, so it is not admitted.

## Why it is split across two processes

The client is the first component that has something to steal — your key — *and*
has to parse hostile input. Those two facts are kept apart.

**The worker** (`src/shell/admission/worker.ts`) is an Electron `utilityProcess`
that holds no keys. It does the work with parser attack surface: splitting the tar
and decoding canonical CBOR under hard limits (manifest 1 MiB, envelope 64 KiB,
nesting depth 16, 256 attachments, 4096 map entries). It is **forked per bundle and
killed afterwards**, so each hostile input meets a clean process and there is no
accumulated state to corrupt. If it dies or hangs (15-second timeout), that bundle is
rejected and the client carries on.

**The main process** (`src/shell/admission/index.ts`) then runs, on output that is
already structurally valid and size-bounded:

1. signature verification — public keys only;
2. unsealing, if the letter is sealed — this needs your private key, so it must
   happen here;
3. the hash checks: manifest against the envelope, program against the manifest,
   every attachment against its table entry.

Cryptography never runs on unbounded or unvalidated input.

## Outcomes

| Outcome | Meaning | Shown as |
|---|---|---|
| `valid` | Everything verified. | *admitted (type)*, then ✓ signed in the header |
| `invalid` | A signature or hash failed, or the encoding was not canonical. | *INVALID — reason* |
| `unverifiable` | The signature scheme is unknown to this client. Distinct from invalid. | *unverifiable scheme: …* |
| `not-for-me` | A sealed letter with no slot this key can open. | *not for you* |

## Two rules worth repeating

- **Verify received bytes, never re-encoded bytes.** The signature input is
  recomputed from the bytes that arrived.
- **Reject non-canonical input rather than normalising it.**

## Every route in is the same route

File, drag-and-drop, paste, double-click, magnet, relay event, fetched offer: all of
them end in the same `admit` call. Arriving by double-click grants a bundle nothing.
A second launch hands the file to the running instance (single-instance lock) rather
than opening a rival library.

Fetched offers add one check on top: the admitted letter's hash must equal the hash
that was advertised, or it is refused even though it is validly signed
([relay event](../protocol/relay-event.md)).
