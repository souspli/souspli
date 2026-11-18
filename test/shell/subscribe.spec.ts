import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchShell, ethSigner, jsToCbor, secp256k1, schnorr, type ShellHandle } from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'
import { buildBundle as formatBuildBundle, fromHex, toHex } from '../../src/format/index.js'
import { eventId, NOSTR_ENC_SCHEME, THING_KIND, type NostrEvent } from '../../src/shell/nostr/event.js'
import { sha1 } from '@noble/hashes/legacy.js'

// ── Subscribing to an author ─────────────────────────────────────────────────
// pointer.spec.ts holds the rule: a pointer is never followed until a human
// presses Fetch. A subscription is the one exception the human makes, once,
// for ONE author -- a publisher whose letters are all too big to travel inline
// (an article's program alone is over the cap).
//
// What this file holds: only pointers posted under the relay key that author
// bound to their own public letter are fetched; only for the feeds chosen;
// what arrives must be signed by that author; anyone else's pointer still
// waits for a press; and unsubscribing puts the press back.

const NAMETAG = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html')))

let shell: ShellHandle
let relay: TestRelay
let server: Server
let base = ''
let routes = new Map<string, Buffer>()
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

interface Publisher {
  priv: Uint8Array
  /** hex eth address: the author key */
  key: string
  /** its relay (nostr) secret, bound into its letters as Author.ek */
  nostrPriv: Uint8Array
  ek: string
}

function publisher(): Publisher {
  const priv = secp256k1.utils.randomSecretKey()
  const nostrPriv = schnorr.utils.randomSecretKey()
  return { priv, key: toHex(ethSigner(priv).pubkey), nostrPriv, ek: toHex(schnorr.getPublicKey(nostrPriv)) }
}

/** A letter by `who`, binding their relay key, served at `path`. */
async function letter(who: Publisher, path: string, n: number): Promise<{ hash: string; bytes: Buffer }> {
  const tar = await formatBuildBundle(ethSigner(who.priv), {
    program: NAMETAG,
    type: 'nametag',
    args: jsToCbor({ name: `letter ${n}` }),
    created: 1_700_000_000 + n,
    enc: { e: NOSTR_ENC_SCHEME, ek: fromHex(who.ek) }
  })
  const admitted = await shell.admit(tar)
  expect(admitted.status, String(admitted.reason ?? '')).toBe('valid')
  routes.set(path, Buffer.from(tar))
  return { hash: admitted.envelopeHash as string, bytes: Buffer.from(tar) }
}

/** A pointer, posted under `nostrPriv`, optionally naming a feed. */
async function pointer(nostrPriv: Uint8Array, hash: string, locator: string, feed?: string): Promise<void> {
  const unsigned = {
    pubkey: toHex(schnorr.getPublicKey(nostrPriv)),
    created_at: Math.floor(Date.now() / 1000),
    kind: THING_KIND,
    tags: [['t', 'thing'], ['x', hash], ['thing-type', 'nametag'], ...(feed ? [['thing-feed', feed]] : []), ['thing-fetch', locator]],
    content: ''
  }
  const id = eventId(unsigned)
  const ev: NostrEvent = { ...unsigned, id, sig: toHex(await schnorr.sign(fromHex(id), nostrPriv)) }
  relay.broadcast(ev)
}

const held = async (): Promise<string[]> => (await shell.feed({ limit: 200 })).map((r) => r.envelopeHash as string)
const offerFor = async (hash: string): Promise<Record<string, unknown> | undefined> =>
  (await shell.offers()).find((o) => o.envelopeHash === hash)

/** The shell learns a publisher's relay key only from a public letter of theirs. */
async function know(who: Publisher): Promise<void> {
  const intro = await letter(who, '/intro.thing', 0)
  expect((await shell.ingest(intro.bytes)).status).toBe('valid')
}

test('a subscribed author’s pointers are fetched as they arrive; nobody else’s are', async () => {
  const pub = publisher()
  await know(pub)
  expect((await shell.subscribe('eth-eip191', pub.key, null)).ok).toBe(true)

  const a = await letter(pub, '/a.thing', 1)
  await pointer(pub.nostrPriv, a.hash, `${base}/a.thing`)
  await expect.poll(held, { timeout: 15_000 }).toContain(a.hash)
  expect(hits).toEqual(['/a.thing'])
  expect(await offerFor(a.hash), 'held, so no longer on offer').toBeUndefined()

  // A stranger's pointer, on the same relay, at the same moment: still an
  // offer, and its server never hears from us.
  const stranger = publisher()
  const s = await letter(stranger, '/s.thing', 2)
  await pointer(stranger.nostrPriv, s.hash, `${base}/s.thing`)
  await expect.poll(async () => (await offerFor(s.hash))?.state, { timeout: 15_000 }).toBe('offered')
  await new Promise((r) => setTimeout(r, 1_000))
  expect(hits).toEqual(['/a.thing'])
  expect(await held()).not.toContain(s.hash)
})

