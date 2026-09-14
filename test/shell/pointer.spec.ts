import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, type ShellHandle } from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'
import { buildThingEvent } from '../../src/shell/nostr/event.js'

// ── Following a pointer ──────────────────────────────────────────────────────
// A bundle over the inline cap travels as a POINTER: an event carrying the
// thing's hash and a locator instead of its bytes.
//
// Following one is the only fetch in the shell a STRANGER can propose. Every
// other one starts with a human pasting a locator. So the property this whole
// file exists to hold is: **nothing is fetched until somebody presses Fetch**,
// and what comes back must be the thing that was advertised.
//
// Hermetic: the relay runs in this process, and so does the server the pointers
// point at.

const NAMETAG = readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html'))

let shell: ShellHandle
let relay: TestRelay
let server: Server
let base = ''
let routes = new Map<string, Buffer>()
/** Paths the server was actually asked for — how a test proves nothing was
 *  fetched, rather than proving only that nothing was kept. */
let hits: string[] = []

test.beforeEach(async () => {
  test.setTimeout(60_000)
  routes = new Map()
  hits = []
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    hits.push(path)
    const body = routes.get(path)
    if (!body) {
      res.writeHead(404).end('no route')
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) })
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  relay = await startRelay()
  shell = await launchShell()
  await shell.addRelay(relay.url)
  await expect
    .poll(async () => (await shell.relays()).relays.filter((r) => r.state === 'open').length, { timeout: 15_000 })
    .toBe(1)
})

test.afterEach(async () => {
  await shell?.close()
  await relay?.close()
  await new Promise<void>((r) => server.close(() => r()))
})

/** A signed thing by some other key, plus its bytes. */
async function thing(type = 'nametag'): Promise<{ hash: string; bytes: Buffer }> {
  const priv = secp256k1.utils.randomSecretKey()
  const bundle = await buildBundle(ethSigner(priv), { type, program: new Uint8Array(NAMETAG) })
  const parsed = await shell.admit(bundle)
  expect(parsed.status, String(parsed.reason ?? '')).toBe('valid')
  return { hash: parsed.envelopeHash as string, bytes: Buffer.from(bundle) }
}

/** Advertise a pointer on the relay, as a stranger would. */
async function advertise(opts: {
  hash: string
  locator: string
  type?: string
  group?: string
}): Promise<void> {
  relay.broadcast(
    await buildThingEvent(
      {
        envelopeHash: opts.hash,
        type: opts.type ?? 'nametag',
        fetchLocator: opts.locator,
        ...(opts.group ? { group: opts.group } : {}),
        createdAt: Math.floor(Date.now() / 1000)
      },
      schnorr.utils.randomSecretKey()
    )
  )
}

const offerFor = async (hash: string): Promise<Record<string, unknown> | undefined> =>
  (await shell.offers()).find((o) => o.envelopeHash === hash)

test('a pointer becomes an offer and fetches NOTHING until asked', async () => {
  const t = await thing()
  routes.set('/big.thing', t.bytes)
  await advertise({ hash: t.hash, locator: `${base}/big.thing` })

  await expect.poll(async () => (await shell.offers()).length, { timeout: 15_000 }).toBe(1)

  // The property whose failure is worst, asserted on the SERVER: not "nothing
  // was kept" but "nothing was asked for". Nobody was contacted at all.
  await new Promise((r) => setTimeout(r, 1_500))
  expect(hits, 'the pointer was not followed').toEqual([])
  expect(await shell.feed({ limit: 200 })).toEqual([])

  const offer = (await offerFor(t.hash))!
  expect(offer.state).toBe('offered')
  expect(offer.locator).toBe(`${base}/big.thing`)
  // An offer names who told you, and deliberately names no author: the event
  // carries a nostr key, and who signed the thing is in an envelope nobody has.
  expect(offer.poster).toMatch(/^[0-9a-f]{64}$/)
  expect(offer).not.toHaveProperty('authorKey')

  // The press.
  const fetched = await shell.fetchOffer(t.hash)
  expect(fetched.status, String(fetched.error ?? fetched.reason ?? '')).toBe('valid')
  expect(hits).toEqual(['/big.thing'])
  expect((await shell.feed({ limit: 200 })).map((r) => r.envelopeHash)).toEqual([t.hash])
  // Held now, so there is nothing left to offer.
  expect(await shell.offers()).toEqual([])
})

test('bytes that are a different thing are refused, and NOTHING is kept', async () => {
  // The server is honest about serving something, and dishonest about which.
  // Both things are validly signed — that is the point: admission alone cannot
  // catch this, because nothing is wrong with the bundle that arrived.
  const wanted = await thing()
  const other = await thing('card')
  routes.set('/swap.thing', other.bytes)
  await advertise({ hash: wanted.hash, locator: `${base}/swap.thing` })
  await expect.poll(async () => (await shell.offers()).length, { timeout: 15_000 }).toBe(1)

  const r = await shell.fetchOffer(wanted.hash)
  expect(r.status).toBe('invalid')
  expect(String(r.reason)).toMatch(/different thing/i)

  // Neither the thing asked for nor the one that turned up.
  const feed = await shell.feed({ limit: 200 })
  expect(feed.map((x) => x.envelopeHash)).not.toContain(other.hash)
  expect(feed.map((x) => x.envelopeHash)).not.toContain(wanted.hash)
  expect(feed).toEqual([])

  // The offer survives, saying why, so it can be retried against a better
  // source rather than vanishing.
  const offer = (await offerFor(wanted.hash))!
  expect(offer.state).toBe('failed')
  expect(String(offer.reason)).toMatch(/different thing/i)
})

