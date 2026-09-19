# Generating letters from code

Not every letter is typed into the app. An importer turning an archive into
articles, a billing system issuing invoices, a bot posting minutes — each needs to
produce signed `.thing` files directly.

Everything required is in `src/format/` (the future `@souspli/format` package): pure
TypeScript, no Electron, no network, runs in Node and in browsers, and never holds a
key — it signs through a `Signer` interface you supply.

```ts
import { buildBundle, jsToCbor, admitBundle, parseBundle } from './src/format/index.js'

const bundle = await buildBundle(signer, {   // signer: your Signer (eth-eip191)
  program,                                   // Uint8Array — e.g. samples/memo.html
  type: 'memo',
  args: jsToCbor({ to: 'All staff', from: 'Ops', subject: 'Friday', message: '…' }),
  attachments: new Map([                     // name -> { bytes, mime? }
    ['plan.png', { bytes: png, mime: 'image/png' }],
  ]),
})
// `bundle` is the bytes of a .thing file.
```

Use the **same program bytes** as the built-in type (`samples/<type>.html`) if you
want readers' apps to recognise the type: a type is identified by the hash of its
program, so a reformatted copy is a different type.

## Per-type guides

The repository carries step-by-step guides for the types most worth generating —
the exact `args` schema, attachment rules and limits for each. They are written as
[Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills), so an AI
coding agent working in this repository picks them up automatically, and they read
fine as plain documentation:

| Guide | Covers |
|---|---|
| [`create-article`](../../../.claude/skills/create-article/SKILL.md) | Articles from a scraper or importer: blocks, media placement, provenance. **Read this one first**; the others build on it. |
| [`create-memo`](../../../.claude/skills/create-memo/SKILL.md) | Memos and correspondence with enclosures; which attachment types render. |
| [`create-poster`](../../../.claude/skills/create-poster/SKILL.md) | Photo sets: arrangements and attachment naming. |
| *(worked example)* [`tools/welcome/make.ts`](../../../tools/welcome/make.ts) | The generator for the app's own welcome letter: a throwaway signer, `buildBundle`, and a self-check through `admitBundle` in ~100 lines. |
| [`create-invoice`](../../../.claude/skills/create-invoice/SKILL.md) | Invoices: the integer-only money model (minor units, thousandths, basis points) that a float will break; totals derived, not supplied. |

## Things that bite

- **No floats, anywhere.** Canonical encoding rejects them. `19.99` must be `1999`.
- **Text is NFC-normalised** or the manifest is rejected.
- **`created` is a claim.** Readers order by when they received a letter.
- **`args` must be CBOR values, not plain objects.** `jsToCbor()` converts JSON-shaped
  data (and refuses floats). Passing an object straight in fails with *cannot encode
  value of type object*.
- **Verify what you made:** run it through `admitBundle(parseBundle(bytes))` before shipping it, then
  open one in the app. A program ignores fields it does not read, so a manifest that
  *contains* your data proves nothing about what a reader will see.
- **Volume is not reach.** Generated letters still have to get to people — as files,
  via a magnet, or posted to a relay they subscribe to.
