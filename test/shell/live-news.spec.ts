import { test, expect, launchShell, type ShellHandle } from './helpers.js'

// ── LIVE: subscribing to the newsread bot on the real news relay ─────────────
// Opt-in (LIVE_NEWS=1): it talks to wss://news-relay.souspli.org and a real
// BitTorrent swarm, so it never runs in CI. subscribe.spec.ts holds the rules
// with a local relay and no swarm; this checks the same path against the bot
// that is actually running:
//
//   about memo arrives → Subscribe (guardian) → waiting articles download by
//   themselves → sharing one joins the bot's swarm (same infohash, the
//   magnet's trackers, one more seeder at the tracker) → a sealed "subscribe guardian" memo gets a sealed reply → a
//   NEW article posted after subscribing arrives with no press → "unsubscribe
//   all" is answered too, so the bot is left without this throwaway reader.
//
//   LIVE_NEWS=1 node scripts/run-cage-tests.mjs test/shell/live-news.spec.ts
//
// LIVE_NEWS_NEW_MS bounds the wait for a new article (default 20 min: the bot
// scrapes every 10).

const RELAY = process.env.LIVE_NEWS_RELAY ?? 'wss://news-relay.souspli.org'
const BOT = (process.env.LIVE_NEWS_BOT ?? '4934b9bd4620328da6561ae4406851970e3ed8a8').toLowerCase()
const BOT_EK = process.env.LIVE_NEWS_BOT_EK ?? '4820a36f9661a6161054df14e3e1d3ed648fc315640a876f1c2003acf57d33b2'
const NEW_MS = Number(process.env.LIVE_NEWS_NEW_MS ?? 20 * 60_000)

test.skip(process.env.LIVE_NEWS !== '1', 'live test: set LIVE_NEWS=1')

