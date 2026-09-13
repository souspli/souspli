import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchShell, buildBundle, ethSigner, secp256k1, type ShellHandle } from './helpers.js'

// ── The forum ────────────────────────────────────────────────────────────────
// A forum needed one new thing type. Everything else it is made of already
// existed, which is the claim these tests hold:
//
//   a place       a GROUP — a roster with roles, named by its chain's root
//   a post        any thing carrying `inGroup: <root>`
//   a reply       `replyTo`, walked as deep as it goes
//   a moderator   a roster entry whose role says so
//   a verdict     an ATTESTATION by one of those keys
//   a vote        the one new type
//
// Every one of those is an author CLAIM. What stops the claims being worth
// anything on their own is that ranking runs through YOUR tribe and moderation
// runs through a roster you chose to hold — so the tests that matter most here
// are the ones where a stranger says something and nothing happens.

const NAMETAG = readFileSync(join(__dirname, '..', '..', 'samples', 'nametag.html'))
const STUB = new TextEncoder().encode('<!doctype html><p>f</p>')

let shell: ShellHandle
test.beforeEach(async () => {
  test.setTimeout(60_000)
  shell = await launchShell()
})
test.afterEach(async () => {
  await shell?.close()
})

/** A key with one thing in the library, so People knows of it. */
async function person(): Promise<{ priv: Uint8Array; key: string }> {
  const priv = secp256k1.utils.randomSecretKey()
  const bundle = await buildBundle(ethSigner(priv), { type: 'nametag', program: new Uint8Array(NAMETAG) })
  const outcome = await shell.ingest(bundle)
  expect(outcome.status).toBe('valid')
  return { priv, key: (outcome.author as { k: string }).k }
}

/** Publish a thing as some other key and admit it, like anything arriving. */
async function asKey(
  priv: Uint8Array,
  type: string,
  args: Map<string, unknown>,
  created?: number
): Promise<string> {
  const bundle = await buildBundle(ethSigner(priv), {
    type,
    program: STUB,
    args,
    ...(created === undefined ? {} : { created })
  })
  const outcome = await shell.ingest(bundle)
  expect(outcome.status, String(outcome.reason ?? '')).toBe('valid')
  return outcome.envelopeHash as string
}

const voteBy = (priv: Uint8Array, target: string, dir: 1 | -1, created?: number): Promise<string> =>
  asKey(priv, 'vote', new Map<string, unknown>([['votesOn', target], ['dir', dir]]), created)

const replyBy = (priv: Uint8Array, target: string, group?: string): Promise<string> =>
  asKey(
    priv,
    'comment',
    new Map<string, unknown>([['replyTo', target], ...(group ? ([['inGroup', group]] as [string, unknown][]) : [])])
  )

/** A group naming `members`, published by `priv`. Returns its root hash. */
const groupBy = (
  priv: Uint8Array,
  name: string,
  members: { key: string; role?: string; name?: string }[]
): Promise<string> =>
  asKey(
    priv,
    'group',
    new Map<string, unknown>([
      ['name', name],
      [
        'members',
        members.map(
          (m) =>
            new Map<string, string>([
              ['key', m.key],
              ['scheme', 'eth-eip191'],
              ['role', m.role ?? ''],
              ['name', m.name ?? '']
            ])
        )
      ]
    ])
  )

// ── Votes ────────────────────────────────────────────────────────────────────

test('a vote is counted for the key that SIGNED it, and a later vote replaces it', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'hello']]))
  const bob = await person()

  expect((await shell.votes(post)).up, 'nothing has voted').toBe(0)

  await voteBy(bob.priv, post, 1, 1000)
  expect((await shell.votes(post)).up).toBe(1)

  // The same key voting again is amending, not adding. A signed thing cannot
  // be unsaid, so changing your mind means publishing a LATER vote — and
  // repeating yourself must never buy extra weight.
  await voteBy(bob.priv, post, -1, 2000)
  const after = await shell.votes(post)
  expect(after.up, 'the earlier vote is superseded, not stacked').toBe(0)
  expect(after.down).toBe(1)
  expect(after.score).toBe(-1)

  // A different key is a different voter.
  const carol = await person()
  await voteBy(carol.priv, post, 1, 3000)
  expect((await shell.votes(post)).up).toBe(1)
  expect((await shell.votes(post)).down).toBe(1)
})

