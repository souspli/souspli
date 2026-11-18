import { createHash } from 'node:crypto'

// ── Passport proofs (zero-knowledge) ─────────────────────────────────────────
//
// A `passport-proof` letter carries a chain of zkPassport proofs instead of the
// passport itself. Together they say: "some passport whose signatures chain to
// a state certificate in this registry satisfies these claims -- and the same
// passport is bound to this author's key", revealing nothing else:
//
//   dsc        a certificate in the registry signed the document signer
//   id_data    the document signer signed this passport's security object
//   integrity  the security object covers the identity data
//   age, nationality   the claims, about that identity data
//   bind       the same identity data, tied to a Souspli address
//
// Each proof commits to the one before it, so they cannot be mixed between
// passports. This module checks every link and recomputes, from the letter's
// plain-language claims, the values the proofs must carry. Nothing the letter
// says about its own proofs is taken on trust: verification keys and registry
// roots come from the app (pins.ts), and the claims shown in the header are the
// ones the proofs were checked against.
//
// Layout of each proof's public inputs:
//   dsc        [registry root, commitment out]
//   id_data    [commitment in, commitment out]
//   integrity  [commitment in, commitment out, verification method]
//   age, nationality, bind
//              [commitment in, date, scope, subscope, parameter commitment,
//               nullifier type, nullifier, OPRF key hash]

export const PACKAGE_FORMAT = 'souspli-passport-proof/1'

/** What the app pins: which circuits and which certificate registries it accepts. */
export interface ProofPins {
  /** bb's proof flavour the keys were made for. */
  target: string
  /** Certificate registry roots, each named for the header. */
  roots: { name: string; root: string }[]
  /** Verification key per circuit name, base64. */
  vkeys: Record<string, string>
}

/** The cryptography this module needs from a proof system (bb.ts provides it). */
export interface ProofBackend {
  verify(verificationKey: Uint8Array, proof: Uint8Array, publicInputs: string[]): Promise<boolean>
  poseidon2(inputs: bigint[]): Promise<bigint>
}

export interface ProofFacts {
  /** The holder is at least this old on `provedAt`. Absent when no age was proved. */
  minAge?: number
  /** The holder's nationality is one of these. Absent when none was proved. */
  nationalityIn?: string[]
  /** What the nullifier is scoped to, as the letter states it (and the proofs confirm). */
  scope: string
  subscope: string
  /** One value per passport per scope: the same passport proving twice in a scope shows the same one. */
  nullifier: string
  /** The date the proofs were made for, unix seconds. The passport was unexpired then. */
  provedAt: number
  /** Which pinned certificate registry the passport chains to. */
  anchor: string
}

export type ProofResult =
  | { status: 'verified'; facts: ProofFacts }
  | { status: 'invalid'; reason: string }
  | { status: 'unverifiable'; reason: string }

class Invalid extends Error {}
class Unsupported extends Error {}

const MAX_PROOF_BYTES = 64 * 1024
const DISCLOSURES = ['age', 'nationality', 'bind'] as const
/** Which circuits may play which part. A proof of one statement must not stand in for another. */
const CIRCUIT_FOR: Record<string, RegExp> = {
  dsc: /^sig_check_dsc_[a-z0-9_]+$/,
  id_data: /^sig_check_id_data_[a-z0-9_]+$/,
  integrity: /^data_check_integrity_[a-z0-9_]+$/,
  age: /^compare_age$/,
  nationality: /^inclusion_check_nationality$/,
  bind: /^bind$/
}
/** integrity's third output: the data was verified by the chip's own signatures (ICAO 9303). */
const VERIFICATION_METHOD_ICAO_CHIP = 100n
/** A proof dated later than this far ahead of our clock is refused. */
const CLOCK_SLACK_SECONDS = 24 * 60 * 60

// zkPassport's parameter commitments: Poseidon2 over [proof type, parameter count, …parameters].
const TYPE_AGE = 1n
const TYPE_NATIONALITY_INCLUSION = 4n
const TYPE_BIND = 8n
const COUNTRY_SLOTS = 200
const BIND_BYTES = 509
const BIND_TAG_USER_ADDRESS = 1

interface PackagedProof {
  name: string
  circuit: string
  publicInputs: bigint[]
  rawInputs: string[]
  proof: Uint8Array
}

/** zkPassport's scope hash: the first 31 bytes of SHA-256, as a number. Empty means no scope. */
export function scopeHash(text: string): bigint {
  if (!text) return 0n
  return BigInt('0x' + createHash('sha256').update(text, 'utf8').digest().subarray(0, 31).toString('hex'))
}

