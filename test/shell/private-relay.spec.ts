import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  test,
  expect,
  launchShell,
  buildBundle,
  buildSealedBundle,
  ethSigner,
  nostrSigner,
  secp256k1,
  schnorr,
  type ShellHandle
} from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'
import { buildSealedEvent, buildThingEvent } from '../../src/shell/nostr/event.js'

// ── Sending privately through relays ─────────────────────────────────────────
// A sealed letter goes to the relay under a key made for that one post, and
// the event says nothing but "a sealed letter, these bytes". Everyone
// subscribed receives it; only a recipient keeps it. The relay never learns
// who wrote it or who it is for.

const NAMETAG = readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html'))
const SECRET = 'the key is under the third stone'

test.beforeEach(() => test.setTimeout(120_000))

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

async function connected(shell: ShellHandle, relay: TestRelay): Promise<void> {
  expect((await shell.addRelay(relay.url)).error ?? null).toBeNull()
  await expect
    .poll(async () => (await shell.relays()).relays.filter((r) => r.state === 'open').length, { timeout: 15_000 })
    .toBe(1)
}

/** Publish a draft through the confirm. `send`: leave "also send it through
 *  your relays" ticked (the default) or untick it. */
async function publish(shell: ShellHandle, draftId: string, send: boolean): Promise<Record<string, unknown>> {
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
  await expect.poll(() => exists(shell, 'confirm-send-relays'), { timeout: 20_000 }).toBe(true)
  expect(await chromeEval<boolean>(shell, `document.querySelector('[data-testid=confirm-send-relays]').checked`)).toBe(true)
  if (!send) await chromeEval(shell, `document.querySelector('[data-testid=confirm-send-relays]').click()`)
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
  return outcome!
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const held = async (shell: ShellHandle, hash: string): Promise<boolean> =>
  (await shell.feed({ limit: 500 })).some((r) => r.envelopeHash === hash)

test('a sealed letter travels by relay under a one-time key, and only its recipient keeps it', async () => {
  const relay = await startRelay()
  const bobDir = mkdtempSync(join(tmpdir(), 'shell-bob-'))
  const alice = await launchShell()
  let bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: bobDir } })
  const carol = await launchShell()
  try {
    for (const s of [alice, bob, carol]) await connected(s, relay)
    const aliceId = await alice.identity()
    const bobId = await bob.identity()

    // Bob posts a public letter; Alice learns his private-letter key from it.
    const hello = await bob.compose(NAMETAG.toString('base64'), 'nametag')
    const helloHash = hello.outcome.envelopeHash as string
    expect((await bob.postToRelays(helloHash)).posted).toBe(1)
    await expect.poll(() => held(alice, helloHash), { timeout: 15_000 }).toBe(true)

    // ── Alice seals and sends. ────────────────────────────────────────────
    const draft = await alice.newDraft('starter:memo', { to: 'Bob', from: 'Alice', subject: 'Stones', message: SECRET }, [
      bobId.nostrPubkey
    ])
    const before = relay.received.length
    const outcome = await publish(alice, draft.id!, true)
    expect(outcome.sealed).toBe(true)
    expect(outcome.relaySend).toMatchObject({ posted: 1, sealed: true })
    const letter = outcome.envelopeHash as string

    // ── What the relay saw. ───────────────────────────────────────────────
    await expect.poll(() => relay.received.length, { timeout: 10_000 }).toBe(before + 1)
    const ev = relay.received[before]!
    // Neither the sender's key nor the recipient's.
    expect(ev.pubkey).not.toBe(aliceId.nostrPubkey)
    expect(ev.pubkey).not.toBe(bobId.nostrPubkey)
    // Nothing but the topic, the hash of these bytes, and "sealed".
    const bytes = Buffer.from(ev.content, 'base64')
    expect(ev.tags).toEqual([
      ['t', 'thing'],
      ['x', sha256(bytes)],
      ['thing-type', 'sealed']
    ])
    expect(ev.tags.flat()).not.toContain(letter)
    // No words, and neither of Alice's keys, in any form.
    for (const leak of [SECRET, 'Stones', 'memo']) expect(bytes.includes(Buffer.from(leak)), leak).toBe(false)
    for (const key of [aliceId.address.replace(/^0x/, ''), aliceId.nostrPubkey]) {
      expect(bytes.includes(Buffer.from(key, 'hex')), key).toBe(false)
      expect(bytes.includes(Buffer.from(key)), key).toBe(false)
    }
    const x = sha256(bytes)

    // ── Bob receives it, and it is addressed to him. ──────────────────────
    await expect.poll(async () => (await bob.feed({ toMe: true })).map((r) => r.envelopeHash), { timeout: 15_000 }).toContain(letter)
    await expect.poll(async () => (await bob.openThing(letter)).error ?? 'ok', { timeout: 15_000 }).toBe('ok')

    // ── Carol received the same event and kept nothing. A later public post
    // reaching her proves she has dealt with the sealed one before it. ─────
    const later = await bob.compose(Buffer.concat([NAMETAG, Buffer.from('<!-- 2 -->')]).toString('base64'), 'nametag')
    expect((await bob.postToRelays(later.outcome.envelopeHash as string)).posted).toBe(1)
    await expect.poll(() => held(carol, later.outcome.envelopeHash as string), { timeout: 15_000 }).toBe(true)
    expect(await held(carol, letter)).toBe(false)
    expect((await carol.feed({ limit: 500 })).some((r) => r.sealed === true)).toBe(false)
    expect(await carol.seedHas(x)).toBe(false)

    // ── Bob restarts; the letter that came by relay still opens. ──────────
    await bob.close()
    bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: bobDir } })
    await expect.poll(async () => (await bob.openThing(letter)).error ?? 'ok', { timeout: 15_000 }).toBe('ok')

    // ── Bob replies privately, unticks the box, then sends it from Share. ─
    // Already in his list from before the restart; wait for the socket.
    await expect
      .poll(async () => (await bob.relays()).relays.filter((r) => r.state === 'open').length, { timeout: 15_000 })
      .toBe(1)
    const reply = await bob.newPrivateReply(letter)
    const quiet = relay.received.length
    const answered = await publish(bob, reply.id!, false)
    expect(answered.relaySend).toBeUndefined()
    expect(relay.received.length, 'unticked: nothing was sent').toBe(quiet)
    const sent = await bob.postToRelays(answered.envelopeHash as string)
    expect(sent).toMatchObject({ posted: 1, sealed: true })
    await expect.poll(() => relay.received.length, { timeout: 10_000 }).toBe(quiet + 1)
    expect(relay.received[quiet]!.pubkey).not.toBe(ev.pubkey)
    expect(relay.received[quiet]!.pubkey).not.toBe(bobId.nostrPubkey)
    await expect.poll(() => held(alice, answered.envelopeHash as string), { timeout: 15_000 }).toBe(true)
  } finally {
    await alice.close()
    await bob.close()
    await carol.close()
    await relay.close()
    rmSync(bobDir, { recursive: true, force: true })
  }
})

