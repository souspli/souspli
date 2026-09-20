// The relay itself: one Durable Object holding every socket and every event.
//
// Sockets use the hibernation API, so the object is evicted from memory between
// messages and costs nothing while people are merely connected. That means NO
// state may live in a field: a subscription is kept in the socket's own
// attachment, and everything else is in the object's SQLite storage.
import { DurableObject } from 'cloudflare:workers'
import type { Env } from './index'
import { matches, parseFilter, policyError, shapeError, verifyEvent, type Filter, type NostrEvent, type Policy } from './nostr'

const MAX_SUBS = 4
const MAX_FILTERS = 4
const MAX_FILTER_JSON = 400 // a socket attachment holds 2 KB in all
const MAX_MESSAGE_BYTES = 64 * 1024
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000
const MAX_SCAN = 20_000

interface Attachment {
  /** Hash of the address, for rate limiting only. Never stored with an event. */
  who: string
  subs: Record<string, Filter[]>
}

const hourNow = (): number => Math.floor(Date.now() / 3_600_000)

async function digest(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(d.subarray(0, 12), (x) => x.toString(16).padStart(2, '0')).join('')
}

export class Relay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         TEXT PRIMARY KEY,
        pubkey     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        raw        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_by_time ON events (created_at);
      -- Posts per key (a pubkey, or a hashed address) per hour. Rows older than
      -- the previous hour are deleted as new ones are written.
      CREATE TABLE IF NOT EXISTS rate (
        key  TEXT NOT NULL,
        hour INTEGER NOT NULL,
        n    INTEGER NOT NULL,
        PRIMARY KEY (key, hour)
      );
    `)
  }

  private policy(): Policy {
    return {
      maxContentBytes: Number(this.env.MAX_CONTENT_BYTES) || 45056,
      blockedPubkeys: new Set(this.env.BLOCKED_PUBKEYS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
      maxFutureSeconds: 3600
    }
  }

  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    // The address is needed to stop one machine flooding the room, and for
    // nothing else. It is hashed with the hour, so what is kept cannot be
    // joined to anything after that hour, and it is never written next to an
    // event: the relay does not record who posted from where.
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const att: Attachment = { who: await digest(`${ip}|${hourNow()}`), subs: {} }
    server.serializeAttachment(att)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return this.notice(ws, 'message too large or not text')
    let frame: unknown
    try {
      frame = JSON.parse(message)
    } catch {
      return this.notice(ws, 'not JSON')
    }
    if (!Array.isArray(frame) || typeof frame[0] !== 'string') return this.notice(ws, 'not a NIP-01 message')
    if (frame[0] === 'EVENT') return this.onEvent(ws, frame[1])
    if (frame[0] === 'REQ') return this.onReq(ws, frame[1], frame.slice(2))
    if (frame[0] === 'CLOSE') return this.onClose(ws, frame[1])
    this.notice(ws, `unsupported: ${frame[0].slice(0, 20)}`)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye')
    } catch {
      /* already closed */
    }
  }

  // ── EVENT ──────────────────────────────────────────────────────────────────

  private onEvent(ws: WebSocket, raw: unknown): void {
    const id = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id.slice(0, 64) : ''
    const refuse = (why: string): void => this.send(ws, ['OK', id, false, why])

    // Cheapest first: shape, then policy, then the rate limit, and only then
    // the hashing and the signature -- so junk costs as little as possible.
    const shape = shapeError(raw)
    if (shape) return refuse(shape)
    const ev = raw as NostrEvent
    const policy = policyError(ev, this.policy(), Math.floor(Date.now() / 1000))
    if (policy) return refuse(policy)

    const sql = this.ctx.storage.sql
    if (sql.exec('SELECT 1 FROM events WHERE id = ?', ev.id).toArray().length > 0) {
      return this.send(ws, ['OK', ev.id, true, 'duplicate: already have this event'])
    }
    const att = ws.deserializeAttachment() as Attachment
    const hour = hourNow()
    const over = (key: string, max: number): boolean => {
      const row = sql.exec('SELECT n FROM rate WHERE key = ? AND hour = ?', key, hour).toArray()[0] as { n: number } | undefined
      return (row?.n ?? 0) >= max
    }
    if (over(`k:${ev.pubkey}`, Number(this.env.EVENTS_PER_PUBKEY_PER_HOUR) || 60)) return refuse('rate-limited: too many posts from this key this hour')
    if (over(`a:${att.who}`, Number(this.env.EVENTS_PER_IP_PER_HOUR) || 120)) return refuse('rate-limited: too many posts from this address this hour')

    if (!verifyEvent(ev)) return refuse('invalid: id or signature does not verify')

    // Only the seven NIP-01 fields are kept -- anything else a client tacked on
    // is not covered by the signature and is not ours to pass along. (Field
    // order does not matter: the id is over a canonical array, not this JSON.)
    const clean: NostrEvent = { id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig }
    sql.exec('INSERT OR IGNORE INTO events (id, pubkey, created_at, raw) VALUES (?,?,?,?)', ev.id, ev.pubkey, ev.created_at, JSON.stringify(clean))
    for (const key of [`k:${ev.pubkey}`, `a:${att.who}`]) {
      sql.exec('INSERT INTO rate (key, hour, n) VALUES (?,?,1) ON CONFLICT (key, hour) DO UPDATE SET n = n + 1', key, hour)
    }
    sql.exec('DELETE FROM rate WHERE hour < ?', hour - 1)
    // Retention: the newest MAX_EVENTS. A letter lives in its readers'
    // libraries; the relay is how it gets there, not where it is kept.
    const max = Number(this.env.MAX_EVENTS) || 50_000
    sql.exec(
      'DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at DESC, id LIMIT -1 OFFSET ?)',
      max
    )

    this.send(ws, ['OK', ev.id, true, ''])
    for (const other of this.ctx.getWebSockets()) {
      const subs = (other.deserializeAttachment() as Attachment | null)?.subs ?? {}
      for (const [subId, filters] of Object.entries(subs)) {
        if (filters.some((f) => matches(clean, f))) this.send(other, ['EVENT', subId, clean])
      }
    }
  }

  // ── REQ / CLOSE ────────────────────────────────────────────────────────────

  private onReq(ws: WebSocket, subId: unknown, rawFilters: unknown[]): void {
    if (typeof subId !== 'string' || subId.length === 0 || subId.length > 64) return this.notice(ws, 'bad subscription id')
    const closed = (why: string): void => this.send(ws, ['CLOSED', subId, why])
    if (rawFilters.length === 0 || rawFilters.length > MAX_FILTERS) return closed(`error: between 1 and ${MAX_FILTERS} filters`)
    const filters: Filter[] = []
    for (const raw of rawFilters) {
      const f = parseFilter(raw)
      if (!f) return closed('error: a filter is not an object')
      if (JSON.stringify(f).length > MAX_FILTER_JSON) return closed('error: filter too large')
      filters.push(f)
    }
    const att = ws.deserializeAttachment() as Attachment
    if (!(subId in att.subs) && Object.keys(att.subs).length >= MAX_SUBS) return closed(`error: at most ${MAX_SUBS} subscriptions`)
    att.subs[subId] = filters
    ws.serializeAttachment(att)

    // Stored events: the newest `limit` that match, sent OLDEST FIRST. A reader
    // that follows a cursor moves it as it goes; newest-first would put the
    // cursor past everything older the moment the first event landed, and an
    // interrupted catch-up would then never see the rest.
    const limit = Math.min(Math.max(...filters.map((f) => f.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
    const since = Math.min(...filters.map((f) => f.since ?? 0))
    const out: NostrEvent[] = []
    let scanned = 0
    for (const row of this.ctx.storage.sql.exec('SELECT raw FROM events WHERE created_at >= ? ORDER BY created_at DESC, id', since)) {
      if (++scanned > MAX_SCAN || out.length >= limit) break
      const ev = JSON.parse(row.raw as string) as NostrEvent
      if (filters.some((f) => matches(ev, f))) out.push(ev)
    }
    for (const ev of out.reverse()) this.send(ws, ['EVENT', subId, ev])
    this.send(ws, ['EOSE', subId])
  }

  private onClose(ws: WebSocket, subId: unknown): void {
    if (typeof subId !== 'string') return
    const att = ws.deserializeAttachment() as Attachment
    delete att.subs[subId]
    ws.serializeAttachment(att)
  }

  private notice(ws: WebSocket, text: string): void {
    this.send(ws, ['NOTICE', text])
  }

  private send(ws: WebSocket, frame: unknown[]): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      /* the socket went away; nothing to tell it */
    }
  }
}
