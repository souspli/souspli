# Architecture overview

Souspli's desktop client is an Electron application split into three zones that
trust each other as little as possible.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Souspli window                                                       │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ TRUSTED HEADER  (own native view — the "chrome")                 │ │
│ │ author · ✓ signed · version · tribe · Publish · confirm dialogs  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ SEALED CONTAINER  (separate native view — the "cage")            │ │
│ │ the letter's own HTML/JS: untrusted, no network, no storage,     │ │
│ │ nothing but a four-function bridge                               │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
        ▲ bridge (4 functions, grants nothing)
        │
┌───────┴──────────────────────────────────────────────────────────────┐
│ MAIN PROCESS  (the "shell") — all authority lives here               │
│ keyring · library (SQLite + blob store) · mount · transports ·       │
│ torrent · nostr · naming                                             │
└───────┬──────────────────────────────────────────────────────────────┘
        │ bounded bytes in, structure out
┌───────┴──────────────────────────────────────────────────────────────┐
│ ADMISSION WORKER  (isolated utility process) — holds NO keys         │
│ tar + canonical CBOR decode under hard limits                        │
└──────────────────────────────────────────────────────────────────────┘
```

## The trust model in a paragraph

A letter is **untrusted code with nothing worth stealing and nowhere to send it.**
All real authority — keys, networking, storage, signing — lives in the main process,
outside the container. The letter gets a tiny message bridge and nothing else. If
the container holds, a malicious letter can at worst draw deceptive pixels *inside
its own rectangle*: it cannot exfiltrate, phone home, persist an identifier, open a
window, navigate away, or reach any Node or Electron capability. And because every
trust signal is drawn in a separate view it cannot touch, even its deceptive pixels
are contradicted a few centimetres above them.

## The life of a letter

1. **Bytes arrive** — a file, a paste, a torrent, a relay event. The transport is
   untrusted for content and bounded for resources. [Locators](../protocol/locators.md).
2. **Admission.** An isolated worker decodes the tar and the canonical CBOR under
   hard limits. The main process then verifies the signature, unseals if the letter
   is sealed to you, and checks the hash of the manifest, the program and every
   attachment. All or nothing. [Admission](admission.md).
3. **Library.** The envelope is indexed; blobs go into a content-addressed store
   (or, for sealed letters, into memory only). Relations — replies, votes, vouches,
   rosters — are indexed from `args`. [Library](library.md).
4. **Mount.** A fresh container is created with a throwaway session. The program is
   served to it from memory over a private `thing://` scheme; attachments stream
   from the blob store by admitted name. [Container](container.md).
5. **Render.** The program calls `getArgs()` and draws. The header above it shows
   who signed, from the envelope the program never sees. [Bridge](bridge.md).
6. **Authoring** runs the same loop backwards: the program streams a *draft* over
   the bridge, which grants nothing; the person presses **Publish** in the header
   and confirms; the main process signs exactly that draft and admits it like any
   other letter.

## Source layout

| Path | Zone | Role |
|---|---|---|
| `src/format/` | pure library | The [format](../protocol/spec.md): CBOR, hashing, signing, sealing, bundles, admission. No Electron, no network, holds no keys. |
| `src/conformance/` | pure library | [Conformance vectors](../protocol/conformance.md) and runner. |
| `src/main/`, `src/preload/` | container | The cage: hardened view, `thing://` handler, stores, bridge. **Imports nothing from the shell or the format.** |
| `src/shell/` | main process | The client: `admission/`, `keyring/`, `library/`, `mount/`, `transport/`, `torrent/`, `nostr/`, `naming/`, `starters/`, `chrome/`. |
| `samples/` | letters | The fifteen built-in types, one HTML file each. |
| `test/` | | Escape battery, client specs, unit tests. |
| `tools/world/` | | The [30-account world](../develop/world.md). |

The dependency rule is enforced in CI (`test/unit/boundary.test.ts`): the container
knows nothing about the client or the format, so it can be audited on its own. The
client is the only code that knows about all three.
