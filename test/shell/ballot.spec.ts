import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchShell, buildBundle, ethSigner, ethAddress, type ShellHandle } from './helpers.js'
import { decodeEnvelope, jsToCbor, parseBundle } from '../../src/format/index.js'
import { encodeClosing } from '../../src/shell/credential/ballot.js'
import { IDENTITY, WITNESS_1, ballotBundle, ballotHash, identityVoteAddress } from './ballot-fixture.js'

// ── Secret ballots ───────────────────────────────────────────────────────────
// One ballot, followed from open to final count, in the real app.
//
//   The ballot (test/shell/ballot-fixture.ts) admits any passport holder of 18
//   or over, and names three witnesses, two of whom must agree. The app under
//   test is given the identity of the third.
//
//   The votes carry real proofs from three synthetic passports, A, B and C:
//     v1  passport A, under key 1   → Yes
//     v2  passport B, under key 2   → No
//     v3  passport A again, key 3   → No   (the same passport voting twice)
//     the app's own vote, passport C, under its one-time key → Yes
//
// The tests run in order and share the app: each builds on the last.

test.describe.configure({ mode: 'serial' })

const FX = join(__dirname, '..', 'passport-fixtures')
const text = (path: string): string => readFileSync(join(FX, path), 'utf8')
const pkg = (path: string): Record<string, any> => JSON.parse(text(path))
const root = (dir: string): string => pkg(`${dir}/pins.json`).registryRoot
const STUB = new TextEncoder().encode('<!doctype html><p>f</p>')
const key = (b: number): Uint8Array => new Uint8Array(32).fill(b)

let shell: ShellHandle
let H: string
let v1: string
let v2: string
let v3: string
let mine: string

const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  shell.app.evaluate(
    async (electron, a) => (await (electron.app as unknown as { __shell: Record<string, (...x: unknown[]) => unknown> }).__shell[a.fn]!(...a.args)) as never,
    { fn, args }
  )
const facts = (): Promise<Record<string, any>> => call('ballot', H)
/** The count once every vote held has been checked. */
async function settled(): Promise<Record<string, any>> {
  await expect.poll(async () => (await facts()).unchecked, { timeout: 60_000 }).toBe(0)
  return facts()
}
async function chromeEval<T>(js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}
/** A vote letter as anyone might send it: signed by the key its proofs are bound to. */
async function voteAs(priv: Uint8Array, fixture: string, choice: number, created: number): Promise<string> {
  const args = { votesOn: H, choice, ...pkg(fixture) }
  const r = await shell.ingest(await buildBundle(ethSigner(priv), { type: 'ballot-vote', program: STUB, args: jsToCbor(args), created }))
  expect(r.status, String(r.reason ?? '')).toBe('valid')
  return r.envelopeHash as string
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  // Give the app a known identity: import the key (which writes it), then start again on the same profile.
  const first = await launchShell({ extraEnv: { SHELL_NO_RELAUNCH: '1' } })
  const dir = first.userDataDir
  shell = first
  const r = await chromeEval<{ ok: boolean }>(`window.shell.accountImport({ privkeyHex: ${JSON.stringify(Buffer.from(IDENTITY).toString('hex'))} })`)
  expect(r.ok).toBe(true)
  await first.app.close()
  shell = await launchShell({
    extraEnv: {
      SHELL_USER_DATA_DIR: dir,
      SHELL_PASSPORT_TEST_ROOT: [root('a'), root('b'), root('c')].join(',')
    }
  })
  expect((await shell.identity()).address).toBe(Buffer.from(ethAddress(IDENTITY)).toString('hex'))
  const b = await shell.ingest(await ballotBundle())
  expect(b.status).toBe('valid')
  H = b.envelopeHash as string
  // The fixtures' scope names this hash. If it moves, they must be regenerated.
  expect(H).toBe(await ballotHash())
})
test.afterAll(async () => {
  await shell?.close()
})
test.beforeEach(() => test.setTimeout(120_000))

