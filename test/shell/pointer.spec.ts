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
  title?: string
}): Promise<void> {
  relay.broadcast(
    await buildThingEvent(
      {
        envelopeHash: opts.hash,
        type: opts.type ?? 'nametag',
        fetchLocator: opts.locator,
        ...(opts.group ? { group: opts.group } : {}),
        ...(opts.title ? { title: opts.title } : {}),
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
  expect(String(r.reason)).toMatch(/different letter/i)

  // Neither the thing asked for nor the one that turned up.
  const feed = await shell.feed({ limit: 200 })
  expect(feed.map((x) => x.envelopeHash)).not.toContain(other.hash)
  expect(feed.map((x) => x.envelopeHash)).not.toContain(wanted.hash)
  expect(feed).toEqual([])

  // The offer survives, saying why, so it can be retried against a better
  // source rather than vanishing.
  const offer = (await offerFor(wanted.hash))!
  expect(offer.state).toBe('failed')
  expect(String(offer.reason)).toMatch(/different letter/i)
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

    // Wait for the LAST one, not for the count: the count is 20 from the
    // twentieth arrival on, while ten more are still on their way.
    await expect
      .poll(async () => (await small.offers()).some((o) => o.envelopeHash === hashes[29]), { timeout: 20_000 })
      .toBe(true)
    const offers = await small.offers()
    expect(offers.length).toBe(20)
    const held = new Set(offers.map((o) => o.envelopeHash))
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

// ── The row is where a fetch is watched ──────────────────────────────────────
// Fetch used to open the Transfers window over the list. A letter is small and
// lands before the window can be read, and the window then had to be closed
// before the next row could be pressed. So the row itself shows the fetch, and
// what arrives takes the row's place.

async function chromeEval<T>(js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js) as Promise<T>
}
const row = (hash: string): string => `document.querySelector('[data-testid=offer-item][data-envelope-hash="${hash}"]')`

test('an offer row says who posted it and what Fetch contacts, not a raw locator', async () => {
  const t = await thing()
  const magnet = `magnet:?xt=urn:btih:${'c'.repeat(40)}&dn=big.thing&tr=${encodeURIComponent('udp://tracker.example:6969/announce')}&ws=${encodeURIComponent('https://seed.example/big.thing')}`
  await advertise({ hash: t.hash, locator: magnet })
  await expect.poll(() => chromeEval<boolean>(`!!${row(t.hash)}`), { timeout: 15_000 }).toBe(true)

  const text = await chromeEval<string>(`${row(t.hash)}.textContent`)
  expect(text).toMatch(/posted by/i)
  expect(text).toMatch(/BitTorrent · tracker\.example, seed\.example/)
  expect(text, 'the magnet itself is not the row').not.toMatch(/btih|magnet:/)
  // Still there for whoever wants it: the whole locator, before the press.
  expect(await chromeEval<string>(`${row(t.hash)}.title`)).toContain(magnet)
})

test('pressing Fetch opens no window; what arrives takes the row’s place', async () => {
  const t = await thing()
  routes.set('/big.thing', t.bytes)
  await advertise({ hash: t.hash, locator: `${base}/big.thing` })
  await expect.poll(() => chromeEval<boolean>(`!!${row(t.hash)}`), { timeout: 15_000 }).toBe(true)

  await chromeEval(`${row(t.hash)}.querySelector('[data-testid=offer-fetch]').click()`)
  const arrived = `document.querySelector('[data-testid=offer-arrived][data-envelope-hash="${t.hash}"]')`
  await expect.poll(() => chromeEval<boolean>(`!!${arrived}`), { timeout: 15_000 }).toBe(true)
  expect(await chromeEval<boolean>(`!!document.querySelector('[data-testid=transfers-modal]')`)).toBe(false)
  expect(await chromeEval<boolean>(`!!${row(t.hash)}`), 'no longer an offer').toBe(false)

  // Opening it spends the marker: from here it is a feed row like any other.
  await chromeEval(`${arrived}.click()`)
  await expect.poll(() => chromeEval<boolean>(`!!${arrived}`), { timeout: 15_000 }).toBe(false)
  expect((await shell.feed({ limit: 200 })).map((r) => r.envelopeHash)).toEqual([t.hash])
})

test('a magnet fetch is watched in its row, and cancelling gives the offer back', async () => {
  const t = await thing()
  await advertise({ hash: t.hash, locator: `magnet:?xt=urn:btih:${'d'.repeat(40)}&dn=big.thing` })
  await expect.poll(() => chromeEval<boolean>(`!!${row(t.hash)}`), { timeout: 15_000 }).toBe(true)

  await chromeEval(`${row(t.hash)}.querySelector('[data-testid=offer-fetch]').click()`)
  await expect.poll(() => chromeEval<string | null>(`${row(t.hash)}?.getAttribute('data-transfer-id') ?? null`), { timeout: 15_000 }).toBeTruthy()
  expect(await chromeEval<boolean>(`!!document.querySelector('[data-testid=transfers-modal]')`), 'no window over the list').toBe(false)
  const id = (await chromeEval<string>(`${row(t.hash)}.getAttribute('data-transfer-id')`))!
  // Offline there is no swarm: the row says it is looking, in its own words.
  await expect
    .poll(() => chromeEval<string>(`${row(t.hash)}.querySelector('[data-testid=offer-status]').textContent`), { timeout: 15_000 })
    .toMatch(/looking for peers|starting/i)

  // Progress cannot happen hermetically, so it is pushed in, as in transfers.spec.
  await chromeEval(`window.__shellChrome.paintTransfers({
    downloads: [{
      id: '${id}', magnet: '', infoHash: '${'d'.repeat(40)}', name: 'big.thing', state: 'downloading',
      bytes: 80000, downloaded: 32000, progress: 0.4, downloadSpeed: 16000, peersConnected: 1,
      peersDiscovered: 1, silentSources: [], error: null, startedAt: Date.now()
    }],
    sharing: []
  })`)
  expect(await chromeEval<string>(`${row(t.hash)}.getAttribute('data-percent')`)).toBe('40')
  expect(await chromeEval<string>(`${row(t.hash)}.querySelector('[data-testid=offer-status]').textContent`)).toMatch(/40% of 78 KB/)

  // The same button is Cancel while it runs.
  expect(await chromeEval<string>(`${row(t.hash)}.querySelector('[data-testid=offer-fetch]').textContent`)).toBe('Cancel')
  await chromeEval(`${row(t.hash)}.querySelector('[data-testid=offer-fetch]').click()`)
  await expect.poll(async () => (await offerFor(t.hash))?.state, { timeout: 15_000 }).toBe('offered')
  expect(await shell.transfers()).toMatchObject({ downloads: [] })
  await expect
    .poll(() => chromeEval<string>(`${row(t.hash)}.querySelector('[data-testid=offer-fetch]').textContent`), { timeout: 15_000 })
    .toBe('Fetch')
})

test('a pointer’s title is shown as the poster’s claim, sanitized, and gives way to the letter’s own', async () => {
  const t = await thing()
  routes.set('/big.thing', t.bytes)
  // A check mark is the chrome's word for VERIFIED, and a bidi override can
  // reorder a row: neither survives, exactly as in a held letter's title.
  await advertise({ hash: t.hash, locator: `${base}/big.thing`, title: '✓ verified:‮ New York bans AI toys\nsecond line' })
  await expect.poll(() => chromeEval<boolean>(`!!${row(t.hash)}`), { timeout: 15_000 }).toBe(true)

  expect((await offerFor(t.hash))!.title).toBe('verified: New York bans AI toys')
  const shown = `${row(t.hash)}.querySelector('[data-testid=offer-title]')`
  expect(await chromeEval<string>(`${shown}.textContent`)).toBe('verified: New York bans AI toys')
  expect(await chromeEval<string>(`${shown}.title`)).toMatch(/whoever posted this says/i)
  expect(hits, 'a title fetched nothing').toEqual([])

  // An absurdly long tag is ignored whole; the offer still stands, untitled.
  const u = await thing()
  await advertise({ hash: u.hash, locator: `${base}/u.thing`, title: 'x'.repeat(513) })
  await expect.poll(async () => (await offerFor(u.hash))?.state, { timeout: 15_000 }).toBe('offered')
  expect((await offerFor(u.hash))!.title).toBeNull()

  // Fetched, the claim is gone with the offer: the row is the letter's own.
  await shell.fetchOffer(t.hash)
  await expect.poll(async () => (await shell.feed({ limit: 200 })).length, { timeout: 15_000 }).toBe(1)
  expect(await offerFor(t.hash)).toBeUndefined()
})

test('a backlog folds to the newest few, and Fetch N presses a batch', async () => {
  const things: { hash: string; bytes: Buffer }[] = []
  for (let i = 0; i < 8; i++) {
    const t = await thing()
    things.push(t)
    routes.set(`/t${i}.thing`, t.bytes)
    await advertise({ hash: t.hash, locator: `${base}/t${i}.thing` })
  }
  await expect.poll(async () => (await shell.offers()).length, { timeout: 15_000 }).toBe(8)
  const count = (testid: string): Promise<number> => chromeEval<number>(`document.querySelectorAll('[data-testid=${testid}]').length`)

  // Five shown, the rest behind a button that says how many.
  await expect.poll(() => count('offer-item'), { timeout: 15_000 }).toBe(5)
  expect(await chromeEval<string>(`document.querySelector('[data-testid=feed-offers-title]').textContent`)).toBe('Offered · 8')
  expect(await chromeEval<string>(`document.querySelector('[data-testid=offers-more]').textContent`)).toBe('Show 3 more')
  await chromeEval(`document.querySelector('[data-testid=offers-more]').click()`)
  await expect.poll(() => count('offer-item'), { timeout: 15_000 }).toBe(8)
  await chromeEval(`document.querySelector('[data-testid=offers-more]').click()`)
  await expect.poll(() => count('offer-item'), { timeout: 15_000 }).toBe(5)
  expect(hits, 'folding and unfolding fetched nothing').toEqual([])

  // The batch press: all eight (fewer than a batch), each landing as an
  // arrived row -- shown even though the list is folded.
  expect(await chromeEval<string>(`document.querySelector('[data-testid=offers-fetch-many]').textContent`)).toBe('Fetch 8')
  await chromeEval(`document.querySelector('[data-testid=offers-fetch-many]').click()`)
  await expect.poll(async () => (await shell.feed({ limit: 200 })).length, { timeout: 30_000 }).toBe(8)
  await expect.poll(() => count('offer-arrived'), { timeout: 15_000 }).toBe(8)
  expect(await count('offer-item')).toBe(0)
  expect(await shell.offers()).toEqual([])
  expect(hits.slice().sort()).toEqual(things.map((_, i) => `/t${i}.thing`))
})

test('a magnet that names no usable infohash is not an offer', async () => {
  // It could never download -- startTransfer refuses it -- so recording it
  // would only put a dead row in front of a person, or, for a subscribed
  // author, spend the hourly allowance on a transfer that cannot start.
  const t = await thing()
  for (const locator of ['magnet:?dn=big.thing', 'magnet:?xt=urn:btih:&dn=x', `magnet:?xt=urn:btih:${'a'.repeat(39)}`, 'magnet:?xt=urn:btih:zz']) {
    await advertise({ hash: t.hash, locator })
  }
  // A good one after them, so their absence is not just slowness.
  const good = await thing()
  await advertise({ hash: good.hash, locator: `magnet:?xt=urn:btih:${'b'.repeat(40)}&dn=big.thing` })
  await expect.poll(async () => (await shell.offers()).map((o) => o.envelopeHash), { timeout: 15_000 }).toEqual([good.hash])
  // base32 is a v1 infohash too.
  const b32 = await thing()
  await advertise({ hash: b32.hash, locator: `magnet:?xt=urn:btih:${'A'.repeat(32)}` })
  await expect.poll(async () => (await shell.offers()).some((o) => o.envelopeHash === b32.hash), { timeout: 15_000 }).toBe(true)
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
