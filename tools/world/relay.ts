// The other two-machine test: one account POSTS a thing to a relay, another
// account — which was never handed anything and never asked for that thing —
// receives it.
//
// This is the property the hermetic spec can only assert in miniature. Here it
// is two real instances with two real keys, two real libraries, and a socket
// between them. By default the relay is a local one started in this process,
// so the scenario works offline; `--relay wss://…` points it at a real one.
//
// Same Playwright-launcher shape as the magnet scenario, and for the same
// reason: this needs a control channel into `app.__shell`, not just a process.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron, type ElectronApplication } from 'playwright'
import { REPO_ROOT, accountDir, assertNotLive, releaseLock, takeLock } from './account.js'
import { bySlug, deriveRoster, type WorldAccount } from './roster.js'
import { startRelay, type TestRelay } from '../../test/shell/relay-server.js'

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
  takeLock(who.slug, 'relay test')
  // Short evaluates, retried — a single long-lived one dies when the inspector
  // context is rebuilt during startup (see magnet.ts).
  const deadline = Date.now() + 30_000
  let lastErr: unknown = null
  for (;;) {
    try {
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

export async function runRelay(argv: string[]): Promise<void> {
  const flag = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback
  }
  const roster = deriveRoster()
  const from = bySlug(roster, flag('from', 'ada'))
  const to = bySlug(roster, flag('to', 'grace'))
  const timeoutMs = Number.parseInt(flag('timeout', '60000'), 10)
  const relayFlag = flag('relay', '')
  const big = argv.includes('--big')
  if (from.slug === to.slug) throw new Error('--from and --to must be different accounts')
  assertNotLive(from.slug)
  assertNotLive(to.slug)

  log('NOTE: Playwright launches Electron with --no-sandbox. Layer 1 is not exercised by this test.')
  log('')

  let local: TestRelay | null = null
  const started: Instance[] = []
  try {
    let relayUrl = relayFlag
    if (!relayUrl) {
      local = await startRelay()
      relayUrl = local.url
      log(`relay:   ${relayUrl} (local, in this process)`)
    } else {
      log(`relay:   ${relayUrl}`)
      log('NOTE: a public relay will see your address, and its readers will see what you post.')
    }
    log(`poster:  ${from.name} (${from.slug})`)
    log(`reader:  ${to.name} (${to.slug})`)
    log('')

    const poster = await launch(from)
    started.push(poster)
    const reader = await launch(to)
    started.push(reader)
    log('both instances up')

    for (const inst of [poster, reader]) {
      // A local relay gets a fresh port every run, so yesterday's entry is a
      // dead address that would sit in the list reconnecting forever. Drop
      // those first; a relay the human named with --relay is left alone.
      const stale = await hook<string[]>(
        inst,
        `return shell.relays().relays.map(r => r.url).filter(u => u.startsWith('ws://127.0.0.1:') && u !== ${JSON.stringify(relayUrl)})`
      )
      for (const url of stale) await hook(inst, `return shell.removeRelay(${JSON.stringify(url)})`)
      const r = await hook<Record<string, unknown>>(inst, `return shell.addRelay(${JSON.stringify(relayUrl)})`)
      if (r.error) throw new Error(`${inst.who.slug} could not add the relay: ${String(r.error)}`)
    }
    // Both must actually be connected before anything is posted, or the post
    // goes out to nobody and the scenario proves nothing.
    const stateOf = `return (shell.relays().relays.find(r => r.url === ${JSON.stringify(relayUrl)}) ?? {}).state ?? 'none'`
    const connectedBy = Date.now() + 20_000
    for (;;) {
      const states = await Promise.all([poster, reader].map((i) => hook<string>(i, stateOf)))
      if (states.every((s) => s === 'open')) break
      if (Date.now() > connectedBy) throw new Error(`relay never connected (states: ${states.join(', ')})`)
      await new Promise((r) => setTimeout(r, 200))
    }
    log('both connected to the relay')

    // A FRESH thing: posting something the reader already holds would prove
    // nothing, since it would "arrive" out of its own library.
    //
    // With --big it carries an attachment over the 32 KiB inline cap, so the
    // event travels as a POINTER instead of carrying the bundle. That is the
    // other half of the relay story: the reader gets a note saying a thing
    // exists, and nothing is downloaded until somebody presses Fetch.
    const nametag = readFileSync(join(REPO_ROOT, 'samples', 'nametag.html')).toString('base64')
    const attachments = big
      ? `, [{ name: 'payload.bin', base64: ${JSON.stringify(Buffer.alloc(64 * 1024, 7).toString('base64'))}, mime: 'application/octet-stream' }]`
      : ''
    const composed = await hook<{ outcome: Record<string, unknown> }>(
      poster,
      `return shell.compose(${JSON.stringify(nametag)}, 'relay-test'${attachments})`
    )
    const hash = composed.outcome.envelopeHash as string
    if (composed.outcome.status !== 'valid') {
      throw new Error(`the poster could not author a thing: ${JSON.stringify(composed.outcome)}`)
    }
    log(`authored on ${from.slug}: ${hash.slice(0, 16)}…`)

    const held = `return shell.feed({ limit: 10000 }).some(r => r.envelopeHash === ${JSON.stringify(hash)})`
    if (await hook<boolean>(reader, held)) throw new Error('the reader already holds it — this would prove nothing')

    // The whole point, stated as a check: being connected is not being posted
    // to. Nothing has left the poster yet.
    if (local && local.received.length > 0) throw new Error('something reached the relay without being posted')
    log(`${to.slug} does not hold it, and nothing has been posted yet`)

    // A pointer is only honest if something is actually serving it, so the
    // poster seeds before posting. postToRelays refuses an oversize thing that
    // is not seeded, rather than advertising a locator nobody answers.
    if (big) {
      const seeded = await hook<{ magnet?: string; error?: string }>(
        poster,
        `return shell.seedStart(${JSON.stringify(hash)})`
      )
      if (!seeded.magnet) throw new Error(`seeding failed: ${seeded.error ?? 'unknown'}`)
      log(`seeding: ${seeded.magnet.slice(0, 72)}…`)
    }

    const posted = await hook<Record<string, unknown>>(poster, `return shell.postToRelays(${JSON.stringify(hash)})`)
    if (posted.error) throw new Error(`posting failed: ${String(posted.error)}`)
    log('')
    log(`posted to ${String(posted.posted)} relay(s)${posted.inline === false ? ' as a pointer' : ' inline'}`)
    log(`waiting up to ${Math.round(timeoutMs / 1000)}s for it to arrive on ${to.slug}…`)

    const startedAt = Date.now()
    const deadline = Date.now() + timeoutMs

    if (big) {
      // It must NOT arrive on its own. Waiting for the offer proves the event
      // got there; the feed staying empty proves nothing was downloaded.
      log('')
      log('waiting for the OFFER (nothing should be fetched yet)…')
      let offered = false
      while (Date.now() < deadline) {
        const offers = await hook<{ envelopeHash: string; locator: string; state: string }[]>(
          reader,
          'return shell.offers()'
        )
        const o = offers.find((x) => x.envelopeHash === hash)
        if (o) {
          offered = true
          log(`  offered: ${o.state} — ${o.locator.slice(0, 72)}…`)
          break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!offered) {
        log('')
        log('FAILED: the pointer never turned up as an offer.')
        process.exitCode = 1
        return
      }
      if (await hook<boolean>(reader, held)) {
        log('')
        log('FAILED: it was fetched WITHOUT anyone pressing Fetch. That is the whole')
        log('property this path exists to protect.')
        process.exitCode = 1
        return
      }
      log('  nothing downloaded — as it should not be')
      log('')
      log('pressing Fetch…')
      const r = await hook<Record<string, unknown>>(reader, `return shell.fetchOffer(${JSON.stringify(hash)})`)
      if (r.error) throw new Error(`fetch refused: ${String(r.error)}`)
      if (r.status === 'started') log(`  transfer started (${String(r.transferId).slice(0, 8)}…)`)
    }

    let arrived = false
    for (;;) {
      if (await hook<boolean>(reader, held)) {
        arrived = true
        break
      }
      if (Date.now() > deadline) break
      await new Promise((r) => setTimeout(r, 250))
    }
    const took = ((Date.now() - startedAt) / 1000).toFixed(1)

    if (!arrived) {
      log('')
      log(`FAILED after ${took}s: it never arrived.`)
      log('Check that both instances show the relay as `open` (File → Relays), and that')
      log('the relay actually stores kind 3400 — some relays only keep kinds they know.')
      process.exitCode = 1
      return
    }

    // Arrived — but as WHOSE? The author is whoever signed it, and the relay
    // has no say in that. This is the claim worth checking.
    const landed = await hook<{ author: string | null; type: string | null }>(
      reader,
      `const row = shell.feed({ limit: 10000 }).find(r => r.envelopeHash === ${JSON.stringify(hash)}) ?? null;
       return { author: row ? row.authorKey : null, type: row ? row.type : null }`
    )
    const arrivals = await hook<{ relayUrl: string; poster: string; selfPosted: boolean }[]>(
      reader,
      `return shell.relayArrivals(${JSON.stringify(hash)})`
    )
    const expected = from.address.replace(/^0x/, '').toLowerCase()
    log('')
    log(`ARRIVED in ${took}s`)
    log(`  hash     ${hash}`)
    log(`  type     ${landed.type ?? '—'}`)
    log(`  author   ${landed.author ?? '—'} ${landed.author === expected ? `(${from.slug} ✓)` : '(MISMATCH)'}`)
    for (const a of arrivals) {
      log(`  offered  by ${a.poster.slice(0, 16)}… on ${a.relayUrl}${a.selfPosted ? ' — its own author' : ' — a relayer, not the author'}`)
    }
    if (landed.author !== expected) {
      log('')
      log('The author does not match the poster. That is a real bug, not a flake.')
      process.exitCode = 1
    }
  } finally {
    for (const inst of started) {
      // Leave the libraries as they were found: a relay this scenario added is
      // this scenario's to remove, and a local one is dead the moment it exits.
      try {
        if (local) await hook(inst, `return shell.removeRelay(${JSON.stringify(local.url)})`)
      } catch {
        /* the instance may already be gone */
      }
      try {
        await inst.app.close()
      } catch {
        /* closing a dead app is not a failure */
      }
      releaseLock(inst.who.slug)
    }
    await local?.close()
  }
}
