import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { openBackend } from '../../src/shell/credential/bb.js'
import { verifyPassport } from '../../src/shell/credential/passport.js'
import { scopeHash, verifyProofPackage, type ProofBackend, type ProofPins, type ProofResult } from '../../src/shell/credential/proof.js'
import shipped from '../../src/shell/credential/pins.json'

// The proof verifier, against real proofs made from a SYNTHETIC passport
// (test/passport-fixtures, built by nfcid's zk/fixture.sh): a made-up
// person under a made-up state certificate. Verified with the real backend, so
// this also proves bb.js starts with no network and no reference-string cache.

const FX = join(__dirname, '..', 'passport-fixtures', 'a')
const load = (name: string): Record<string, any> => JSON.parse(readFileSync(join(FX, name), 'utf8'))
const fixturePins = load('pins.json')
// The app's own verification keys, plus the made-up state's registry root.
const pins: ProofPins = { ...shipped, roots: [{ name: 'fixture registry', root: fixturePins.registryRoot }] }
const NOW = Date.UTC(2026, 10, 19)

let backend: ProofBackend & { close(): Promise<void> }
beforeAll(async () => {
  // A cache directory that does not exist: any attempt to fetch or read one would fail here.
  process.env.CRS_PATH = '/nonexistent/souspli-test-crs'
  backend = await openBackend()
}, 60_000)
afterAll(async () => {
  await backend?.close()
})

const alice = (): Record<string, any> => load('alice.json')
const verify = (pkg: unknown, author: string | null = alice().address, p: ProofPins = pins, now = NOW): Promise<ProofResult> =>
  verifyProofPackage(pkg, p, author, now, backend)
const proofOf = (pkg: Record<string, any>, name: string): Record<string, any> => pkg.proofs.find((p: { name: string }) => p.name === name)

describe('the pins the app ships', () => {
  it('carry the same keys the fixture was proved under, for every circuit they share', () => {
    for (const [circuit, vk] of Object.entries(fixturePins.vkeys)) expect(shipped.vkeys[circuit as keyof typeof shipped.vkeys], circuit).toBe(vk)
    expect(shipped.target).toBe(fixturePins.target)
  })
  it('do not include the test registry', () => {
    expect(shipped.roots.map((r) => r.root)).not.toContain(fixturePins.registryRoot)
  })
})