test('the subscribed key pointing at SOMEONE ELSE’S letter is refused and nothing is kept', async () => {
  const pub = publisher()
  await know(pub)
  await shell.subscribe('eth-eip191', pub.key, null)
  // Validly signed, and the hash matches what the pointer advertised -- the
  // only thing wrong is who wrote it. You subscribed to one author.
  const other = publisher()
  const o = await letter(other, '/other.thing', 3)
  await pointer(pub.nostrPriv, o.hash, `${base}/other.thing`)
  await expect.poll(async () => (await offerFor(o.hash))?.state, { timeout: 15_000 }).toBe('failed')
  expect(String((await offerFor(o.hash))?.reason)).toMatch(/not by the author you subscribed to/)
  expect(await held()).not.toContain(o.hash)
})

test('only the chosen feeds are fetched', async () => {
  const pub = publisher()
  await know(pub)
  await shell.subscribe('eth-eip191', pub.key, ['guardian'])
  const g = await letter(pub, '/g.thing', 4)
  const b = await letter(pub, '/b.thing', 5)
  const none = await letter(pub, '/n.thing', 6)
  await pointer(pub.nostrPriv, b.hash, `${base}/b.thing`, 'bbc')
  await pointer(pub.nostrPriv, none.hash, `${base}/n.thing`)
  await pointer(pub.nostrPriv, g.hash, `${base}/g.thing`, 'guardian')
  await expect.poll(held, { timeout: 15_000 }).toContain(g.hash)
  await new Promise((r) => setTimeout(r, 1_000))
  expect(hits).toEqual(['/g.thing'])
  expect((await offerFor(b.hash))?.state).toBe('offered')
  expect((await offerFor(none.hash))?.state).toBe('offered')
  const subs = await shell.subscriptions()
  expect(subs).toHaveLength(1)
  expect(subs[0]!.feedsOffered).toEqual(['bbc', 'guardian'])
})

test('subscribing catches up on what is already on offer; unsubscribing puts the press back', async () => {
  const pub = publisher()
  await know(pub)
  const early = await letter(pub, '/early.thing', 7)
  await pointer(pub.nostrPriv, early.hash, `${base}/early.thing`)
  await expect.poll(async () => (await offerFor(early.hash))?.state, { timeout: 15_000 }).toBe('offered')
  expect(hits).toEqual([])

  await shell.subscribe('eth-eip191', pub.key, null)
  await expect.poll(held, { timeout: 15_000 }).toContain(early.hash)

  expect((await shell.unsubscribe('eth-eip191', pub.key)).ok).toBe(true)
  const late = await letter(pub, '/late.thing', 8)
  await pointer(pub.nostrPriv, late.hash, `${base}/late.thing`)
  await expect.poll(async () => (await offerFor(late.hash))?.state, { timeout: 15_000 }).toBe('offered')
  await new Promise((r) => setTimeout(r, 1_000))
  expect(hits).toEqual(['/early.thing'])
})

test('there is nothing to subscribe to without a relay key the author bound, nor to yourself', async () => {
  const unbound = secp256k1.utils.randomSecretKey()
  const tar = await formatBuildBundle(ethSigner(unbound), { program: NAMETAG, type: 'nametag' })
  expect((await shell.ingest(Buffer.from(tar))).status).toBe('valid')
  expect(String((await shell.subscribe('eth-eip191', toHex(ethSigner(unbound).pubkey), null)).error)).toMatch(/names a relay key/)
  const me = (await shell.identity()).address.replace(/^0x/, '').toLowerCase()
  expect(String((await shell.subscribe('eth-eip191', me, null)).error)).toMatch(/your own key/)
  expect(String((await shell.subscribe('eth-eip191', 'zz', null)).error)).toMatch(/bad key/)
})

// ── The real thing: a magnet, as a publisher like newsread posts one ──────────
// Single file, the shell's own seed name, a BEP-19 webseed (`ws=`) and the
// .torrent itself (`xs=`), so the metadata and the bytes both come over plain
// HTTP. The shell runs with DHT, trackers and local discovery off
// (SHELL_TORRENT_OFFLINE), so this proves the path needs no swarm at all.

