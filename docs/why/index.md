# Documents, not servers

Souspli replaces *pages a server renders for you* with *letters people send each
other and keep*. A letter is a single signed file. It carries its own text, images,
layout and behaviour; it opens in a sealed container that has no way out to the
network; and once you hold it, nobody can change it, withdraw it, or see that you
read it.

That is the whole idea. The rest of this page is why it is worth the trouble.

## The shape of almost everything

Nearly every service on the web is built the same way, in three tiers:

| Tier | What lives there |
|---|---|
| **Clients** | a web frontend, an iOS app, an Android app |
| **Application** | the API, the permission checks, the background jobs — *who may see what is decided here* |
| **Data** | the database, the object store, the analytics warehouse |

Beside the stack sits a column of third parties — payments, email, analytics,
advertising — reached both from the operator's servers *and from your own device*.

A social network, a ride-hailing app, an event organiser and a newspaper have
nothing in common as businesses. Draw them and you get the same diagram four times.
Three consequences come with the shape, whoever the operator is and however well
they mean:

- **Custody.** The database is the system of record. You hold a session, not a copy.
- **Rules.** Who may see what is decided in the application tier, and can change
  overnight.
- **Reach.** The client is a collection point too, opening connections to parties
  you never chose.

## One URL, many pages

Take one address — `example-news.com/2026/05/14/report` — in one second:

- **Reader A, a subscriber,** gets the full text, no advertising, and a
  recirculation module built from her last forty articles.
- **Reader B, metered,** gets four paragraphs and an offer priced by his country and
  his visit count.
- **Reader C, an hour later,** gets a revised headline, a corrected figure and
  different advertising, with no notice that anything moved.

There is no artefact to keep, to compare, or to disagree with. There is only a
rendering, and it is gone when the tab closes. You cannot show a friend what you
saw, because what you saw was made for you. You cannot prove what was said, because
it no longer says it.

## A letter instead

Everything Souspli does is one object, exchanged between people:

1. **Self-contained.** No external fetches. What you received is the whole of it —
   every image, every font, every byte of video travelled with it.
2. **Human-readable.** One file of HTML: open technologies, plain markup, readable
   as source by a person for as long as browsers exist.
3. **Immutable.** A letter is identified by the hash of its content. A correction is
   a new letter that says it follows the old one — never a silent edit.
4. **Attributable.** Signed by its author, so provenance travels with the file. The
   signature covers the program, the content and every attachment.
5. **Sealed in.** Rich and interactive, but run in a container with no exit. A
   letter cannot phone home, cannot set a cookie, cannot report on its reader.

If any one of the five fails, the model collapses back into the web. Together they
make archiving a copy operation — and the copy is a complete one.

## What that looks like in practice

**A newspaper.** The publisher composes the edition as one file, advertising
included, and signs it. A reader gets it from the publisher or from anyone who
already has it — the bytes are identical, and the signature proves it. They read it
now or in a decade, shelve it, or hand it to a friend. The advertisement inside is
the one everyone else received, which is what an advertisement used to be.

**A CV and a contract.** A LinkedIn profile is a CV that somebody else keeps. Here
it is a document you send. A job seeker sends a signed CV to a recruiter, gets a
letter back, sends the same CV to a second recruiter, receives a representation
agreement, co-signs it, and the recruiter forwards the CV to a hiring manager who
replies with interview arrangements. Eight documents, three parties, no platform.
Each party keeps the copies it was sent.

**Commercial paper.** Purchase order → acknowledgement → delivery report → invoice →
receipt. Each references the one it answers; every party holds the whole file. The
schema rides inside the letter, so a vendor's software can reject a withdrawn SKU on
its own machine and reply with a memorandum — itself a letter.

**A club.** A roster is a letter its keeper amends by publishing a new version.
Posts are letters tagged into it; replies are letters that point at posts; votes are
small signed letters; moderation is a signed opinion by someone the roster names.
Nobody hosts it. [This one works today.](../use/forums.md)

## Side by side

| | Three-tier service | Souspli |
|---|---|---|
| System of record | The operator's database | The copy in each party's hands |
| What you receive | A rendering, valid for one session | A file, valid indefinitely |
| Who sets the rules | The application tier, changeable at will | The terms written into the document |
| Same content for everyone | No, and not verifiably so | Yes, by content hash |
| Archiving | Screenshots and scrapers | Copy the file |
| Leakage from the client | Dozens of third-party connections | None; the container has no exit |

## The argument is civic, not technical

The exchange of documents between free people is how we operated for centuries —
[it is a very old idea](an-old-idea.md) — and we have more than enough bandwidth to
go on doing it. The architecture above is only the evidence that it is practical.

People who already know the alternatives will want to read
[how Souspli differs from them](compared.md). People who want to try it should start
with [what you can do today](../use/index.md).
