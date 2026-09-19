// ── What the shell put in a draft stays in it ────────────────────────────────
//
// A program can never learn a hash -- getArgs() withholds the envelope -- so
// when a letter has to point at something, the SHELL seeds the pointer: Comment
// seeds `replyTo`, Attest seeds `attests`, "Write a post" seeds `inGroup`, a
// moderator's verdict seeds `inGroup` + `verdict`.
//
// Then the program emits its first draft, and args are WHOLE-SET REPLACEMENT.
// Keeping the pointer was left to convention ("echo it on every emit"), and the
// convention only covered the one field each program knew about. The article
// program has never heard of `inGroup`, so one keystroke into a forum post and
// it was no longer in the forum; a reply lost its forum the same way; a verdict
// written through the attestation program would have lost both fields and
// published as an ordinary attestation. Nothing failed -- the tests seeded a
// draft, read the seed back, and stopped.
//
// So the pointers the shell seeds are the shell's. They are recorded with the
// draft when it is created and laid back over every draft the program emits,
// which means the preview, the autosave and the signature all carry them, and
// no program has to know they exist. The shell's value WINS: the human pressed
// a button on a particular letter in a particular forum, and the program does
// not get to retarget that.
//
// Only seeds are pinned. A pointer the human TYPED into a program (an
// attestation started from New, with no target) is program state like any
// other, and stays editable.
//
// Pure: no sqlite, no Electron.

/** The args only the shell can know -- every relation the library indexes --
 *  plus `verdict`, which qualifies a pointer the shell seeded. Spelled out here
 *  rather than imported so this module stays free of sqlite and can be unit
 *  tested; library/index.ts refuses to load if INDEXED_RELS outgrows it. */
export const SHELL_PINNED_KEYS: readonly string[] = ['replyTo', 'attests', 'votesOn', 'inGroup', 'verdict']

export type Pins = Record<string, string>

function read(args: unknown, key: string): unknown {
  if (args instanceof Map) return args.get(key)
  if (args && typeof args === 'object' && !Array.isArray(args)) return (args as Record<string, unknown>)[key]
  return undefined
}

/** The pinnable part of a seed: allow-listed keys holding non-empty strings. */
export function pinsOf(seed: unknown): Pins {
  const pins: Pins = {}
  for (const key of SHELL_PINNED_KEYS) {
    const v = read(seed, key)
    if (typeof v === 'string' && v.length > 0) pins[key] = v
  }
  return pins
}

/** Lay the shell's pins over a program's args. Args that are not a map at all
 *  (null, a string, an array) cannot carry a pointer; they become a map that
 *  does, because losing the pointer is the worse outcome. */
export function applyPins(args: unknown, pins: Pins): unknown {
  const keys = Object.keys(pins)
  if (keys.length === 0) return args
  if (args instanceof Map) {
    const out = new Map(args)
    for (const k of keys) out.set(k, pins[k])
    return out
  }
  const base = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  return { ...base, ...pins }
}