/** Bytes as 31-byte big-endian numbers, last chunk first, the leading chunk taking the remainder. */
function packBytes(bytes: Uint8Array, size = 31): bigint[] {
  const count = Math.ceil(bytes.length / size)
  const out = new Array<bigint>(count)
  let at = 0
  for (let i = count - 1; i >= 0; i--) {
    const take = i === count - 1 ? bytes.length % size || size : size
    let v = 0n
    for (let k = 0; k < take; k++) v = (v << 8n) | BigInt(bytes[at++]!)
    out[i] = v
  }
  return out
}

function parsePackage(pkg: unknown): { address: string; scope: string; subscope: string; minAge?: number; nationalityIn?: string[]; proofs: Map<string, PackagedProof> } {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Invalid('the letter carries no proofs')
  const p = pkg as Record<string, unknown>
  if (p.format !== PACKAGE_FORMAT) throw new Unsupported(`proof package format ${String(p.format).slice(0, 40)}`)
  if (typeof p.address !== 'string' || !/^0x[0-9a-f]{40}$/.test(p.address)) throw new Invalid('the proofs name no address')
  if (typeof p.scope !== 'string' || p.scope.length === 0 || p.scope.length > 256) throw new Invalid('the proofs name no scope')
  if (typeof p.subscope !== 'string' || p.subscope.length > 256) throw new Invalid('bad subscope')
  const claims = (p.claims && typeof p.claims === 'object' ? p.claims : {}) as Record<string, unknown>
  let minAge: number | undefined
  if (claims.minAge !== undefined) {
    if (typeof claims.minAge !== 'number' || !Number.isInteger(claims.minAge) || claims.minAge < 1 || claims.minAge > 149) throw new Invalid('bad minimum age')
    minAge = claims.minAge
  }
  let nationalityIn: string[] | undefined
  if (claims.nationalityIn !== undefined) {
    const list = claims.nationalityIn
    if (!Array.isArray(list) || list.length === 0 || list.length > COUNTRY_SLOTS || !list.every((c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c))) {
      throw new Invalid('bad nationality list')
    }
    nationalityIn = list as string[]
  }
  if (!Array.isArray(p.proofs) || p.proofs.length > 8) throw new Invalid('the letter carries no proofs')
  const proofs = new Map<string, PackagedProof>()
  for (const raw of p.proofs as unknown[]) {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name : ''
    const role = CIRCUIT_FOR[name]
    if (!role || proofs.has(name)) throw new Invalid('unexpected proof in the package')
    if (typeof e.circuit !== 'string' || !role.test(e.circuit)) throw new Invalid(`the ${name} proof names the wrong kind of circuit`)
    if (typeof e.proof !== 'string' || e.proof.length > MAX_PROOF_BYTES * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.proof)) throw new Invalid(`the ${name} proof is not base64`)
    const inputs = e.publicInputs
    if (!Array.isArray(inputs) || inputs.length > 16 || !inputs.every((v) => typeof v === 'string' && /^0x[0-9a-f]{1,64}$/.test(v))) {
      throw new Invalid(`the ${name} proof has malformed public inputs`)
    }
    proofs.set(name, {
      name,
      circuit: e.circuit,
      publicInputs: (inputs as string[]).map((v) => BigInt(v)),
      rawInputs: inputs as string[],
      proof: new Uint8Array(Buffer.from(e.proof, 'base64'))
    })
  }
  return { address: p.address, scope: p.scope, subscope: p.subscope, ...(minAge !== undefined ? { minAge } : {}), ...(nationalityIn ? { nationalityIn } : {}), proofs }
}

/**
 * Verify a proof package for a letter by `authorAddress` (0x + 40 lowercase
 * hex, or null when the author's key is of a kind that has no such address).
 */
