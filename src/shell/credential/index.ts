import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { CREDENTIAL_TYPES, type CredentialKind, type CredentialRequest, type CredentialVerdict } from './check.js'
import type { TrustAnchor } from './passport.js'
import type { WorkerResponse } from './worker.js'

export { CREDENTIAL_TYPES, type CredentialVerdict } from './check.js'
export type { PassportFacts } from './passport.js'
export type { ProofFacts } from './proof.js'

// ── Credential service — the trusted side of credential checks ──────────────
//
// Hands a letter's evidence to the isolated worker (worker.ts) and returns its
// verdict for the header. Verdicts are remembered per letter for the life of
// the process: a letter's bytes never change, and the one input that does (the
// clock, for "expired") is not worth re-forking a process on every open.

const WORKER = join(__dirname, 'credential-worker.js')
const WORKER_TIMEOUT_MS = 30_000

/**
 * TEST-ONLY, like SHELL_ENS_MOCK: SHELL_PASSPORT_TEST_ANCHOR holds one base64
 * DER certificate to trust as a state certificate, named so the header can
 * never pass it off as a real one.
 */
export function anchorsFromEnv(): TrustAnchor[] {
  const raw = process.env.SHELL_PASSPORT_TEST_ANCHOR
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return []
  return [{ name: 'TEST CERTIFICATE (not a real state)', der: new Uint8Array(Buffer.from(raw, 'base64')) }]
}

/** TEST-ONLY: SHELL_PASSPORT_TEST_ROOT is one or more certificate registry roots (0x + 64 hex, comma-separated) for proofs to start from. */
export function rootsFromEnv(): { name: string; root: string }[] {
  const raw = process.env.SHELL_PASSPORT_TEST_ROOT ?? ''
  return raw
    .split(',')
    .filter((r) => /^0x[0-9a-f]{64}$/.test(r))
    .map((root) => ({ name: 'TEST REGISTRY (not real states)', root }))
}

/** Where settled verdicts are kept between runs (the library). */
export interface VerdictStore {
  get(envelopeHash: string): string | null
  put(envelopeHash: string, verdict: string): void
}

export class CredentialService {
  private readonly cache = new Map<string, CredentialVerdict>()
  private readonly running = new Map<string, Promise<CredentialVerdict | null>>()
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 1
  /** Set once the library is open. */
  store: VerdictStore | null = null

  /**
   * `extraAnchors` are state certificates trusted in addition to the bundled
   * ones. TEST-ONLY: the end-to-end suite issues passports from a made-up
   * state (see anchorsFromEnv). Nothing in the app sets it. `extraRoots` is
   * the same for proofs (rootsFromEnv).
   */
  constructor(
    private readonly extraAnchors: TrustAnchor[] = [],
    private readonly extraRoots: { name: string; root: string }[] = [],
    private readonly workerPath: string = WORKER
  ) {}

  /**
   * The verdict for an admitted letter, or null when its type carries no
   * credential. Never throws: a worker that dies or hangs yields "cannot be
   * checked", which the header shows as exactly that.
   */
  async check(envelopeHash: string, request: Omit<CredentialRequest, 'nowMs'>): Promise<CredentialVerdict | null> {
    if (!CREDENTIAL_TYPES.has(request.type)) return null
    const known = this.known(envelopeHash)
    if (known) return known
    // One check per letter at a time, however many callers ask.
    const pending = this.running.get(envelopeHash)
    if (pending) return pending
    // One worker at a time: each is a process and, for proofs, a WebAssembly
    // instance, and a forum's worth of unchecked letters must not start them all at once.
    const turn = this.queue.catch(() => {}).then(() => this.runWorker({ ...request, nowMs: Date.now() }))
    this.queue = turn
    const run = turn
      .then((verdict) => {
        if (verdict) this.remember(envelopeHash, verdict)
        return verdict
      })
      .catch((e): CredentialVerdict => {
        // Not remembered: the next open tries again.
        return { kind: request.type === 'passport' ? 'passport' : ('passport-proof' as CredentialKind), status: 'unverifiable', reason: `the check did not complete: ${(e as Error).message}` }
      })
      .finally(() => this.running.delete(envelopeHash))
    this.running.set(envelopeHash, run)
    return run
  }

  /** The verdict already reached on a letter, without starting a check. */
  known(envelopeHash: string): CredentialVerdict | null {
    const cached = this.cache.get(envelopeHash)
    if (cached) return cached
    const stored = this.store?.get(envelopeHash)
    if (!stored) return null
    try {
      const verdict = JSON.parse(stored) as CredentialVerdict
      this.cache.set(envelopeHash, verdict)
      return verdict
    } catch {
      return null
    }
  }

  private remember(envelopeHash: string, verdict: CredentialVerdict): void {
    this.cache.set(envelopeHash, verdict)
    // A proof's verdict never changes. A passport reading's does (it expires),
    // and "cannot be checked" may become checkable in a later version.
    if (verdict.kind === 'passport-proof' && verdict.status !== 'unverifiable') this.store?.put(envelopeHash, JSON.stringify(verdict))
  }

  private runWorker(request: CredentialRequest): Promise<CredentialVerdict | null> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      let child: UtilityProcess
      try {
        child = utilityProcess.fork(this.workerPath, [], { serviceName: 'credential-worker' })
      } catch (e) {
        reject(e as Error)
        return
      }
      let settled = false
      const done = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          child.kill()
        } catch {
          /* already gone */
        }
        fn()
      }
      const timer = setTimeout(() => done(() => reject(new Error('worker timed out'))), WORKER_TIMEOUT_MS)
      child.on('message', (msg: WorkerResponse) => {
        if (!msg || msg.id !== id) return
        if ('error' in msg) done(() => reject(new Error(msg.error)))
        else done(() => resolve(msg.verdict))
      })
      child.on('exit', (code) => done(() => reject(new Error(`worker exited (code ${code}) before responding`))))
      child.on('spawn', () => child.postMessage({ id, request, extraAnchors: this.extraAnchors, extraRoots: this.extraRoots }))
    })
  }
}
