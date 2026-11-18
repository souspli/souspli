import { openBackend } from './bb.js'
import { checkCredential, type CredentialRequest, type CredentialVerdict } from './check.js'
import pins from './pins.json'
import type { TrustAnchor } from './passport.js'
import { TRUST_ANCHORS } from './trust.js'

// ── Credential worker — parses a letter's evidence in isolation ─────────────
//
// Passport files and proofs are hostile bytes: certificates, CMS, later a
// proof system's own formats. Like the admission worker, this process holds no
// keys, is forked per request and killed after, and a crash or hang here costs
// one verdict and nothing else.

type Request = { id: number; request: CredentialRequest; extraAnchors?: TrustAnchor[]; extraRoots?: { name: string; root: string }[] }
export type WorkerResponse = { id: number; verdict: CredentialVerdict | null } | { id: number; error: string }

const parentPort = (process as unknown as { parentPort: import('electron').MessagePortMain }).parentPort

parentPort.on('message', (event: { data: Request }) => {
  const { id, request, extraAnchors, extraRoots } = event.data
  checkCredential(request, {
    anchors: [...TRUST_ANCHORS, ...(extraAnchors ?? [])],
    pins: { ...pins, roots: [...pins.roots, ...(extraRoots ?? [])] },
    openBackend
  }).then(
    (verdict) => parentPort.postMessage({ id, verdict } satisfies WorkerResponse),
    (e) => parentPort.postMessage({ id, error: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse)
  )
})
