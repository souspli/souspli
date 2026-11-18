import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { bindChallenge, verifyPassport, type PassportInput, type TrustAnchor } from '../../src/shell/credential/passport.js'
import { checkCredential, type CredentialTrust } from '../../src/shell/credential/check.js'
import { DerError, readDer, readOne } from '../../src/shell/credential/der.js'
import { makeState } from '../passport-fixture.js'

// The passport verifier, against a synthetic state (test/passport-fixture.ts).
// What must hold: genuine data under a held certificate verifies; ANY altered
// byte, a foreign certificate, or a chip signature about another key does not.

const state = makeState('UTO')
const anchors: TrustAnchor[] = [{ name: 'Utopia CSCA', der: state.anchor }]
const passport = state.issue()
const author = Uint8Array.from(Buffer.from('04fb06e8bf44ec60b6a99d2f98551172b2f2ded8', 'hex'))
const other = Uint8Array.from(Buffer.from('04fb06e8bf44ec60b6a99d2f98551172b2f2ded9', 'hex'))
const NOW = Date.UTC(2026, 10, 18)
const bound = (to = author): PassportInput => ({ ...passport, aaResponse: passport.chipSign(bindChallenge(to)) })
const flip = (b: Uint8Array, at: number): Uint8Array => {
  const out = Uint8Array.from(b)
  out[at]! ^= 1
  return out
}

describe('bindChallenge', () => {
  it('matches the reader app (KeyBindingTest.kt uses the same vector)', () => {
    expect(Buffer.from(bindChallenge(author)).toString('hex')).toBe('85887d8ff01345e0')
  })
  it('takes exactly a 20-byte address', () => {
    expect(() => bindChallenge(new Uint8Array(32))).toThrow()
  })
})

describe('verifyPassport', () => {
  it('verifies genuine data and reads the identity fields', () => {
    const r = verifyPassport({ dg1: passport.dg1, sod: passport.sod }, anchors, author, NOW)
    expect(r).toEqual({
      status: 'verified',
      facts: {
        documentType: 'P',
        issuingState: 'UTO',
        nationality: 'UTO',
        surname: 'ERIKSSON',
        givenNames: 'ANNA MARIA',
        documentNumber: 'L898902C3',
        dateOfBirth: '740812',
        dateOfExpiry: '350101',
        sex: 'F',
        expired: false,
        anchor: 'Utopia CSCA',
        chip: 'absent'
      }
    })
  })

  it('verifies under RSA-PSS as well as PKCS#1', () => {
    const pss = makeState('PSS', true)
    const p = pss.issue()
    const r = verifyPassport({ ...p, aaResponse: p.chipSign(bindChallenge(author)) }, [{ name: 'PSS', der: pss.anchor }], author, NOW)
    expect(r.status === 'verified' && r.facts.chip).toBe('signed')
  })

  it('says the chip signed the key only when the signature is about this author', () => {
    const r = verifyPassport(bound(), anchors, author, NOW)
    expect(r.status === 'verified' && r.facts.chip).toBe('signed')
  })

  it('rejects a chip signature made for a different key (a copied letter)', () => {
    const r = verifyPassport(bound(other), anchors, author, NOW)
    expect(r).toEqual({ status: 'invalid', reason: "the chip's signature is not over this author's key" })
  })

  it('rejects a chip signature from a different chip', () => {
    const stranger = state.issue({ surname: 'OTHER' })
    const r = verifyPassport({ ...passport, aaResponse: stranger.chipSign(bindChallenge(author)) }, anchors, author, NOW)
    expect(r.status).toBe('invalid')
  })

  it('rejects a chip key the security object does not list', () => {
    const stranger = state.issue()
    const r = verifyPassport({ ...passport, dg15: stranger.dg15, aaResponse: stranger.chipSign(bindChallenge(author)) }, anchors, author, NOW)
    expect(r).toEqual({ status: 'invalid', reason: 'DG15 does not match the hash in the security object' })
  })

  it('rejects a chip signature that arrives without the chip key, or for a key with no address', () => {
    const aaResponse = passport.chipSign(bindChallenge(author))
    expect(verifyPassport({ dg1: passport.dg1, sod: passport.sod, aaResponse }, anchors, author, NOW).status).toBe('invalid')
    expect(verifyPassport({ ...passport, aaResponse }, anchors, null, NOW).status).toBe('invalid')
  })

  it('rejects altered identity data', () => {
    const r = verifyPassport({ dg1: flip(passport.dg1, 10), sod: passport.sod }, anchors, author, NOW)
    expect(r).toEqual({ status: 'invalid', reason: 'DG1 does not match the hash in the security object' })
  })

  it('rejects a change to any signed part of the security object', () => {
    // CMS leaves some wrapper fields unsigned (the digest algorithm list, for one); nothing is
    // read from those. Everything a fact is drawn from is covered by a hash or a signature.
    const find = (needle: Uint8Array | string): number => Buffer.from(passport.sod).indexOf(Buffer.from(needle as never))
    const dg1Hash = find(createHash('sha256').update(passport.dg1).digest())
    const messageDigest = find(Buffer.from('2a864886f70d010904', 'hex')) + 15
    const signerName = find('DS UTO')
    const cases: [string, number, string][] = [
      ['a data group hash', dg1Hash + 3, 'invalid'],
      ['the signed digest of the security object', messageDigest, 'invalid'],
      ['the signature', passport.sod.length - 1, 'invalid'],
      // An altered certificate no longer carries the state's signature.
      ['the document signer certificate', signerName, 'unverifiable']
    ]
    for (const [what, at, status] of cases) {
      expect(at, what).toBeGreaterThan(4)
      expect(verifyPassport({ dg1: passport.dg1, sod: flip(passport.sod, at) }, anchors, author, NOW).status, what).toBe(status)
    }
  })

  it('cannot vouch for a passport of a state whose certificate it does not hold', () => {
    const elsewhere = makeState('UTO')
    const r = verifyPassport({ dg1: passport.dg1, sod: passport.sod }, [{ name: 'Another Utopia', der: elsewhere.anchor }], author, NOW)
    expect(r).toEqual({ status: 'unverifiable', reason: "no bundled certificate of UTO signed this passport's document signer" })
    expect(verifyPassport({ dg1: passport.dg1, sod: passport.sod }, [], author, NOW).status).toBe('unverifiable')
  })

  it('reports expiry by the clock it is given, through the last valid day', () => {
    const p = state.issue({ expiry: '261118' })
    const at = (ms: number): unknown => {
      const r = verifyPassport({ dg1: p.dg1, sod: p.sod }, anchors, author, ms)
      return r.status === 'verified' && r.facts.expired
    }
    expect(at(Date.UTC(2026, 10, 18, 23, 59))).toBe(false)
    expect(at(Date.UTC(2026, 10, 19))).toBe(true)
  })

  it('returns a verdict, never throws, for garbage', () => {
    for (const junk of [new Uint8Array(0), Uint8Array.from([0x77]), Uint8Array.from([0x77, 0x82, 0xff, 0xff, 1, 2, 3]), new Uint8Array(4096).fill(0x30)]) {
      expect(verifyPassport({ dg1: junk, sod: junk }, anchors, author, NOW).status).toBe('invalid')
      expect(verifyPassport({ dg1: passport.dg1, sod: junk }, anchors, author, NOW).status).toBe('invalid')
    }
  })
})

