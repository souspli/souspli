import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Running copies of Souspli, and updating them together ────────────────────
//
// Profiles are separate processes of ONE installed app. An update replaces
// that app, so it touches all of them, and each platform's installer handles
// the others badly:
//
//   Windows  the installer kills every copy running from the install folder
//            -- abruptly, nothing saved -- and reopens only the default
//            profile.
//   macOS    the installer waits until every copy has quit, however long,
//            then reopens the default profile.
//   AppImage the file the others run from is replaced under a new name, and
//            only the default profile is reopened.
//
// So before installing, the copy doing it asks the others to save and quit,
// and writes down which profiles were open. Whatever the installer reopens
// (the default profile, on every platform) reads that and reopens them.
//
// It is all files in one folder every profile can see, because the copies
// share nothing else: one record per running copy, kept fresh by a
// heartbeat; a request to quit; and the relaunch plan.

/** A copy that has not touched its record for this long is gone, whatever its
 *  pid says (a pid can be reused once its process has ended). */
const STALE_MS = 2 * 60_000
/** A quit request or relaunch plan older than this is left over from an
 *  update that never happened, and is ignored. */
const PLAN_MS = 30 * 60_000

export interface InstanceRecord {
  pid: number
  /** null: the default profile. */
  profile: string | null
  startedAt: number
}

export interface RegistryOptions {
  now?: () => number
  /** Whether a process exists. */
  alive?: (pid: number) => boolean
}

const QUIT_FILE = 'quit-for-update.json'
const PLAN_FILE = 'relaunch.json'

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: it exists, it is just not ours to signal.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class InstanceRegistry {
  private readonly now: () => number
  private readonly alive: (pid: number) => boolean
  readonly self: InstanceRecord

  constructor(
    private readonly dir: string,
    self: { pid: number; profile: string | null },
    opts: RegistryOptions = {}
  ) {
    this.now = opts.now ?? Date.now
    this.alive = opts.alive ?? processAlive
    this.self = { ...self, startedAt: this.now() }
    mkdirSync(dir, { recursive: true })
  }

  private recordPath(pid: number): string {
    return join(this.dir, `${pid}.json`)
  }

  /** Write a file whole, never half: these are read by other processes. */
  private writeJson(name: string, value: unknown): void {
    const tmp = join(this.dir, `.${name}.${this.self.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(value))
    renameSync(tmp, join(this.dir, name))
  }

  private readJson<T>(name: string): T | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as T
    } catch {
      return null
    }
  }

  /** Say this copy is running. Also the heartbeat: call it again to stay fresh. */
  register(): void {
    this.writeJson(`${this.self.pid}.json`, this.self)
  }

  unregister(): void {
    rmSync(this.recordPath(this.self.pid), { force: true })
  }

  /** Every other copy that is running now. Records of copies that are gone
   *  are removed on the way. */
  others(): InstanceRecord[] {
    const out: InstanceRecord[] = []
    let names: string[] = []
    try {
      names = readdirSync(this.dir)
    } catch {
      return out
    }
    for (const n of names) {
      const m = /^(\d+)\.json$/.exec(n)
      if (!m) continue
      const pid = Number(m[1])
      if (pid === this.self.pid) continue
      let fresh = false
      try {
        fresh = this.now() - statSync(join(this.dir, n)).mtimeMs < STALE_MS
      } catch {
        continue
      }
      const rec = this.readJson<InstanceRecord>(n)
      if (!fresh || !rec || rec.pid !== pid || !this.alive(pid)) {
        rmSync(join(this.dir, n), { force: true })
        continue
      }
      out.push({ pid, profile: typeof rec.profile === 'string' ? rec.profile : null, startedAt: Number(rec.startedAt) || 0 })
    }
    return out
  }

  /** Ask every other copy to save and quit, for an update. */
  requestQuit(): void {
    this.writeJson(QUIT_FILE, { by: this.self.pid, at: this.now() })
  }

  clearQuitRequest(): void {
    const r = this.readJson<{ by: number }>(QUIT_FILE)
    if (r?.by === this.self.pid) rmSync(join(this.dir, QUIT_FILE), { force: true })
  }

  /** Has another copy asked this one to quit? Only a request made after this
   *  copy started counts: one from an earlier update is not about it. */
  quitRequested(): boolean {
    const r = this.readJson<{ by: number; at: number }>(QUIT_FILE)
    if (!r || r.by === this.self.pid) return false
    return r.at >= this.self.startedAt && this.now() - r.at < PLAN_MS
  }

  /** Before installing: which profiles to reopen once the new version runs. */
  writeRelaunchPlan(version: string, profiles: (string | null)[]): void {
    const unique = [...new Set(profiles)]
    this.writeJson(PLAN_FILE, { version, profiles: unique, at: this.now() })
  }

  /** On start: the profiles to reopen, if this is the version an update was
   *  installing. Read once -- the plan is removed -- and ignored when stale,
   *  so a failed install cannot reopen things days later. */
  takeRelaunchPlan(version: string): (string | null)[] | null {
    const p = this.readJson<{ version: string; profiles: unknown[]; at: number }>(PLAN_FILE)
    if (!p) return null
    const stale = typeof p.at !== 'number' || this.now() - p.at > PLAN_MS
    if (stale || p.version === version) rmSync(join(this.dir, PLAN_FILE), { force: true })
    if (stale || p.version !== version || !Array.isArray(p.profiles)) return null
    return p.profiles.filter((x): x is string | null => x === null || typeof x === 'string')
  }
}