test('a relay cannot slip anything past the sealed path', async () => {
  const relay = await startRelay()
  const shell = await launchShell()
  try {
    await connected(shell, relay)
    const me = await shell.identity()
    const myPub = Uint8Array.from(Buffer.from(me.nostrPubkey, 'hex'))
    const stranger = secp256k1.utils.randomSecretKey()
    const now = Math.floor(Date.now() / 1000)
    const forMe = await buildSealedBundle(nostrSigner(stranger), [myPub])
    // Also ours, but sent with the wrong hash: if that check were missing it
    // would be kept, and the count below would be two.
    const mislabelled = await buildSealedBundle(nostrSigner(stranger), [myPub], { created: 6 })
    const forSomeoneElse = await buildSealedBundle(nostrSigner(stranger), [schnorr.getPublicKey(secp256k1.utils.randomSecretKey())])
    const publicTar = await buildBundle(ethSigner(stranger), { type: 'memo', program: new TextEncoder().encode('<p>hi</p>') })
    const hexOf = (b: Uint8Array): string => sha256(Buffer.from(b))

    // Bytes that are not what the tag says; a public letter dressed as sealed;
    // and a sealed letter that is simply not for us.
    relay.broadcast(
      await buildThingEvent({ envelopeHash: hexOf(forSomeoneElse), type: 'sealed', bundle: mislabelled, createdAt: now }, secp256k1.utils.randomSecretKey())
    )
    relay.broadcast(
      await buildThingEvent({ envelopeHash: hexOf(publicTar), type: 'sealed', bundle: publicTar, createdAt: now }, secp256k1.utils.randomSecretKey())
    )
    relay.broadcast(await buildSealedEvent(forSomeoneElse, now))
    // Then one that is ours, to know the three before it were dealt with.
    relay.broadcast(await buildSealedEvent(forMe, now))

    await expect.poll(async () => (await shell.feed({ toMe: true })).length, { timeout: 15_000 }).toBe(1)
    expect((await shell.feed({ limit: 500 })).length, 'nothing else was kept').toBe(1)
    expect(await shell.seedHas(hexOf(forMe))).toBe(true)
    expect(await shell.seedHas(hexOf(publicTar))).toBe(false)
    expect(await shell.seedHas(hexOf(forSomeoneElse))).toBe(false)
    expect(await shell.seedHas(hexOf(mislabelled))).toBe(false)
  } finally {
    await shell.close()
    await relay.close()
  }
})
