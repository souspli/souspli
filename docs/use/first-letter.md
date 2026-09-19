# Your first letter

## Write it

Press **New** in the top bar and pick a type — *Memo* is a good first one. (The
full list is on the [types](types.md) page; **New from HTML…** signs any
self-contained web page of your own.)

Souspli starts a **draft**. A draft is unsigned, lives only on your machine,
autosaves as you type, and sits in its own section of the feed marked DRAFT.

The header above the letter has a **View | Edit** toggle:

- **Edit** shows the type's own editing form.
- **View** shows the letter exactly as a reader will see it, under a
  *PREVIEW — unpublished draft* badge.

That toggle, and every other control, belongs to Souspli rather than to the letter.
A letter's program can draw anything it likes inside its own rectangle; it cannot
draw on the header, and it has no Publish button of its own.

## Sign it

Press **Publish**. Souspli shows you what will be signed and asks you to confirm.
When you approve:

- the draft becomes a real letter, signed with your key;
- its identity becomes the hash of its content — change one byte and it would be a
  different letter;
- it appears in your feed with your address and a **✓ signed** mark in the header.

Nothing has left your machine. Publishing signs; it does not send.

## Attach things

Types that take attachments (*Poster*, *News article*, *Memo*) let you pick files in
Edit mode. Attachments travel **inside** the letter and are covered by your
signature: nobody can swap your picture for another.

Limits in the current build: 32 MiB per attachment and 64 MiB per draft while
editing; 256 MiB for a whole letter. Images, audio and video display in place. A PDF
or spreadsheet can be enclosed and will arrive intact, but the sealed container
cannot open it — the letter lists it honestly by name, type and size, and
**Share… → Save as file…** gets the bytes out.

## Read someone else's

Any of these opens a letter:

- double-click a `.thing` file;
- drag it onto the window, or press **Open file…**;
- paste a bundle, a link or a name into the **Ingest** box.

Before a single pixel is drawn, Souspli decodes the bundle, verifies the signature,
and checks the hash of the program and of every attachment. If anything fails, the
whole letter is refused — there is no partial admission.

Then look at the header. It is the only place that can tell you the truth:

| You see | It means |
|---|---|
| **✓ signed** and an address | The signature verifies. This key wrote exactly these bytes. |
| A name with a ✓ | A name that *provably* maps to that key (ENS, confirmed in both directions). Not active in current builds — see [status](status.md). |
| A name without a ✓ | Your own [petname](people.md) for the key. Private to you. |
| *you vouched* / *vouched by someone you vouched for* | The author is in your [tribe](people.md). |
| No badge at all | A stranger. Absence is the honest signal. |
| *version 2 of 4* | You are looking at one point in a chain; **Latest** takes you to the newest. |

The feed lists each letter by **who signed it** first, and under that the line the
letter calls itself by — an article's title, a memo's subject, the first line of a
comment. That second line is the author's wording, not something Souspli checked: it
is shown as plain text, in quieter ink, with anything that could imitate a ✓ or
rearrange the row stripped out. Sealed letters show no title, because the feed's
index is a file on disk and their words never go there.

A letter can *claim* anything in its own content — "signed by the Bank of England" in
big letters. The header is where you check.

## Reply, and other things you can do to a letter

With a letter open, the header offers:

- **Comment** — start a reply. It is a new letter of yours that points at this one.
- **Attest** — sign a statement about it ("accurately reproduced", "I witnessed
  this", or your own words). [More](contracts.md).
- **Co-sign…** — add your signature to a document that expects several.
- **▲ ▼** — vote for or against it. [Why votes are not likes](forums.md).
- **Copy** — start a new draft of your own from its content.
- **New version…** / **Your version…** — amend your own letter, or start your own
  line rooted on someone else's.
- **Share…** — [get it to someone](sharing.md).

Each of these produces a *new signed letter of yours*. Nothing ever modifies the one
you are looking at.