export async function verifyProofPackage(pkg: unknown, pins: ProofPins, authorAddress: string | null, nowMs: number, backend: ProofBackend): Promise<ProofResult> {
  try {
    const parsed = parsePackage(pkg)
    const need = (name: string): PackagedProof => {
      const p = parsed.proofs.get(name)
      if (!p) throw new Invalid(`the package has no ${name} proof`)
      return p
    }
    const dsc = need('dsc')
    const idData = need('id_data')
    const integrity = need('integrity')
    const bind = need('bind')
    if ((parsed.minAge !== undefined) !== parsed.proofs.has('age')) throw new Invalid('the age claim and the age proof do not go together')
    if ((parsed.nationalityIn !== undefined) !== parsed.proofs.has('nationality')) throw new Invalid('the nationality claim and its proof do not go together')

    // Shape first, so no proof is fed to the verifier with inputs it was not made for.
    const expectCount = (p: PackagedProof, n: number): void => {
      if (p.publicInputs.length !== n) throw new Invalid(`the ${p.name} proof has ${p.publicInputs.length} public inputs, not ${n}`)
    }
    expectCount(dsc, 2)
    expectCount(idData, 2)
    expectCount(integrity, 3)
    const disclosures = DISCLOSURES.map((n) => parsed.proofs.get(n)).filter((p): p is PackagedProof => p !== undefined)
    for (const d of disclosures) expectCount(d, 8)

    // 1. Every proof verifies, under OUR key for the circuit it names.
    for (const p of parsed.proofs.values()) {
      const vk = pins.vkeys[p.circuit]
      if (!vk) throw new Unsupported(`no verification key for circuit ${p.circuit}`)
      if (!(await backend.verify(new Uint8Array(Buffer.from(vk, 'base64')), p.proof, p.rawInputs))) throw new Invalid(`the ${p.name} proof does not verify`)
    }

    // 2. The chain starts at a certificate registry we accept...
    const anchor = pins.roots.find((r) => BigInt(r.root) === dsc.publicInputs[0])
    if (!anchor) throw new Unsupported('the proofs start from a certificate registry this version does not hold')
    // ...and each proof continues the one before it.
    if (idData.publicInputs[0] !== dsc.publicInputs[1]) throw new Invalid('the document signer proof does not continue the certificate proof')
    if (integrity.publicInputs[0] !== idData.publicInputs[1]) throw new Invalid('the data proof does not continue the document signer proof')
    if (integrity.publicInputs[2] !== VERIFICATION_METHOD_ICAO_CHIP) throw new Unsupported('identity data not verified by passport chip signatures')

    // 3. The claims are about that same data, on one date, in one scope, with one nullifier.
    const date = bind.publicInputs[1]!
    const nullifier = bind.publicInputs[6]!
    const scope = scopeHash(parsed.scope)
    const subscope = scopeHash(parsed.subscope)
    for (const d of disclosures) {
      const [commIn, dDate, dScope, dSubscope, , dType, dNullifier, oprf] = d.publicInputs as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
      if (commIn !== integrity.publicInputs[1]) throw new Invalid(`the ${d.name} proof is about different data`)
      if (dDate !== date) throw new Invalid('the proofs are for different dates')
      if (dScope !== scope || dSubscope !== subscope) throw new Invalid(`the ${d.name} proof is for a different scope`)
      // Type 0 is the plain nullifier: one per passport per scope. A salted one could be re-rolled.
      if (dType !== 0n || oprf !== 0n) throw new Unsupported('salted nullifiers')
      if (dNullifier !== nullifier || nullifier === 0n) throw new Invalid('the proofs do not share one nullifier')
    }
    if (date > BigInt(Math.floor(nowMs / 1000) + CLOCK_SLACK_SECONDS)) throw new Invalid('the proofs are dated in the future')

    // 4. Each proof commits to exactly the parameters the letter states.
    const committed = async (p: PackagedProof, expected: bigint[]): Promise<void> => {
      if (p.publicInputs[4] !== (await backend.poseidon2(expected))) throw new Invalid(`the ${p.name} proof was made for different parameters than the letter states`)
    }
    if (parsed.minAge !== undefined) await committed(need('age'), [TYPE_AGE, 2n, BigInt(parsed.minAge), 0n])
    if (parsed.nationalityIn) {
      const codes = parsed.nationalityIn.map((c) => BigInt(c.charCodeAt(0) * 65536 + c.charCodeAt(1) * 256 + c.charCodeAt(2)))
      while (codes.length < COUNTRY_SLOTS) codes.push(0n)
      await committed(need('nationality'), [TYPE_NATIONALITY_INCLUSION, BigInt(COUNTRY_SLOTS), ...codes])
    }
    const bound = new Uint8Array(BIND_BYTES)
    bound.set([BIND_TAG_USER_ADDRESS, 0, 20, ...Buffer.from(parsed.address.slice(2), 'hex')])
    const packed = packBytes(bound)
    await committed(bind, [TYPE_BIND, BigInt(packed.length), ...packed])

    // 5. And the key they are bound to is the key that signed this letter.
    if (!authorAddress || authorAddress !== parsed.address) throw new Invalid('the proofs are bound to a different key than the one that signed this letter')

    return {
      status: 'verified',
      facts: {
        ...(parsed.minAge !== undefined ? { minAge: parsed.minAge } : {}),
        ...(parsed.nationalityIn ? { nationalityIn: parsed.nationalityIn } : {}),
        scope: parsed.scope,
        subscope: parsed.subscope,
        nullifier: nullifier.toString(16).padStart(64, '0'),
        provedAt: Number(date),
        anchor: anchor.name
      }
    }
  } catch (e) {
    if (e instanceof Unsupported) return { status: 'unverifiable', reason: `unsupported: ${e.message}` }
    if (e instanceof Invalid) return { status: 'invalid', reason: e.message }
    return { status: 'invalid', reason: 'malformed proof package' }
  }
}
