import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { decodeCanonical, encode, type CborMap } from '../../src/format/cbor.js'
import { calcPaddedLen } from '../../src/format/nip44.js'
import { sealEnvelope, unseal, unsealFull, unsealerFromKey } from '../../src/format/sealed.js'

// ── §7: `ct` reuses NIP-44's padding -- and nothing else is accepted ─────────
// An earlier draft padded to 256-byte buckets, a private dialect that no other
// implementation of the spec would produce or accept. These pin the scheme by
// its observable shape (ciphertext length), and pin that a `ct` padded any
// OTHER way is refused rather than quietly read.

const me = schnorr.utils.randomSecretKey()
const mePub = schnorr.getPublicKey(me)
const AEAD_TAG = 16

/** Rebuild a Sealed with a different plaintext under the same CK and nonce. */
function resealWith(sealed: Uint8Array, ck: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const m = decodeCanonical(sealed) as CborMap
  const nonce = m.get(3) as Uint8Array
  m.set(4, xchacha20poly1305(ck, nonce).encrypt(plaintext))
  return encode(m)
}

describe('sealed envelope padding (§7)', () => {
  it('pads the envelope to calc_padded_len, so the ciphertext length is NIP-44’s, not a 256-byte bucket', () => {
    for (const len of [1, 31, 32, 33, 100, 255, 256, 257, 300, 1000, 4000]) {
      const inner = new Uint8Array(len).fill(0x42)
      const { sealed } = sealEnvelope(inner, [mePub])
      const ct = (decodeCanonical(sealed) as CborMap).get(4) as Uint8Array
      expect(ct.length, `envelope of ${len} bytes`).toBe(2 + calcPaddedLen(len) + AEAD_TAG)
      expect(unseal(sealed, unsealerFromKey(me))).toEqual(inner)
    }
    // The old dialect: a 33-byte envelope became a 256-byte plaintext. Now: 64.
    const { sealed } = sealEnvelope(new Uint8Array(33), [mePub])
    expect(((decodeCanonical(sealed) as CborMap).get(4) as Uint8Array).length).not.toBe(256 + AEAD_TAG)
  })

  it('refuses a ct padded the old way (256-byte bucket), and any bucket that is not calc_padded_len', () => {
    const inner = new Uint8Array(33).fill(0x42)
    const { sealed, ck } = sealEnvelope(inner, [mePub])
    const oldWay = new Uint8Array(256)
    oldWay[0] = 0
    oldWay[1] = 33
    oldWay.set(inner, 2)
    expect(() => unsealFull(resealWith(sealed, ck, oldWay), unsealerFromKey(me))).toThrow(/invalid inner padding/)
    // One byte over the right bucket is just as wrong.
    const overshoot = new Uint8Array(2 + calcPaddedLen(33) + 1)
    overshoot[1] = 33
    overshoot.set(inner, 2)
    expect(() => unsealFull(resealWith(sealed, ck, overshoot), unsealerFromKey(me))).toThrow(/invalid inner padding/)
  })

  it('refuses a length prefix that claims more than is there', () => {
    const inner = new Uint8Array(40).fill(0x42)
    const { sealed, ck } = sealEnvelope(inner, [mePub])
    const lying = new Uint8Array(2 + calcPaddedLen(40))
    lying[0] = 0xff
    lying[1] = 0xff
    lying.set(inner, 2)
    expect(() => unsealFull(resealWith(sealed, ck, lying), unsealerFromKey(me))).toThrow(/invalid inner padding/)
  })

  it('cannot seal an empty or an oversize envelope: NIP-44’s range is 1..65535', () => {
    expect(() => sealEnvelope(new Uint8Array(0), [mePub])).toThrow(/cannot be padded/)
    expect(() => sealEnvelope(new Uint8Array(65536), [mePub])).toThrow(/cannot be padded/)
    expect(unseal(sealEnvelope(new Uint8Array(65535).fill(1), [mePub]).sealed, unsealerFromKey(me)).length).toBe(65535)
  })
})