test('a vote names a thing, not a key — junk directions are not votes', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'hello']]))
  const bob = await person()

  // A weight a program could choose would let one key count for as much as it
  // liked, so anything that is not exactly ±1 is program data.
  await asKey(bob.priv, 'vote', new Map<string, unknown>([['votesOn', post], ['dir', 99]]))
  await asKey(bob.priv, 'vote', new Map<string, unknown>([['votesOn', post], ['dir', 'up']]))
  await asKey(bob.priv, 'vote', new Map<string, unknown>([['votesOn', post]]))
  // A vote pointing at nothing is not a vote either.
  await asKey(bob.priv, 'vote', new Map<string, unknown>([['dir', 1]]))
  const tally = await shell.votes(post)
  expect(tally.up + tally.down, 'none of those were votes').toBe(0)
})

test('"3 votes, 1 from your tribe" — a stranger’s votes reach nothing', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'hello']]))

  const friend = await person()
  const strangerA = await person()
  const strangerB = await person()
  for (const p of [friend, strangerA, strangerB]) await voteBy(p.priv, post, 1)

  // Before you vouch for anybody, every vote is a stranger's. The raw count is
  // 3 and is worth exactly nothing, which the numbers must say rather than
  // hide behind a single score.
  const before = await shell.votes(post)
  expect(before.up).toBe(3)
  expect(before.tribeUp, 'your tribe is empty').toBe(0)

  // Vouch for one of them. Only paths that start at YOUR key count — that is
  // the whole defence, and it is the same one attestations already use.
  const vouch = await shell.newVouch('eth-eip191', friend.key)
  expect(vouch.id, String(vouch.error ?? '')).toBeTruthy()
  await publishDraft(vouch.id!)

  const after = await shell.votes(post)
  expect(after.up, 'the raw count has not changed').toBe(3)
  expect(after.tribeUp, 'one of the three is now someone you reached').toBe(1)
  expect(after.tribeScore).toBe(1)
})

test('your own vote is reported back, and voting the same way twice is refused', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'hello']]))

  expect((await shell.votes(post)).mine).toBe(0)
  const cast = await shell.vote(post, 1)
  expect(cast.error ?? null).toBeNull()
  expect(cast.mine).toBe(1)
  expect(cast.up).toBe(1)
  // Your own vote counts toward your own tribe reading of it: you are the one
  // key you never had to vouch for.
  expect((await shell.votes(post)).mine).toBe(1)

  expect((await shell.vote(post, 1)).error, 'no second identical vote').toMatch(/already voted/i)

  // Changing your mind is publishing a later vote, and the count follows.
  const flipped = await shell.vote(post, -1)
  expect(flipped.error ?? null).toBeNull()
  expect(flipped.up).toBe(0)
  expect(flipped.down).toBe(1)
})

// ── Threading ────────────────────────────────────────────────────────────────

test('a reply to a reply to a post is found, at its real depth', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'hello']]))
  const bob = await person()
  const carol = await person()
  const r1 = await replyBy(bob.priv, post)
  const r2 = await replyBy(carol.priv, r1)
  const r3 = await replyBy(bob.priv, r2)

  const thread = await shell.thread(post)
  expect(thread.count).toBe(3)
  const byHash = new Map(thread.rows.map((r) => [r.envelopeHash as string, r]))
  expect(byHash.get(r1)!.depth).toBe(1)
  expect(byHash.get(r2)!.depth).toBe(2)
  expect(byHash.get(r3)!.depth).toBe(3)
  expect(byHash.get(r2)!.parent).toBe(r1)
  // Every entry carries what its votes are worth, so a thread can be ranked
  // without a second round trip per comment.
  expect(byHash.get(r1)!.votes).toBeTruthy()
})

test('a replyTo cycle terminates instead of hanging', async () => {
  // replyTo is a free claim: A answering B while B answers A is not a corrupt
  // database, it is Tuesday. The walk has to survive it.
  const alice = await person()
  const a = await asKey(alice.priv, 'comment', new Map([['body', 'first']]))
  const b = await asKey(alice.priv, 'comment', new Map<string, unknown>([['body', 'second'], ['replyTo', a]]))
  // Now make `a` claim to answer `b`, by publishing it again pointing back.
  const a2 = await asKey(alice.priv, 'comment', new Map<string, unknown>([['body', 'first'], ['replyTo', b]]))

  const thread = await shell.thread(a)
  // b answers a; a2 answers b; nothing answers a2. It stops there rather than
  // going round again.
  expect(thread.rows.map((r) => r.envelopeHash).sort()).toEqual([a2, b].sort())
})

