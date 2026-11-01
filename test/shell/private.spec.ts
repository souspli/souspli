import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, launchShell, type ShellHandle } from './helpers.js'
import { npubOf } from '../../src/shell/recipient.js'

// ── Writing privately ────────────────────────────────────────────────────────
// Alice holds a letter from Bob, so she knows the key he signed for private
// letters. She writes to him; the confirm names him and says what a seal
// cannot do; what is published is sealed to him and to her, and nothing of it
// stays on her disk in the clear. Bob opens it, still opens it after a
// restart, and replies privately.

const NAMETAG = readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html'))
const SECRET = 'meet at the old mill at noon'

async function chromeEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

const exists = (shell: ShellHandle, testid: string): Promise<boolean> =>
  chromeEval<boolean>(shell, `!!document.querySelector('[data-testid=${testid}]')`)
const text = (shell: ShellHandle, testid: string): Promise<string> =>
  chromeEval<string>(shell, `document.querySelector('[data-testid=${testid}]')?.textContent ?? ''`)

/** Open a draft and publish it through the confirm, as a human would. Returns
 *  the outcome; leaves the confirm's text for the caller in `seen`. */
async function publishDraft(shell: ShellHandle, draftId: string): Promise<{ outcome: Record<string, unknown>; seen: string }> {
  await shell.app.evaluate(async (electron) => {
    ;(electron.app as unknown as { __shell: { lastPublish: unknown } }).__shell.lastPublish = null
  })
  await chromeEval(shell, `window.__shellChrome.openThing(${JSON.stringify(draftId)})`)
  await expect
    .poll(
      () =>
        shell.app.evaluate(async (electron) => {
          const s = (electron.app as unknown as { __shell: { publishDraft: () => Record<string, unknown> } }).__shell
          return s.publishDraft() as never
        }) as Promise<Record<string, unknown>>,
      { timeout: 20_000 }
    )
    .toMatchObject({ status: 'pending' })
  await expect.poll(() => exists(shell, 'confirm-approve'), { timeout: 20_000 }).toBe(true)
  const seen = await chromeEval<string>(shell, `document.querySelector('.evm-modal-overlay:last-of-type').textContent`)
  await chromeEval(shell, `document.querySelector('[data-testid=confirm-approve]').click()`)
  let outcome: Record<string, unknown> | null = null
  await expect
    .poll(
      async () => {
        outcome = (await shell.app.evaluate(async (electron) => {
          const s = (electron.app as unknown as { __shell: { lastPublish: Record<string, unknown> | null } }).__shell
          return s.lastPublish as never
        })) as Record<string, unknown> | null
        return outcome?.status
      },
      { timeout: 20_000 }
    )
    .toBe('valid')
  return { outcome: outcome!, seen }
}

const b64 = (bytes: Uint8Array | Buffer): Uint8Array => Uint8Array.from(Buffer.from(bytes))

