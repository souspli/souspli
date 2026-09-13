import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { test, expect, launchShell, type ShellHandle } from './helpers.js'
import { startRelay, type TestRelay } from './relay-server.js'
import { buildThingEvent, THING_KIND } from '../../src/shell/nostr/event.js'

// ── Relays ───────────────────────────────────────────────────────────────────
// The first way a thing can reach this shell without anyone handing over its
// bytes. Everything pinned here is about that NOT becoming a hole:
//
//  - nothing is posted unless a human asks for it (the worst failure);
//  - a relay is a stranger, so its bytes go through admission like any other;
//  - posting is not authoring — whoever relayed a thing is recorded beside the
//    author the signature names, never in place of them.
//
// Hermetic: the relay runs in this process (relay-server.ts). The public relay
// network is not a test dependency.

const NAMETAG = readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html'))

test.beforeEach(() => test.setTimeout(60_000))

let relay: TestRelay
const dirs: string[] = []

function profile(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

test.beforeEach(async () => {
  relay = await startRelay()
})

test.afterEach(async () => {
  await relay.close()
})

test.afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** Wait until a shell's relay connection is actually open, so a test that then
 *  posts is not racing the socket. */
async function connected(shell: ShellHandle): Promise<void> {
  await expect
    .poll(async () => (await shell.relays()).relays.filter((r) => r.state === 'open').length, { timeout: 15_000 })
    .toBe(1)
}

test('nothing reaches a relay until a human asks', async () => {
  const shell = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-a-') } })
  try {
    expect((await shell.relays()).relays, 'no relay is connected to by default').toEqual([])

    const added = await shell.addRelay(relay.url)
    expect(added.error ?? null).toBeNull()
    await connected(shell)

    // Authoring, ingesting and seeding a thing must all leave the relay empty.
    const { outcome, tarBase64 } = await shell.compose(NAMETAG.toString('base64'), 'nametag')
    const hash = outcome.envelopeHash as string
    await shell.ingest(Buffer.from(tarBase64, 'base64'))
    await shell.seedStart(hash)

    // Give anything accidental a chance to happen before claiming it did not.
    await expect.poll(() => relay.connections(), { timeout: 10_000 }).toBe(1)
    expect(relay.received, 'publishing is not posting').toEqual([])

    const posted = await shell.postToRelays(hash)
    expect(posted.error ?? null).toBeNull()
    expect(posted.posted).toBe(1)
    expect(posted.inline, 'a nametag is small enough to travel whole').toBe(true)

    await expect.poll(() => relay.received.length, { timeout: 10_000 }).toBe(1)
    const ev = relay.received[0]!
    expect(ev.kind).toBe(THING_KIND)
    expect(ev.pubkey).toBe((await shell.identity()).nostrPubkey)
    expect(ev.tags.some((t) => t[0] === 'x' && t[1] === hash)).toBe(true)
  } finally {
    await shell.close()
  }
})

test('a thing posted by one account arrives at another, authored by the poster', async () => {
  const alice = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-alice-') } })
  const bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-bob-') } })
  try {
    await alice.addRelay(relay.url)
    await bob.addRelay(relay.url)
    await connected(alice)
    await connected(bob)

    const aliceId = await alice.identity()
    const { outcome } = await alice.compose(NAMETAG.toString('base64'), 'nametag')
    const hash = outcome.envelopeHash as string
    // The keystone: the thing itself declares which nostr key speaks for its
    // author, and that declaration is covered by the signature.
    expect(outcome.encKey, 'a published thing binds the author’s nostr key').toBe(aliceId.nostrPubkey)

    expect(await bob.feed({ type: 'nametag' }), 'bob has not been handed anything').toEqual([])

    expect((await alice.postToRelays(hash)).posted).toBe(1)

    await expect
      .poll(async () => (await bob.feed({ type: 'nametag' })).length, { timeout: 15_000 })
      .toBe(1)
    const row = (await bob.feed({ type: 'nametag' }))[0]!
    expect(row.envelopeHash).toBe(hash)
    // Authorship comes from the SIGNATURE, not from the relay or the event.
    expect(row.authorKey).toBe(aliceId.address.replace(/^0x/, '').toLowerCase())

    // Alice posted her own thing, so the messenger and the author are one.
    const arrivals = await bob.relayArrivals(hash)
    expect(arrivals.length).toBe(1)
    expect(arrivals[0]!.poster).toBe(aliceId.nostrPubkey)
    expect(arrivals[0]!.selfPosted).toBe(true)
    expect(arrivals[0]!.relayUrl).toBe(relay.url)
  } finally {
    await alice.close()
    await bob.close()
  }
})

test('relaying somebody else’s thing does not make you its author', async () => {
  const alice = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-author-') } })
  const bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-reader-') } })
  try {
    const aliceId = await alice.identity()
    const { outcome, tarBase64 } = await alice.compose(NAMETAG.toString('base64'), 'nametag')
    const hash = outcome.envelopeHash as string

    await bob.addRelay(relay.url)
    await connected(bob)

    // A stranger rebroadcasts Alice's thing. Legitimate — anyone may — and the
    // only place the difference between relaying and authoring can be drawn.
    const strangerKey = schnorr.utils.randomSecretKey()
    const strangerPub = Buffer.from(schnorr.getPublicKey(strangerKey)).toString('hex')
    relay.broadcast(
      await buildThingEvent(
        {
          envelopeHash: hash,
          type: 'nametag',
          bundle: new Uint8Array(Buffer.from(tarBase64, 'base64')),
          createdAt: Math.floor(Date.now() / 1000)
        },
        strangerKey
      )
    )

    await expect
      .poll(async () => (await bob.feed({ type: 'nametag' })).length, { timeout: 15_000 })
      .toBe(1)
    const row = (await bob.feed({ type: 'nametag' }))[0]!
    expect(row.authorKey, 'the author is who signed the thing').toBe(
      aliceId.address.replace(/^0x/, '').toLowerCase()
    )

    const arrivals = await bob.relayArrivals(hash)
    expect(arrivals.length).toBe(1)
    expect(arrivals[0]!.poster, 'the messenger is recorded').toBe(strangerPub)
    expect(arrivals[0]!.selfPosted, 'and is NOT the author').toBe(false)

    // The same thing, arriving again from its actual author — who is now
    // recorded correctly even though there is nothing left to ingest. Getting
    // this wrong would attribute a second copy by whatever code path it took.
    await alice.addRelay(relay.url)
    await connected(alice)
    expect((await alice.postToRelays(hash)).posted).toBe(1)
    await expect.poll(async () => (await bob.relayArrivals(hash)).length, { timeout: 15_000 }).toBe(2)
    const both = await bob.relayArrivals(hash)
    expect(both.find((a) => a.poster === aliceId.nostrPubkey)?.selfPosted, 'the author’s own post').toBe(true)
    expect(both.find((a) => a.poster === strangerPub)?.selfPosted, 'still just a messenger').toBe(false)
  } finally {
    await alice.close()
    await bob.close()
  }
})

test('junk, a tampered bundle and an oversize event are all refused, and the connection lives', async () => {
  const alice = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-hostile-a-') } })
  const bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-hostile-b-') } })
  try {
    await bob.addRelay(relay.url)
    await connected(bob)

    const { outcome, tarBase64 } = await alice.compose(NAMETAG.toString('base64'), 'nametag')
    const good = new Uint8Array(Buffer.from(tarBase64, 'base64'))
    const key = schnorr.utils.randomSecretKey()

    // 1. Not even a frame we can read.
    relay.injectRaw('{"this is": not json')
    relay.injectRaw(JSON.stringify(['EVENT', 'things', { kind: 1, content: 'hello' }]))

    // 2. A well-formed, correctly SIGNED event carrying a bundle whose bytes
    //    were edited. The event is honest; the thing inside is not.
    // Flip a byte INSIDE the program, not in the tar's trailing padding — the
    // padding is not content, so editing it changes nothing and would make
    // this test pass for the wrong reason.
    const at = Buffer.from(good).indexOf(NAMETAG.subarray(0, 24))
    expect(at, 'the program is in the bundle').toBeGreaterThan(0)
    const tampered = good.slice()
    tampered[at + 8] = tampered[at + 8]! ^ 0xff
    relay.broadcast(
      await buildThingEvent(
        {
          envelopeHash: outcome.envelopeHash as string,
          type: 'nametag',
          bundle: tampered,
          createdAt: Math.floor(Date.now() / 1000)
        },
        key
      )
    )

    // 3. Over the inline cap — refused on the ENCODED length, before anything
    //    is decoded, so offering junk is cheap for us and not for them.
    const oversize = await buildThingEvent(
      {
        envelopeHash: outcome.envelopeHash as string,
        type: 'nametag',
        bundle: new Uint8Array(200 * 1024).fill(0x41),
        createdAt: Math.floor(Date.now() / 1000)
      },
      key
    )
    relay.broadcast(oversize)

    // Nothing above may have produced a thing...
    await new Promise((r) => setTimeout(r, 2_000))
    expect(await bob.feed({ type: 'nametag' })).toEqual([])

    // ...and the connection must still be usable afterwards, which is the part
    // a naive "throw on bad input" implementation gets wrong.
    relay.broadcast(
      await buildThingEvent(
        {
          envelopeHash: outcome.envelopeHash as string,
          type: 'nametag',
          bundle: good,
          createdAt: Math.floor(Date.now() / 1000)
        },
        key
      )
    )
    await expect
      .poll(async () => (await bob.feed({ type: 'nametag' })).length, { timeout: 15_000 })
      .toBe(1)
  } finally {
    await alice.close()
    await bob.close()
  }
})

test('an event dated in the future cannot make the subscription deaf', async () => {
  // created_at is the poster's claim, like every timestamp here. Taken at face
  // value it moves the `since` cursor past everything real, and the next
  // reconnect asks the relay for things newer than the year 3000 — a one-line
  // denial of service. So it is clamped, and this is what proves it.
  const alice = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-future-a-') } })
  const bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-future-b-') } })
  try {
    await bob.addRelay(relay.url)
    await connected(bob)

    const { outcome, tarBase64 } = await alice.compose(NAMETAG.toString('base64'), 'nametag')
    const key = schnorr.utils.randomSecretKey()
    relay.broadcast(
      await buildThingEvent(
        {
          envelopeHash: outcome.envelopeHash as string,
          type: 'nametag',
          bundle: new Uint8Array(Buffer.from(tarBase64, 'base64')),
          createdAt: 32_500_000_000 // some time in the year 3000
        },
        key
      )
    )

    // The thing itself is fine — the lie is about WHEN, not what.
    await expect
      .poll(async () => (await bob.feed({ type: 'nametag' })).length, { timeout: 15_000 })
      .toBe(1)
    const since = (await bob.relays()).since
    expect(since, 'the cursor did not follow the lie').toBeLessThan(Math.floor(Date.now() / 1000) + 3601)
  } finally {
    await alice.close()
    await bob.close()
  }
})

test('the relay list and the read cursor survive a restart', async () => {
  const dir = profile('shell-relay-restart-')
  const alice = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-restart-a-') } })
  let since = 0
  try {
    {
      const bob = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: dir } })
      try {
        await bob.addRelay(relay.url)
        await connected(bob)
        await alice.addRelay(relay.url)
        await connected(alice)

        const { outcome } = await alice.compose(NAMETAG.toString('base64'), 'nametag')
        expect((await alice.postToRelays(outcome.envelopeHash as string)).posted).toBe(1)

        // Wait for the THING, not for the cursor. The cursor is the shell's
        // record of how far it has read; the arrival is what this test is
        // about, and only one of the two means the library write has landed.
        await expect
          .poll(async () => (await bob.feed({ type: 'nametag' })).length, { timeout: 15_000 })
          .toBe(1)
        since = (await bob.relays()).since
        expect(since, 'reading an event moved the cursor').toBeGreaterThan(0)
      } finally {
        await bob.close()
      }
    }

    // A relay the human added is reconnected to; the cursor means the relay's
    // whole history is not re-read on every launch.
    const again = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: dir } })
    try {
      await connected(again)
      expect((await again.relays()).since).toBe(since)
      expect((await again.feed({ type: 'nametag' })).length, 'what it already holds is still there').toBe(1)

      expect((await again.removeRelay(relay.url)).removed).toBe(true)
      expect((await again.relays()).relays).toEqual([])
    } finally {
      await again.close()
    }
  } finally {
    await alice.close()
  }
})

