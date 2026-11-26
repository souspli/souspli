import { describe, it, expect } from 'vitest'
import {
  TransportService,
  TransportError,
  parseLocator,
  type FetchLimits,
  type Transport
} from '../../src/shell/transport/index.js'
import { hash, toHex } from '../../src/format/index.js'
import { trackersOf } from '../../src/shell/torrent/index.js'

// The TransportService is the fetch BOUNDARY: it dispatches by scheme, enforces
// the size cap and timeout as a backstop (a transport is not trusted to
// self-bound), and verifies content-addressed locators before admission.

class FakeTransport implements Transport {
  constructor(
    private readonly scheme: string,
    private readonly impl: (locator: string, limits: FetchLimits) => Promise<Uint8Array>
  ) {}
  supports(locator: string): boolean {
    return locator.startsWith(`${this.scheme}:`)
  }
  fetch(locator: string, limits: FetchLimits): Promise<Uint8Array> {
    return this.impl(locator, limits)
  }
}

const small: FetchLimits = { maxBytes: 1024, timeoutMs: 500 }

describe('parseLocator', () => {
  it('splits scheme and value', () => {
    expect(parseLocator('bundle:abc')).toEqual({ scheme: 'bundle', value: 'abc' })
    expect(parseLocator('magnet:?xt=urn:btih:z')).toEqual({ scheme: 'magnet', value: '?xt=urn:btih:z' })
    expect(parseLocator('nope')).toEqual({ scheme: '', value: 'nope' })
  })
})

describe('TransportService', () => {
  it('errors when no transport supports the locator', async () => {
    const svc = new TransportService(small)
    await expect(svc.fetch('unknown:x')).rejects.toThrow(TransportError)
  })

  it('content-addressed: accepts bytes that hash to the name', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const hex = toHex(hash(bytes))
    const svc = new TransportService(small).register(new FakeTransport('bundle', async () => bytes))
    expect(await svc.fetch(`bundle:${hex}`)).toEqual(bytes)
  })

  it('content-addressed: REJECTS bytes that do not hash to the name (before admission)', async () => {
    const svc = new TransportService(small).register(
      new FakeTransport('bundle', async () => new Uint8Array([9, 9, 9]))
    )
    // The locator names a different hash than the bytes produce.
    await expect(svc.fetch(`bundle:${'0'.repeat(64)}`)).rejects.toThrow(/do not match the hash/)
  })

  it('enforces the size cap (fetched bytes over maxBytes)', async () => {
    const svc = new TransportService(small).register(
      new FakeTransport('big', async () => new Uint8Array(small.maxBytes + 1))
    )
    await expect(svc.fetch('big:x')).rejects.toThrow(/exceeds maxBytes/)
  })

  it('enforces the timeout as a backstop when a transport hangs', async () => {
    const svc = new TransportService(small).register(
      new FakeTransport('slow', () => new Promise<Uint8Array>(() => {})) // never resolves
    )
    await expect(svc.fetch('slow:x')).rejects.toThrow(/timed out/)
  })

  it('propagates a transport error as-is', async () => {
    const svc = new TransportService(small).register(
      new FakeTransport('bad', async () => {
        throw new TransportError('boom')
      })
    )
    await expect(svc.fetch('bad:x')).rejects.toThrow(/boom/)
  })
})

describe('trackersOf', () => {
  const xt = `xt=urn:btih:${'a'.repeat(40)}`
  it("reads a magnet's tr= list in order, decoded and deduplicated", () => {
    const m = `magnet:?${xt}&dn=a.thing&tr=udp%3A%2F%2Ft.example%3A6969%2Fannounce&tr=http://t.example:6969/announce&TR=udp%3A%2F%2Ft.example%3A6969%2Fannounce&ws=https%3A%2F%2Fw.example%2Fa`
    expect(trackersOf(m)).toEqual(['udp://t.example:6969/announce', 'http://t.example:6969/announce'])
  })
  it('keeps only schemes a tracker speaks', () => {
    const m = `magnet:?${xt}&tr=file%3A%2F%2F%2Fetc%2Fpasswd&tr=javascript%3Aalert(1)&tr=wss%3A%2F%2Ft.example&tr=https%3A%2F%2Ft.example%2Fa&tr=udp%3A%2F%2F&tr=%E0%A4%A`
    expect(trackersOf(m)).toEqual(['wss://t.example', 'https://t.example/a'])
  })
  it('is bounded in count and length', () => {
    const many = Array.from({ length: 20 }, (_, i) => `&tr=udp%3A%2F%2Ft${i}.example%3A1`).join('')
    expect(trackersOf(`magnet:?${xt}${many}`)).toHaveLength(8)
    expect(trackersOf(`magnet:?${xt}&tr=udp://${'x'.repeat(200)}:1`)).toEqual([])
  })
  it('answers nothing for a magnet with no trackers, or for something else', () => {
    expect(trackersOf(`magnet:?${xt}`)).toEqual([])
    expect(trackersOf('https://example.com/?tr=udp://t.example:1')).toEqual([])
  })
})
