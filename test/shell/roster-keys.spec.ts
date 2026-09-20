import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, jsToCbor, type ShellHandle } from './helpers.js'

// ── Keys, written the way people write them ──────────────────────────────────
// The app shows an address as 0xD879…5632, so that is what gets pasted into a
// roster or a contract. The index accepted bare lowercase hex only and dropped
// anything else as junk, silently: the keeper of the welcome forum listed
// themselves as moderator and was ignored by their own app. Every fixture and
// the whole world harness wrote bare hex, so nothing had ever typed a key the
// way a human does.

let shell: ShellHandle
test.beforeAll(async () => {
  shell = await launchShell()
})
test.afterAll(async () => {
  await shell.close()
})

const priv = (): Uint8Array => secp256k1.utils.randomSecretKey()
const bare = (p: Uint8Array): string => [...ethSigner(p).pubkey].map((b) => b.toString(16).padStart(2, '0')).join('')
/** 0x-prefixed with mixed case, as a checksummed address is displayed. */
const displayed = (hex: string): string => '0x' + [...hex].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('')

test('a roster key written as 0x… in any case is the same key: moderators are recognised', async () => {
  const mod = priv()
  const me = (await shell.identity()).address // already 0x-prefixed, as displayed
  const forum = await shell.ingest(
    await buildBundle(ethSigner(priv()), {
      type: 'group',
      args: jsToCbor({
        name: 'Typed by a human',
        purpose: '',
        notes: '',
        members: [
          { key: displayed(bare(mod)), scheme: 'eth-eip191', role: 'moderator', name: 'Mo' },
          { key: me, scheme: 'eth-eip191', role: 'moderator', name: 'me' },
          { key: bare(priv()), scheme: 'eth-eip191', role: 'member', name: 'bare hex still works' },
          { key: 'not a key at all', scheme: 'eth-eip191', role: 'moderator', name: 'junk is still junk' }
        ]
      })
    })
  )
  expect(forum.status).toBe('valid')
  const facts = await shell.forum(String(forum.envelopeHash))
  expect(facts.members).toBe(3)
  expect((facts.moderators as { key: string; name: string }[]).map((m) => m.name).sort()).toEqual(['Mo', 'me'])
  // Stored normalised, so every later comparison is against one spelling.
  expect((facts.moderators as { key: string }[]).map((m) => m.key)).toContain(bare(mod))
  // The point of it: the keeper's own app knows they moderate.
  expect(facts.iAmModerator).toBe(true)
  expect(facts.iAmMember).toBe(true)
})

test('…and a verdict by a moderator listed that way is honoured', async () => {
  const mod = priv()
  const forum = await shell.ingest(
    await buildBundle(ethSigner(priv()), {
      type: 'group',
      args: jsToCbor({ name: 'Desk', purpose: '', notes: '', members: [{ key: displayed(bare(mod)), scheme: 'eth-eip191', role: 'moderator', name: 'Mo' }] })
    })
  )
  const root = String(forum.envelopeHash)
  const post = await shell.ingest(await buildBundle(ethSigner(priv()), { type: 'article', args: jsToCbor({ title: 'BUY GOLD', inGroup: root }) }))
  await shell.ingest(
    await buildBundle(ethSigner(mod), {
      type: 'attestation',
      args: jsToCbor({ attests: String(post.envelopeHash), inGroup: root, verdict: 'hide', statement: 'spam' })
    })
  )
  const row = (await shell.forumListing(root)).rows.find((r) => r.envelopeHash === post.envelopeHash)!
  expect((row.verdict as { verdict: string; byName: string }).verdict).toBe('hide')
  expect((row.verdict as { byName: string }).byName).toBe('Mo')
})

test('a contract that names its parties as 0x… addresses counts their signatures', async () => {
  const alice = priv()
  const bob = priv()
  const args = jsToCbor({
    title: 'Lease',
    body: 'Terms.',
    signers: [
      { key: displayed(bare(alice)), scheme: 'eth-eip191', role: 'party', name: 'Alice' },
      { key: '0x' + bare(bob), scheme: 'eth-eip191', role: 'party', name: 'Bob' }
    ]
  })
  const signed = await shell.ingest(await buildBundle(ethSigner(alice), { type: 'contract', args, created: 1_700_000_000 }))
  expect(signed.status).toBe('valid')
  const row = (await shell.feed()).find((r) => r.envelopeHash === signed.envelopeHash)!
  const doc = await shell.document(String(row.manifestHash))
  // Before: nobody was named, so Alice's signature read as "plus 1 not named".
  expect(doc.namedCount).toBe(2)
  expect(doc.namedSignedCount).toBe(1)
  expect(doc.unnamedSignedCount).toBe(0)
  expect(doc.namedSigners.filter((n) => n.signed).map((n) => n.name)).toEqual(['Alice'])
})
