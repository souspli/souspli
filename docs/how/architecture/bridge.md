# The bridge

Four functions on a frozen object, exposed through `contextBridge`, and nothing
else (`src/preload/index.ts`, `src/main/bridge.ts`).

```ts
bridge.getArgs(): ThingArgs                     // sync — render on first paint
bridge.getBlob(name: string): string | null     // sync — returns a thing:// URL
bridge.viewerInfo(): ViewerInfo                 // sync — coarse, non-identifying
bridge.emit(channel: string, data: unknown): void   // fire-and-forget request
```

The rule every one of them obeys: **a function either hands the letter data it
already came with, or accepts a request that grants nothing until a person confirms
it in the trusted header.** The bridge must never become the "somewhere to send it".

## `getArgs()` — a decoded view. Not CBOR. Not the envelope.

```ts
interface ThingArgs {
  type: string            // a display hint; never trusted
  args: unknown           // the letter's content, program-defined
  attachments: { name: string; mime: string; size: number }[]
  mode?: 'view' | 'edit'  // which of its two faces the program should draw
}
```

The manifest was already decoded and validated during admission. Handing a program
raw CBOR would put a second decoder inside untrusted code and require the two to
agree byte for byte — reintroducing, in the worst possible place, exactly the
canonicalisation surface the format works to contain.

Deliberately **withheld**:

- **The envelope** — author, signature, timestamp, version chain. A program that
  can draw "signed by alice.eth" can lie; identity is the header's exclusive job.
  This is also why a program can never learn a letter's hash, including its own.
- **Attachment hashes.** Programs address blobs by name, so they cannot construct
  their own content claims.

## `getBlob(name)` — a URL, not bytes

Returns `thing://<id>/att/<name>`, or `null`. Attachments can be hundreds of
megabytes; they do not cross IPC. The program uses the URL as an ordinary `src`, and
the [protocol handler](container.md) streams from the blob store with range support.
**The bridge moves no attachment bytes at all.**

A program can display its attachments but cannot read their bytes back.

## `viewerInfo()`

`{ locale, colorScheme }`. Enough to format a date and match the theme. Nothing else,
because a chatty `viewerInfo` would quietly turn a letter into a tracker.

## `emit(channel, data)` — a request that grants nothing

Fire-and-forget: the program cannot observe whether the person agreed.

The one channel that matters is **`draft`**:

```ts
bridge.emit('draft', { type, args, blobs })
```

A program supplies its own editing interface and streams its working state as the
person types. The client validates the shape, enforces per-blob **and** total size
caps (32 MiB and 64 MiB), hashes inline blobs into an attachment table, renders the
result as the live preview — and lets the person sign **exactly the latest draft**
by pressing **Publish** in the header and confirming.

Blob values take three forms:

| Value | Meaning |
|---|---|
| raw bytes | a freshly picked file, MIME unknown |
| `{ bytes, mime }` | a typed attachment (survives `nosniff` serving) |
| `{ carry: true }` | "keep the attachment of this name that you already hold" — resolved client-side, so megabytes do not cross IPC per keystroke |

`args` and `blobs` are **whole-set replacement**: a program re-declares everything it
wants to keep on every emit.

There is no `emit('publish')`. Programs cannot initiate a publish; every control
that signs anything lives in the header.

## Not there

Request/response over `emit`, and a file picker initiated by a program
(`requestFile()`), are both deliberately absent for now. Within one editing session
a just-picked large image still re-crosses IPC on each emit until the draft is
re-mounted; the planned fix is an opaque blob handle
([design note](../../design-notes/format-spec-notes.md)).
