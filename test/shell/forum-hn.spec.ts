import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, jsToCbor, type ShellHandle } from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'

// ── The community forum, in minutes ──────────────────────────────────────────
// One yes joins: relay, forum, name. After that a post, a comment, an upvote
// and an unvote each go out with nothing more than the click, travel WHOLE in
// one relay event (nobody seeds, nobody presses Fetch), and show up for the
// other person on their own. Two real shells, one in-process relay.

let relay: TestRelay
let alice: ShellHandle
let bob: ShellHandle
let forumB64: string

test.beforeAll(async () => {
  relay = await startRelay()
  const bundle = await buildBundle(ethSigner(secp256k1.utils.randomSecretKey()), {
    type: 'group',
    args: jsToCbor({ name: 'Coffee Talk', purpose: 'Say hello.', notes: '', members: [] })
  })
  forumB64 = Buffer.from(bundle).toString('base64')
  const env = { SHELL_SUGGESTED_RELAY: relay.url, SHELL_WELCOME_FORUM_B64: forumB64 }
  alice = await launchShell({ extraEnv: env })
  bob = await launchShell({ extraEnv: env })
})
test.afterAll(async () => {
  await alice?.close()
  await bob?.close()
  await relay?.close()
})

function chromeEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}
const call = <T>(shell: ShellHandle, js: string): Promise<T> => chromeEval<T>(shell, js)

type Row = {
  envelopeHash: string
  type: string
  title: string | null
  domain: string | null
  text: string | null
  points: number
  voted: boolean
  name: string | null
  isMe: boolean
  comments: number
}

test('join, post, comment, upvote, unvote: each one click, each arrives on its own', async () => {
  // ── Join: the one yes ──
  const a = await call<Record<string, unknown>>(alice, `window.shell.forumJoin('alice')`)
  expect(a.error).toBeUndefined()
  expect(a.joined).toMatch(/^[0-9a-f]{64}$/)
  expect(a.name).toBe('alice')
  expect(a.forumName).toBe('Coffee Talk')
  const b = await call<Record<string, unknown>>(bob, `window.shell.forumJoin('bob')`)
  expect(b.joined).toBe(a.joined)

  // A name is a signed nametag tagged into the forum, and it went out.
  await expect.poll(() => relay.received.filter((e) => e.tags.some((t) => t[0] === 'thing-type' && t[1] === 'nametag')).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)

  // ── Post ──
  const posted = await call<Record<string, unknown>>(
    alice,
    `window.shell.forumSubmit({ kind: 'post', title: 'Hello from Alice', url: 'https://example.org/a', text: 'First!\\n\\nSecond paragraph.' })`
  )
  expect(posted.error).toBeUndefined()
  expect(posted.shared, 'posted to the relay without a separate step').toBe(true)
  const postHash = String(posted.envelopeHash)

  // It travelled WHOLE: the event carries the bundle, not a pointer to seed.
  await expect.poll(() => relay.received.some((e) => e.tags.some((t) => t[0] === 'x' && t[1] === postHash)), { timeout: 15_000 }).toBe(true)
  const ev = relay.received.find((e) => e.tags.some((t) => t[0] === 'x' && t[1] === postHash))!
  expect(ev.tags.some((t) => t[0] === 'thing-fetch'), 'no fetch locator: it is inline').toBe(false)

  // Bob has it, without fetching anything, named as Alice named herself.
  await expect
    .poll(async () => (await call<{ rows: Row[] }>(bob, `window.shell.forumFront('new')`)).rows.find((r) => r.envelopeHash === postHash)?.name ?? null, {
      timeout: 20_000
    })
    .toBe('alice')
  const seen = (await call<{ rows: Row[] }>(bob, `window.shell.forumFront('top')`)).rows.find((r) => r.envelopeHash === postHash)!
  expect(seen).toMatchObject({ type: 'post', title: 'Hello from Alice', domain: 'example.org', text: 'First!\n\nSecond paragraph.', points: 0, isMe: false })

  // ── Upvote and comment, from Bob ──
  const up = await call<Record<string, unknown>>(bob, `window.shell.vote(${JSON.stringify(postHash)}, 1)`)
  expect(up.shared).toBe(true)
  const commented = await call<Record<string, unknown>>(
    bob,
    `window.shell.forumSubmit({ kind: 'comment', replyTo: ${JSON.stringify(postHash)}, body: 'Welcome, Alice.' })`
  )
  expect(commented.shared).toBe(true)

  // Alice sees the point and the comment, with its words and Bob's name.
  await expect
    .poll(async () => (await call<{ rows: Row[] }>(alice, `window.shell.forumFront('top')`)).rows.find((r) => r.envelopeHash === postHash)?.points ?? -1, {
      timeout: 20_000
    })
    .toBe(1)
  await expect
    .poll(async () => {
      const item = await call<{ comments: (Row & { depth: number })[] }>(alice, `window.shell.forumItem(${JSON.stringify(postHash)})`)
      return item.comments.map((c) => `${c.depth}:${c.name}:${c.text}`)
    }, { timeout: 20_000 })
    .toEqual(['1:bob:Welcome, Alice.'])

  // A reply to the comment threads under it.
  const commentHash = String(commented.envelopeHash)
  await call(alice, `window.shell.forumSubmit({ kind: 'comment', replyTo: ${JSON.stringify(commentHash)}, body: 'Thanks!' })`)
  const item = await call<{ story: Row; comments: (Row & { depth: number; parent: string })[] }>(alice, `window.shell.forumItem(${JSON.stringify(postHash)})`)
  expect(item.story.comments).toBe(2)
  expect(item.comments.find((c) => c.text === 'Thanks!')).toMatchObject({ depth: 2, parent: commentHash, isMe: true, name: 'alice' })

  // ── Unvote: a later vote that says neither ──
  const withdrawn = await call<Record<string, unknown>>(bob, `window.shell.vote(${JSON.stringify(postHash)}, 0)`)
  expect(withdrawn.error).toBeUndefined()
  expect(withdrawn.up).toBe(0)
  await expect
    .poll(async () => (await call<{ rows: Row[] }>(alice, `window.shell.forumFront('top')`)).rows.find((r) => r.envelopeHash === postHash)?.points ?? -1, {
      timeout: 20_000
    })
    .toBe(0)
  // Taking back a vote you never made is refused, not signed.
  expect((await call<Record<string, unknown>>(alice, `window.shell.vote(${JSON.stringify(postHash)}, 0)`)).error).toMatch(/not voted/)
})