type Row = Record<string, unknown>
const t0 = Date.now()
const say = (m: string): void => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`)

async function chromeEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

/** Publish a draft through the confirm, with "send through your relays" ticked. */
async function publishAndSend(shell: ShellHandle, draftId: string): Promise<Row> {
  await shell.app.evaluate(async (electron) => {
    ;(electron.app as unknown as { __shell: { lastPublish: unknown } }).__shell.lastPublish = null
  })
  await chromeEval(shell, `window.__shellChrome.openThing(${JSON.stringify(draftId)})`)
  await expect
    .poll(
      () =>
        shell.app.evaluate(async (electron) => {
          const s = (electron.app as unknown as { __shell: { publishDraft: () => Row } }).__shell
          return s.publishDraft() as never
        }) as Promise<Row>,
      { timeout: 20_000 }
    )
    .toMatchObject({ status: 'pending' })
  await expect.poll(() => chromeEval<boolean>(shell, `!!document.querySelector('[data-testid=confirm-send-relays]')`), { timeout: 20_000 }).toBe(true)
  expect(await chromeEval<boolean>(shell, `document.querySelector('[data-testid=confirm-send-relays]').checked`)).toBe(true)
  await chromeEval(shell, `document.querySelector('[data-testid=confirm-approve]').click()`)
  let out: Row | null = null
  await expect
    .poll(
      async () => {
        out = (await shell.app.evaluate(async (electron) => {
          return (electron.app as unknown as { __shell: { lastPublish: Row | null } }).__shell.lastPublish as never
        })) as Row | null
        return out?.status
      },
      { timeout: 20_000 }
    )
    .toBe('valid')
  return out!
}

const byBot = (rows: Row[], type: string): Row[] => rows.filter((r) => String(r.authorKey).toLowerCase() === BOT && r.type === type)

/** Send the bot a private memo and wait for its sealed answer. */
async function ask(shell: ShellHandle, subject: string): Promise<Row> {
  const before = new Set(byBot(await shell.feed({ toMe: true, limit: 500 }), 'memo').map((r) => r.envelopeHash))
  const draft = await shell.newDraft('starter:memo', { to: 'newsread', from: 'live test', subject, message: '' }, [BOT_EK])
  expect(draft.error ?? null).toBeNull()
  const sent = await publishAndSend(shell, draft.id!)
  expect(sent.sealed).toBe(true)
  expect(sent.relaySend).toMatchObject({ posted: 1, sealed: true })
  say(`sent sealed "${subject}" (${String(sent.envelopeHash).slice(0, 12)}…)`)
  let reply: Row | undefined
  await expect
    .poll(
      async () => {
        reply = byBot(await shell.feed({ toMe: true, limit: 500 }), 'memo').find((r) => !before.has(r.envelopeHash))
        return !!reply
      },
      { timeout: 90_000, intervals: [2_000] }
    )
    .toBe(true)
  say(`reply from the bot: ${JSON.stringify({ hash: String(reply!.envelopeHash).slice(0, 12), sealed: reply!.sealed, title: reply!.title ?? null })}`)
  return reply!
}

/** Seeders the tracker counts for an infohash, by HTTP scrape. */
async function seeders(tracker: string, infoHash: string): Promise<number> {
  const bin = Buffer.from(infoHash, 'hex')
  const q = [...bin].map((b) => '%' + b.toString(16).padStart(2, '0')).join('')
  const res = await fetch(`${tracker.replace(/\/announce$/, '/scrape')}?info_hash=${q}`)
  const body = Buffer.from(await res.arrayBuffer()).toString('latin1')
  const m = /8:completei(\d+)e/.exec(body)
  return m ? Number(m[1]) : -1
}

/** Seed a thing that came by the bot's magnet, and check the tracker sees one more seeder. */
async function seedJoinsSwarm(shell: ShellHandle, envelopeHash: string, offered: string): Promise<void> {
  const params = (m: string): URLSearchParams => new URLSearchParams(m.slice(m.indexOf('?') + 1))
  const tr = params(offered).getAll('tr')
  const http = tr.find((t) => /^https?:/.test(t))
  const infoHash = /btih:([0-9a-f]{40})/i.exec(offered)![1]!.toLowerCase()
  const before = http ? await seeders(http, infoHash) : -1
  const started = await shell.seedStart(envelopeHash)
  expect(started.error ?? null).toBeNull()
  const magnet = String(started.magnet)
  expect(/btih:([0-9a-f]{40})/i.exec(magnet)![1]!.toLowerCase(), 'the same swarm, not a parallel one').toBe(infoHash)
  expect(params(magnet).getAll('tr')).toEqual(tr)
  say(`seeding it: same infohash ${infoHash.slice(0, 12)}…, announcing to ${tr.join(', ')}`)
  if (http) {
    await expect.poll(() => seeders(http, infoHash), { timeout: 90_000, intervals: [3_000] }).toBeGreaterThan(before)
    say(`the tracker counts ${await seeders(http, infoHash)} seeders (was ${before})`)
  }
  await shell.seedStop(envelopeHash)
}

test('live: subscribe to the newsread bot, articles arrive by themselves, the bot answers', async () => {
  test.setTimeout(NEW_MS + 10 * 60_000)
  const shell = await launchShell({ extraEnv: { SHELL_TORRENT_OFFLINE: '0' } })
  try {
    const me = await shell.identity()
    say(`reader ${me.address} (relay key ${me.nostrPubkey.slice(0, 12)}…)`)
    expect((await shell.addRelay(RELAY)).error ?? null).toBeNull()
    await expect.poll(async () => (await shell.relays()).relays.find((r) => r.url === RELAY)?.state, { timeout: 30_000 }).toBe('open')
    say(`connected to ${RELAY}`)

    // ── The about memo travels inline, and binds the bot's relay key. ──────
    await expect.poll(async () => byBot(await shell.feed({ limit: 500 }), 'memo').length, { timeout: 60_000 }).toBeGreaterThan(0)
    say('about memo arrived')

    // ── Its articles are offers until we subscribe: nothing fetched yet. ───
    let offers: Row[] = []
    await expect
      .poll(async () => (offers = (await shell.offers()).filter((o) => o.poster === BOT_EK)).length, { timeout: 30_000 })
      .toBeGreaterThan(0)
    // The relay sends its backlog over a few seconds. Wait for it to stop
    // growing, so the snapshot holds the newest -- the ones catch-up fetches.
    let last = -1
    await expect
      .poll(
        async () => {
          const n = (offers = (await shell.offers()).filter((o) => o.poster === BOT_EK)).length
          const settled = n === last
          last = n
          return settled
        },
        { timeout: 60_000, intervals: [3_000] }
      )
      .toBe(true)
    expect(byBot(await shell.feed({ limit: 500 }), 'article')).toHaveLength(0)
    say(`${offers.length} article offers waiting, none fetched (${offers.filter((o) => o.state === 'offered').length} offered)`)

    // ── Subscribe: the waiting ones download with no press. ────────────────
    const sub = await shell.subscribe('eth-eip191', BOT, ['guardian'])
    expect(sub.error ?? null).toBeNull()
    say('subscribed to guardian')
    const want = Math.min(offers.length, 5)
    await expect
      .poll(async () => byBot(await shell.feed({ limit: 500 }), 'article').length, { timeout: 5 * 60_000, intervals: [2_000] })
      .toBeGreaterThanOrEqual(want)
    const got = byBot(await shell.feed({ limit: 500 }), 'article')
    say(`${got.length} articles held after catch-up; e.g. ${JSON.stringify(got[0]?.title ?? got[0]?.envelopeHash)}`)
    const opened = await shell.openThing(String(got[0]!.envelopeHash))
    expect(opened.error ?? null).toBeNull()
    say('opened one')

    // ── Sharing one joins the bot's swarm: same infohash, same trackers. ───
    // Any held one whose offer we saw: the newest may have been posted after.
    const shared = offers.find((o) => got.some((g) => g.envelopeHash === o.envelopeHash))
    expect(shared, 'an article held from an offer seen').toBeTruthy()
    await seedJoinsSwarm(shell, String(shared!.envelopeHash), String(shared!.locator))

    // ── Tell the bot, privately; it answers privately. ─────────────────────
    await ask(shell, 'subscribe guardian')

    // ── A pointer posted AFTER subscribing is fetched as it arrives. ───────
    const held = new Set(byBot(await shell.feed({ limit: 1000 }), 'article').map((r) => r.envelopeHash))
    const seenOffers = new Set((await shell.offers()).map((o) => o.envelopeHash))
    say(`waiting up to ${Math.round(NEW_MS / 60_000)} min for a new article…`)
    let fresh: Row | undefined
    await expect
      .poll(
        async () => {
          fresh = byBot(await shell.feed({ limit: 1000 }), 'article').find((r) => !held.has(r.envelopeHash) && !seenOffers.has(r.envelopeHash))
          return !!fresh
        },
        { timeout: NEW_MS, intervals: [5_000] }
      )
      .toBe(true)
    say(`new article arrived by itself: ${JSON.stringify(fresh!.title ?? fresh!.envelopeHash)}`)
  } finally {
    // ── Leave the bot as we found it. ──────────────────────────────────────
    try {
      await ask(shell, 'unsubscribe all')
      await shell.unsubscribe('eth-eip191', BOT)
      say('unsubscribed, here and at the bot')
    } finally {
      const t = await shell.transfers().catch(() => null)
      if (t) say(`transfers at the end: ${t.downloads.length} downloading`)
      await shell.close()
    }
  }
})
