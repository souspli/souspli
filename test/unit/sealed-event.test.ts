import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { buildSealedEvent, parseThingEvent, SEALED_TYPE } from '../../src/shell/nostr/event'

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
