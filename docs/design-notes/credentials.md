# Credentials: passports, proofs, gated forums, secret ballots

Written 2026-11-18.

## What it is for

Four things people asked of an identity document, in order of how much they reveal:
show a passport; prove a fact from one without showing it; run a forum only some may
join; hold a vote in which each eligible person votes once and nobody learns how.

## The principle

**The shell is the verifier, and the verdict is about the data and the author key.**

The first idea was a letter type that *contains* a verifier. It cannot work. A
program sees only its own args: not the author key, so it cannot tell whether a
chip's signature or a proof is about the person who signed the letter; and not the
header, so a tick it draws is pixels that any look-alike type can draw too. And the
container has no WebAssembly, so a proof could not be checked there at all.

So the evidence travels in the letter and the checking happens in the shell, the
way name verification already does: a verdict of *verified*, *invalid* or *cannot
be checked*, shown in the header. It is keyed on the letter's type and the shape of
its args. Which program the letter names plays no part: a look-alike carrying
genuine data earns the same header, and one carrying anything else earns none.

The spec said passports were out of scope because they bind content to a legal
identity. That is still true of the format: nothing is *signed* by a passport, and
an implementation that knows none of this admits every one of these letters.

## Decisions

**A worker, as for admission.** Certificates, CMS and proofs are hostile bytes. They
are parsed in a utility process that holds no keys, forked per check and killed
after. One check runs at a time.

**Offline, entirely.** State certificates ship in the app. So do the verification
keys and the certificate-registry root for proofs. The proof backend (bb.js) would,
left alone, download about 20 MB of reference string from its publisher on first
use; a verifier needs two points of it, so those are written into the source and
the download is skipped. It would also prefer a native binary it ships; it is told
to run as WebAssembly.

**Pins are the app's, never the letter's.** A proof names its circuit; the key it is
checked under is ours. A proof's registry root must be one we hold. The claims the
header shows are the ones the proofs were checked against, recomputed from the
letter's plain words.

**Bound to the author, two ways.** A reading is bound by the chip signing a
challenge derived from the author's address (Active Authentication signs only eight
bytes, so the binding is 64 bits of a hash). A proof is bound by zkPassport's `bind`
circuit committing to the address.

**The rule is a line of text.** `requires: 'passport age>=18 nationality=CAN'`. Text
so that the shell can pin it through the Group type's edit form, which must not
change: the community forum everyone already holds is an instance of that exact
program. A rule that cannot be parsed admits nobody.

**Membership is computed, not listed.** In a gated forum each reader derives the
members from the proof letters they hold. One nullifier, one member. Everything the
forum counts then counts members only.

**Witnesses are the clock.** Nothing in a letter proves when it was written, so a
ballot names witnesses and a quorum. A witness closes by publishing the hashes of
the valid votes it holds; a vote counts, once closed, if a quorum listed it. Fewer
than a quorum can neither drop a vote nor admit a late one.

**A vote is signed by a key made for that ballot.** Derived from the identity's
signature over the ballot's hash, the way the Nostr key is derived, so nothing is
stored and the identity can always find its own vote. The envelope declares no
Nostr key.

**Verdicts are kept.** A proof's verdict is about immutable bytes and costs a
process and about a second, so it is stored. A reading's is not (it expires), and
neither is *cannot be checked* (a later version may be able to).

## Known limits

- **Possession of data, not of the booklet.** Whoever holds DG1 and the SOD can make
  any of these proofs: the issuing state, anyone who has read the chip, anyone sent
  a passport letter. They can also compute that passport's nullifiers, and so find
  its vote. zkPassport has a salted-nullifier mode that helps; it needs a server,
  and is refused here.
- **A passport is not a person.**
- **A quorum of witnesses acting together** can drop or admit votes. They cannot
  forge one or learn who cast one.
- **Canada only**, no revocation lists, RSA chip signatures only.
- **The network.** A vote posted through a relay shows the relay an address.
- **Size.** A proof package is about 100 KB, too large to travel inline on a relay.
  zkPassport's recursive outer proof would make it one proof; not done.
- **Proving happens outside the app**, with the reader's command-line tools.

## Out of scope

Anonymous posting inside a roster (it needs set-membership proofs over a list of
keys, a different circuit), receipt-freeness, and other documents (DKIM, national
ID cards).

## How it is tested

Unit: both verifiers against a synthetic state and real proofs made from a synthetic
passport; every tampering fails; the rule, membership and tally logic as pure
functions. In the app: each letter type through admission, the worker and the
header; a gated forum; one ballot from open to final. No real passport is in the
repository.