describe('verifyProofPackage', () => {
  it('verifies a genuine package and reports exactly what was proved', async () => {
    const r = await verify(alice())
    expect(r).toEqual({
      status: 'verified',
      facts: {
        minAge: 18,
        nationalityIn: ['AUS', 'NZL'],
        scope: alice().scope,
        subscope: '',
        nullifier: expect.stringMatching(/^[0-9a-f]{64}$/),
        provedAt: expect.any(Number),
        anchor: 'fixture registry'
      }
    })
  })

  it('refuses proofs bound to another key: a copied letter proves nothing for the copier', async () => {
    const r = await verify(alice(), '0x' + '11'.repeat(20))
    expect(r).toEqual({ status: 'invalid', reason: 'the proofs are bound to a different key than the one that signed this letter' })
    expect((await verify(alice(), null)).status).toBe('invalid')
    // Renaming the address inside the package does not help: the bind proof commits to the real one.
    const renamed = alice()
    renamed.address = '0x' + '11'.repeat(20)
    expect(await verify(renamed, renamed.address)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('bind proof was made for different parameters') })
  })

  it('refuses claims the proofs were not made for', async () => {
    const older = alice()
    older.claims.minAge = 21
    expect(await verify(older)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('age proof was made for different parameters') })
    const elsewhere = alice()
    elsewhere.claims.nationalityIn = ['AUS', 'USA']
    expect(await verify(elsewhere)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('nationality proof was made for different parameters') })
    // Order is part of what was committed to; a reordered list is a different statement to the circuit.
    const reordered = alice()
    reordered.claims.nationalityIn = ['NZL', 'AUS']
    expect((await verify(reordered)).status).toBe('invalid')
  })

  it('refuses a claim with no proof behind it, and a proof with no claim', async () => {
    const dropped = alice()
    dropped.proofs = dropped.proofs.filter((p: { name: string }) => p.name !== 'age')
    expect((await verify(dropped)).status).toBe('invalid')
    const unclaimed = alice()
    delete unclaimed.claims.minAge
    expect((await verify(unclaimed)).status).toBe('invalid')
  })

  it('refuses a different scope: the nullifier belongs to the scope the proofs name', async () => {
    const moved = alice()
    moved.scope = 'souspli:elsewhere'
    expect(await verify(moved)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('different scope') })
  })

  it('refuses any altered public input or proof byte', async () => {
    for (const name of ['dsc', 'id_data', 'integrity', 'age', 'nationality', 'bind']) {
      const input = alice()
      const pi = proofOf(input, name).publicInputs
      pi[pi.length - 1] = '0x' + (BigInt(pi[pi.length - 1]) ^ 1n).toString(16).padStart(64, '0')
      expect((await verify(input)).status, `${name} input`).toBe('invalid')

      const bytes = alice()
      const raw = Buffer.from(proofOf(bytes, name).proof, 'base64')
      raw[4000] ^= 1
      proofOf(bytes, name).proof = raw.toString('base64')
      expect(await verify(bytes), `${name} proof`).toEqual({ status: 'invalid', reason: `the ${name} proof does not verify` })
    }
  })

  it('refuses a proof of one statement offered as another', async () => {
    // The nationality proof is a valid proof. It is not an age proof.
    const swapped = alice()
    const nat = proofOf(swapped, 'nationality')
    Object.assign(proofOf(swapped, 'age'), { publicInputs: nat.publicInputs, proof: nat.proof })
    expect((await verify(swapped)).status).toBe('invalid')
    const renamed = alice()
    proofOf(renamed, 'age').circuit = 'inclusion_check_nationality'
    expect(await verify(renamed)).toEqual({ status: 'invalid', reason: 'the age proof names the wrong kind of circuit' })
  })

  it('cannot vouch for a registry or a circuit the app does not pin', async () => {
    expect(await verify(alice(), alice().address, shipped)).toMatchObject({ status: 'unverifiable', reason: expect.stringContaining('certificate registry') })
    const { sig_check_dsc_tbs_700_rsa_pkcs_4096_sha256: _dropped, ...rest } = pins.vkeys
    expect(await verify(alice(), alice().address, { ...pins, vkeys: rest })).toMatchObject({ status: 'unverifiable', reason: expect.stringContaining('no verification key') })
  })

  it('refuses proofs dated in the future', async () => {
    const provedAt = Number(BigInt(proofOf(alice(), 'bind').publicInputs[1]))
    expect((await verify(alice(), alice().address, pins, (provedAt - 2 * 86400) * 1000)).status).toBe('invalid')
    expect((await verify(alice(), alice().address, pins, (provedAt - 3600) * 1000)).status).toBe('verified')
  })

  it('returns a verdict, never throws, for garbage', async () => {
    for (const junk of [null, 'x', [], {}, { format: 'souspli-passport-proof/1' }, { ...alice(), proofs: 'no' }, { ...alice(), proofs: [{ name: 'dsc' }] }, { ...alice(), address: 'me' }]) {
      expect(['invalid', 'unverifiable']).toContain((await verify(junk)).status)
    }
    expect(await verify({ ...alice(), format: 'souspli-passport-proof/9' })).toMatchObject({ status: 'unverifiable' })
  })
})

describe('scopeHash', () => {
  it('is zero for no scope, and 31 bytes of SHA-256 otherwise', () => {
    expect(scopeHash('')).toBe(0n)
    expect(scopeHash('souspli:test')).toBe(BigInt(proofOf(alice(), 'bind').publicInputs[2]))
  })
})

describe('the synthetic passport itself', () => {
  it('passes the passport verifier too: both verifiers agree on zkPassport-generated data', () => {
    const exp = load('export.json')
    const anchor = new X509Certificate(readFileSync(join(FX, 'trust', 'csca.pem'))).raw
    const r = verifyPassport(
      { dg1: new Uint8Array(Buffer.from(exp.files.DG1, 'base64')), sod: new Uint8Array(Buffer.from(exp.files['EF.SOD'], 'base64')) },
      [{ name: 'fixture', der: new Uint8Array(anchor) }],
      null,
      NOW
    )
    expect(r).toMatchObject({ status: 'verified', facts: { surname: 'SILVERHAND', givenNames: 'JOHNNY', nationality: 'AUS', dateOfBirth: '881112', chip: 'absent' } })
  })
})
