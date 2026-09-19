# A very old idea

Nothing in Souspli is new except the cryptography. Every property it offers was once
ordinary, and most of them have a name. This page collects the precedents, because
"how people did this for centuries" is a better explanation than any diagram.

## The name

*Sous pli* is French for "under cover": a document sent **sous pli cacheté** travels
folded and sealed, for its addressee only. The unit of Souspli is a **letter**, and
the wire format had the vocabulary before the project had a name — letters have
*envelopes*, may be *sealed*, and carry *enclosures*.

## Open letters and closed ones

Medieval chanceries issued two kinds of letter. **Letters patent** (*litterae
patentes*, "open letters") were addressed to everyone, with the seal hanging from
the bottom so the text could be read without breaking it. **Letters close**
(*litterae clausae*) were folded and sealed shut, for the recipient alone.

Souspli draws exactly that line: a public letter anyone may read and verify, and a
[sealed letter](../how/protocol/spec.md) only its recipients can open — including
the fact of who wrote it.

## What is written stays

> *Vox audita perit, littera scripta manet* — the heard voice perishes, the written
> letter remains.

A web page is a voice: it says something to you, once, and nothing is left. The
point of writing was always that both parties could go back to it.

**Ne varietur** ("so that nothing be changed") is what is written on a document when
it is marked page by page so that no sheet can later be swapped. A content hash is
the same act, done by arithmetic: change one byte and it is a different document.

## Each party keeps a copy

A **chirograph** was a contract written out twice on one sheet, then cut apart
through a word written across the middle — often along a wavy, *indented* line,
whence "indenture". Each party kept a half; bringing the halves together proved
both were genuine. Contracts are still "executed in **counterparts**": every
signatory holds an original.

That is Souspli's answer to "where is the system of record?" — *in each party's
hands*. A [co-signed contract](../use/contracts.md) is one document with several
independent signatures over the same bytes, and everyone who signed holds all of it.

French law has a category for a document the parties sign themselves, with no
public officer involved: the **acte sous seing privé**. No notary, no registry, no
platform — and fully valid. Most of what people do with each other has always
worked that way.

## The letter is its own envelope

Before gummed envelopes, people folded, slit, tucked and sealed a letter so that it
became its own tamper-evident packet — a practice conservators now call
**letterlocking**. Opening it left marks. No third party was involved in its
security; the security was a property of the object.

A Souspli bundle is the same kind of object: the proof of who wrote it, and that it
has not been altered, travels inside it and can be checked by anyone holding it,
offline, without asking anybody.

## Organising by letter

- The **Republic of Letters** was the community of scholars who, across the 17th and
  18th centuries, ran European science and philosophy through correspondence —
  letters copied, forwarded, read aloud and answered, across borders and wars.
- The American colonies' **committees of correspondence** organised a revolution by
  post.
- **Samizdat** — "self-published" — was literature retyped and handed on, reader to
  reader, because there was no permitted channel. Each reader was also a publisher.
- In Japanese neighbourhoods a **kairanban** (回覧板, "circulating board") still goes
  door to door: each household reads the notice, stamps it with its seal, and passes
  it to the next. A signed, circulating document, organising a community.
- In Scandinavia a **budstikke** — a bidding stick — was relayed farm to farm to
  summon people to the assembly, and the law obliged you to pass it on.

That assembly was the ***ting***. It is the same word as English "thing", which
meant a meeting before it meant a matter discussed at one, and only later an object.
Inside Souspli's code a letter is still called a `thing` — named, by accident, after
the oldest word there is for free people meeting to decide something.