test('a private letter reaches only its recipient, survives a restart, and is answered privately', async () => {
  const bobDir = mkdtempSync(join(tmpdir(), 'shell-bob-'))
  const alice = await launchShell()
  let bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: bobDir } })
  try {
    const aliceId = await alice.identity()
    const bobId = await bob.identity()
    const bobKey = bobId.address.replace(/^0x/, '').toLowerCase()

    // Bob writes one public letter; that is how Alice learns his key.
    const hello = await bob.compose(NAMETAG.toString('base64'), 'nametag')
    expect((await alice.ingest(b64(Buffer.from(hello.tarBase64, 'base64')))).status).toBe('valid')

    // ── The To row: Bob can be picked from People; a typo is refused. ──────
    await chromeEval(alice, `document.querySelector('[data-testid=new-thing]').click()`)
    await expect.poll(() => exists(alice, 'new-to-pick'), { timeout: 10_000 }).toBe(true)
    expect(
      await chromeEval<boolean>(alice, `document.querySelector('[data-testid=new-to-pick] option[data-author-key="${bobKey}"]').disabled`)
    ).toBe(false)
    await chromeEval(
      alice,
      `(() => { const s = document.querySelector('[data-testid=new-to-pick]'); s.value = '0x${bobKey}'; s.dispatchEvent(new Event('change')) })()`
    )
    await expect.poll(() => chromeEval<number>(alice, `document.querySelectorAll('[data-testid=new-to-chip]').length`)).toBe(1)
    expect(await text(alice, 'new-to-hint')).toContain('can pass it on')
    expect(await chromeEval<string>(alice, `document.querySelector('[data-testid=new-menu] .evm-modal-title').textContent`)).toBe(
      'New private letter'
    )
    await chromeEval(
      alice,
      `(() => { const i = document.querySelector('[data-testid=new-to-input]'); i.value = 'npub1notakey'; document.querySelector('[data-testid=new-to-add]').click() })()`
    )
    await expect.poll(() => text(alice, 'new-to-error')).toContain('mistyped')
    await chromeEval(alice, `document.querySelector('[data-testid=new-menu-cancel]').click()`)

    // Typed keys are named when a held letter bound them, and flagged when not.
    const viaNpub = await alice.resolveRecipient(npubOf(bobId.nostrPubkey))
    expect(viaNpub).toMatchObject({ ek: bobId.nostrPubkey, known: true })
    const viaAddress = await alice.resolveRecipient(`0x${bobKey}`)
    expect(viaAddress).toMatchObject({ ek: bobId.nostrPubkey, known: true })
    expect(await alice.resolveRecipient('0x' + '1'.repeat(40))).toMatchObject({ error: expect.stringMatching(/npub/) })
    // Yourself is never a recipient, and a list of only you is not quietly public.
    expect(await alice.resolveRecipient(npubOf(aliceId.nostrPubkey))).toMatchObject({ error: expect.stringMatching(/you/) })
    expect(await alice.newDraft('starter:memo', {}, [aliceId.nostrPubkey])).toMatchObject({ error: expect.any(String) })

    // ── Write, confirm, seal. ─────────────────────────────────────────────
    const draft = await alice.newDraft('starter:memo', { to: 'Bob', from: 'Alice', subject: 'Plans', message: SECRET }, [
      bobId.nostrPubkey
    ])
    expect(draft.id).toBeTruthy()
    await chromeEval(alice, `window.__shellChrome.openThing(${JSON.stringify(draft.id)})`)
    await expect.poll(() => text(alice, 'header-private'), { timeout: 10_000 }).toMatch(/^Private · to /)
    expect(await exists(alice, 'header-private-note')).toBe(true)
    // What the note says is true: the draft is on disk in the clear. (And
    // the scan below can see it, so its empty answer means something.)
    expect(alice.scanUserData(new TextEncoder().encode(SECRET)).length).toBeGreaterThan(0)

    const { outcome, seen } = await publishDraft(alice, draft.id!)
    expect(seen).toContain('Anyone you send this to can forward it, with your signature intact.')
    expect(seen).toMatch(/Sealed to .+, and you\./)
    expect(outcome.sealed).toBe(true)
    const letter = outcome.envelopeHash as string

    // Alice reads her own copy (she sealed one to herself) ...
    expect(await alice.openThing(letter)).not.toHaveProperty('error')
    // ... and nothing of it is on her disk in the clear: not in the library,
    // the seed store, the database or its log.
    expect(alice.scanUserData(new TextEncoder().encode(SECRET))).toEqual([])
    expect(alice.scanUserData(new TextEncoder().encode('Plans'))).toEqual([])

    // ── Bob receives it as a file. ────────────────────────────────────────
    const exported = await alice.exportBase64(letter)
    expect(exported.error).toBeUndefined()
    const tar = b64(Buffer.from(exported.base64!, 'base64'))
    const got = await bob.ingest(tar)
    expect(got).toMatchObject({ status: 'valid', sealed: true, envelopeHash: letter })
    // It is addressed to him.
    expect((await bob.feed({ toMe: true })).map((r) => r.envelopeHash)).toContain(letter)
    expect(await bob.openThing(letter)).not.toHaveProperty('error')
    await chromeEval(bob, `window.__shellChrome.openThing(${JSON.stringify(letter)})`)
    await expect.poll(() => exists(bob, 'header-sealed'), { timeout: 10_000 }).toBe(true)
    expect(await exists(bob, 'header-reply-private')).toBe(true)
    expect(bob.scanUserData(new TextEncoder().encode(SECRET))).toEqual([])

    // ── Bob restarts: the plaintext was only in memory, and it comes back. ─
    await bob.close()
    bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: bobDir } })
    await expect.poll(async () => (await bob.openThing(letter)).error ?? 'ok', { timeout: 15_000 }).toBe('ok')
    // Save as file still hands out the sealed bytes it arrived as.
    const again = await bob.exportBase64(letter)
    expect(again.base64).toBe(exported.base64)

    // ── Bob replies privately; it is sealed to Alice. ─────────────────────
    const reply = await bob.newPrivateReply(letter)
    expect(reply.id).toBeTruthy()
    const answered = await publishDraft(bob, reply.id!)
    expect(answered.outcome.sealed).toBe(true)
    expect(answered.seen).toContain('Anyone you send this to can forward it')
    const replyTar = await bob.exportBase64(answered.outcome.envelopeHash as string)
    const back = await alice.ingest(b64(Buffer.from(replyTar.base64!, 'base64')))
    expect(back).toMatchObject({ status: 'valid', sealed: true })
    expect((back.author as { k: string }).k).toBe(bobKey)
  } finally {
    await alice.close()
    await bob.close()
    rmSync(bobDir, { recursive: true, force: true })
  }
})

test('People offers Write privately only for someone whose key is known', async () => {
  const alice = await launchShell()
  try {
    const bob = await launchShell()
    let bobKey: string
    try {
      const hello = await bob.compose(NAMETAG.toString('base64'), 'nametag')
      expect((await alice.ingest(b64(Buffer.from(hello.tarBase64, 'base64')))).status).toBe('valid')
      bobKey = (await bob.identity()).address.replace(/^0x/, '').toLowerCase()
    } finally {
      await bob.close()
    }
    await chromeEval(alice, `window.__shellChrome.openPeople()`)
    const btn = `[data-testid=people-list] [data-author-key="${bobKey}"] [data-testid=people-write]`
    await expect.poll(() => chromeEval<boolean>(alice, `!!document.querySelector('${btn}')`)).toBe(true)
    expect(await chromeEval<boolean>(alice, `document.querySelector('${btn}').disabled`)).toBe(false)
    await chromeEval(alice, `document.querySelector('${btn}').click()`)
    // New opens with Bob already in To, and People is gone.
    await expect.poll(() => chromeEval<number>(alice, `document.querySelectorAll('[data-testid=new-to-chip]').length`)).toBe(1)
    expect(await exists(alice, 'people-modal')).toBe(false)
  } finally {
    await alice.close()
  }
})
