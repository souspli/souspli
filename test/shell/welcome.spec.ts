import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, type ShellHandle } from './helpers.js'

// ── First run ────────────────────────────────────────────────────────────────
// A new install used to open onto an empty window. It now opens onto a bundled
// welcome letter. What these pin is that the welcome is ORDINARY: it meets the
// same gate as a letter from a stranger, it is offered exactly once, and
// deleting it is final. Every other spec runs with SHELL_NO_WELCOME=1 (set in
// helpers) so that they go on counting from an empty library.

/** The frozen letter's identity (tools/welcome/make.ts prints it). If this
 *  changes, someone regenerated the letter -- which re-keys it, and should be a
 *  decision, not a side effect. */
const WELCOME_HASH = '4303399dadd35642b04ba702009fd728acdf2f4abd82644fa6d26f3fd4cedb0a'

const WELCOME_ON = { SHELL_NO_WELCOME: '0' }

async function chromeEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

const headerText = (shell: ShellHandle): Promise<string> =>
  chromeEval<string>(shell, `document.querySelector('.sh-thing-header').innerText`)

test('a first run opens onto the welcome letter, admitted like any other', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shell-welcome-'))
  let shell: ShellHandle | null = null
  try {
    shell = await launchShell({ extraEnv: { ...WELCOME_ON, SHELL_USER_DATA_DIR: dir } })
    await expect.poll(async () => (await shell!.feed()).length, { timeout: 15_000 }).toBe(1)
    const [row] = await shell.feed()
    expect(row!.envelopeHash).toBe(WELCOME_HASH)
    expect(row!.type).toBe('article')
    // Signed by a key that is not this install's: bundled is not "yours".
    expect(String(row!.authorKey).toLowerCase()).not.toBe((await shell.identity()).address.toLowerCase())

    // The chrome FOLLOWED main's open: a real trust header over a mounted
    // letter, not "Select a letter" over one. (The same path a double-clicked
    // file takes, which used to leave the header behind.)
    await expect.poll(() => headerText(shell!), { timeout: 15_000 }).toContain('✓ signed')
    expect(
      await chromeEval<string | null>(
        shell,
        `document.querySelector('.sh-thing-header').getAttribute('data-envelope-hash')`
      )
    ).toBe(WELCOME_HASH)
    // The pane belongs to the EMPTY state; a mounted letter owns the area.
    expect(await chromeEval<boolean>(shell, `!!document.querySelector('[data-testid=welcome-pane]')`)).toBe(false)
  } finally {
    await shell?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('it is offered once: no duplicate on relaunch, and deleting it is final', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shell-welcome-'))
  const env = { ...WELCOME_ON, SHELL_USER_DATA_DIR: dir }
  let shell: ShellHandle | null = null
  try {
    shell = await launchShell({ extraEnv: env })
    await expect.poll(async () => (await shell!.feed()).length, { timeout: 15_000 }).toBe(1)
    await shell.close()

    shell = await launchShell({ extraEnv: env })
    expect((await shell.feed()).length).toBe(1)
    // Nothing is opened for you the second time: you get the empty state,
    // which now says what this is and offers the two ways in.
    await expect
      .poll(() => chromeEval<boolean>(shell!, `!!document.querySelector('[data-testid=welcome-pane]')`), {
        timeout: 15_000
      })
      .toBe(true)
    expect(await headerText(shell)).toContain('Select a letter')

    const gone = await chromeEval<{ deleted: boolean }>(shell, `window.shell.deleteThing(${JSON.stringify(WELCOME_HASH)})`)
    expect(gone.deleted).toBe(true)
    await shell.close()

    shell = await launchShell({ extraEnv: env })
    // Give a wrongly-returning welcome time to arrive before concluding it did not.
    await new Promise((r) => setTimeout(r, 1500))
    expect(await shell.feed()).toEqual([])
  } finally {
    await shell?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a library that already holds something is left alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shell-welcome-'))
  let shell: ShellHandle | null = null
  try {
    // An existing user: a profile from before the welcome existed.
    shell = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: dir } })
    const theirs = await shell.ingest(await buildBundle(ethSigner(secp256k1.utils.randomSecretKey()), { type: 'note' }))
    expect(theirs.status).toBe('valid')
    await shell.close()

    shell = await launchShell({ extraEnv: { ...WELCOME_ON, SHELL_USER_DATA_DIR: dir } })
    await new Promise((r) => setTimeout(r, 1500))
    const feed = await shell.feed()
    expect(feed.map((r) => r.envelopeHash)).toEqual([theirs.envelopeHash])
  } finally {
    await shell?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the empty state offers the two ways in', async () => {
  const shell = await launchShell() // welcome off: a genuinely empty library
  try {
    await expect
      .poll(() => chromeEval<boolean>(shell, `!!document.querySelector('[data-testid=welcome-pane]')`), {
        timeout: 15_000
      })
      .toBe(true)
    // "Write a letter" is the New menu -- one way to start, not a second one.
    await chromeEval(shell, `document.querySelector('[data-testid=welcome-write]').click()`)
    await expect
      .poll(() => chromeEval<boolean>(shell, `!!document.querySelector('[data-testid=new-menu]')`), {
        timeout: 10_000
      })
      .toBe(true)
  } finally {
    await shell.close()
  }
})
