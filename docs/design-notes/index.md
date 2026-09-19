# Design notes

Each subsystem of Souspli was built from a written brief: what it is for, the one
principle that governs it, what is deliberately out of scope, and how it is tested.
They are kept here **as written**, as decision records — the reasoning is usually
more useful than the conclusion.

They are not documentation. They use the code's names (*thing*, *shell*, *cage*; see
the [glossary](../glossary.md)), their "out of scope" sections are frozen at the date
shown, and several describe as future work things that now exist. For how things are
today, read [How it works](../how/index.md).

| Written | Note | About |
|---|---|---|
| 2026-07-16 | [cage](cage.md) | The sealed container: four hardening layers and the escape battery. |
| 2026-07-19 | [bridge](bridge.md) | The four-function bridge and what it withholds. |
| 2026-07-19 | [format-spec-notes](format-spec-notes.md) | What building the bridge taught the format specification. |
| 2026-07-20 | [security-review-round2](security-review-round2.md) | Resolution of two rounds of internal security review. |
| 2026-07-21 | [transport](transport.md) | Locators, bounded fetches, content-addressed integrity. |
| 2026-07-23 | [naming](naming.md) | Names: the resolver is untrusted for the key. |
| 2026-07-23 | [conformance](conformance.md) | Interop vectors for a second implementation. |
| 2026-07-23 | [authoring](authoring.md) | Authoring as the mirror of admission. |
| 2026-07-25 | [packaging](packaging.md) | Installers for testers. |
| 2026-08-23 | [sandbox](sandbox.md) | The OS sandbox: why the suite runs with it off, and how that is kept honest. |
| 2026-09-13 | [relay](relay.md) | Nostr relays: the first push transport; offers and pointers. |
| 2026-09-13 | [forum](forum.md) | A forum out of existing primitives plus one new type, the vote. |
