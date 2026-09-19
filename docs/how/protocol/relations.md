# Relations between letters

The [format](spec.md) defines one letter. Everything social — threads, forums,
votes, contracts, trust — is a **convention in `args`**: a letter names another
letter, or a key, in a field a reader's library knows to index.

These conventions are not part of the wire format, and a reader that ignores them
still verifies every letter correctly. They are what a second implementation needs
in order to show the same forum.

## The rule underneath all of them

**A reference is the author's claim.** Anyone may claim to reply to anything, tag
anything into any group, or name anyone as a signatory. The target's author never
consented. What is *proven* is only ever who signed the letter making the claim —
that comes from the envelope, never from `args`.

So a reader:

- takes **who said it** from the envelope (signature-proven);
- takes **what it is about** from `args` (a claim);
- never lets a claim grant anything by itself.

A letter's own program cannot even see the envelope (`getArgs()` withholds it), so a
program can never learn another letter's hash or its own author. When the app starts
a Comment, an Attestation or a Vote, *it* seeds the target hash into the draft.

## Letter → letter

Indexed by the reference library as `(from, rel, to)` where `to` is a 64-hex
**envelope hash**:

| `args` field | Used by | Meaning |
|---|---|---|
| `replyTo` | `comment` | This answers that. Threads are walked from these, with a visited-set and a depth cap — A replying to B while B replies to A is not corruption, it is Tuesday. |
| `attests` | `attestation` | This is a signed statement about that. |
| `votesOn` | `vote` | This is a vote on that. |
| `inGroup` | any type | This belongs to the forum whose **root** group letter is that. Also carried by `join-request` and by moderators' verdicts. |

`args` is replaced whole by every draft a program emits, and a program has usually
never heard of most of these fields — an article knows nothing about forums. So a
client must **keep the pointers it seeded** and lay them back over every emitted
draft, with its own value winning: the person pressed *Comment* on a particular
letter, or *Write a post* in a particular forum, and the program does not get to
drop or retarget that. The reference client records them with the draft
(`library/pins.ts`), together with `verdict`. A pointer the person *typed* into a
program is ordinary program state and stays editable.

### Votes

`vote` args: `{ votesOn: <hash>, dir: 1 | -1, why?: string }`.

- `dir` is exactly `+1` or `-1`. Anything else is not a vote: a weight a program
  could choose would let one key count for as much as it liked.
- Per `(voter key, target)` only the **latest** vote counts. "Latest" is `created`
  descending, ties broken by local arrival order — `created` is a claim in whole
  seconds, and pressing ▲ then ▼ happens inside one.
- A vote is about a letter; a [vouch](#letter--key) is about a key. They are
  separate so that agreeing with someone never pulls them into your trust graph.

### Verdicts (moderation)

An `attestation` with `{ attests: <post>, inGroup: <forum root>, verdict: "hide" | "endorse" }`.

A reader honours it **only if** the *current roster it holds* for that forum names
the verdict's signer with role `moderator`. The `inGroup` check matters: without it,
a moderator of one group would moderate every group they touch. A hidden post is
folded, never dropped.

### Join requests

`join-request` args: `{ inGroup, calledMe, say }`. It admits nobody. It counts as
*pending* while its author is absent from the current roster, so it resolves itself
the moment the keeper publishes a roster naming them.

## Letter → key

| Type | `args` | Meaning |
|---|---|---|
| `vouch` | `{ about, aboutScheme, name, relation, note }` | The signer recognises the key `about`. Only a voucher's latest vouch per subject counts. |
| `group` | `{ name, purpose, members: [{ key, scheme, role, name }], notes }` | A roster. Being listed is the keeper's claim — **never a trust input**. |
| `contract` | `{ title, body, signers: [{ key, scheme, role, name }] }` | Expected signatories. Being named is not consent and not a signature. |

**Tribe.** A reader computes trust only by walking `vouch` edges *outward from its
own key*, to depth 2. Vouch counts are free to manufacture; a path from yourself is
not. Rosters, votes and inbound vouches never feed it.

## One document, many signatures

Co-signing needs no relation at all. The *document* is the **manifest**; an envelope
is one *signature* over it. N signatories are N envelopes with the same `man` hash,
each verified independently, none privileged. A reader groups them by manifest hash.

A co-signer must sign the stored manifest **byte for byte** and never re-encode it.
(The rejected alternative — a `sigs[]` array inside one envelope — would change the
envelope hash with each signature, so the document's identity would shift as it was
signed.)

## Versions

Defined by the format (§5.3: `path`, `seq`, `prev`); the convention on top is how a
chain starts. The first time a letter is amended, the new version takes
`path = <the original's envelope hash>`, `seq = 2`. Chain identity is therefore
collision-free and says where the line began, and any existing letter is amendable
after the fact.

A chain is `(author key, path)`. Amending someone else's letter therefore yields
*your* line rooted on theirs — never a new version of theirs. For groups and other
chained letters, readers resolve membership and content against the **latest**
version they hold.
