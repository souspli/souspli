// ── The command line ─────────────────────────────────────────────────────────
//
//   souspli                         the app, as always (one window; running it
//                                   again brings that window forward)
//   souspli --profile joe           the app as profile "joe": its own identity
//                                   and library, made the first time
//   souspli version | --version     print the version
//   souspli help | --help           print this
//   souspli identity                print your public keys
//   souspli profiles                list profiles
//   souspli profile delete joe      delete one, after asking
//
// Used from two places: main.ts, at the very top (Linux, macOS, and the .exe
// run directly), and cli-entry.ts under ELECTRON_RUN_AS_NODE, which is how the
// Windows souspli.cmd gets output onto the console. So this file uses Node
// only: no Electron, no keychain. Public keys come from identity.pub.json,
// written next to the encrypted key (keyring/index.ts).
//
// Profiles live in <the default data folder>/profiles/<name>. Someone who never
// uses one never sees the word: the default profile is the folder the app has
// always used, and nothing about it changes.

import { existsSync, lstatSync, openSync, closeSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { shortAddress, toChecksumAddress } from './address.js'

export type Command = 'gui' | 'version' | 'help' | 'identity' | 'profiles' | 'profile-delete'

export interface ParsedArgs {
  command: Command
  profile: string | null
  /** The profile `profile delete` acts on. */
  target: string | null
  yes: boolean
  /** .thing files to open (the GUI's business). */
  files: string[]
  error: string | null
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** A profile name, lowercased so "Joe" and "joe" cannot be two folders on a
 *  case-insensitive disk, or null if it could name anything but one folder. */
export function profileName(raw: string): string | null {
  const n = raw.trim().toLowerCase()
  return PROFILE_NAME.test(n) ? n : null
}

/** Read the arguments after the executable (and, unpackaged, the entry script).
 *
 *  Flags this does not know are ignored, not errors: Chromium switches, an
 *  AppImage's --no-sandbox, a test harness's --inspect, and macOS's -psn_…
 *  all arrive here and must not stop the app. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { command: 'gui', profile: null, target: null, yes: false, files: [], error: null }
  const words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile' || a.startsWith('--profile=')) {
      const value = a === '--profile' ? argv[++i] : a.slice('--profile='.length)
      if (value === undefined || value === '' || value.startsWith('-')) {
        out.error = '--profile needs a name'
        continue
      }
      const name = profileName(value)
      if (!name) out.error = `"${value}" is not a profile name: use 1 to 32 letters, digits, - or _`
      else out.profile = name
    } else if (a === '--version' || a === '-v') words.push('version')
    else if (a === '--help' || a === '-h') words.push('help')
    else if (a === '--yes' || a === '-y') out.yes = true
    else if (a.startsWith('-')) continue // somebody else's flag
    else if (a.toLowerCase().endsWith('.thing')) out.files.push(a)
    else if (a.toLowerCase().endsWith('.js')) continue // the entry script, unpackaged
    else words.push(a)
  }
  if (out.error) return out
  const [first, ...rest] = words
  if (first === undefined) return out
  if (first === 'version' || first === 'help' || first === 'identity' || first === 'profiles') {
    out.command = first
  } else if (first === 'profile') {
    if (rest[0] !== 'delete') {
      out.error = rest[0] ? `unknown: profile ${rest[0]}` : 'profile what? (profile delete <name>)'
      return out
    }
    if (!rest[1]) {
      out.error = 'profile delete needs a name'
      return out
    }
    const name = profileName(rest[1])
    if (!name) {
      out.error = `"${rest[1]}" is not a profile name`
      return out
    }
    out.command = 'profile-delete'
    out.target = name
  } else {
    out.error = `unknown command: ${first}`
  }
  return out
}

export const HELP = `Usage: souspli [--profile <name>] [command]

With no command, opens Souspli. If it is already open, brings that window
forward. A .thing file named on the command line is opened in it.

Commands:
  version              Print the version.
  help                 Print this help.
  identity             Print your public keys: the address your letters are
                       signed with, and your Nostr key.
  profiles             List profiles.
  profile delete <n>   Delete profile <n>, its identity and its letters. Asks
                       you to type the name first; --yes skips that.

Options:
  --profile <name>     Use profile <name>: its own identity and library,
                       created the first time. Profiles run side by side, each
                       in its own window. Commands act on it too, e.g.
                       souspli --profile joe identity
  --version, -v        Same as version.
  --help, -h           Same as help.

Examples:
  souspli --profile alice
  souspli --profile bob identity
  souspli profiles
`

// ── Where things live ────────────────────────────────────────────────────────

/** Electron's userData for this app, worked out without Electron (the app sets
 *  its name to "Souspli" on every OS). Under Electron, main passes its own. */
export function defaultUserData(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Souspli')
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Souspli')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Souspli')
}

export function profilesDir(defaultData: string): string {
  return process.env.SHELL_PROFILES_DIR || join(defaultData, 'profiles')
}

export interface PublicIdentity {
  v: 1
  scheme: string
  address: string
  nostrPubkey: string
  storage: 'os' | 'software'
}

export const PUBLIC_IDENTITY_FILE = 'identity.pub.json'
export const PRIVATE_IDENTITY_FILE = 'identity.key.enc'

export function readPublicIdentity(dir: string): PublicIdentity | null {
  try {
    const j = JSON.parse(readFileSync(join(dir, PUBLIC_IDENTITY_FILE), 'utf8')) as Partial<PublicIdentity>
    if (typeof j.address !== 'string' || typeof j.nostrPubkey !== 'string') return null
    return {
      v: 1,
      scheme: typeof j.scheme === 'string' ? j.scheme : 'eth-eip191',
      address: j.address,
      nostrPubkey: j.nostrPubkey,
      storage: j.storage === 'os' ? 'os' : 'software'
    }
  } catch {
    return null
  }
}

/** Whether a Souspli is running on this data folder right now, read from the
 *  single-instance lock Chromium keeps there: a SingletonLock symlink naming
 *  host-pid on Linux and macOS, and a lockfile held open on Windows. */
export function isRunning(dir: string): boolean {
  if (process.platform === 'win32') {
    const lock = join(dir, 'lockfile')
    if (!existsSync(lock)) return false
    try {
      closeSync(openSync(lock, 'r+'))
      return false
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
    }
  }
  const lock = join(dir, 'SingletonLock')
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false
    const target = readlinkSync(lock)
    const dash = target.lastIndexOf('-')
    const host = target.slice(0, dash)
    const pid = Number(target.slice(dash + 1))
    if (!Number.isInteger(pid) || pid <= 0) return false
    if (host !== hostname()) return true // another machine's lock on a shared folder: treat as live
    process.kill(pid, 0) // throws if that process is gone
    return true
  } catch {
    return false
  }
}

