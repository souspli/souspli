import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { eventId, matches, parseFilter, policyError, shapeError, verifyEvent, THING_KIND, type NostrEvent, type Policy } from '../src/nostr'

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))
const priv = schnorr.utils.randomSecretKey()
const H = 'ab'.repeat(32)
const NOW = 1_800_000_000

const policy: Policy = { maxContentBytes: 100, blockedPubkeys: new Set(), maxFutureSeconds: 3600 }

function sign(partial: Partial<NostrEvent> = {}): NostrEvent {
  const base = {
    pubkey: hex(schnorr.getPublicKey(priv)),
    created_at: NOW,
    kind: THING_KIND,
    tags: [['t', 'thing'], ['x', H], ['thing-type', 'comment']],
    content: 'AAAA',
    ...partial
  }
  const id = eventId(base)
  return { ...base, id, sig: hex(schnorr.sign(unhex(id), priv)) }
}

describe('what counts as a genuine event', () => {
  it('accepts exactly what the app produces', () => {
    const ev = sign()
    expect(shapeError(ev)).toBeNull()
    expect(policyError(ev, policy, NOW)).toBeNull()
    expect(verifyEvent(ev)).toBe(true)
  })

  it('refuses an id that is not the hash, and a signature by another key', () => {
    const ev = sign()
    expect(verifyEvent({ ...ev, content: 'BBBB' })).toBe(false) // id no longer the hash
    const other = schnorr.utils.randomSecretKey()
    expect(verifyEvent({ ...ev, sig: hex(schnorr.sign(unhex(ev.id), other)) })).toBe(false)
  })

  it('refuses malformed shapes before doing any crypto', () => {
    expect(shapeError(null)).toMatch(/not an object/)
    expect(shapeError({ ...sign(), id: 'nope' })).toMatch(/bad id/)
    expect(shapeError({ ...sign(), created_at: 1.5 })).toMatch(/created_at/)
    expect(shapeError({ ...sign(), tags: [['t', 7]] })).toMatch(/tag value/)
    expect(shapeError({ ...sign(), tags: Array.from({ length: 17 }, () => ['t', 'thing']) })).toMatch(/bad tags/)
  })
})

describe('what this relay takes', () => {
  it('only Souspli letters', () => {
    expect(policyError(sign({ kind: 1 }), policy, NOW)).toMatch(/kind 3400\) only/)
  })
  it('bounded content, with the way out named', () => {
    expect(policyError(sign({ content: 'A'.repeat(101) }), policy, NOW)).toMatch(/post a pointer/)
  })
  it('a pointer instead of a bundle is fine; neither is not', () => {
    const tags = [['t', 'thing'], ['x', H]]
    expect(policyError(sign({ content: '', tags: [...tags, ['thing-fetch', 'magnet:?xt=urn:btih:' + 'c'.repeat(40)]] }), policy, NOW)).toBeNull()
    expect(policyError(sign({ content: '', tags }), policy, NOW)).toMatch(/no bundle and no/)
  })
  it('needs the topic and the letter hash', () => {
    expect(policyError(sign({ tags: [['x', H]] }), policy, NOW)).toMatch(/\["t","thing"\]/)
    expect(policyError(sign({ tags: [['t', 'thing'], ['x', 'short']] }), policy, NOW)).toMatch(/envelope hash/)
  })
  it('not from the future -- a far-future date would deafen clients that follow a cursor', () => {
    expect(policyError(sign({ created_at: NOW + 3601 }), policy, NOW)).toMatch(/future/)
    expect(policyError(sign({ created_at: NOW + 3000 }), policy, NOW)).toBeNull()
  })
  it('not from a key the operator has blocked', () => {
    const ev = sign()
    expect(policyError(ev, { ...policy, blockedPubkeys: new Set([ev.pubkey]) }, NOW)).toMatch(/may not post/)
  })
})

describe('filters', () => {
  it('matches the subscription the app actually sends', () => {
    const f = parseFilter({ kinds: [3400], since: NOW - 10, '#t': ['thing'] })!
    expect(matches(sign(), f)).toBe(true)
    expect(matches(sign({ created_at: NOW - 11 }), f)).toBe(false)
    expect(matches(sign({ tags: [['t', 'other'], ['x', H]] }), f)).toBe(false)
  })
  it('by letter hash, author, id and until', () => {
    const ev = sign()
    expect(matches(ev, parseFilter({ '#x': [H] })!)).toBe(true)
    expect(matches(ev, parseFilter({ '#x': ['cd'.repeat(32)] })!)).toBe(false)
    expect(matches(ev, parseFilter({ authors: [ev.pubkey], ids: [ev.id], until: NOW })!)).toBe(true)
    expect(matches(ev, parseFilter({ until: NOW - 1 })!)).toBe(false)
  })
  it('ignores what it does not understand, and bounds what it does', () => {
    const f = parseFilter({ '#thing-group': ['x'], search: 'gold', kinds: Array.from({ length: 500 }, (_, i) => i) })!
    expect(f.tags).toEqual({}) // multi-letter tags are not filterable in NIP-01
    expect(f.kinds!.length).toBe(64)
    expect(parseFilter('nope')).toBeNull()
  })
})
