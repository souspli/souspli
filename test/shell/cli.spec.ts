import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, launchShell, type ShellHandle } from './helpers.js'

// ── The command line, and profiles ───────────────────────────────────────────
// `souspli` with a command prints and exits without taking the single-instance
// lock (so it never wakes a running window); `--profile` runs a profile of its
// own, side by side with any other. Profiles go to a temp folder here
// (SHELL_PROFILES_DIR), never the real one.

const electronPath = createRequire(__filename)('electron') as unknown as string
const SHELL_MAIN = join(__dirname, '..', '..', 'out', 'main', 'shell', 'main.js')
const CLI_ENTRY = join(__dirname, '..', '..', 'out', 'main', 'shell', 'cli.js')
const profiles = realpathSync(mkdtempSync(join(tmpdir(), 'shell-profiles-')))
const env = { SHELL_PROFILES_DIR: profiles }

interface Ran {
  code: number | null
  out: string
  err: string
}

/** Run the app's own entry with arguments, as `souspli …` does. */
function souspli(args: string[], input?: string, nodeMode = false): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, SHELL_FORCE_SOFTWARE_KEYS: '1' }
    delete childEnv.SHELL_USER_DATA_DIR
    if (nodeMode) childEnv.ELECTRON_RUN_AS_NODE = '1'
    else delete childEnv.ELECTRON_RUN_AS_NODE
    const argv = nodeMode ? [CLI_ENTRY, ...args] : ['--no-sandbox', SHELL_MAIN, ...args]
    const child = spawn(electronPath, argv, { env: childEnv })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`souspli ${args.join(' ')} did not exit: a command must never stay running`))
    }, 30_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      // Windows: CRLF, and Electron's console attach can put a blank line
      // first. Compare what was said, not how the platform framed it.
      const norm = (t: string) => t.replace(/\r\n/g, '\n').replace(/^\n/, '')
      resolve({ code, out: norm(out), err: norm(err) })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

const title = (s: ShellHandle) =>
  s.app.evaluate(async (electron) => electron.BaseWindow.getAllWindows()[0]?.getTitle() ?? null) as Promise<string | null>
const identityOf = async (s: ShellHandle) =>
  s.app.evaluate(async (electron) => {
    const wc = electron.webContents.getAllWebContents().find((w) => w.getURL().includes('shell/chrome'))!
    return wc.executeJavaScript('window.shell.identity()') as never
  }) as Promise<{ address: string; nostrPubkey: string }>

test('version and help print and exit; an unknown command is refused with the help', async () => {
  for (const args of [['version'], ['--version'], ['-v']]) {
    const r = await souspli(args)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^souspli \d+\.\d+\.\d+\n$/)
  }
  for (const args of [['help'], ['--help'], ['-h']]) {
    const r = await souspli(args)
    expect(r.code).toBe(0)
    expect(r.out).toContain('Usage: souspli [--profile <name>] [command]')
    expect(r.out).toContain('profile delete <n>')
  }
  const bad = await souspli(['frobnicate'])
  expect(bad.code).toBe(2)
  expect(bad.err).toContain('unknown command: frobnicate')
  expect(bad.err).toContain('Usage:')
  expect((await souspli(['--profile', '../etc'])).code).toBe(2)
  expect((await souspli(['profiles'])).out).toBe('No profiles. souspli --profile <name> creates one.\n')
})

test('profiles run side by side, each its own identity, title and folder; commands never wake them', async () => {
  test.setTimeout(90_000) // two app launches and a dozen command runs; Windows is slow at both
  const alice = await launchShell({ profile: 'alice', extraEnv: env })
  const bob = await launchShell({ profile: 'bob', extraEnv: env })
  try {
    // Both up at once: the lock is per profile.
    expect(await title(alice)).toBe('Souspli - alice')
    expect(await title(bob)).toBe('Souspli - bob')
    expect(await alice.app.evaluate(async (electron) => electron.app.getPath('userData'))).toBe(join(profiles, 'alice'))
    const a = await identityOf(alice)
    const b = await identityOf(bob)
    expect(a.address).not.toBe(b.address)

    // identity prints the public keys, read without the keychain.
    const id = await souspli(['--profile', 'alice', 'identity'])
    expect(id.code, id.err).toBe(0)
    expect(id.out).toContain('profile:  alice')
    expect(id.out.toLowerCase()).toContain(`address:  0x${a.address.toLowerCase()}`)
    expect(id.out).toContain(`nostr:    ${a.nostrPubkey}`)

    // profiles lists both, as running, with their short addresses.
    const list = await souspli(['profiles'])
    expect(list.code, list.err).toBe(0)
    expect(list.out).toMatch(/^alice\s+0x\S+…\S+\s+\(running\)\nbob\s+0x\S+…\S+\s+\(running\)\n$/)

    // A command while a profile runs did not take its lock or close it.
    expect(await title(alice)).toBe('Souspli - alice')

    // A running profile cannot be deleted.
    const refused = await souspli(['profile', 'delete', 'alice', '--yes'])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('is open')
    expect(existsSync(join(profiles, 'alice', 'identity.key.enc'))).toBe(true)
  } finally {
    await alice.close()
    await bob.close()
  }

  // Closed, it can, but only by typing its name. On Windows the prompt is
  // answered through the node-mode entry (souspli.cmd): a windowed .exe cannot
  // read the console, and says so rather than wait.
  const viaCmd = process.platform === 'win32'
  if (viaCmd) {
    const exe = await souspli(['profile', 'delete', 'alice'], 'alice\n')
    expect(exe.code).toBe(1)
    expect(exe.err).toContain('use souspli.cmd')
  }
  const wrong = await souspli(['profile', 'delete', 'alice'], 'alicia\n', viaCmd)
  expect(wrong.code).toBe(1)
  expect(wrong.out).toContain('cannot be recovered')
  expect(wrong.out).toContain('Not deleted.')
  expect(existsSync(join(profiles, 'alice'))).toBe(true)
  const right = await souspli(['profile', 'delete', 'alice'], 'alice\n', viaCmd)
  expect(right.code).toBe(0)
  expect(right.out).toContain('Deleted profile "alice".')
  expect(existsSync(join(profiles, 'alice'))).toBe(false)
  expect((await souspli(['profiles'])).out).toMatch(/^bob\s+0x\S+…\S+\n$/)
  expect((await souspli(['--profile', 'alice', 'identity'])).code).toBe(1)
})

test('the same commands without the app (souspli.cmd on Windows runs this way)', async () => {
  // A profile of its own, so this does not depend on the test above.
  const carol = await launchShell({ profile: 'carol', extraEnv: env })
  await carol.close()
  const viaApp = await souspli(['--profile', 'carol', 'identity'])
  expect(viaApp.code, viaApp.err).toBe(0)
  const viaNode = await souspli(['--profile', 'carol', 'identity'], undefined, true)
  expect(viaNode.code, viaNode.err).toBe(0)
  expect(viaNode.out).toBe(viaApp.out)
  expect((await souspli(['profiles'], undefined, true)).out).toBe((await souspli(['profiles'])).out)
  expect((await souspli(['version'], undefined, true)).out).toBe((await souspli(['version'])).out)
  const del = await souspli(['profile', 'delete', 'carol', '--yes'], undefined, true)
  expect(del.code, del.err).toBe(0)
  expect(existsSync(join(profiles, 'carol'))).toBe(false)
})

test('without a profile nothing mentions one', async () => {
  const shell = await launchShell()
  try {
    expect(await title(shell)).toBe('Souspli')
  } finally {
    await shell.close()
  }
})
