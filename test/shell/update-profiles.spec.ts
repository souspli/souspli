import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import electronPath from 'electron'
import { test, expect, launchShell, type ShellHandle } from './helpers.js'

// ── Updating with several profiles open ──────────────────────────────────────
// An update replaces the app every profile runs from. Left to itself the
// Windows installer kills the other copies outright, and the macOS one waits
// for them for ever; on every platform only the default profile comes back.
// So the copy installing asks the others to save and quit, writes down what
// was open, and whatever the installer reopens reopens the rest.

const SHELL_MAIN = join(__dirname, '..', '..', 'out', 'main', 'shell', 'main.js')
const VERSION = (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version

test.beforeEach(() => test.setTimeout(120_000))

type ModeState = { activeMode: 'view' | 'edit'; editWcId: number | null } | null

async function chromeEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

async function editEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const s = (electron.app as unknown as { __shell: { modeState: () => ModeState } }).__shell.modeState()
    if (s?.editWcId == null) throw new Error('no edit cage')
    const wc = electron.webContents.fromId(s.editWcId)
    if (!wc || wc.isDestroyed()) throw new Error('edit cage gone')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

const pidOf = (shell: ShellHandle): Promise<number> => shell.app.evaluate(async () => process.pid)
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

test('installing in one profile closes the others properly, saving their edits, and plans to reopen them', async () => {
  const profiles = mkdtempSync(join(tmpdir(), 'shell-profiles-'))
  const exitLog = join(profiles, 'exit.log')
  // A long autosave pause, so Bob's edit is certainly still unsaved when the
  // request arrives: only saving on quit can keep it.
  const env = { SHELL_PROFILES_DIR: profiles, SHELL_EXIT_LOG: exitLog, SHELL_AUTOSAVE_MS: '60000' }
  const alice = await launchShell({ profile: 'alice', extraEnv: env })
  const bob = await launchShell({ profile: 'bob', extraEnv: env })
  const [alicePid, bobPid] = [await pidOf(alice), await pidOf(bob)]
  try {
    // Each sees the other.
    await expect
      .poll(() => alice.app.evaluate(async (e) => (e.app as unknown as { __shell: { installPlan: () => unknown } }).__shell.installPlan()))
      .toEqual({ others: ['bob'] })

    // Bob is halfway through a draft.
    const draft = await bob.newDraft('starter:memo')
    await chromeEval(bob, `window.__shellChrome.openThing(${JSON.stringify(draft.id)})`)
    await expect
      .poll(() => editEval<boolean>(bob, `!!document.getElementById('edit-subject')`).catch(() => false), { timeout: 15_000 })
      .toBe(true)
    await editEval(
      bob,
      `(() => { const i = document.getElementById('edit-subject'); i.value = 'words not yet saved'; i.dispatchEvent(new Event('input')) })()`
    )
    // Let the program's draft reach main (it is pending, not saved).
    await new Promise((r) => setTimeout(r, 1500))
    expect(JSON.stringify((await bob.drafts()).find((d) => d.id === draft.id)?.args ?? null)).not.toContain('words not yet saved')

    // Alice installs (everything up to the installer itself).
    const r = await alice.app.evaluate(async (e) =>
      (e.app as unknown as { __shell: { prepareInstall: (v: string) => Promise<unknown> } }).__shell.prepareInstall('99.0.0')
    )
    expect(r).toEqual({ closed: ['bob'] })

    // Bob is gone, and went properly: by request, not by being killed.
    await expect.poll(() => gone(bobPid), { timeout: 10_000 }).toBe(true)
    expect(readFileSync(exitLog, 'utf8')).toContain('"quitReason":"update-requested"')
    // Alice is still here (the installer is what closes her).
    expect(gone(alicePid)).toBe(false)

    // The plan: reopen both, in the new version.
    const plan = JSON.parse(readFileSync(join(profiles, '.instances', 'relaunch.json'), 'utf8')) as Record<string, unknown>
    expect(plan).toMatchObject({ version: '99.0.0', profiles: ['alice', 'bob'] })
    // The request is withdrawn once they have gone, so no later copy obeys it.
    expect(existsSync(join(profiles, '.instances', 'quit-for-update.json'))).toBe(false)
  } finally {
    await alice.close()
    await bob.close().catch(() => undefined)
  }

  // Bob's edit was saved on the way out.
  const bobAgain = await launchShell({ profile: 'bob', extraEnv: { SHELL_PROFILES_DIR: profiles } })
  try {
    const drafts = await bobAgain.drafts()
    expect(JSON.stringify(drafts.map((d) => d.args))).toContain('words not yet saved')
  } finally {
    await bobAgain.close()
    rmSync(profiles, { recursive: true, force: true })
  }
})

/** Start the app the way an installer does: no profile, nothing else. */
function startDefault(env: Record<string, string>): Promise<number | null> {
  // --no-sandbox as the whole suite runs (Playwright adds it to every launch).
  const child = spawn(electronPath as unknown as string, ['--no-sandbox', SHELL_MAIN], {
    env: { ...process.env, SHELL_FORCE_SOFTWARE_KEYS: '1', SHELL_NO_WELCOME: '1', SHELL_NO_UPDATE_PROMPT: '1', ...env },
    stdio: 'ignore'
  })
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      child.kill()
      resolve(null)
    }, 20_000)
    child.on('exit', (code) => {
      clearTimeout(t)
      resolve(code)
    })
  })
}

