import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STARTERS, starterByKey, starterBytes } from '../../src/shell/starters/index.js'

// The starters are inlined at build time from samples/*.html. These assertions
// are what keep samples/ the single source of truth: if someone edits a sample
// (or checks in a divergent copy), the bytes stop matching and the starter's
// program hash would no longer equal the one the sample specs produce.

const sampleBytes = (type: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, '..', '..', 'samples', `${type}.html`)))

/** The identity of every built-in type: sha256 of its program.
 *
 *  A letter names its program by this hash, so these are not implementation
 *  details -- they are what makes your Memo and my Memo the same type. Pinned
 *  so that changing one is a DECISION: an edit to a sample creates a new type
 *  and orphans every letter made with the old one, and a checkout with CRLF
 *  line endings silently did the same to all fifteen at once (the welcome
 *  forum's roster was made by such a build). If you meant to change a type,
 *  update its hash here in the same commit and say so in the message. */
const TYPE_IDENTITY: Record<string, string> = {
  article: '38f1b4f5d8d83b064c96f6089b2764116a88127dd75aaa173e52bb283efd40c0',
  attestation: 'de547e4ce53e539928988d45693fd00045ec9cfc9548ad4112c7a96c15463d3e',
  card: '861f1dfb441c6cd2ffad53ca3e86eb36c63d0c7e896e826710234b28c1e8abe2',
  comment: 'a1c64fba1dae21454999630dfc54e24146e44544e24a228e9c53d75432ae098b',
  contract: 'aa73e76b5e5b4b155c15e84b1288e20492bf1ab5033bf24fc7b8144dd175b2f0',
  group: '93fb835c8479d0ae8fc9684023851dd9ba1a6a239c01a1bced95a4a543096a04',
  invite: 'ad1362084d56d65b7ca23a1b2050da78bc6b8bd598a88ffaf54b50e752068fe9',
  invoice: '2943b9db2ca6dc1e15c2f2ef93aa6fbb816b700ba0a2f015edc5ec0bc6e782f6',
  'join-request': 'ae2bfcc6c6f11ea07e7a954a6ec2abcf86d77c7e76078dcb601a593a73ef2cc7',
  memo: '2358d30a800fd69b618991a488404ad7ea99d0fa46d3470cfd5287af925562f6',
  nametag: 'a9617356275434724d949f7b6733bec40a29a4ef6ee86071e38978547687e36a',
  poster: 'd147eba4228a3e121a7d1b775382a5a9dde4d7f34345e1ca7c0805d141fd3f90',
  todo: '2b5c7fd640484ab616b59db724b58c1beff303145459834c87fc987ebc183f64',
  vote: 'ec0e5021eac8153995c5fcb5bbe5208acf0a810aebc02b3ab4588481d4e8961b',
  vouch: '5d3c37eb0db892754ebf1d435e78a74e09ce0f2a9728d49c08277b8c5030e922'
}

describe('starters', () => {
  it('ships every sample', () => {
    expect(STARTERS.length).toBe(15)
    expect([...STARTERS].map((s) => s.type).sort()).toEqual([
      'article',
      'attestation',
      'card',
      'comment',
      'contract',
      'group',
      'invite',
      'invoice',
      'join-request',
      'memo',
      'nametag',
      'poster',
      'todo',
      'vote',
      'vouch'
    ])
  })

  it('has no carriage returns: a CRLF checkout would re-key every built-in type', () => {
    for (const s of STARTERS) {
      expect(starterBytes(s).includes(13), `${s.type} contains CR — check .gitattributes and re-checkout`).toBe(false)
    }
  })

  it('every built-in type keeps its identity', async () => {
    const { createHash } = await import('node:crypto')
    const got = Object.fromEntries(STARTERS.map((s) => [s.type, createHash('sha256').update(starterBytes(s)).digest('hex')]))
    expect(got).toEqual(TYPE_IDENTITY)
  })

  it('byte-matches the on-disk sample for every starter', () => {
    for (const s of STARTERS) {
      expect(starterBytes(s), `${s.type} drifted from samples/${s.type}.html`).toEqual(sampleBytes(s.type))
    }
  })

  it('has distinct keys, types, and programs', () => {
    expect(new Set(STARTERS.map((s) => s.key)).size).toBe(15)
    expect(new Set(STARTERS.map((s) => s.type)).size).toBe(15)
    expect(new Set(STARTERS.map((s) => s.html)).size).toBe(15)
  })

  it('resolves by key and rejects unknown keys', () => {
    expect(starterByKey('starter:nametag')?.type).toBe('nametag')
    expect(starterByKey('starter:nope')).toBeNull()
    expect(starterByKey('library:nametag')).toBeNull()
  })

  // The cage paints its view #08080a before a program loads (see #39), so a
  // program with a LIGHT body flashes white every time you switch to it. The
  // invoice shipped with a paper-coloured body and did exactly that. This is
  // cheaper than noticing it again by eye.
  it('every sample has a dark body background, so switching does not flash', () => {
    const DARK = '#1d2320'
    for (const s of STARTERS) {
      const body = /body\s*\{[^}]*\}/.exec(s.html)?.[0] ?? ''
      const declared = /background:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? ''
      // A sample may go through a variable; resolve one level if so.
      const viaVar = /^var\(\s*(--[\w-]+)\s*\)$/.exec(declared)?.[1]
      const resolved = viaVar
        ? (new RegExp(`${viaVar}:\\s*([^;]+)`).exec(s.html)?.[1]?.trim() ?? declared)
        : declared
      expect(resolved.toLowerCase(), `${s.type} has body background "${resolved}", not the dark ${DARK}`).toBe(DARK)
    }
  })

  it('every starter is a self-contained page that uses the bridge', () => {
    for (const s of STARTERS) {
      expect(s.html).toContain('window.bridge.getArgs()')
      expect(s.html).toContain("emit('draft'")
      expect(s.html).not.toContain('src="http') // no external resources (the cage CSP forbids them)
    }
  })
})
