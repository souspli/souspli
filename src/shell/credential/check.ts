import { verifyPassport, type PassportFacts, type TrustAnchor } from './passport.js'
import { verifyProofPackage, type ProofBackend, type ProofFacts, type ProofPins } from './proof.js'

// ── What a letter's credential is worth ──────────────────────────────────────
//
// Some letter types carry evidence the shell itself can check: a passport
// reading, a zero-knowledge proof about one. This is the one place that decides
// which types those are and turns their args into a verdict for the trusted
// header. A letter's own program never takes part: it draws inside its
// rectangle, and what it says about itself is a claim.
//
// Keyed on `type` and on the shape of `args`, never on what the program is.
// The verdict is about the DATA and the AUTHOR KEY, so a look-alike program
// carrying genuine data earns the same header, and one carrying anything else
// earns none.

export interface CredentialRequest {
  type: string
  /** The letter's args as plain values (cborToJs). */
  args: unknown
  authorScheme: string
  /** Lowercase hex, as the library stores it. */
  authorKey: string
  nowMs: number
}

export type CredentialKind = 'passport' | 'passport-proof'

export type CredentialVerdict =
  | { kind: 'passport'; status: 'verified'; passport: PassportFacts }
  | { kind: 'passport-proof'; status: 'verified'; proof: ProofFacts }
  | { kind: CredentialKind; status: 'invalid' | 'unverifiable'; reason: string }

/** Letter types that carry a credential. */
export const CREDENTIAL_TYPES: ReadonlySet<string> = new Set(['passport', 'passport-proof', 'ballot-vote'])

/** What the checks are made against: all of it the app's, none of it the letter's. */
export interface CredentialTrust {
  anchors: readonly TrustAnchor[]
  pins: ProofPins
  /** Opens the proof system. Called only for a letter that carries proofs. */
  openBackend: () => Promise<ProofBackend & { close(): Promise<void> }>
}

/** A chip file is a few kilobytes at most; anything larger is not one. */
const MAX_FILE_BYTES = 64 * 1024

function bytesField(args: Record<string, unknown>, name: string): Uint8Array | undefined {
  const v = args[name]
  if (v === undefined || v === null || v === '') return undefined
  if (v instanceof Uint8Array) {
    if (v.length > MAX_FILE_BYTES) throw new Error(`${name} is too large`)
    return v
  }
  if (typeof v !== 'string' || v.length > MAX_FILE_BYTES * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) throw new Error(`${name} is not base64`)
  return new Uint8Array(Buffer.from(v, 'base64'))
}

function hexToBytes(hex: string): Uint8Array | null {
  return /^([0-9a-f]{2})+$/.test(hex) ? new Uint8Array(Buffer.from(hex, 'hex')) : null
}

/** The author's address as proofs name it, when the author's key has one. */
function authorAddress(req: CredentialRequest): string | null {
  return req.authorScheme === 'eth-eip191' && /^[0-9a-f]{40}$/.test(req.authorKey) ? `0x${req.authorKey}` : null
}

/** The verdict for one letter, or null when its type carries no credential. */
export async function checkCredential(req: CredentialRequest, trust: CredentialTrust): Promise<CredentialVerdict | null> {
  if (req.type === 'passport') return checkPassport(req, trust.anchors)
  // A secret-ballot vote carries the same proofs as a passport-proof letter, bound to its one-time key.
  if (req.type !== 'passport-proof' && req.type !== 'ballot-vote') return null
  let backend: Awaited<ReturnType<CredentialTrust['openBackend']>>
  try {
    backend = await trust.openBackend()
  } catch (e) {
    return { kind: 'passport-proof', status: 'unverifiable', reason: `the proof system could not be started: ${(e as Error).message}` }
  }
  try {
    const result = await verifyProofPackage(req.args, trust.pins, authorAddress(req), req.nowMs, backend)
    return result.status === 'verified'
      ? { kind: 'passport-proof', status: 'verified', proof: result.facts }
      : { kind: 'passport-proof', status: result.status, reason: result.reason }
  } finally {
    await backend.close().catch(() => {})
  }
}

function checkPassport(req: CredentialRequest, anchors: readonly TrustAnchor[]): CredentialVerdict {
  if (!req.args || typeof req.args !== 'object' || Array.isArray(req.args)) {
    return { kind: 'passport', status: 'invalid', reason: 'the letter carries no passport data' }
  }
  const args = req.args as Record<string, unknown>
  try {
    const dg1 = bytesField(args, 'dg1')
    const sod = bytesField(args, 'sod')
    if (!dg1 || !sod) return { kind: 'passport', status: 'invalid', reason: 'the letter carries no passport data' }
    const dg15 = bytesField(args, 'dg15')
    const aaResponse = bytesField(args, 'aaResponse')
    // Only an Ethereum-style address has the 20 bytes the chip's challenge is derived from.
    const address = req.authorScheme === 'eth-eip191' ? hexToBytes(req.authorKey) : null
    const result = verifyPassport(
      { dg1, sod, ...(dg15 ? { dg15 } : {}), ...(aaResponse ? { aaResponse } : {}) },
      [...anchors],
      address && address.length === 20 ? address : null,
      req.nowMs
    )
    return result.status === 'verified'
      ? { kind: 'passport', status: 'verified', passport: result.facts }
      : { kind: 'passport', status: result.status, reason: result.reason }
  } catch (e) {
    return { kind: 'passport', status: 'invalid', reason: (e as Error).message }
  }
}
