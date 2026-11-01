# People, vouches and your tribe

Souspli has no usernames, no follower counts and no reputation score. It has keys,
and three ways of attaching meaning to them — each deliberately different.

**File → People…** lists every key whose letters you hold, with the name each one
gave itself, in quotes, if it has signed a nametag or card. That name is their own
claim. Anyone can pick any name, so it never replaces yours for them.

## Finding someone

The **find box** above the feed takes either of these:

- **Part of a key.** The start (`0x3f2a`), or a start and an end as the app shortens
  addresses (`0xd879…5632`).
- **A name.** Your petname for them, the name they gave themselves, or a name someone
  else gave them on a roster or in a vouch. Case doesn't matter.

Names from other people are claims, so matching one doesn't prove the letter is
from who you meant. The key is beside every row. To be sure, search by key.

The letter count beside each person in People is a link. Press it to fill the find
box with that person's full address and see everything you hold from them.

**To you**, beside All, Mine and Replies, lists letters addressed to you and none
you wrote: private letters you can open, plus public ones that name your key (a
vouch about you, a contract you're asked to sign, a group that lists you).

## Petnames: private

A **petname** is what *you* call a key: "Ada", "the ops account", "landlord". It is
stored only on your machine, never enters a letter, and nobody else ever sees it.

That is exactly what makes it worth something. A letter can claim any name for its
author; a petname is the one name nobody else can influence. In the header it is
shown without a ✓, because it is your label and not a verified fact — and the key's
address stays visible beside it, so the name labels the fact rather than replacing
it.

Naming someone records that you recognise a key, and nothing more.

## Vouches: public

A **vouch** is a signed letter saying *I know this key* — who they are to you, and
optionally how you checked. Press **Vouch…** on a person.

Two things the app tells you before you publish one, because they are true:

- **A vouch discloses your social graph.** Whoever receives it learns that you know
  this key.
- **A signed letter cannot be unsaid.** To change your mind you publish a newer
  vouch; only your *latest* word about a key is counted, so repeating yourself buys
  no weight.

A vouch says you *recognise* a key. It does not say they are honest, that they are
who they claim to be, or that anything they signed is true.

Petnames are private; vouches are public. That is the whole difference, and it is
deliberate.

## Your tribe

Vouches are free to manufacture. Anyone can mint a thousand keys and have them vouch
for each other in a circle, so counting vouches proves nothing.

What cannot be faked is a path that **starts at your key**. Your *tribe* is:

- everyone you have vouched for, and
- everyone *they* have vouched for —

and no further. Two hops. Past that, "vouched for by someone vouched for by someone
I once met" is a stranger with extra steps.

The header says **you vouched** or **vouched by someone you vouched for**. It never
shows a number, a percentage or a ✓ for this. A key outside your tribe gets **no
badge at all** — a "0 hops" label would read as a score and stamp a trust-shaped
mark on every stranger.

Your tribe is what makes the rest meaningful:

- forum posts rank by votes *from your tribe* first — ["47 votes, 6 from your tribe"](forums.md);
- attestations lead with how many came [from your tribe](contracts.md).

The first number is free to manufacture. The second is the part that carries.

## What does *not* put someone in your tribe

- **Being on a roster.** A group is free to write; if membership fed your tribe,
  anyone could enter your trust graph by publishing a group that named themselves
  beside you.
- **You upvoting them.** A vote is about a letter, not a person.
- **Their vouching for you.** Only paths *from* you are walked.

## Verified names

The design also supports names that provably map to a key — an ENS name such as
`alice.eth`, confirmed in both directions, shown with a ✓. The code is in place but
is **not active in current builds**. See [status](status.md).