describe('checkCredential', () => {
  const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64')
  const req = (args: unknown, over: Record<string, unknown> = {}): Parameters<typeof checkCredential>[0] => ({
    type: 'passport',
    args,
    authorScheme: 'eth-eip191',
    authorKey: Buffer.from(author).toString('hex'),
    nowMs: NOW,
    ...over
  })
  // A passport reading needs no proof system: opening one here would be a bug.
  const trust: CredentialTrust = {
    anchors,
    pins: { target: '', roots: [], vkeys: {} },
    openBackend: () => Promise.reject(new Error('not needed for a passport reading'))
  }
  const full = { dg1: b64(passport.dg1), sod: b64(passport.sod), dg15: b64(passport.dg15), aaResponse: b64(passport.chipSign(bindChallenge(author))) }

  it('has nothing to say about other types, whatever their args look like', async () => {
    expect(await checkCredential(req(full, { type: 'memo' }), trust)).toBeNull()
  })

  it('reads base64 args and binds to the envelope author', async () => {
    const v = await checkCredential(req(full), trust)
    expect(v?.status === 'verified' && v.kind === 'passport' && v.passport.chip).toBe('signed')
    // The same letter under another author key: the chip did not sign that key.
    expect((await checkCredential(req(full, { authorKey: Buffer.from(other).toString('hex') }), trust))?.status).toBe('invalid')
    // A key with no 20-byte address cannot be what the chip signed.
    expect((await checkCredential(req(full, { authorScheme: 'nostr-schnorr', authorKey: '11'.repeat(32) }), trust))?.status).toBe('invalid')
  })

  it('treats empty, oversized or non-base64 args as invalid, not as a crash', async () => {
    for (const args of [null, [], 'x', {}, { dg1: full.dg1 }, { dg1: '!!', sod: full.sod }, { dg1: 'A'.repeat(200_000), sod: full.sod }, { dg1: 7, sod: full.sod }]) {
      expect((await checkCredential(req(args), trust))?.status, JSON.stringify(args)?.slice(0, 40)).toBe('invalid')
    }
  })

  it('says a proof letter cannot be checked when the proof system will not start', async () => {
    const v = await checkCredential(req({}, { type: 'passport-proof' }), trust)
    expect(v).toMatchObject({ kind: 'passport-proof', status: 'unverifiable' })
  })
})

describe('DER reader', () => {
  it('refuses lengths that run past the data, indefinite lengths and trailing bytes', () => {
    expect(() => readDer(Uint8Array.from([0x30, 0x05, 1, 2]))).toThrow(DerError)
    expect(() => readDer(Uint8Array.from([0x30, 0x80, 0, 0]))).toThrow(DerError)
    expect(() => readDer(Uint8Array.from([0x30, 0x85, 1, 1, 1, 1, 1]))).toThrow(DerError)
    expect(() => readDer(Uint8Array.from([0x1f, 0x01, 0]))).toThrow(DerError)
    expect(() => readOne(Uint8Array.from([0x04, 0x01, 9, 9]))).toThrow(DerError)
    expect(readOne(Uint8Array.from([0x04, 0x01, 9])).value).toEqual(Uint8Array.from([9]))
  })
})
