import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  test,
  expect,
  launchShell,
  buildBundle,
  buildSealedBundle,
  ethSigner,
  nostrSigner,
  secp256k1,
  type ShellHandle
} from './helpers.js'

// ── Finding people: the find box, To you, and People → feed ──────────────────
// One box finds letters by who wrote them: part of a key, or a name -- yours
// for them, or the one they chose. "To you" lists what was addressed to this
// identity. A letter count in People opens the feed on just that key.

const NAMETAG = readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html'))
const STUB = new TextEncoder().encode('<!doctype html><p>v</p>')

async function chromeEval<T>(shell: ShellHandle, js: string): Promise<T> {
  return shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)
}

async function poll<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let value: T | undefined
    try {
      value = await fn()
      if (pred(value)) return value
    } catch {
      /* retry */
    }
    if (Date.now() > deadline) throw new Error(`poll timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

const click = (shell: ShellHandle, testid: string): Promise<void> =>
  chromeEval(shell, `document.querySelector('[data-testid=${testid}]').click()`)

/** The authors of the feed rows, as full keys (from each row's title). */
const rowAuthors = (shell: ShellHandle): Promise<string[]> =>
  chromeEval<string[]>(
    shell,
    `Array.from(document.querySelectorAll('.sh-feed-item:not([data-testid=draft-item])')).map((r) => r.getAttribute('data-author-key') ?? '')`
  )

const rowCount = (shell: ShellHandle): Promise<number> =>
  chromeEval<number>(shell, `document.querySelectorAll('.sh-feed-item:not([data-testid=draft-item])').length`)

/** Type into the find box as a person would: the value, then an input event. */
const find = (shell: ShellHandle, text: string): Promise<void> =>
  chromeEval(
    shell,
    `(() => { const i = document.querySelector('[data-testid=feed-who]'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')) })()`
  )

const headLabel = (shell: ShellHandle): Promise<string> =>
  chromeEval<string>(shell, `document.querySelector('[data-testid=feed-head-label]').textContent`)

async function person(shell: ShellHandle, name: string): Promise<{ priv: Uint8Array; key: string }> {
  const priv = secp256k1.utils.randomSecretKey()
  const bundle = await buildBundle(ethSigner(priv), {
    type: 'nametag',
    program: new Uint8Array(NAMETAG),
    args: new Map([['name', name]])
  })
  const outcome = await shell.ingest(bundle)
  expect(outcome.status).toBe('valid')
  return { priv, key: (outcome.author as { k: string }).k }
}

async function memo(shell: ShellHandle, priv: Uint8Array, text: string): Promise<void> {
  const bundle = await buildBundle(ethSigner(priv), {
    type: 'memo',
    program: new TextEncoder().encode(`<!doctype html><p>${text}</p>`)
  })
  expect((await shell.ingest(bundle)).status).toBe('valid')
}

async function vouch(shell: ShellHandle, priv: Uint8Array, aboutKey: string): Promise<void> {
  const bundle = await buildBundle(ethSigner(priv), {
    type: 'vouch',
    program: STUB,
    args: new Map([
      ['about', aboutKey],
      ['aboutScheme', 'eth-eip191'],
      ['name', '']
    ])
  })
  expect((await shell.ingest(bundle)).status).toBe('valid')
}

test('the find box matches part of a key, your name for someone, or theirs', async () => {
  const shell = await launchShell()
  try {
    const ada = await person(shell, 'Ada Lovelace')
    const bob = await person(shell, 'Robert')
    await memo(shell, ada.priv, 'from ada')
    await memo(shell, bob.priv, 'from bob')
    await poll(() => rowCount(shell), (n) => n === 4)

    // A key prefix, with or without 0x.
    await find(shell, `0x${ada.key.slice(0, 6)}`)
    await poll(() => rowAuthors(shell), (a) => a.length === 2 && a.every((k) => k === ada.key))
    expect(await headLabel(shell)).toContain(`0x${ada.key.slice(0, 6)}`)

    // A shortened address as the app writes it: a prefix … a suffix.
    await find(shell, `${bob.key.slice(0, 4)}…${bob.key.slice(-4)}`)
    await poll(() => rowAuthors(shell), (a) => a.length === 2 && a.every((k) => k === bob.key))

    // The name they gave themselves, any case, any part.
    await find(shell, 'lovelace')
    await poll(() => rowAuthors(shell), (a) => a.length === 2 && a.every((k) => k === ada.key))

    // Your own name for them.
    await shell.setPetname('eth-eip191', bob.key, 'Uncle B')
    await find(shell, 'uncle')
    await poll(() => rowAuthors(shell), (a) => a.length === 2 && a.every((k) => k === bob.key))

    // Nothing matches: the empty state says what was searched.
    await find(shell, 'nobody-at-all')
    await poll(() => rowCount(shell), (n) => n === 0)
    expect(await chromeEval<string>(shell, `document.querySelector('[data-testid=feed-empty]').textContent`)).toContain(
      'nobody-at-all'
    )

    // ✕ clears it and everything is back.
    await click(shell, 'feed-who-clear')
    await poll(() => rowCount(shell), (n) => n === 4)
    expect(await chromeEval<string>(shell, `document.querySelector('[data-testid=feed-who]').value`)).toBe('')
  } finally {
    await shell.close()
  }
})

test('To you lists what names you or was sealed to you, and nothing else', async () => {
  const shell = await launchShell()
  try {
    const me = await shell.identity()
    const myKey = me.address.replace(/^0x/, '').toLowerCase()
    const carol = await person(shell, 'Carol')
    const dave = await person(shell, 'Dave')

    // Addressed to me: a vouch about me, and a private letter sealed to me.
    await vouch(shell, carol.priv, myKey)
    const myNostrPub = Uint8Array.from(me.nostrPubkey.match(/../g)!.map((h) => parseInt(h, 16)))
    const sealed = await buildSealedBundle(nostrSigner(secp256k1.utils.randomSecretKey()), [myNostrPub])
    expect((await shell.ingest(sealed)).status).toBe('valid')
    // Not addressed to me: a memo, and a vouch about somebody else.
    await memo(shell, dave.priv, 'to the world')
    await vouch(shell, dave.priv, carol.key)
    await poll(() => rowCount(shell), (n) => n >= 6)

    await click(shell, 'feed-filter-to')
    await poll(() => rowCount(shell), (n) => n === 2)
    const rows = await chromeEval<{ type: string; author: string }[]>(
      shell,
      `Array.from(document.querySelectorAll('.sh-feed-item:not([data-testid=draft-item])')).map((r) => ({ type: r.getAttribute('data-type') ?? '', author: r.getAttribute('data-author-key') ?? '' }))`
    )
    expect(rows.some((r) => r.author === carol.key)).toBe(true)
    expect(rows.some((r) => r.author === dave.key)).toBe(false)
    expect(await headLabel(shell)).toContain('To you · 2')

    // The find box narrows To you as well.
    await find(shell, 'carol')
    await poll(() => rowCount(shell), (n) => n === 1)
  } finally {
    await shell.close()
  }
})

test('a letter count in People opens the feed on that key', async () => {
  const shell = await launchShell()
  try {
    const eve = await person(shell, 'Eve')
    const fay = await person(shell, 'Fay')
    await memo(shell, eve.priv, 'one')
    await memo(shell, eve.priv, 'two')
    await memo(shell, fay.priv, 'three')
    await poll(() => rowCount(shell), (n) => n === 5)

    await chromeEval(shell, `window.__shellChrome.openPeople()`)
    const row = `[data-testid=people-list] [data-author-key="${eve.key}"]`
    await poll(() => chromeEval<boolean>(shell, `!!document.querySelector('${row} [data-testid=people-letters]')`), (v) => v)
    // Their own name shows beside the row, quoted as theirs.
    expect(await chromeEval<string>(shell, `document.querySelector('${row} [data-testid=people-self-name]').textContent`)).toBe(
      '“Eve”'
    )
    expect(await chromeEval<string>(shell, `document.querySelector('${row} [data-testid=people-letters]').textContent`)).toBe(
      '3 letters'
    )

    await chromeEval(shell, `document.querySelector('${row} [data-testid=people-letters]').click()`)
    await poll(() => rowAuthors(shell), (a) => a.length === 3 && a.every((k) => k === eve.key))
    expect(await chromeEval<boolean>(shell, `!!document.querySelector('[data-testid=people-modal]')`)).toBe(false)
    expect(await chromeEval<string>(shell, `document.querySelector('[data-testid=feed-who]').value`)).toBe(`0x${eve.key}`)
  } finally {
    await shell.close()
  }
})

test('a letter arriving does not interrupt typing in the find box', async () => {
  const shell = await launchShell()
  try {
    const gus = await person(shell, 'Gus')
    await poll(() => rowCount(shell), (n) => n === 1)
    // Half-typed: focused, a value, and no input event yet.
    await chromeEval(
      shell,
      `(() => { const i = document.querySelector('[data-testid=feed-who]'); i.focus(); i.value = 'gu'; i.setSelectionRange(2, 2) })()`
    )
    await memo(shell, gus.priv, 'arrives mid-word')
    await poll(() => rowCount(shell), (n) => n === 2)
    const state = await chromeEval<{ focused: boolean; value: string; caret: number | null }>(
      shell,
      `(() => { const i = document.querySelector('[data-testid=feed-who]'); return { focused: document.activeElement === i, value: i.value, caret: i.selectionStart } })()`
    )
    expect(state).toEqual({ focused: true, value: 'gu', caret: 2 })
  } finally {
    await shell.close()
  }
})