// ── Running a command ────────────────────────────────────────────────────────

export interface CliContext {
  version: string
  /** The default profile's data folder (Electron's userData, before --profile). */
  defaultData: string
  write(text: string): Promise<void>
  writeErr(text: string): Promise<void>
  /** Read one line from the terminal. */
  ask(question: string): Promise<string>
  /** Under Electron only: decrypt an identity that has no public file yet, and
   *  write that file. Node-mode callers cannot reach the keychain. */
  recoverPublicIdentity?(dir: string): Promise<PublicIdentity | null>
}

export function nodeContext(version: string): CliContext {
  const writeTo = (stream: NodeJS.WriteStream) => (text: string) =>
    new Promise<void>((resolve) => {
      stream.write(text, () => resolve())
    })
  return {
    version,
    defaultData: defaultUserData(),
    write: writeTo(process.stdout),
    writeErr: writeTo(process.stderr),
    ask: (question) =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        rl.question(question, (answer) => {
          rl.close()
          resolve(answer)
        })
      })
  }
}

/** Run a command that is not the GUI. Prints, and returns the exit code. */
export async function runCommand(p: ParsedArgs, ctx: CliContext): Promise<number> {
  if (p.error) {
    await ctx.writeErr(`souspli: ${p.error}\n\n${HELP}`)
    return 2
  }
  const base = profilesDir(ctx.defaultData)
  switch (p.command) {
    case 'version':
      await ctx.write(`souspli ${ctx.version}\n`)
      return 0
    case 'help':
      await ctx.write(HELP)
      return 0
    case 'identity': {
      const dir = p.profile ? join(base, p.profile) : process.env.SHELL_USER_DATA_DIR || ctx.defaultData
      if (!existsSync(join(dir, PRIVATE_IDENTITY_FILE))) {
        await ctx.writeErr(
          p.profile
            ? `souspli: there is no profile "${p.profile}" yet. souspli --profile ${p.profile} creates it.\n`
            : 'souspli: no identity yet. Open Souspli once to create one.\n'
        )
        return 1
      }
      const id = readPublicIdentity(dir) ?? (await ctx.recoverPublicIdentity?.(dir)) ?? null
      if (!id) {
        await ctx.writeErr('souspli: open this profile once in Souspli to make its public keys readable here.\n')
        return 1
      }
      const lines = [
        ...(p.profile ? [`profile:  ${p.profile}`] : []),
        `address:  ${toChecksumAddress(id.address)}  (${id.scheme})`,
        `nostr:    ${id.nostrPubkey}`,
        `storage:  ${id.storage === 'os' ? 'OS keychain' : 'software (not protected by the OS)'}`
      ]
      await ctx.write(`${lines.join('\n')}\n`)
      return 0
    }
    case 'profiles': {
      const names = existsSync(base)
        ? readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory() && profileName(d.name) === d.name)
            .map((d) => d.name)
            .sort()
        : []
      if (names.length === 0) {
        await ctx.write('No profiles. souspli --profile <name> creates one.\n')
        return 0
      }
      const rows = names.map((n) => {
        const dir = join(base, n)
        const id = readPublicIdentity(dir)
        const addr = id ? shortAddress(id.address) : existsSync(join(dir, PRIVATE_IDENTITY_FILE)) ? '(open it once to see)' : '(no identity yet)'
        return `${n.padEnd(20)} ${addr}${isRunning(dir) ? '  (running)' : ''}`
      })
      await ctx.write(`${rows.join('\n')}\n`)
      return 0
    }
    case 'profile-delete': {
      const name = p.target!
      const dir = join(base, name)
      if (!existsSync(dir)) {
        await ctx.writeErr(`souspli: there is no profile "${name}".\n`)
        return 1
      }
      if (isRunning(dir)) {
        await ctx.writeErr(`souspli: profile "${name}" is open. Close its window first.\n`)
        return 1
      }
      const id = readPublicIdentity(dir)
      await ctx.write(
        [
          `This deletes profile "${name}": its identity${id ? ` (${toChecksumAddress(id.address)})` : ''} and every letter in it.`,
          `  ${dir}`,
          'The identity cannot be recovered. Letters it signed stay signed, but nothing can sign as it again.',
          ''
        ].join('\n')
      )
      if (!p.yes) {
        const typed = (await ctx.ask(`Type the profile name to delete it: `)).trim()
        if (typed !== name) {
          await ctx.write('Not deleted.\n')
          return 1
        }
      }
      rmSync(dir, { recursive: true, force: true })
      await ctx.write(`Deleted profile "${name}".\n`)
      return 0
    }
    default:
      return 0
  }
}