// ── The feed rolls up ────────────────────────────────────────────────────────

test('a reply does not get its own feed row; the thing it answers does, with the count', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'hello']]))
  const bob = await person()
  const r1 = await replyBy(bob.priv, post)
  await replyBy(bob.priv, r1)
  await voteBy(bob.priv, post, 1)

  const flat = await shell.feed({ limit: 200 })
  const rolled = await shell.feed({ limit: 200, rollUp: true })
  expect(flat.length, 'the library still holds every one of them').toBeGreaterThan(rolled.length)

  const hashes = rolled.map((r) => r.envelopeHash)
  expect(hashes, 'the post keeps its row').toContain(post)
  expect(hashes, 'its replies fold into it').not.toContain(r1)
  expect(rolled.some((r) => r.type === 'vote'), 'a vote is activity, not content').toBe(false)

  const row = rolled.find((r) => r.envelopeHash === post) as { activity: Record<string, number> }
  expect(row.activity.replies, 'the whole subtree, not just direct answers').toBe(2)
  expect(row.activity.up).toBe(1)
})

test('a reply to something you do NOT hold keeps its row', async () => {
  // You have the reply and not the thing it answers, so folding it away would
  // hide the only copy you have.
  const bob = await person()
  const orphan = await asKey(bob.priv, 'comment', new Map([['replyTo', 'f'.repeat(64)]]))
  const rolled = await shell.feed({ limit: 200, rollUp: true })
  expect(rolled.map((r) => r.envelopeHash)).toContain(orphan)
})

// ── Forums ───────────────────────────────────────────────────────────────────

test('a reply in a forum belongs under its post, not on the front page', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'p'], ['inGroup', forum]]))
  const bob = await person()
  // A reply carries inGroup so it travels with the forum — which is right, and
  // is exactly why the listing has to fold it rather than rank it as a post.
  const reply = await replyBy(bob.priv, post, forum)
  const deep = await replyBy(alice.priv, reply, forum)

  const listing = await shell.forumListing(forum)
  expect(listing.rows.map((r) => r.envelopeHash), 'one post, not three').toEqual([post])
  // They are not gone: the thread under the post has both.
  expect((await shell.thread(post)).rows.map((r) => r.envelopeHash).sort()).toEqual([reply, deep].sort())
})

test('a forum is a group: its posts, its roster, and who moderates', async () => {
  const founder = await person()
  const mod = await person()
  const forum = await groupBy(founder.priv, 'Tools', [
    { key: founder.key, role: 'founder', name: 'Ada' },
    { key: mod.key, role: 'moderator', name: 'Mo' }
  ])

  const facts = await shell.forum(forum)
  expect(facts.error ?? null).toBeNull()
  expect(facts.name).toBe('Tools')
  expect(facts.members).toBe(2)
  expect((facts.moderators as { key: string }[]).map((m) => m.key)).toEqual([mod.key])
  expect(facts.iAmModerator).toBe(false)

  const alice = await person()
  const post = await asKey(
    alice.priv,
    'article',
    new Map<string, unknown>([['title', 'a post'], ['inGroup', forum]])
  )
  const listing = await shell.forumListing(forum)
  expect(listing.rows.map((r) => r.envelopeHash)).toEqual([post])

  // A forum shows up in the list of forums you hold, under its ROOT hash, so
  // a post keeps pointing at it across every revision of the roster.
  const forums = await shell.forums()
  expect(forums.map((f) => f.root)).toContain(forum)
})

