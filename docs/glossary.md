# Glossary

The project was built bottom-up, and the code still uses the names its components
were given on the way. The documentation and the app's interface use the words on
the left; the source, the tests and the [design notes](design-notes/index.md) use the
words on the right. Nothing on the wire was renamed.

| In the docs and the app | In the code | What it is |
|---|---|---|
| **Souspli** | the *shell* (`src/shell/`) | The trusted desktop client: holds your keys, admits letters, keeps your library, draws every trust signal. |
| **letter** | a *thing* (`.thing`, `thing://`) | One signed, self-contained document: a program, its content, and its attachments, under one signature. |
| **type** | a *program* | The single HTML file that renders a letter. A memo and an invoice are different types. Identified by its hash. |
| **sealed container** | the *cage* (`src/main/`) | The hardened renderer a letter runs in: no network, no storage, no navigation, no access to anything. |
| **bridge** | `window.bridge` | The four functions a letter can call. Everything else is absent. |
| **trusted header** | the *chrome* | The part of the window the letter cannot draw on, where author, signature status and confirmations live. |

## Terms used as they are

**Admission** — the ordered checks every incoming bundle passes before any of it is
rendered or stored: canonical decoding, signature, and the hash of every part.
All-or-nothing.

**Attachment / enclosure** — a file that travels inside a letter (an image, a video,
a PDF), addressed by name and verified by hash.

**Attestation** — a letter that puts your signature behind a statement about another
letter. Proves who said it, not that it is true.

**Bundle** — the shippable form of a letter: an uncompressed tar of envelope,
manifest, program and attachments. What a `.thing` file is.

**Co-signature** — a second, independent signature over the same document. N
signatories are N envelopes sharing one manifest.

**Draft** — a letter you are writing. Unsigned, never leaves your machine.

**Envelope** — the signed part: author, time claimed, and the hash of the manifest.

**Library** — the letters you hold, indexed locally. Ordered by when *you* received
them, never by what an author claims.

**Locator** — where to get a bundle: `file:`, `bundle:<hash>`, `magnet:`, `https:`.

**Manifest** — what is signed: which type, what content, which attachments by hash.

**Offer** — a relay's claim that a letter exists somewhere. Nothing is downloaded
until you press Fetch.

**Petname** — *your* private name for a key. Never leaves your machine.

**Relay** — a Nostr relay used to push letters to people who did not ask for them.
Adds reach, never authority.

**Roster** — the member list of a group; amended by publishing a new version.

**Sealed letter** — encrypted to its recipients, author included in the ciphertext.
Confidential against outsiders; any recipient can forward it.

**Tribe** — the keys you reach by following your own vouches, to depth two. The only
trust signal Souspli computes, and it starts from you.

**Vouch** — a public, signed statement that you recognise a key.
