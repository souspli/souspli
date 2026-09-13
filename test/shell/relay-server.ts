import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { Duplex } from 'node:stream'

// ── A nostr relay, in the test process ───────────────────────────────────────
//
// Hermetic on purpose. The whole point of #49 was that a spec which needs the
// public network is a spec that fails for reasons having nothing to do with the
// code under test. A relay is a WebSocket that speaks about five message types,
// so it is cheaper to implement one than to depend on one.
//
// It also lets a test do what a real relay never would: hand the shell a
// tampered event, an oversize one, or plain junk, and assert the shell refuses
// it without the connection dying.
//
// The framing below is RFC 6455's, minus everything a test does not need:
// text frames, continuation, ping/close. No extensions, no compression.

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export interface RelayEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

interface Sub {
  id: string
  filter: Record<string, unknown>
  socket: Duplex
}

export interface TestRelay {
  url: string
  /** Every EVENT the relay was given, in arrival order. */
  readonly received: RelayEvent[]
  /** How many sockets are open right now. */
  connections(): number
  /** Push an event at every subscriber, as if another client had posted it. */
  broadcast(ev: RelayEvent): void
  /** Push a RAW frame at every subscriber — junk, oversize, anything. */
  injectRaw(text: string): void
  close(): Promise<void>
}

function encodeFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const n = payload.length
  let header: Buffer
  if (n < 126) {
    header = Buffer.from([0x81, n])
  } else if (n <= 0xffff) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(n, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([header, payload])
}

/** Pull whole frames out of `buf`, returning the text messages and whatever
 *  bytes are left over. A partial frame is normal, not an error: TCP delivers
 *  what it delivers. */
function decodeFrames(buf: Buffer): { messages: string[]; rest: Buffer; closed: boolean } {
  const messages: string[] = []
  let fragments: Buffer[] = []
  let closed = false
  let off = 0
  for (;;) {
    if (buf.length - off < 2) break
    const b0 = buf[off]!
    const b1 = buf[off + 1]!
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let p = off + 2
    if (len === 126) {
      if (buf.length < p + 2) break
      len = buf.readUInt16BE(p)
      p += 2
    } else if (len === 127) {
      if (buf.length < p + 8) break
      len = Number(buf.readBigUInt64BE(p))
      p += 8
    }
    const maskKey = masked ? buf.subarray(p, p + 4) : null
    if (masked) p += 4
    if (buf.length < p + len) break
    const payload = Buffer.from(buf.subarray(p, p + len))
    if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ maskKey[i % 4]!
    off = p + len

    if (opcode === 0x8) {
      closed = true
      break
    }
    if (opcode === 0x9 || opcode === 0xa) continue // ping/pong: nothing to say
    fragments.push(payload)
    if (fin) {
      messages.push(Buffer.concat(fragments).toString('utf8'))
      fragments = []
    }
  }
  return { messages, rest: Buffer.from(buf.subarray(off)), closed }
}

function matches(filter: Record<string, unknown>, ev: RelayEvent): boolean {
  const kinds = filter.kinds as number[] | undefined
  if (Array.isArray(kinds) && !kinds.includes(ev.kind)) return false
  const since = filter.since as number | undefined
  if (typeof since === 'number' && ev.created_at < since) return false
  for (const [k, v] of Object.entries(filter)) {
    if (!k.startsWith('#') || !Array.isArray(v)) continue
    const name = k.slice(1)
    const present = ev.tags.some((t) => t[0] === name && v.includes(t[1] as never))
    if (!present) return false
  }
  return true
}

/** Start a relay on an ephemeral port. */
export async function startRelay(): Promise<TestRelay> {
  const received: RelayEvent[] = []
  const subs: Sub[] = []
  const sockets = new Set<Duplex>()
  const server: Server = createServer((_req, res) => {
    res.writeHead(426)
    res.end('this is a websocket relay')
  })

  const send = (socket: Duplex, frame: unknown): void => {
    try {
      socket.write(encodeFrame(JSON.stringify(frame)))
    } catch {
      /* a socket that went away is not a test failure */
    }
  }

  server.on('upgrade', (req, socket: Duplex) => {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    const accept = createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    sockets.add(socket)
    let buf: Buffer = Buffer.alloc(0)

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      const { messages, rest, closed } = decodeFrames(buf)
      buf = rest
      for (const text of messages) {
        let frame: unknown
        try {
          frame = JSON.parse(text)
        } catch {
          send(socket, ['NOTICE', 'unparseable'])
          continue
        }
        if (!Array.isArray(frame)) continue
        if (frame[0] === 'REQ') {
          const id = String(frame[1])
          const filter = (frame[2] ?? {}) as Record<string, unknown>
          subs.push({ id, filter, socket })
          for (const ev of received) if (matches(filter, ev)) send(socket, ['EVENT', id, ev])
          send(socket, ['EOSE', id])
        } else if (frame[0] === 'EVENT') {
          const ev = frame[1] as RelayEvent
          received.push(ev)
          send(socket, ['OK', ev?.id ?? '', true, ''])
          // Fan out to everyone else listening, including the poster: a relay
          // does not know or care who sent what.
          for (const sub of subs) if (matches(sub.filter, ev)) send(sub.socket, ['EVENT', sub.id, ev])
        } else if (frame[0] === 'CLOSE') {
          const id = String(frame[1])
          for (let i = subs.length - 1; i >= 0; i--) {
            if (subs[i]!.id === id && subs[i]!.socket === socket) subs.splice(i, 1)
          }
        }
      }
      if (closed) socket.end()
    })
    const drop = (): void => {
      sockets.delete(socket)
      for (let i = subs.length - 1; i >= 0; i--) if (subs[i]!.socket === socket) subs.splice(i, 1)
    }
    socket.on('close', drop)
    socket.on('error', drop)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  return {
    url: `ws://127.0.0.1:${port}`,
    received,
    connections: () => sockets.size,
    broadcast(ev) {
      received.push(ev)
      for (const sub of subs) if (matches(sub.filter, ev)) send(sub.socket, ['EVENT', sub.id, ev])
    },
    injectRaw(text) {
      for (const sub of subs) {
        try {
          sub.socket.write(encodeFrame(text))
        } catch {
          /* ignore */
        }
      }
    },
    async close() {
      for (const s of sockets) s.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

export { randomUUID }