test('posts rank by tribe first, and say so when your tribe is empty', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])
  const alice = await person()
  const bob = await person()
  const loud = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'loud'], ['inGroup', forum]]))
  const quiet = await asKey(bob.priv, 'article', new Map<string, unknown>([['title', 'quiet'], ['inGroup', forum]]))

  // Three strangers shout for `loud`; one person you know prefers `quiet`.
  const friend = await person()
  for (const _ of [0, 1, 2]) await voteBy((await person()).priv, loud, 1)
  await voteBy(friend.priv, quiet, 1)

  const beforeVouch = await shell.forumListing(forum)
  expect(beforeVouch.tribeEmpty, 'nothing you did reaches anybody yet').toBe(true)
  // With no tribe, the ordering IS raw popularity — the manufacturable kind.
  // That is allowed, but it must be admitted rather than passed off as
  // ranking, which is what tribeEmpty is for.
  expect(beforeVouch.rows[0]!.envelopeHash).toBe(loud)

  const vouch = await shell.newVouch('eth-eip191', friend.key)
  await publishDraft(vouch.id as string)

  const after = await shell.forumListing(forum)
  expect(after.tribeEmpty).toBe(false)
  expect(after.rows[0]!.envelopeHash, 'one vote you can trace beats three you cannot').toBe(quiet)
  // Both numbers travel with the row, because an ordering nobody can explain
  // is worse than no ordering.
  expect((after.rows[0]!.votes as Record<string, number>).tribeScore).toBe(1)
  expect((after.rows[1]!.votes as Record<string, number>).score).toBe(3)
})

// ── Moderation ───────────────────────────────────────────────────────────────

test('a moderator’s verdict folds a post; a stranger’s changes nothing', async () => {
  const founder = await person()
  const mod = await person()
  const stranger = await person()
  const forum = await groupBy(founder.priv, 'Tools', [
    { key: founder.key, role: 'founder' },
    { key: mod.key, role: 'moderator', name: 'Mo' }
  ])
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'spam'], ['inGroup', forum]]))

  // A stranger saying "hide this" is just a stranger with an opinion.
  await asKey(
    stranger.priv,
    'attestation',
    new Map<string, unknown>([['attests', post], ['inGroup', forum], ['verdict', 'hide']])
  )
  const listed = async (): Promise<Record<string, unknown>> => {
    const l = await shell.forumListing(forum)
    // The verdicts themselves are not posts: a forum's own bookkeeping must
    // not outrank the thread it is about.
    expect(l.rows.map((r) => r.envelopeHash), 'only the post is listed').toEqual([post])
    return l.rows[0]!
  }
  expect((await listed()).verdict, 'not a moderator here').toBeNull()

  // The same words from a key the roster YOU hold names a moderator.
  await asKey(
    mod.priv,
    'attestation',
    new Map<string, unknown>([
      ['attests', post],
      ['inGroup', forum],
      ['verdict', 'hide'],
      ['statement', 'off topic']
    ])
  )
  const verdict = (await listed()).verdict as Record<string, unknown>
  expect(verdict).toBeTruthy()
  expect(verdict.verdict).toBe('hide')
  expect(verdict.by).toBe(mod.key)
  expect(verdict.byName).toBe('Mo')
  expect(verdict.why, 'and WHY, so disagreeing stays possible').toBe('off topic')

  // Folded, never deleted: the post is still in the library and still opens.
  expect((await shell.feed({ limit: 200 })).some((r) => r.envelopeHash === post)).toBe(true)
  expect((await shell.openThing(post)).envelopeHash).toBe(post)
})

test('a moderator of one forum does not moderate another', async () => {
  const founder = await person()
  const mod = await person()
  const here = await groupBy(founder.priv, 'Here', [{ key: mod.key, role: 'moderator' }])
  const elsewhere = await groupBy(founder.priv, 'Elsewhere', [{ key: founder.key, role: 'founder' }])
  const alice = await person()
  const post = await asKey(
    alice.priv,
    'article',
    new Map<string, unknown>([['title', 'p'], ['inGroup', elsewhere]])
  )

  // The verdict names the forum this key moderates, but the post is in a
  // different one. Without that check a moderator anywhere moderates
  // everywhere.
  await asKey(
    mod.priv,
    'attestation',
    new Map<string, unknown>([['attests', post], ['inGroup', here], ['verdict', 'hide']])
  )
  const rows = (await shell.forumListing(elsewhere)).rows
  expect(rows.map((r) => r.envelopeHash)).toEqual([post])
  expect(rows[0]!.verdict).toBeNull()
})

