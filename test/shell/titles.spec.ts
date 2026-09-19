import { test, expect, launchShell, buildBundle, buildSealedBundle, ethSigner, nostrSigner, secp256k1, jsToCbor, type ShellHandle } from './helpers.js'

// ── Titles in the feed ───────────────────────────────────────────────────────
// A row used to say who signed a letter and what KIND it was, never what it was
// about. It now carries the line the letter calls itself by. That line comes
// out of `args`, so it is the author's claim -- and it is the first
// program-supplied text drawn in trusted chrome. These pin the terms.

let shell: ShellHandle
test.beforeAll(async () => {
  shell = await launchShell()
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

/** The rendered feed row for a letter. Rows carry no hash attribute, but the
 *  pane lists them in feed order, so main's index finds the element. */
async function rowOf(
  hash: string
): Promise<{ classes: string[]; title: string | null; titleChildren: number; tip: string } | null> {
  const index = (await shell.feed()).findIndex((r) => r.envelopeHash === hash)
  if (index < 0) return null
  return chromeEval(`(() => {
    const item = document.querySelectorAll('.sh-feed .sh-feed-item')[${index}]
    if (!item) return null
    const t = item.querySelector('[data-testid=feed-title]')
    return {
      classes: [...item.children].map((c) => c.className.split(' ')[0]),
      title: t ? t.textContent : null,
      titleChildren: t ? t.children.length : 0,
      tip: t ? t.title : ''
    }
  })()`)
}

test('a letter’s title shows in the feed, below the author, marked as the author’s wording', async () => {
  const r = await shell.ingest(await buildBundle(stranger(), { type: 'article', args: jsToCbor({ title: 'Flood defences approved' }) }))
  expect(r.status).toBe('valid')
  const [row] = (await shell.feed()).filter((x) => x.envelopeHash === r.envelopeHash)
  expect(row!.title).toBe('Flood defences approved')

  await expect.poll(async () => (await rowOf(String(r.envelopeHash)))?.title ?? null, { timeout: 10_000 }).toBe('Flood defences approved')
  const dom = (await rowOf(String(r.envelopeHash)))!
  // The signer leads; the claim follows. Order is the hierarchy.
  expect(dom.classes.indexOf('sh-feed-line')).toBeLessThan(dom.classes.indexOf('sh-feed-called'))
  expect(dom.tip).toMatch(/author’s wording/i)
})

test('a title cannot borrow the ✓, reorder the row, or carry markup', async () => {
  const hostile = '\u2713 verified by your bank \u202E<img src=x onerror=alert(1)>'
  const r = await shell.ingest(await buildBundle(stranger(), { type: 'memo', args: jsToCbor({ subject: hostile }) }))
  expect(r.status).toBe('valid')
  await expect.poll(async () => (await rowOf(String(r.envelopeHash)))?.title ?? null, { timeout: 10_000 }).not.toBeNull()
  const dom = (await rowOf(String(r.envelopeHash)))!
  expect(dom.title).not.toContain('\u2713')
  expect(dom.title).not.toContain('\u202E')
  expect(dom.title!.startsWith('verified by your bank')).toBe(true)
  // Set as TEXT: the tag is characters on screen, not an element in the chrome.
  expect(dom.title).toContain('<img')
  expect(dom.titleChildren).toBe(0)
  expect(await chromeEval<number>(`document.querySelectorAll('.sh-feed img').length`)).toBe(0)
})

test('a letter that offers no title reads as it always did', async () => {
  const r = await shell.ingest(await buildBundle(stranger(), { type: 'vote', args: jsToCbor({ dir: 1 }) }))
  expect(r.status).toBe('valid')
  const [row] = (await shell.feed({ rollUp: false })).filter((x) => x.envelopeHash === r.envelopeHash)
  expect(row!.title ?? null).toBeNull()
})

test('a sealed letter’s title never reaches the disk', async () => {
  const SECRET = 'SEALED_TITLE_MAGIC_7c21aa'
  const me = await shell.identity()
  const myNostrPub = Uint8Array.from(me.nostrPubkey.match(/../g)!.map((h) => parseInt(h, 16)))
  const sealed = await buildSealedBundle(nostrSigner(secp256k1.utils.randomSecretKey()), [myNostrPub], {
    type: 'invite',
    args: jsToCbor({ title: SECRET })
  })
  const r = await shell.ingest(sealed)
  expect(r.status).toBe('valid')
  expect(r.sealed).toBe(true)
  const [row] = (await shell.feed()).filter((x) => x.envelopeHash === r.envelopeHash)
  // No title for a sealed row: the feed index is sqlite, and sqlite is a file.
  expect(row!.title ?? null).toBeNull()
  expect(shell.scanUserData(new TextEncoder().encode(SECRET))).toEqual([])
})