// ── The windows ──────────────────────────────────────────────────────────────
// The disclosures are the deliverable as much as the transport is, so they are
// asserted rather than assumed: a relay is the first thing here that brings you
// what nobody handed you, and the first that leaks what you are interested in.

test('the relay window says what a relay costs you, and adding one connects', async () => {
  const shell = await launchShell({ extraEnv: { SHELL_USER_DATA_DIR: profile('shell-relay-ui-') } })
  const chromeEval = async <T,>(js: string): Promise<T> =>
    shell.app.evaluate(async (electron, code) => {
      const wc = electron.webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
      if (!wc) throw new Error('no chrome webContents')
      return (await wc.executeJavaScript(code)) as never
    }, js)
  try {
    await chromeEval('window.__shellChrome.openRelays()')
    const body = await chromeEval<string>(
      "document.querySelector('[data-testid=relays-modal]').textContent"
    )
    // The leak nobody expects: what you SUBSCRIBE to is a fact about you.
    expect(body).toMatch(/subscribing tells the relay what you are interested in/i)
    expect(body).toMatch(/nothing is posted automatically/i)
    expect(await chromeEval<string>("document.querySelector('[data-testid=relay-empty]').textContent")).toMatch(
      /nothing is being sent or received/i
    )

    await chromeEval(
      `(() => { const i = document.querySelector('[data-testid=relay-input]'); i.value = ${JSON.stringify(relay.url)}; document.querySelector('[data-testid=relay-add]').click() })()`
    )
    await expect
      .poll(
        () =>
          chromeEval<string>(
            "document.querySelector('[data-testid=relay-state]')?.textContent ?? document.querySelector('[data-testid=relay-note]')?.textContent ?? ''"
          ),
        { timeout: 15_000 }
      )
      .toBe('open')

    // And the other half of the disclosure lives where the posting happens.
    const { outcome } = await shell.compose(NAMETAG.toString('base64'), 'nametag')
    await chromeEval(`window.__shellChrome.openShare(${JSON.stringify(outcome.envelopeHash)}, 'nametag')`)
    const share = await chromeEval<string>("document.querySelector('[data-testid=share-modal]').textContent")
    expect(share).toMatch(/posting hands this thing to every relay you have added/i)
    await expect
      .poll(
        () => chromeEval<string>("document.querySelector('[data-testid=share-relay-note]')?.textContent ?? ''"),
        { timeout: 10_000 }
      )
      .toMatch(/1 relay connected/i)

    expect(relay.received, 'opening the window posts nothing').toEqual([])
    await chromeEval("document.querySelector('[data-testid=share-relay-post]').click()")
    await expect.poll(() => relay.received.length, { timeout: 10_000 }).toBe(1)
  } finally {
    await shell.close()
  }
})
