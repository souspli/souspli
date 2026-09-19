# Types of letter

A **type** is the program that renders a letter: one self-contained HTML file. A
letter names its type by hash, so given a letter you know exactly which program is
meant to show it, and no other program can claim it. Souspli labels a letter from
that hash — never from what the letter says about itself.

Fifteen types are built in. Press **New** to start any of them. The list also
offers every type already in your library, so receiving a letter of a new type gives
you the ability to write one.

## Everyday

| Type | For |
|---|---|
| **Memo** | To, from, subject, message — with enclosures. |
| **News article** | A block document: headings, paragraphs, images the text wraps around, video, footnotes, and provenance fields (publisher, dates, original URL) for copies of things published elsewhere. |
| **Poster** | A set of photos with a title and caption, arranged like a social photo post: grid, row, carousel or stack. |
| **Invitation** | An event. The date is stored as data and shown in each reader's own locale. |
| **Contact card** | Name, role, organisation and how to reach you. Shows only the fields you filled. |
| **To-do list** | A titled checklist. Ticking something off is an edit, made real by publishing. |
| **Name tag** | A name, in big letters. The smallest possible type — a good one to read the source of. |

## Agreements and money

| Type | For |
|---|---|
| **Contract** | A text and its expected signatories. Signed by [co-signing](contracts.md). |
| **Invoice** | Parties, line items, tax, totals and what is due. All money is whole numbers of minor units — never floating point — and totals are derived, not typed. |

## Talking about other letters

| Type | For |
|---|---|
| **Comment** | A reply to a letter, or to another comment. |
| **Attestation** | Your signature behind a statement about another letter. Also carries [moderators' verdicts](forums.md). |
| **Vote** | One key, for or against one letter. Usually cast with ▲ ▼. |

## People and groups

| Type | For |
|---|---|
| **Group** | A roster of keys with roles and names, amended by publishing a new version. A group is also a [forum](forums.md). |
| **Request to join** | Asks a group's keeper to put you on the roster. |
| **Vouch** | A public statement that you recognise a key, and what you call its owner. Builds your [tribe](people.md). |

## Your own

**New → New from HTML…** signs any self-contained page — inline CSS and JavaScript,
no external references — as a letter, with optional attachments.

A well-behaved type also provides its own *Edit* form, so anyone who receives one
can write another. That, plus what a type may and may not do inside the sealed
container, is covered in [Writing a type](../how/develop/writing-a-type.md). To
produce letters from a script — importing an archive, issuing invoices from a
billing system — see [Generating letters](../how/develop/generating-letters.md).

## What a type cannot do

Whatever its author intended. A type cannot make a network request, read a cookie,
open a window, navigate away, learn who you are, see who signed the letter it is
rendering, or publish anything in your name. At worst it can draw misleading pixels
inside its own rectangle — which is why everything you rely on is in the header
above it. [How that is enforced](../how/architecture/container.md).