test('publishing a verdict is refused unless the roster names you a moderator', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'p'], ['inGroup', forum]]))
  const refused = await shell.newVerdict(post, forum, 'hide')
  expect(refused.error).toMatch(/does not name you a moderator/i)
})

// ── Joining ──────────────────────────────────────────────────────────────────

test('a join request is pending until the roster names them — asking is not joining', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])
  const hopeful = await person()

  expect((await shell.forum(forum)).pending).toEqual([])

  await asKey(hopeful.priv, 'join-request', new Map<string, unknown>([['inGroup', forum], ['calledMe', 'Pat']]))
  const pending = (await shell.forum(forum)).pending as { authorKey: string }[]
  expect(pending.length, 'asking puts you on no roster').toBe(1)
  expect(pending[0]!.authorKey).toBe(hopeful.key)

  // The keeper publishes a new version naming them. The request stops being
  // pending because the ROSTER is the answer — nobody marks it accepted.
  const roster2 = await buildBundle(ethSigner(founder.priv), {
    type: 'group',
    program: STUB,
    args: new Map<string, unknown>([
      ['name', 'Tools'],
      [
        'members',
        [
          new Map([['key', founder.key], ['scheme', 'eth-eip191'], ['role', 'founder'], ['name', '']]),
          new Map([['key', hopeful.key], ['scheme', 'eth-eip191'], ['role', ''], ['name', 'Pat']])
        ]
      ]
    ]),
    path: forum,
    seq: 1,
    prev: Buffer.from(forum, 'hex')
  })
  expect((await shell.ingest(roster2)).status).toBe('valid')

  const after = await shell.forum(forum)
  expect(after.pending).toEqual([])
  expect(after.members).toBe(2)
})

test('a join request seeded by the shell names the forum', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])
  const started = await shell.requestJoin(forum)
  expect(started.id, String(started.error ?? '')).toBeTruthy()
  const drafts = await shell.drafts()
  const draft = drafts.find((d) => d.id === started.id)!
  expect(draft.type).toBe('join-request')
  expect((draft.args as { inGroup: string }).inGroup).toBe(forum)
})

test('a post started in a forum carries it, and so does a reply to that post', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])

  const started = await shell.newForumPost(forum)
  expect(started.id, String(started.error ?? '')).toBeTruthy()
  const draft = (await shell.drafts()).find((d) => d.id === started.id)!
  expect((draft.args as { inGroup: string }).inGroup).toBe(forum)

  // Replying to something in a forum keeps the reply in that forum. A reader
  // pressing Comment is not separately deciding to post to the forum, and a
  // reply that quietly left it would vanish from where anyone is reading.
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'p'], ['inGroup', forum]]))
  const reply = await shell.newComment(post)
  const replyDraft = (await shell.drafts()).find((d) => d.id === reply.id)!
  expect((replyDraft.args as { inGroup: string }).inGroup).toBe(forum)
})

// ── The windows ──────────────────────────────────────────────────────────────

const chromeEval = async <T,>(js: string): Promise<T> =>
  shell.app.evaluate(async (electron, code) => {
    const wc = electron.webContents
      .getAllWebContents()
      .find((w) => !w.isDestroyed() && w.getURL().includes('shell/chrome'))
    if (!wc) throw new Error('no chrome webContents')
    return (await wc.executeJavaScript(code)) as never
  }, js)

test('the forum window shows both numbers, and says when the ranking is worthless', async () => {
  const founder = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: founder.key, role: 'founder' }])
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'p'], ['inGroup', forum]]))
  await voteBy((await person()).priv, post, 1)

  await chromeEval(`window.__shellChrome.openForum(${JSON.stringify(forum)})`)
  await expect
    .poll(() => chromeEval<number>("document.querySelectorAll('[data-testid=forum-post]').length"), {
      timeout: 15_000
    })
    .toBe(1)

  // With no vouches of your own the order IS raw popularity — the kind anyone
  // can manufacture. Saying so is the whole point; quietly degrading to it
  // would hand a new reader the forgeable ranking with no warning.
  const warn = await chromeEval<string>(
    "document.querySelector('[data-testid=forum-no-tribe]')?.textContent ?? ''"
  )
  expect(warn).toMatch(/anyone can manufacture/i)
  expect(warn).toMatch(/vouch for someone you actually know/i)

  const score = await chromeEval<string>("document.querySelector('[data-testid=forum-score]').title")
  expect(score).toMatch(/1 vote/)
  expect(score, 'and that none of it is yours').toMatch(/none from anyone your vouches reach/i)
})