test('the copy an installer reopens reopens the profiles that were open, and steps aside', async () => {
  const profiles = mkdtempSync(join(tmpdir(), 'shell-profiles-'))
  const data = mkdtempSync(join(tmpdir(), 'shell-default-'))
  const log = join(profiles, 'relaunch.log')
  try {
    mkdirSync(join(profiles, '.instances'), { recursive: true })
    writeFileSync(
      join(profiles, '.instances', 'relaunch.json'),
      JSON.stringify({ version: VERSION, profiles: ['alice', 'bob', '../evil'], at: Date.now() })
    )
    const code = await startDefault({ SHELL_PROFILES_DIR: profiles, SHELL_USER_DATA_DIR: data, SHELL_RELAUNCH_LOG: log })
    // The default profile was not open before the update, so it does not stay.
    expect(code).toBe(0)
    const launched = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
    // Each profile reopened by name; a name that is not one is not passed on.
    expect(launched).toEqual([
      ['--profile', 'alice'],
      ['--profile', 'bob']
    ])
    // Taken once.
    expect(existsSync(join(profiles, '.instances', 'relaunch.json'))).toBe(false)
  } finally {
    rmSync(profiles, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  }
})

test('a plan for another version is left alone, and the default profile stays when it was open', async () => {
  const profiles = mkdtempSync(join(tmpdir(), 'shell-profiles-'))
  const log = join(profiles, 'relaunch.log')
  try {
    mkdirSync(join(profiles, '.instances'), { recursive: true })
    const planPath = join(profiles, '.instances', 'relaunch.json')
    // The install failed and the old version started again: nothing happens.
    writeFileSync(planPath, JSON.stringify({ version: '99.0.0', profiles: ['alice'], at: Date.now() }))
    const old = await launchShell({ extraEnv: { SHELL_PROFILES_DIR: profiles, SHELL_RELAUNCH_LOG: log } })
    await old.close()
    expect(existsSync(log)).toBe(false)
    expect(existsSync(planPath)).toBe(true)

    // The default profile was one of those open: it reopens Alice and stays.
    writeFileSync(planPath, JSON.stringify({ version: VERSION, profiles: [null, 'alice'], at: Date.now() }))
    const shell = await launchShell({ extraEnv: { SHELL_PROFILES_DIR: profiles, SHELL_RELAUNCH_LOG: log } })
    try {
      expect(readFileSync(log, 'utf8').trim()).toBe(JSON.stringify(['--profile', 'alice']))
      expect(gone(await pidOf(shell))).toBe(false)
    } finally {
      await shell.close()
    }
  } finally {
    rmSync(profiles, { recursive: true, force: true })
  }
})
