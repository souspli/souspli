// The claim that is hard to believe until you watch it: the SAME forum, the
// same bytes, ranked differently in two libraries.
//
// Raw vote counts are free to manufacture — four throwaway keys cost nothing
// and can outshout anybody. What cannot be manufactured is a path that starts
// at YOUR key, so the ranking each reader sees is weighted by their own tribe.
// Two readers, identical content, different order.
//
// Driven through Playwright's Electron launcher like the magnet and relay
// scenarios, and for the same reason: this has to run the shipped ranking code
// rather than a copy of it that could drift.

import { join } from 'node:path'
import { _electron, type ElectronApplication } from 'playwright'
import { REPO_ROOT, accountDir, assertNotLive, releaseLock, takeLock } from './account.js'
import { bySlug, deriveRoster, type WorldAccount } from './roster.js'

const log = (s = ''): void => {
  process.stdout.write(`${s}\n`)
}

const SHELL_MAIN = join(REPO_ROOT, 'out', 'main', 'shell', 'main.js')

interface Instance {
  who: WorldAccount
  app: ElectronApplication
}

async function launch(who: WorldAccount): Promise<Instance> {
  const app = await _electron.launch({
    args: [SHELL_MAIN],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      SHELL_USER_DATA_DIR: accountDir(who.slug),
      SHELL_ALLOW_MULTI: '1',
      SHELL_FORCE_SOFTWARE_KEYS: '1',
      SHELL_NO_RELAUNCH: '1'
    } as Record<string, string>
  })
  takeLock(who.slug, 'forum view')
  const deadline = Date.now() + 30_000
  let lastErr: unknown = null
  for (;;) {
    try {
      // See magnet.ts: short evaluates, retried, because the inspector context
      // is torn down and rebuilt during startup.
      await app.evaluate('globalThis.__name = globalThis.__name || ((f) => f)')
      const ready = await app.evaluate(async (electron) => {
        const s = (electron.app as unknown as { __shell?: { ready?: boolean } }).__shell
        return Boolean(s?.ready)
      })
      if (ready) break
      lastErr = null
    } catch (e) {
      lastErr = e
    }
    if (Date.now() > deadline) {
      throw lastErr instanceof Error ? lastErr : new Error(`${who.slug} never became ready`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return { who, app }
}

function hook<T>(inst: Instance, body: string): Promise<T> {
  return inst.app.evaluate(async (electron, src) => {
    const shell = (electron.app as unknown as { __shell: Record<string, unknown> }).__shell
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function('shell', `return (async () => { ${src} })()`) as (s: unknown) => Promise<unknown>
    return (await fn(shell)) as never
  }, body)
}

interface Listing {
  rows: {
    envelopeHash: string
    type: string
    authorKey: string
    votes: { score: number; tribeScore: number; up: number; down: number; tribeUp: number; tribeDown: number }
    replies: number
    verdict: { verdict: string; byName: string; why: string } | null
    /** Set when this is an OFFER: a thing a relay said exists that this
     *  library does not hold, ranked beside the posts it competes with. */
    offered?: boolean
  }[]
  tribeEmpty: boolean
}

async function listingFor(
  inst: Instance,
  want: string
): Promise<{ name: string; root: string; listing: Listing } | null> {
  const forums = await hook<{ root: string; name: string; posts: number }[]>(inst, 'return shell.forums()')
  // Busiest by default. "The first one with posts" was fine with one forum and
  // silently picked the wrong one the moment there were two.
  const matching = want
    ? forums.filter((f) => f.name.toLowerCase().includes(want.toLowerCase()))
    : [...forums].sort((a, b) => b.posts - a.posts)
  const pick = matching[0]
  if (!pick) return null
  const listing = await hook<Listing>(inst, `return shell.forumListing(${JSON.stringify(pick.root)})`)
  return { name: pick.name, root: pick.root, listing }
}

/** A post's label. The listing carries facts ABOUT a thing, never its content,
 *  so there is no headline to print here -- type and hash is what the shell
 *  itself knows without opening anything. */
const label = (r: Listing['rows'][number]): string => `${r.type}:${r.envelopeHash.slice(0, 8)}`

function render(who: WorldAccount, listing: Listing): void {
  log('')
  log(`  ── as ${who.name} (${who.slug}) ──`)
  if (listing.tribeEmpty) {
    log('     tribe is EMPTY: this order is raw vote count, the kind anyone can manufacture.')
  }
  listing.rows.forEach((r, i) => {
    const tribe = r.votes.tribeUp + r.votes.tribeDown
    const flag =
      r.verdict?.verdict === 'hide'
        ? `  [hidden by ${r.verdict.byName}: ${r.verdict.why}]`
        : r.verdict?.verdict === 'endorse'
          ? `  [endorsed by ${r.verdict.byName}]`
          : ''
    // An offer ranks with the posts but is not one: nobody here has read it.
    const held = r.offered ? '  ← OFFERED, not fetched' : ''
    log(
      `     ${i + 1}. ${label(r).padEnd(24)}` +
        ` score ${String(r.votes.score).padStart(3)} · ${String(tribe).padStart(2)} from your tribe` +
        `${flag}${held}`
    )
  })
}

export async function runForum(argv: string[]): Promise<void> {
  const flag = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
  }
  const roster = deriveRoster()
  const a = bySlug(roster, flag('as', 'ada'))
  const b = bySlug(roster, flag('vs', 'linus'))
  const want = flag('forum', '')
  if (a.slug === b.slug) throw new Error('--as and --vs must be different accounts')
  assertNotLive(a.slug)
  assertNotLive(b.slug)

  log('NOTE: Playwright launches Electron with --no-sandbox. Layer 1 is not exercised by this test.')
  log('')

  const started: Instance[] = []
  try {
    const first = await launch(a)
    started.push(first)
    const second = await launch(b)
    started.push(second)

    const one = await listingFor(first, want)
    const two = await listingFor(second, want)
    if (!one || !two) {
      log('No forum with posts in one of those libraries — run `pnpm world seed` first.')
      process.exitCode = 1
      return
    }

    log(`forum: ${one.name}`)
    log(`root:  ${one.root}`)
    render(a, one.listing)
    render(b, two.listing)

    const orderA = one.listing.rows.map((r) => r.envelopeHash).join(',')
    const orderB = two.listing.rows.map((r) => r.envelopeHash).join(',')
    log('')
    if (orderA === orderB) {
      log('Both readers see the SAME order. That is not a bug on its own — it happens when')
      log('neither has vouched for anyone who voted — but the scenario is meant to show a')
      log('difference, so check `pnpm world seed` ran and that vouches exist.')
    } else {
      log('Different order, identical bytes. Nobody edited anything and no server decided:')
      log('each library weighted the same votes by whose vouches reach the voter.')
    }
  } finally {
    for (const inst of started) {
      try {
        await inst.app.close()
      } catch {
        /* closing a dead app is not a failure */
      }
      releaseLock(inst.who.slug)
    }
  }
}
