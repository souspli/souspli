# Writing a type

A **type** is one self-contained HTML file — inline CSS and JavaScript, no external
references — that renders a letter from its `args`. In the code and on the wire it
is called a *program*. The fifteen built-in types in `samples/` are all ordinary
programs; read `samples/nametag.html` first, it is the smallest with real state.

To try your own: **New → New from HTML…**, pick the file and any attachments.

## The contract

A program runs in the [sealed container](../architecture/container.md) and sees only
the [bridge](../architecture/bridge.md):

```html
<script>
  const { type, args, attachments, mode } = window.bridge.getArgs()  // mode: 'view' | 'edit'
  const { locale, colorScheme } = window.bridge.viewerInfo()
  img.src = window.bridge.getBlob('poster.webp')       // a thing:// URL, or null
  window.bridge.emit('draft', { type, args, blobs })   // while editing
</script>
```

**A program supplies its own interface for creating new instances of itself.** The
client never composes `args`: it shows your program in *Edit* mode, your program
streams `emit('draft', …)` as the person types, the client renders that draft as the
live preview, and the header's **Publish** button signs exactly the latest one after
the person confirms.

This is a convention the client cannot enforce. The expectation is that people
converge on a library of well-made types and disfavour ones that hardcode state or
cannot create their own instances.

## Rules the samples live by

- **No Save or Publish buttons of your own.** Rendering and state are the program's;
  every control that signs anything is the client's. (`emit('publish')` is retired.)
- **View and Edit are both yours to draw.** The client tells you which one through
  `getArgs().mode`; the toggle itself is in the header. Both stay mounted while the letter is open, so in-progress edits survive
  toggling.
- **`args` and `blobs` are whole-set replacement.** Re-declare everything you want to
  keep on every emit. If your letter refers to another (`replyTo`, `attests`,
  `inGroup`, `votesOn`), echo that field every time or the letter silently detaches
  from its subject.
- **Attachments:** freshly picked bytes as `{ bytes, mime }`; ones you already hold
  as `{ carry: true }` so megabytes do not move per keystroke. Never rename an
  attachment you are carrying — the name is how it is found. You can display your
  attachments; you cannot read their bytes back.
- **Keep `args` JSON-shaped, and avoid numbers that could be floats.** The format
  forbids floating point entirely. Store money as integer minor units
  (`samples/invoice.html`), dates as ISO strings rendered in the reader's locale
  (`samples/invite.html`).
- **Attachment names:** 1–255 characters, no `/`, `\`, `..` or control characters.
- **Limits while drafting:** 32 MiB per blob, 64 MiB per draft. Refuse an oversized
  file at pick time rather than letting the draft be rejected and the preview freeze.

## What the container allows

Inline scripts and styles; images, audio, video and fonts from your own attachments
(plus `data:` and `blob:` where the [policy](../architecture/container.md) says).
Video seeks, because attachments are served with range support.

Not allowed, by design: any network request, frames, forms that submit, navigation,
new windows, permissions, persistent storage, plugins. Consequences worth designing
for:

- A **link cannot open a browser.** Render URLs as text. A link that silently does
  nothing is worse than an address the reader can copy.
- An **enclosed PDF or spreadsheet cannot be displayed.** List it with the MIME type
  and size from `getArgs().attachments` — which come from the signed manifest, not
  from your args — and say plainly that it cannot be opened here. The bytes are not
  lost; the reader can export the letter.

## Be honest in the interface

The samples are careful about the difference between what is *proven* and what is
*claimed*, and a good type copies that:

- Your program cannot see who signed the letter. Do not draw an author line; the
  header does that, and yours could only be a guess.
- Everything in `args` is the author's claim — dates, sources, who a contract
  expects to sign. Say so where it matters (`samples/article.html` renders its
  provenance block under "None of it is verified").
- Reserve ✓ for nothing. Verification marks belong to the header.

## A program silently ignores what it does not read

A program reads the `args` fields it names and ignores the rest. Writing
`headline` at an article that reads `title` fails nowhere — it renders "Untitled".
Check the `State: args {…}` comment at the top of the sample, and then **open the
letter**; a manifest containing your field proves nothing.

## Reference: the samples

| File | Shows |
|---|---|
| `nametag.html` | Minimal state; the draft/preview/publish loop. |
| `card.html`, `invite.html` | Scalar fields; hiding unset fields; `viewerInfo()` for locale. |
| `todo.html` | Array state. |
| `memo.html` | Enclosures, and honesty about what cannot be opened. |
| `poster.html` | Multiple image attachments, `carry`, arrangements, backward compatibility with older letters. |
| `article.html` | Block editor, media placement, footnotes, video, provenance. |
| `invoice.html` | Integer-only money; derived totals. |
| `comment.html`, `attestation.html`, `vote.html`, `join-request.html` | Letters about other letters; echoing the target on every emit. |
| `contract.html`, `group.html`, `vouch.html` | Letters about keys: signatories, rosters, vouches. |

Longer notes on each: [`samples/README.md`](../../../samples/README.md).