test('an open ballot: no votes, provisional, and a one-time address to vote from', async () => {
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(H)})`)
  await expect.poll(() => chromeEval(`document.querySelector('[data-testid=header-ballot]')?.getAttribute('data-state') ?? null`), { timeout: 20_000 }).toBe('provisional')
  const b = await facts()
  expect(b).toMatchObject({ question: 'Shall we?', options: ['Yes', 'No'], closed: false, counts: [0, 0], quorum: 2, closings: 0, iAmWitness: true, iHaveClosed: false, myVote: null })
  expect(b.rule).toBe('a passport proof: aged 18 or over')
  expect(b.voteScope).toBe(`souspli:ballot:${H}`)
  // A key for this ballot alone: not the identity's address, and the one the fixture was made for.
  expect(b.voteAddress).toBe(await identityVoteAddress())
  expect(b.voteAddress).not.toBe(`0x${(await shell.identity()).address}`)
})

test('votes are counted one per passport: a second vote from the same passport replaces the first', async () => {
  v1 = await voteAs(key(1), 'a/ballot-a-k1.json', 0, 1_794_000_100)
  v2 = await voteAs(key(2), 'b/ballot-b-k2.json', 1, 1_794_000_100)
  expect(await settled()).toMatchObject({ closed: false, counts: [1, 1], counted: 2 })
  // Passport A votes again, later, under a different key, the other way.
  v3 = await voteAs(key(3), 'a/ballot-a-k3.json', 1, 1_794_000_200)
  expect(await settled()).toMatchObject({ closed: false, counts: [0, 2], counted: 2 })
})

test('a vote whose proofs are not its own, or are for another ballot, counts for nothing', async () => {
  // Key 9 republishes passport B's proofs: they are bound to key 2.
  await voteAs(key(9), 'b/ballot-b-k2.json', 0, 1_794_000_300)
  // Passport A's proofs for the gated forum of another test: genuine, and about somewhere else.
  await voteAs(key(1), 'a/group-alice.json', 0, 1_794_000_300)
  expect(await settled()).toMatchObject({ counts: [0, 2], counted: 2 })
})

test('casting: the app refuses a package that is not for its one-time key, and signs a good one with that key alone', async () => {
  const wrong = await call<{ error?: string }>('ballotCast', H, 0, text('a/ballot-a-k1.json'))
  expect(wrong.error).toContain('your key for this ballot is')
  expect((await call<{ error?: string }>('ballotCast', H, 5, text('c/ballot-c-identity.json'))).error).toContain('choose one of the options')

  const cast = await call<{ envelopeHash?: string; error?: string }>('ballotCast', H, 0, text('c/ballot-c-identity.json'))
  expect(cast.error).toBeUndefined()
  mine = cast.envelopeHash as string
  const f = await settled()
  expect(f).toMatchObject({ counts: [1, 2], counted: 3 })
  expect(f.myVote).toEqual({ envelopeHash: mine, counted: true })

  // The letter itself: signed by the one-time key, and naming nothing else of the voter's.
  const exported = await shell.exportBase64(mine)
  const { envelope } = decodeEnvelope(parseBundle(new Uint8Array(Buffer.from(exported.base64 as string, "base64"))).envelope)
  const identity = await shell.identity()
  expect(`0x${Buffer.from(envelope.author.k).toString('hex')}`).toBe(await identityVoteAddress())
  expect(Buffer.from(envelope.author.k).toString('hex')).not.toBe(identity.address)
  expect(envelope.author.e).toBeUndefined()
  expect(envelope.author.ek).toBeUndefined()
  expect(Buffer.from(exported.base64 as string, 'base64').includes(Buffer.from(identity.address, 'hex'))).toBe(false)
  expect(Buffer.from(exported.base64 as string, 'base64').includes(Buffer.from(identity.nostrPubkey, 'hex'))).toBe(false)
})

test('one witness closing is not enough: the count stays provisional', async () => {
  // Witness 1 holds v1, v2 and the app's vote -- but never received v3.
  const r = await shell.ingest(
    await buildBundle(ethSigner(WITNESS_1), { type: 'ballot-close', program: STUB, args: jsToCbor({ attests: H, votes: encodeClosing([v1, v2, mine]) }), created: 1_794_001_000 })
  )
  expect(r.status).toBe('valid')
  expect(await settled()).toMatchObject({ closed: false, closings: 1, counts: [1, 2] })
})

test('a closing from a key the ballot does not name changes nothing', async () => {
  await shell.ingest(await buildBundle(ethSigner(key(9)), { type: 'ballot-close', program: STUB, args: jsToCbor({ attests: H, votes: '' }), created: 1_794_001_000 }))
  expect(await settled()).toMatchObject({ closed: false, closings: 1 })
})

test('closing asks first: a closing statement is a signature, and backing out publishes nothing', async () => {
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(H)})`)
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid="header-ballot-close"]')`), { timeout: 15_000 }).toBe(true)
  await chromeEval(`document.querySelector('[data-testid="header-ballot-close"]').click()`)
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid="danger-confirm"]')`)).toBe(true)
  expect(await chromeEval<string>(`document.querySelector('[data-testid="danger-confirm"]').closest('.evm-modal').innerText`)).toContain('with your identity')
  await chromeEval(`document.querySelector('[data-testid="danger-cancel"]').click()`)
  expect(await settled()).toMatchObject({ closed: false, closings: 1, iHaveClosed: false })
})

test('the second witness closes it: the count is final, and holds only votes two witnesses listed', async () => {
  const closed = await call<{ envelopeHash?: string; listed?: number; error?: string }>('ballotClose', H)
  expect(closed.error).toBeUndefined()
  // The app lists every valid vote it holds: v1, v2, v3 and its own. Not the two that counted for nothing.
  expect(closed.listed).toBe(4)

  const f = await settled()
  // v3 was listed by this witness alone, so it is not counted -- and passport A's earlier vote, v1, stands.
  expect(f).toMatchObject({ closed: true, closings: 2, counts: [2, 1], counted: 3, unwitnessed: 1, iHaveClosed: true })
  expect([...f.countedVotes].sort()).toEqual([v1, v2, mine].sort())
  expect(f.countedVotes).not.toContain(v3)
  expect((await call<{ error?: string }>('ballotClose', H)).error).toBeUndefined() // a witness may publish again; its latest stands
})

test('a vote arriving after the close is held, and not counted', async () => {
  // Passport B votes again after the witnesses have closed.
  await voteAs(key(2), 'b/ballot-b-k2.json', 0, 1_794_002_000)
  const f = await settled()
  expect(f).toMatchObject({ closed: true, counts: [2, 1], counted: 3 })
})

test('the header states the final count', async () => {
  // The ballot has been open since the first test: its header kept itself current as votes and closings arrived.
  const badge = (): Promise<{ text: string | null; state: string | null } | null> =>
    chromeEval(`(() => { const b = document.querySelector('[data-testid=header-ballot]'); return b ? { text: b.textContent, state: b.getAttribute('data-state') } : null })()`)
  await expect.poll(badge, { timeout: 20_000 }).toEqual({ text: 'Final: Yes 2 · No 1', state: 'final' })
  expect(await chromeEval(`document.querySelector('[data-testid=header-ballot-mine]')?.textContent ?? null`)).toBe('your vote is counted')
  // Closed: nothing more to cast.
  expect(await chromeEval(`!!document.querySelector('[data-testid=header-ballot-vote]')`)).toBe(false)
})
