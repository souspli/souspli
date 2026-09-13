# Build brief — the forum

Relays solved *arrival*: a thing can reach someone who never asked for it. What
was still missing was a reason for that person to come back. A forum is it, and
it is the natural test of every primitive built so far.

**If a forum had needed a pile of new primitives, the primitives were wrong.**
It needed one.

| the forum needs | what it already was |
|---|---|
| a place | a **group** — a roster with roles, amended through its version chain |
| a post in that place | a new indexed rel, `inGroup: <group root hash>` |
| threading | `replyTo`, walked as deep as it goes instead of one level |
| moderation | an **attestation** by a key the roster names `moderator` |
| whose opinion counts | `tribe()` — the depth-2 vouch walk |
| **a vote** | **the one new thing type** |

---

## 1. Votes are not vouches

A vote is about a **thing**. A vouch is about a **key**. That is not a naming
choice, it is the sybil defence: `tribe()` walks vouch edges, so an upvote that
was a vouch would drag every author you ever agreed with one hop inside your own
trust graph — the exact hole the groups work sealed.

- Type `vote`, args `{ votesOn: <hash>, dir: 1 | -1, why?: string }`.
- `votesOn` joins `INDEXED_RELS`, so `refs` indexes it like any other claim.
- Direction needs a column `refs` does not have, so a `votes` table carries it,
  populated in `store()` beside the existing `vouches` hook.
- **`dir` is exactly ±1.** Anything else — `0`, `7`, `"up"`, a float (canonical
  CBOR refuses those anyway) — is program data, not a vote. A weight a program
  could choose would let one key count for as much as it liked.

### Latest word wins, and `created` alone cannot decide it

A key that votes twice has only its latest vote counted — the same rule vouches
use, because a signed thing cannot be unsaid and repeating yourself must not buy
weight.

But `created` is an author claim in whole **seconds**, and pressing ▲ then ▼
happens well inside one. With `created` alone the two votes tie and SQLite picks
whichever it likes. So the ordering is `created DESC, rowid DESC`: the rowid
breaks the tie by the only other fact available — the order they arrived *here*.
That is a local observation rather than the author's word, which is exactly what
makes it usable.

## 2. Ranking is tribe-weighted, and says so

The sentence attestations already earn: **"47 votes, 6 from your tribe."**

Raw counts are free to manufacture — a thousand keys cost nothing. Votes from
people you reached through your own vouches are not. Both numbers are shown,
side by side, everywhere a vote appears. Merging them into one score would
produce exactly the ranking nobody can explain.

Listings order by **tribe score, then raw score, then recency**.

> **The failure mode that matters most.** With no vouches of your own, every
> tribe score is 0 and the order silently degrades to raw popularity — the
> forgeable kind. `tribeEmpty` reports that, and the forum window says it in
> words. A new reader must never be handed the manufacturable ranking with no
> warning.

## 3. Moderation is an attestation — forced, not chosen

Nobody can delete anyone's signed thing, so moderation can only ever be
advisory. The only question is what carries the advice.

The obvious design — a `hidden: [...]` list in the group's own args — **cannot
work**, and the reason is worth writing down: a chain is `(author_key, path)`,
so a moderator amending the founder's group starts *their own* line rather than
a new version of it. A removal list in the group revision would make the founder
the only possible moderator.

So a verdict is an **attestation** carrying `attests: <post>`,
`inGroup: <forum root>`, and `verdict: hide | endorse`, signed by a key the
forum's current roster names with role `moderator`. Fine-grained, auditable, no
group revision needed, any number of moderators.

Three properties the shell holds:

- **A verdict names its forum.** Without that check, a moderator of one group
  moderates every group they touch.
- **A hidden post is folded, never dropped.** The row says *who* hid it and
  *why*, with "show anyway" beside it. Disagreeing has to stay possible — that
  is the difference between a forum and a memory hole.
- **A moderator's reach is exactly the roster you hold.** Hold no group and
  nobody moderates anything for you; hold a later revision that drops them and
  their reach ends. Being named is the keeper's claim, not the moderator's
  consent.

## 4. Joining

A `join-request` thing carrying `inGroup`. Anyone may publish one, and it admits
nobody: only the keeper can publish a roster that names you.

A request counts as pending while its author is **not on the current roster** —
so it stops being pending the moment the keeper writes them in, without anyone
marking it accepted. The roster *is* the answer.

## 5. The feed rolls up

The complaint this answers: a busy forum must not bury a memo from your boss.

Behind `rollUp` (on for the main feed, off for every other caller):

- **a `vote` never gets its own row** — it is activity, not content;
- **a reply whose target you hold is not top-level** — it folds into its root.
  Scoped to targets actually held, because a reply to something you *don't*
  have must still show: you have the reply, and hiding it hides your only copy;
- each surviving row carries `activity: { replies, votes }`, where `replies` is
  the whole subtree — "12 replies" on a thread 12 deep must not read as 1.

Counts come from one depth-capped recursive CTE over `refs` per feed call, not a
walk per row.

Forum listings drop the same machinery plus **join requests and verdicts**: none
of those is something anyone came to read, and listing them would let a thread's
own bookkeeping outrank the thread.

## 6. Threading

A frontier walk in TypeScript with a `seen` set, `maxDepth = 32` and a node cap
— modelled on `tribe()`, deliberately not a recursive CTE. `replyTo` is a free
claim, so A answering B while B answers A is not a corrupt database, it is
Tuesday. A walk that obviously terminates beats one that needs an argument.

## 7. What is here

- `src/shell/library/index.ts` — `votes` table, `votesOn`/`inGroup` rels,
  `refs_backfill_v3`, `thread`, `descendantCounts`, `voteCounts`, the roll-up
- `src/shell/main.ts` — `castVote`, `voteFacts`, `threadFor`, `forumFacts`,
  `forumListing`, `moderatorsOf`, `verdictOn`, `requestJoin`, `newVerdict`
- `src/shell/chrome/` — the vote control, the Forums window, one forum's ranked
  posts, the threaded reply tree, roll-up counts on feed rows
- `samples/vote.html`, `samples/join-request.html`
- `test/shell/forum.spec.ts` — 19 tests
- `pnpm world forum` — several accounts, one forum, different tribes

## 8. Known risks

**`inGroup` is a claim like every other.** Anyone may tag anything into any
forum, and the roster never consented to its posts. What limits the damage is
that ranking and moderation both run through keys you reached yourself.

**Casting a vote signs without a confirm dialog**, exactly as Copy does. The
confirm exists because a *program* asked to publish in your name; a vote comes
from a control in trusted chrome, on a thing already on your screen. If that
line ever blurs — if a program can get a vote cast — this is the place it
breaks.

**Ranking is the attack surface.** Not the counting, which is cheap to get
right, but the quiet fallback: any path where a tribe-weighted order degrades to
a raw one without saying so hands a reader a forgeable ranking dressed as a real
one.
