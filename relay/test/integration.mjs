// Drives the REAL relay -- the Worker and its Durable Object, in workerd via
// `wrangler dev` -- over real WebSockets, the way the app does. The unit tests
// cover what an event is; this covers what the room does with one.
//
//   npm run test:integration
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'

const PORT = 8798
const URL = `ws://127.0.0.1:${PORT}`
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NOW = Math.floor(Date.now() / 1000)

function sign(priv, partial = {}) {
  const base = {
    pubkey: hex(schnorr.getPublicKey(priv)),
    created_at: NOW,
    kind: 3400,
    tags: [['t', 'thing'], ['x', hex(sha256(new TextEncoder().encode(String(Math.random()))))], ['thing-type', 'comment']],
    content: 'QUJD',
    ...partial
  }
  const id = hex(sha256(new TextEncoder().encode(JSON.stringify([0, base.pubkey, base.created_at, base.kind, base.tags, base.content]))))
  return { ...base, id, sig: hex(schnorr.sign(unhex(id), priv)) }
}

/** A socket that records every frame, with a way to wait for one. */
async function connect() {
  const ws = new WebSocket(URL)
  const frames = []
  ws.addEventListener('message', (m) => frames.push(JSON.parse(m.data)))
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('could not connect')))
  })
  const waitFor = async (pred, what) => {
    for (let i = 0; i < 100; i++) {
      const hit = frames.find(pred)
      if (hit) return hit
      await sleep(50)
    }
    throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(frames).slice(0, 400)}`)
  }
  return { ws, frames, waitFor, send: (f) => ws.send(typeof f === 'string' ? f : JSON.stringify(f)), close: () => ws.close() }
}

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok    ${name}`)
  } catch (e) {
    failures++
    console.log(`  FAIL  ${name}\n        ${e.message}`)
  }
}
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}

// A throwaway storage dir, so every run starts from an empty room.
const state = mkdtempSync(join(tmpdir(), 'souspli-relay-'))
const dev = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, '--var', 'EVENTS_PER_PUBKEY_PER_HOUR:4', '--var', 'MAX_EVENTS:6'],
  // Its own process group: wrangler starts workerd as a child, and killing only
  // the parent leaves the runtime holding the port for the next run.
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } }
)
let log = ''
dev.stdout.on('data', (d) => (log += d))
dev.stderr.on('data', (d) => (log += d))

