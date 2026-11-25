# Passports: readings, proofs, gated forums and secret ballots

A passport's chip holds your identity data, signed by the state that issued it.
Souspli can check that signature with no network, which makes four things possible:

| | What it shows | What it reveals |
|---|---|---|
| [A passport letter](#a-passport-letter) | This key held this passport | Everything on the photo page |
| [A passport proof](#proofs) | The holder of this key is, say, over 18 and Canadian | Only that |
| [A forum that admits by proof](#forums-that-admit-by-proof) | Every member passed the rule, one passport each | Which keys are members |
| [A secret ballot](#ballots) | Each eligible passport voted at most once | How the count came out, not who voted |

> **Experimental, like the rest.** Today Souspli holds the signing certificates of
> **Canada only**. A passport of any other state reads as *cannot be checked*, never
> as verified. Reading the chip needs the NFC ID reader app on an Android phone, and
> making proofs needs its command-line tools on a computer; Souspli does neither
> itself yet.

## What Souspli checks, and where it says so

Every verdict on this page is reached by Souspli and shown in the **header**, above
the letter. The letter's own page only shows what the letter says. It cannot check a
signature for you, and a tick drawn there would be worth nothing, because anybody
can write a type that draws one.

The header says one of three things, and they are different:

- **✓** Checked, and it holds.
- **✗ check failed** The data contradicts itself, or was made for another key.
- **cannot be checked** Nothing is known to be wrong, but Souspli cannot vouch for
  it: a state whose certificate it does not hold, or an algorithm it does not
  support. This says nothing either way.

## Reading your passport

In the reader app, type the document number and dates from the photo page (they
unlock the chip), and optionally your **Souspli address** from *File → Account &
Keys…*. Hold the passport to the phone. The app saves an export file; copy it to
your computer.

Give the address if your passport supports it (the app tells you). The chip then
signs a challenge derived from that address, which is the only way to show that
*you held the passport*, as opposed to holding a copy of its data.

## A passport letter

**New → Passport**, choose the export, publish. The header then shows:

- **✓ passport: SURNAME, GIVEN · CAN**. The data is genuine: its signatures chain to
  a certificate that ships with Souspli. Hover for the document number and dates.
- **✓ chip signed this key**, or **not tied to this key**. Without the chip's
  signature the data is still genuine, but anyone holding a copy of it could have
  published it under their own key.
- **expired**, if it is.

Republishing someone's passport letter under another key fails: the chip signed the
original author's key, not the copier's.

**Send it privately, and only to people you would hand the passport to.** A passport
letter gives its readers your name, date of birth and document number. It also gives
them the signed data itself, which is all anyone needs to make the proofs below *in
your place*, or to work out which secret-ballot vote was yours.

## Proofs

A proof says something about a passport without showing the passport: *aged 18 or
over*, *a citizen of Canada*, or just *holds a valid passport*. It is bound to one
key, so it cannot be reused by someone who copies it.

Make one from your export with the reader tools, for your address:

```
zk/package.sh passport-export.json my-proof.json --address 0x… --scope my-topic \
    --min-age 18 --nationality CAN
```

then **New → Passport proof**, choose the file, publish. The header shows **✓
passport proof: 18+ · citizen of CAN**. The name, number and date of birth are not
in the letter at all.

The package is a single proof of about 20 KB, so the letter is small enough to post
through a relay like any other. (Packages made with older versions of the tools hold six separate proofs
and are about 120 KB; they still verify, but travel only as a file.)

Three things to know:

- **The scope decides what links.** One passport always shows the same mark (its
  *nullifier*) within one scope, and unrelated marks in different scopes. That is
  what lets a forum or a ballot count each passport once, and what stops two of
  them comparing notes.
- **It was true on the day it was made.** The header's tooltip gives the date. The
  passport was unexpired then.
- **It shows possession of the passport's signed data, not of the booklet.** The
  issuing state holds that data, and so does anyone who has read the chip. This is
  a limit of every passport-proof system built this way, not of this one.

## Forums that admit by proof

*File → Forums… → New forum that admits by passport proof…* Give a minimum age, a
list of nationalities, both, or neither (any valid passport). The rule is part of
the group and stays with it.

Such a forum has no list of members that its keeper writes. **A member is anyone who
has published into it a proof that meets the rule**, made with the forum's own scope
(the forum's window shows the exact words). Then:

- Posts, comments and votes count **only from members**. Everyone else's are not
  shown and not counted.
- **One passport is one member.** Publishing a second proof from the same passport
  under another key moves the membership to that key.
- The keeper sets the rule and cannot make an exception to it, including for
  themselves. Moderators are still the keeper's choice.
- Every reader works membership out alone, from the letters they hold, and reaches
  the same answer.

Joining is public: your key is seen to be a member, which says the rule is true of
you. The rest of the passport stays hidden.

## Ballots

**New → Secret ballot.** Write the question and the options, say who may vote (the
same kind of rule), and name the **witnesses** and how many of them must agree.

**Voting.** Open the ballot and press **Vote…**. Souspli shows an address made for
this ballot alone and the ballot's scope; make a proof package for those, choose it
and your option, and cast. The vote is a letter signed by that one-time key. It does
not carry your identity, your Nostr key, or anything that links to them; only your
computer can tell it is yours.

If you have a relay connected, casting also sends the vote there, so the witnesses
receive it. It goes under a key made for that one message: never your own relay key,
which would name you. The relay still learns the network address it came from. With
no relay, pass the vote to the witnesses as a file.

**Counting.** Every reader counts for themselves: each valid vote they hold, one per
passport, a later vote replacing an earlier one.

**The deadline is the witnesses'.** No letter can prove when it was written. So when
the time comes, each witness presses **Close ballot…**, which publishes the list of
valid votes that witness holds. Once enough witnesses have closed:

- the header says **Final**, and before that **Provisional**;
- a vote counts **only if at least that many witnesses listed it**;
- everyone holding the ballot, the votes and the closings gets the same result.

Fewer witnesses than the number required can neither drop your vote nor let a late
one in. That number acting together can do both, so a ballot is as trustworthy as
its witnesses are independent. You can check that your own vote was counted: the
header says so.

What a secret ballot here does **not** give you:

- **It does not hide your network address** from a relay you post through.
- **It does not stop vote-buying.** You can show someone how you voted, as with any
  postal or online ballot.
- **Whoever holds your passport's signed data can tell which vote was yours.** That
  is the issuing state, anyone who has read the chip, and anyone you sent a
  passport letter to.
- **A passport is not a person.** Someone with two passports has two votes.
