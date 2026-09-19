import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { fromHex, toHex } from '../../format/index.js'

// ── Nostr events carrying things ─────────────────────────────────────────────
//
// A relay is a way for a thing to reach somebody who never asked for it. That
// is the only thing the shell could not do: until now every thing arrived
// because a human handed over its bytes.
//
// Nothing about trust changes. A relay is untrusted exactly as a file, a URL
// and a torrent are untrusted: the bytes go through admission and nothing a
// relay says decides anything. What a relay adds is REACH, not authority.

/** Our kind, in the regular range (NIP-01: 1000–9999 are stored by relays).
 *  Ours until something else has to read it. */
export const THING_KIND = 3400

/** The encryption-scheme id written into Author.e when binding a nostr key.
 *  Nothing in the format fixed a value, so this is ours; it names the curve
 *  and encoding rather than a NIP, because that is what a reader must know. */
export const NOSTR_ENC_SCHEME = 'nostr-x-only'

/** Bundles bigger than this travel as a POINTER instead of inline. A comment
 *  or a vote is a couple of KB and goes whole, which is the entire reason a
 *  forum can work on relays alone; an article with video would flood one. */
export const MAX_INLINE_BUNDLE = 32 * 1024

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Tag names are DELIBERATELY namespaced rather than reusing e/p/a. Those have
 *  established meanings over nostr ids; our hashes are a different namespace,
 *  and colliding quietly would be worse than being verbose. */
export const TAG = {
  topic: 't',
  /** sha256 of the thing, as NIP-94 uses `x` for a file hash. */
  hash: 'x',
  type: 'thing-type',
  group: 'thing-group',
  reply: 'thing-reply',
  fetch: 'thing-fetch'
} as const

export interface ThingEventInput {
  envelopeHash: string
  type: string
  /** Inline bundle bytes, or omitted when this event is a pointer. */
  bundle?: Uint8Array
  /** Where to get it, when the bundle is too large to carry. */
  fetchLocator?: string
  group?: string
  replyTo?: string
  createdAt: number
}

const firstTag = (ev: NostrEvent, name: string): string | null => {
  for (const t of ev.tags) if (t[0] === name && typeof t[1] === 'string') return t[1]
  return null
}

/** The NIP-01 serialization an event's id is the sha256 of. Order is fixed by
 *  the spec: it is a positional array, not an object. */
function serializeForId(ev: Omit<NostrEvent, 'id' | 'sig'>): string {
  return JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])
}

export function eventId(ev: Omit<NostrEvent, 'id' | 'sig'>): string {
  return toHex(sha256(new TextEncoder().encode(serializeForId(ev))))
}

/** Build and sign an event announcing a thing. */
export async function buildThingEvent(
  input: ThingEventInput,
  nostrPrivkey: Uint8Array
): Promise<NostrEvent> {
  const tags: string[][] = [
    [TAG.topic, 'thing'],
    [TAG.hash, input.envelopeHash],
    [TAG.type, input.type]
  ]
  if (input.group) tags.push([TAG.group, input.group])
  if (input.replyTo) tags.push([TAG.reply, input.replyTo])
  if (input.fetchLocator) tags.push([TAG.fetch, input.fetchLocator])

  const unsigned = {
    pubkey: toHex(schnorr.getPublicKey(nostrPrivkey)),
    created_at: input.createdAt,
    kind: THING_KIND,
    tags,
    content: input.bundle ? base64(input.bundle) : ''
  }
  const id = eventId(unsigned)
  const sig = toHex(await schnorr.sign(fromHex(id), nostrPrivkey))
  return { ...unsigned, id, sig }
}

export interface ParsedThingEvent {
  event: NostrEvent
  envelopeHash: string
  type: string
  group: string | null
  replyTo: string | null
  fetchLocator: string | null
  bundle: Uint8Array | null
}

/** Check an event is well-formed and really signed by the key it names.
 *
 *  This verifies the EVENT only. Whether the thing inside is any good is
 *  admission's business, and whether the person who signed the event is the
 *  person who signed the thing is a separate question the shell answers by
 *  comparing this pubkey against the thing's own author.ek. */
export function parseThingEvent(raw: unknown, maxBundleBytes: number): ParsedThingEvent | { error: string } {
  const ev = raw as NostrEvent
  if (!ev || typeof ev !== 'object') return { error: 'not an object' }
  if (ev.kind !== THING_KIND) return { error: `kind ${String(ev.kind)} is not a letter` }
  for (const f of ['id', 'pubkey', 'sig', 'content'] as const) {
    if (typeof ev[f] !== 'string') return { error: `missing ${f}` }
  }
  if (!Array.isArray(ev.tags) || typeof ev.created_at !== 'number') return { error: 'malformed' }
  if (!/^[0-9a-f]{64}$/.test(ev.pubkey)) return { error: 'bad pubkey' }

  // The id is a hash of the content, so a mismatch means the event was edited
  // in flight -- check it before spending a signature verification on it.
  if (eventId(ev) !== ev.id) return { error: 'id does not match the event' }
  try {
    if (!schnorr.verify(fromHex(ev.sig), fromHex(ev.id), fromHex(ev.pubkey))) return { error: 'bad signature' }
  } catch {
    return { error: 'bad signature' }
  }

  const envelopeHash = firstTag(ev, TAG.hash)
  if (!envelopeHash || !/^[0-9a-f]{64}$/.test(envelopeHash)) return { error: 'no usable letter hash' }

  let bundle: Uint8Array | null = null
  if (ev.content.length > 0) {
    // Bound BEFORE decoding: base64 is 4/3, so the encoded length already tells
    // us whether the bytes could possibly be within the cap.
    if ((ev.content.length * 3) / 4 > maxBundleBytes) return { error: 'inline bundle over the size cap' }
    try {
      bundle = unbase64(ev.content)
    } catch {
      return { error: 'content is not base64' }
    }
  }
  return {
    event: ev,
    envelopeHash,
    type: firstTag(ev, TAG.type) ?? '',
    group: firstTag(ev, TAG.group),
    replyTo: firstTag(ev, TAG.reply),
    fetchLocator: firstTag(ev, TAG.fetch),
    bundle
  }
}

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function unbase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