function bencode(v: unknown): Buffer {
  if (typeof v === 'number') return Buffer.from(`i${v}e`)
  if (typeof v === 'string') return Buffer.concat([Buffer.from(`${Buffer.byteLength(v)}:`), Buffer.from(v)])
  if (v instanceof Uint8Array) return Buffer.concat([Buffer.from(`${v.length}:`), Buffer.from(v)])
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')])
  const o = v as Record<string, unknown>
  return Buffer.concat([Buffer.from('d'), ...Object.keys(o).sort().flatMap((k) => [bencode(k), bencode(o[k])]), Buffer.from('e')])
}

function torrentFor(bytes: Buffer, name: string, webseed: string): { metainfo: Buffer; infohash: string } {
  const pieceLength = 16384
  const pieces: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += pieceLength) pieces.push(sha1(bytes.subarray(i, i + pieceLength)))
  const info = { length: bytes.length, name, 'piece length': pieceLength, pieces: Buffer.concat(pieces) }
  return { metainfo: bencode({ info, 'url-list': [webseed] }), infohash: toHex(sha1(bencode(info))) }
}

test('a subscribed magnet arrives over a webseed with no swarm, and is checked like any other', async () => {
  const pub = publisher()
  await know(pub)
  await shell.subscribe('eth-eip191', pub.key, null)
  const a = await letter(pub, '/unused', 9)
  const name = `nametag-${a.hash.slice(0, 8)}.thing`
  routes.set(`/${name}`, a.bytes)
  const t = torrentFor(a.bytes, name, `${base}/${name}`)
  routes.set(`/${name}.torrent`, t.metainfo)
  const magnet =
    `magnet:?xt=urn:btih:${t.infohash}&dn=${encodeURIComponent(name)}&xl=${a.bytes.length}` +
    `&xs=${encodeURIComponent(`${base}/${name}.torrent`)}&ws=${encodeURIComponent(`${base}/${name}`)}`
  await pointer(pub.nostrPriv, a.hash, magnet)
  await expect.poll(held, { timeout: 30_000 }).toContain(a.hash)
  expect(hits).toContain(`/${name}.torrent`)
  expect(hits).toContain(`/${name}`)
})

// ── The dialog ───────────────────────────────────────────────────────────────

async function chromeEval<T>(js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

test('People → Subscribe… records the subscription and starts a private memo saying so', async () => {
  const pub = publisher()
  await know(pub)
  // An offer naming a feed, so the dialog has a choice to show.
  const g = await letter(pub, '/g.thing', 10)
  await pointer(pub.nostrPriv, g.hash, `${base}/g.thing`, 'guardian')
  await expect.poll(async () => (await offerFor(g.hash))?.state, { timeout: 15_000 }).toBe('offered')

  await chromeEval(`window.__shellChrome.openPeople()`)
  const btn = `[data-testid=people-list] [data-author-key="${pub.key}"] [data-testid=people-subscribe]`
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('${btn}')`)).toBe(true)
  expect(await chromeEval<string>(`document.querySelector('${btn}').dataset.subscribed`)).toBe('false')
  await chromeEval(`document.querySelector('${btn}').click()`)
  await expect.poll(() => chromeEval<number>(`document.querySelectorAll('[data-testid=subscribe-feed]').length`)).toBe(1)

  // Only the guardian feed, and tell them.
  await chromeEval(`(() => { const a = document.querySelector('[data-testid=subscribe-all]'); a.checked = false; a.dispatchEvent(new Event('change')) })()`)
  await chromeEval(`(() => { const f = document.querySelector('[data-testid=subscribe-feed]'); f.checked = true; f.dispatchEvent(new Event('change')) })()`)
  await chromeEval(`document.querySelector('[data-testid=subscribe-save]').click()`)

  await expect.poll(async () => (await shell.subscriptions()).map((x) => x.feeds), { timeout: 10_000 }).toEqual([['guardian']])
  // The offer that was waiting is caught up on.
  await expect.poll(held, { timeout: 15_000 }).toContain(g.hash)
  // And a private memo to them is started as a draft whose subject is the request.
  await expect.poll(async () => (await shell.drafts()).filter((d) => d.type === 'memo').length, { timeout: 10_000 }).toBe(1)
  const draft = (await shell.drafts()).find((d) => d.type === 'memo')!
  expect((draft.args as { subject?: string }).subject).toBe('subscribe guardian')
  expect(await chromeEval<boolean>(`!!document.querySelector('[data-testid=people-modal]')`)).toBe(false)
  // Back in People, the button says so.
  await chromeEval(`window.__shellChrome.openPeople()`)
  await expect.poll(() => chromeEval<string | undefined>(`document.querySelector('${btn}')?.dataset.subscribed`)).toBe('true')
})
