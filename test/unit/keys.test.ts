import { describe, expect, it } from 'vitest'
import { claimedKey } from '../../src/shell/library/keys'

const K = 'd8790baa922380058c1e0604692ef32970d85632'

describe('claimedKey — a key as a person writes one', () => {
  it('the app shows 0x…, so that is what gets pasted: it is the same key', () => {
    expect(claimedKey('0x' + K)).toBe(K)
    expect(claimedKey('0X' + K.toUpperCase())).toBe(K)
    expect(claimedKey('0xD8790bAA922380058C1E0604692EF32970D85632')).toBe(K) // checksummed
    expect(claimedKey(`  0x${K}\n`)).toBe(K)
  })
  it('bare hex still works, at either key length', () => {
    expect(claimedKey(K)).toBe(K)
    expect(claimedKey('ab'.repeat(32))).toBe('ab'.repeat(32)) // an x-only nostr key
  })
  it('anything else is program data, not a party', () => {
    for (const junk of ['', '0x', 'gearcat', K.slice(1), K + 'zz', '0x0x' + K, 'alice.eth', 'ab'.repeat(33)]) {
      expect(claimedKey(junk), JSON.stringify(junk)).toBeNull()
    }
  })
})
