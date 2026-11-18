import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchShell, buildBundle, ethSigner, type ShellHandle } from './helpers.js'
import { jsToCbor } from '../../src/format/index.js'
import { KEEPER, gatedGroupBundle, gatedGroupRoot } from './gated-group.js'

// ── Forums that admit by passport proof ──────────────────────────────────────
// A group stating `requires: 'passport …'` has no roster of members: whoever
// has published a verified proof into it that meets the rule is one. Every
// reader works that out alone, and then counts posts and votes from members
// only. The proofs here are real, made from a synthetic passport for this
// exact group (test/shell/gated-group.ts, test/passport-fixtures).

const FX = join(__dirname, '..', 'passport-fixtures', 'a')
const load = (name: string): Record<string, any> => JSON.parse(readFileSync(join(FX, name), 'utf8'))
const STUB = new TextEncoder().encode('<!doctype html><p>f</p>')
const ALICE = new Uint8Array(32).fill(1)
const BOB = new Uint8Array(32).fill(2)
const MALLORY = new Uint8Array(32).fill(9)

let shell: ShellHandle
let root: string

test.beforeEach(async () => {
  test.setTimeout(120_000)
  shell = await launchShell({ extraEnv: { SHELL_PASSPORT_TEST_ROOT: load('pins.json').registryRoot } })
  const r = await shell.ingest(await gatedGroupBundle())
  expect(r.status).toBe('valid')
  root = r.envelopeHash as string
  // The fixtures' scope names this hash. If it moves, they must be regenerated.
  expect(root).toBe(await gatedGroupRoot())
  expect(load('group-alice.json').scope).toBe(`souspli:group:${root}`)
})
test.afterEach(async () => {
  await shell?.close()
})

const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  shell.app.evaluate(
    async (electron, a) => (await (electron.app as unknown as { __shell: Record<string, (...x: unknown[]) => unknown> }).__shell[a.fn]!(...a.args)) as never,
    { fn, args }
  )

async function publish(priv: Uint8Array, type: string, args: unknown, created = 1_794_000_500): Promise<string> {
  const r = await shell.ingest(await buildBundle(ethSigner(priv), { type, program: STUB, args: jsToCbor(args), created }))
  expect(r.status, String(r.reason ?? '')).toBe('valid')
  return r.envelopeHash as string
}
const post = (priv: Uint8Array, title: string): Promise<string> => publish(priv, 'article', { title, inGroup: root })
const vote = (priv: Uint8Array, target: string): Promise<string> => publish(priv, 'vote', { votesOn: target, dir: 1, inGroup: root })
/** Publish a proof package into the forum, and wait until the shell has settled its verdict. */
async function prove(priv: Uint8Array, fixture: string, created: number): Promise<Record<string, any>> {
  const hash = await publish(priv, 'passport-proof', { ...load(fixture), inGroup: root }, created)
  const header = await shell.openThing(hash)
  return header.credential as Record<string, any>
}
const facts = (): Promise<Record<string, any>> => call('forum', root)
const listed = async (): Promise<string[]> => ((await shell.forumListing(root)).rows as { title?: string }[]).map((r) => String(r.title)).sort()
const ups = async (target: string): Promise<number> => (await call<{ up: number }>('votes', target)).up

test('the forum states its rule, and before any proof nobody is counted', async () => {
  const f = await facts()
  expect(f.requires).toBe('a passport proof: aged 18 or over, a citizen of one of AUS, NZL')
  expect(f.provenMembers).toBe(0)
  expect(f.iAmMember).toBe(false)
  expect(f.proofScope).toBe(`souspli:group:${root}`)

  const p = await post(ALICE, 'from alice')
  await vote(ALICE, p)
  expect(await listed()).toEqual([])
  expect(await ups(p)).toBe(0)
})

test('a proof that meets the rule admits its key: its posts and votes count, a stranger’s do not', async () => {
  const p = await post(ALICE, 'from alice')
  await post(MALLORY, 'from mallory')
  await vote(ALICE, p)
  await vote(MALLORY, p)

  expect(await prove(ALICE, 'group-alice.json', 1_794_000_100)).toMatchObject({ status: 'verified' })
  await expect.poll(async () => (await facts()).provenMembers, { timeout: 30_000 }).toBe(1)
  expect(await listed()).toEqual(['from alice'])
  expect(await ups(p)).toBe(1)
})

test('a proof republished by someone else admits nobody', async () => {
  // Mallory copies Alice's proof letter into the forum under her own key.
  expect(await prove(MALLORY, 'group-alice.json', 1_794_000_100)).toMatchObject({ status: 'invalid' })
  await post(MALLORY, 'from mallory')
  expect((await facts()).provenMembers).toBe(0)
  expect(await listed()).toEqual([])
})

test('a proof of less than the rule asks admits nobody — the keeper included', async () => {
  // Valid proofs, bound to the keeper's own key, for this forum: but "16 or over" and no nationality.
  expect(await prove(KEEPER, 'group-carol-16.json', 1_794_000_100)).toMatchObject({ status: 'verified' })
  await post(KEEPER, 'from the keeper')
  expect((await facts()).provenMembers).toBe(0)
  expect(await listed()).toEqual([])
})

test('a proof made for somewhere else does not count here', async () => {
  // Alice's proofs for the scope "souspli:test": genuine, hers, and about another place.
  expect(await prove(ALICE, 'alice.json', 1_794_000_100)).toMatchObject({ status: 'verified' })
  expect((await facts()).provenMembers).toBe(0)
})

test('one passport is one member: a later proof from the same passport moves the membership', async () => {
  await post(ALICE, 'from alice')
  await post(BOB, 'from bob')
  await prove(ALICE, 'group-alice.json', 1_794_000_100)
  await expect.poll(async () => await listed(), { timeout: 30_000 }).toEqual(['from alice'])
  // The same passport, bound to Bob's key, later. (Bob proved "21 or over, AUS or NZL": stronger on age, and still inside the rule.)
  await prove(BOB, 'group-bob.json', 1_794_000_200)
  await expect.poll(async () => await listed(), { timeout: 30_000 }).toEqual(['from bob'])
  expect((await facts()).provenMembers).toBe(1)
})

test('you are told why you cannot act, and joining starts a proof letter', async () => {
  const p = await post(ALICE, 'from alice')
  await prove(ALICE, 'group-alice.json', 1_794_000_100)
  const voted = await call<{ error?: string }>('vote', p, 1)
  expect(voted.error).toContain('admits by a passport proof: aged 18 or over')
  expect((await shell.newForumPost(root)).error).toContain('admits by a passport proof')

  const join = await shell.requestJoin(root)
  expect(join.id).toBeTruthy()
  const drafts = await call<{ id: string; type: string }[]>('drafts')
  expect(drafts.find((d) => d.id === join.id)?.type).toBe('passport-proof')
})

test('starting such a forum seeds a rule the shell can read, and refuses one it cannot', async () => {
  expect((await call<{ error?: string }>('newGatedGroup', 'passport age>=18 nationality=can')).error).toContain('not a rule')
  const made = await call<{ id?: string }>('newGatedGroup', 'passport age>=18 nationality=CAN')
  expect(made.id).toBeTruthy()
  const drafts = await call<{ id: string; type: string }[]>('drafts')
  expect(drafts.find((d) => d.id === made.id)?.type).toBe('group')
})
