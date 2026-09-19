import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, jsToCbor, type ShellHandle } from './helpers.js'

// ── The per-letter header fits ───────────────────────────────────────────────
// The row carried sixteen things and scrolled sideways for every letter in a
// populated library, even in a 1440px window. The rarer actions now live behind
// "⋯", and a few more step aside only while the row is tight. What these pin:
// the menu is a working route to each action (not just a place they were put),
// the row fits, the steps follow the window, and nothing that was addressable
// stopped being so.

let shell: ShellHandle
test.beforeAll(async () => {
  // These are claims about a window of a KNOWN width, so pin it. On Linux the
  // app defaults to 2x scaling, and under the suite's 1280px virtual display
  // that leaves a 640px window -- where every step rightly fires and the row
  // still scrolls, which is the fallback and not what is being tested here.
  shell = await launchShell({ extraEnv: { SHELL_SCALE: '1' } })
  await setWidth(1280)
  const got = await shell.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.getContentSize()[0]!)
  expect(got, 'the display must allow the default window width').toBeGreaterThanOrEqual(1200)
})
test.afterAll(async () => {
  await shell.close()
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

const stranger = (): ReturnType<typeof ethSigner> => ethSigner(secp256k1.utils.randomSecretKey())

/** Open a letter THROUGH THE CHROME, so the header is really rendered. */
async function openInChrome(hash: string): Promise<void> {
  const index = (await shell.feed({ rollUp: false })).findIndex((r) => r.envelopeHash === hash)
  expect(index, 'the letter is in the feed').toBeGreaterThanOrEqual(0)
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(hash)})`)
  await expect
    .poll(() => chromeEval<string | null>(`document.querySelector('.sh-thing-header').getAttribute('data-envelope-hash')`), {
      timeout: 15_000
    })
    .toBe(hash)
}

const overflow = (): Promise<number> =>
  chromeEval<number>(`(() => { const h = document.querySelector('.sh-thing-header'); return h.scrollWidth - h.clientWidth })()`)

/** Where a control currently lives: in the row, or parked for the menu. */
const where = (testid: string): Promise<'row' | 'menu' | 'absent'> =>
  chromeEval(`(() => {
    const e = document.querySelector('[data-testid=${testid}]')
    if (!e) return 'absent'
    return e.closest('.sh-more-holder, [data-testid=more-menu]') ? 'menu' : 'row'
  })()`)

async function setWidth(w: number): Promise<void> {
  await shell.app.evaluate(({ BaseWindow }, width) => {
    const win = BaseWindow.getAllWindows()[0]!
    win.setContentSize(width, win.getContentSize()[1]!)
  }, w)
}

test('"⋯" is a working route to the rarer actions, and shows the whole hash', async () => {
  const r = await shell.ingest(await buildBundle(stranger(), { type: 'note', args: jsToCbor({ title: 'A note' }) }))
  const hash = String(r.envelopeHash)
  await openInChrome(hash)

  // Out of the row…
  for (const id of ['header-attest', 'header-amend', 'header-copy', 'header-delete']) expect(await where(id), id).toBe('menu')
  // …and what you read and do often is still in it.
  for (const id of ['header-comment', 'header-export', 'header-more']) expect(await where(id), id).toBe('row')

  await chromeEval(`document.querySelector('[data-testid=header-more]').click()`)
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid=more-menu]')`), { timeout: 10_000 }).toBe(true)
  const rows = await chromeEval<string[]>(
    `[...document.querySelectorAll('[data-testid=more-menu] .sh-more-row')].map((r) => r.querySelector('button').textContent + ' | ' + r.querySelector('.sh-hint').textContent)`
  )
  expect(rows.map((x) => x.split(' | ')[0])).toEqual(['Attest', 'Your version…', 'Copy', 'Delete'])
  for (const row of rows) expect(row.split(' | ')[1]!.length, `a hint for ${row}`).toBeGreaterThan(20)
  // The row only ever had room for a third of it.
  expect(await chromeEval<string>(`document.querySelector('[data-testid=more-hash]').textContent`)).toBe(hash)

  // Choosing one DOES it, and leaves the dialog.
  const before = (await shell.feed({ rollUp: false })).length
  await chromeEval(`document.querySelector('[data-testid=more-menu] [data-testid=header-copy]').click()`)
  await expect.poll(async () => (await shell.feed({ rollUp: false })).length, { timeout: 15_000 }).toBe(before + 1)
  expect(await chromeEval<boolean>(`!!document.querySelector('[data-testid=more-menu]')`)).toBe(false)
})