test('a file: locator from a relay is refused without touching the path', async () => {
  // A relay naming a local path would make the shell read a file a stranger
  // chose. Admission would refuse whatever came back — but the read happened,
  // and whether it succeeded is observable.
  const t = await thing()
  await advertise({ hash: t.hash, locator: '/etc/passwd' })
  await advertise({ hash: t.hash, locator: 'file:/etc/passwd' })
  await new Promise((r) => setTimeout(r, 1_500))
  expect(await shell.offers(), 'never even recorded as an offer').toEqual([])

  // And if one somehow reached the press, it is refused there too.
  expect((await shell.fetchOffer(t.hash)).error).toMatch(/nothing is offering that/i)
})

test('an offer for something already held is never recorded', async () => {
  const t = await thing()
  expect((await shell.ingest(t.bytes)).status).toBe('valid')
  routes.set('/have.thing', t.bytes)
  await advertise({ hash: t.hash, locator: `${base}/have.thing` })
  await new Promise((r) => setTimeout(r, 1_500))
  expect(await shell.offers()).toEqual([])
  expect(hits).toEqual([])
})

test('a thing arriving by another route clears its offer', async () => {
  const t = await thing()
  routes.set('/slow.thing', t.bytes)
  await advertise({ hash: t.hash, locator: `${base}/slow.thing` })
  await expect.poll(async () => (await shell.offers()).length, { timeout: 15_000 }).toBe(1)

  // Somebody hands you the bytes directly while the offer is sitting there.
  expect((await shell.ingest(t.bytes)).status).toBe('valid')
  expect(await shell.offers(), 'holding it settles the offer, whatever route it took').toEqual([])
  expect(hits, 'and the offered source was never contacted').toEqual([])
})

test('a flood of pointers stays bounded, newest kept', async () => {
  // A relay can advertise forever. Offers are the one place that becomes disk,
  // so the newest win and the rest are dropped. Run against a deliberately
  // tiny cap, because a test that stays under the real one proves nothing.
  const small = await launchShell({ extraEnv: { SHELL_MAX_OFFERS: '20' } })
  try {
    await small.addRelay(relay.url)
    await expect
      .poll(async () => (await small.relays()).relays.filter((r) => r.state === 'open').length, { timeout: 15_000 })
      .toBe(1)

    const hashes: string[] = []
    for (let i = 0; i < 30; i++) {
      const h = i.toString(16).padStart(64, '0')
      hashes.push(h)
      await advertise({ hash: h, locator: `${base}/flood-${i}.thing` })
      // The cap is on arrival order, so they must not all share a timestamp.
      await new Promise((r) => setTimeout(r, 5))
    }

    await expect.poll(async () => (await small.offers()).length, { timeout: 20_000 }).toBe(20)
    const held = new Set((await small.offers()).map((o) => o.envelopeHash))
    expect(held.has(hashes[29]!), 'the newest survived').toBe(true)
    expect(held.has(hashes[0]!), 'the oldest was evicted').toBe(false)
    expect(hits, 'a flood of offers is still a flood of nothing fetched').toEqual([])
  } finally {
    await small.close()
  }
})

test('a magnet pointer is offered too — the case pointers exist for', async () => {
  // The live scenario caught this and the HTTP tests could not: a magnet is
  // not a transport locator, it is a background transfer, so asking the
  // transport service whether it supports one answers no. Anything over the
  // inline cap travels by magnet, so getting this wrong made pointers
  // unfollowable in exactly the case they exist for.
  const t = await thing()
  const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=big.thing`
  await advertise({ hash: t.hash, locator: magnet })

  await expect.poll(async () => (await shell.offers()).length, { timeout: 15_000 }).toBe(1)
  const offer = (await offerFor(t.hash))!
  expect(offer.locator).toBe(magnet)
  expect(offer.state).toBe('offered')
  // Still nothing fetched: a magnet offer is as inert as any other until asked.
  expect(await shell.transfers()).toMatchObject({ downloads: [] })
})

test('an offered post ranks in its forum, and says it is not here', async () => {
  // Votes point at a HASH whether or not you hold the thing, so an offer can
  // be ranked exactly like a post — which is what stops a large post sitting
  // invisible at the bottom of a forum forever.
  const founder = secp256k1.utils.randomSecretKey()
  const forumBundle = await buildBundle(ethSigner(founder), {
    type: 'group',
    program: new Uint8Array(NAMETAG),
    args: new Map<string, unknown>([['name', 'Tools'], ['members', []]])
  })
  const forum = (await shell.ingest(forumBundle)).envelopeHash as string

  const t = await thing('article')
  routes.set('/post.thing', t.bytes)
  await advertise({ hash: t.hash, locator: `${base}/post.thing`, type: 'article', group: forum })
  await expect.poll(async () => (await shell.offers()).length, { timeout: 15_000 }).toBe(1)

  const listing = await shell.forumListing(forum)
  const row = listing.rows.find((r) => r.envelopeHash === t.hash)!
  expect(row, 'the forum shows it even though it is not here').toBeTruthy()
  expect(row.offered).toBe(true)
  expect(row.authorKey, 'and claims no author, because nobody has read the envelope').toBe('')
  expect(hits).toEqual([])
})
