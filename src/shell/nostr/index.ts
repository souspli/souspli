import { parseThingEvent, buildThingEvent, THING_KIND, MAX_INLINE_BUNDLE, TAG, type NostrEvent, type ParsedThingEvent } from './event.js'

// ── Relays ───────────────────────────────────────────────────────────────────
// One long-lived connection per relay, subscriptions on top — the shape the
// torrent service already uses, for the same reason: the useful thing is a
// stream that stays open, not a request that resolves.
//
// A relay is a STRANGER. It can send anything, at any rate, forever. So every
// arrival is parsed defensively, bounded, and handed to admission, which is the
// only thing here that decides whether a thing is real.

export { buildThingEvent, parseThingEvent, THING_KIND, MAX_INLINE_BUNDLE, TAG }
export type { NostrEvent, ParsedThingEvent }

export interface RelayStatus {
  url: string
  state: 'connecting' | 'open' | 'closed' | 'failed'
  error: string | null
  /** Events accepted since this connection opened, and events refused. */
  received: number
  refused: number
}

export interface Subscription {
  id: string
  /** Tag filters, e.g. { 'thing-group': [path] }. Empty means all things. */
  tags: Record<string, string[]>
  since: number
}

/** What a relay hands us, once it has survived parsing. The caller decides what
 *  to do with it -- this layer never touches the library. */
export type OnThing = (ev: ParsedThingEvent, relayUrl: string) => void

/** How many events one relay may have handled per window before we stop
 *  reading it. A relay that floods is not malfunctioning, it is hostile, and
 *  the cost of ignoring it must be bounded rather than unbounded. */
const MAX_EVENTS_PER_WINDOW = 500
const WINDOW_MS = 10_000

interface Conn {
  url: string
  ws: WebSocket | null
  state: RelayStatus['state']
  error: string | null
  received: number
  refused: number
  windowStart: number
  windowCount: number
  /** Subscriptions to (re)send whenever this connection opens. */
  subs: Map<string, Subscription>
  closedByUs: boolean
  retry: ReturnType<typeof setTimeout> | null
}

export class NostrService {
  private readonly conns = new Map<string, Conn>()
  /** Subscriptions belong to the SERVICE, not to a connection: a relay added
   *  later must get the same interests, or "add a relay" would silently be a
   *  no-op until the next restart. */
  private readonly subs = new Map<string, Subscription>()
  private onThing: OnThing = () => undefined
  private maxBundleBytes = MAX_INLINE_BUNDLE

  setHandler(fn: OnThing): void {
    this.onThing = fn
  }

  setMaxBundleBytes(n: number): void {
    this.maxBundleBytes = n
  }

  status(): RelayStatus[] {
    return [...this.conns.values()].map((c) => ({
      url: c.url,
      state: c.state,
      error: c.error,
      received: c.received,
      refused: c.refused
    }))
  }

  /** Connect (or reuse a connection) to a relay. */
  connect(url: string): void {
    if (this.conns.has(url)) return
    const conn: Conn = {
      url,
      ws: null,
      state: 'connecting',
      error: null,
      received: 0,
      refused: 0,
      windowStart: Date.now(),
      windowCount: 0,
      subs: new Map(this.subs),
      closedByUs: false,
      retry: null
    }
    this.conns.set(url, conn)
    this.open(conn)
  }

  disconnect(url: string): boolean {
    const c = this.conns.get(url)
    if (!c) return false
    c.closedByUs = true
    if (c.retry) clearTimeout(c.retry)
    try {
      c.ws?.close()
    } catch {
      /* already gone */
    }
    this.conns.delete(url)
    return true
  }

  /** Ask every connected relay for things matching this subscription. */
  subscribe(sub: Subscription): void {
    this.subs.set(sub.id, sub)
    for (const c of this.conns.values()) {
      c.subs.set(sub.id, sub)
      if (c.state === 'open') this.sendReq(c, sub)
    }
  }

  unsubscribe(id: string): void {
    this.subs.delete(id)
    for (const c of this.conns.values()) {
      if (!c.subs.delete(id)) continue
      try {
        c.ws?.send(JSON.stringify(['CLOSE', id]))
      } catch {
        /* the connection will be rebuilt without it */
      }
    }
  }

  /** Publish an event to every connected relay. Returns how many took it. */
  publish(event: NostrEvent): number {
    let sent = 0
    for (const c of this.conns.values()) {
      if (c.state !== 'open' || !c.ws) continue
      try {
        c.ws.send(JSON.stringify(['EVENT', event]))
        sent++
      } catch {
        /* a relay that will not take it is not an error worth failing on */
      }
    }
    return sent
  }

  destroy(): void {
    for (const url of [...this.conns.keys()]) this.disconnect(url)
  }

  private sendReq(c: Conn, sub: Subscription): void {
    const filter: Record<string, unknown> = { kinds: [THING_KIND], since: sub.since }
    for (const [tag, values] of Object.entries(sub.tags)) filter[`#${tag}`] = values
    try {
      c.ws?.send(JSON.stringify(['REQ', sub.id, filter]))
    } catch {
      /* resent when the connection reopens */
    }
  }

  private open(c: Conn): void {
    let ws: WebSocket
    try {
      ws = new WebSocket(c.url)
    } catch (e) {
      c.state = 'failed'
      c.error = (e as Error).message
      return
    }
    c.ws = ws
    c.state = 'connecting'

    ws.addEventListener('open', () => {
      c.state = 'open'
      c.error = null
      // Re-send every subscription: a reconnect must resume, not forget.
      for (const sub of c.subs.values()) this.sendReq(c, sub)
    })
    ws.addEventListener('error', () => {
      // The event carries nothing useful; close will follow with the detail
      // that matters, which is simply that it is not open.
      c.error = 'connection error'
    })
    ws.addEventListener('close', () => {
      c.state = 'closed'
      c.ws = null
      if (c.closedByUs) return
      // Reconnect, unhurriedly. A relay that is down should cost us a socket
      // every so often, not a tight loop.
      c.retry = setTimeout(() => this.conns.has(c.url) && this.open(c), 5_000)
      c.retry.unref?.()
    })
    ws.addEventListener('message', (msg: MessageEvent) => this.onMessage(c, msg))
  }

  private onMessage(c: Conn, msg: MessageEvent): void {
    // Rate window: a flooding relay stops being read rather than being allowed
    // to spend this process's time without limit.
    const now = Date.now()
    if (now - c.windowStart > WINDOW_MS) {
      c.windowStart = now
      c.windowCount = 0
    }
    if (++c.windowCount > MAX_EVENTS_PER_WINDOW) return

    let frame: unknown
    try {
      frame = JSON.parse(typeof msg.data === 'string' ? msg.data : '')
    } catch {
      c.refused++
      return
    }
    if (!Array.isArray(frame)) return
    // NIP-01: ["EVENT", subId, event]. EOSE/NOTICE/OK carry nothing we need.
    if (frame[0] !== 'EVENT') return

    const parsed = parseThingEvent(frame[2], this.maxBundleBytes)
    if ('error' in parsed) {
      c.refused++
      return
    }
    c.received++
    this.onThing(parsed, c.url)
  }
}