test('what the chrome is handed is text, never markup or a borrowed check mark', async () => {
  const r = await call<Record<string, unknown>>(
    alice,
    `window.shell.forumSubmit({ kind: 'post', title: '✓ Verified by Souspli', text: '<b>bold</b> \\u202Eevil\\u202C\\n\\n\\n\\nend' })`
  )
  const row = (await call<{ rows: Row[] }>(alice, `window.shell.forumFront('new')`)).rows.find((x) => x.envelopeHash === r.envelopeHash)!
  expect(row.title).toBe('Verified by Souspli')
  expect(row.text).toBe('<b>bold</b> evil\n\nend')
  // A link must be http(s), and a title is required.
  expect((await call<Record<string, unknown>>(alice, `window.shell.forumSubmit({ kind: 'post', title: 'x', url: 'javascript:alert(1)' })`)).error).toMatch(/http/)
  expect((await call<Record<string, unknown>>(alice, `window.shell.forumSubmit({ kind: 'post', title: '   ' })`)).error).toMatch(/title/)
})

test('a new person, clicking: Forum → name → Join → submit → comment → upvote', async () => {
  const carol = await launchShell({ extraEnv: { SHELL_SUGGESTED_RELAY: relay.url, SHELL_WELCOME_FORUM_B64: forumB64 } })
  const shot = process.env.FORUM_SHOTS
  const capture = async (name: string): Promise<void> => {
    if (!shot) return
    const png = await carol.app.evaluate(async (electron) => {
      const wc = electron.webContents.getAllWebContents().find((w) => w.getURL().includes('shell/chrome'))!
      return (await wc.capturePage()).toPNG().toString('base64') as never
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${shot}/${name}.png`, Buffer.from(png as unknown as string, 'base64'))
  }
  const q = (sel: string) => JSON.stringify(sel)
  const click = (sel: string) => chromeEval(carol, `document.querySelector(${q(sel)}).click()`)
  const type = (sel: string, v: string) =>
    chromeEval(carol, `(() => { const e = document.querySelector(${q(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  const has = (sel: string) => chromeEval<boolean>(carol, `!!document.querySelector(${q(sel)})`)
  const page = () => chromeEval<string | null>(carol, `document.querySelector('[data-testid=forum-page]')?.dataset.page ?? null`)
  let interactions = 0
  const act = async (f: () => Promise<unknown>) => {
    interactions++
    await f()
  }
  try {
    // 1. Forum. Not joined yet: the page is the join card, and says what it costs.
    await act(() => click('[data-testid=forum-open]'))
    await expect.poll(page, { timeout: 10_000 }).toBe('join')
    const card = await chromeEval<string>(carol, `document.querySelector('[data-testid=forum-join-card]').innerText`)
    expect(card).toMatch(/learns your IP address/i)
    expect(card).toMatch(/cannot be unsaid/i)
    await capture('1-join')

    // 2–3. A name, and Join. The front page, with what others have posted.
    await act(() => type('[data-testid=forum-join-name]', 'carol'))
    await act(() => click('[data-testid=forum-join-go]'))
    await expect.poll(page, { timeout: 15_000 }).toBe('top')
    await expect.poll(() => chromeEval<number>(carol, `document.querySelectorAll('[data-testid=forum-row]').length`), { timeout: 20_000 }).toBeGreaterThan(0)
    await capture('2-front')
    // Bob upvoted Alice's post and took it back within the same second. A third
    // reader, getting both from the relay in whatever order, still sees 0.
    expect(
      await chromeEval<string>(carol, `[...document.querySelectorAll('[data-testid=forum-row]')].find((r) => r.textContent.includes('Hello from Alice')).querySelector('.hn-points').textContent`)
    ).toBe('0 points')

    // 4–7. submit → title → text → submit. Lands on "new" with the post on top.
    await act(() => click('[data-testid=forum-nav-submit]'))
    await expect.poll(page).toBe('submit')
    await act(() => type('[data-testid=forum-submit-title]', 'Carol was here'))
    await act(() => type('[data-testid=forum-submit-text]', 'Joined a minute ago.'))
    await act(() => click('[data-testid=forum-submit-go]'))
    await expect.poll(page, { timeout: 10_000 }).toBe('new')
    await expect
      .poll(() => chromeEval<string>(carol, `document.querySelector('[data-testid=forum-row] [data-testid=forum-title]')?.textContent ?? ''`), { timeout: 10_000 })
      .toBe('Carol was here')
    // From "installed" to "posted": the safety notice, then these.
    expect(interactions, 'first post within 7 interactions of opening the forum').toBeLessThanOrEqual(7)
    // It went out whole.
    await expect.poll(() => relay.received.some((e) => e.tags.some((t) => t[0] === 'thing-type' && t[1] === 'post') && e.content.length > 0), { timeout: 10_000 }).toBe(true)
    await capture('3-new')

    // Comment on it from its item page.
    await click('[data-testid=forum-row] [data-testid=forum-comments]')
    await expect.poll(page).toBe('item')
    expect(await chromeEval<string>(carol, `document.querySelector('[data-testid=forum-story-text]').textContent`)).toBe('Joined a minute ago.')
    await type('[data-testid=forum-comment-text]', 'Replying to myself, as one does.')
    await click('[data-testid=forum-comment-go]')
    await expect
      .poll(() => chromeEval<string[]>(carol, `[...document.querySelectorAll('[data-testid=forum-comment-body]')].map((e) => e.textContent)`), { timeout: 10_000 })
      .toEqual(['Replying to myself, as one does.'])
    await capture('4-item')

    // Upvote someone else's post from the front page: ▲ goes, "unvote" appears.
    await click('.hn-brand')
    await expect.poll(page).toBe('top')
    await expect.poll(() => has('[data-testid=forum-upvote]'), { timeout: 10_000 }).toBe(true)
    await click('[data-testid=forum-upvote]')
    await expect.poll(() => has('[data-testid=forum-unvote]'), { timeout: 10_000 }).toBe(true)
    await capture('5-voted')

    // Leaving the page brings the ordinary layout back.
    await click('[data-testid=forum-open]')
    expect(await chromeEval<boolean>(carol, `document.querySelector('.sh-feed').hidden || document.querySelector('.sh-main').hidden`)).toBe(false)
  } finally {
    await carol.close()
  }
})
