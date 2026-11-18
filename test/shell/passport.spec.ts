import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchShell, buildBundle, ethSigner, ethAddress, secp256k1, type ShellHandle } from './helpers.js'
import { bindChallenge } from '../../src/shell/credential/passport.js'
import { makeState, type TestPassport } from '../passport-fixture.js'

// ── Passport letters ─────────────────────────────────────────────────────────
// A `passport` letter carries a chip reading. What it is worth is decided by the
// shell, against the author key, and shown in the header -- never by the
// letter's program. The passports here come from a made-up state whose
// certificate the app is told to trust through SHELL_PASSPORT_TEST_ANCHOR.

const program = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'samples', 'passport.html')))
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64')
const state = makeState('UTO', true)

let shell: ShellHandle
let passport: TestPassport
let holder: Uint8Array

type Credential = { kind: string; status: string; reason?: string; passport?: Record<string, unknown> }

/** A passport letter by `priv`; `boundTo` is the key the chip is asked to sign (default: the author). */
async function letter(priv: Uint8Array, p: TestPassport, opts: { bind?: Uint8Array | null; dg1?: Uint8Array } = {}): Promise<Uint8Array> {
  const bindTo = opts.bind === undefined ? ethAddress(priv) : opts.bind
  const args: Record<string, string> = { dg1: b64(opts.dg1 ?? p.dg1), sod: b64(p.sod) }
  if (bindTo) {
    args.dg15 = b64(p.dg15)
    args.aaResponse = b64(p.chipSign(bindChallenge(bindTo)))
  }
  return buildBundle(ethSigner(priv), { type: 'passport', program, args: new Map(Object.entries(args)) })
}

async function open(bundle: Uint8Array): Promise<Credential | null> {
  const r = await shell.ingest(bundle)
  expect(r.status).toBe('valid')
  const header = await shell.openThing(r.envelopeHash as string)
  return (header.credential ?? null) as Credential | null
}

test.beforeAll(async () => {
  shell = await launchShell({ extraEnv: { SHELL_PASSPORT_TEST_ANCHOR: b64(state.anchor) } })
  passport = state.issue()
  holder = secp256k1.utils.randomSecretKey()
})

test.afterAll(async () => {
  await shell?.close()
})

test('a genuine reading whose chip signed the author key: verified, and tied to the key', async () => {
  const c = await open(await letter(holder, passport))
  expect(c?.status).toBe('verified')
  expect(c?.passport).toMatchObject({ surname: 'ERIKSSON', givenNames: 'ANNA MARIA', nationality: 'UTO', chip: 'signed', expired: false })
  expect(c?.passport?.anchor).toContain('TEST CERTIFICATE')
})

test('the same reading without a chip signature: genuine data, not tied to the key', async () => {
  const c = await open(await letter(secp256k1.utils.randomSecretKey(), passport, { bind: null }))
  expect(c?.status).toBe('verified')
  expect(c?.passport?.chip).toBe('absent')
})

test('a letter copied under another key fails: the chip signed the holder, not the copier', async () => {
  const thief = secp256k1.utils.randomSecretKey()
  const c = await open(await letter(thief, passport, { bind: ethAddress(holder) }))
  expect(c?.status).toBe('invalid')
  expect(c?.reason).toContain("not over this author's key")
})

test('altered identity data fails', async () => {
  const dg1 = Uint8Array.from(passport.dg1)
  dg1[12] = 'X'.charCodeAt(0)
  const c = await open(await letter(holder, passport, { dg1 }))
  expect(c?.status).toBe('invalid')
})

test('a passport of a state whose certificate is not held cannot be checked — which is not "verified"', async () => {
  const c = await open(await letter(holder, makeState('ZZZ').issue()))
  expect(c?.status).toBe('unverifiable')
})

test('no other type gets a credential, whatever its args say', async () => {
  const args = new Map(Object.entries({ dg1: b64(passport.dg1), sod: b64(passport.sod) }))
  const r = await shell.ingest(await buildBundle(ethSigner(holder), { type: 'memo', program, args }))
  const header = await shell.openThing(r.envelopeHash as string)
  expect(header.credential).toBeNull()
})

