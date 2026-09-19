// ── What a letter calls itself ───────────────────────────────────────────────
//
// A feed of "article 0x5e13a5…988D" rows tells you who and what KIND, never what
// ABOUT, and a library you cannot scan is a library you stop opening. So the
// feed shows a title.
//
// But the title comes out of `args`, which makes it the author's CLAIM, and it
// is about to be drawn in trusted chrome -- the one place a thing cannot reach
// with its own pixels. That makes it the first program-supplied text to cross
// that line, so it crosses on the chrome's terms:
//
//   · it is a plain string, shown as text, never markup;
//   · nothing that can reorder, hide or stack text survives (controls, bidi
//     overrides and isolates, zero-widths, combining marks past a small run);
//   · no check mark survives. ✓ is the chrome's vocabulary for VERIFIED, and a
//     letter titled "✓ verified by your bank" must not get to borrow it;
//   · it is short, and one line.
//
// The chrome renders what is left visibly secondary to the author, which stays
// the fact the row leads with.
//
// Pure on purpose: no sqlite, no Electron, so it is unit-tested directly.

/** Fields a program might keep its one-line summary in, best first. The
 *  built-in types cover: article/invite/todo/poster/contract `title`, memo
 *  `subject`, nametag/card/group/vouch `name`, invoice `invoiceNumber`,
 *  attestation `statement`, comment `body`, join-request `say`. */
const TITLE_FIELDS = ['title', 'subject', 'name', 'invoiceNumber', 'statement', 'body', 'message', 'say'] as const

export const MAX_TITLE_CHARS = 80

function field(args: unknown, key: string): unknown {
  if (args instanceof Map) return args.get(key)
  if (args && typeof args === 'object' && !Array.isArray(args)) return (args as Record<string, unknown>)[key]
  return undefined
}

// Everything that looks like a tick or a ballot box, so none can stand in for
// the chrome's ✓: check marks, heavy check marks, ballot boxes, the emoji.
const CHECKS = /[\u2713\u2714\u2705\u2611\u2610\u2612\u237B\u{1F5F8}\u{1F5F9}\u{2BBD}\u221A]/gu
// C0/C1 controls, soft hyphen, bidi marks/embeddings/overrides/isolates,
// zero-width and invisible formatters, line/paragraph separators, BOM, tags.
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu
// More than two combining marks on one base is decoration at best and an
// attempt to draw outside the row at worst ("zalgo").
const STACKED_MARKS = /(\p{M}{2})\p{M}+/gu

/** Make arbitrary program text safe to show on one line of trusted chrome. */
export function sanitizeTitle(raw: string): string | null {
  const firstLine = raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  const clean = firstLine
    .normalize('NFC')
    .replace(INVISIBLE, ' ')
    .replace(CHECKS, '')
    .replace(STACKED_MARKS, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length === 0) return null
  // Count code points, not UTF-16 units, so a surrogate pair is never split.
  const points = Array.from(clean)
  return points.length > MAX_TITLE_CHARS ? points.slice(0, MAX_TITLE_CHARS - 1).join('').trimEnd() + '…' : clean
}

/** The title a letter claims for itself, or null when it offers none. */
export function claimedTitle(args: unknown): string | null {
  for (const key of TITLE_FIELDS) {
    const v = field(args, key)
    if (typeof v !== 'string') continue
    const t = sanitizeTitle(v)
    if (t) return t
  }
  return null
}
