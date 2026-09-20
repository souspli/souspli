import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { admitBundle, cborToJs, parseBundle } from '../../src/format/index.js'
import { claimedKey } from '../../src/shell/library/keys'

// The welcome forum is a letter the app ships and offers to every new user, and
// its hash is that forum's identity for good. So what is bundled is held to the
// same terms `pnpm welcome:forum` checks when it is put there -- a hand-edited or
// re-encoded file fails here rather than in front of people.

const B64 = readFileSync(join(__dirname, '..', '..', 'src', 'shell', 'welcome', 'forum.thing.b64'), 'utf8').replace(/\s+/g, '')
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

/** The forum's identity. Changing it strands everyone who joined the old one:
 *  do it on purpose, in a commit that says so, or not at all. */
const FORUM_ROOT = '9c2716e99f2a57bcb4362124fa3a4821956f949720d958024d2498f08bb8b2be'

describe('the bundled welcome forum', () => {
  // An empty file is a legitimate state ("no forum yet": the app offers the
  // relay alone), so everything below applies only once one is bundled.
  const bundled = B64.length > 0

  it.runIf(bundled)('passes the ordinary admission gate, as a public first-version group', () => {
    const r = admitBundle(parseBundle(new Uint8Array(Buffer.from(B64, 'base64'))))
    expect(r.status).toBe('valid')
    if (r.status !== 'valid') return
    expect(r.sealed).toBe(false)
    expect(r.manifest.type).toBe('group')
    expect(r.envelope.seq ?? 1, 'bundle the FIRST version: its hash is what every post names').toBe(1)
    expect(hex(r.envelopeHash)).toBe(FORUM_ROOT)
  })

  it.runIf(bundled)('is an instance of the canonical Group type, not a CRLF or edited variant', () => {
    const r = admitBundle(parseBundle(new Uint8Array(Buffer.from(B64, 'base64'))))
    if (r.status !== 'valid') throw new Error('not valid')
    const canonical = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'samples', 'group.html')))
    expect(sha(r.program)).toBe(sha(canonical))
  })

  it.runIf(bundled)('names a moderator, and the keeper is one of them', () => {
    const r = admitBundle(parseBundle(new Uint8Array(Buffer.from(B64, 'base64'))))
    if (r.status !== 'valid') throw new Error('not valid')
    const args = cborToJs(r.manifest.args) as { members?: { key?: string; role?: string }[] }
    // Read with the APP'S parser, not a look-alike: a key the app would drop is a
    // moderator who moderates nothing, however right it looks to a person.
    const mods = (args.members ?? []).filter((m) => /^mod(erator)?$/i.test(String(m.role).trim())).map((m) => claimedKey(String(m.key)))
    expect(mods, 'every moderator key must be one the app can read').not.toContain(null)
    // A forum offered to strangers with nobody able to fold spam would be a
    // poor welcome; and a keeper who mistyped their own key moderates nothing.
    expect(mods.length).toBeGreaterThan(0)
    expect(mods).toContain(hex(r.envelope.author.k))
  })
})
