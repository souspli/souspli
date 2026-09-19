# Contracts, versions and attestations

Three things people do with documents that the web does badly: sign them together,
amend them honestly, and vouch for what they say.

## Signing together

**New → Contract.** Write the title and the text, and list the expected
signatories — each a key, a role (party, witness…) and a name. Publish it, and send
it to the others.

Each of them opens it, reads it, and presses **Co-sign…**. Souspli shows exactly
what they are about to sign, and on confirmation produces a *second signature over
the same bytes* — not a copy, not a new document. They send it back, or post it.

What you see in the header: **2 of 4 signed**, and *Signatures* lists who.

- It is never a percentage, a progress bar or a ✓, and the badge says outright that
  it is *not a measure of how valid the document is*. A half-signed contract is not
  half-valid. It is a document two people have not signed.
- The list of expected signatories is part of the signed text, so nobody can quietly
  add themselves to the named parties. But **being named is a claim, not consent**:
  anyone can list anyone.
- A signature from someone the document never named is still a real signature. It is
  shown as *plus 1 not named*, not dropped.
- The contract's own program can show who it *expects*. It cannot see who has
  *signed* — signatures are not given to a letter's code — so a malicious contract
  that painted "fully executed" on itself would be contradicted by the header it
  cannot reach.
- **Copy** is refused on a document that names signatories. Copying rebuilds the
  same content, which would *be* a co-signature — your key on a contract you only
  meant to duplicate. The refusal points you at Co-sign instead.

Every signatory ends up holding the whole document with every signature. There is
no registry to consult and none that can lose it.

## Amending: versions

A letter cannot be edited; change one byte and it is a different letter with
different signatures. What you can do is **supersede** it.

- On your own letter, **New version…** publishes a successor chained to it. Your
  feed shows the current version; the header says *version 2 of 4* and **History**
  lists every one, oldest first. Earlier versions are not deleted or corrected —
  they are simply superseded, and anyone holding version 1 can still prove what it
  said.
- On someone else's letter the button reads **Your version…**. You get *your own
  line*, rooted on theirs. You cannot publish a new version of someone else's
  letter, because you cannot sign as them.
- Each version names the one before it. If a version claims to follow something
  other than its actual predecessor, the header says so. If an author ever publishes
  two different "version 3"s, that is a **fork** — proof of misbehaviour or a stolen
  key — and Souspli flags it rather than quietly picking one.

Groups use exactly this: a roster is amended by publishing its next version.

## Attestations

**Attest** on any open letter starts a signed statement *about* it: "Accurately
reproduced from the original source", "I witnessed this", "I agree to this", or your
own words.

The distinction the whole feature exists to make:

> **The signature is real. The statement is not.**

An attestation proves *who said something*. It does not make it true, the target's
author never agreed to it, and five attestations are not a score. So the list shows
**who** attested rather than a total, and leads with the only part that is hard to
fake: *"5 attestations, 3 from your tribe."*

Use it for: a newspaper's archive copy attested by three librarians; a translation
attested by its translator; minutes attested by those present.

## Comments

**Comment** is the same mechanism with a different purpose — a letter that points at
another. A reply is the commenter's claim, like a timestamp: anyone may claim to
reply to anything. Souspli lists the comments *you hold*; if you have a reply but
not the letter it answers, it says so plainly rather than hiding the claim.
