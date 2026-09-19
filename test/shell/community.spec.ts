import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, jsToCbor, type ShellHandle } from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'

// ── The suggested community ──────────────────────────────────────────────────
// After the welcome letter there was nobody to talk to. The app now SUGGESTS the
// project's relay and welcome forum. What these pin is the word "suggests": the
// relay list starts empty and stays empty, no socket is opened and no letter
// admitted, until a person has been shown what it costs and pressed yes.

let relay: TestRelay
let shell: ShellHandle
let forumB64: string
let forumHash: string

test.beforeAll(async () => {
  relay = await startRelay()
  // A stand-in for the welcome forum: a group letter signed by "the project".
  const bundle = await buildBundle(ethSigner(secp256k1.utils.randomSecretKey()), {
    type: 'group',
    args: jsToCbor({ name: 'Souspli — welcome', purpose: 'Say hello.', notes: '', members: [] })
  })
  forumB64 = Buffer.from(bundle).toString('base64')
  shell = await launchShell({ extraEnv: { SHELL_SUGGESTED_RELAY: relay.url, SHELL_WELCOME_FORUM_B64: forumB64 } })
  forumHash = String((await chromeEval<{ forumHash: string }>(`window.shell.community()`)).forumHash)
})
test.afterAll(async () => {
  await shell?.close()
  await relay?.close()
})

async function chromeEval<T>(js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

test('it is offered, and until someone says yes nothing at all has happened', async () => {
  await expect
    .poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid=welcome-people]')`), { timeout: 15_000 })
    .toBe(true)
  // Offered is not done: no relay, no connection, no forum in the library.
  expect((await shell.relays()).relays).toEqual([])
  expect(relay.connections(), 'no socket was opened to make the offer').toBe(0)
  expect(await shell.feed()).toEqual([])

  // Opening the dialog is still not doing it -- and the dialog says what it costs.
  await chromeEval(`document.querySelector('[data-testid=welcome-people]').click()`)
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid=community-modal]')`), { timeout: 10_000 }).toBe(true)
  const text = await chromeEval<string>(`document.querySelector('[data-testid=community-modal]').innerText`)
  expect(text).toContain(relay.url)
  expect(text).toMatch(/learns your IP address/i)
  expect(text).toMatch(/strangers can reach you/i)
  expect(text).toMatch(/nothing of yours is sent/i)
  expect(text).toMatch(/remove it again/i)
  expect((await shell.relays()).relays).toEqual([])
  expect(relay.connections()).toBe(0)

  // "Not now" is a complete answer.
  await chromeEval(`[...document.querySelectorAll('[data-testid=community-modal] .evm-modal-footer button')][0].click()`)
  expect((await shell.relays()).relays).toEqual([])
  expect(await shell.feed()).toEqual([])
})

test('saying yes adds the relay and the forum, through the ordinary gate, and the offer is spent', async () => {
  await chromeEval(`document.querySelector('[data-testid=welcome-people]').click()`)
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid=community-join]')`), { timeout: 10_000 }).toBe(true)
  await chromeEval(`document.querySelector('[data-testid=community-join]').click()`)

  await expect.poll(async () => (await shell.relays()).relays.map((r) => r.url), { timeout: 15_000 }).toEqual([relay.url])
  await expect.poll(() => relay.connections(), { timeout: 15_000 }).toBeGreaterThan(0)
  // The forum is an ordinary admitted letter -- and a forum.
  // (Admitted a moment after the relay is added: the add is synchronous, the
  // gate is not.)
  await expect.poll(async () => (await shell.feed()).map((r) => r.envelopeHash), { timeout: 15_000 }).toEqual([forumHash])
  expect((await shell.forums()).map((f) => f.root)).toContain(forumHash)
  // Nothing of theirs went anywhere.
  expect(relay.received).toEqual([])

  // Spent: no offer in the empty state, the Relays window or the Forums window.
  await chromeEval(`document.querySelectorAll('.evm-modal-overlay').forEach((o) => o.remove())`)
  await chromeEval(`window.__shellChrome.openRelays()`)
  await chromeEval(`window.__shellChrome.openForums()`)
  await new Promise((r) => setTimeout(r, 600))
  expect(await chromeEval<number>(`document.querySelectorAll('[data-testid=community-offer], [data-testid=welcome-people]').length`)).toBe(0)
})

test('the Relays and Forums windows make the same offer while they are empty', async () => {
  const fresh = await launchShell({ extraEnv: { SHELL_SUGGESTED_RELAY: relay.url, SHELL_WELCOME_FORUM_B64: forumB64 } })
  try {
    const ev = <T>(js: string): Promise<T> =>
      fresh.app.evaluate(async (electron, code) => {
        const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
        return (await wc!.executeJavaScript(code)) as never
      }, js)
    await ev(`window.__shellChrome.openRelays()`)
    await expect.poll(() => ev<number>(`document.querySelectorAll('[data-testid=community-offer]').length`), { timeout: 15_000 }).toBe(1)
    await ev(`document.querySelectorAll('.evm-modal-overlay').forEach((o) => o.remove())`)
    await ev(`window.__shellChrome.openForums()`)
    await expect.poll(() => ev<number>(`document.querySelectorAll('[data-testid=community-offer]').length`), { timeout: 15_000 }).toBe(1)
    expect((await fresh.relays()).relays).toEqual([])
  } finally {
    await fresh.close()
  }
})

test('with no forum letter bundled, the offer is the relay alone', async () => {
  const plain = await launchShell({ extraEnv: { SHELL_SUGGESTED_RELAY: relay.url, SHELL_WELCOME_FORUM_B64: '' } })
  try {
    const c: Record<string, unknown> = await plain.app.evaluate(async (electron) => {
      const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
      return (await wc!.executeJavaScript(`window.shell.community()`)) as never
    })
    expect(c).toMatchObject({ relay: relay.url, relayAdded: false, forumAvailable: false, forumHeld: false })
  } finally {
    await plain.close()
  }
})