try {
  for (let i = 0; i < 90 && !log.includes('Ready on'); i++) await sleep(500)
  if (!log.includes('Ready on')) throw new Error('wrangler dev did not start:\n' + log.slice(-1500))

  const alice = schnorr.utils.randomSecretKey()

  await check('a posted letter is acknowledged, and reaches a subscriber who asked the way the app asks', async () => {
    const reader = await connect()
    reader.send(['REQ', 'things', { kinds: [3400], since: NOW - 60, '#t': ['thing'] }])
    await reader.waitFor((f) => f[0] === 'EOSE', 'EOSE on an empty room')
    const poster = await connect()
    const ev = sign(alice)
    poster.send(['EVENT', ev])
    eq(await poster.waitFor((f) => f[0] === 'OK', 'OK'), ['OK', ev.id, true, ''], 'the acknowledgement')
    const got = await reader.waitFor((f) => f[0] === 'EVENT', 'the live event')
    eq([got[1], got[2].id, got[2].sig], ['things', ev.id, ev.sig], 'what the subscriber received')
    reader.close()
    poster.close()
  })

  await check('stored letters come back OLDEST FIRST, then EOSE -- so a cursor never skips one', async () => {
    const bob = schnorr.utils.randomSecretKey()
    const p = await connect()
    const evs = [NOW - 30, NOW - 10, NOW - 20].map((t) => sign(bob, { created_at: t }))
    for (const ev of evs) p.send(['EVENT', ev])
    for (const ev of evs) await p.waitFor((f) => f[0] === 'OK' && f[1] === ev.id && f[2] === true, 'OK')
    const r = await connect()
    r.send(['REQ', 's', { kinds: [3400], authors: [evs[0].pubkey] }])
    await r.waitFor((f) => f[0] === 'EOSE', 'EOSE')
    eq(r.frames.filter((f) => f[0] === 'EVENT').map((f) => f[2].created_at), [NOW - 30, NOW - 20, NOW - 10], 'order')
    eq(r.frames.at(-1), ['EOSE', 's'], 'EOSE comes last')
    p.close()
    r.close()
  })

  await check('it refuses what it should, and says why', async () => {
    const c = await connect()
    const k = schnorr.utils.randomSecretKey()
    const cases = [
      [sign(k, { kind: 1 }), /kind 3400\) only/],
      [{ ...sign(k), sig: 'f'.repeat(128) }, /does not verify/],
      [sign(k, { content: 'A'.repeat(50_000) }), /post a pointer/],
      [sign(k, { created_at: NOW + 7200 }), /future/],
      [sign(k, { tags: [['x', 'ab'.repeat(32)]] }), /\["t","thing"\]/]
    ]
    for (const [ev, why] of cases) {
      c.send(['EVENT', ev])
      const ok = await c.waitFor((f) => f[0] === 'OK' && f[1] === ev.id, 'a refusal')
      if (ok[2] !== false || !why.test(ok[3])) throw new Error(`expected a refusal matching ${why}, got ${JSON.stringify(ok)}`)
      c.frames.length = 0
    }
    c.send('not json')
    await c.waitFor((f) => f[0] === 'NOTICE', 'a NOTICE for garbage')
    c.close()
  })

  await check('a duplicate is acknowledged but not repeated to subscribers', async () => {
    const k = schnorr.utils.randomSecretKey()
    const ev = sign(k)
    const r = await connect()
    r.send(['REQ', 'd', { authors: [ev.pubkey] }])
    await r.waitFor((f) => f[0] === 'EOSE', 'EOSE')
    const p = await connect()
    p.send(['EVENT', ev])
    await p.waitFor((f) => f[0] === 'OK', 'first OK')
    p.frames.length = 0
    p.send(['EVENT', ev])
    const again = await p.waitFor((f) => f[0] === 'OK', 'second OK')
    if (again[2] !== true || !/duplicate/.test(again[3])) throw new Error(`expected a duplicate OK, got ${JSON.stringify(again)}`)
    await sleep(300)
    eq(r.frames.filter((f) => f[0] === 'EVENT').length, 1, 'times the subscriber heard it')
    r.close()
    p.close()
  })

  await check('one key cannot flood the room (4 an hour in this run)', async () => {
    const k = schnorr.utils.randomSecretKey()
    const c = await connect()
    const results = []
    for (let i = 0; i < 6; i++) {
      const ev = sign(k)
      c.send(['EVENT', ev])
      results.push((await c.waitFor((f) => f[0] === 'OK' && f[1] === ev.id, 'OK'))[2])
    }
    eq(results, [true, true, true, true, false, false], 'accepted / refused')
    c.close()
  })

  await check('CLOSE stops a subscription; a fifth subscription is refused', async () => {
    const k = schnorr.utils.randomSecretKey()
    const r = await connect()
    r.send(['REQ', 'a', { authors: [hex(schnorr.getPublicKey(k))] }])
    await r.waitFor((f) => f[0] === 'EOSE', 'EOSE')
    r.send(['CLOSE', 'a'])
    await sleep(150)
    const p = await connect()
    const ev = sign(k)
    p.send(['EVENT', ev])
    await p.waitFor((f) => f[0] === 'OK', 'OK')
    await sleep(300)
    eq(r.frames.filter((f) => f[0] === 'EVENT').length, 0, 'events after CLOSE')
    for (const id of ['1', '2', '3', '4', '5']) r.send(['REQ', id, { kinds: [3400], limit: 0 }])
    await r.waitFor((f) => f[0] === 'CLOSED' && f[1] === '5', 'CLOSED for the fifth')
    r.close()
    p.close()
  })

  await check('only the newest MAX_EVENTS are kept (6 in this run)', async () => {
    const r = await connect()
    r.send(['REQ', 'all', { kinds: [3400] }])
    await r.waitFor((f) => f[0] === 'EOSE', 'EOSE')
    const n = r.frames.filter((f) => f[0] === 'EVENT').length
    if (n > 6) throw new Error(`the room holds ${n} events; retention should cap it at 6`)
    r.close()
  })
} catch (e) {
  failures++
  console.log('FAIL  ' + e.message)
} finally {
  try {
    process.kill(-dev.pid, 'SIGTERM')
  } catch {
    dev.kill('SIGTERM')
  }
  await sleep(500)
  rmSync(state, { recursive: true, force: true })
}
console.log(failures === 0 ? '\nrelay integration: all passed' : `\nrelay integration: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