async function chromeEval<T>(js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

test('the header draws the verdict, in pixels the letter cannot reach', async () => {
  const r = await shell.ingest(await letter(holder, passport))
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(r.envelopeHash)})`)
  const badge = (testid: string, attr: string): Promise<{ text: string | null; attr: string | null } | null> =>
    chromeEval(
      `(() => { const b = document.querySelector('[data-testid=${testid}]'); return b ? { text: b.textContent, attr: b.getAttribute('${attr}') } : null })()`
    )
  await expect.poll(() => badge('header-credential', 'data-credential'), { timeout: 10_000 }).toMatchObject({ attr: 'verified' })
  expect((await badge('header-credential', 'data-credential'))?.text).toContain('ERIKSSON, ANNA MARIA')
  expect(await badge('header-credential-chip', 'data-chip')).toMatchObject({ attr: 'signed', text: '✓ chip signed this key' })
})

type ModeState = { viewWcId: number | null; editWcId: number | null } | null

/** Run `js` in the open letter's own page (its view or its edit cage). */
async function letterEval<T>(js: string, which: 'view' | 'edit'): Promise<T> {
  return shell.app.evaluate(
    async (electron, a) => {
      const s = (electron.app as unknown as { __shell: { modeState: () => ModeState } }).__shell.modeState()
      const id = a.which === 'edit' ? s?.editWcId : s?.viewWcId
      if (id == null) throw new Error(`no ${a.which} cage`)
      return (await electron.webContents.fromId(id)!.executeJavaScript(a.js)) as never
    },
    { which, js }
  )
}

test('the passport type shows the data and makes no claim of its own', async () => {
  const r = await shell.ingest(await letter(holder, passport))
  await shell.openThing(r.envelopeHash as string)
  const text = (): Promise<string> => letterEval(`document.querySelector('.page').textContent`, 'view')
  await expect.poll(text, { timeout: 10_000 }).toContain('ERIKSSON')
  const page = await text()
  expect(page).toContain('ANNA MARIA')
  expect(page).toContain('checked by Souspli and stated in the header')
  // "Reserve ✓ for nothing": verification marks belong to the header.
  expect(page).not.toMatch(/[✓✔]|verified/i)
})

test('writing one: the type reads the reader app’s export, and keeps a chip signature only if it was made for a Souspli key', async () => {
  const draft = await shell.newDraft('starter:passport')
  await shell.openThing(draft.id as string)
  const address = Buffer.from(ethAddress(holder)).toString('hex').toUpperCase()
  const exportFile = (boundTo: string | null): string =>
    JSON.stringify({
      files: { DG1: b64(passport.dg1), 'EF.SOD': b64(passport.sod), DG15: b64(passport.dg15) },
      chipAuth: {
        method: 'Active Authentication',
        status: 'Passed',
        aaChallengeHex: '0011223344556677',
        aaResponseHex: Buffer.from(passport.chipSign(bindChallenge(ethAddress(holder)))).toString('hex').toUpperCase(),
        ...(boundTo ? { aaBoundAddressHex: boundTo } : {})
      }
    })
  const pick = (json: string): Promise<void> =>
    letterEval(
      `(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(json)}], 'passport.json', { type: 'application/json' }));
        const input = document.getElementById('edit-file'); input.files = dt.files; input.dispatchEvent(new Event('change')) })()`,
      'edit'
    )
  const page = (): Promise<string> => letterEval(`document.querySelector('.page').textContent`, 'edit')
  await expect.poll(() => letterEval<boolean>(`!!document.getElementById('edit-file')`, 'edit'), { timeout: 15_000 }).toBe(true)

  await pick(exportFile(address))
  await expect.poll(page, { timeout: 10_000 }).toContain('ERIKSSON')
  expect(await page()).toContain(`The chip signed the Souspli address 0x${address.toLowerCase()}`)

  // A response to a random challenge would only make the letter fail its check: it is left out.
  await pick(exportFile(null))
  await expect.poll(page, { timeout: 10_000 }).toContain('no chip signature for a Souspli address')

  await pick('{"files":{}}')
  await expect.poll(page, { timeout: 10_000 }).toContain('has no passport data')
})