test('a busy letter fits the row at the default window, without anything wrapping', async () => {
  const forum = await shell.ingest(await buildBundle(stranger(), { type: 'group', args: jsToCbor({ name: 'Desk', members: [] }) }))
  const author = secp256k1.utils.randomSecretKey()
  const post = await shell.ingest(
    await buildBundle(ethSigner(author), {
      type: 'article',
      args: jsToCbor({ title: 'The figures do not add up', inGroup: String(forum.envelopeHash) })
    })
  )
  const hash = String(post.envelopeHash)
  // A petname, comments, an attestation and votes: most of what a row can carry.
  const addr = [...ethSigner(author).pubkey].map((b) => b.toString(16).padStart(2, '0')).join('')
  await shell.setPetname('eth-eip191', addr, 'Katherine Johnson')
  for (let i = 0; i < 2; i++) {
    await shell.ingest(await buildBundle(stranger(), { type: 'comment', args: jsToCbor({ replyTo: hash, body: `c${i}` }) }))
  }
  await shell.ingest(await buildBundle(stranger(), { type: 'attestation', args: jsToCbor({ attests: hash, statement: 'I have read this' }) }))
  await shell.vote(hash, 1)

  await openInChrome(hash)
  await expect.poll(() => chromeEval<string>(`document.querySelector('[data-testid=header-replies]').textContent`), { timeout: 10_000 }).toBe('2 comments')
  expect(await overflow(), 'the row must not scroll sideways').toBeLessThanOrEqual(0)
  // One line: a 44px strip has no room for a name broken in two.
  const tall = await chromeEval<string[]>(
    `[...document.querySelector('.sh-thing-header').children].filter((c) => c.getBoundingClientRect().height > 40).map((c) => c.textContent)`
  )
  expect(tall, 'nothing in the row wraps').toEqual([])
})

test('the steps follow the window: Share… steps aside when it is narrow and comes back when it is not', async () => {
  const r = await shell.ingest(await buildBundle(stranger(), { type: 'article', args: jsToCbor({ title: 'Resizing' }) }))
  await openInChrome(String(r.envelopeHash))
  expect(await where('header-export')).toBe('row')

  await setWidth(820)
  await expect.poll(() => where('header-export'), { timeout: 10_000 }).toBe('menu')
  // Still reachable: it is listed in the dialog, with the rest.
  await chromeEval(`document.querySelector('[data-testid=header-more]').click()`)
  await expect
    .poll(
      () => chromeEval<string[]>(`[...document.querySelectorAll('[data-testid=more-menu] .sh-more-row button')].map((b) => b.textContent)`),
      { timeout: 10_000 }
    )
    .toContain('Share…')
  await chromeEval(`document.querySelector('[data-testid=more-menu] .evm-modal-footer button').click()`)

  await setWidth(1280)
  await expect.poll(() => where('header-export'), { timeout: 10_000 }).toBe('row')
  expect(await overflow()).toBeLessThanOrEqual(0)
})

test('"no comments" and "no attestations" take no room until there is one to show', async () => {
  const r = await shell.ingest(await buildBundle(stranger(), { type: 'note', args: jsToCbor({ title: 'Quiet' }) }))
  const hash = String(r.envelopeHash)
  await openInChrome(hash)
  const width = (id: string): Promise<number> =>
    chromeEval<number>(`document.querySelector('[data-testid=${id}]').getBoundingClientRect().width`)
  expect(await width('header-replies')).toBe(0)
  expect(await width('header-attestations')).toBe(0)
  // Still in the DOM, still saying how many: nothing that read them broke.
  expect(await chromeEval<string>(`document.querySelector('[data-testid=header-replies]').getAttribute('data-count')`)).toBe('0')

  await shell.ingest(await buildBundle(stranger(), { type: 'comment', args: jsToCbor({ replyTo: hash, body: 'hello' }) }))
  await expect.poll(() => width('header-replies'), { timeout: 15_000 }).toBeGreaterThan(0)
})

test('the New dialog is wide enough that nothing scrolls sideways', async () => {
  await chromeEval(`document.querySelectorAll('.evm-modal-overlay').forEach((o) => o.remove())`)
  await chromeEval(`document.querySelector('[data-testid=new-thing]').click()`)
  await expect.poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid=new-menu]')`), { timeout: 10_000 }).toBe(true)
  const m = await chromeEval<{ width: number; over: number }>(`(() => {
    const modal = document.querySelector('[data-testid=new-menu]')
    const body = modal.querySelector('.evm-modal-body')
    return { width: modal.getBoundingClientRect().width, over: body.scrollWidth - body.clientWidth }
  })()`)
  expect(m.width, 'a quarter wider than the standard 484px dialog').toBeGreaterThan(590)
  expect(m.over, 'no horizontal scrollbar').toBeLessThanOrEqual(0)
})
