# Sharing a letter

A letter is a file. Any way of moving a file moves a letter, and none of them can
alter it: whoever receives it re-verifies everything.

Open a letter and press **Share…**. There are four ways out, in increasing order of
how much they reveal.

## 1. Save as file

**Save as file…** writes a `.thing` file — an exact, byte-for-byte copy of the
bundle as you hold it. Email it, put it on a USB stick, attach it to a chat. It
keeps its author, its signature and its hash wherever it lands; saving someone
else's letter does not re-sign it as yours.

*Reveals:* nothing, to anyone, beyond whatever channel you send the file through.

## 2. Copy bundle

**Copy bundle** puts the same bytes on your clipboard as text, for pasting into
someone's **Ingest** box. Practical for small letters — a comment, a vote, a memo.

*Reveals:* nothing beyond the channel you paste into.

## 3. Seed over BitTorrent

**Seed over BitTorrent** serves the letter from your machine and gives you a
`magnet:` link. Anyone who pastes that link into Ingest downloads it from you, or
from anyone else seeding it. This is how large letters travel — an article with
video, a photo set.

- Nothing is seeded unless you ask, letter by letter. **Stop seeding** turns it off.
- The link works while Souspli is running on a machine that seeds it.
- **File → Transfers…** shows downloads and seeds in both directions, including why
  a download is stuck ("found 2 peers, none have accepted a connection…").

*Reveals:* your IP address to the BitTorrent DHT and to every peer, along with the
fact that you hold this letter. A sealed letter stays encrypted; that you have it
does not stay secret.

## 4. Post to relays

A relay is how a letter reaches someone who **did not ask for it** — which is what
makes a public conversation possible. Souspli uses [Nostr](https://nostr.com)
relays.

- **File → Relays…** → **Add relay** (`wss://…`). The list starts **empty**:
  Souspli connects to nothing you did not add.
- **Share… → Post to relays** hands the letter to every relay on your list.
- Small letters (up to 32 KiB) travel whole. Larger ones are posted as a *pointer*
  — a hash and a magnet link — so you must be seeding it first.
- Sealed letters are refused: the content would stay secret but the fact of it would
  not.

On the receiving side, letters posted to relays you subscribe to arrive in your feed
after passing the same checks as any file. A pointer arrives as an **offer**: a row
saying a letter exists, who offered it, and a **Fetch** button. **Nothing is ever
downloaded automatically** — not a thumbnail, not a byte — until you press it.

*Reveals:* posting tells each relay your IP address, and tells the relay and all its
readers that your key published this letter. Subscribing tells the relay what you
are interested in. Your letters also declare your Nostr key, which is what lets
readers confirm that the person who posted is the person who signed.

## Getting a letter in

The **Ingest** box takes any of:

| Paste | What happens |
|---|---|
| a bundle as text | Verified and added. Nothing touches the network. |
| `bundle:<sha256>` | Looked up in your own store by exact content hash. |
| `magnet:?xt=…` | Starts a background transfer. Shows `⚠ contacts the BitTorrent network` first. |
| `https://…/file.thing` | Downloads it. Shows `⚠ tells <host> your IP` first. *Provisional — may be removed.* |

A URL names a *place*, not content: admission proves that what arrived is a validly
signed letter, not that it is the one you meant to fetch. Look at the author.

## Private letters

The format supports **sealed** letters — encrypted to each recipient, with the
author's identity inside the ciphertext so outsiders cannot even see who wrote it —
and Souspli can **receive and open** them today. Decrypted content is held in memory
only and never written to disk.

**Writing a sealed letter from the app is not available yet.** Until it is, anything
you publish is readable by anyone who gets the file. See [status](status.md).
