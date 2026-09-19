// The part of a relay that is pure: what an event is, whether it is genuine,
// whether it is one we take, and whether it matches a filter. No sockets, no
// storage, no Workers APIs -- so it is unit-tested directly, and so a reader can
// check the policy without reading the plumbing.
//
// This is deliberately a SMALL relay. It carries one kind of event -- a Souspli
// letter (kind 3400) -- and implements the slice of NIP-01 that needs:
// EVENT / REQ / CLOSE in, EVENT / EOSE / OK / NOTICE out.
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'

export const THING_KIND = 3400

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export interface Policy {
  maxContentBytes: number
  blockedPubkeys: ReadonlySet<string>
  /** Seconds a created_at may lie in the future. Clients clamp cursors on it. */
  maxFutureSeconds: number
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/
const MAX_TAGS = 16
const MAX_TAG_VALUE = 2048 // a magnet link is the longest honest tag

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))

/** NIP-01: the id is the sha256 of this positional array, serialized compactly. */
export function eventId(ev: Pick<NostrEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>): string {
  return hex(sha256(new TextEncoder().encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))))
}

export const firstTag = (ev: NostrEvent, name: string): string | null => {
  for (const t of ev.tags) if (t[0] === name && typeof t[1] === 'string') return t[1]
  return null
}

/** Shape only -- cheap, and run before any hashing or signature work, so junk
 *  costs the relay as little as possible. */
export function shapeError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'invalid: not an object'
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !HEX64.test(e.id)) return 'invalid: bad id'
  if (typeof e.pubkey !== 'string' || !HEX64.test(e.pubkey)) return 'invalid: bad pubkey'
  if (typeof e.sig !== 'string' || !HEX128.test(e.sig)) return 'invalid: bad sig'
  if (typeof e.created_at !== 'number' || !Number.isSafeInteger(e.created_at) || e.created_at < 0) return 'invalid: bad created_at'
  if (typeof e.kind !== 'number' || !Number.isSafeInteger(e.kind)) return 'invalid: bad kind'
  if (typeof e.content !== 'string') return 'invalid: bad content'
  if (!Array.isArray(e.tags) || e.tags.length > MAX_TAGS) return 'invalid: bad tags'
  for (const t of e.tags) {
    if (!Array.isArray(t) || t.length === 0 || t.length > 4) return 'invalid: bad tag'
    for (const v of t) if (typeof v !== 'string' || v.length > MAX_TAG_VALUE) return 'invalid: bad tag value'
  }
  return null
}

/** What this relay takes. Returns the NIP-20-style reason to refuse, or null.
 *
 *  It does NOT look inside the bundle. Whether the letter in `content` is any
 *  good is the reader's admission gate's business, and a relay that claimed to
 *  have checked would be inviting clients to trust it. It adds reach, never
 *  authority. What it does bound is what it costs to be offered junk. */
export function policyError(ev: NostrEvent, policy: Policy, nowSeconds: number): string | null {
  if (ev.kind !== THING_KIND) return `blocked: this relay carries Souspli letters (kind ${THING_KIND}) only`
  if (policy.blockedPubkeys.has(ev.pubkey)) return 'blocked: this key may not post here'
  if (ev.content.length > policy.maxContentBytes) return `invalid: content over ${policy.maxContentBytes} bytes — post a pointer instead`
  if (ev.created_at > nowSeconds + policy.maxFutureSeconds) return 'invalid: created_at is in the future'
  if (firstTag(ev, 't') !== 'thing') return 'invalid: missing ["t","thing"]'
  const x = firstTag(ev, 'x')
  if (!x || !HEX64.test(x)) return 'invalid: missing ["x",<envelope hash>]'
  // Inline, or a pointer -- never neither: an event that carries nothing and
  // points nowhere is only noise in everyone's subscription.
  if (ev.content === '' && !firstTag(ev, 'thing-fetch')) return 'invalid: no bundle and no thing-fetch pointer'
  return null
}

/** The expensive part, last: the id really is the hash, and the key really signed it. */
export function verifyEvent(ev: NostrEvent): boolean {
  if (eventId(ev) !== ev.id) return false
  try {
    return schnorr.verify(unhex(ev.sig), unhex(ev.id), unhex(ev.pubkey))
  } catch {
    return false
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface Filter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  /** `#<single letter>` tag filters, e.g. { t: ['thing'] }. */
  tags: Record<string, string[]>
}

const MAX_FILTER_VALUES = 64

const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_FILTER_VALUES) : undefined
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined)

/** A client's filter, reduced to what we understand and bounded in size. An
 *  unknown field is ignored rather than refused, as NIP-01 asks. */
export function parseFilter(raw: unknown): Filter | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const f = raw as Record<string, unknown>
  const tags: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(f)) {
    if (/^#[a-zA-Z]$/.test(k)) {
      const vals = strings(v)
      if (vals) tags[k.slice(1)] = vals
    }
  }
  const kinds = Array.isArray(f.kinds) ? f.kinds.filter((k): k is number => typeof k === 'number').slice(0, MAX_FILTER_VALUES) : undefined
  return { ids: strings(f.ids), authors: strings(f.authors), kinds, since: int(f.since), until: int(f.until), limit: int(f.limit), tags }
}

export function matches(ev: NostrEvent, f: Filter): boolean {
  if (f.ids && !f.ids.includes(ev.id)) return false
  if (f.authors && !f.authors.includes(ev.pubkey)) return false
  if (f.kinds && !f.kinds.includes(ev.kind)) return false
  if (f.since !== undefined && ev.created_at < f.since) return false
  if (f.until !== undefined && ev.created_at > f.until) return false
  for (const [name, wanted] of Object.entries(f.tags)) {
    if (!ev.tags.some((t) => t[0] === name && t[1] !== undefined && wanted.includes(t[1]))) return false
  }
  return true
}
