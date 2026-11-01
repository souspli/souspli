import { describe, expect, it } from 'vitest'
import { bech32Decode, bech32Encode, isXOnlyKey, npubOf, parseRecipient } from '../../src/shell/recipient'

// NIP-19's own example.
const HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e'
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg'

describe('bech32', () => {
  it('matches the NIP-19 vector both ways', () => {
    expect(npubOf(HEX)).toBe(NPUB)
    const d = bech32Decode(NPUB)!
    expect(d.hrp).toBe('npub')
    expect(Buffer.from(d.bytes).toString('hex')).toBe(HEX)
  })
  it('round-trips, and takes all-uppercase', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7)
    const s = bech32Encode('npub', bytes)
    expect(Buffer.from(bech32Decode(s)!.bytes)).toEqual(Buffer.from(bytes))
    expect(bech32Decode(s.toUpperCase())).not.toBeNull()
  })
  it('refuses a changed character, mixed case, and junk', () => {
    const typo = NPUB.slice(0, 20) + (NPUB[20] === 'q' ? 'p' : 'q') + NPUB.slice(21)
    expect(bech32Decode(typo)).toBeNull()
    expect(bech32Decode(NPUB.slice(0, 10) + NPUB.slice(10).toUpperCase())).toBeNull()
    expect(bech32Decode('npub1')).toBeNull()
    expect(bech32Decode('npub1bbbbbbbbbbbb')).toBeNull()
  })
})

describe('parseRecipient', () => {
  it('an npub or 64 hex is an encryption key', () => {
    expect(parseRecipient(` ${NPUB} `)).toEqual({ kind: 'enc', ek: HEX })
    expect(parseRecipient(HEX.toUpperCase())).toEqual({ kind: 'enc', ek: HEX })
  })
  it('an address is an author, to be resolved through the library', () => {
    expect(parseRecipient('0xAbCdEf0123456789abcdef0123456789ABCDEF01')).toEqual({
      kind: 'author',
      scheme: 'eth-eip191',
      key: 'abcdef0123456789abcdef0123456789abcdef01'
    })
  })
  it('refuses a key that is not on the curve, and a mistyped npub', () => {
    // x = 5 has no point on secp256k1 (5^3 + 7 = 132 is not a square mod p).
    const off = '05'.padStart(64, '0')
    expect(isXOnlyKey(off)).toBe(false)
    expect(parseRecipient(off).kind).toBe('error')
    expect(parseRecipient(NPUB.slice(0, -1) + (NPUB.endsWith('g') ? 'h' : 'g')).kind).toBe('error')
  })
  it('refuses anything else, saying what it takes', () => {
    const r = parseRecipient('alice')
    expect(r.kind).toBe('error')
    expect(r.kind === 'error' && r.reason).toMatch(/npub/)
  })
})