test('a hidden post is folded, not gone — the row says who and offers it anyway', async () => {
  const founder = await person()
  const mod = await person()
  const forum = await groupBy(founder.priv, 'Tools', [{ key: mod.key, role: 'moderator', name: 'Mo' }])
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map<string, unknown>([['title', 'p'], ['inGroup', forum]]))
  await asKey(
    mod.priv,
    'attestation',
    new Map<string, unknown>([
      ['attests', post],
      ['inGroup', forum],
      ['verdict', 'hide'],
      ['statement', 'off topic']
    ])
  )

  await chromeEval(`window.__shellChrome.openForum(${JSON.stringify(forum)})`)
  await expect
    .poll(() => chromeEval<number>("document.querySelectorAll('[data-testid=forum-hidden]').length"), {
      timeout: 15_000
    })
    .toBe(1)
  const fold = await chromeEval<string>("document.querySelector('[data-testid=forum-hidden]').textContent")
  expect(fold, 'who hid it').toMatch(/Mo/)
  expect(fold, 'and why').toMatch(/off topic/)

  // A moderator hides nothing FROM you. Disagreeing has to stay possible, so
  // the post is one press away and the fold is the only thing that goes.
  expect(await chromeEval<number>("document.querySelectorAll('[data-testid=forum-post]').length")).toBe(0)
  await chromeEval("document.querySelector('[data-testid=forum-show-anyway]').click()")
  await expect
    .poll(() => chromeEval<number>("document.querySelectorAll('[data-testid=forum-post]').length"), {
      timeout: 10_000
    })
    .toBe(1)
})

test('the vote control signs on a press, and the feed shows what folded into a row', async () => {
  const alice = await person()
  const post = await asKey(alice.priv, 'article', new Map([['title', 'p']]))
  const bob = await person()
  await replyBy(bob.priv, post)

  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(post)})`)
  await expect
    .poll(() => chromeEval<string>("document.querySelector('[data-testid=header-votes]')?.getAttribute('data-score') ?? ''"), {
      timeout: 15_000
    })
    .toBe('0')

  await chromeEval("document.querySelector('[data-testid=vote-up]').click()")
  await expect
    .poll(() => chromeEval<string>("document.querySelector('[data-testid=vote-score]')?.textContent ?? ''"), {
      timeout: 15_000
    })
    .toBe('+1')
  expect(await shell.votes(post)).toMatchObject({ up: 1, mine: 1 })

  // And the feed row for the post carries what folded into it, rather than
  // the reply and the vote each taking a row of their own.
  await expect
    .poll(
      () =>
        chromeEval<string>(
          `document.querySelector('[data-testid=feed-activity]')?.textContent ?? ''`
        ),
      { timeout: 15_000 }
    )
    .toMatch(/1 reply/)
})

/** Publish a seeded draft through the chrome, approving the confirm the way a
 *  human would — there is no path that signs something a human never saw. */
async function publishDraft(draftId: string): Promise<void> {
  await chromeEval(`window.__shellChrome.openThing(${JSON.stringify(draftId)})`)
  await expect
    .poll(
      () =>
        shell.app.evaluate(async (electron) => {
          const s = (electron.app as unknown as { __shell: { publishDraft: () => Record<string, unknown> } }).__shell
          return s.publishDraft() as never
        }) as Promise<Record<string, unknown>>,
      { timeout: 20_000 }
    )
    .toMatchObject({ status: 'pending' })
  await expect
    .poll(() => chromeEval<boolean>(`!!document.querySelector('[data-testid=confirm-approve]')`), { timeout: 20_000 })
    .toBe(true)
  await chromeEval(`document.querySelector('[data-testid=confirm-approve]').click()`)
  await expect
    .poll(
      () =>
        shell.app.evaluate(async (electron) => {
          const s = (electron.app as unknown as { __shell: { lastPublish: Record<string, unknown> | null } }).__shell
          return s.lastPublish as never
        }) as Promise<Record<string, unknown> | null>,
      { timeout: 20_000 }
    )
    .toMatchObject({ status: 'valid' })
}
