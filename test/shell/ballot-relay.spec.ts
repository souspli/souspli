import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { test, expect, launchShell, ethAddress, type ShellHandle } from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'
import { IDENTITY, ballotBundle, ballotHash } from './ballot-fixture.js'
import { deriveBallotKey } from '../../src/shell/keyring/index.js'

// ── A ballot vote through a relay ────────────────────────────────────────────
// A vote is signed by a key that names nobody. The way it travels must not
// name the voter either: it goes inline, under a key made for the one event --
// never the voter's relay key, never a pointer served from their address. That
// only works because a single-proof package is small enough to fit in an event
// (test/passport-fixtures: `ballot-c-identity-2.json` is that, and
// `ballot-c-identity.json` the same vote as six separate proofs, which is not).
//
// Hermetic: the relay runs in this process (relay-server.ts).

const FX = join(__dirname, '..', 'passport-fixtures')
const text = (path: string): string => readFileSync(join(FX, path), 'utf8')
const root = (dir: string): string => JSON.parse(text(`${dir}/pins.json`)).registryRoot
const ROOTS = [root('a'), root('b'), root('c')].join(',')

let relay: TestRelay
let voter: ShellHandle
let witness: ShellHandle
let H: string

const call = <T>(shell: ShellHandle, fn: string, ...args: unknown[]): Promise<T> =>
  shell.app.evaluate(
    async (electron, a) => (await (electron.app as unknown as { __shell: Record<string, (...x: unknown[]) => unknown> }).__shell[a.fn]!(...a.args)) as never,
    { fn, args }
  )
const chromeEval = <T>(shell: ShellHandle, js: string): Promise<T> =>
  shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
const connected = (shell: ShellHandle): Promise<void> =>
  expect.poll(async () => (await shell.relays()).relays.filter((r) => r.state === 'open').length, { timeout: 15_000 }).toBe(1)

test.beforeAll(async () => {
  test.setTimeout(180_000)
  relay = await startRelay()
  // The voter is the identity the fixtures' one-time key was derived from.
  const first = await launchShell({ extraEnv: { SHELL_NO_RELAUNCH: '1' } })
  const dir = first.userDataDir
  const r = await chromeEval<{ ok: boolean }>(first, `window.shell.accountImport({ privkeyHex: ${JSON.stringify(Buffer.from(IDENTITY).toString('hex'))} })`)
  expect(r.ok).toBe(true)
  await first.app.close()
  voter = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: dir, SHELL_PASSPORT_TEST_ROOT: ROOTS } })
  expect((await voter.identity()).address).toBe(Buffer.from(ethAddress(IDENTITY)).toString('hex'))
  // Someone else entirely, who holds the ballot and listens on the same relay.
  witness = await launchShell({ extraEnv: { SHELL_PASSPORT_TEST_ROOT: ROOTS } })
  for (const s of [voter, witness]) {
    expect((await s.ingest(await ballotBundle())).status).toBe('valid')
    await s.addRelay(relay.url)
    await connected(s)
  }
  H = await ballotHash()
})
test.afterAll(async () => {
  await voter?.close()
  await witness?.close()
  await relay?.close()
})
test.beforeEach(() => test.setTimeout(120_000))

test('a vote of six separate proofs is too large to send without pointing at the voter, and says so', async () => {
  const cast = await call<{ envelopeHash?: string; error?: string }>(voter, 'ballotCast', H, 1, text('c/ballot-c-identity.json'))
  expect(cast.error).toBeUndefined()
  const sent = await voter.postToRelays(cast.envelopeHash as string)
  expect(String(sent.error)).toContain('single-proof format')
  expect(relay.received.length).toBe(0)
})

test('a single-proof vote goes out inline, under a key that is neither the voter’s nor the vote’s', async () => {
  const cast = await call<{ envelopeHash?: string; error?: string }>(voter, 'ballotCast', H, 0, text('c/ballot-c-identity-2.json'))
  expect(cast.error).toBeUndefined()
  const sent = await voter.postToRelays(cast.envelopeHash as string)
  expect(sent).toMatchObject({ inline: true, anonymous: true })
  await expect.poll(() => relay.received.length, { timeout: 15_000 }).toBe(1)

  const ev = relay.received[0]!
  expect(ev.tags).toEqual([
    ['t', 'thing'],
    ['x', cast.envelopeHash],
    ['thing-type', 'ballot-vote']
  ])
  expect(ev.content.length).toBeGreaterThan(0) // inline, not a pointer
  expect(ev.content.length).toBeLessThan(45056) // the relay's own cap
  const identity = await voter.identity()
  const voteKeyOnNostr = Buffer.from(schnorr.getPublicKey(await deriveBallotKey(IDENTITY, H))).toString('hex')
  expect(ev.pubkey).not.toBe(identity.nostrPubkey)
  expect(ev.pubkey).not.toBe(voteKeyOnNostr)
  // Nothing in the event is the voter's: not their address, not their relay key.
  const wire = JSON.stringify(ev) + Buffer.from(ev.content, 'base64').toString('latin1')
  expect(wire).not.toContain(identity.nostrPubkey)
  expect(Buffer.from(ev.content, 'base64').includes(Buffer.from(identity.address, 'hex'))).toBe(false)

  // Sent twice, it goes under two different keys: the two events cannot be linked by poster.
  await voter.postToRelays(cast.envelopeHash as string)
  await expect.poll(() => relay.received.length, { timeout: 15_000 }).toBe(2)
  expect(relay.received[1]!.pubkey).not.toBe(ev.pubkey)
})

test('the other reader receives it from the relay and counts it', async () => {
  await expect
    .poll(async () => (await call<Record<string, any>>(witness, 'ballot', H)).counts, { timeout: 60_000 })
    .toEqual([1, 0])
  const f = await call<Record<string, any>>(witness, 'ballot', H)
  expect(f).toMatchObject({ closed: false, counted: 1, unchecked: 0 })
  expect(f.myVote).toBeNull()
})
