import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchShell, buildBundle, ethSigner, type ShellHandle } from './helpers.js'
import { jsToCbor } from '../../src/format/index.js'

// ── Passport proof letters ───────────────────────────────────────────────────
// A `passport-proof` letter carries zero-knowledge proofs about a passport,
// bound to one key. The shell verifies them in its isolated worker, with its
// own verification keys, and the header states what held. The proofs here were
// made from a synthetic passport (test/passport-fixtures); the app is
// told to accept that made-up state's registry via SHELL_PASSPORT_TEST_ROOT.

const FX = join(__dirname, '..', 'passport-fixtures', 'a')
const program = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'samples', 'passport-proof.html')))
const load = (name: string): Record<string, any> => JSON.parse(readFileSync(join(FX, name), 'utf8'))
/** The fixture binds its proofs to the address of this key (32 bytes of 0x01). */
const ALICE = new Uint8Array(32).fill(1)
const MALLORY = new Uint8Array(32).fill(9)

let shell: ShellHandle

type Credential = { kind: string; status: string; reason?: string; proof?: Record<string, unknown> }

async function open(priv: Uint8Array, pkg: Record<string, any>, type = 'passport-proof'): Promise<Credential | null> {
  const r = await shell.ingest(await buildBundle(ethSigner(priv), { type, program, args: jsToCbor(pkg) }))
  expect(r.status).toBe('valid')
  const header = await shell.openThing(r.envelopeHash as string)
  return (header.credential ?? null) as Credential | null
}

async function chromeEval<T>(js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

test.beforeAll(async () => {
  shell = await launchShell({ extraEnv: { SHELL_PASSPORT_TEST_ROOT: load('pins.json').registryRoot } })
})
test.afterAll(async () => {
  await shell?.close()
})

test('proofs bound to the author key: verified, and only the claims are known', async () => {
  const c = await open(ALICE, load('alice.json'))
  expect(c).toMatchObject({ kind: 'passport-proof', status: 'verified' })
  expect(c?.proof).toMatchObject({ minAge: 18, nationalityIn: ['AUS', 'NZL'], scope: 'souspli:test' })
  expect(String(c?.proof?.anchor)).toContain('TEST REGISTRY')
  // The verdict carries claims and a scoped mark -- no name, no number, no date of birth.
  expect(Object.keys(c?.proof ?? {}).sort()).toEqual(['anchor', 'minAge', 'nationalityIn', 'nullifier', 'provedAt', 'scope', 'subscope'])
})

test('the same letter republished under another key fails', async () => {
  const c = await open(MALLORY, load('alice.json'))
  expect(c).toMatchObject({ status: 'invalid', reason: expect.stringContaining('bound to a different key') })
})

test('a letter claiming more than was proved fails', async () => {
  const pkg = load('alice.json')
  pkg.claims.minAge = 65
  expect(await open(ALICE, pkg)).toMatchObject({ status: 'invalid', reason: expect.stringContaining('different parameters') })
})

test('the header states what held, and the letter makes no claim of its own', async () => {
  const r = await shell.ingest(await buildBundle(ethSigner(ALICE), { type: 'passport-proof', program, args: jsToCbor(load('alice.json')) }))
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(r.envelopeHash)})`)
  const badge = (): Promise<{ text: string | null; state: string | null; title: string | null } | null> =>
    chromeEval(
      `(() => { const b = document.querySelector('[data-testid=header-credential]'); return b ? { text: b.textContent, state: b.getAttribute('data-credential'), title: b.title } : null })()`
    )
  await expect.poll(badge, { timeout: 20_000 }).toMatchObject({ state: 'verified', text: '✓ passport proof: 18+ · citizen of one of AUS, NZL' })
  expect((await badge())?.title).toContain('stay hidden')

  const page = await shell.app.evaluate(async (electron) => {
    const s = (electron.app as unknown as { __shell: { modeState: () => { viewWcId: number | null } | null } }).__shell.modeState()
    return (await electron.webContents.fromId(s!.viewWcId!)!.executeJavaScript(`document.querySelector('.page').textContent`)) as string
  })
  expect(page).toContain('Aged 18 or over')
  expect(page).toContain('A citizen of one of: AUS, NZL')
  expect(page).toContain('checked by Souspli and stated in the header')
  expect(page).not.toMatch(/[✓✔]|verified/i)
})

// Format 2: the same statement as ONE proof (zkPassport's outer circuit).
test('a single-proof package verifies the same way, and its letter is small enough for a relay', async () => {
  const c = await open(ALICE, load('alice-2.json'))
  expect(c).toMatchObject({ kind: 'passport-proof', status: 'verified' })
  expect(c?.proof).toMatchObject({ minAge: 18, nationalityIn: ['AUS', 'NZL'], scope: 'souspli:test' })
  expect(await open(MALLORY, load('alice-2.json'))).toMatchObject({ status: 'invalid', reason: expect.stringContaining('bound to a different key') })

  const tar = await buildBundle(ethSigner(ALICE), { type: 'passport-proof', program, args: jsToCbor(load('alice-2.json')) })
  expect(tar.length).toBeLessThan(32 * 1024) // the inline cap; six separate proofs make about 130 KB
  expect((await buildBundle(ethSigner(ALICE), { type: 'passport-proof', program, args: jsToCbor(load('alice.json')) })).length).toBeGreaterThan(32 * 1024)
})

test('the type shows a single-proof package like any other, and keeps every field when writing one', async () => {
  const r = await shell.ingest(await buildBundle(ethSigner(ALICE), { type: 'passport-proof', program, args: jsToCbor(load('alice-2-age.json')), created: 1_794_000_900 }))
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(r.envelopeHash)})`)
  await expect
    .poll(() => chromeEval<string | null>(`document.querySelector('[data-testid=header-credential]')?.textContent ?? null`), { timeout: 20_000 })
    .toBe('✓ passport proof: 18+')
  const page = await shell.app.evaluate(async (electron) => {
    const s = (electron.app as unknown as { __shell: { modeState: () => { viewWcId: number | null } | null } }).__shell.modeState()
    return (await electron.webContents.fromId(s!.viewWcId!)!.executeJavaScript(`document.querySelector('.page').textContent`)) as string
  })
  expect(page).toContain('Aged 18 or over')
  expect(page).not.toContain('No proofs yet')
})
