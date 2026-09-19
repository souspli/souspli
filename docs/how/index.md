# How it works

Two layers, kept separate on purpose.

**The protocol** is what a letter *is*: bytes, hashes, signatures, encryption. It
knows nothing about Electron, windows or networks, and anyone can implement it.

**The client** is one implementation of a reader: a desktop app that admits letters,
runs them in a sealed container, and keeps your keys and your library.

## Protocol

| | |
|---|---|
| [The letter format](protocol/spec.md) | The specification: canonical CBOR, manifest, envelope, signature schemes, sealed envelopes, bundles, and the admission algorithm. Draft. |
| [Relations between letters](protocol/relations.md) | The conventions that turn single letters into threads, forums, votes, contracts and a trust graph. |
| [The relay event](protocol/relay-event.md) | How a letter rides a Nostr relay, and why who posted is not who wrote. |
| [Locators and transports](protocol/locators.md) | `file:`, `bundle:`, `magnet:`, `https:`, names — and the rule that makes them all safe. |
| [Conformance](protocol/conformance.md) | How a second implementation proves it agrees with the first. |

## The desktop client

| | |
|---|---|
| [Overview](architecture/overview.md) | The three trust zones and how a letter moves through them. |
| [The sealed container](architecture/container.md) | Four independent layers of "no network", and the header a letter cannot paint on. |
| [The bridge](architecture/bridge.md) | The four functions a letter may call, and what is deliberately withheld. |
| [Admission](architecture/admission.md) | How hostile bytes are handled by a process that holds no keys. |
| [Keys, library and storage](architecture/library.md) | Where things live on disk, and what never touches it. |
| [Security: threat model and evidence](architecture/security.md) | What is claimed, how it is tested, and what is not covered. |

## Working on it

| | |
|---|---|
| [Building from source](develop/building.md) | Run it, package it, the Linux sandbox note. |
| [Writing a type](develop/writing-a-type.md) | A letter's program: the contract, the constraints, the samples. |
| [Generating letters from code](develop/generating-letters.md) | Importers, billing systems, bots. |
| [Testing](develop/testing.md) | The suites, and how to add an attack. |
| [A 30-account world](develop/world.md) | A standing multi-account scenario for trying social features for real. |

The reasoning behind individual subsystems, as written at the time, is kept in the
[design notes](../design-notes/index.md).
