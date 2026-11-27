import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { schnorr } from '@noble/curves/secp256k1.js'
import { buildSealedEvent, buildThingEvent, parseThingEvent, SEALED_TYPE } from '../../src/shell/nostr/event'

// The event a sealed letter travels in says nothing but what a relay needs:
// the topic, the hash of these bytes, and that it is sealed -- under a key
// made for this one post.

describe('buildSealedEvent', () => {
  const tar = Uint8Array.from({ length: 1500 }, (_, i) => (i * 31) & 0xff)

  it('is a valid, verifiable thing event carrying exactly these bytes', async () => {
    const ev = await buildSealedEvent(tar, 1_800_000_000)
    const parsed = parseThingEvent(ev, 64 * 1024)
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return
    expect(parsed.type).toBe(SEALED_TYPE)
    expect(Buffer.from(parsed.bundle!)).toEqual(Buffer.from(tar))
    expect(parsed.envelopeHash).toBe(createHash('sha256').update(tar).digest('hex'))
  })

  it('carries no other tag', async () => {
    const ev = await buildSealedEvent(tar, 1_800_000_000)
    expect(ev.tags.map((t) => t[0])).toEqual(['t', 'x', 'thing-type'])
  })

  it('is signed by a different key every time', async () => {
    const keys = new Set<string>()
    for (let i = 0; i < 5; i++) keys.add((await buildSealedEvent(tar, 1_800_000_000)).pubkey)
    expect(keys.size).toBe(5)
  })
})

describe('a pointer’s title tag', () => {
  const hash = 'ab'.repeat(32)
  const key = (): Uint8Array => schnorr.utils.randomSecretKey()

  it('rides on a pointer and is read back as posted', async () => {
    const ev = await buildThingEvent({ envelopeHash: hash, type: 'article', fetchLocator: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), title: 'A headline', createdAt: 1 }, key())
    expect(ev.tags).toContainEqual(['thing-title', 'A headline'])
    const parsed = parseThingEvent(ev, 32 * 1024)
    expect('error' in parsed ? parsed.error : parsed.title).toBe('A headline')
  })

  it('is left off an inline event, which carries its own', async () => {
    const ev = await buildThingEvent({ envelopeHash: hash, type: 'memo', bundle: new Uint8Array([1, 2, 3]), title: 'A subject', createdAt: 1 }, key())
    expect(ev.tags.some((t) => t[0] === 'thing-title')).toBe(false)
  })

  it('is ignored whole when over the length bound, and null when absent', async () => {
    const long = await buildThingEvent({ envelopeHash: hash, type: 'article', fetchLocator: 'https://example.org/a.thing', title: 'x'.repeat(513), createdAt: 1 }, key())
    const none = await buildThingEvent({ envelopeHash: hash, type: 'article', fetchLocator: 'https://example.org/a.thing', createdAt: 1 }, key())
    for (const ev of [long, none]) {
      const parsed = parseThingEvent(ev, 32 * 1024)
      expect('error' in parsed ? parsed.error : parsed.title).toBeNull()
    }
  })
})
